/**
 * eBook IPC handlers (L5-C1, sub-phase 022 重写)
 *
 * sub-phase 022 (decision 022 §4.1.4 §5 Step 5.5):
 * - 全部 IPC handler 改走 capability-impl (atom CRUD), 不再调 bookshelf-store /
 *   annotation-store (旧 JSON store 文件保留, 仅 Step 5.7 migration 字面读旧数据用,
 *   Step 5.10 整文件 git rm 一并清除).
 * - 5 folder API handler 删除 (改走 folder capability + viewType='ebook',
 *   决议 021 §4.3 兼容约束落地).
 * - 3 annotation API handler 删除 (annotation 概念消亡, view caller 改走 thought
 *   block 5 API).
 * - 5 新 thought block handler: EBOOK_THOUGHT_GET / ENSURE / BLOCK_ADD /
 *   BLOCK_REMOVE / ANNOTATIONS.
 */

import { ipcMain, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { loadEBook, getEBookData, closeEBook } from './file-loader';
import {
  list,
  getBook,
  addManaged,
  addLinked,
  remove,
  rename,
  moveToFolder,
  relocate as relocateBook,
  transferToManaged,
  checkFileExists,
  markOpened,
  saveProgress,
  bookmarkToggle,
  bookmarkList,
  cfiBookmarkAdd,
  cfiBookmarkRemove,
  cfiBookmarkList,
  getReadingThought,
  ensureReadingThought,
  addReadingThoughtBlock,
  removeReadingThoughtBlock,
  getReadingThoughtAnnotations,
} from './capability-impl';
import type { ThoughtBlockSpec } from './capability-impl';
import type { EBookFileType, EBookInfo, ReadingPosition } from '@shared/ipc/ebook-types';

const VALID_FILE_TYPES: EBookFileType[] = ['pdf', 'epub', 'djvu', 'cbz'];

function isFileType(v: unknown): v is EBookFileType {
  return typeof v === 'string' && (VALID_FILE_TYPES as string[]).includes(v);
}

function isStorageMode(v: unknown): v is 'managed' | 'link' {
  return v === 'managed' || v === 'link';
}

/** 广播书架全量到所有 renderer */
async function broadcastBookshelfChanged(): Promise<void> {
  const all = await list();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.EBOOK_BOOKSHELF_CHANGED, all);
    }
  }
}

/** 通知 renderer 书已加载 (view 收到后调 ebookGetData 拿 ArrayBuffer) */
function broadcastEBookLoaded(info: {
  bookId: string;
  fileName: string;
  fileType: EBookFileType;
  lastPosition?: ReadingPosition;
}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.EBOOK_LOADED, info);
    }
  }
}

