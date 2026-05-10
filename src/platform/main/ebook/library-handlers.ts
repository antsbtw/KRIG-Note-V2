/**
 * eBook IPC handlers(L5-C1)
 *
 * V1 → V2 直迁:src/plugins/ebook/main/ipc-handlers.ts(162 行)。
 * 改动点:
 * - 改 IPC channel 命名(对齐 V2 `<层>.<动作>` 规范,见 channel-names.ts)
 * - 广播改用 BrowserWindow.getAllWindows()(对齐 V2 learning/handlers.ts 模式)
 * - 入参严格 typeof 校验(对齐 V2 防御性约定)
 *
 * 注册入口:`platform/main/ipc/ipc-bus.ts.initIpcBus()`(C1 接进去)。
 *
 * 不含的逻辑(C1 不做):
 * - PluginContext / WorkMode 注册(V2 用 viewTypeRegistry,在 renderer 侧)
 * - Application Menu Open eBook(C1 不做菜单,导入入口在 NavSide)
 * - workspace 状态 setActiveBook / setExpandedFolders(D-2=A 走 pluginStates,
 *   renderer 直接 workspaceManager.update,不需 IPC)
 */

import { ipcMain, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { bookshelfStore } from './bookshelf-store';
import { annotationStore } from './annotation-store';
import { loadEBook, getEBookData, closeEBook } from './file-loader';
import type { EBookEntry } from './bookshelf-store';
import type { StoredAnnotation } from './annotation-store';

type EBookFileType = EBookEntry['fileType'];
type StorageMode = EBookEntry['storage'];

const VALID_FILE_TYPES: EBookFileType[] = ['pdf', 'epub', 'djvu', 'cbz'];

function isFileType(v: unknown): v is EBookFileType {
  return typeof v === 'string' && (VALID_FILE_TYPES as string[]).includes(v);
}

function isStorageMode(v: unknown): v is StorageMode {
  return v === 'managed' || v === 'link';
}

/** 广播书架全量到所有 renderer */
function broadcastBookshelfChanged(): void {
  const list = bookshelfStore.list();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.EBOOK_BOOKSHELF_CHANGED, list);
    }
  }
}

/** 通知 renderer 书已加载(view 收到后调 ebookGetData 拿 ArrayBuffer)*/
function broadcastEBookLoaded(info: {
  bookId: string;
  fileName: string;
  fileType: EBookFileType;
  lastPosition?: EBookEntry['lastPosition'];
}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.EBOOK_LOADED, info);
    }
  }
}

