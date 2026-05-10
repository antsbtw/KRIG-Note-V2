/**
 * eBook 书架 store(L5-C1)
 *
 * V1 → V2 直迁:src/main/ebook/bookshelf-store.ts(JSON 实现,321 行)→ V2 沿用。
 * 用户拍板 D-3=B JSON 起步,模板对齐 V2 既有 learning/vocab-store.ts 模式
 * (atomic write tmp + rename)。
 *
 * 文件位置:
 *   {userData}/krig-data/ebook/bookshelf.json   书架 + 文件夹元数据
 *   {userData}/krig-data/ebook/library/{id}.{ext}   托管模式的文件副本
 *
 * 退出条件(D-4 v0.3):C5 验收 + 稳定 ≥2 周 + W6 SurrealDB 客户端 epic 落地
 * → 整体迁 src/storage/ebook/ + 升 SurrealDB 实现。V1
 * src/main/ebook/bookshelf-surreal-store.ts 保留作 W6 起点参考。
 */

import { app } from 'electron';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
  renameSync,
} from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// ── 数据模型 ──

/** 统一的阅读位置 / 视图状态 */
export interface ReadingPosition {
  page?: number;
  scale?: number;
  fitWidth?: boolean;
  cfi?: string;
}

export interface EBookEntry {
  id: string;
  fileType: 'pdf' | 'epub' | 'djvu' | 'cbz';
  storage: 'link' | 'managed';
  filePath: string;
  originalPath?: string;
  fileName: string;
  displayName: string;
  pageCount?: number;
  folderId: string | null;
  addedAt: number;
  lastOpenedAt: number;
  lastPosition?: ReadingPosition;
  bookmarks?: number[];
  cfiBookmarks?: Array<{ cfi: string; label: string }>;
}

export interface EBookFolder {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  created_at: number;
}

interface BookshelfFile {
  version: '1';
  entries: EBookEntry[];
  folders: EBookFolder[];
}

// ── 路径常量 ──

const EBOOK_DIR = path.join(app.getPath('userData'), 'krig-data', 'ebook');
const LIBRARY_DIR = path.join(EBOOK_DIR, 'library');
const STORE_PATH = path.join(EBOOK_DIR, 'bookshelf.json');

// ── Store ──

class BookshelfStore {
  private data: BookshelfFile = { version: '1', entries: [], folders: [] };
  private loaded = false;

  private ensureDir(): void {
    if (!existsSync(EBOOK_DIR)) mkdirSync(EBOOK_DIR, { recursive: true });
    if (!existsSync(LIBRARY_DIR)) mkdirSync(LIBRARY_DIR, { recursive: true });
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;

    try {
      this.ensureDir();
      if (!existsSync(STORE_PATH)) return;

      const raw = JSON.parse(readFileSync(STORE_PATH, 'utf-8'));
      // 兼容老格式(纯数组)+ 新格式(version + entries + folders)
      if (Array.isArray(raw)) {
        this.data = {
          version: '1',
          entries: raw.map((e) => ({ ...e, folderId: e.folderId ?? null })),
          folders: [],
        };
      } else if (raw && typeof raw === 'object') {
        this.data = {
          version: '1',
          entries: Array.isArray(raw.entries) ? raw.entries : [],
          folders: Array.isArray(raw.folders) ? raw.folders : [],
        };
      }
    } catch (err) {
      console.warn('[ebook/bookshelf-store] load failed (file 损坏或权限问题):', err);
      // 起空 store,后续 write 会重建
    }
  }

  /** atomic 写文件:tmp → rename */
  private save(): void {
    try {
      this.ensureDir();
      const tmp = STORE_PATH + '.tmp';
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
      renameSync(tmp, STORE_PATH);
    } catch (err) {
      console.warn('[ebook/bookshelf-store] save failed:', err);
    }
  }

  // ── 书本操作 ──

  list(): EBookEntry[] {
    this.load();
    return [...this.data.entries].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  }

  get(id: string): EBookEntry | null {
    this.load();
    return this.data.entries.find((e) => e.id === id) ?? null;
  }

  addManaged(srcPath: string, fileType: EBookEntry['fileType'], pageCount?: number): EBookEntry {
    this.load();

    const id = randomUUID();
    const ext = path.extname(srcPath);
    const destPath = path.join(LIBRARY_DIR, `${id}${ext}`);
    copyFileSync(srcPath, destPath);

    const entry: EBookEntry = {
      id,
      fileType,
      storage: 'managed',
      filePath: destPath,
      originalPath: srcPath,
      fileName: path.basename(srcPath),
      displayName: path.basename(srcPath, ext),
      pageCount,
      folderId: null,
      addedAt: Date.now(),
      lastOpenedAt: Date.now(),
    };

    this.data.entries.push(entry);
    this.save();
    return entry;
  }

  addLinked(srcPath: string, fileType: EBookEntry['fileType'], pageCount?: number): EBookEntry {
    this.load();

    const ext = path.extname(srcPath);
    const entry: EBookEntry = {
      id: randomUUID(),
      fileType,
      storage: 'link',
      filePath: srcPath,
      fileName: path.basename(srcPath),
      displayName: path.basename(srcPath, ext),
      pageCount,
      folderId: null,
      addedAt: Date.now(),
      lastOpenedAt: Date.now(),
    };

    this.data.entries.push(entry);
    this.save();
    return entry;
  }

  remove(id: string): void {
    this.load();
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry) return;

