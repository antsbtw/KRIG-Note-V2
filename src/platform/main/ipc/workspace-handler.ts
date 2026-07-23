/**
 * Workspace 楼长 IPC handlers（S3-a）
 *
 * renderer 通过 invoke 委托楼长操作；main 执行后广播 state-changed 给所有 renderer。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import {
  wsCreate,
  wsClose,
  wsRemove,
  wsOpen,
  wsRename,
  wsSetActive,
  wsSetConfig,
  wsPersistState,
  getFullState,
} from '../workspace/workspace-manager-main';

export function registerWorkspaceHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_CREATE, (_event, _label?: string) => {
    return wsCreate();
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_CLOSE, (_event, id: string) => {
    wsClose(id);
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_REMOVE, (_event, id: string) => {
    wsRemove(id);
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_OPEN, (_event, id: string) => {
    wsOpen(id);
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_RENAME, (_event, id: string, label: string) => {
    wsRename(id, label);
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SET_ACTIVE, (_event, id: string) => {
    wsSetActive(id);
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SET_CONFIG, (_event, wsId: string, config: { color?: string; proxyId?: string | null; userAgent?: string | null }) => {
    wsSetConfig(wsId, config);
  });

  // renderer 启动时拉一次全量状态
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_GET_STATE, () => {
    return getFullState();
  });

  // renderer 回写布局 + pluginStates（单向 send，不广播避免循环）
  ipcMain.on(IPC_CHANNELS.WORKSPACE_PERSIST_STATE, (_event, wsId: string, patch: Record<string, unknown>) => {
    wsPersistState(wsId, patch);
  });
}
