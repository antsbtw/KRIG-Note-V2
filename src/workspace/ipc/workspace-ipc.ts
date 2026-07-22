/**
 * Renderer 侧 workspace IPC 桥（S3-a）
 *
 * 封装 electronAPI.workspace* 调用，提供类型安全接口。
 * 调用方：use-workspace.ts（hook）、WorkspaceTab、AddWorkspaceButton、nav-side-content
 */

import type { WorkspaceState, WorkspaceManagerState } from '../workspace-state/workspace-state';

const api = () => window.electronAPI;

export function ipcWorkspaceCreate(label?: string): Promise<WorkspaceState> {
  return api().workspaceCreate(label) as Promise<WorkspaceState>;
}
export function ipcWorkspaceClose(id: string): Promise<void> {
  return api().workspaceClose(id) as Promise<void>;
}
export function ipcWorkspaceRemove(id: string): Promise<void> {
  return api().workspaceRemove(id) as Promise<void>;
}
export function ipcWorkspaceOpen(id: string): Promise<void> {
  return api().workspaceOpen(id) as Promise<void>;
}
export function ipcWorkspaceRename(id: string, label: string): Promise<void> {
  return api().workspaceRename(id, label) as Promise<void>;
}
export function ipcWorkspaceSetActive(id: string): Promise<void> {
  return api().workspaceSetActive(id) as Promise<void>;
}
export function ipcWorkspaceGetState(): Promise<WorkspaceManagerState> {
  return api().workspaceGetState() as Promise<WorkspaceManagerState>;
}
export function onWorkspaceStateChanged(
  callback: (state: WorkspaceManagerState) => void,
): () => void {
  return api().onWorkspaceStateChanged(callback as (state: unknown) => void);
}
