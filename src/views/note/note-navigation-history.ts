/**
 * 笔记导航历史栈(L5-B3.4)
 *
 * V1 同款:全局单一栈,Cmd+[ 后退 / Cmd+] 前进
 *
 * 简化:不调 IPC(V1 用 viewAPI.noteOpenInEditor),直接调 setActiveNote 切当前 ws
 *
 * 设计点(对齐 [feedback_v2_is_workspace_v1_is_reference.md] 决策 Q6=A):
 * - 全局单栈(不是 per-ws),用户体验更直观
 * - 跨 ws 跳转留 ActiveResourceManager 抽象后补
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { setActiveNote } from './data-model';

interface NavigationHistory {
  back: string[];
  forward: string[];
  current: string | null;
}

const history: NavigationHistory = {
  back: [],
  forward: [],
  current: null,
};

/**
 * 同步当前 note id(NoteView 加载笔记时调,保持栈跟实际打开的笔记一致)
 *
 * 注:这只更新 history.current,不推进 back 栈 — 跟 navigateToNote 区分。
 */
export function setCurrentNoteId(noteId: string | null): void {
  history.current = noteId;
}

export function getCurrentNoteId(): string | null {
  return history.current;
}

export function canGoBack(): boolean {
  return history.back.length > 0;
}

export function canGoForward(): boolean {
  return history.forward.length > 0;
}

/**
 * 导航到新笔记(用户主动跳转 — 推 back 栈,清 forward)
 *
 * 调用方式:link 点击 / NavSide 选择笔记 等
 */
export function navigateToNote(noteId: string): void {
  if (history.current === noteId) return;
  if (history.current) history.back.push(history.current);
  history.forward = []; // 新导航清空前进栈
  history.current = noteId;
}

/**
 * 后退:把当前推 forward 栈,从 back 栈取上一个
 *
 * 内部直接 setActiveNote 切当前 ws(降级 V1 noteOpenInEditor IPC)。
 */
export function goBack(): string | null {
  if (history.back.length === 0) return null;
  if (history.current) history.forward.push(history.current);
  const prev = history.back.pop()!;
  history.current = prev;
  applyToActiveWs(prev);
  return prev;
}

export function goForward(): string | null {
  if (history.forward.length === 0) return null;
  if (history.current) history.back.push(history.current);
  const next = history.forward.pop()!;
  history.current = next;
  applyToActiveWs(next);
  return next;
}

function applyToActiveWs(noteId: string): void {
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return;
  setActiveNote(wsId, noteId);
}

/** 给诊断 / 测试用 */
export function getNoteHistorySnapshot(): {
  back: string[];
  forward: string[];
  current: string | null;
} {
  return {
    back: [...history.back],
    forward: [...history.forward],
    current: history.current,
  };
}
