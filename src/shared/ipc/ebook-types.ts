/**
 * ebook IPC 共享类型 (decision 022 §4.1.5)
 *
 * sub-phase 022 落地: EBookEntry SSOT 从 capabilities/ebook-library/types.ts
 * 迁到 shared/ipc/ (沿 NoteInfo / FolderInfo 同模式, decision 021 §10.C-1 教训预防).
 *
 * 边界总结:
 * - view ↔ capability: EBookInfo (本文件) — 派生 folderId + 派生 lastOpenedAt /
 *   lastPosition 高频字段聚合到 EBookInfo 视图; bookmarks / cfiBookmarks 走单独 API
 * - capability 内部 ↔ storage: EBookPayload (semantic/types/atom.ts) +
 *   ReadingStatePayload (semantic/types/atom.ts)
 *
 * 不引入跨层依赖 — 本文件 0 import @capabilities / @semantic / @platform.
 */

// ── 数据模型基础类型 ──

export type EBookFileType = 'pdf' | 'epub' | 'djvu' | 'cbz';
export type EBookStorageMode = 'managed' | 'link';

/** 阅读位置 (PDF page + scale / EPUB CFI) */
export interface ReadingPosition {
  page?: number;
  scale?: number;
  fitWidth?: boolean;
  cfi?: string;
  /** EPUB 全书页号(0-based location.current),全屏 spread 退出时 save 右页全书页号,
   *  view 单页 reopen 时优先按此 page 走 goToFraction 精确跳转,绕开 cfi → page round
   *  误差(spread 边界附近的 cfi 可能 round 到隔壁 page) */
  epubPage?: number;
  /** EPUB 总页数(与 epubPage 配套,view 端 goToFraction 用 (page-1)/(total-1)) */
  epubPages?: number;
}

// ── 业务视图类型 (atom + 派生字段聚合) ──

/**
 * 书本业务视图 (atom + 派生 folderId + 派生 readingState 高频字段)
 *
 * 字面派生关系:
 * - id / fileType / storage / filePath / fileName / displayName / pageCount / addedAt
 *   = ebook atom.payload 字面
 * - folderId = user:krig:inFolder 边 object atomId (null = 根级)
 * - lastOpenedAt / lastPosition = hasReadingState 边 → reading-state atom.payload
 *   高频字段聚合 (避免 list 时跑两次 atom 拉取)
 *
 * bookmarks / cfiBookmarks 字段字面**不**在 EBookInfo, 走独立 API
 * (bookmarkList / cfiBookmarkList) 按需查询, 沿 V2 现状 caller 字面消费模式.
 */
export interface EBookInfo {
  id: string;
  fileType: EBookFileType;
  storage: EBookStorageMode;
  filePath: string;
  originalPath?: string;
  fileName: string;
  displayName: string;
  pageCount?: number;
  addedAt: number;
  /** 派生: user:krig:inFolder 边的 object; null = 根级 */
  folderId: string | null;
  /** 派生: reading-state atom.payload.lastOpenedAt (高频字段聚合) */
  lastOpenedAt: number;
  /** 派生: reading-state atom.payload.lastPosition (高频字段聚合) */
  lastPosition?: ReadingPosition;
}

/**
 * 阅读状态视图 (进度 + 书签独立查询时用)
 *
 * 完整投影 reading-state atom.payload, 含 EBookInfo 略掉的 bookmarks / cfiBookmarks.
 */
export interface ReadingStateInfo {
  bookId: string;
  lastOpenedAt: number;
  lastPosition: ReadingPosition;
  bookmarks: number[];                                   // PDF pageNum 书签
  cfiBookmarks: Array<{ cfi: string; label: string }>;   // EPUB CFI 书签
}

// ── IPC 推送 + 文件选择类型 (沿 V2 现状字面, 跟 ebook atom CRUD 解耦) ──

/** 选文件返回 (EBOOK_PICK_FILE) */
export interface PickFileResult {
  filePath: string;
  fileName: string;
  fileType: EBookFileType;
}

/** 数据传输 — main 加载到内存的 buffer + 路径 (EBOOK_GET_DATA) */
export interface EBookDataPayload {
  filePath: string;
  fileName: string;
  /** Electron IPC 自动序列化 Buffer → Uint8Array; view 端转 ArrayBuffer 用 */
  data: Uint8Array;
}

/** EBOOK_LOADED 推送 (main → renderer) */
export interface EBookLoadedInfo {
  bookId: string;
  fileName: string;
  fileType: EBookFileType;
  lastPosition?: ReadingPosition;
}