export function registerEBookHandlers(): void {
  // ── 文件对话框 (选文件) ──

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

  // ── 书架 CRUD (sub-phase 022: 走 atom CRUD) ──

  ipcMain.handle(IPC_CHANNELS.EBOOK_BOOKSHELF_LIST, async () => list());

  ipcMain.handle(
    IPC_CHANNELS.EBOOK_BOOKSHELF_ADD,
    async (_e, filePath: unknown, fileType: unknown, storageMode: unknown) => {
      if (typeof filePath !== 'string' || !filePath) return null;
      if (!isFileType(fileType)) return null;
      if (!isStorageMode(storageMode)) return null;

      const entry: EBookInfo =
        storageMode === 'managed'
          ? await addManaged(filePath, fileType)
          : await addLinked(filePath, fileType);
      await broadcastBookshelfChanged();

      // 加载到内存 + 通知 renderer (导入即打开)
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
    const entry = await getBook(id);
    if (!entry) return { success: false, error: 'Entry not found' };

    const exists = await checkFileExists(id);
    if (!exists) return { success: false, error: 'File not found' };

    await markOpened(id);
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
    await broadcastBookshelfChanged();
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.EBOOK_BOOKSHELF_REMOVE, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) return;
    await remove(id);
    await broadcastBookshelfChanged();
  });

  ipcMain.handle(
    IPC_CHANNELS.EBOOK_BOOKSHELF_RENAME,
    async (_e, id: unknown, displayName: unknown) => {
      if (typeof id !== 'string' || typeof displayName !== 'string') return;
      await rename(id, displayName);
      await broadcastBookshelfChanged();
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.EBOOK_BOOKSHELF_MOVE,
    async (_e, id: unknown, folderId: unknown) => {
      if (typeof id !== 'string') return;
      const fid = typeof folderId === 'string' ? folderId : null;
      await moveToFolder(id, fid);
      await broadcastBookshelfChanged();
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
    const entry = await relocateBook(id, result.filePaths[0]);
    if (entry) await broadcastBookshelfChanged();
    return entry;
  });

  ipcMain.handle(IPC_CHANNELS.EBOOK_BOOKSHELF_TRANSFER, async (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) return null;
    const entry = await transferToManaged(id);
    if (entry) await broadcastBookshelfChanged();
    return entry;
  });

  // ── 数据传输 ──

  ipcMain.handle(IPC_CHANNELS.EBOOK_GET_DATA, () => getEBookData());
  ipcMain.handle(IPC_CHANNELS.EBOOK_CLOSE, () => closeEBook());

  // ── 进度 + 书签 (sub-phase 022: reading-state atom CRUD) ──

  ipcMain.handle(
    IPC_CHANNELS.EBOOK_SAVE_PROGRESS,
    async (_e, bookId: unknown, position: unknown) => {
      if (typeof bookId !== 'string' || !bookId) return;
      if (!position || typeof position !== 'object') return;
      // saveProgress 字面是 debounced fire-and-forget (沿决议 §9.3 字面 100ms debounce)
      saveProgress(bookId, position as ReadingPosition);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.EBOOK_BOOKMARK_TOGGLE,
    async (_e, bookId: unknown, page: unknown) => {
      if (typeof bookId !== 'string' || typeof page !== 'number') return [];
      return bookmarkToggle(bookId, page);
    },
  );

  ipcMain.handle(IPC_CHANNELS.EBOOK_BOOKMARK_LIST, async (_e, bookId: unknown) => {
    if (typeof bookId !== 'string') return [];
    return bookmarkList(bookId);
  });

  ipcMain.handle(
    IPC_CHANNELS.EBOOK_CFI_BOOKMARK_ADD,
    async (_e, bookId: unknown, cfi: unknown, label: unknown) => {
      if (typeof bookId !== 'string' || typeof cfi !== 'string' || typeof label !== 'string') {
        return [];
      }
      return cfiBookmarkAdd(bookId, cfi, label);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.EBOOK_CFI_BOOKMARK_REMOVE,
    async (_e, bookId: unknown, cfi: unknown) => {
      if (typeof bookId !== 'string' || typeof cfi !== 'string') return [];
      return cfiBookmarkRemove(bookId, cfi);
    },
  );

  ipcMain.handle(IPC_CHANNELS.EBOOK_CFI_BOOKMARK_LIST, async (_e, bookId: unknown) => {
    if (typeof bookId !== 'string') return [];
    return cfiBookmarkList(bookId);
  });

  // ── 5 新 thought block API (sub-phase 022) ──

  ipcMain.handle(IPC_CHANNELS.EBOOK_THOUGHT_GET, async (_e, bookId: unknown) => {
    if (typeof bookId !== 'string') return null;
    return getReadingThought(bookId);
  });

  ipcMain.handle(IPC_CHANNELS.EBOOK_THOUGHT_ENSURE, async (_e, bookId: unknown) => {
    if (typeof bookId !== 'string') return null;
    try {
      return await ensureReadingThought(bookId);
    } catch (err) {
      console.error('[ebook] ensureReadingThought failed:', err);
      return null;
    }
  });

  ipcMain.handle(
    IPC_CHANNELS.EBOOK_THOUGHT_BLOCK_ADD,
    async (_e, bookId: unknown, spec: unknown) => {
      if (typeof bookId !== 'string' || !spec || typeof spec !== 'object') return;
      await addReadingThoughtBlock(bookId, spec as ThoughtBlockSpec);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.EBOOK_THOUGHT_BLOCK_REMOVE,
    async (_e, bookId: unknown, blockId: unknown) => {
      if (typeof bookId !== 'string' || typeof blockId !== 'string') return;
      await removeReadingThoughtBlock(bookId, blockId);
    },
  );

  ipcMain.handle(IPC_CHANNELS.EBOOK_THOUGHT_ANNOTATIONS, async (_e, bookId: unknown) => {
    if (typeof bookId !== 'string') return [];
    return getReadingThoughtAnnotations(bookId);
  });
}
