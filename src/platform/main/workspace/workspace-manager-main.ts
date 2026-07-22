/**
 * 主进程楼长 —— WorkspaceManager 主进程侧
 *
 * 职责：ws 的生老病死（create/close/remove/open/rename/setActive）。
 * 持久化：SurrealDB workspace 表单记录快照（rid='current'）。
 * 广播：状态变化后向所有 renderer 窗口广播 WORKSPACE_STATE_CHANGED。
 *
 * S3-b：从 JSON 文件换成 SurrealDB（schema 1.7.0）。
 */

import { BrowserWindow } from 'electron';
import { RecordId } from 'surrealdb';
import { getDB } from '@storage/surreal/client';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { createDefaultWorkspaceState } from '@workspace/workspace-state/default-state';
import type { WorkspaceState, WorkspaceManagerState } from '@workspace/workspace-state/workspace-state';

// ── 状态 ────────────────────────────────────────────────────────

let workspaces = new Map<string, WorkspaceState>();
let activeId: string | null = null;
let counter = 0;

// ── 持久化（SurrealDB）──────────────────────────────────────────

const WS_RECORD_ID = new RecordId('workspace', 'current');

async function loadStateFromDB(): Promise<WorkspaceManagerState | null> {
  try {
    const db = getDB();
    const result = await db.query<[Array<WorkspaceManagerState>]>(
      `SELECT * FROM $rid LIMIT 1`,
      { rid: WS_RECORD_ID },
    );
    return result[0]?.[0] ?? null;
  } catch (err) {
    console.warn('[workspace-manager-main] loadStateFromDB failed:', err);
    return null;
  }
}

async function persistState(state: WorkspaceManagerState): Promise<void> {
  try {
    const db = getDB();
    await db.query(
      `UPSERT $rid SET workspaces = $workspaces, activeId = $activeId, counter = $counter`,
      {
        rid: WS_RECORD_ID,
        workspaces: state.workspaces,
        activeId: state.activeId,
        counter: state.counter,
      },
    );
  } catch (err) {
    console.error('[workspace-manager-main] persistState failed:', err);
  }
}

// ── 广播 ────────────────────────────────────────────────────────

async function broadcast(): Promise<void> {
  const state = getFullState();
  // 持久化（异步，不阻塞广播）
  void persistState(state);
  // 广播（同步）
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

export async function initWorkspaceManager(): Promise<void> {
  const saved = await loadStateFromDB();
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
  void broadcast();
  return ws;
}

export function wsClose(id: string): void {
  const ws = workspaces.get(id);
  if (!ws || !ws.isOpen) return;
  workspaces.set(id, { ...ws, isOpen: false });
  if (activeId === id) activateAnotherOpen();
  void broadcast();
}

export function wsRemove(id: string): void {
  if (!workspaces.has(id)) return;
  workspaces.delete(id);
  if (activeId === id) activateAnotherOpen();
  void broadcast();
}

export function wsOpen(id: string): void {
  const ws = workspaces.get(id);
  if (!ws || ws.isOpen) return;
  workspaces.set(id, { ...ws, isOpen: true });
  void broadcast();
}

export function wsRename(id: string, label: string): void {
  const ws = workspaces.get(id);
  if (!ws) return;
  workspaces.set(id, { ...ws, label, customLabel: true });
  void broadcast();
}

export function wsSetActive(id: string): void {
  if (!workspaces.has(id)) return;
  activeId = id;
  void broadcast();
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
