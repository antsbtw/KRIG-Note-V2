/**
 * note capability — main 端实施
 *
 * L7 block atomization Stage 2 重写(decision 026 §3 / §6 / §8):
 *   - createNote → container atom(empty doc) + N 个默认 block atom + 边集合
 *   - getNote   → assemblePmDoc(拼装) + in-memory cache 加速
 *   - updateNote → diff(oldDoc vs newDoc)+ 增量 putAtom / putEdge / deleteAtom / deleteEdge
 *   - deleteNote → 先级联删所有 block atom(by belongsToNote.object=containerId)+ 删 container
 *
 * 边界(沿 decision 012):
 * - main 进程独占,直接 import @storage (合规:capability 层调 storage)
 * - renderer 通过 IPC 桥接到本文件 (src/capabilities/note/index.ts 薄包装)
 * - view ↔ capability:NoteInfo.doc = DriverSerialized 信封
 * - capability 内部 ↔ storage:裸 PmPayload(envelope.ts wrap/unwrap)
 *
 * D-10 兼容:本文件不假设 container 一定带 hasNoteView 边 — reading-thought
 * 字面 pm domain 但走 hasReadingThought 边,也使用 updateNote 路径。
 * getNote 字面**仅**对 hasNoteView marker 防御性 filter(保留 decision 016 §3.4),
 * 但 updateNote / deleteNote / assemble / dissect / diff 不查 hasNoteView。
 *
 * 实施要点(沿 decision 012 §3.2 §3.3):
 * - atom domain='pm',container atom payload = empty doc({type:'doc', content:[]})
 * - block atom payload = 单 block PM 节点({type:'paragraph'/...,attrs:{id,...},content:...})
 * - note 归属 folder 用 user:krig:inFolder 边表达
 * - 一个 note 最多一条 outgoing inFolder 边
 * - title 派生自 assemble 后 doc.content[0] 首段文本(走 deriveTitle 不变)
 */

import { storage } from '@storage/index';
import { waitForTitleBackfill } from '@storage/migrations/023-note-title-cache';
import type { AtomEntity, PmPayload } from '@semantic/types';
import type { NoteInfo, NoteDocEnvelope } from '@shared/ipc/note-folder-types';
import { generateUlid } from '@shared/ulid';
import { deriveTitle } from './derive-title';
import { wrapPmDoc, unwrapPmDoc, emptyNoteDoc } from './envelope';
import { assemblePmDoc } from './assemble-pm-doc';
import { emptyContainerPayload } from './dissect-pm-doc';
import { diffBlockTree, fullCreateDiff, type BlockDiff } from './diff-block-tree';
import { pmDocCache } from './pm-doc-cache';

const NOTE_DOMAIN = 'pm';
const IN_FOLDER_PREDICATE = 'user:krig:inFolder';
const HAS_NOTE_VIEW_PREDICATE = 'user:krig:hasNoteView';
const BELONGS_TO_NOTE_PREDICATE = 'user:krig:belongsToNote';

/**
 * note container atom payload — 含缓存 title(2026-05-28 性能修复)
 *
 * container payload 本来恒 empty doc `{type:'doc',content:[]}`。
 * listNotes 之前为了拿 title 必须 assemblePmDoc 拼全文,导致 N 篇 note × 4 个
 * 全表 listEdges → 大批 import 后冷启动卡 30s+。
 *
 * 修法:在 container payload 的 attrs.title 缓存当前 title。createNote / updateNote
 * 时用 deriveTitle(doc) 算好写进去;listNotes 优先读 attrs.title 跳过 assemble。
 * PM schema 对 doc 节点 attrs 透明无副作用(浏览器渲染忽略)。
 */
function containerPayloadWithTitle(title: string): PmPayload {
  return { type: 'doc', attrs: { title }, content: [] };
}

