/**
 * EBookView 命令注册(L5-C1)
 *
 * 命令 id 命名空间 `ebook-view.*`(对齐 note-view.* / web-view.*)。
 * navSide actions / context-menu / keymap 都通过字符串引用走 commandRegistry。
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { registerWsCommand } from '@slot/command-registry/register-ws-command';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import type { EBookLibraryApi } from '@capabilities/ebook-library/types';
import type { FolderCapabilityApi } from '@capabilities/folder/types';
import { getInvokingSlot } from '@slot/toolbar-registry/toolbar-invocation';
import { getActiveSlot } from '@workspace/workspace-state/active-slot';
import {
  getEBookWsState,
  getActiveBookId,
  setActiveBookId,
  setFolderExpanded,
  type EBookSlot,
} from './data-model';

/**
 * 命令的目标槽 —— 两个来源按优先级合成,**只此一处**合成(与 note-commands 同形)。
 *
 * 1. getInvokingSlot() — 调用方显式携带的槽(toolbar 按钮点击栈),最强证据
 * 2. getActiveSlot(wsId) — 用户焦点所在栏(单一来源),用于没有调用栈上下文的
 *    路径:书架树点击 / 快捷键 / 程序调用
 *
 * 这不是第二处「当前是哪个槽」——「当前槽」的答案始终只有 activeSlot 一个;
 * invokingSlot 回答的是「这条命令由谁触发」,两者语义正交,故可合成。
 */
function targetSlot(wsId: string): EBookSlot {
  return getInvokingSlot() ?? getActiveSlot(wsId);
}

/**
 * 确保**指定槽**装的是 'ebook-view'。
 *
 * 原实现是「左右任一已是 ebook-view 就不动,否则切 left」—— 那只回答「整个 ws
 * 有地方显书吗」。书架点击跟随活跃槽后必须按槽问:焦点在右栏而右栏装着 note 时,
 * 老逻辑会因「左栏已是 ebook-view」直接返回,于是 rightActiveBookId 写了但没人
 * 渲染 = 书开进虚空(与 note 侧 ensureNoteViewInSlot 同一个坑)。
 */
function ensureEBookViewInSlot(wsId: string, slot: EBookSlot): void {
  const ws = workspaceManager.get(wsId);
  if (!ws) return;
  if (ws.slotBinding[slot] === 'ebook-view') return;
  workspaceManager.update(wsId, {
    slotBinding:
      slot === 'right'
        ? { ...ws.slotBinding, right: 'ebook-view', rightPayload: undefined }
        : { ...ws.slotBinding, left: 'ebook-view', leftPayload: undefined },
  });
}

/** import 流程:pickFile + 弹 ImportModal(由 nav-side-content 接管 modal UI) */
let pendingImportTrigger: (() => void) | null = null;

/** nav-side-content 注册 modal 触发器 */
export function setImportTrigger(cb: (() => void) | null): void {
  pendingImportTrigger = cb;
}

export function registerEBookCommands(wsId: string): void {
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
  registerWsCommand('ebook-view.create-folder-in', () => wsId, async (ctx, parentId: unknown) => {
    if (typeof parentId !== 'string' || !parentId) return;
    const folder = requireCapabilityApi<FolderCapabilityApi>('folder');
    const created = await folder.createFolder('新建文件夹', parentId, 'ebook');
    if (created) {
      // 自动展开父
      setFolderExpanded(ctx.wsId, parentId, true);
      pendingFolderCreatedTrigger?.(created.id);
    }
  });

  // 打开书(单击书项)
  // 只写 activeBookId + 确保 slot，不在命令层调 library.open。
  // EBookView 的 useEffect 监测 activeBookId 变化后自己 open，那时 Host 已挂载
  // ——顺带保证了 requester 一定是**本槽自己**填的,命令层不用操心身份透传。
  registerWsCommand('ebook-view.open-book', () => wsId, (ctx, bookId: unknown) => {
    if (typeof bookId !== 'string' || !bookId) return;
    // 目标槽 = 触发栏(toolbar/浮层)优先,否则用户焦点所在栏。
    // 与 note-commands 的 targetSlot() 同形:activeSlot 是唯一来源,
    // invokingSlot 回答的是另一个问题(这条命令由谁触发),二者正交故可合成。
    const slot = targetSlot(ctx.wsId);
    setActiveBookId(ctx.wsId, bookId, slot);
    ensureEBookViewInSlot(ctx.wsId, slot);
  });

  /**
   * 在**另一栏**打开(书架右键项)——「另一栏」= 活跃槽的对侧。
   *
   * 与 note 的 note-view.open-in-other-slot 同形:左键已跟随活跃槽,故固定
   * 「在右栏打开」在焦点已是右栏时就成了左键的同义项;「另一栏」永远表达
   * 「送到我没在看的那一栏,开个对照」。对照阅读正是 eBook 分屏的核心用法。
   */
  registerWsCommand('ebook-view.open-book-in-other-slot', () => wsId, (ctx, bookId: unknown) => {
    if (typeof bookId !== 'string' || !bookId) return;
    const other: EBookSlot = getActiveSlot(ctx.wsId) === 'right' ? 'left' : 'right';
    setActiveBookId(ctx.wsId, bookId, other);
    ensureEBookViewInSlot(ctx.wsId, other);
  });

  // 重命名 — 真实改名由 nav-side-content 的 inline rename 提交时调 library.rename()
  commandRegistry.register('ebook-view.rename', (treeId: unknown) => {
    if (typeof treeId !== 'string' || !treeId) return;
    pendingRenameTrigger?.(treeId);
  });

  // 删除单项
  registerWsCommand('ebook-view.delete', () => wsId, async (ctx, treeId: unknown) => {
    if (typeof treeId !== 'string' || !treeId) return;
    const { type, id } = decodeTreeId(treeId);
    const library = requireCapabilityApi<EBookLibraryApi>('ebook-library');
    if (type === 'book') {
      await library.remove(id);
      // 删书要清**两个槽**:原实现只看 activeBookId(left),右栏若正开着这本
      // 会留下一个指向已删书的 rightActiveBookId(重启后加载失败)。
      const ws = workspaceManager.get(ctx.wsId);
      if (ws) {
        const state = getEBookWsState(ws);
        for (const s of ['left', 'right'] as const) {
          if (getActiveBookId(state, s) === id) setActiveBookId(ctx.wsId, null, s);
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

  // ⊞ Toolbar 视图切换:在右槽打开 commandArg=viewId(对齐 note-view.open-right-slot)
  registerWsCommand('ebook-view.open-right-slot', () => wsId, (ctx, arg: unknown) => {
    const bus = workspaceManager.getBus(ctx.wsId);
    if (!bus) return;
    if (typeof arg === 'string') {
      bus.slot.openRight(arg);
    } else if (arg && typeof arg === 'object' && 'viewId' in arg) {
      const { viewId, subId } = arg as { viewId: string; subId: string };
      bus.slot.openRight(viewId, { subId });
    }
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
