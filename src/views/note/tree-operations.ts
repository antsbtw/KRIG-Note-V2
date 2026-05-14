/**
 * tree-operations — FolderTree 业务操作(拖拽 / 批量删除 / 剪贴板深拷贝)
 *
 * L7-sub2 (decision 012):走 noteCapability + folderCapability,全部 async。
 *
 * 拖拽 / 删除 / 粘贴的状态刷新靠 IPC 广播 (NOTE_LIST_CHANGED / FOLDER_LIST_CHANGED)
 * 推送给 NavSide,本文件不需要本地 setState。
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { NoteCapabilityApi, NoteInfo } from '@capabilities/note/types';
import type { FolderCapabilityApi, FolderInfo } from '@capabilities/folder/types';
import {
  getNoteWsState,
  setSelectedIds,
  setClipboard,
  setFolderExpanded,
  deleteNote,
  deleteFolder,
} from './data-model';
import { decodeTreeId } from './tree-builder';

function noteCap(): NoteCapabilityApi {
  return requireCapabilityApi<NoteCapabilityApi>('note');
}
function folderCap(): FolderCapabilityApi {
  return requireCapabilityApi<FolderCapabilityApi>('folder');
}

// ── 拖拽 ──

/**
 * 拖拽 drop 业务:把多个 ids 移到 targetFolderId
 * - note → 改 folderId (走 noteCap().moveNote)
 * - folder → 改 parentId(防环:目标在源子树内时拒绝)
 * - 跨文件夹移动后,自动展开目标文件夹
 */
export async function handleDrop(
  workspaceId: string,
  draggedTreeIds: string[],
  targetFolderId: string | null,
): Promise<void> {
  let needExpand = false;

  // 拉一次当前 notes/folders 用作防环 + 当前 parentId 判断
  const [allNotes, allFolders] = await Promise.all([
    noteCap().listNotes(),
    folderCap().listFolders('note'),
  ]);
  const noteById = new Map(allNotes.map((n) => [n.id, n]));
  const folderById = new Map(allFolders.map((f) => [f.id, f]));

  for (const treeId of draggedTreeIds) {
    const { type, id } = decodeTreeId(treeId);
    if (type === 'note') {
      const note = noteById.get(id);
      if (note && note.folderId !== targetFolderId) {
        await noteCap().moveNote(id, targetFolderId);
        if (targetFolderId) needExpand = true;
      }
    } else {
      // folder
      const folder = folderById.get(id);
      if (!folder || folder.parentId === targetFolderId) continue;
      // 防环:目标在源子树内
      if (targetFolderId && isDescendantOf(folderById, targetFolderId, id)) continue;
      await folderCap().moveFolder(id, targetFolderId);
      if (targetFolderId) needExpand = true;
    }
  }

  if (needExpand && targetFolderId) {
    setFolderExpanded(workspaceId, targetFolderId, true);
  }
}

/** 检查 targetId 是否在 sourceId 的子树里(含自身)— 拖拽防环 */
function isDescendantOf(
  folderById: Map<string, FolderInfo>,
  targetId: string,
  sourceId: string,
): boolean {
  if (targetId === sourceId) return true;
  let current: string | null = targetId;
  // 沿 parentId 向上爬,若碰到 sourceId 即在子树内
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (current === sourceId) return true;
    const parent: string | null = folderById.get(current)?.parentId ?? null;
    current = parent;
  }
  return false;
}

// ── 批量删除 ──

export async function deleteSelected(workspaceId: string): Promise<void> {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const ids = getNoteWsState(ws).selectedIds;
  if (ids.size === 0) return;

  for (const treeId of ids) {
    const { type, id } = decodeTreeId(treeId);
    if (type === 'note') await deleteNote(id);
    else await deleteFolder(id);
  }
  setSelectedIds(workspaceId, new Set());
}

// ── 剪贴板深拷贝 ──

/** 复制单个 treeId 到剪贴板 */
export function copyToClipboard(workspaceId: string, treeId: string): void {
  const { type, id } = decodeTreeId(treeId);
  setClipboard(workspaceId, { type, id });
}

/** 粘贴到 targetFolderId(根级 = null)— Q9=A 深拷贝 */
export async function pasteFromClipboard(
  workspaceId: string,
  targetFolderId: string | null,
): Promise<void> {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const clip = getNoteWsState(ws).clipboard;
  if (!clip) return;

  const [allNotes, allFolders] = await Promise.all([
    noteCap().listNotes(),
    folderCap().listFolders('note'),
  ]);
  const noteById = new Map(allNotes.map((n) => [n.id, n]));
  const folderById = new Map(allFolders.map((f) => [f.id, f]));

  if (clip.type === 'note') {
    await pasteNote(noteById, clip.id, targetFolderId);
  } else {
    // folder 深拷贝(防环:不能粘到自己子树)
    if (targetFolderId && isDescendantOf(folderById, targetFolderId, clip.id)) return;
    await pasteFolderTree(noteById, folderById, clip.id, targetFolderId);
  }

  // 粘贴后展开目标
  if (targetFolderId) {
    setFolderExpanded(workspaceId, targetFolderId, true);
  }
}

async function pasteNote(
  noteById: Map<string, NoteInfo>,
  sourceNoteId: string,
  targetFolderId: string | null,
): Promise<void> {
  const src = noteById.get(sourceNoteId);
  if (!src) return;
  // 深拷贝 doc(JSON 序列化 / 反序列化最简单)
  const docCopy = JSON.parse(JSON.stringify(src.doc));
  await noteCap().createNote(docCopy, targetFolderId);
}

/** 递归拷贝 folder 树(folder 自身 + 所有子 folder + 所有内含笔记)*/
async function pasteFolderTree(
  noteById: Map<string, NoteInfo>,
  folderById: Map<string, FolderInfo>,
  sourceFolderId: string,
  targetParentId: string | null,
): Promise<void> {
  const src = folderById.get(sourceFolderId);
  if (!src) return;

  const newTitle = src.title.startsWith('副本 ') ? src.title : `副本 ${src.title}`;
  const newFolder = await folderCap().createFolder(newTitle, targetParentId, 'note');
  if (!newFolder) return;
  const newFolderId = newFolder.id;

  // 拷贝直属笔记(用快照 noteById,避免重入)
  for (const note of noteById.values()) {
    if (note.folderId === sourceFolderId) {
      const docCopy = JSON.parse(JSON.stringify(note.doc));
      await noteCap().createNote(docCopy, newFolderId);
    }
  }
  // 递归拷贝子 folder
  for (const f of folderById.values()) {
    if (f.parentId === sourceFolderId) {
      await pasteFolderTree(noteById, folderById, f.id, newFolderId);
    }
  }
}