export function registerEBookHandlers(): void {
  // ── 文件对话框(选文件)──

  ipcMain.handle(IPC_CHANNELS.EBOOK_PICK_FILE, async () => {
    const focused = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!focused) return null;
    const result = await dialog.showOpenDialog(focused, {
      title: 'Import eBook',
      filters: [
        { name: 'eBook Files', extensions: ['pdf', 'epub', 'djvu', 'cbz'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: 'EPUB', extensions: ['epub'] },
      ],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const filePath = result.filePaths[0];
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const fileType: EBookFileType = isFileType(ext) ? ext : 'pdf';
    return { filePath, fileName: path.basename(filePath), fileType };
  });

  // ── 书架 CRUD ──

  ipcMain.handle(IPC_CHANNELS.EBOOK_BOOKSHELF_LIST, async () => bookshelfStore.list());

  ipcMain.handle(
    IPC_CHANNELS.EBOOK_BOOKSHELF_ADD,
    async (_e, filePath: unknown, fileType: unknown, storage: unknown) => {
      if (typeof filePath !== 'string' || !filePath) return null;
      if (!isFileType(fileType)) return null;
      if (!isStorageMode(storage)) return null;

      const entry =
        storage === 'managed'
          ? bookshelfStore.addManaged(filePath, fileType)
          : bookshelfStore.addLinked(filePath, fileType);
      broadcastBookshelfChanged();

      // 加载到内存 + 通知 renderer(导入即打开)
      try {
        await loadEBook(entry.filePath);
        broadcastEBookLoaded({
          bookId: entry.id,
          fileName: entry.displayName,
          fileType: entry.fileType,
        });
      } catch (err) {
        console.warn('[ebook] add → load failed:', err);
      }

      return entry;
    },
  );

  ipcMain.handle(IPC_CHANNELS.EBOOK_BOOKSHELF_OPEN, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) return { success: false, error: 'invalid id' };
    const entry = bookshelfStore.get(id);
    if (!entry) return { success: false, error: 'Entry not found' };

    const exists = await bookshelfStore.checkExists(id);
    if (!exists) return { success: false, error: 'File not found' };

    bookshelfStore.updateOpened(id);
    try {
      await loadEBook(entry.filePath);
    } catch (err) {
      console.warn('[ebook] open → load failed:', err);
      return { success: false, error: String(err) };
    }
    broadcastEBookLoaded({
      bookId: entry.id,
      fileName: entry.displayName,
      fileType: entry.fileType,
      lastPosition: entry.lastPosition,
    });
    broadcastBookshelfChanged();
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.EBOOK_BOOKSHELF_REMOVE, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) return;
    bookshelfStore.remove(id);
    broadcastBookshelfChanged();
  });

  ipcMain.handle(
    IPC_CHANNELS.EBOOK_BOOKSHELF_RENAME,
    async (_e, id: unknown, displayName: unknown) => {
      if (typeof id !== 'string' || typeof displayName !== 'string') return;
      bookshelfStore.rename(id, displayName);
      broadcastBookshelfChanged();
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.EBOOK_BOOKSHELF_MOVE,
    async (_e, id: unknown, folderId: unknown) => {
      if (typeof id !== 'string') return;
      const fid = typeof folderId === 'string' ? folderId : null;
      bookshelfStore.moveToFolder(id, fid);
      broadcastBookshelfChanged();
    },
  );

  ipcMain.handle(IPC_CHANNELS.EBOOK_BOOKSHELF_RELOCATE, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) return null;
    const focused = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (!focused) return null;
    const result = await dialog.showOpenDialog(focused, {
      title: 'Relocate eBook File',
      filters: [{ name: 'eBook Files', extensions: ['pdf', 'epub', 'djvu', 'cbz'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const entry = bookshelfStore.relocate(id, result.filePaths[0]);
    if (entry) broadcastBookshelfChanged();
    return entry;
  });

  ipcMain.handle(IPC_CHANNELS.EBOOK_BOOKSHELF_TRANSFER, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) return null;
    const entry = bookshelfStore.transferToManaged(id);
    if (entry) broadcastBookshelfChanged();
    return entry;
  });

  // ── 文件夹 ──

  ipcMain.handle(IPC_CHANNELS.EBOOK_FOLDER_LIST, async () => bookshelfStore.folderList());

  ipcMain.handle(
    IPC_CHANNELS.EBOOK_FOLDER_CREATE,
    async (_e, title: unknown, parentId: unknown) => {
      if (typeof title !== 'string' || !title) return null;
      const pid = typeof parentId === 'string' ? parentId : null;
      const folder = bookshelfStore.folderCreate(title, pid);
      broadcastBookshelfChanged();
      return folder;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.EBOOK_FOLDER_RENAME,
    async (_e, id: unknown, title: unknown) => {
      if (typeof id !== 'string' || typeof title !== 'string') return;
      bookshelfStore.folderRename(id, title);
      broadcastBookshelfChanged();
    },
  );

  ipcMain.handle(IPC_CHANNELS.EBOOK_FOLDER_DELETE, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) return;
    bookshelfStore.folderDelete(id);
    broadcastBookshelfChanged();
  });

  ipcMain.handle(
    IPC_CHANNELS.EBOOK_FOLDER_MOVE,
    async (_e, id: unknown, parentId: unknown) => {
      if (typeof id !== 'string') return;
      const pid = typeof parentId === 'string' ? parentId : null;
      bookshelfStore.folderMove(id, pid);
      broadcastBookshelfChanged();
    },
  );

  // ── 数据传输 ──

  ipcMain.handle(IPC_CHANNELS.EBOOK_GET_DATA, () => getEBookData());

  ipcMain.handle(IPC_CHANNELS.EBOOK_CLOSE, () => closeEBook());

  // ── 进度 + 书签 + 标注(C1 占位 channel,C2~C5 真消费)──

  ipcMain.handle(
    IPC_CHANNELS.EBOOK_SAVE_PROGRESS,
    async (_e, bookId: unknown, position: unknown) => {
      if (typeof bookId !== 'string' || !bookId) return;
      if (!position || typeof position !== 'object') return;
      bookshelfStore.updateProgress(bookId, position as Parameters<typeof bookshelfStore.updateProgress>[1]);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.EBOOK_BOOKMARK_TOGGLE,
    async (_e, bookId: unknown, page: unknown) => {
      if (typeof bookId !== 'string' || typeof page !== 'number') return [];
      return bookshelfStore.toggleBookmark(bookId, page);
    },
  );

  ipcMain.handle(IPC_CHANNELS.EBOOK_BOOKMARK_LIST, async (_e, bookId: unknown) => {
    if (typeof bookId !== 'string') return [];
    return bookshelfStore.getBookmarks(bookId);
  });

  ipcMain.handle(
    IPC_CHANNELS.EBOOK_CFI_BOOKMARK_ADD,
    async (_e, bookId: unknown, cfi: unknown, label: unknown) => {
      if (typeof bookId !== 'string' || typeof cfi !== 'string' || typeof label !== 'string') {
        return [];
      }
      return bookshelfStore.addCFIBookmark(bookId, cfi, label);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.EBOOK_CFI_BOOKMARK_REMOVE,
    async (_e, bookId: unknown, cfi: unknown) => {
      if (typeof bookId !== 'string' || typeof cfi !== 'string') return [];
      return bookshelfStore.removeCFIBookmark(bookId, cfi);
    },
  );

  ipcMain.handle(IPC_CHANNELS.EBOOK_CFI_BOOKMARK_LIST, async (_e, bookId: unknown) => {
    if (typeof bookId !== 'string') return [];
    return bookshelfStore.getCFIBookmarks(bookId);
  });

  ipcMain.handle(IPC_CHANNELS.EBOOK_ANNOTATION_LIST, async (_e, bookId: unknown) => {
    if (typeof bookId !== 'string') return [];
    return annotationStore.list(bookId);
  });

  ipcMain.handle(
    IPC_CHANNELS.EBOOK_ANNOTATION_ADD,
    async (_e, bookId: unknown, ann: unknown) => {
      if (typeof bookId !== 'string' || !ann || typeof ann !== 'object') return null;
      // C5 时再细化 ann 的字段校验,目前透传(不入 store 也无副作用)
      return annotationStore.add(bookId, ann as Omit<StoredAnnotation, 'id' | 'createdAt'>);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.EBOOK_ANNOTATION_REMOVE,
    async (_e, bookId: unknown, annotationId: unknown) => {
      if (typeof bookId !== 'string' || typeof annotationId !== 'string') return;
      annotationStore.remove(bookId, annotationId);
    },
  );
}
