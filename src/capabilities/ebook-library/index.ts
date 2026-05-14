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
  EBookInfo,
  EBookFileType,
  EBookStorageMode,
  EBookDataPayload,
  EBookLoadedInfo,
  PickFileResult,
  ReadingPosition,
} from './types';

export type {
  EBookLibraryApi,
  EBookInfo,
  EBookFileType,
  EBookStorageMode,
  EBookDataPayload,
  EBookLoadedInfo,
  PickFileResult,
  ReadingPosition,
} from './types';
// sub-phase 022: EBookEntry → EBookInfo 字面改名; EBookFolder / StoredAnnotation 报废.
// folder API caller 改走 folder capability + viewType='ebook'; annotation 概念消亡,
// view caller 改走 thought block (留 Step 5.5 / 5.6 落地).

// ── 书架 ──

export async function list(): Promise<EBookInfo[]> {
  if (!window.electronAPI?.ebookBookshelfList) return [];
  const r = await window.electronAPI.ebookBookshelfList();
  return Array.isArray(r) ? (r as EBookInfo[]) : [];
}

export async function get(id: string): Promise<EBookInfo | null> {
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
): Promise<EBookInfo | null> {
  if (!window.electronAPI?.ebookBookshelfAdd) return null;
  const r = await window.electronAPI.ebookBookshelfAdd(filePath, fileType, storage);
  return (r as EBookInfo | null) ?? null;
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

export async function relocate(id: string): Promise<EBookInfo | null> {
  if (!window.electronAPI?.ebookBookshelfRelocate) return null;
  const r = await window.electronAPI.ebookBookshelfRelocate(id);
  return (r as EBookInfo | null) ?? null;
}

export async function transferToManaged(id: string): Promise<EBookInfo | null> {
  if (!window.electronAPI?.ebookBookshelfTransferToManaged) return null;
  const r = await window.electronAPI.ebookBookshelfTransferToManaged(id);
  return (r as EBookInfo | null) ?? null;
}

// ── 文件夹 ── (sub-phase 022: 5 folder API 完整废弃,改走 folder capability + viewType='ebook'
//             沿决议 021 §4.3 + 决议 022 §1.3.2)

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
  callback: (list: EBookInfo[]) => void,
): () => void {
  if (!window.electronAPI?.onEbookBookshelfChanged) return () => {};
  return window.electronAPI.onEbookBookshelfChanged((raw) => {
    callback(Array.isArray(raw) ? (raw as EBookInfo[]) : []);
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

// ── 标注 ── (sub-phase 022: annotation 概念消亡 — 3 annotation API 完整废弃,
//             view caller 改走 thought block (留 Step 5.5 加 5 个 thought block 新 API))

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
  } satisfies EBookLibraryApi,
});
