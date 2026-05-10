/**
 * ebook-library capability — 对外类型(L5-C1)
 *
 * view 通过 requireCapabilityApi<EBookLibraryApi>('ebook-library') 取 api;
 * driver/slot 内部消费可直 import 单例 export(对齐 W5 严格态 A 边界)。
 *
 * 类型与 platform/main/ebook 内部存储类型对齐(IPC 边界两侧形状一致)。
 * 不直接 import platform 内部类型,在此独立声明 — 跨进程边界对齐契约,
 * 不引入跨层依赖。
 */

// ── 数据模型(对齐 platform/main/ebook/bookshelf-store)──

export type EBookFileType = 'pdf' | 'epub' | 'djvu' | 'cbz';
export type EBookStorageMode = 'managed' | 'link';

export interface ReadingPosition {
  page?: number;
  scale?: number;
  fitWidth?: boolean;
  cfi?: string;
}

export interface EBookEntry {
  id: string;
  fileType: EBookFileType;
  storage: EBookStorageMode;
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

/** 选文件返回(EBOOK_PICK_FILE)*/
export interface PickFileResult {
  filePath: string;
  fileName: string;
  fileType: EBookFileType;
}

/** 数据传输 — main 加载到内存的 buffer + 路径(EBOOK_GET_DATA)*/
export interface EBookDataPayload {
  filePath: string;
  fileName: string;
  /** Electron IPC 自动序列化 Buffer → Uint8Array;view 端转 ArrayBuffer 用 */
  data: Uint8Array;
}

/** EBOOK_LOADED 推送(main → renderer)*/
export interface EBookLoadedInfo {
  bookId: string;
  fileName: string;
  fileType: EBookFileType;
  lastPosition?: ReadingPosition;
}

// ── 标注(C5 真消费,C1 占位类型)──

export interface StoredAnnotation {
  id: string;
  type: 'rect' | 'underline';
  color: string;
  pageNum: number;
  rect: { x: number; y: number; w: number; h: number };
  cfi?: string;
  textContent?: string;
  ocrText?: string;
  /** D-7=A:base64 inline,不挂 media:// */
  thumbnail?: string;
  createdAt: number;
}

// ── view 业务路径 API ──

export interface EBookLibraryApi {
  // ── 书架 ──

  /** 全量书架(按 lastOpenedAt 倒序)*/
  list(): Promise<EBookEntry[]>;
  /** 按 id 取单本;不存在返 null */
  get(id: string): Promise<EBookEntry | null>;
  /** 弹文件对话框选 PDF/EPUB/DJVU/CBZ;取消返 null */
  pickFile(): Promise<PickFileResult | null>;
  /**
   * 添加书 + 自动加载到 main 内存 + 推 EBOOK_LOADED。
   * managed=复制到 library;link=只记路径
   */
  add(
    filePath: string,
    fileType: EBookFileType,
    storage: EBookStorageMode,
  ): Promise<EBookEntry | null>;
  /** 打开书 — 加载到 main 内存 + 推 EBOOK_LOADED;失败返错误对象 */
  open(id: string): Promise<{ success: boolean; error?: string }>;
  remove(id: string): Promise<void>;
  rename(id: string, displayName: string): Promise<void>;
  moveToFolder(id: string, folderId: string | null): Promise<void>;
  /** D-5:文件不存在时弹 dialog 选新路径,更新 entry.filePath */
  relocate(id: string): Promise<EBookEntry | null>;
  /** link → managed:复制文件到 library + 更新元数据 */
  transferToManaged(id: string): Promise<EBookEntry | null>;

  // ── 文件夹 ──

  folderList(): Promise<EBookFolder[]>;
  folderCreate(title: string, parentId?: string | null): Promise<EBookFolder | null>;
  folderRename(id: string, title: string): Promise<void>;
  folderDelete(id: string): Promise<void>;
  folderMove(id: string, parentId: string | null): Promise<void>;

  // ── 数据传输(view ← main 拿当前已加载的 buffer)──

  /**
   * 取 main 当前已加载的电子书 buffer。
   * 只在 onBookOpened 推流后调,否则返 null(未加载)
   */
  getData(): Promise<EBookDataPayload | null>;
  /** 关闭当前书,释放 main 端 buffer */
  close(): Promise<void>;

  // ── 推送订阅 ──

  /** 订阅书架变化 — 返回 unsubscribe */
  onBookshelfChanged(callback: (list: EBookEntry[]) => void): () => void;
  /** 订阅"书已加载"通知 — view 收到后调 getData() 拿 buffer */
  onBookOpened(callback: (info: EBookLoadedInfo) => void): () => void;

  // ── 进度 ──

  saveProgress(bookId: string, position: ReadingPosition): Promise<void>;

  // ── 书签(C2~C4 真消费,C1 提供 method 但 view 暂不调)──

  bookmarkToggle(bookId: string, page: number): Promise<number[]>;
  bookmarkList(bookId: string): Promise<number[]>;
  cfiBookmarkAdd(
    bookId: string,
    cfi: string,
    label: string,
  ): Promise<Array<{ cfi: string; label: string }>>;
  cfiBookmarkRemove(
    bookId: string,
    cfi: string,
  ): Promise<Array<{ cfi: string; label: string }>>;
  cfiBookmarkList(bookId: string): Promise<Array<{ cfi: string; label: string }>>;

  // ── 标注(C5 真消费)──

  annotationList(bookId: string): Promise<StoredAnnotation[]>;
  annotationAdd(
    bookId: string,
    ann: Omit<StoredAnnotation, 'id' | 'createdAt'>,
  ): Promise<StoredAnnotation | null>;
  annotationRemove(bookId: string, annotationId: string): Promise<void>;
}
