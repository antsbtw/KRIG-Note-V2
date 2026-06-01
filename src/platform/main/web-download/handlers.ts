/**
 * Web 下载历史 IPC handlers(Phase 3 收尾)
 *
 * 仿 learning/handlers.ts。3 channel:
 *   2 invoke(WEB_DOWNLOAD_LIST / WEB_DOWNLOAD_REMOVE)
 *   1 推送(WEB_DOWNLOAD_HISTORY_CHANGED — 历史变化广播全量 list,NavSide 刷新)
 *
 * ⚠️ 不在此注册 WEB_DOWNLOAD_ACTION(cancel)—— 那个在 handler.ts 的
 * registerWebDownloadHook 里已注册(actionHandlerRegistered 守卫),别重复注册冲突。
 *
 * 注册入口:platform/main/ipc/ipc-bus.ts.initIpcBus()(跟 registerLearningHandlers 平级)。
 *
 * 删记录 ≠ 删文件:WEB_DOWNLOAD_REMOVE 只删 JSON 记录,不动磁盘文件(对齐 Chrome)。
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { downloadStore } from './download-store';

/**
 * 把全量下载历史广播给所有 renderer。
 *
 * 默认遍历所有窗口(防御性,对齐 learning broadcast);handler.ts done 落盘后
 * 也调本函数(传 mainWindow 也走全量遍历,行为一致)。
 */
export function broadcastDownloadHistoryChanged(_win?: BrowserWindow): void {
  downloadStore
    .list()
    .then((entries) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.WEB_DOWNLOAD_HISTORY_CHANGED, entries);
        }
      }
    })
    .catch((err) => console.warn('[web-download] history broadcast failed:', err));
}

export function registerWebDownloadHistoryHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.WEB_DOWNLOAD_LIST, async () => {
    return downloadStore.list();
  });

  ipcMain.handle(IPC_CHANNELS.WEB_DOWNLOAD_REMOVE, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) return;
    await downloadStore.remove(id);
    broadcastDownloadHistoryChanged();
  });
}
