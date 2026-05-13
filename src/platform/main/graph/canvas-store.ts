/**
 * Graph 画板 store(L7-sub3a-1,decision 014)
 *
 * sub-phase 3a-1 改造:JSON 磁盘 → SurrealDB。
 * V1 → V2 sub-phase 3a-1 改写:接口签名不变(view 透明),底层走 atom + edge。
 *
 * 数据模型(decision 014 §3.1-§3.3):
 * - atom domain 'graph-canvas' — 画板容器 (title, variant, view, schemaVersion, 可选字段)
 * - atom domain 'graph-instance' — 画板内节点 (Instance + ref 模式,无 doc 字段)
 * - 边 user:krig:inFolder (canvas → folder atom) — 复用 sub-phase 2
 * - 边 user:krig:inCanvas (instance → canvas atom) — 本 sub-phase 新增
 * - 边 user:krig:hasContent (text-node instance → pm atom) — 本 sub-phase 新增 (仅 ref==='krig.text.label')
 *
 * 单引用约束 (decision 013 §3.5.1.bis):一段 pm content 只被 1 个 Instance 引用;
 * 浅引用 / 跨 view 复用留 3a-shared-ref 子任务。
 *
 * Step 5.5a 范围 (本 commit):
 * - list / get / create / rename / moveToFolder / delete
 * - get 实现完整 instance + hasContent + pm 拼装 (空 canvas 时 instances=[])
 *
 * Step 5.5b 范围 (后续):
 * - update diff 算法 (增/删/改 instance + hasContent + pm)
 *
 * Step 5.5c 范围 (后续):
 * - duplicate 深拷贝
 *
 * Step 5.6 范围 (后续):
 * - folder 关联走 inFolder 边 + folder-adapter (本 commit 已实现 inFolder 边 read 路径)
 */

import { storage } from '@storage/index';
import type {
  AtomEntity,
  GraphCanvasPayload,
  PmPayload,
} from '@semantic/types';
import { wrapPmDoc } from '../note/envelope';

// ── 数据模型(view 透明,字段命名跟 V2 既有保持一致)──

/** v1 仅 'canvas';里程碑 H 接 family-tree;v1.5+ 加 knowledge / mindmap */
export type GraphVariant = 'canvas' | 'family-tree' | 'knowledge' | 'mindmap';

/** 画板内容是结构化 JSON(serialize.ts 输出形态);跨边界用 unknown 透传 */
export type CanvasDocumentJson = unknown;

