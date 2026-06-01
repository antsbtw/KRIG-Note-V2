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

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import {
  createFolder,
  listFolders,
  getFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  previewDeleteFolder,
} from './capability-impl';
import { broadcastFolderListChanged } from './broadcast';
import { broadcastNoteListChanged } from '../note/broadcast';
import { broadcastGraphListChanged } from '../graph/broadcast';

export function registerFolderHandlers(): void {
  // decision 021 §4.1: FOLDER_LIST handler 透传 viewType 入参
  ipcMain.handle(IPC_CHANNELS.FOLDER_LIST, async (_e, viewType: unknown) => {
    if (
      viewType !== 'note' &&
      viewType !== 'graph' &&
      viewType !== 'ebook' &&
      viewType !== 'thought' &&
      viewType !== 'web'
    ) {
      return [];
    }
    return listFolders(viewType);
  });

  ipcMain.handle(
    IPC_CHANNELS.FOLDER_CREATE,
    async (_e, payload: unknown) => {
      const p = payload as { title?: unknown; parentFolderId?: unknown; viewType?: unknown } | null;
      if (!p || typeof p.title !== 'string' || !p.title) return null;
      const parentFolderId =
        typeof p.parentFolderId === 'string' && p.parentFolderId ? p.parentFolderId : null;
      // decision 021 §4.1 + sub-phase 022: viewType 必传校验 (含 'ebook' / 'thought' / 'web')
      if (
        p.viewType !== 'note' &&
        p.viewType !== 'graph' &&
        p.viewType !== 'ebook' &&
        p.viewType !== 'thought' &&
        p.viewType !== 'web'
      ) {
        return null;
      }
      const folder = await createFolder(p.title, parentFolderId, p.viewType);
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

  // decision 021 §5.5 Q7 弱保护: dry-run 计数,不删除
  ipcMain.handle(IPC_CHANNELS.FOLDER_PREVIEW_DELETE, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) {
      return { folders: 0, resources: 0 };
    }
    return previewDeleteFolder(id);
  });

  ipcMain.handle(IPC_CHANNELS.FOLDER_DELETE, async (_e, id: unknown, opts: unknown) => {
    if (typeof id !== 'string' || !id) {
      return { deletedFolders: 0, deletedResources: 0, cascadedEdges: 0 };
    }
    const progressTaskId =
      opts && typeof opts === 'object' && typeof (opts as { progressTaskId?: unknown }).progressTaskId === 'string'
        ? (opts as { progressTaskId: string }).progressTaskId
        : undefined;
    const result = await deleteFolder(id, { progressTaskId });
    // Path Y (decision 014 5.6.bis 扩展):删 folder 递归删 note + graph-canvas,
    // 三条 list-changed 都广播 (folder + note + graph)。
    await broadcastFolderListChanged();
    await broadcastNoteListChanged();
    await broadcastGraphListChanged();
    return result;
  });
}
