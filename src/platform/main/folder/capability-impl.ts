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
import type { AtomEntity, FolderPayload } from '@semantic/types';
import type { FolderInfo } from '@shared/ipc/note-folder-types';

const FOLDER_DOMAIN = 'folder';
const IN_FOLDER_PREDICATE = 'user:krig:inFolder';

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
  parentFolderId: string | null = null,
): Promise<FolderInfo> {
  const payload: FolderPayload = { title };
  return storage.transaction(async (tx) => {
    const atom = await tx.putAtom<'folder'>({
      payload: { domain: FOLDER_DOMAIN, payload },
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

export async function listFolders(): Promise<FolderInfo[]> {
  const atoms = (await storage.listAtoms({ domain: FOLDER_DOMAIN })) as AtomEntity<'folder'>[];
  // 一次性查所有 inFolder 边,按 subject 索引
  const edges = await storage.listEdges({ predicate: IN_FOLDER_PREDICATE });
  const parentBySubject = new Map<string, string>();
  for (const e of edges) {
    if (e.object.kind === 'atom') {
      parentBySubject.set(e.subject.atomId, e.object.atomId);
    }
  }
  return atoms.map((a) => atomToFolderInfo(a, parentBySubject.get(a.id) ?? null));
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

export async function deleteFolder(id: string): Promise<{ cascadedEdges: number }> {
  // storage.deleteAtom 内部应用层 cascade delete inFolder 边 (sub-phase 1 已实施)
  const result = await storage.deleteAtom(id);
  return { cascadedEdges: result.cascadedEdges };
}