export interface GraphCanvasRecord {
  id: string;
  title: string;
  doc_content: CanvasDocumentJson;
  variant: GraphVariant;
  folder_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface GraphCanvasListItem {
  id: string;
  title: string;
  variant: GraphVariant;
  folder_id: string | null;
  updated_at: number;
}

export interface GraphFolderRecord {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  created_at: number;
}

// ── 常量 ──

const CANVAS_DOMAIN = 'graph-canvas';
const INSTANCE_DOMAIN = 'graph-instance';
const PM_DOMAIN = 'pm';
const IN_FOLDER_PREDICATE = 'user:krig:inFolder';
const IN_CANVAS_PREDICATE = 'user:krig:inCanvas';
const HAS_CONTENT_PREDICATE = 'user:krig:hasContent';
const TEXT_LABEL_REF = 'krig.text.label';
const DEFAULT_SCHEMA_VERSION = 2;

function defaultView(): GraphCanvasPayload['view'] {
  return { centerX: 0, centerY: 0, zoom: 1 };
}

// ── inFolder 边查询辅助 (decision 014 §3.5.3.6 keep-latest 收敛) ──

interface EdgeSummary {
  id: string;
  objectAtomId: string;
  createdAt: number;
}

/**
 * 查 canvas 的 inFolder 边,按 createdAt 降序 + id tie-breaker 返排序后数组。
 * 调用方决定取首条 (keep-latest) 还是全清。
 */
async function listInFolderEdgesForCanvas(canvasId: string): Promise<EdgeSummary[]> {
  const edges = await storage.listEdges({
    predicate: IN_FOLDER_PREDICATE,
    subjectAtomId: canvasId,
  });
  const normalized: EdgeSummary[] = [];
  for (const e of edges) {
    if (e.object.kind !== 'atom') continue;
    normalized.push({
      id: e.id,
      objectAtomId: e.object.atomId,
      createdAt: e.createdAt,
    });
  }
  // keep-latest: createdAt 大者优先,tie-breaker id 字典序大者
  normalized.sort((a, b) => {
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
  return normalized;
}

/**
 * 自愈规范化:发现多条边时 warn + 异步删多余。
 * 不阻塞读路径 (clean 失败仅 warn)。
 */
function asyncCleanupStaleEdges(staleEdgeIds: string[], label: string): void {
  if (staleEdgeIds.length === 0) return;
  console.warn(
    `[graph/canvas-store] cleaning ${staleEdgeIds.length} stale ${label} edge(s) (keep-latest rule)`,
  );
  void (async () => {
    for (const id of staleEdgeIds) {
      try {
        await storage.deleteEdge(id);
      } catch (err) {
        console.warn(`[graph/canvas-store] failed to clean ${label} edge ${id}:`, err);
      }
    }
  })();
}

/**
 * 拿 canvas 的 folder id (read 路径自愈)。
 * - 0 条边 → 根级 → null
 * - 1 条边 → 直接返
 * - >1 条边 → warn + 异步清理,返 keep-latest 那条
 */
async function getFolderIdForCanvas(canvasId: string): Promise<string | null> {
  const edges = await listInFolderEdgesForCanvas(canvasId);
  if (edges.length === 0) return null;
  if (edges.length > 1) {
    asyncCleanupStaleEdges(edges.slice(1).map((e) => e.id), 'inFolder');
  }
  return edges[0].objectAtomId;
}

// ── hasContent 边查询辅助 (同 inFolder keep-latest 收敛) ──

async function getPmAtomIdForInstance(instanceId: string): Promise<string | null> {
  const edges = await storage.listEdges({
    predicate: HAS_CONTENT_PREDICATE,
    subjectAtomId: instanceId,
  });
  const candidates: EdgeSummary[] = [];
  for (const e of edges) {
    if (e.object.kind !== 'atom') continue;
    candidates.push({ id: e.id, objectAtomId: e.object.atomId, createdAt: e.createdAt });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
  if (candidates.length > 1) {
    console.warn(
      `[graph/canvas-store] instance ${instanceId} has ${candidates.length} hasContent edges`
        + ` (single-ref violation), keeping latest`,
    );
    asyncCleanupStaleEdges(candidates.slice(1).map((c) => c.id), 'hasContent');
  }
  return candidates[0].objectAtomId;
}

// ── instance atom → Instance object (view 期望形态) ──

/**
 * 把 graph-instance atom 反序列化为 view 期望的 Instance object。
 * 加 id 字段 (atom.id) + 可选 doc 字段 (text-node 时通过 hasContent + pm atom 拼装)。
 */
async function instanceAtomToObject(
  atom: AtomEntity<'graph-instance'>,
): Promise<Record<string, unknown>> {
  const payload = atom.payload.payload;
  const instance: Record<string, unknown> = {
    id: atom.id,
    type: payload.type,
    ref: payload.ref,
  };
  if (payload.position !== undefined) instance.position = payload.position;
  if (payload.size !== undefined) instance.size = payload.size;
  if (payload.rotation !== undefined) instance.rotation = payload.rotation;
  if (payload.endpoints !== undefined) instance.endpoints = payload.endpoints;
  if (payload.params !== undefined) instance.params = payload.params;
  if (payload.style_overrides !== undefined) instance.style_overrides = payload.style_overrides;
  if (payload.props !== undefined) instance.props = payload.props;
  if (payload.size_lock !== undefined) instance.size_lock = payload.size_lock;
  if (payload.text_valign !== undefined) instance.text_valign = payload.text_valign;

  // text-node 特例:从 hasContent 边 + pm atom 拼回 doc 字段
  if (payload.ref === TEXT_LABEL_REF) {
    const pmAtomId = await getPmAtomIdForInstance(atom.id);
    if (pmAtomId) {
      const pmAtom = await storage.getAtom<'pm'>(pmAtomId);
      if (pmAtom && pmAtom.payload.domain === PM_DOMAIN) {
        // V1/V2 view 期望 doc 字段是 TextNodeAtoms = unknown[] (PM content 数组).
        // pm atom payload 已是 PmPayload,wrap → 取 payload (= 原 PmPayload).
        // 实际取 content 数组传给 view (canvas-text-node 桥接消费).
        const env = wrapPmDoc(pmAtom.payload.payload as PmPayload);
        const pmDoc = env.payload as PmPayload;
        instance.doc = pmDoc.content ?? [];
      }
    }
  }
  return instance;
}

// ── Instance write 路径 (5.5b diff 算法消费) ──

/**
 * 从 view 端 incoming Instance 对象提取 graph-instance payload。
 * 不带 id (由 storage 生成或调用方传入);不带 doc (text-node 走 hasContent 边)。
 */
function incomingInstanceToPayload(inst: Record<string, unknown>): import('@semantic/types').GraphInstancePayload {
  const p: import('@semantic/types').GraphInstancePayload = {
    type: (inst.type as 'shape' | 'substance') ?? 'shape',
    ref: typeof inst.ref === 'string' ? inst.ref : '',
  };
  if (inst.position !== undefined) p.position = inst.position as { x: number; y: number };
  if (inst.size !== undefined) p.size = inst.size as { w: number; h: number };
  if (inst.rotation !== undefined) p.rotation = inst.rotation as number;
  if (inst.endpoints !== undefined) {
    p.endpoints = inst.endpoints as import('@semantic/types').GraphInstancePayload['endpoints'];
  }
  if (inst.params !== undefined) p.params = inst.params as Record<string, number>;
  if (inst.style_overrides !== undefined) {
    p.style_overrides = inst.style_overrides as import('@semantic/types').GraphInstanceStyleOverrides;
  }
  if (inst.props !== undefined) p.props = inst.props as Record<string, unknown>;
  if (inst.size_lock !== undefined) p.size_lock = inst.size_lock as { w?: boolean; h?: boolean };
  if (inst.text_valign !== undefined) {
    p.text_valign = inst.text_valign as 'top' | 'middle' | 'bottom';
  }
  return p;
}

/**
 * 从 view 端 incoming Instance 提取 doc (PM content 数组),包装为完整 PmPayload。
 * 仅 text-node (ref==='krig.text.label') 调用。incoming.doc 是 TextNodeAtoms = unknown[],
 * 需包成 PmPayload { type:'doc', content: [...] } 才能存 pm atom。
 */
function incomingDocToPmPayload(inst: Record<string, unknown>): PmPayload {
  const docArr = Array.isArray(inst.doc) ? inst.doc : [];
  return {
    type: 'doc',
    content: docArr as PmPayload[],
  };
}

/**
 * 新建 instance atom + inCanvas 边;若 text-node 同步建 pm atom + hasContent 边。
 * @param targetId 指定 atom id (view 端预生成);null = storage 生成
 */
async function createInstance(
  canvasId: string,
  inst: Record<string, unknown>,
  targetId: string | null,
): Promise<void> {
  const payload = incomingInstanceToPayload(inst);
  const created = await storage.putAtom<'graph-instance'>({
    id: targetId ?? undefined,
    payload: { domain: INSTANCE_DOMAIN, payload },
  });
  await storage.putEdge({
    predicate: IN_CANVAS_PREDICATE,
    subject: { kind: 'atom', atomId: created.id },
    object: { kind: 'atom', atomId: canvasId },
    attrs: { createdBy: 'user-default', createdAt: Date.now() },
  });
  // text-node 特例:建 pm atom + hasContent 边
  if (payload.ref === TEXT_LABEL_REF && inst.doc !== undefined) {
    const pmPayload = incomingDocToPmPayload(inst);
    const pmAtom = await storage.putAtom<'pm'>({
      payload: { domain: PM_DOMAIN, payload: pmPayload },
    });
    await storage.putEdge({
      predicate: HAS_CONTENT_PREDICATE,
      subject: { kind: 'atom', atomId: created.id },
      object: { kind: 'atom', atomId: pmAtom.id },
      attrs: { createdBy: 'user-default', createdAt: Date.now() },
    });
  }
}

/**
 * 更新现有 instance atom payload;若 text-node 同步更新或建立 pm atom。
 */
async function updateInstance(
  instanceId: string,
  inst: Record<string, unknown>,
): Promise<void> {
  const payload = incomingInstanceToPayload(inst);
  await storage.putAtom<'graph-instance'>({
    id: instanceId,
    payload: { domain: INSTANCE_DOMAIN, payload },
  });
  // text-node 特例
  if (payload.ref === TEXT_LABEL_REF && inst.doc !== undefined) {
    const pmAtomId = await getPmAtomIdForInstance(instanceId);
    const pmPayload = incomingDocToPmPayload(inst);
    if (pmAtomId) {
      // 更新现有 pm atom
      await storage.putAtom<'pm'>({
        id: pmAtomId,
        payload: { domain: PM_DOMAIN, payload: pmPayload },
      });
    } else {
      // hasContent 边不存在 (text-node 之前没 doc 或迁移残缺) → 新建 pm atom + hasContent
      const pmAtom = await storage.putAtom<'pm'>({
        payload: { domain: PM_DOMAIN, payload: pmPayload },
      });
      await storage.putEdge({
        predicate: HAS_CONTENT_PREDICATE,
        subject: { kind: 'atom', atomId: instanceId },
        object: { kind: 'atom', atomId: pmAtom.id },
        attrs: { createdBy: 'user-default', createdAt: Date.now() },
      });
    }
  }
}

/**
 * 删 instance atom + cascade 边;若 text-node 单引用 pm 同步删 pm atom。
 * 单引用约束 (decision 013 §3.5.1.bis):本 sub-phase hasBeenReferenced 必为 false。
 */
async function deleteInstanceWithCascade(instanceId: string): Promise<void> {
  const instanceAtom = await storage.getAtom<'graph-instance'>(instanceId);
  if (instanceAtom?.payload.domain === INSTANCE_DOMAIN
      && instanceAtom.payload.payload.ref === TEXT_LABEL_REF) {
    const pmAtomId = await getPmAtomIdForInstance(instanceId);
    if (pmAtomId) {
      // 单引用模式:本 sub-phase pm 必为 false → 直接删
      await storage.deleteAtom(pmAtomId);
    }
  }
  // 删 instance atom (storage cascade 删 inCanvas + hasContent 边)
  await storage.deleteAtom(instanceId);
}

// ── canvas atom → record / list-item ──

function canvasAtomToListItem(
  atom: AtomEntity<'graph-canvas'>,
  folderId: string | null,
): GraphCanvasListItem {
  const p = atom.payload.payload;
  return {
    id: atom.id,
    title: p.title ?? 'Untitled Canvas',
    variant: p.variant,
    folder_id: folderId,
    updated_at: atom.updatedAt,
  };
}

async function canvasAtomToRecord(
  atom: AtomEntity<'graph-canvas'>,
  folderId: string | null,
): Promise<GraphCanvasRecord> {
  const p = atom.payload.payload;
  // 查所有 inCanvas 边 object=canvas → 拿 instance atom ids
  const inCanvasEdges = await storage.listEdges({
    predicate: IN_CANVAS_PREDICATE,
    objectAtomId: atom.id,
  });
  const instanceIds: string[] = [];
  for (const e of inCanvasEdges) {
    if (e.subject.kind === 'atom') instanceIds.push(e.subject.atomId);
  }
  // 批读 instance atoms
  const instances: Array<Record<string, unknown>> = [];
  for (const id of instanceIds) {
    const a = await storage.getAtom<'graph-instance'>(id);
    if (!a || a.payload.domain !== INSTANCE_DOMAIN) continue;
    instances.push(await instanceAtomToObject(a));
  }
  // 按 atom id (ULID 时间排序近似) 排序,保持视觉稳定
  instances.sort((a, b) => {
    const ai = String(a.id);
    const bi = String(b.id);
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });

  const docContent: CanvasDocumentJson = {
    schema_version: p.schemaVersion ?? DEFAULT_SCHEMA_VERSION,
    view: p.view ?? defaultView(),
    instances,
  };

  return {
    id: atom.id,
    title: p.title ?? 'Untitled Canvas',
    doc_content: docContent,
    variant: p.variant,
    folder_id: folderId,
    created_at: atom.createdAt,
    updated_at: atom.updatedAt,
  };
}

// ── Store (单例 export,接口签名跟 V2 既有 canvas-store 一致) ──

class CanvasStore {
  // 旧 JSON 版本是 lazy load,新版无须 load — storage 自带连接管理

  // ── 画板 CRUD ──

  async list(): Promise<GraphCanvasListItem[]> {
    const atoms = (await storage.listAtoms({
      domain: CANVAS_DOMAIN,
      orderBy: 'updatedAt',
      orderDirection: 'desc',
    })) as AtomEntity<'graph-canvas'>[];

    const items: GraphCanvasListItem[] = [];
    for (const a of atoms) {
      if (a.payload.domain !== CANVAS_DOMAIN) continue;
      const folderId = await getFolderIdForCanvas(a.id);
      items.push(canvasAtomToListItem(a, folderId));
    }
    return items;
  }

  async get(id: string): Promise<GraphCanvasRecord | null> {
    const atom = await storage.getAtom<'graph-canvas'>(id);
    if (!atom) return null;
    if (atom.payload.domain !== CANVAS_DOMAIN) return null;
    const folderId = await getFolderIdForCanvas(id);
    return canvasAtomToRecord(atom, folderId);
  }

  async create(
    title: string,
    variant: GraphVariant,
    folderId: string | null,
  ): Promise<GraphCanvasRecord> {
    const payload: GraphCanvasPayload = {
      title: title || 'Untitled Canvas',
      variant,
      view: defaultView(),
      schemaVersion: DEFAULT_SCHEMA_VERSION,
    };
    const atom = await storage.putAtom<'graph-canvas'>({
      payload: { domain: CANVAS_DOMAIN, payload },
    });
    if (folderId) {
      await storage.putEdge({
        predicate: IN_FOLDER_PREDICATE,
        subject: { kind: 'atom', atomId: atom.id },
        object: { kind: 'atom', atomId: folderId },
        attrs: { createdBy: 'user-default', createdAt: Date.now() },
      });
    }
    return canvasAtomToRecord(atom, folderId);
  }

  /**
   * 保存画板内容 + 同步 title (Step 5.5b 完整 diff 算法)。
   *
   * 实施流程 (decision 014 §3.5.2):
   * 1. 更新 canvas atom payload (title / view / schemaVersion)
   * 2. 读现有 instance atoms (查 inCanvas 边 object=canvas)
   * 3. diff docContent.instances vs 现有 instances:
   *    - 新增: putAtom(graph-instance) + putEdge(inCanvas);若 text-node 同步建 pm + hasContent
   *    - 修改: putAtom 更新 payload;若 text-node 同步更新 pm
   *    - 删除: deleteAtom(instance) + storage cascade 边;若 text-node 单引用同步删 pm
   * 4. handler 层广播 onGraphListChanged
   *
   * ⚠ 性能 (Q1):1000 节点画板软目标 < 200ms,实测超标停下汇报。
   * ⚠ 无原子性 (Q-tx):diff 中途崩溃 → 部分写入,worst case = 残留游离 atom (留 3a-N+ 清理入口)。
   */
  async update(id: string, docContent: CanvasDocumentJson, title: string): Promise<void> {
    const existing = await storage.getAtom<'graph-canvas'>(id);
    if (!existing) return;
    if (existing.payload.domain !== CANVAS_DOMAIN) return;
    const oldP = existing.payload.payload;

    const doc = (docContent ?? {}) as {
      view?: GraphCanvasPayload['view'];
      schema_version?: number;
      instances?: Array<Record<string, unknown>>;
    };

    // ── 1. 更新 canvas atom payload ──
    const newCanvasPayload: GraphCanvasPayload = {
      ...oldP,
      title: title || oldP.title,
      view: doc.view ?? oldP.view,
      schemaVersion: doc.schema_version ?? oldP.schemaVersion,
    };
    await storage.putAtom<'graph-canvas'>({
      id,
      payload: { domain: CANVAS_DOMAIN, payload: newCanvasPayload },
    });

    // ── 2. 读现有 instance atoms ──
    const inCanvasEdges = await storage.listEdges({
      predicate: IN_CANVAS_PREDICATE,
      objectAtomId: id,
    });
    const existingInstanceIds = new Set<string>();
    for (const e of inCanvasEdges) {
      if (e.subject.kind === 'atom') existingInstanceIds.add(e.subject.atomId);
    }

    // ── 3. diff docContent.instances ──
    const incoming = Array.isArray(doc.instances) ? doc.instances : [];
    const incomingIds = new Set<string>();
    for (const inst of incoming) {
      const instId = typeof inst.id === 'string' ? inst.id : null;
      if (!instId) {
        // 无 id 的入站节点 → 视为"新增请求",storage 会生成新 ULID
        await createInstance(id, inst, /*targetId*/ null);
        continue;
      }
      incomingIds.add(instId);
      if (existingInstanceIds.has(instId)) {
        // 修改
        await updateInstance(instId, inst);
      } else {
        // 新增 (view 端可能预先生成了 client-side id;storage putAtom 允许传 id)
        await createInstance(id, inst, instId);
      }
    }
    // 删除:existingInstanceIds - incomingIds
    for (const oldId of existingInstanceIds) {
      if (!incomingIds.has(oldId)) {
        await deleteInstanceWithCascade(oldId);
      }
    }
  }

  async delete(id: string): Promise<void> {
    // 查所有 inCanvas 边 → 拿 instance ids → 走单实例 cascade 删除
    const inCanvasEdges = await storage.listEdges({
      predicate: IN_CANVAS_PREDICATE,
      objectAtomId: id,
    });
    for (const e of inCanvasEdges) {
      if (e.subject.kind === 'atom') {
        await deleteInstanceWithCascade(e.subject.atomId);
      }
    }
    // 删 canvas atom (storage cascade 删 inFolder 边)
    await storage.deleteAtom(id);
  }

  async rename(id: string, title: string): Promise<void> {
    const existing = await storage.getAtom<'graph-canvas'>(id);
    if (!existing) return;
    if (existing.payload.domain !== CANVAS_DOMAIN) return;
    const oldP = existing.payload.payload;
    await storage.putAtom<'graph-canvas'>({
      id,
      payload: { domain: CANVAS_DOMAIN, payload: { ...oldP, title } },
    });
  }

  /**
   * 移动 canvas 到 folder (decision 014 §3.5.3.6 写路径去重保护)。
   * 走 best-effort 顺序操作:
   * 1. 查所有 inFolder 边 (subject=canvas) → keep-latest 收敛
   * 2. 删除其余非 keep-latest 的脏边
   * 3. 若 keep-latest 已指向 newFolderId → no-op (幂等)
   * 4. 否则:删 keep-latest 边 + 创建新 inFolder 边 (若 newFolderId !== null)
   */
  async moveToFolder(id: string, folderId: string | null): Promise<void> {
    const edges = await listInFolderEdgesForCanvas(id);
    const staleEdgeIds = edges.slice(1).map((e) => e.id);
    for (const eid of staleEdgeIds) {
      try {
        await storage.deleteEdge(eid);
      } catch (err) {
        console.warn(`[graph/canvas-store] failed to clean stale inFolder edge ${eid}:`, err);
      }
    }
    const latest = edges[0];
    if (folderId === null) {
      if (latest) await storage.deleteEdge(latest.id);
      return;
    }
    if (latest && latest.objectAtomId === folderId) return;
    if (latest) await storage.deleteEdge(latest.id);
    await storage.putEdge({
      predicate: IN_FOLDER_PREDICATE,
      subject: { kind: 'atom', atomId: id },
      object: { kind: 'atom', atomId: folderId },
      attrs: { createdBy: 'user-default', createdAt: Date.now() },
    });
  }

  /**
   * 复制画板。
   * ⚠ Step 5.5c 实施 (深拷贝 canvas + instance + pm);5.5a 暂返 null 占位。
   */
  async duplicate(
    _id: string,
    _targetFolderId?: string | null,
  ): Promise<GraphCanvasRecord | null> {
    console.warn('[graph/canvas-store] duplicate is not implemented yet (留 Step 5.5c)');
    return null;
  }

  // ── 文件夹 (Step 5.6 改 folder-adapter,本 step 临时占位) ──
  // 5.5a 临时占位:JSON 实施移除后,folder list/CRUD 走 sub-phase 2 folder atom + adapter,
  // 在 Step 5.6 完整实施 folder-adapter。本 step 临时返空 array / no-op,确保 IPC 不 crash。

  async folderList(): Promise<GraphFolderRecord[]> {
    console.warn('[graph/canvas-store] folderList placeholder (留 Step 5.6 folder-adapter)');
    return [];
  }

  async folderCreate(
    _title: string,
    _parentId: string | null,
  ): Promise<GraphFolderRecord | null> {
    console.warn('[graph/canvas-store] folderCreate placeholder (留 Step 5.6 folder-adapter)');
    return null;
  }

  async folderRename(_id: string, _title: string): Promise<void> {
    console.warn('[graph/canvas-store] folderRename placeholder (留 Step 5.6 folder-adapter)');
  }

  async folderDelete(_id: string): Promise<void> {
    console.warn('[graph/canvas-store] folderDelete placeholder (留 Step 5.6 folder-adapter)');
  }

  async folderMove(_id: string, _parentId: string | null): Promise<void> {
    console.warn('[graph/canvas-store] folderMove placeholder (留 Step 5.6 folder-adapter)');
  }
}

// 单例(跟 ebook bookshelfStore 同形)
export const canvasStore = new CanvasStore();