    if (entry.storage === 'managed' && existsSync(entry.filePath)) {
      try {
        unlinkSync(entry.filePath);
      } catch {
        // 文件可能已被外部删除,忽略
      }
    }

    this.data.entries = this.data.entries.filter((e) => e.id !== id);
    this.save();
  }

  rename(id: string, displayName: string): void {
    this.load();
    const entry = this.data.entries.find((e) => e.id === id);
    if (entry) {
      entry.displayName = displayName;
      this.save();
    }
  }

  moveToFolder(id: string, folderId: string | null): void {
    this.load();
    const entry = this.data.entries.find((e) => e.id === id);
    if (entry) {
      entry.folderId = folderId;
      this.save();
    }
  }

  updateOpened(id: string): void {
    this.load();
    const entry = this.data.entries.find((e) => e.id === id);
    if (entry) {
      entry.lastOpenedAt = Date.now();
      this.save();
    }
  }

  toggleBookmark(id: string, page: number): number[] {
    this.load();
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry) return [];
    if (!entry.bookmarks) entry.bookmarks = [];
    const idx = entry.bookmarks.indexOf(page);
    if (idx >= 0) {
      entry.bookmarks.splice(idx, 1);
    } else {
      entry.bookmarks.push(page);
      entry.bookmarks.sort((a, b) => a - b);
    }
    this.save();
    return entry.bookmarks;
  }

  getBookmarks(id: string): number[] {
    this.load();
    return this.data.entries.find((e) => e.id === id)?.bookmarks ?? [];
  }

  addCFIBookmark(id: string, cfi: string, label: string): Array<{ cfi: string; label: string }> {
    this.load();
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry) return [];
    if (!entry.cfiBookmarks) entry.cfiBookmarks = [];
    if (entry.cfiBookmarks.some((b) => b.cfi === cfi)) return entry.cfiBookmarks;
    entry.cfiBookmarks.push({ cfi, label });
    this.save();
    return entry.cfiBookmarks;
  }

  removeCFIBookmark(id: string, cfi: string): Array<{ cfi: string; label: string }> {
    this.load();
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry || !entry.cfiBookmarks) return [];
    entry.cfiBookmarks = entry.cfiBookmarks.filter((b) => b.cfi !== cfi);
    this.save();
    return entry.cfiBookmarks;
  }

  getCFIBookmarks(id: string): Array<{ cfi: string; label: string }> {
    this.load();
    return this.data.entries.find((e) => e.id === id)?.cfiBookmarks ?? [];
  }

  updateProgress(id: string, position: ReadingPosition): void {
    this.load();
    const entry = this.data.entries.find((e) => e.id === id);
    if (entry) {
      entry.lastPosition = { ...entry.lastPosition, ...position };
      this.save();
    }
  }

  async checkExists(id: string): Promise<boolean> {
    this.load();
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry) return false;
    try {
      await stat(entry.filePath);
      return true;
    } catch {
      return false;
    }
  }

  /** 重新定位 — 用户选了新文件路径替换失效 entry(D-5)*/
  relocate(id: string, newPath: string): EBookEntry | null {
    this.load();
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry) return null;
    entry.filePath = newPath;
    entry.fileName = path.basename(newPath);
    this.save();
    return entry;
  }

  /** link → managed 转换 — 复制到 library 并更新元数据 */
  transferToManaged(id: string): EBookEntry | null {
    this.load();
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry || entry.storage !== 'link') return null;
    const ext = path.extname(entry.filePath);
    const destPath = path.join(LIBRARY_DIR, `${entry.id}${ext}`);
    try {
      copyFileSync(entry.filePath, destPath);
    } catch (err) {
      console.warn('[ebook/bookshelf-store] transferToManaged copy failed:', err);
      return null;
    }
    entry.originalPath = entry.filePath;
    entry.filePath = destPath;
    entry.storage = 'managed';
    this.save();
    return entry;
  }

  // ── 文件夹操作 ──

  folderList(): EBookFolder[] {
    this.load();
    return [...this.data.folders].sort((a, b) => a.sort_order - b.sort_order);
  }

  folderCreate(title: string, parentId?: string | null): EBookFolder {
    this.load();
    const siblings = this.data.folders.filter((f) => f.parent_id === (parentId ?? null));
    const folder: EBookFolder = {
      id: randomUUID(),
      title,
      parent_id: parentId ?? null,
      sort_order: siblings.length + 1,
      created_at: Date.now(),
    };
    this.data.folders.push(folder);
    this.save();
    return folder;
  }

  folderRename(id: string, title: string): void {
    this.load();
    const folder = this.data.folders.find((f) => f.id === id);
    if (folder) {
      folder.title = title;
      this.save();
    }
  }

  folderDelete(id: string): void {
    this.load();

    // 递归删除子文件夹
    const childFolders = this.data.folders.filter((f) => f.parent_id === id);
    for (const child of childFolders) {
      this.folderDelete(child.id);
    }

    // 该文件夹下的书本移到根目录
    for (const entry of this.data.entries) {
      if (entry.folderId === id) entry.folderId = null;
    }

    this.data.folders = this.data.folders.filter((f) => f.id !== id);
    this.save();
  }

  folderMove(id: string, parentId: string | null): void {
    this.load();
    const folder = this.data.folders.find((f) => f.id === id);
    if (folder) {
      folder.parent_id = parentId;
      this.save();
    }
  }
}

export const bookshelfStore = new BookshelfStore();
