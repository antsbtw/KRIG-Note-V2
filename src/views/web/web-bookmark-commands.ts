/**
 * Web 书签命令注册(书签步骤2)
 *
 * 命令 id 命名空间 `web-view.bm-*`(对齐 ebook-view.* 书架命令的形态)。
 * navSide headerExtra 按钮 / context-menu / keymap 都通过字符串引用走 commandRegistry。
 *
 * 仿 src/views/ebook/bookshelf-commands.ts(书架),但精简:
 * - 没有 import modal(书签靠「+书签」加当前页,Chrome 导入留步骤3)
 * - 没有重新定位 / 转管理
 *
 * tree id 编码区分 bookmark / folder,decode 后按 type 分派:
 * - bookmark 走 bookmark capability(add/list/rename/remove/moveToFolder)
 * - folder   走 folder capability(viewType='web')
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { BookmarkApi } from '@capabilities/bookmark/types';
import type { FolderCapabilityApi } from '@capabilities/folder/types';
import { getWebWsState } from './data-model';
import { getAllHistory } from './web-history';

/** 拿当前活跃 workspace id(commands 由用户在某 ws 触发,默认作用于活跃 ws)*/
function getActiveWorkspaceId(): string | null {
  return workspaceManager.getActiveId();
}

/**
 * 「+书签」标题来源:活跃 tab 的 url 在历史里能查到 title 就用之,
 * 否则用 url 的 hostname 兜底(data-model tab schema 只持久化 url,不存 title)。
 */
function titleForUrl(url: string): string {
  const hit = getAllHistory().find((e) => e.url === url);
  if (hit && hit.title) return hit.title;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** 只允许给 http(s) 页加书签(about:blank / data: / file: 等 no-op)。 */
function isBookmarkable(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p === 'http:' || p === 'https:';
  } catch {
    return false;
  }
}

export function registerWebBookmarkCommands(): void {
  // 创建文件夹(根目录)— folder capability + viewType='web'
  commandRegistry.register('web-view.bm-create-folder', async () => {
    const folder = requireCapabilityApi<FolderCapabilityApi>('folder');
    const created = await folder.createFolder('新建文件夹', null, 'web');
    if (created) {
      // 自动展开书签段,让用户看到新建结果(用户反馈)
      pendingSectionOpenTrigger?.();
      // 创建后进重命名态(走 setFolderCreatedTrigger 桥)
      pendingFolderCreatedTrigger?.(created.id);
    }
  });

  // 在指定文件夹下新建子文件夹(右键 → "在此新建文件夹")
  commandRegistry.register('web-view.bm-create-folder-in', async (parentId: unknown) => {
    if (typeof parentId !== 'string' || !parentId) return;
    const folder = requireCapabilityApi<FolderCapabilityApi>('folder');
    const created = await folder.createFolder('新建文件夹', parentId, 'web');
    if (created) {
      pendingSectionOpenTrigger?.();
      // 自动展开父(由 view 端 trigger 接管 — 见 nav-side-content)
      pendingFolderExpandTrigger?.(parentId);
      pendingFolderCreatedTrigger?.(created.id);
    }
  });

  // 加书签(当前活跃 tab 的 url + title;about:blank 等非 http(s) → no-op + 提示)
  commandRegistry.register('web-view.bm-add', async (folderArg: unknown) => {
    const wsId = getActiveWorkspaceId();
    if (!wsId) return;
    const ws = workspaceManager.get(wsId);
    if (!ws) return;
    const state = getWebWsState(ws);
    const active = state.tabs.find((t) => t.id === state.activeTabId);
    const url = active?.url ?? '';
    if (!isBookmarkable(url)) {
      pendingNoticeTrigger?.('当前页面无法加入书签');
      return;
    }
    const folderId = typeof folderArg === 'string' && folderArg ? folderArg : null;
    const bookmark = requireCapabilityApi<BookmarkApi>('bookmark');
    const created = await bookmark.add(url, titleForUrl(url), folderId);
    if (created) {
      // 自动展开书签段,让用户看到新增结果(用户反馈)
      pendingSectionOpenTrigger?.();
      pendingNoticeTrigger?.('已加入书签');
    }
  });

  // 重命名 — 真实改名由 nav-side-content 的 inline rename 提交时调
  commandRegistry.register('web-view.bm-rename', (treeId: unknown) => {
    if (typeof treeId !== 'string' || !treeId) return;
    pendingRenameTrigger?.(treeId);
  });

  // 删除单项(bookmark / folder 分派)
  commandRegistry.register('web-view.bm-delete', async (treeId: unknown) => {
    if (typeof treeId !== 'string' || !treeId) return;
    const { type, id } = decodeTreeId(treeId);
    if (type === 'bookmark') {
      const bookmark = requireCapabilityApi<BookmarkApi>('bookmark');
      await bookmark.remove(id);
    } else {
      // folder 删除走 folder capability(viewType='web' 自带 cascade)
      const folder = requireCapabilityApi<FolderCapabilityApi>('folder');
      await folder.deleteFolder(id);
    }
  });

  // 打开书签(单击 / Enter)→ 在右栏活跃 tab 打开 url
  commandRegistry.register('web-view.bm-open', async (bookmarkId: unknown) => {
    if (typeof bookmarkId !== 'string' || !bookmarkId) return;
    const bookmark = requireCapabilityApi<BookmarkApi>('bookmark');
    const list = await bookmark.list();
    const hit = list.find((b) => b.id === bookmarkId);
    if (hit) {
      commandRegistry.execute('web-view.open-url', hit.url);
    }
  });

  // 移出文件夹(书签 → 根目录)
  commandRegistry.register('web-view.bm-move-out', async (bookmarkId: unknown) => {
    if (typeof bookmarkId !== 'string' || !bookmarkId) return;
    const bookmark = requireCapabilityApi<BookmarkApi>('bookmark');
    await bookmark.moveToFolder(bookmarkId, null);
  });
}

// ── 桥接器(nav-side-content mount 时挂上,unmount 清掉)──

let pendingRenameTrigger: ((treeId: string) => void) | null = null;
let pendingFolderCreatedTrigger: ((folderId: string) => void) | null = null;
let pendingFolderExpandTrigger: ((folderId: string) => void) | null = null;
let pendingNoticeTrigger: ((message: string) => void) | null = null;
let pendingSectionOpenTrigger: (() => void) | null = null;

export function setRenameTrigger(cb: ((treeId: string) => void) | null): void {
  pendingRenameTrigger = cb;
}

/** 展开书签折叠段(加书签/建文件夹后调,让用户看到结果)。 */
export function setSectionOpenTrigger(cb: (() => void) | null): void {
  pendingSectionOpenTrigger = cb;
}

export function setFolderCreatedTrigger(cb: ((folderId: string) => void) | null): void {
  pendingFolderCreatedTrigger = cb;
}

export function setFolderExpandTrigger(cb: ((folderId: string) => void) | null): void {
  pendingFolderExpandTrigger = cb;
}

export function setNoticeTrigger(cb: ((message: string) => void) | null): void {
  pendingNoticeTrigger = cb;
}

// ── tree id 编码(bookmark / folder)──

export function encodeTreeId(type: 'bookmark' | 'folder', id: string): string {
  return `${type === 'folder' ? 'f' : 'b'}:${id}`;
}

export function decodeTreeId(treeId: string): { type: 'bookmark' | 'folder'; id: string } {
  return {
    type: treeId.startsWith('f:') ? 'folder' : 'bookmark',
    id: treeId.slice(2),
  };
}
