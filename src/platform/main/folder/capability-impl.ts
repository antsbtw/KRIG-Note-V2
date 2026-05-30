/**
 * folder capability — main 端实施 (decision 012 §3.4 §4.3 方案 A)
 *
 * 边界:
 * - main 进程独占,直接 import @storage (合规:capability 层调 storage)
 * - renderer 通过 IPC 桥接到本文件 (src/capabilities/folder/index.ts 薄包装)
 *
 * 实施要点 (decision 012 §3.1 §3.3):
 * - atom domain = 'folder',payload = FolderPayload { title: string }
 * - folder 嵌套用 user:krig:inFolder 边表达 (不存 parentId 字段)
 * - 一个 folder 最多一条 outgoing inFolder 边 (cardinality 一对一,根级无边)
 * - moveFolder = transaction(删旧 inFolder + 加新 inFolder)
 * - deleteFolder = storage.deleteAtom (sub-phase 1 storage 已应用层级联删除关联 edges)
 */

import { storage } from '@storage/index';
import type { StorageTransaction } from '@storage/index';
import type { AtomEntity, FolderPayload } from '@semantic/types';
import type { FolderInfo } from '@shared/ipc/note-folder-types';
import type { FolderViewType } from '@capabilities/folder/types';
import {
  createIntent,
  deleteIntent,
  registerIntentResolver,
  type IntentEntity,
} from '@storage/intent-log';

const FOLDER_DOMAIN = 'folder';
const IN_FOLDER_PREDICATE = 'user:krig:inFolder';
const FOLDER_FOR_VIEW_PREDICATE = 'user:krig:folderForView';
const BELONGS_TO_NOTE_PREDICATE = 'user:krig:belongsToNote';

/**
 * SP-4 分批删除每批大小(同 deleteNote DELETE_BATCH_SIZE 量级)。
 * 删目录子树聚合多篇大 note,块总数可达数万,必须分小事务避免单事务卡死。
 */
const FOLDER_DELETE_BATCH_SIZE = 1000;

function viewMarkerFor(viewType: FolderViewType): string {
  return `__view__/${viewType}`;
}

function atomToFolderInfo(
  atom: AtomEntity<'folder'>,
  parentId: string | null,
): FolderInfo {
  const payload = atom.payload.payload;
  return {
    id: atom.id,
    title: payload.title ?? '',
    parentId,
    createdAt: atom.createdAt,
    updatedAt: atom.updatedAt,
  };
}

async function getParentIdForFolder(folderId: string): Promise<string | null> {
  const edges = await storage.listEdges({
    predicate: IN_FOLDER_PREDICATE,
    subjectAtomId: folderId,
    limit: 1,
  });
  if (edges.length === 0) return null;
  const obj = edges[0].object;
  return obj.kind === 'atom' ? obj.atomId : null;
}

export async function createFolder(
  title: string,
  parentFolderId: string | null,
  viewType: FolderViewType,
): Promise<FolderInfo> {
  const payload: FolderPayload = { title };
  const viewMarker = viewMarkerFor(viewType);
  return storage.transaction(async (tx) => {
    const atom = await tx.putAtom<'folder'>({
      payload: { domain: FOLDER_DOMAIN, payload },
    });
    // decision 021 §4.1: folderForView 边表达 view 归属
    // LiteralValue 字面三字段 { kind, type, value } 缺一不可 (决议 §0.7 第 15 次教训)
    await tx.putEdge({
      predicate: FOLDER_FOR_VIEW_PREDICATE,
      subject: { kind: 'atom', atomId: atom.id },
      object: { kind: 'literal', type: 'string', value: viewMarker },
      attrs: { createdBy: 'user-default', createdAt: Date.now() },
    });
    if (parentFolderId) {
      await tx.putEdge({
        predicate: IN_FOLDER_PREDICATE,
        subject: { kind: 'atom', atomId: atom.id },
        object: { kind: 'atom', atomId: parentFolderId },
        attrs: { createdBy: 'user-default', createdAt: Date.now() },
      });
    }
    return atomToFolderInfo(atom, parentFolderId);
  });
}

