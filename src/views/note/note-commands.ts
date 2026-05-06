/**
 * NoteView 命令注册
 *
 * L5-A 命令(create-note / delete-active / set-active)+ L5-B1 8 个新命令。
 * 见 docs/RefactorV2/stages/L5B1-folder-tree-design.md § 4.5。
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import {
  createNote,
  deleteNote,
  setActiveNote,
  getNoteWsState,
  createFolder,
  deleteFolder,
  cycleSortByTitle,
  cycleSortByDate,
  setSelectedIds,
} from './data-model';
import {
  copyToClipboard,
  pasteFromClipboard,
  deleteSelected,
} from './tree-operations';
import { decodeTreeId, encodeNoteId } from './tree-builder';

/** 确保 slotBinding.left = 'note-view' */
function ensureNoteViewActive(wsId: string): void {
  const ws = workspaceManager.get(wsId);
  if (!ws) return;
  if (ws.slotBinding.left === 'note-view') return;
  workspaceManager.update(wsId, {
    slotBinding: { ...ws.slotBinding, left: 'note-view' },
  });
}

export function registerNoteCommands(): void {
  // ── L5-A 命令(参数升级:create-note 加 folderId 可选)──

  commandRegistry.register('note-view.create-note', (folderId: unknown) => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const fid = typeof folderId === 'string' ? folderId : null;
    const noteId = createNote(wsId, fid);
    if (noteId) {
      // 选中新建笔记(单选)
      setSelectedIds(wsId, new Set([encodeNoteId(noteId)]));
    }
    ensureNoteViewActive(wsId);
  });

  commandRegistry.register('note-view.delete-active', () => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const ws = workspaceManager.get(wsId);
    if (!ws) return;
    const state = getNoteWsState(ws);
    // 优先批量删 selectedIds(L5-B1 多选支持)
    if (state.selectedIds.size > 0) {
      deleteSelected(wsId);
      return;
    }
    // fallback:删活跃笔记
    if (state.activeNoteId) deleteNote(state.activeNoteId);
  });

  commandRegistry.register('note-view.set-active', (noteId: unknown) => {
    if (typeof noteId !== 'string') return;
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    setActiveNote(wsId, noteId);
    ensureNoteViewActive(wsId);
  });

  // ── L5-B1 新命令 ──

  commandRegistry.register('note-view.create-folder', (parentId: unknown) => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const pid = typeof parentId === 'string' ? parentId : null;
    createFolder(wsId, pid);
    ensureNoteViewActive(wsId);
  });

  /** 删除单个 treeId(注意跟 delete-active 区分:这条按 treeId 精确删,不依赖 selectedIds)*/
  commandRegistry.register('note-view.delete-by-tree-id', (treeId: unknown) => {
    if (typeof treeId !== 'string') return;
    const { type, id } = decodeTreeId(treeId);
    if (type === 'note') deleteNote(id);
    else deleteFolder(id);
  });

  commandRegistry.register('note-view.copy-by-tree-id', (treeId: unknown) => {
    if (typeof treeId !== 'string') return;
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    copyToClipboard(wsId, treeId);
  });

  /** 粘贴到目标 folder(commandArg 可以是 folderId 字符串 / null)*/
  commandRegistry.register('note-view.paste', (targetFolderId: unknown) => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const fid = typeof targetFolderId === 'string' ? targetFolderId : null;
    pasteFromClipboard(wsId, fid);
  });

  commandRegistry.register('note-view.sort-cycle-title', (folderKey: unknown) => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const key = typeof folderKey === 'string' ? folderKey : '__root__';
    cycleSortByTitle(wsId, key);
  });

  commandRegistry.register('note-view.sort-cycle-date', (folderKey: unknown) => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const key = typeof folderKey === 'string' ? folderKey : '__root__';
    cycleSortByDate(wsId, key);
  });
}
