/**
 * Graph IPC handlers(L5-G1)
 *
 * V1 → V2 改写:src/plugins/graph/main/ipc-handlers.ts(178 行)。
 * 改动点(对齐 ebook library-handlers.ts 模板):
 * - 改 IPC channel 命名为 V2 `<层>.<动作>` 规范(见 channel-names.ts GRAPH_*)
 * - 广播改用 BrowserWindow.getAllWindows()(对齐 ebook / learning)
 * - 入参严格 typeof 校验
 * - 砍 GRAPH_PENDING_OPEN / GRAPH_OPEN_IN_VIEW / GRAPH_DELETED / GRAPH_TITLE_CHANGED /
 *   GRAPH_SET_ACTIVE / GRAPH_GET_ACTIVE 共 5 条 IPC(决策 G1-8 / G1-9):
 *   - activeGraphId 走 pluginStates(D-2=A,renderer 端 workspaceManager.update)
 *   - open-canvas 走 commandRegistry,不需要 main 推流
 *   - 列表 / 重命名变更通过 GRAPH_LIST_CHANGED 单一推送通道,view 端订阅
 *
 * 注册入口:`platform/main/ipc/ipc-bus.ts.initIpcBus()`(本段接进去)。
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { canvasStore, type GraphVariant } from './canvas-store';

function isVariant(v: unknown): v is GraphVariant {
  return v === 'canvas' || v === 'family-tree' || v === 'knowledge' || v === 'mindmap';
}

/** 广播画板列表全量到所有 renderer (sub-phase 3a-1 改 async, canvasStore.list 现走 SurrealDB) */
async function broadcastListChanged(): Promise<void> {
  try {
    const list = await canvasStore.list();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.GRAPH_LIST_CHANGED, list);
      }
    }
  } catch (err) {
    console.warn('[graph/library-handlers] broadcast list-changed failed:', err);
  }
}

export function registerGraphHandlers(): void {
  // ── 画板 CRUD ──

  ipcMain.handle(IPC_CHANNELS.GRAPH_LIST, async () => canvasStore.list());

  ipcMain.handle(IPC_CHANNELS.GRAPH_LOAD, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) return null;
    return canvasStore.get(id);
  });

  ipcMain.handle(
    IPC_CHANNELS.GRAPH_CREATE,
    async (_e, title: unknown, variant: unknown, folderId: unknown) => {
      const t = typeof title === 'string' && title ? title : 'Untitled Canvas';
      const v: GraphVariant = isVariant(variant) ? variant : 'canvas';
      const fid = typeof folderId === 'string' ? folderId : null;
      const record = await canvasStore.create(t, v, fid);
      await broadcastListChanged();
      return record;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.GRAPH_SAVE,
    async (_e, id: unknown, docContent: unknown, title: unknown) => {
      if (typeof id !== 'string' || !id) return;
      const t = typeof title === 'string' ? title : 'Untitled Canvas';
      await canvasStore.update(id, docContent, t);
      await broadcastListChanged();
    },
  );

  ipcMain.handle(IPC_CHANNELS.GRAPH_DELETE, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) return;
    await canvasStore.delete(id);
    await broadcastListChanged();
  });

  ipcMain.handle(
    IPC_CHANNELS.GRAPH_RENAME,
    async (_e, id: unknown, title: unknown) => {
      if (typeof id !== 'string' || typeof title !== 'string') return;
      await canvasStore.rename(id, title);
      await broadcastListChanged();
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.GRAPH_MOVE_TO_FOLDER,
    async (_e, id: unknown, folderId: unknown) => {
      if (typeof id !== 'string' || !id) return;
      const fid = typeof folderId === 'string' ? folderId : null;
      await canvasStore.moveToFolder(id, fid);
      await broadcastListChanged();
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.GRAPH_DUPLICATE,
    async (_e, id: unknown, targetFolderId: unknown) => {
      if (typeof id !== 'string' || !id) return null;
      const fid =
        targetFolderId === null
          ? null
          : typeof targetFolderId === 'string'
            ? targetFolderId
            : undefined;
      const record = await canvasStore.duplicate(id, fid);
      if (record) await broadcastListChanged();
      return record;
    },
  );

  // ── 文件夹 CRUD ──

  ipcMain.handle(IPC_CHANNELS.GRAPH_FOLDER_LIST, async () => canvasStore.folderList());

  ipcMain.handle(
    IPC_CHANNELS.GRAPH_FOLDER_CREATE,
    async (_e, title: unknown, parentId: unknown) => {
      if (typeof title !== 'string' || !title) return null;
      const pid = typeof parentId === 'string' ? parentId : null;
      const folder = await canvasStore.folderCreate(title, pid);
      await broadcastListChanged();
      return folder;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.GRAPH_FOLDER_RENAME,
    async (_e, id: unknown, title: unknown) => {
      if (typeof id !== 'string' || typeof title !== 'string') return;
      await canvasStore.folderRename(id, title);
      await broadcastListChanged();
    },
  );

  ipcMain.handle(IPC_CHANNELS.GRAPH_FOLDER_DELETE, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) return;
    await canvasStore.folderDelete(id);
    await broadcastListChanged();
  });

  ipcMain.handle(
    IPC_CHANNELS.GRAPH_FOLDER_MOVE,
    async (_e, id: unknown, parentId: unknown) => {
      if (typeof id !== 'string') return;
      const pid = typeof parentId === 'string' ? parentId : null;
      await canvasStore.folderMove(id, pid);
      await broadcastListChanged();
    },
  );
}
