/**
 * tree-operations — FolderTree 业务操作(拖拽 / 批量删除 / 剪贴板深拷贝)
 *
 * 纯函数,无状态。
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { noteStore } from './note-store';
import { folderStore } from './folder-store';
import {
  getNoteWsState,
  setSelectedIds,
  setClipboard,
  setFolderExpanded,
  deleteNote,
  deleteFolder,
} from './data-model';
import { decodeTreeId } from './tree-builder';

// ── 拖拽 ──

/**
 * 拖拽 drop 业务:把多个 ids 移到 targetFolderId
 * - note → 改 folderId
 * - folder → 改 parentId(防环:目标在源子树内时拒绝)
 * - 跨文件夹移动后,自动展开目标文件夹
 */
export function handleDrop(
  workspaceId: string,
  draggedTreeIds: string[],
  targetFolderId: string | null,
): void {
  let needExpand = false;

  for (const treeId of draggedTreeIds) {
    const { type, id } = decodeTreeId(treeId);
    if (type === 'note') {
      const note = noteStore.get(id);
      if (note && note.folderId !== targetFolderId) {
        noteStore.update(id, { folderId: targetFolderId });
        if (targetFolderId) needExpand = true;
      }
    } else {
      // folder
      const folder = folderStore.get(id);
      if (!folder || folder.parentId === targetFolderId) continue;
      // 防环
      if (targetFolderId && folderStore.isDescendantOf(targetFolderId, id)) continue;
      folderStore.move(id, targetFolderId);
      if (targetFolderId) needExpand = true;
    }
  }

  if (needExpand && targetFolderId) {
    setFolderExpanded(workspaceId, targetFolderId, true);
  }
}

// ── 批量删除 ──

export function deleteSelected(workspaceId: string): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const ids = getNoteWsState(ws).selectedIds;
  if (ids.size === 0) return;

  for (const treeId of ids) {
    const { type, id } = decodeTreeId(treeId);
    if (type === 'note') deleteNote(id);
    else deleteFolder(id);
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
export function pasteFromClipboard(workspaceId: string, targetFolderId: string | null): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const clip = getNoteWsState(ws).clipboard;
  if (!clip) return;

  if (clip.type === 'note') {
    pasteNote(clip.id, targetFolderId);
  } else {
    // folder 深拷贝(防环:不能粘到自己子树)
    if (targetFolderId && folderStore.isDescendantOf(targetFolderId, clip.id)) return;
    pasteFolderTree(clip.id, targetFolderId);
  }

  // 粘贴后展开目标
  if (targetFolderId) {
    setFolderExpanded(workspaceId, targetFolderId, true);
  }
}

function pasteNote(sourceNoteId: string, targetFolderId: string | null): void {
  const src = noteStore.get(sourceNoteId);
  if (!src) return;
  // 深拷贝 doc(JSON 序列化 / 反序列化最简单)
  const docCopy = JSON.parse(JSON.stringify(src.doc));
  const newTitle = src.title.startsWith('副本 ') ? src.title : `副本 ${src.title}`;
  noteStore.create(docCopy, newTitle, targetFolderId);
}

/** 递归拷贝 folder 树(folder 自身 + 所有子 folder + 所有内含笔记)*/
function pasteFolderTree(sourceFolderId: string, targetParentId: string | null): void {
  const src = folderStore.get(sourceFolderId);
  if (!src) return;

  const newTitle = src.title.startsWith('副本 ') ? src.title : `副本 ${src.title}`;
  const newFolderId = folderStore.create(newTitle, targetParentId);

  // 拷贝直属笔记
  for (const note of noteStore.getAll()) {
    if (note.folderId === sourceFolderId) {
      const docCopy = JSON.parse(JSON.stringify(note.doc));
      noteStore.create(docCopy, note.title, newFolderId);
    }
  }
  // 递归拷贝子 folder
  for (const f of folderStore.getAll()) {
    if (f.parentId === sourceFolderId) {
      pasteFolderTree(f.id, newFolderId);
    }
  }
}