/** 从 container atom payload 读缓存 title;未命中(老数据)返 null,caller fallback assemble */
function readCachedTitle(payload: PmPayload): string | null {
  const t = payload.attrs?.title;
  return typeof t === 'string' ? t : null;
}

async function getFolderIdForNote(noteId: string): Promise<string | null> {
  const edges = await storage.listEdges({
    predicate: IN_FOLDER_PREDICATE,
    subjectAtomId: noteId,
    limit: 1,
  });
  if (edges.length === 0) return null;
  const obj = edges[0].object;
  return obj.kind === 'atom' ? obj.atomId : null;
}

/**
 * 把 container atom + 已拼装 PmPayload 组装为 NoteInfo(IPC 出参形态)。
 */
function buildNoteInfo(
  containerAtom: AtomEntity<'pm'>,
  assembledDoc: PmPayload,
  folderId: string | null,
): NoteInfo {
  return {
    id: containerAtom.id,
    title: deriveTitle(assembledDoc),
    doc: wrapPmDoc(assembledDoc),
    folderId,
    createdAt: containerAtom.createdAt,
    updatedAt: containerAtom.updatedAt,
  };
}

/**
 * 在 storage transaction 内字面应用 diff。
 *
 * 顺序:
 * 1. removedIds:deleteAtom(级联删该 atom 的所有边 — 沿 storage.deleteAtom 字面行为)
 * 2. removedEdges:deleteEdge(残余边 — diff 内已剔除被 removed atom 的边,这里是
 *    "atom 未删但 sibling/childOf 关系变了"的边)
 * 3. added:putAtom(create with explicit id)+ added 的属于本 atom 的边
 * 4. modified:putAtom(update by id)
 * 5. addedEdges:putEdge(新边集合,字面已在 dissect 算)
 */
async function applyDiff(
  diff: BlockDiff,
  tx: import('@storage/api').StorageTransaction,
): Promise<void> {
  const now = Date.now();

  // 1. 删 atom(级联删边)
  for (const id of diff.removedIds) {
    await tx.deleteAtom(id);
  }

  // 2. 删剩余边(diff 内已剔除被 removed atom 关联的边)
  for (const e of diff.removedEdges) {
    // 字面找到该边的 entity id(storage edge schema 字面单 PUT 是 id-based,
    // delete 字面需 id;listEdges 字面按 predicate+subject+object filter)
    const found = await storage.listEdges({
      predicate: e.predicate,
      subjectAtomId: e.subjectId,
      objectAtomId: e.objectId,
    });
    for (const edge of found) {
      await tx.deleteEdge(edge.id);
    }
  }

  // 3. added atom(显式 id putAtom — atom.id 字面 = PM attrs.id,沿 decision 026 §4.1)
  for (const a of diff.added) {
    await tx.putAtom<'pm'>({
      id: a.id,
      payload: { domain: NOTE_DOMAIN, payload: a.payload },
    });
  }

  // 4. modified atom
  for (const m of diff.modified) {
    await tx.putAtom<'pm'>({
      id: m.id,
      payload: { domain: NOTE_DOMAIN, payload: m.payload },
    });
  }

  // 5. 新边(去重:有些 added 边可能字面已存在 — 字面 putEdge 是 idempotent if id
  //    given,但本路径未带 edge id;字面 listEdges 检查是 N^2 开销,先字面直接 putEdge,
  //    若 storage 字面允许 duplicate predicate+subject+object 字面会重复;后续 Stage 3
  //    cardinality 检查字面会发现)
  for (const e of diff.addedEdges) {
    await tx.putEdge({
      predicate: e.predicate,
      subject: { kind: 'atom', atomId: e.subjectId },
      object: { kind: 'atom', atomId: e.objectId },
      attrs: { createdBy: 'user-default', createdAt: now },
    });
  }
}