/**
 * P1-3 (2026-05-29 data-layer-audit): broadcastFolderListChanged 收敛专用一次性 helper.
 *
 * 字面背景: handlers.ts:broadcastFolderListChanged 字面 Promise.all 调 listFolders 4 次,
 * 每次内部 1 次 listMarkerAtoms + 1 次 listEdges = 8 次 storage call(P1-1 之前是 12 次).
 * 本 helper 字面合并到 3 次 storage call:
 *   1. 拉全部 folder atoms(domain=folder,量 ~50-200)
 *   2. 拉全部 folderForView 边(按 view 切分)
 *   3. 拉 inFolder 边(parent 关系,subjectAtomIds=folderIds)
 * 再内存按 viewType 分 4 组.
 *
 * listFolders(viewType) 公开 API 保留(其它 caller 在用),本 helper 仅 broadcast 用.
 */
export async function listAllFoldersGroupedByView(): Promise<Record<FolderViewType, FolderInfo[]>> {
  // 1 次拉所有 folder atoms
  const atoms = (await storage.listAtoms({
    domain: FOLDER_DOMAIN,
  })) as AtomEntity<'folder'>[];

  if (atoms.length === 0) {
    return { note: [], graph: [], ebook: [], thought: [] };
  }

  const atomsById = new Map<string, AtomEntity<'folder'>>();
  for (const a of atoms) atomsById.set(a.id, a);
  const folderIds = atoms.map((a) => a.id);

  // 1 次拉所有 folderForView 边(全 atoms 量级,~50-200,无 filter 也合理)
  const viewEdges = await storage.listEdges({
    predicate: FOLDER_FOR_VIEW_PREDICATE,
  });

  // 字面按 viewType 分组 folderId 集合
  const idsByView: Record<FolderViewType, Set<string>> = {
    note: new Set(),
    graph: new Set(),
    ebook: new Set(),
    thought: new Set(),
  };
  const NOTE_MARKER = viewMarkerFor('note');
  const GRAPH_MARKER = viewMarkerFor('graph');
  const EBOOK_MARKER = viewMarkerFor('ebook');
  const THOUGHT_MARKER = viewMarkerFor('thought');
  for (const e of viewEdges) {
    if (e.object.kind !== 'literal') continue;
    if (e.object.type !== 'string') continue;
    switch (e.object.value) {
      case NOTE_MARKER:
        idsByView.note.add(e.subject.atomId);
        break;
      case GRAPH_MARKER:
        idsByView.graph.add(e.subject.atomId);
        break;
      case EBOOK_MARKER:
        idsByView.ebook.add(e.subject.atomId);
        break;
      case THOUGHT_MARKER:
        idsByView.thought.add(e.subject.atomId);
        break;
    }
  }

  // 1 次拉 folder 间 parent 关系(P0-1: subjectAtomIds 批量 IN)
  const parentEdges = await storage.listEdges({
    predicate: IN_FOLDER_PREDICATE,
    subjectAtomIds: folderIds,
  });
  const parentBySubject = new Map<string, string>();
  for (const e of parentEdges) {
    if (e.object.kind === 'atom') {
      parentBySubject.set(e.subject.atomId, e.object.atomId);
    }
  }

  // 字面按 viewType 切分 + 拼 FolderInfo
  const buildInfos = (ids: Set<string>): FolderInfo[] => {
    const out: FolderInfo[] = [];
    for (const id of ids) {
      const atom = atomsById.get(id);
      if (!atom) continue; // 孤儿 folderForView 边(atom 已删但边没删) — 跳过
      out.push(atomToFolderInfo(atom, parentBySubject.get(id) ?? null));
    }
    return out;
  };

  return {
    note: buildInfos(idsByView.note),
    graph: buildInfos(idsByView.graph),
    ebook: buildInfos(idsByView.ebook),
    thought: buildInfos(idsByView.thought),
  };
}

