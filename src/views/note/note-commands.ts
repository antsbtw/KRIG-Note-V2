/**
 * NoteView 命令注册
 *
 * L5-A 命令(create-note / delete-active / set-active)+ L5-B1 8 个新命令。
 * 见 docs/RefactorV2/stages/L5B1-folder-tree-design.md § 4.5。
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { textEditingDriverApi, type MarkName } from '@drivers/text-editing-driver';
import { handleMenuController } from '@slot/triggers/handle-menu-controller';
import { contextMenuController } from '@slot/triggers/context-menu-controller';
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

  // ── L5-B2:marks / heading / undo-redo(走 driver instance-registry) ──

  function withInstance(fn: (instanceId: string) => void): () => void {
    return () => {
      const wsId = workspaceManager.getActiveId();
      if (!wsId) return;
      // L5-A 约定:driver instanceId == workspaceId(一 workspace 一 NoteView)
      fn(wsId);
    };
  }

  function registerToggleMark(commandId: string, markName: MarkName): void {
    commandRegistry.register(commandId, withInstance((instanceId) => {
      textEditingDriverApi.toggleMark(instanceId, markName);
    }));
  }

  registerToggleMark('note-view.toggle-bold', 'bold');
  registerToggleMark('note-view.toggle-italic', 'italic');
  registerToggleMark('note-view.toggle-underline', 'underline');
  registerToggleMark('note-view.toggle-strike', 'strike');
  registerToggleMark('note-view.toggle-code', 'code');

  commandRegistry.register('note-view.set-heading-level', (level: unknown) => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const lvl = typeof level === 'number' ? level : null;
    textEditingDriverApi.setHeading(wsId, lvl);
  });

  // ── L5-B3.3:文字颜色 / 背景高亮(Plan C-1 缩水版 — 6 色循环;完整 ColorPicker UI 留 L5-B3.4)──

  // 对齐 V1 ColorPicker 文字色板(6 个常用色,covers 90% 用例;V1 完整 10 色留 L5-B3.4)
  const TEXT_COLOR_CYCLE = [
    '',           // default(移除色)
    '#9aa0a6',    // gray
    '#f5c518',    // yellow
    '#8ab4f8',    // blue
    '#ea4335',    // red
    '#34a853',    // green
  ];

  // 对齐 V1 highlight 色板(rgba 半透明,看着柔和)
  const HIGHLIGHT_COLOR_CYCLE = [
    '',                                  // default
    'rgba(154, 160, 166, 0.2)',          // gray
    'rgba(245, 197, 24, 0.2)',           // yellow
    'rgba(138, 180, 248, 0.2)',          // blue
    'rgba(234, 67, 53, 0.2)',            // red
    'rgba(52, 168, 83, 0.2)',            // green
  ];

  commandRegistry.register('note-view.cycle-text-color', withInstance((instanceId) => {
    const cur = textEditingDriverApi.getActiveTextColor(instanceId);
    const idx = TEXT_COLOR_CYCLE.indexOf(cur ?? '');
    const next = TEXT_COLOR_CYCLE[(idx + 1) % TEXT_COLOR_CYCLE.length];
    textEditingDriverApi.setTextColor(instanceId, next);
  }));

  commandRegistry.register('note-view.cycle-highlight', withInstance((instanceId) => {
    const cur = textEditingDriverApi.getActiveHighlight(instanceId);
    const idx = HIGHLIGHT_COLOR_CYCLE.indexOf(cur ?? '');
    const next = HIGHLIGHT_COLOR_CYCLE[(idx + 1) % HIGHLIGHT_COLOR_CYCLE.length];
    textEditingDriverApi.setHighlight(instanceId, next);
  }));

  commandRegistry.register('note-view.undo', withInstance((instanceId) => {
    textEditingDriverApi.undo(instanceId);
  }));

  commandRegistry.register('note-view.redo', withInstance((instanceId) => {
    textEditingDriverApi.redo(instanceId);
  }));

  // ── L5-B3.2:Turn Into 9 种类型(slash / handle / cm 三套命令)──

  type TurnTarget =
    | 'paragraph' | 'h1' | 'h2' | 'h3'
    | 'bullet-list' | 'ordered-list' | 'task-list'
    | 'blockquote' | 'code-block' | 'horizontal-rule'
    | 'callout';

  // ── slash:作用于光标当前 block(setHeading 走 selection)──
  function registerSlashTurn(commandId: string, target: TurnTarget): void {
    commandRegistry.register(commandId, withInstance((instanceId) => {
      textEditingDriverApi.clearSlashTrigger(instanceId);
      // slash 没有 pos 参数,作用于光标所在 block
      const ws = workspaceManager.get(instanceId);
      if (!ws) return;
      const result = textEditingDriverApi.resolveBlockAt(instanceId, { x: 0, y: 0 });
      // 用光标位置(driver api 没暴露 cursor pos,用 turnIntoSelection 替代)
      // 简化:直接走 driver api 内部 — 通过 setSelection 之前 PM state.selection.$from
      textEditingDriverApi.turnIntoSelection(instanceId, target);
      void ws;
      void result;
    }));
  }
  registerSlashTurn('note-view.slash-turn-paragraph', 'paragraph');
  registerSlashTurn('note-view.slash-turn-h1', 'h1');
  registerSlashTurn('note-view.slash-turn-h2', 'h2');
  registerSlashTurn('note-view.slash-turn-h3', 'h3');
  registerSlashTurn('note-view.slash-turn-bullet', 'bullet-list');
  registerSlashTurn('note-view.slash-turn-ordered', 'ordered-list');
  registerSlashTurn('note-view.slash-turn-task', 'task-list');
  registerSlashTurn('note-view.slash-turn-quote', 'blockquote');
  registerSlashTurn('note-view.slash-turn-code', 'code-block');
  registerSlashTurn('note-view.slash-turn-divider', 'horizontal-rule');
  registerSlashTurn('note-view.slash-turn-callout', 'callout');

  // ── handle:作用于 handleMenuController.state.pos 指向的 block ──
  function getHandlePos(): { instanceId: string; pos: number } | null {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return null;
    const state = handleMenuController.getState();
    if (typeof state.pos !== 'number') return null;
    return { instanceId: wsId, pos: state.pos };
  }

  function registerHandleTurn(commandId: string, target: TurnTarget): void {
    commandRegistry.register(commandId, () => {
      const ctx = getHandlePos();
      if (!ctx) return;
      textEditingDriverApi.turnIntoAt(ctx.instanceId, ctx.pos, target);
      handleMenuController.hide();
    });
  }
  registerHandleTurn('note-view.handle-turn-paragraph', 'paragraph');
  registerHandleTurn('note-view.handle-turn-h1', 'h1');
  registerHandleTurn('note-view.handle-turn-h2', 'h2');
  registerHandleTurn('note-view.handle-turn-h3', 'h3');
  registerHandleTurn('note-view.handle-turn-bullet', 'bullet-list');
  registerHandleTurn('note-view.handle-turn-ordered', 'ordered-list');
  registerHandleTurn('note-view.handle-turn-task', 'task-list');
  registerHandleTurn('note-view.handle-turn-quote', 'blockquote');
  registerHandleTurn('note-view.handle-turn-code', 'code-block');
  registerHandleTurn('note-view.handle-turn-callout', 'callout');

  commandRegistry.register('note-view.handle-copy-block', () => {
    const ctx = getHandlePos();
    if (!ctx) return;
    textEditingDriverApi.copyBlockAt(ctx.instanceId, ctx.pos);
    handleMenuController.hide();
  });

  commandRegistry.register('note-view.handle-delete-block', () => {
    const ctx = getHandlePos();
    if (!ctx) return;
    textEditingDriverApi.deleteBlockAt(ctx.instanceId, ctx.pos);
    handleMenuController.hide();
  });

  // ── context menu:从鼠标位置 resolveBlockAt ──
  function getCmBlockPos(): { instanceId: string; pos: number } | null {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return null;
    const state = contextMenuController.getState();
    const result = textEditingDriverApi.resolveBlockAt(wsId, { x: state.x, y: state.y });
    if (!result) return null;
    return { instanceId: wsId, pos: result.pos };
  }

  function registerCmTurn(commandId: string, target: TurnTarget): void {
    commandRegistry.register(commandId, () => {
      const ctx = getCmBlockPos();
      if (!ctx) return;
      textEditingDriverApi.turnIntoAt(ctx.instanceId, ctx.pos, target);
      contextMenuController.hide();
    });
  }
  registerCmTurn('note-view.cm-turn-paragraph', 'paragraph');
  registerCmTurn('note-view.cm-turn-h1', 'h1');
  registerCmTurn('note-view.cm-turn-h2', 'h2');
  registerCmTurn('note-view.cm-turn-h3', 'h3');
  registerCmTurn('note-view.cm-turn-bullet', 'bullet-list');
  registerCmTurn('note-view.cm-turn-ordered', 'ordered-list');
  registerCmTurn('note-view.cm-turn-task', 'task-list');
  registerCmTurn('note-view.cm-turn-quote', 'blockquote');
  registerCmTurn('note-view.cm-turn-code', 'code-block');
  registerCmTurn('note-view.cm-turn-callout', 'callout');

  commandRegistry.register('note-view.cm-delete-block', () => {
    const ctx = getCmBlockPos();
    if (!ctx) return;
    textEditingDriverApi.deleteBlockAt(ctx.instanceId, ctx.pos);
    contextMenuController.hide();
  });
}
