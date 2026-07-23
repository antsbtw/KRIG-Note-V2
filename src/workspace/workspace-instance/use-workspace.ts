/**
 * useWorkspace hooks（S3-a 改造）
 *
 * 状态来源：主进程广播的 WorkspaceManagerState 快照（不再直接读 workspaceManager）。
 *
 * 多窗口（S3-b）：每个 renderer 进程在启动时通过 WINDOW_WS_ID IPC 收到自己绑定的 wsId，
 * 存入 myWsId。getActiveWorkspaceIdSync() 优先返回 myWsId，
 * 避免多窗口时所有 renderer 共享同一 snapshot.activeId 而认错自己。
 */

import { useSyncExternalStore } from 'react';
import { onWorkspaceStateChanged, ipcWorkspaceGetState } from '../ipc/workspace-ipc';
import type { WorkspaceState, WorkspaceManagerState } from '../workspace-state/workspace-state';
import { workspaceManager } from '../workspace-state/workspace-manager';

// ── 多窗口：本 renderer 进程绑定的 wsId ──────────────────────────
// 主进程在 loadURL 后立即 send('window.ws-id', wsId)；
// 首窗口（无显式 wsId）此值保持 null，回退到 snapshot.activeId。
let myWsId: string | null = null;

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

/** 订阅本窗口 myWsId 就绪事件（仅触发一次）。
 *  用于命令注册等需要在确认本窗口 wsId 后才能执行的逻辑。*/
const _myWsIdListeners = new Set<(id: string) => void>();
export function onMyWsIdReady(cb: (id: string) => void): () => void {
  ensureInit();  // 触发 IPC 拉取，否则 myWsId 永远不会就绪
  // 若 myWsId 已就绪，立即同步调用
  if (myWsId) { cb(myWsId); return () => {}; }
  _myWsIdListeners.add(cb);
  return () => _myWsIdListeners.delete(cb);
}

// 订阅主进程广播（模块加载时一次，全局单次）
let initialized = false;
function ensureInit(): void {
  if (initialized) return;
  initialized = true;

  // 多窗口：两条路径获取本窗口 wsId，以解决 loadURL 完成与 preload 监听注册之间的竞态
  const electronAPI = (window as unknown as {
    electronAPI?: {
      onWindowWsId?: (cb: (id: string) => void) => () => void;
      getWindowWsId?: () => Promise<string | null>;
    };
  }).electronAPI;

  const applyWsId = (id: string | null) => {
    if (!id || myWsId) return;  // 已设置则忽略（两条路径幂等）
    myWsId = id;
    notifyListeners();
    // 通知等待本窗口 wsId 的一次性监听器（如命令注册）
    _myWsIdListeners.forEach((cb) => cb(id));
    _myWsIdListeners.clear();
  };

  // push 路径（极少见，作为兜底保留）
  if (electronAPI?.onWindowWsId) {
    const unsub = electronAPI.onWindowWsId((id) => { applyWsId(id); unsub(); });
  }

  const applyState = (state: WorkspaceManagerState): void => {
    snapshot = state;
    // 同步填充 renderer 本地 workspaceManager（房客 API get/update 依赖此 Map）
    const incomingIds = new Set(state.workspaces.map((ws) => ws.id));
    // 先删除主进程已移除的 ws，再 restore 存活的
    workspaceManager.getAll()
      .filter((ws) => !incomingIds.has(ws.id))
      .forEach((ws) => workspaceManager.remove(ws.id));
    state.workspaces.forEach((ws) => workspaceManager.restore(ws));
    notifyListeners();
  };

  // 同时等待 workspace 全量状态和本窗口 wsId（两者都必须就绪才处理）
  // 所有窗口（含首窗口）主进程均显式传入 wsId，getWindowWsId() 不应返回 null
  void Promise.all([
    ipcWorkspaceGetState(),
    electronAPI?.getWindowWsId?.() ?? Promise.resolve(null),
  ]).then(([state, winWsId]) => {
    applyState(state);
    if (winWsId) {
      applyWsId(winWsId);
    } else {
      // getWindowWsId() 返回 null 说明主进程未给本窗口分配 wsId，属于配置错误，fail loud
      console.error('[use-workspace] getWindowWsId() returned null — window has no wsId. Commands will not be registered.');
    }
  });
  // 订阅主进程广播（ws 创建/删除/切换等楼长操作）
  onWorkspaceStateChanged(applyState);
  // 订阅本地 workspaceManager 变化（pluginStates/slotBinding 等房客操作）
  workspaceManager.subscribe(() => {
    snapshot = {
      ...snapshot,
      workspaces: workspaceManager.getAll(),
    };
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

/** 同步读本窗口 ws ID（多窗口：优先 myWsId，回退 snapshot.activeId；供命令 getWsId getter 用，非 hook）*/
export function getActiveWorkspaceIdSync(): string | null {
  ensureInit();
  return myWsId ?? snapshot.activeId;
}

/** 仅返回本窗口通过 IPC 确认的 wsId（不回退 snapshot.activeId）。
 *  命令注册等只能在本窗口 wsId 确定后执行的逻辑应使用此函数做守卫。*/
export function getMyWsId(): string | null {
  return myWsId;
}
