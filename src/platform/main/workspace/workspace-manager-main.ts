/**
 * 主进程楼长 —— WorkspaceManager 主进程侧
 *
 * 职责：ws 的生老病死（create/close/remove/open/rename/setActive）。
 * 持久化：JSON 文件（userData 目录下 workspace-state.json），绕开 localStorage renderer-only 限制。
 * 广播：状态变化后向所有 renderer 窗口广播 WORKSPACE_STATE_CHANGED。
 *
 * S3-b 时换成 SurrealDB 持久化，接口不变。
 */

import path from 'node:path';
import fs from 'node:fs';
import { app, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { createDefaultWorkspaceState } from '@workspace/workspace-state/default-state';
import type { WorkspaceState, WorkspaceManagerState } from '@workspace/workspace-state/workspace-state';

// ── 持久化（JSON 文件）──────────────────────────────────────────

function getStatePath(): string {
  return path.join(app.getPath('userData'), 'workspace-state.json');
}

function loadState(): WorkspaceManagerState | null {
  try {
    const raw = fs.readFileSync(getStatePath(), 'utf-8');
    return JSON.parse(raw) as WorkspaceManagerState;
  } catch {
    return null;
  }
}

function saveState(state: WorkspaceManagerState): void {
  try {
    fs.writeFileSync(getStatePath(), JSON.stringify(state), 'utf-8');
  } catch (err) {
    console.error('[workspace-manager-main] saveState failed', err);
  }
}

// ── 状态 ────────────────────────────────────────────────────────

let workspaces = new Map<string, WorkspaceState>();
let activeId: string | null = null;
let counter = 0;

// ── 广播 ────────────────────────────────────────────────────────

function broadcast(): void {
  const state = getFullState();
  saveState(state);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.WORKSPACE_STATE_CHANGED, state);
    }
  }
}

// ── 公共 API ────────────────────────────────────────────────────

export function getFullState(): WorkspaceManagerState {
  return {
    workspaces: Array.from(workspaces.values()),
    activeId,
    counter,
  };
}

export function initWorkspaceManager(): void {
  const saved = loadState();
  if (saved) {
    saved.workspaces.forEach((ws) =>
      workspaces.set(ws.id, { ...ws, isOpen: ws.isOpen ?? true }),
    );
    activeId = saved.activeId;
    counter = saved.counter;
  }
  ensureMinimum();
}

export function wsCreate(label?: string): WorkspaceState {
  const id = `ws-${++counter}`;
  const ws = createDefaultWorkspaceState(id, label ?? `Workspace ${counter}`, !!label);
  workspaces.set(id, ws);
  broadcast();
  return ws;
}

export function wsClose(id: string): void {
  const ws = workspaces.get(id);
  if (!ws || !ws.isOpen) return;
  workspaces.set(id, { ...ws, isOpen: false });
  if (activeId === id) activateAnotherOpen();
  broadcast();
}

export function wsRemove(id: string): void {
  if (!workspaces.has(id)) return;
  workspaces.delete(id);
  if (activeId === id) activateAnotherOpen();
  broadcast();
}

export function wsOpen(id: string): void {
  const ws = workspaces.get(id);
  if (!ws || ws.isOpen) return;
  workspaces.set(id, { ...ws, isOpen: true });
  broadcast();
}

export function wsRename(id: string, label: string): void {
  const ws = workspaces.get(id);
  if (!ws) return;
  workspaces.set(id, { ...ws, label, customLabel: true });
  broadcast();
}

export function wsSetActive(id: string): void {
  if (!workspaces.has(id)) return;
  activeId = id;
  broadcast();
}

// ── 内部工具 ────────────────────────────────────────────────────

function activateAnotherOpen(): void {
  const open = Array.from(workspaces.values()).filter((w) => w.isOpen);
  if (open.length > 0) {
    activeId = open[open.length - 1].id;
  } else if (workspaces.size > 0) {
    // 全收起了，打开第一个
    const first = Array.from(workspaces.values())[0];
    workspaces.set(first.id, { ...first, isOpen: true });
    activeId = first.id;
  } else {
    // 全删了，新建一个
    wsCreate();
  }
}

function ensureMinimum(): void {
  if (workspaces.size === 0) {
    const ws = wsCreate();
    activeId = ws.id;
    return;
  }
  const open = Array.from(workspaces.values()).filter((w) => w.isOpen);
  if (open.length === 0) {
    const first = Array.from(workspaces.values())[0];
    workspaces.set(first.id, { ...first, isOpen: true });
    activeId = first.id;
  } else if (!activeId || !workspaces.get(activeId)?.isOpen) {
    activeId = open[0].id;
  }
}
