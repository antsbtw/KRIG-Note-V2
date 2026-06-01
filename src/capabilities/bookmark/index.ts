/**
 * bookmark capability — renderer 侧封装 (web view 书签树, 书签步骤1 数据层)
 *
 * 职责:把 main 进程的 bookmark 持久化能力(add/list/rename/remove/moveToFolder
 * + onListChanged 广播)暴露给 web view。view 不直触 storage。
 *
 * 文件夹分类复用 folder capability + viewType='web'(本 capability 只管书签本体)。
 *
 * 实现位置:src/platform/main/bookmark/(capability-impl + handlers)。
 *
 * 模板对齐 src/capabilities/ebook-library/index.ts:
 * - 模块级 export(driver/slot 内部可直 import)
 * - capabilityRegistry.register(view 走 requireCapabilityApi<BookmarkApi>('bookmark'))
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type { BookmarkApi, BookmarkInfo } from './types';

export type { BookmarkApi, BookmarkInfo } from './types';

export async function add(
  url: string,
  title: string,
  folderId?: string | null,
): Promise<BookmarkInfo> {
  const r = await window.electronAPI?.bookmarkAdd(url, title, folderId ?? null);
  // main 端 add 必返 BookmarkInfo;无 api(非 electron 环境)时兜底本地对象
  return (
    (r as BookmarkInfo | null) ?? {
      id: '',
      url,
      title: title || url,
      folderId: folderId ?? null,
      createdAt: Date.now(),
    }
  );
}

export async function list(): Promise<BookmarkInfo[]> {
  if (!window.electronAPI?.bookmarkList) return [];
  const r = await window.electronAPI.bookmarkList();
  return Array.isArray(r) ? (r as BookmarkInfo[]) : [];
}

export async function rename(id: string, title: string): Promise<void> {
  if (!window.electronAPI?.bookmarkRename) return;
  return window.electronAPI.bookmarkRename(id, title);
}

export async function remove(id: string): Promise<void> {
  if (!window.electronAPI?.bookmarkRemove) return;
  return window.electronAPI.bookmarkRemove(id);
}

export async function moveToFolder(id: string, folderId: string | null): Promise<void> {
  if (!window.electronAPI?.bookmarkMove) return;
  return window.electronAPI.bookmarkMove(id, folderId);
}

export function onListChanged(callback: () => void): () => void {
  if (!window.electronAPI?.onBookmarkListChanged) return () => {};
  return window.electronAPI.onBookmarkListChanged(() => callback());
}

// W5 严格态:Registry 注册 + api 字段(view 通过 requireCapabilityApi 间接路由)
// W5 边界 A 临时允许项:同时保留模块级 export(driver/slot 内部消费可直 import)
capabilityRegistry.register({
  id: 'bookmark',
  api: {
    add,
    list,
    rename,
    remove,
    moveToFolder,
    onListChanged,
  } satisfies BookmarkApi,
});
