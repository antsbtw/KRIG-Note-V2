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
    if (folderId) {
      await tx.putEdge({
        predicate: IN_FOLDER_PREDICATE,
        subject: { kind: 'atom', atomId: atom.id },
        object: { kind: 'atom', atomId: folderId },
        attrs: { createdBy: 'user-default', createdAt: Date.now() },
      });
    }
    return atomToNoteInfo(atom, folderId);
  });
}

export async function listNotes(): Promise<NoteInfo[]> {
  const atoms = (await storage.listAtoms({ domain: NOTE_DOMAIN })) as AtomEntity<'pm'>[];
  // 一次性查所有 inFolder 边 (subject=note 的)
  const edges = await storage.listEdges({ predicate: IN_FOLDER_PREDICATE });
  const folderBySubject = new Map<string, string>();
  for (const e of edges) {
    if (e.object.kind === 'atom') {
      folderBySubject.set(e.subject.atomId, e.object.atomId);
    }
  }
  return atoms.map((a) => atomToNoteInfo(a, folderBySubject.get(a.id) ?? null));
}

export async function getNote(id: string): Promise<NoteInfo | null> {
  const atom = await storage.getAtom<'pm'>(id);
  if (!atom) return null;
  if (atom.payload.domain !== NOTE_DOMAIN) return null;
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
  const result = await storage.deleteAtom(id);
  return { cascadedEdges: result.cascadedEdges };
}

/** main 进程内部使用 (非 IPC)— 给 extraction handlers 提供同进程直调入口 */
export { wrapPmDoc, unwrapPmDoc, emptyNoteDoc };
