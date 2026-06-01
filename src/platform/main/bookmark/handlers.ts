/**
 * bookmark IPC handlers (web view 书签树, 书签步骤1 数据层)
 *
 * 模板对齐 src/platform/main/ebook/library-handlers.ts + folder/handlers.ts:
 * - 入参 typeof 严格校验
 * - 每个写入后调 broadcastBookmarkListChanged()
 * - 广播走 BrowserWindow.getAllWindows() webContents.send
 *
 * 注册入口:src/platform/main/ipc/ipc-bus.ts.initIpcBus()
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { add, list, rename, remove, moveToFolder } from './capability-impl';

/** 广播书签列表变更到所有 renderer (照 ebook broadcastBookshelfChanged) */
async function broadcastBookmarkListChanged(): Promise<void> {
  const all = await list();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.BOOKMARK_LIST_CHANGED, all);
    }
  }
}

export function registerBookmarkHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.BOOKMARK_LIST, async () => list());

  ipcMain.handle(
    IPC_CHANNELS.BOOKMARK_ADD,
    async (_e, url: unknown, title: unknown, folderId: unknown) => {
      if (typeof url !== 'string' || !url) return null;
      const t = typeof title === 'string' ? title : '';
      const fid = typeof folderId === 'string' && folderId ? folderId : null;
      const info = await add(url, t, fid);
      await broadcastBookmarkListChanged();
      return info;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.BOOKMARK_RENAME,
    async (_e, id: unknown, title: unknown) => {
      if (typeof id !== 'string' || !id) return;
      if (typeof title !== 'string') return;
      await rename(id, title);
      await broadcastBookmarkListChanged();
    },
  );

  ipcMain.handle(IPC_CHANNELS.BOOKMARK_REMOVE, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) return;
    await remove(id);
    await broadcastBookmarkListChanged();
  });

  ipcMain.handle(
    IPC_CHANNELS.BOOKMARK_MOVE,
    async (_e, id: unknown, folderId: unknown) => {
      if (typeof id !== 'string' || !id) return;
      const fid = typeof folderId === 'string' && folderId ? folderId : null;
      await moveToFolder(id, fid);
      await broadcastBookmarkListChanged();
    },
  );
}