export async function listFolders(viewType: FolderViewType): Promise<FolderInfo[]> {
  // decision 021 §4.1: folderForView 边表达 view 归属
  // P1-1 (2026-05-29 data-layer-audit): 走 listMarkerAtoms,SQL 走 INSIDE subquery,
  // 一次 round-trip 取代 listEdges + listAtoms 两步.
  const viewMarker = viewMarkerFor(viewType);
  const inViewAtoms = await storage.listMarkerAtoms<'folder'>({
    domain: FOLDER_DOMAIN,
    markerPredicate: FOLDER_FOR_VIEW_PREDICATE,
    markerObjectMatch: { kind: 'literal', type: 'string', value: viewMarker },
  });
  const folderIdsInView = inViewAtoms.map((a) => a.id);
  const folderIdsInViewSet = new Set(folderIdsInView);

  // 一次性查 in-view folder 的 outgoing inFolder 边(parent 关系)
  // P0-1 (2026-05-29 data-layer-audit): SQL IN 替代全扫
  const edges = folderIdsInView.length > 0
    ? await storage.listEdges({
        predicate: IN_FOLDER_PREDICATE,
        subjectAtomIds: folderIdsInView,
      })
    : [];
  const parentBySubject = new Map<string, string>();
  for (const e of edges) {
    if (!folderIdsInViewSet.has(e.subject.atomId)) continue;
    if (e.object.kind === 'atom') {
      parentBySubject.set(e.subject.atomId, e.object.atomId);
    }
  }
  return inViewAtoms.map((a) => atomToFolderInfo(a, parentBySubject.get(a.id) ?? null));
}

export async function getFolder(id: string): Promise<FolderInfo | null> {
  const atom = await storage.getAtom<'folder'>(id);
  if (!atom) return null;
  // 防御:确认是 folder domain (storage 不强制按 domain 过滤 getAtom)
  if (atom.payload.domain !== FOLDER_DOMAIN) return null;
  const parentId = await getParentIdForFolder(id);
  return atomToFolderInfo(atom, parentId);
}

export async function renameFolder(id: string, newTitle: string): Promise<FolderInfo> {
  const existing = await storage.getAtom<'folder'>(id);
  if (!existing) throw new Error(`Folder ${id} not found`);
  if (existing.payload.domain !== FOLDER_DOMAIN) {
    throw new Error(`Atom ${id} is not a folder (domain=${existing.payload.domain})`);
  }
  const updated = await storage.putAtom<'folder'>({
    id,
    payload: { domain: FOLDER_DOMAIN, payload: { title: newTitle } },
  });
  const parentId = await getParentIdForFolder(id);
  return atomToFolderInfo(updated, parentId);
}

export async function moveFolder(
  folderId: string,
  newParentFolderId: string | null,
): Promise<void> {
  await storage.transaction(async (tx) => {
    // 删旧 inFolder 边 (subject=folderId 的全部 inFolder 边,正常只有 0 或 1 条)
    const oldEdges = await storage.listEdges({
      predicate: IN_FOLDER_PREDICATE,
      subjectAtomId: folderId,
    });
    for (const e of oldEdges) {
      await tx.deleteEdge(e.id);
    }
    if (newParentFolderId) {
      await tx.putEdge({
        predicate: IN_FOLDER_PREDICATE,
        subject: { kind: 'atom', atomId: folderId },
        object: { kind: 'atom', atomId: newParentFolderId },
        attrs: { createdBy: 'user-default', createdAt: Date.now() },
      });
    }
  });
}

/**
 * 删 folder + 递归子 folder + 内含笔记 (Path Y 契约,对齐 macOS Finder)
 *
 * 业务契约变更 (decision 012 设计师批复 Path Y):
 * V1/V2 现状: 删 folder = 删 folder + 子 folder; 笔记移到根级
 * Path Y    : 删 folder = 删 folder + 子 folder + 内含笔记 (一棵子树全删)
 *
 * 实施:用 storage.transaction 包整段,任何子操作失败则整棵子树回滚。
 *
 * ⚠ 风险登记:误删 folder = 丢笔记。配套保护 (删除前弹窗 + 回收站) 留 sub-phase 3+
 *   单独 decision (decision 012 §8 Q7)。
 */
/**
 * Path Y cascade (decision 012 Path Y + decision 014 §3.5.3 graph-canvas 加入白名单).
 *
 * sub-phase 3a-1 (decision 014 §6.2.6 + §3.5.3.3) 把 cascade scope 从仅 'pm' 扩展到
 * ['pm', 'graph-canvas'] — 实现"删 folder 递归删子 folder + 内含 note + 内含 graph-canvas"。
 *
 * 未来 sub-phase 3b ebook 接入时,白名单可继续扩展到 ['pm', 'graph-canvas', 'ebook']。
 *
 * 字段命名 deletedNotes → deletedResources 反映 scope 扩展;
 * 无 caller 真实消费 deletedNotes 字段名 (grep 仅声明位置)。
 */