export async function createNote(
  initialDoc: NoteDocEnvelope | null = null,
  folderId: string | null = null,
): Promise<NoteInfo> {
  const pmDoc = initialDoc ? unwrapPmDoc(initialDoc) : unwrapPmDoc(emptyNoteDoc());

  // 给所有顶层 block 注入 id(若 caller 已带 id 字面保留;若无 id 字面注入)
  // 注:这里走 capability 层的简化注入(不走 PM appendTransaction),与
  // buildAutoBlockIdPlugin 字面同效;Stage 6 migration 也走此路径。
  const docWithIds = injectIdsForCreate(pmDoc);

  const txStart = Date.now();
  // 预算 title 缓存到 container payload,免去 listNotes 时 assemble
  const cachedTitle = deriveTitle(docWithIds);
  return storage.transaction(async (tx) => {
    // 1. 创建 container atom(payload = empty doc + cached title)
    const containerAtom = await tx.putAtom<'pm'>({
      payload: { domain: NOTE_DOMAIN, payload: containerPayloadWithTitle(cachedTitle) },
    });
    const now = Date.now();

    // 2. hasNoteView marker 边(沿 decision 016 §3.1 / §3.4 标记 note container)
    await tx.putEdge({
      predicate: HAS_NOTE_VIEW_PREDICATE,
      subject: { kind: 'atom', atomId: containerAtom.id },
      object: { kind: 'literal', type: 'boolean', value: true },
      attrs: { createdBy: 'user-default', createdAt: now },
    });

    // 3. inFolder 边(若指定)
    if (folderId) {
      await tx.putEdge({
        predicate: IN_FOLDER_PREDICATE,
        subject: { kind: 'atom', atomId: containerAtom.id },
        object: { kind: 'atom', atomId: folderId },
        attrs: { createdBy: 'user-default', createdAt: now },
      });
    }

    // 4. 拆解 + 写 block atoms + 边(走 fullCreateDiff 字面把 newDoc 全当 added)
    const diff = fullCreateDiff(docWithIds, containerAtom.id);

    // 诊断:大文档导入丢数据排查(2026-05-27)— 打印事务规模,
    // 用户重启后丢一半时可对照 log 看是哪批 atom/edge 写入失败
    const blockCount = diff.added.length;
    const edgeCount = diff.addedEdges.length;
    if (blockCount > 50) {
      console.log(
        `[note-capability/createNote] LARGE container=${containerAtom.id.slice(-8)} folder=${folderId ?? 'root'} blocks=${blockCount} edges=${edgeCount}`,
      );
    }

    await applyDiff(diff, tx);

    const elapsed = Date.now() - txStart;
    if (blockCount > 50 || elapsed > 500) {
      console.log(
        `[note-capability/createNote] container=${containerAtom.id.slice(-8)} blocks=${blockCount} edges=${edgeCount} tx=${elapsed}ms`,
      );
    }

    // 5. cache + 返回(用 newDoc 字面作为 assembled — 因 dissect ↔ assemble 字面 round-trip
    //    幂等,这里跳过实际 assemble 节省一次 listEdges round-trip)
    pmDocCache.set(containerAtom.id, docWithIds);
    return buildNoteInfo(containerAtom, docWithIds, folderId);
  }).catch((err) => {
    const elapsed = Date.now() - txStart;
    // 关键:事务整体抛错时升级到 error 让用户在 terminal 一眼看到
    console.error(
      `[note-capability/createNote] TX FAILED folder=${folderId ?? 'root'} tx=${elapsed}ms:`,
      err,
    );
    throw err; // 抛出去让 markdown-import 走 skipped 路径
  });
}

/**
 * 给 PM doc 递归注入 attrs.id(字面规则同 buildAutoBlockIdPlugin):
 * - 结构性容器(table/tableRow/3 list 容器/columnList)不注入
 * - 已有 id 字面保留
 * - 其它 group='block' 节点字面注入新 ULID
 *
 * 注:Stage 1 已 commit 的 plugin 是 PM transaction 内运行;capability 层 createNote /
 * migration 字面绕开 PM 层操作 PmPayload(纯 JSON),所以需独立一份 inject 逻辑。
 *
 * 字面降级:这里**仅**为 createNote 字面 doc(用户传 initialDoc 时 caller 已经过 PM,
 * 通常 doc 已有 id;空文档场景字面只首段 paragraph 需要注入)。
 */
