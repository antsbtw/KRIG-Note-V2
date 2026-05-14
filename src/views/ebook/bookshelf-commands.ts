/**
 * EBookView 命令注册(L5-C1)
 *
 * 命令 id 命名空间 `ebook-view.*`(对齐 note-view.* / web-view.*)。
 * navSide actions / context-menu / keymap 都通过字符串引用走 commandRegistry。
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { EBookLibraryApi } from '@capabilities/ebook-library/types';
import type { FolderCapabilityApi } from '@capabilities/folder/types';
import { getEBookWsState, setActiveBookId, setFolderExpanded } from './data-model';

/** 拿当前活跃 workspace id(commands 由用户在某 ws 触发,默认作用于活跃 ws)*/
function getActiveWorkspaceId(): string | null {
  return workspaceManager.getActiveId();
}

/** import 流程:pickFile + 弹 ImportModal(由 nav-side-content 接管 modal UI) */
let pendingImportTrigger: (() => void) | null = null;

/** nav-side-content 注册 modal 触发器 */
export function setImportTrigger(cb: (() => void) | null): void {
  pendingImportTrigger = cb;
}

export function registerEBookCommands(): void {
  // 导入电子书 — 触发 modal,真实导入由 modal confirm 走 library.add()
  commandRegistry.register('ebook-view.import', () => {
    pendingImportTrigger?.();
  });

  // 创建文件夹(根目录) — sub-phase 022: 走 folder capability + viewType='ebook'
  commandRegistry.register('ebook-view.create-folder', async () => {
    const folder = requireCapabilityApi<FolderCapabilityApi>('folder');
    const created = await folder.createFolder('新建文件夹', null, 'ebook');
    if (created) {
      // 创建后让 nav-side-content 进入重命名态(走 setRenameTrigger 桥)
      pendingFolderCreatedTrigger?.(created.id);
    }
  });

  // 在指定文件夹下新建子文件夹(右键 → "在此新建文件夹")
  commandRegistry.register('ebook-view.create-folder-in', async (parentId: unknown) => {
    if (typeof parentId !== 'string' || !parentId) return;
    const folder = requireCapabilityApi<FolderCapabilityApi>('folder');
    const created = await folder.createFolder('新建文件夹', parentId, 'ebook');
    if (created) {
      // 自动展开父
      const wsId = getActiveWorkspaceId();
      if (wsId) setFolderExpanded(wsId, parentId, true);
      pendingFolderCreatedTrigger?.(created.id);
    }
  });

  // 打开书(单击书项)— 失败由 view 端 toast 处理
  commandRegistry.register('ebook-view.open-book', async (bookId: unknown) => {
    if (typeof bookId !== 'string' || !bookId) return;
    const library = requireCapabilityApi<EBookLibraryApi>('ebook-library');
    const result = await library.open(bookId);
    if (result.success) {
      const wsId = getActiveWorkspaceId();
      if (wsId) setActiveBookId(wsId, bookId);
    } else {
      pendingOpenFailedTrigger?.(bookId, result.error ?? 'unknown');
    }
  });

  // 重命名 — 真实改名由 nav-side-content 的 inline rename 提交时调 library.rename()
  commandRegistry.register('ebook-view.rename', (treeId: unknown) => {
    if (typeof treeId !== 'string' || !treeId) return;
    pendingRenameTrigger?.(treeId);
  });

  // 删除单项
  commandRegistry.register('ebook-view.delete', async (treeId: unknown) => {
    if (typeof treeId !== 'string' || !treeId) return;
    const { type, id } = decodeTreeId(treeId);
    const library = requireCapabilityApi<EBookLibraryApi>('ebook-library');
    if (type === 'book') {
      await library.remove(id);
      const wsId = getActiveWorkspaceId();
      if (wsId) {
        const ws = workspaceManager.get(wsId);
        if (ws && getEBookWsState(ws).activeBookId === id) {
          setActiveBookId(wsId, null);
        }
      }
    } else {
      // sub-phase 022: folder 删除走 folder capability (FolderViewType='ebook' 已自带 cascade)
      const folder = requireCapabilityApi<FolderCapabilityApi>('folder');
      await folder.deleteFolder(id);
    }
  });

  // 移出文件夹(书 → 根目录)
  commandRegistry.register('ebook-view.move-out', async (bookId: unknown) => {
    if (typeof bookId !== 'string' || !bookId) return;
    const library = requireCapabilityApi<EBookLibraryApi>('ebook-library');
    await library.moveToFolder(bookId, null);
  });

  // 重新定位(D-5,link 模式文件丢失时)
  commandRegistry.register('ebook-view.relocate', async (bookId: unknown) => {
    if (typeof bookId !== 'string' || !bookId) return;
    const library = requireCapabilityApi<EBookLibraryApi>('ebook-library');
    await library.relocate(bookId);
  });

  // link → managed 转托管
  commandRegistry.register('ebook-view.transfer-to-managed', async (bookId: unknown) => {
    if (typeof bookId !== 'string' || !bookId) return;
    const library = requireCapabilityApi<EBookLibraryApi>('ebook-library');
    await library.transferToManaged(bookId);
  });
}

// ── 桥接器(nav-side-content mount 时挂上,unmount 清掉)──

let pendingRenameTrigger: ((treeId: string) => void) | null = null;
let pendingFolderCreatedTrigger: ((folderId: string) => void) | null = null;
let pendingOpenFailedTrigger: ((bookId: string, error: string) => void) | null = null;

export function setRenameTrigger(cb: ((treeId: string) => void) | null): void {
  pendingRenameTrigger = cb;
}

export function setFolderCreatedTrigger(cb: ((folderId: string) => void) | null): void {
  pendingFolderCreatedTrigger = cb;
}

export function setOpenFailedTrigger(cb: ((bookId: string, error: string) => void) | null): void {
  pendingOpenFailedTrigger = cb;
}

// ── tree id 编码(book / folder)──

export function encodeTreeId(type: 'book' | 'folder', id: string): string {
  return `${type === 'folder' ? 'f' : 'b'}:${id}`;
}

export function decodeTreeId(treeId: string): { type: 'book' | 'folder'; id: string } {
  return {
    type: treeId.startsWith('f:') ? 'folder' : 'book',
    id: treeId.slice(2),
  };
}
