/**
 * ebook-library capability — 对外类型 (L5-C1)
 *
 * view 通过 requireCapabilityApi<EBookLibraryApi>('ebook-library') 取 api;
 * driver/slot 内部消费可直 import 单例 export (对齐 W5 严格态 A 边界).
 *
 * sub-phase 022 (decision 022 §4.1.5):
 * - EBookEntry / EBookFolder / StoredAnnotation 三 interface 定义已迁到
 *   shared/ipc/ebook-types.ts (沿 NoteInfo / FolderInfo SSOT 模式).
 * - EBookEntry → EBookInfo 字面改名 + 派生 folderId / lastOpenedAt /
 *   lastPosition 高频字段聚合视图.
 * - StoredAnnotation 完整删除 (annotation 概念消亡, 沿 §0.5 用户 P0 纪律).
 * - 本文件保留 EBookLibraryApi (capability 对外接口 SSOT, 沿 NoteCapabilityApi /
 *   FolderCapabilityApi 同 V2 现状位置) + re-export shared/ipc 字面跨进程基础类型
 *   (让 caller 字面继续字面 from '@capabilities/ebook-library/types' 字面消费).
 */

// Re-export 跨进程基础类型 (SSOT 在 src/shared/ipc/ebook-types.ts, 沿决议 022 §4.1.5)
export type {
  EBookFileType,
  EBookStorageMode,
  ReadingPosition,
  EBookInfo,
  ReadingStateInfo,
  PickFileResult,
  EBookDataPayload,
  EBookLoadedInfo,
} from '@shared/ipc/ebook-types';

import type {
  EBookFileType,
  EBookStorageMode,
  ReadingPosition,
  EBookInfo,
  PickFileResult,
  EBookDataPayload,
  EBookLoadedInfo,
} from '@shared/ipc/ebook-types';

// ── view 业务路径 API ──

export interface EBookLibraryApi {
  // ── 书架 ──

  /** 全量书架 (按 lastOpenedAt 倒序) */
  list(): Promise<EBookInfo[]>;
  /** 按 id 取单本; 不存在返 null */
  get(id: string): Promise<EBookInfo | null>;
  /** 弹文件对话框选 PDF/EPUB/DJVU/CBZ; 取消返 null */
  pickFile(): Promise<PickFileResult | null>;
  /**
   * 添加书 + 自动加载到 main 内存 + 推 EBOOK_LOADED.
   * managed=复制到 library; link=只记路径
   */
  add(
    filePath: string,
    fileType: EBookFileType,
    storage: EBookStorageMode,
  ): Promise<EBookInfo | null>;
  /** 打开书 — 加载到 main 内存 + 推 EBOOK_LOADED; 失败返错误对象 */
  open(id: string): Promise<{ success: boolean; error?: string }>;
  remove(id: string): Promise<void>;
  rename(id: string, displayName: string): Promise<void>;
  moveToFolder(id: string, folderId: string | null): Promise<void>;
  /** D-5: 文件不存在时弹 dialog 选新路径, 更新 entry.filePath */
  relocate(id: string): Promise<EBookInfo | null>;
  /** link → managed: 复制文件到 library + 更新元数据 */
  transferToManaged(id: string): Promise<EBookInfo | null>;

  // ── 数据传输 (view ← main 拿当前已加载的 buffer) ──

  /**
   * 取 main 当前已加载的电子书 buffer.
   * 只在 onBookOpened 推流后调, 否则返 null (未加载)
   */
  getData(): Promise<EBookDataPayload | null>;
  /** 关闭当前书, 释放 main 端 buffer */
  close(): Promise<void>;

  // ── 推送订阅 ──

  /** 订阅书架变化 — 返回 unsubscribe */
  onBookshelfChanged(callback: (list: EBookInfo[]) => void): () => void;
  /** 订阅"书已加载"通知 — view 收到后调 getData() 拿 buffer */
  onBookOpened(callback: (info: EBookLoadedInfo) => void): () => void;

  // ── 进度 ──

  saveProgress(bookId: string, position: ReadingPosition): Promise<void>;

  // ── 书签 (C2~C4 真消费, C1 提供 method 但 view 暂不调) ──

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

  // 注: sub-phase 022 删除 5 folder API (folderList / folderCreate / folderRename /
  // folderDelete / folderMove) — 决议 021 §4.3 兼容约束落地, view caller 改走
  // folder capability + viewType='ebook' (Step 5.6 实施).
  //
  // 注: sub-phase 022 删除 3 annotation API (annotationList / annotationAdd /
  // annotationRemove) — annotation 概念消亡, view caller 改走 thought block
  // 新 API (Step 5.5 + Step 5.6 实施).
  //
  // 5 新 thought block 级 API 字面 (getReadingThought / ensureReadingThought /
  // addReadingThoughtBlock / removeReadingThoughtBlock /
  // getReadingThoughtAnnotations) 字面 Step 5.5 实施时加入本 interface.
}