function injectIdsForCreate(doc: PmPayload): PmPayload {
  const STRUCTURAL = new Set([
    'table',
    'tableRow',
    'bulletList',
    'orderedList',
    'taskList',
    'columnList',
  ]);

  function visit(node: PmPayload): PmPayload {
    const out: PmPayload = { type: node.type };
    if (node.attrs !== undefined) out.attrs = { ...node.attrs };
    if (node.marks !== undefined) out.marks = node.marks;
    if (node.text !== undefined) out.text = node.text;
    if (Array.isArray(node.content)) {
      out.content = node.content.map(visit);
    }
    // 给非结构性容器、且 attrs 内有 id 字段(即 Stage 1 加 id 的 22 NodeSpec)、
    // 但 attrs.id 为 null/undefined 的 block 注入
    if (!STRUCTURAL.has(node.type) && out.attrs && 'id' in out.attrs) {
      if (!out.attrs.id) {
        out.attrs.id = generateUlid();
      }
    }
    return out;
  }
  return visit(doc);
}

export async function listNotes(): Promise<NoteInfo[]> {
  // sub-phase 1 后 pm domain 不再是 note 专属(canvas-store 也用),
  // 故必须叠加 hasNoteView 边过滤区分 note 与 block atom / graph text-node / reading-thought
  const atoms = (await storage.listAtoms({ domain: NOTE_DOMAIN })) as AtomEntity<'pm'>[];
  const noteViewEdges = await storage.listEdges({ predicate: HAS_NOTE_VIEW_PREDICATE });
  const noteAtomIds = new Set<string>(noteViewEdges.map((e) => e.subject.atomId));
  const folderEdges = await storage.listEdges({ predicate: IN_FOLDER_PREDICATE });
  const folderBySubject = new Map<string, string>();
  for (const e of folderEdges) {
    if (e.object.kind === 'atom') {
      folderBySubject.set(e.subject.atomId, e.object.atomId);
    }
  }

  // 字面只对 hasNoteView marker 的 atom 字面 build NoteInfo;
  // 字面跳过 block atom(那些 listAtoms 也返回了但不是 note container)
  const noteAtoms = atoms.filter((a) => noteAtomIds.has(a.id));

  // 串行(for await)避免 SurrealDB ws 雪崩(2026-05-28 实测 Promise.all 92 路
  // 并发触发 NotAllowed auth crash);代价是首次冷启动 N 篇 × 200ms 量级,
  // 后续走 pmDocCache 命中即快路径。
  const results: NoteInfo[] = [];
  for (const atom of noteAtoms) {
    const folderId = folderBySubject.get(atom.id) ?? null;
    const cached = pmDocCache.get(atom.id);
    const assembled = cached ?? (await assemblePmDoc(atom.id));
    if (!assembled) {
      console.warn(
        `[note-capability/listNotes] assemble failed for ${atom.id}, fallback empty doc`,
      );
      results.push({
        id: atom.id,
        title: '未命名',
        doc: wrapPmDoc(emptyContainerPayload()),
        folderId,
        createdAt: atom.createdAt,
        updatedAt: atom.updatedAt,
      });
      continue;
    }
    if (!cached) pmDocCache.set(atom.id, assembled);
    results.push(buildNoteInfo(atom, assembled, folderId));
  }

  return results;
}

/**
 * 轻量 list — 只返 id/title/folderId,不 assemble doc。
 *
 * 2026-05-28 性能修复(经历两轮迭代):
 * - V1 lazy backfill 路径 fire-and-forget putAtom × N 篇,SurrealDB ws 雪崩 → auth crash
 * - V2 改:**串行**遍历(避免 ws in-flight 风暴),命中 attrs.title 缓存即返,
 *        老数据缓存缺失 → assemble + deriveTitle 但**不写回**,由
 *        runColdStartTitleBackfill() 在 init 期单独做。
 *
 * markdown-import / extraction-import 等只为去重读 title+folderId 的场景用本 API。
 */