/**
 * Q7 弱保护 dry-run 计数 (decision 021 §5.5 + §10.B-3).
 *
 * 事务内 BFS collectFolderSubtree + collectResourcesInFolders 同模式(decision 020 §7.5),
 * 仅计数不删除. UI 调用本 API 后,resources > 0 || folders > 0 时弹框确认.
 *
 * folders 字段返"子 folder 数"(不含 self),resources 字段返"含 self 在内的所有 folder 内含资源数".
 */
export async function previewDeleteFolder(
  id: string,
): Promise<{ folders: number; resources: number }> {
  return storage.transaction(async (tx) => {
    const allFolderIds = await collectFolderSubtree(tx, id);
    const allResourceIds = await collectResourcesInFolders(tx, allFolderIds);
    return {
      // allFolderIds 含 self,UI 文案"包含 N 个子文件夹"减 self
      folders: Math.max(0, allFolderIds.length - 1),
      resources: allResourceIds.length,
    };
  });
}

/**
 * SP-4:删目录子树 — 分批 + intent 可中断恢复(替代旧"整子树一个大事务"=类 C 卡死)。
 *
 * 旧实现把整棵子树(可含多篇 6100 块大 note)逐个 deleteAtom 包进**一个事务** →
 * 单事务过大 → SurrealDB `Transaction conflict: Resource busy` / 卡死。
 *
 * 新实现(对齐 deleteNote SP-2):
 * 1. 收集子树全部待删 atom id(folder + 资源 container + 资源的所有 block,read-only)
 * 2. createIntent(delete-folder),payload 存完整 atomIds 清单(供 sweeper 续删)
 * 3. 分批 bulkDeleteAtomsAndEdges,每批独立小事务(不卡死);幂等(重删已删返 0)
 * 4. 删 intent;任一步崩溃 → intent 留 pending → 启动 sweeper 续删
 *
 * 注:资源/folder 立即从 UI 消失靠 list 不再返回已删 atom + broadcast(view 层);
 * 与 deleteNote 的 deletionPending 标记不同(folder 子树量大,逐 atom 标记成本高,
 * 直接靠"删 folder atom 后 listFolders 不再含它"达成 UI 消失)。
 */
export async function deleteFolder(id: string): Promise<{
  deletedFolders: number;
  deletedResources: number;
  cascadedEdges: number;
}> {
  // 1. 收集子树(read-only,不开写事务;collectors 内部走 storage 客户端,_tx 仅签名兼容)
  const allFolderIds = await collectFolderSubtree(null, id);
  const allResourceIds = await collectResourcesInFolders(null, allFolderIds);
  // 资源里的 pm note 还有 block atom 子,一并收集
  const allBlockIds = await collectNoteBlocks(allResourceIds);

  // 删除顺序:block → 资源 container → folder(子在前,容器在后)
  const allAtomIds = [...allBlockIds, ...allResourceIds, ...allFolderIds];

  // 2. intent(payload 存完整清单供 sweeper 续删)
  const intentId = await createIntent({
    op: 'delete-folder',
    targetId: id,
    cursor: { deleted: 0 },
    payload: { atomIds: allAtomIds },
  });

  // 3. 分批删(可中断,sweeper 续)
  await drainFolderDeletion(allAtomIds, intentId);

  return {
    deletedFolders: allFolderIds.length,
    deletedResources: allResourceIds.length,
    cascadedEdges: 0, // 分批模式不再精确统计级联边(bulkDelete 已删,值仅 API 兼容)
  };
}

/** SP-4:把一组 atom id 分批删空 + 删 intent(deleteFolder 首删 + sweeper 续删共用) */
async function drainFolderDeletion(atomIds: string[], intentId: string): Promise<void> {
  for (let i = 0; i < atomIds.length; i += FOLDER_DELETE_BATCH_SIZE) {
    const batch = atomIds.slice(i, i + FOLDER_DELETE_BATCH_SIZE);
    await storage.transaction(async (tx) => {
      await tx.bulkDeleteAtomsAndEdges(batch);
    });
  }
  await deleteIntent(intentId).catch(() => {});
}

