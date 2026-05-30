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
  listAllFoldersGroupedByView,
  getFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
  previewDeleteFolder,
} from './capability-impl';
import { broadcastNoteListChanged } from '../note/broadcast';
import { broadcastGraphListChanged } from '../graph/broadcast';

/**
 * decision 021 §4.2 不变约束 #2 + §0.2 第 4 条:onListChanged callback 签名字面不动
 * ((list: FolderInfo[]) => void).
 *
 * 方案 C (决议 §10.B-2 偏离,2026-05-13 总指挥批复):
 * - main 端按 view 分别广播 2 次 (note + graph),renderer 端 useAllFolders(viewType) hook
 *   在 onListChanged callback 内调 listFolders(viewType) 重拉,只保留当前 view folder.
 * - 字面合规:onListChanged 签名不动 (renderer 端 hook 上下文 viewType 已知,不依赖 callback 参数).
 * - 隔离语义:每个 view 只收到自己 view 的 folder list,不污染对端 view 缓存.
 */
async function broadcastFolderListChanged(): Promise<void> {
  try {
    // P1-3 (2026-05-29 data-layer-audit): 4 次 listFolders → 1 次 listAllFoldersGroupedByView.
    // 字面 12 次 storage call (P1-1 之前) → 3 次,broadcast 快 4×.
    const grouped = await listAllFoldersGroupedByView();
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send(IPC_CHANNELS.FOLDER_LIST_CHANGED, grouped.note);
      win.webContents.send(IPC_CHANNELS.FOLDER_LIST_CHANGED, grouped.graph);
      win.webContents.send(IPC_CHANNELS.FOLDER_LIST_CHANGED, grouped.ebook);
      win.webContents.send(IPC_CHANNELS.FOLDER_LIST_CHANGED, grouped.thought);
    }
  } catch (err) {
    console.warn('[folder] broadcast list-changed failed:', err);
  }
}

export function registerFolderHandlers(): void {
  // decision 021 §4.1: FOLDER_LIST handler 透传 viewType 入参
  ipcMain.handle(IPC_CHANNELS.FOLDER_LIST, async (_e, viewType: unknown) => {
    if (
      viewType !== 'note' &&
      viewType !== 'graph' &&
      viewType !== 'ebook' &&
      viewType !== 'thought'
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
      // decision 021 §4.1 + sub-phase 022: viewType 必传校验 (含 'ebook' / 'thought')
      if (
        p.viewType !== 'note' &&
        p.viewType !== 'graph' &&
        p.viewType !== 'ebook' &&
        p.viewType !== 'thought'
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
