/**
 * useWorkspace / useActiveWorkspace / useAllWorkspaces hooks
 *
 * 让 React 组件订阅 WorkspaceManager 状态变化(useSyncExternalStore 标准模式)。
 */

import { useSyncExternalStore } from 'react';
import { workspaceManager } from '../workspace-state/workspace-manager';
import type { WorkspaceState } from '../workspace-state/workspace-state';

/** 订阅指定 Workspace,变化时重渲 */
export function useWorkspace(id: string | null): WorkspaceState | undefined {
  return useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => (id ? workspaceManager.get(id) : undefined),
  );
}

/** 订阅活跃 Workspace */
export function useActiveWorkspace(): WorkspaceState | undefined {
  return useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => workspaceManager.getActive(),
  );
}

/** 订阅所有 Workspace 列表(库,含未打开的;NavSide 工作空间区用)*/
export function useAllWorkspaces(): WorkspaceState[] {
  return useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => workspaceManager.getAll(),
  );
}

/** 订阅在顶部 bar 打开的 Workspace(isOpen;顶部 bar / container 用)*/
export function useOpenWorkspaces(): WorkspaceState[] {
  return useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => workspaceManager.getOpen(),
  );
}

/** 订阅活跃 Workspace ID(返回字符串,避免对象比较问题)*/
export function useActiveWorkspaceId(): string | null {
  return useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => workspaceManager.getActiveId(),
  );
}
