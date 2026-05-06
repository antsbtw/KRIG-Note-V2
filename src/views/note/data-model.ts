/**
 * NoteView per-workspace 工作位状态(activeNoteId)管理
 *
 * 见 DESIGN.md v0.2.3 § 3。
 *
 * 用户数据(笔记池)走全局 [`note-store.ts`](./note-store.ts);
 * 本文件只管 **当前 Workspace 看哪条笔记** 这个 per-workspace 状态。
 *
 * 这是 v0.2.2 → v0.2.3 的根本调整:笔记从 pluginStates 提到全局 store,
 * pluginStates 只剩 activeNoteId(指针)。
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { WorkspaceState } from '@workspace/workspace-state/workspace-state';
import { noteStore } from './note-store';
import { createEmptyDoc, extractFirstParagraphText } from '@drivers/text-editing-driver';
import type { DriverSerialized } from '@drivers/text-editing-driver';

/** per-workspace 工作位状态 */
export interface NoteWorkspaceState {
  activeNoteId: string | null;
}

const STORE_KEY = 'note';

/** 冻结常量(避免 useSyncExternalStore 死循环 — L5-A 已踩过这条 bug)*/
const DEFAULT_WS_STATE: NoteWorkspaceState = Object.freeze({
  activeNoteId: null,
}) as NoteWorkspaceState;

export function getNoteWsState(ws: WorkspaceState): NoteWorkspaceState {
  return (ws.pluginStates[STORE_KEY] as NoteWorkspaceState | undefined) ?? DEFAULT_WS_STATE;
}

function writeWsState(workspaceId: string, ws: WorkspaceState, newState: NoteWorkspaceState): void {
  workspaceManager.update(workspaceId, {
    pluginStates: {
      ...ws.pluginStates,
      [STORE_KEY]: newState,
    },
  });
}

/** 标题派生:从 doc 第一段提取,空则 '未命名' */
export function deriveTitle(doc: DriverSerialized): string {
  const text = extractFirstParagraphText(doc);
  return text || '未命名';
}

/** 创建笔记(全局 store)+ 当前 ws 的 activeNoteId 设到新笔记 */
export function createNote(workspaceId: string): string | null {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return null;

  const id = noteStore.create(createEmptyDoc(), '未命名');
  writeWsState(workspaceId, ws, { activeNoteId: id });
  return id;
}

/** 更新笔记内容 / 标题(全局 store)*/
export function updateNote(noteId: string, patch: { doc?: DriverSerialized; title?: string }): void {
  noteStore.update(noteId, patch);
}

/** 删除笔记(全局 store)+ 各 Workspace activeNoteId 自动 fallback(Q-S4=A)*/
export function deleteNote(noteId: string): void {
  noteStore.delete(noteId);
  // 各 Workspace 如果当前活跃笔记是这条,清掉(NoteView 自动检测显占位)
  // L5-A 简化:不主动清,NoteView render 时检测 noteStore.has(activeNoteId) 处理
}

/** 设置当前 Workspace 的活跃笔记 */
export function setActiveNote(workspaceId: string, noteId: string | null): void {
  const ws = workspaceManager.get(workspaceId);
  if (!ws) return;
  const state = getNoteWsState(ws);
  if (state.activeNoteId === noteId) return;
  writeWsState(workspaceId, ws, { activeNoteId: noteId });
}
