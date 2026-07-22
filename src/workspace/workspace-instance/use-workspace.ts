/**
 * useWorkspace hooks（S3-a 改造）
 *
 * 状态来源：主进程广播的 WorkspaceManagerState 快照（不再直接读 workspaceManager）。
 */

import { useSyncExternalStore } from 'react';
import { onWorkspaceStateChanged, ipcWorkspaceGetState } from '../ipc/workspace-ipc';
import type { WorkspaceState, WorkspaceManagerState } from '../workspace-state/workspace-state';

// ── 模块级快照 ──────────────────────────────────────────────────

let snapshot: WorkspaceManagerState = { workspaces: [], activeId: null, counter: 0 };
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// 订阅主进程广播（模块加载时一次，全局单次）
let initialized = false;
function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  // 拉一次全量状态作为初始值
  void ipcWorkspaceGetState().then((state) => {
    snapshot = state;
    notifyListeners();
  });
  // 订阅广播
  onWorkspaceStateChanged((state) => {
    snapshot = state;
    notifyListeners();
  });
}

// ── 公共 hook ───────────────────────────────────────────────────

/** 订阅指定 Workspace，变化时重渲 */
export function useWorkspace(id: string | null): WorkspaceState | undefined {
  ensureInit();
  return useSyncExternalStore(
    subscribe,
    () => (id ? snapshot.workspaces.find((w) => w.id === id) : undefined),
  );
}

/** 订阅活跃 Workspace */
export function useActiveWorkspace(): WorkspaceState | undefined {
  ensureInit();
  return useSyncExternalStore(
    subscribe,
    () => snapshot.workspaces.find((w) => w.id === snapshot.activeId),
  );
}

/** 订阅所有 Workspace 列表（库，含未打开的；NavSide 工作空间区用）*/
export function useAllWorkspaces(): WorkspaceState[] {
  ensureInit();
  return useSyncExternalStore(subscribe, () => snapshot.workspaces);
}

/** 订阅在顶部 bar 打开的 Workspace（isOpen；顶部 bar / container 用）*/
export function useOpenWorkspaces(): WorkspaceState[] {
  ensureInit();
  return useSyncExternalStore(
    subscribe,
    () => snapshot.workspaces.filter((w) => w.isOpen),
  );
}

/** 订阅活跃 Workspace ID（返回字符串，避免对象比较问题）*/
export function useActiveWorkspaceId(): string | null {
  ensureInit();
  return useSyncExternalStore(subscribe, () => snapshot.activeId);
}