export async function listNoteTitles(): Promise<Array<{
  id: string;
  title: string;
  folderId: string | null;
}>> {
  const atoms = (await storage.listAtoms({ domain: NOTE_DOMAIN })) as AtomEntity<'pm'>[];
  const noteViewEdges = await storage.listEdges({ predicate: HAS_NOTE_VIEW_PREDICATE });
  const noteAtomIds = new Set<string>(noteViewEdges.map((e) => e.subject.atomId));
  const folderEdges = await storage.listEdges({ predicate: IN_FOLDER_PREDICATE });
  const folderBySubject = new Map<string, string>();
  for (const e of folderEdges) {
    if (e.object.kind === 'atom') {
      folderBySubject.set(e.subject.atomId, e.object.atomId);
    }
  }

  const noteAtoms = atoms.filter((a) => noteAtomIds.has(a.id));

  // 若有 note 缺缓存且 migration 023 正在跑 → 等它完成再走 fallback;
  // 否则两边并发同时 assemble + putAtom 会触发 ws 雪崩
  const hasUncached = noteAtoms.some((a) => readCachedTitle(a.payload.payload) === null);
  if (hasUncached) {
    await waitForTitleBackfill();
    // backfill 完成后重新拉 atoms(payload 已更新)
    const refreshed = (await storage.listAtoms({ domain: NOTE_DOMAIN })) as AtomEntity<'pm'>[];
    noteAtoms.length = 0;
    for (const a of refreshed) {
      if (noteAtomIds.has(a.id)) noteAtoms.push(a);
    }
  }

  // 串行(for await)避免 SurrealDB ws 雪崩,代价是首次冷启动 N 篇老 note 慢
  const out: Array<{ id: string; title: string; folderId: string | null }> = [];
  for (const atom of noteAtoms) {
    const folderId = folderBySubject.get(atom.id) ?? null;
    const cachedTitle = readCachedTitle(atom.payload.payload);
    if (cachedTitle !== null) {
      out.push({ id: atom.id, title: cachedTitle, folderId });
      continue;
    }

    // backfill 跑完后仍缺(migration 中失败的) — 走 fallback assemble,不写回
    const cached = pmDocCache.get(atom.id);
    const assembled = cached ?? (await assemblePmDoc(atom.id));
    if (!assembled) {
      out.push({ id: atom.id, title: '未命名', folderId });
      continue;
    }
    if (!cached) pmDocCache.set(atom.id, assembled);
    out.push({ id: atom.id, title: deriveTitle(assembled), folderId });
  }

  return out;
}

export async function getNote(id: string): Promise<NoteInfo | null> {
  const atom = await storage.getAtom<'pm'>(id);
  if (!atom) return null;
  if (atom.payload.domain !== NOTE_DOMAIN) return null;

  // hasNoteView marker 防御性 filter(decision 016 §3.4)— 防止上层用 graph text-node /
  // block atom / reading-thought 的 atom id 调 getNote 拿到 "note" 假阳性
  const noteViewEdges = await storage.listEdges({
    predicate: HAS_NOTE_VIEW_PREDICATE,
    subjectAtomId: id,
    limit: 1,
  });
  if (noteViewEdges.length === 0) return null;

  const folderId = await getFolderIdForNote(id);

  // 字面拼装(cache 命中直接用)
  const cached = pmDocCache.get(id);
  const assembled = cached ?? (await assemblePmDoc(id));
  if (!assembled) {
    console.warn(`[note-capability/getNote] assemble failed for ${id}, returning null`);
    return null;
  }
  if (!cached) pmDocCache.set(id, assembled);

  return buildNoteInfo(atom, assembled, folderId);
}

