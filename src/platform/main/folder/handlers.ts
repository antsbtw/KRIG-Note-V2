/**
 * folder IPC handlers (decision 012 §3.4 方案 A)
 *
 * 模板对齐 src/platform/main/ebook/library-handlers.ts:
 * - 入参 typeof 严格校验
 * - 每个写入后调 broadcastFolderListChanged()
 * - 广播走 BrowserWindow.getAllWindows() webContents.send
 *
 * 注册入口:src/platform/main/ipc/ipc-bus.ts.initIpcBus()
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import {
  createFolder,
  listFolders,
  getFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
} from './capability-impl';

async function broadcastFolderListChanged(): Promise<void> {
  try {
    const list = await listFolders();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.FOLDER_LIST_CHANGED, list);
      }
    }
  } catch (err) {
    console.warn('[folder] broadcast list-changed failed:', err);
  }
}

export function registerFolderHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.FOLDER_LIST, async () => listFolders());

  ipcMain.handle(
    IPC_CHANNELS.FOLDER_CREATE,
    async (_e, payload: unknown) => {
      const p = payload as { title?: unknown; parentFolderId?: unknown } | null;
      if (!p || typeof p.title !== 'string' || !p.title) return null;
      const parentFolderId =
        typeof p.parentFolderId === 'string' && p.parentFolderId ? p.parentFolderId : null;
      const folder = await createFolder(p.title, parentFolderId);
      await broadcastFolderListChanged();
      return folder;
    },
  );

  ipcMain.handle(IPC_CHANNELS.FOLDER_GET, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) return null;
    return getFolder(id);
  });

  ipcMain.handle(IPC_CHANNELS.FOLDER_RENAME, async (_e, payload: unknown) => {
    const p = payload as { id?: unknown; title?: unknown } | null;
    if (!p || typeof p.id !== 'string' || !p.id) return null;
    if (typeof p.title !== 'string') return null;
    const folder = await renameFolder(p.id, p.title);
    await broadcastFolderListChanged();
    return folder;
  });

  ipcMain.handle(IPC_CHANNELS.FOLDER_MOVE, async (_e, payload: unknown) => {
    const p = payload as { folderId?: unknown; newParentFolderId?: unknown } | null;
    if (!p || typeof p.folderId !== 'string' || !p.folderId) return;
    const newParentFolderId =
      typeof p.newParentFolderId === 'string' && p.newParentFolderId ? p.newParentFolderId : null;
    await moveFolder(p.folderId, newParentFolderId);
    await broadcastFolderListChanged();
  });

  ipcMain.handle(IPC_CHANNELS.FOLDER_DELETE, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) return;
    await deleteFolder(id);
    await broadcastFolderListChanged();
  });
}