/** SP-4:收集一组 note container 的全部 block atom id(belongsToNote.object = container) */
async function collectNoteBlocks(containerIds: string[]): Promise<string[]> {
  const blockIds: string[] = [];
  for (const containerId of containerIds) {
    const edges = await storage.listEdges({
      predicate: BELONGS_TO_NOTE_PREDICATE,
      objectAtomId: containerId,
    });
    for (const e of edges) {
      if (e.subject.kind === 'atom') blockIds.push(e.subject.atomId);
    }
  }
  return blockIds;
}

/**
 * SP-4:注册 delete-folder sweeper resolver(模块加载即注册)。
 * 续删:payload.atomIds 全清单重删一遍(bulkDelete 幂等),删 intent。
 */
registerIntentResolver('delete-folder', async (intent: IntentEntity) => {
  const atomIds = (intent.payload?.atomIds as string[] | undefined) ?? [];
  console.log(
    `[deleteFolder/resolver] 续删 folder 子树 ${atomIds.length} atom(intent ${intent.id})`,
  );
  await drainFolderDeletion(atomIds, intent.id);
});

/**
 * BFS 收集 descendant folder ids (含 self)
 *
 * `_tx` 参数保留(签名稳定);函数内部走外部 storage 客户端
 * (与 storage.listEdges 同事务 db connection,与原代码一致 — 详 audit §5.3 已登记债)
 */
async function collectFolderSubtree(
  _tx: StorageTransaction | null,
  rootFolderId: string,
): Promise<string[]> {
  const result: string[] = [rootFolderId];
  const queue: string[] = [rootFolderId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    // 查所有 inFolder current 且 subject 是 folder atom 的边
    const childEdges = await storage.listEdges({
      predicate: IN_FOLDER_PREDICATE,
      objectAtomId: current,
    });
    // P0-2 (2026-05-29 data-layer-audit): 批量 atomIds 替代 for getAtom 串行(B3 G2)
    const candidateIds: string[] = [];
    for (const e of childEdges) {
      if (e.subject.kind !== 'atom') continue;
      candidateIds.push(e.subject.atomId);
    }
    if (candidateIds.length === 0) continue;
    const candidateAtoms = await storage.listAtoms({
      domain: FOLDER_DOMAIN,
      atomIds: candidateIds,
    });
    for (const a of candidateAtoms) {
      // listAtoms({ domain, atomIds }) 已按 domain 过滤,只剩 folder
      result.push(a.id);
      queue.push(a.id);
    }
  }
  return result;
}

/**
 * 收集 folder ids 集合中所有内含资源 (pm note + graph-canvas + future 扩展)。
 *
 * Path Y cascade 白名单 (decision 014 §3.5.3 + 5.6.bis 扩展):
 * - 'pm' — sub-phase 2 note
 * - 'graph-canvas' — sub-phase 3a-1 画板
 * - 未来 sub-phase 3b ebook 接入时可扩展加 'ebook'
 *
 * 字面约束 (主对话批 A):本函数只扩展 cascade scope,不改 deleteFolder 对外语义
 * (仍是 Path Y "删 folder + 所有 descendants + 所有内含资源")。
 */
const CASCADE_RESOURCE_DOMAINS = new Set(['pm', 'graph-canvas', 'thought']);

/**
 * P0-2 (2026-05-29 data-layer-audit): 批量替代 for-loop getAtom 串行(B3 G3)
 *
 * `_tx` 参数保留(签名稳定);走外部 storage 与 listEdges 同事务连接
 * (audit §5.3 已登记债)
 */
async function collectResourcesInFolders(
  _tx: StorageTransaction | null,
  folderIds: string[],
): Promise<string[]> {
  const resourceIds: string[] = [];
  for (const folderId of folderIds) {
    const edges = await storage.listEdges({
      predicate: IN_FOLDER_PREDICATE,
      objectAtomId: folderId,
    });
    const candidateIds: string[] = [];
    for (const e of edges) {
      if (e.subject.kind !== 'atom') continue;
      candidateIds.push(e.subject.atomId);
    }
    if (candidateIds.length === 0) continue;
    // 单 query 拿全候选 atom + 应用层按 domain 白名单过滤
    const candidateAtoms = await storage.listAtoms({ atomIds: candidateIds });
    for (const a of candidateAtoms) {
      if (CASCADE_RESOURCE_DOMAINS.has(a.payload.domain)) {
        resourceIds.push(a.id);
      }
    }
  }
  return resourceIds;
}