export async function updateNote(
  id: string,
  doc: NoteDocEnvelope,
): Promise<NoteInfo | null> {
  const newDoc = unwrapPmDoc(doc);

  // 字面拿 container atom — D-10:不要求 hasNoteView,reading-thought 也走这里
  const containerAtom = await storage.getAtom<'pm'>(id);
  if (!containerAtom) {
    console.warn(`[note-capability/updateNote] container atom ${id} not found`);
    return null;
  }
  if (containerAtom.payload.domain !== NOTE_DOMAIN) {
    console.warn(
      `[note-capability/updateNote] atom ${id} domain=${containerAtom.payload.domain}, not 'pm'`,
    );
    return null;
  }

  // 字面取 oldDoc 基线 — cache 命中字面用,否则 assemble
  const oldDoc =
    pmDocCache.get(id) ?? (await assemblePmDoc(id)) ?? emptyContainerPayload();

  const diff = diffBlockTree(oldDoc, newDoc, id);

  // 字面 transaction:apply diff + 更新 container payload(刷 title 缓存 + updatedAt)
  const newCachedTitle = deriveTitle(newDoc);
  const updatedContainer = await storage.transaction(async (tx) => {
    await applyDiff(diff, tx);
    const refreshed = await tx.putAtom<'pm'>({
      id,
      payload: { domain: NOTE_DOMAIN, payload: containerPayloadWithTitle(newCachedTitle) },
    });
    return refreshed;
  });

  pmDocCache.set(id, newDoc);
  const folderId = await getFolderIdForNote(id);
  return buildNoteInfo(updatedContainer, newDoc, folderId);
}

export async function moveNote(
  noteId: string,
  newFolderId: string | null,
): Promise<void> {
  await storage.transaction(async (tx) => {
    const oldEdges = await storage.listEdges({
      predicate: IN_FOLDER_PREDICATE,
      subjectAtomId: noteId,
    });
    for (const e of oldEdges) {
      await tx.deleteEdge(e.id);
    }
    if (newFolderId) {
      await tx.putEdge({
        predicate: IN_FOLDER_PREDICATE,
        subject: { kind: 'atom', atomId: noteId },
        object: { kind: 'atom', atomId: newFolderId },
        attrs: { createdBy: 'user-default', createdAt: Date.now() },
      });
    }
  });
}

export async function deleteNote(id: string): Promise<{ cascadedEdges: number }> {
  // 单引用模式下 hasBeenReferenced 恒 false,本 sub-phase 只实施草稿分支
  // (decision 016 §3.5)。
  const atom = await storage.getAtom<'pm'>(id);
  if (atom?.hasBeenReferenced === true) {
    console.error(
      `[noteCapability.deleteNote] pm atom ${id} hasBeenReferenced=true ` +
        `not supported in sub-phase 3a-2.5 (single-ref mode); ` +
        `falling back to draft branch (will cascade delete pm atom).`,
    );
  }

  // L7 block atomization:先删所有 block atom(by belongsToNote.object=id),
  // 然后删 container atom(级联删 hasNoteView / inFolder 边)
  const belongsEdges = await storage.listEdges({
    predicate: BELONGS_TO_NOTE_PREDICATE,
    objectAtomId: id,
  });
  let cascadedEdges = 0;
  await storage.transaction(async (tx) => {
    for (const e of belongsEdges) {
      const res = await tx.deleteAtom(e.subject.atomId);
      cascadedEdges += res.cascadedEdges;
    }
    const containerRes = await tx.deleteAtom(id);
    cascadedEdges += containerRes.cascadedEdges;
  });

  pmDocCache.invalidate(id);
  return { cascadedEdges };
}

/** main 进程内部使用(非 IPC)— 给 extraction handlers 提供同进程直调入口 */
export { wrapPmDoc, unwrapPmDoc, emptyNoteDoc };
