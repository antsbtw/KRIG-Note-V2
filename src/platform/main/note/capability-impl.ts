/**
 * note capability — main 端实施 (decision 012 §3.4 §4.3 方案 A + 路径 Y)
 *
 * 边界:
 * - main 进程独占,直接 import @storage (合规:capability 层调 storage)
 * - renderer 通过 IPC 桥接到本文件 (src/capabilities/note/index.ts 薄包装)
 * - view ↔ capability:NoteInfo.doc = DriverSerialized 信封
 * - capability 内部 ↔ storage:裸 PmPayload (envelope.ts wrap/unwrap)
 *
 * 实施要点 (decision 012 §3.2 §3.3):
 * - atom domain='pm',payload = 裸 PmPayload (剥 driver 信封)
 * - note 归属 folder 用 user:krig:inFolder 边表达 (不存 folderId 字段)
 * - 一个 note 最多一条 outgoing inFolder 边
 * - title 派生自 doc.content[0] 首段文本,不存 atom payload
 * - moveNote = transaction(删旧 inFolder + 加新 inFolder)
 * - deleteNote = storage.deleteAtom (sub-phase 1 storage 已应用层级联)
 */

import { storage } from '@storage/index';
import type { AtomEntity } from '@semantic/types';
import type { NoteInfo, NoteDocEnvelope } from '@shared/ipc/note-folder-types';
import { deriveTitle } from './derive-title';
import { wrapPmDoc, unwrapPmDoc, emptyNoteDoc } from './envelope';

const NOTE_DOMAIN = 'pm';
const IN_FOLDER_PREDICATE = 'user:krig:inFolder';
const HAS_NOTE_VIEW_PREDICATE = 'user:krig:hasNoteView';

function atomToNoteInfo(
  atom: AtomEntity<'pm'>,
  folderId: string | null,
): NoteInfo {
  const pmDoc = atom.payload.payload;
  return {
    id: atom.id,
    title: deriveTitle(pmDoc),
    doc: wrapPmDoc(pmDoc),
    folderId,
    createdAt: atom.createdAt,
    updatedAt: atom.updatedAt,
  };
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

export async function createNote(
  initialDoc: NoteDocEnvelope | null = null,
  folderId: string | null = null,
): Promise<NoteInfo> {
  const pmDoc = initialDoc ? unwrapPmDoc(initialDoc) : unwrapPmDoc(emptyNoteDoc());
  return storage.transaction(async (tx) => {
    const atom = await tx.putAtom<'pm'>({
      payload: { domain: NOTE_DOMAIN, payload: pmDoc },
    });
    // 新 atom 由 putAtom 生成新 ULID,字面上不可能跟既有 hasNoteView 边冲突;
    // 一对一 cardinality 由 (decision 016 §3.1) "新 atom 天然单边 +
    // migration 幂等 + 未来产生点决议层契约" 三层保证,无需查重
    const now = Date.now();
    await tx.putEdge({
      predicate: HAS_NOTE_VIEW_PREDICATE,
      subject: { kind: 'atom', atomId: atom.id },
      object: { kind: 'literal', type: 'boolean', value: true },
      attrs: { createdBy: 'user-default', createdAt: now },
    });
    if (folderId) {
      await tx.putEdge({
        predicate: IN_FOLDER_PREDICATE,
        subject: { kind: 'atom', atomId: atom.id },
        object: { kind: 'atom', atomId: folderId },
        attrs: { createdBy: 'user-default', createdAt: now },
      });
    }
    return atomToNoteInfo(atom, folderId);
  });
}

export async function listNotes(): Promise<NoteInfo[]> {
  // 3 query 路径 (decision 016 §1.3 / §3.3):
  //   listAtoms domain=pm + listEdges hasNoteView + listEdges inFolder
  // sub-phase 3a-1 后 pm domain 不再是 note 专属 (canvas-store 也用),
  // 故必须叠加 hasNoteView 边过滤区分 note 与 graph text-node pm atom
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
  return atoms
    .filter((a) => noteAtomIds.has(a.id))
    .map((a) => atomToNoteInfo(a, folderBySubject.get(a.id) ?? null));
}

export async function getNote(id: string): Promise<NoteInfo | null> {
  const atom = await storage.getAtom<'pm'>(id);
  if (!atom) return null;
  if (atom.payload.domain !== NOTE_DOMAIN) return null;
  // 确认这个 pm atom 有 hasNoteView 边 (decision 016 §3.4) — 防御性编程,
  // 防止上层用 graph text-node 的 atom id 调 getNote 拿到 "note" 假阳性
  const noteViewEdges = await storage.listEdges({
    predicate: HAS_NOTE_VIEW_PREDICATE,
    subjectAtomId: id,
    limit: 1,
  });
  if (noteViewEdges.length === 0) return null;
  const folderId = await getFolderIdForNote(id);
  return atomToNoteInfo(atom, folderId);
}

export async function updateNote(
  id: string,
  doc: NoteDocEnvelope,
): Promise<NoteInfo> {
  const pmDoc = unwrapPmDoc(doc);
  const atom = await storage.putAtom<'pm'>({
    id,
    payload: { domain: NOTE_DOMAIN, payload: pmDoc },
  });
  const folderId = await getFolderIdForNote(id);
  return atomToNoteInfo(atom, folderId);
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
  // (decision 016 §3.5)。流通分支 (hasBeenReferenced=true 仅断 hasNoteView
  // 边) 留 sub-phase 3a-shared-ref,前置 sub-phase 3a-tx 解真原子性。
  const atom = await storage.getAtom<'pm'>(id);
  if (atom?.hasBeenReferenced === true) {
    // 单引用模式下不应触发;万一触发 (手工改库 / 未来 bug) 走 console.error
    // + fallback。不抛硬错误是为不破坏对外契约 (view 层 7+ 调用点
    // fire-and-forget,catch 不到也无法处理)
    console.error(
      `[noteCapability.deleteNote] pm atom ${id} hasBeenReferenced=true ` +
        `not supported in sub-phase 3a-2.5 (single-ref mode); ` +
        `falling back to draft branch (will cascade delete pm atom). ` +
        `If this is a multi-ref pm atom, data in other views may be lost. ` +
        `Track in sub-phase 3a-shared-ref.`,
    );
    // fallthrough 到草稿分支
  }
  // 草稿分支:storage.deleteAtom 应用层级联删 atom + 所有相关边
  // (inFolder + hasNoteView 都是 subject=该 atom,会被级联删)
  const result = await storage.deleteAtom(id);
  return { cascadedEdges: result.cascadedEdges };
}

/** main 进程内部使用 (非 IPC)— 给 extraction handlers 提供同进程直调入口 */
export { wrapPmDoc, unwrapPmDoc, emptyNoteDoc };
