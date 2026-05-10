/**
 * ebook-library capability — renderer 侧 KRIG eBook 数据能力封装(L5-C1)
 *
 * 职责:把 main 进程的 ebook 持久化能力(书架 + 文件夹 + 进度 + 书签 + 标注 + 数据传输)
 * 暴露给 view / 后续 ebook-rendering capability。view 不直触 storage(audit § R5)。
 *
 * 实现位置:src/platform/main/ebook/(bookshelf-store + annotation-store + file-loader
 * + library-handlers,合计 ~580 行,D-3=B JSON 起步)
 *
 * ── 下游消费者(规划)──
 *
 * - L5-C1 views/ebook/nav-side-content:书架 UI + 文件夹树 + ImportModal
 * - L5-C2 capabilities/ebook-rendering/Host:被动加载(订阅 onBookOpened → getData)
 * - L5-C4 capabilities/ebook-rendering/hooks:书签 + EPUB CFI 书签
 * - L5-C5 capabilities/ebook-rendering/annotation-layer:PDF 空间标注
 *
 * ── W5 严格态 A 边界(audit 2026-05-08 § 5.2)──
 *
 * - View 侧(强制):走 requireCapabilityApi('ebook-library').list(...) 间接路由
 * - Driver/slot 侧(允许):可直 import @capabilities/ebook-library 单例兜底
 *   ↑ 临时允许项,非全局严格态(B/C)达成态;后续 charter v0.5 升级时统一改造
 *
 * 模块级 export 同时挂(双导出),对齐 learning / ytdlp / tweet-fetcher 现有写法。
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type {
  EBookLibraryApi,
  EBookEntry,
  EBookFolder,
  EBookFileType,
  EBookStorageMode,
  EBookDataPayload,
  EBookLoadedInfo,
  PickFileResult,
  ReadingPosition,
  StoredAnnotation,
} from './types';

export type {
  EBookLibraryApi,
  EBookEntry,
  EBookFolder,
  EBookFileType,
  EBookStorageMode,
  EBookDataPayload,
  EBookLoadedInfo,
  PickFileResult,
  ReadingPosition,
  StoredAnnotation,
} from './types';

// ── 书架 ──

export async function list(): Promise<EBookEntry[]> {
  if (!window.electronAPI?.ebookBookshelfList) return [];
  const r = await window.electronAPI.ebookBookshelfList();
  return Array.isArray(r) ? (r as EBookEntry[]) : [];
}

export async function get(id: string): Promise<EBookEntry | null> {
  // 走 list 过滤(避免新增 GET_BY_ID IPC;书架规模 ≤ 几百本,过滤成本可忽略)
  const all = await list();
  return all.find((e) => e.id === id) ?? null;
}

export async function pickFile(): Promise<PickFileResult | null> {
  if (!window.electronAPI?.ebookPickFile) return null;
  const r = await window.electronAPI.ebookPickFile();
  return (r as PickFileResult | null) ?? null;
}

export async function add(
  filePath: string,
  fileType: EBookFileType,
  storage: EBookStorageMode,
): Promise<EBookEntry | null> {
  if (!window.electronAPI?.ebookBookshelfAdd) return null;
  const r = await window.electronAPI.ebookBookshelfAdd(filePath, fileType, storage);
  return (r as EBookEntry | null) ?? null;
}

export async function open(id: string): Promise<{ success: boolean; error?: string }> {
  if (!window.electronAPI?.ebookBookshelfOpen) return { success: false, error: 'no api' };
  const r = await window.electronAPI.ebookBookshelfOpen(id);
  return (r as { success: boolean; error?: string }) ?? { success: false };
}

export async function remove(id: string): Promise<void> {
  if (!window.electronAPI?.ebookBookshelfRemove) return;
  return window.electronAPI.ebookBookshelfRemove(id);
}

export async function rename(id: string, displayName: string): Promise<void> {
  if (!window.electronAPI?.ebookBookshelfRename) return;
  return window.electronAPI.ebookBookshelfRename(id, displayName);
}

export async function moveToFolder(id: string, folderId: string | null): Promise<void> {
  if (!window.electronAPI?.ebookBookshelfMove) return;
  return window.electronAPI.ebookBookshelfMove(id, folderId);
}

export async function relocate(id: string): Promise<EBookEntry | null> {
  if (!window.electronAPI?.ebookBookshelfRelocate) return null;
  const r = await window.electronAPI.ebookBookshelfRelocate(id);
  return (r as EBookEntry | null) ?? null;
}

export async function transferToManaged(id: string): Promise<EBookEntry | null> {
  if (!window.electronAPI?.ebookBookshelfTransferToManaged) return null;
  const r = await window.electronAPI.ebookBookshelfTransferToManaged(id);
  return (r as EBookEntry | null) ?? null;
}

// ── 文件夹 ──

export async function folderList(): Promise<EBookFolder[]> {
  if (!window.electronAPI?.ebookFolderList) return [];
  const r = await window.electronAPI.ebookFolderList();
  return Array.isArray(r) ? (r as EBookFolder[]) : [];
}

export async function folderCreate(
  title: string,
  parentId?: string | null,
): Promise<EBookFolder | null> {
  if (!window.electronAPI?.ebookFolderCreate) return null;
  const r = await window.electronAPI.ebookFolderCreate(title, parentId ?? null);
  return (r as EBookFolder | null) ?? null;
}

export async function folderRename(id: string, title: string): Promise<void> {
  if (!window.electronAPI?.ebookFolderRename) return;
  return window.electronAPI.ebookFolderRename(id, title);
}

export async function folderDelete(id: string): Promise<void> {
  if (!window.electronAPI?.ebookFolderDelete) return;
  return window.electronAPI.ebookFolderDelete(id);
}

export async function folderMove(id: string, parentId: string | null): Promise<void> {
  if (!window.electronAPI?.ebookFolderMove) return;
  return window.electronAPI.ebookFolderMove(id, parentId);
}

// ── 数据传输 ──

export async function getData(): Promise<EBookDataPayload | null> {
  if (!window.electronAPI?.ebookGetData) return null;
  const r = await window.electronAPI.ebookGetData();
  return (r as EBookDataPayload | null) ?? null;
}

export async function close(): Promise<void> {
  if (!window.electronAPI?.ebookClose) return;
  return window.electronAPI.ebookClose();
}

// ── 推送订阅(多订阅模式,对齐 learning.onVocabChanged)──

export function onBookshelfChanged(
  callback: (list: EBookEntry[]) => void,
): () => void {
  if (!window.electronAPI?.onEbookBookshelfChanged) return () => {};
  return window.electronAPI.onEbookBookshelfChanged((raw) => {
    callback(Array.isArray(raw) ? (raw as EBookEntry[]) : []);
  });
}

export function onBookOpened(callback: (info: EBookLoadedInfo) => void): () => void {
  if (!window.electronAPI?.onEbookLoaded) return () => {};
  return window.electronAPI.onEbookLoaded((raw) => {
    if (raw && typeof raw === 'object') callback(raw as EBookLoadedInfo);
  });
}

// ── 进度 ──

export async function saveProgress(
  bookId: string,
  position: ReadingPosition,
): Promise<void> {
  if (!window.electronAPI?.ebookSaveProgress) return;
  return window.electronAPI.ebookSaveProgress(bookId, position);
}

// ── 书签(C2~C4 真消费,C1 提供 method 但 view 暂不调)──

export async function bookmarkToggle(bookId: string, page: number): Promise<number[]> {
  if (!window.electronAPI?.ebookBookmarkToggle) return [];
  return window.electronAPI.ebookBookmarkToggle(bookId, page);
}

export async function bookmarkList(bookId: string): Promise<number[]> {
  if (!window.electronAPI?.ebookBookmarkList) return [];
  return window.electronAPI.ebookBookmarkList(bookId);
}

export async function cfiBookmarkAdd(
  bookId: string,
  cfi: string,
  label: string,
): Promise<Array<{ cfi: string; label: string }>> {
  if (!window.electronAPI?.ebookCfiBookmarkAdd) return [];
  const r = await window.electronAPI.ebookCfiBookmarkAdd(bookId, cfi, label);
  return Array.isArray(r) ? (r as Array<{ cfi: string; label: string }>) : [];
}

export async function cfiBookmarkRemove(
  bookId: string,
  cfi: string,
): Promise<Array<{ cfi: string; label: string }>> {
  if (!window.electronAPI?.ebookCfiBookmarkRemove) return [];
  const r = await window.electronAPI.ebookCfiBookmarkRemove(bookId, cfi);
  return Array.isArray(r) ? (r as Array<{ cfi: string; label: string }>) : [];
}

export async function cfiBookmarkList(
  bookId: string,
): Promise<Array<{ cfi: string; label: string }>> {
  if (!window.electronAPI?.ebookCfiBookmarkList) return [];
  const r = await window.electronAPI.ebookCfiBookmarkList(bookId);
  return Array.isArray(r) ? (r as Array<{ cfi: string; label: string }>) : [];
}

// ── 标注(C5 真消费)──

export async function annotationList(bookId: string): Promise<StoredAnnotation[]> {
  if (!window.electronAPI?.ebookAnnotationList) return [];
  const r = await window.electronAPI.ebookAnnotationList(bookId);
  return Array.isArray(r) ? (r as StoredAnnotation[]) : [];
}

export async function annotationAdd(
  bookId: string,
  ann: Omit<StoredAnnotation, 'id' | 'createdAt'>,
): Promise<StoredAnnotation | null> {
  if (!window.electronAPI?.ebookAnnotationAdd) return null;
  const r = await window.electronAPI.ebookAnnotationAdd(bookId, ann);
  return (r as StoredAnnotation | null) ?? null;
}

export async function annotationRemove(
  bookId: string,
  annotationId: string,
): Promise<void> {
  if (!window.electronAPI?.ebookAnnotationRemove) return;
  return window.electronAPI.ebookAnnotationRemove(bookId, annotationId);
}

// W5 严格态:Registry 注册 + api 字段(view 通过 requireCapabilityApi 间接路由)
// W5 边界 A 临时允许项:同时保留模块级 export(driver/slot 内部消费可直 import)
capabilityRegistry.register({
  id: 'ebook-library',
  api: {
    list,
    get,
    pickFile,
    add,
    open,
    remove,
    rename,
    moveToFolder,
    relocate,
    transferToManaged,
    folderList,
    folderCreate,
    folderRename,
    folderDelete,
    folderMove,
    getData,
    close,
    onBookshelfChanged,
    onBookOpened,
    saveProgress,
    bookmarkToggle,
    bookmarkList,
    cfiBookmarkAdd,
    cfiBookmarkRemove,
    cfiBookmarkList,
    annotationList,
    annotationAdd,
    annotationRemove,
  } satisfies EBookLibraryApi,
});
