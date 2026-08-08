/**
 * NoteView 命令注册(C7 拆分:仅留 view 业务命令;PM 通用命令已迁 capability)
 *
 * 当前注册的 22 个 view 业务命令(C0 README §三 §🟢 决议):
 *   笔记 CRUD(4):create-note / set-active / set-active-in-right / delete-active
 *   文件夹 CRUD(4):create-folder / delete-by-tree-id / copy-by-tree-id / paste
 *   文件夹排序(2):sort-cycle-title / sort-cycle-date
 *   Note 导航历史(2):go-back / go-forward
 *   业务依赖(1):handle-copy-block-link(依 noteId)
 *   Learning 业务(2):cm-dictionary-lookup / cm-translate-text
 *   业务插入(7):slash-insert-{image,table,audio,video,tweet,file-block,external-ref}
 *
 * 已迁(text-editing capability 自注册,见 capabilities/text-editing/commands/register-pm-commands.ts):
 *   PM 通用 46 个 — Marks 5 / Heading 1 / Color 2 / History 2 / Slash turn 12 /
 *                  Math 2 / Handle turn 11 / Handle action 3 / Context menu 7 /
 *                  Popup link 1
 *   handle-copy-block 顺手修了丢格式 bug(D-5):driver getBlockClipboardAt 返双
 *   envelope(text/html + text/plain),粘回 KRIG 内 PM smart-paste 还原原 block。
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { registerWsCommand } from '@slot/command-registry/register-ws-command';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import { handleMenuController } from '@slot/triggers/handle-menu-controller';
import { getInvokingSlot } from '@slot/toolbar-registry/toolbar-invocation';
import { getActiveSlot } from '@workspace/workspace-state/active-slot';
import { otherSlot } from '@workspace/workspace-state/slot-resource';
import {
  createNote,
  setActiveNote,
  getNoteWsState,
  getActiveNoteId,
  createFolder,
  cycleSortByTitle,
  cycleSortByDate,
  setSelectedIds,
  noteInstanceId,
  type NoteSlot,
} from './data-model';
import {
  copyToClipboard,
  pasteFromClipboard,
  deleteSelected,
  deleteTreeIdsWithProgress,
} from './tree-operations';
import { encodeNoteId, encodeFolderId } from './tree-builder';
import { triggerRename } from './context-menu-registrations';
import type { FolderCapabilityApi } from '@capabilities/folder/types';
import { goBack as historyGoBack, goForward as historyGoForward, canGoBack, canGoForward } from './note-navigation-history';
import { buildAITurnPmNodes } from './ai-sync-blocks';
import type { AISyncTurn, AIServiceId } from '@capabilities/ai-extraction/types';
import { tocToggleStore } from './toc/toc-toggle-store';

/**
 * lazy getter — 命令 handler 内部用,避免 module load 时 require
 * (capability 注册副作用顺序敏感),每次调用拿最新 api。
 */
function tea(): TextEditingApi['api'] {
  return requireCapabilityApi<TextEditingApi>('text-editing').api;
}

/**
 * 确保当前 workspace 至少有一槽是 'note-view'。
 *
 * 行为:
 * - 左 / 右 任一已是 'note-view' → 不动(典型场景:ai-sync 组合 [ai-view, note-view]
 *   下点 toolbar + 新建,不应该踢掉左槽 AI)
 * - 两槽都不是 'note-view' → 把 left 设成 'note-view'(让 NoteView 显示新 note)
 */
function ensureNoteViewActive(wsId: string): void {
  const ws = workspaceManager.get(wsId);
  if (!ws) return;
  if (ws.slotBinding.left === 'note-view' || ws.slotBinding.right === 'note-view') return;
  workspaceManager.update(wsId, {
    slotBinding: { ...ws.slotBinding, left: 'note-view' },
  });
}

/**
 * 确保**指定槽**装的是 'note-view'(feat/slot-navside-follow-active)。
 *
 * 与 ensureNoteViewActive 的分工:那个回答「整个 ws 有地方显 note 吗」,
 * 本函数回答「我要送去的**那一栏**能显 note 吗」。树左键跟随活跃槽后必须用后者 ——
 * 焦点在右栏而右栏装着 eBook 时,ensureNoteViewActive 会因为"左栏已是 note-view"
 * 直接返回,于是 rightActiveNoteId 写了但没人渲染 = 笔记开进虚空。
 *
 * 已经是 note-view 则不动(避免无谓 update 触发重渲/实例重建)。
 */
function ensureNoteViewInSlot(wsId: string, slot: NoteSlot): void {
  const ws = workspaceManager.get(wsId);
  if (!ws) return;
  if (ws.slotBinding[slot] === 'note-view') return;
  workspaceManager.update(wsId, {
    slotBinding:
      slot === 'right'
        ? { ...ws.slotBinding, right: 'note-view', rightPayload: undefined }
        : { ...ws.slotBinding, left: 'note-view', leftPayload: undefined },
  });
}

/**
 * 把某篇笔记送到**指定槽**并让那一栏显示出来(设活跃 + 保证装的是 note-view)。
 *
 * set-active-in-right / open-in-other-slot 共用 —— 两者只是「哪个槽」的算法不同,
 * 落地动作完全一致,不该各写一遍(写两遍必然漂移:历史上 set-active-in-right
 * 就曾漏写 rightActiveNoteId 导致右栏跟着左栏显同一篇)。
 */
function setActiveNoteInSlot(wsId: string, noteId: string, slot: NoteSlot): void {
  setActiveNote(wsId, noteId, slot);
  ensureNoteViewInSlot(wsId, slot);
}

/**
 * focus-first instanceId(同 capability/commands 风格,业务命令也用)
 *
 * fix/slot-instance-id:删掉 `?? wsId` 兜底 —— NoteView 的 instanceId 已是
 * `${wsId}::slot:${slot}` 复合形态,裸 wsId 查不到任何实例,兜底只会让命令
 * 静默失败。改为 fail loud。
 */
function resolveInstanceId(): string | null {
  const id = requireCapabilityApi<TextEditingApi>('text-editing')
    .instanceRegistry.getFocusedInstanceId();
  if (!id) {
    console.error(
      '[note-view] 无法解析目标 PM 实例:当前没有聚焦的编辑器,命令已跳过。',
    );
  }
  return id;
}

function withInstance(fn: (instanceId: string) => void): () => void {
  return () => {
    const id = resolveInstanceId();
    if (!id) return;
    fn(id);
  };
}

/** handle pos 解析(handle-copy-block-link 用)
 *
 * fix/slot-instance-id:改用 controller state 自带的 instanceId,不再走
 * resolveInstanceId() 的 focused 路径 —— 与 register-pm-commands.ts 的
 * getHandlePos 对齐(那边早已修过,本处是漏网)。
 *
 * 理由同那边:handle 菜单弹出后焦点可能已不在编辑器里,focused 解析会指向
 * 无关实例,把这个实例的 pos 用到另一个文档上 → 删/改错 block。pos 和
 * instanceId 必须同源,都取自 handle plugin show 时显式传入的 state。
 */
function getHandlePos(): { instanceId: string; pos: number } | null {
  const state = handleMenuController.getState();
  if (!state.instanceId) return null;
  if (typeof state.pos !== 'number') return null;
  return { instanceId: state.instanceId, pos: state.pos };
}

/**
 * 命令的目标槽 —— 两个来源按优先级合成,**只此一处**合成。
 *
 * feat/slot-navside-follow-active:原先各站点写 `getInvokingSlot() ?? 'left'`,
 * 恒定回落 left 是「树左键永远开到左栏」的根因 —— 焦点在右栏时点树上另一篇,
 * 它跑去顶掉左栏。
 *
 * 优先级(不可颠倒):
 * 1. `getInvokingSlot()` — 调用方**显式携带**的槽(toolbar 按钮点击栈)。
 *    最强证据:用户点的就是那一栏的按钮,与焦点在哪无关(PROTOCOL.md §1.5
 *    原则 1 推论:命令由调用方显式携带槽)。
 * 2. `getActiveSlot(wsId)` — 用户焦点所在栏(单一来源)。用于**没有**调用栈上下文的
 *    路径:navSide 树点击 / 快捷键 / 程序调用。
 *
 * 注意这**不是**第二处「判断当前是哪个槽」——「当前槽」的答案始终只有 activeSlot 一个;
 * invokingSlot 回答的是另一个问题(这条命令由谁触发),两者语义正交,故可合成。
 */
function targetSlot(wsId: string): NoteSlot {
  return getInvokingSlot() ?? getActiveSlot(wsId);
}

export function registerNoteCommands(wsId: string): void {
  // ── 笔记 CRUD(4) ──

  registerWsCommand('note-view.create-note', () => wsId, (ctx, folderId) => {
    const wsId = ctx.wsId;
    const fid = typeof folderId === 'string' ? folderId : null;
    // 触发槽必须在**同步段**取出 —— 异步续段里 invokingSlot 已被清空
    const slot = targetSlot(wsId);
    // L7-sub2:createNote 是 async,handler 是 sync,用 IIFE 包装拿 id 走后续选中
    void (async () => {
      const noteId = await createNote(wsId, fid, slot);
      if (noteId) {
        // 选中新建笔记(单选)
        setSelectedIds(wsId, new Set([encodeNoteId(noteId)]));
      }
    })();
    // 新笔记要落到目标槽,那一栏就得装 note-view(否则写了 activeNoteId 没人渲染)。
    // 原实现 `if (slot === 'left')` 是因为当时"右栏触发"必然来自右栏 toolbar,
    // 右栏已经是 note-view 无需保证;现在 navSide 的 + 按钮也会落到右栏,需显式保证。
    ensureNoteViewInSlot(wsId, slot);
  });

  registerWsCommand('note-view.delete-active', () => wsId, (ctx) => {
    const wsId = ctx.wsId;
    const ws = workspaceManager.get(wsId);
    if (!ws) return;
    const state = getNoteWsState(ws);
    // 优先批量删 selectedIds(L5-B1 多选支持)
    if (state.selectedIds.size > 0) {
      void deleteSelected(wsId);
      return;
    }
    // fallback:删**本槽**活跃笔记(走统一进度入口,大 note 显块级进度)
    const slot = targetSlot(wsId);
    const target = getActiveNoteId(state, slot);
    if (target) void deleteTreeIdsWithProgress([encodeNoteId(target)]);
  });

  registerWsCommand('note-view.set-active', () => wsId, (ctx, noteId) => {
    if (typeof noteId !== 'string') return;
    const wsId = ctx.wsId;
    // 目标槽 = 触发栏(右栏 toolbar 的 Open 弹窗)优先,否则用户焦点所在栏。
    //
    // feat/slot-navside-follow-active:后半段原是硬编码 'left',所以 navSide 树
    // 左键恒开左栏。改成跟随活跃槽后「点哪一栏,树上的操作就落到哪一栏」成立
    // (设计文档 §0 用户原话)。这是有意的行为变更,不是回归。
    const slot = targetSlot(wsId);
    setActiveNote(wsId, noteId, slot);
    ensureNoteViewInSlot(wsId, slot);
  });

  /**
   * L5-C6:把 NoteView 装到**右栏**并把指定 note 设为 active。
   *
   * 跟 set-active 区别:set-active 送到「触发栏 / 活跃栏」(跟随焦点);本命令
   * 语义是**固定右栏**,与焦点无关 —— 调用方要的就是「钉在右边」这个具体布局。
   *
   * 适用场景(现有两处调用都属此类):web 剪藏把网页钉 left、剪藏稿开 right 做对照;
   * ebook 导入时用户在 left 看 PDF,新章节送 right 不打断左栏。
   * 这类调用方**不能**换成「另一栏」—— 焦点恰在右栏时"另一栏"会把内容送去左栏,
   * 正好毁掉它要的对照布局。故本命令保留,不与 open-in-other-slot 合并。
   */
  registerWsCommand('note-view.set-active-in-right', () => wsId, (ctx, noteId) => {
    if (typeof noteId !== 'string') return;
    setActiveNoteInSlot(ctx.wsId, noteId, 'right');
  });

  /**
   * 在**另一栏**打开(feat/slot-navside-follow-active,树右键项)。
   *
   * 「另一栏」= 活跃槽的对侧:焦点在左 → 送右,焦点在右 → 送左。
   *
   * 为什么不是固定「在右栏打开」:树左键已跟随活跃槽,焦点在右栏时"在右栏打开"
   * 就成了左键的同义项(多余);改成"另一栏"则在任何焦点下都有独立价值 ——
   * 它永远表达「送到我现在没在看的那一栏」,也就是"开个对照"这个真实意图。
   */
  registerWsCommand('note-view.open-in-other-slot', () => wsId, (ctx, noteId) => {
    if (typeof noteId !== 'string') return;
    const other: NoteSlot = otherSlot(getActiveSlot(ctx.wsId));
    setActiveNoteInSlot(ctx.wsId, noteId, other);
  });

  // ── 文件夹 CRUD(4) ──

  registerWsCommand('note-view.create-folder', () => wsId, (ctx, parentId) => {
    const wsId = ctx.wsId;
    const pid = typeof parentId === 'string' ? parentId : null;
    ensureNoteViewActive(wsId);
    void (async () => {
      const created = await createFolder(wsId, pid);
      // fallbackTitle 用实际生成的 title(可能含序号 e.g. "新建文件夹 2"),
      // 绕过 useAllFolders 广播 race
      if (created) triggerRename(encodeFolderId(created.id), created.title);
    })();
  });

  /**
   * 删除单个 treeId(注意跟 delete-active 区分:这条按 treeId 精确删,不依赖 selectedIds)。
   * 2026-05-30 delete-progress:走统一进度入口(原直接调 deleteNote/deleteFolder 无进度,
   * 是"右键删大 note/目录无进度条"根因)。folder confirm 在 deleteTreeIdsWithProgress 内弹。
   */
  commandRegistry.register('note-view.delete-by-tree-id', (treeId: unknown) => {
    if (typeof treeId !== 'string') return;
    void deleteTreeIdsWithProgress([treeId]);
  });

  registerWsCommand('note-view.copy-by-tree-id', () => wsId, (ctx, treeId) => {
    if (typeof treeId !== 'string') return;
    copyToClipboard(ctx.wsId, treeId);
  });

  /** 粘贴到目标 folder(commandArg 可以是 folderId 字符串 / null)*/
  registerWsCommand('note-view.paste', () => wsId, (ctx, targetFolderId) => {
    const fid = typeof targetFolderId === 'string' ? targetFolderId : null;
    void pasteFromClipboard(ctx.wsId, fid);
  });

  // ── 文件夹排序(2) ──

  registerWsCommand('note-view.sort-cycle-title', () => wsId, (ctx, folderKey) => {
    const key = typeof folderKey === 'string' ? folderKey : '__root__';
    cycleSortByTitle(ctx.wsId, key);
  });

  registerWsCommand('note-view.sort-cycle-date', () => wsId, (ctx, folderKey) => {
    const key = typeof folderKey === 'string' ? folderKey : '__root__';
    cycleSortByDate(ctx.wsId, key);
  });

  // ── 业务插入(7):依赖 mediaStore / tweetFetcher / ytdlp 等业务 capability ──

  // L5-B3.5:slash insert-image — 插入图片 block(placeholder 态)
  commandRegistry.register('note-view.slash-insert-image', withInstance((instanceId) => {
    tea().clearSlashTrigger(instanceId);
    tea().insertImageAtSelection(instanceId);
  }));

  // L5-B3.7:slash insert-table — 插入 3x3 表格(第一行 header)
  commandRegistry.register('note-view.slash-insert-table', withInstance((instanceId) => {
    tea().clearSlashTrigger(instanceId);
    tea().insertTableAtSelection(instanceId, 3, 3);
  }));

  // columnList:slash insert-columns — 插入 2 列 columnList(第一列继承当前段内容)
  commandRegistry.register('note-view.slash-insert-columns', withInstance((instanceId) => {
    tea().clearSlashTrigger(instanceId);
    tea().insertColumnListAtSelection(instanceId, 2);
  }));

  // L5-B3.14:slash insert-file-block — 插入空 fileBlock placeholder
  commandRegistry.register('note-view.slash-insert-file-block', withInstance((instanceId) => {
    tea().clearSlashTrigger(instanceId);
    tea().insertFileBlockAtSelection(instanceId);
  }));

  // L5-B3.14:slash insert-external-ref — 插入空 externalRef placeholder
  commandRegistry.register('note-view.slash-insert-external-ref', withInstance((instanceId) => {
    tea().clearSlashTrigger(instanceId);
    tea().insertExternalRefAtSelection(instanceId);
  }));

  // L5-B3.16:slash insert-audio — 插入空 audioBlock placeholder
  commandRegistry.register('note-view.slash-insert-audio', withInstance((instanceId) => {
    tea().clearSlashTrigger(instanceId);
    tea().insertAudioBlockAtSelection(instanceId);
  }));

  // L5-B3.16:slash insert-video — 插入空 videoBlock placeholder
  commandRegistry.register('note-view.slash-insert-video', withInstance((instanceId) => {
    tea().clearSlashTrigger(instanceId);
    tea().insertVideoBlockAtSelection(instanceId);
  }));

  // L5-B3.18:slash insert-tweet — 插入空 tweetBlock placeholder(𝕏 URL 输入)
  commandRegistry.register('note-view.slash-insert-tweet', withInstance((instanceId) => {
    tea().clearSlashTrigger(instanceId);
    tea().insertTweetBlockAtSelection(instanceId);
  }));

  // ── 业务依赖(1):Copy Link(依 noteId)──

  // Copy Link(`krig://block/<noteId>/<blockId>` 写剪贴板)
  // L7 block atomization Stage 5(decision 026 §7.3):
  // anchor 字面从 V1 "heading text" / "idx:preview" 升级为 block atom ULID(跨编辑稳定)。
  commandRegistry.register('note-view.handle-copy-block-link', () => {
    const ctx = getHandlePos();
    if (!ctx) {
      handleMenuController.hide();
      return;
    }
    const blockId = tea().getBlockIdAt(ctx.instanceId, ctx.pos);
    if (!blockId) {
      console.warn('[note-commands/copy-block-link] block at pos has no attrs.id');
      handleMenuController.hide();
      return;
    }
    const ws = workspaceManager.get(ctx.instanceId);
    const noteId = ws ? getNoteWsState(ws).activeNoteId : null;
    if (!noteId) {
      handleMenuController.hide();
      return;
    }
    const link = `krig://block/${noteId}/${blockId}`;
    void navigator.clipboard.writeText(link).catch(() => {});
    handleMenuController.hide();
  });

  // ── Learning 命令(查词/翻译)已上提到 learning capability ──
  // S3:'note-view.cm-dictionary-lookup' / 'note-view.cm-translate-text' →
  //     'learning.cm-dictionary-lookup' / 'learning.cm-translate-text'
  // 命令实现在 capability/learning/commands/register-commands.ts(全工程唯一注册源)
  // context-menu item 走 capability/learning/ui/context-menu/items.ts 工厂

  // ── Note 导航历史(2)── (Cmd+[ / Cmd+] keymap)

  /** Cmd+[ 笔记导航后退(keymap enabledWhen 已校验 in-view-area + not-in-input)*/
  commandRegistry.register('note-view.go-back', () => {
    if (canGoBack()) historyGoBack();
  });

  /** Cmd+] 笔记导航前进 */
  commandRegistry.register('note-view.go-forward', () => {
    if (canGoForward()) historyGoForward();
  });

  // ── 目录面板开关(toolbar 📑 按钮)──
  // hover 触发易反复弹框,改显式 toggle;面板侧自带点外部关闭。
  /**
   * 目录开关 —— 作用于**点击那一栏**的编辑器。
   *
   * 不能只走 withInstance(focused):toolbar 按钮有 preventDefault 不抢焦点,
   * 所以 focused 仍是"上次点过的那栏"。用户点右栏目录按钮时若焦点还在左栏,
   * 会去开左栏的目录。有触发槽就直接按槽算 instanceId。
   */
  commandRegistry.register('note-view.toggle-toc', () => {
    const slot = getInvokingSlot();
    if (slot) {
      tocToggleStore.toggle(noteInstanceId(wsId, slot));
      return;
    }
    const id = resolveInstanceId();
    if (id) tocToggleStore.toggle(id);
  });

  // ── Toolbar 操作命令 ──

  /** × 关闭 NoteView(按 note-view 实际所在 slot 关;右侧则 closeRight,否则 closeLeft;最后一个 view 时自身拒绝)*/
  registerWsCommand('note-view.close-view', () => wsId, (ctx) => {
    const wsId = ctx.wsId;
    const ws = workspaceManager.get(wsId);
    const bus = workspaceManager.getBus(wsId);
    if (!ws || !bus) return;
    // 关**点击那一栏**。
    //
    // 原实现按 `right === 'note-view'` 猜:左右都是 note-view 时恒为 true,
    // 点左栏的 ✕ 会把右栏关掉。有触发槽就用触发槽,没有(快捷键/程序调用)
    // 才退回按绑定猜。
    const slot = getInvokingSlot();
    if (slot === 'right') {
      bus.slot.closeRight();
    } else if (slot === 'left') {
      bus.slot.closeLeft();
    } else if (ws.slotBinding.right === 'note-view') {
      bus.slot.closeRight();
    } else {
      bus.slot.closeLeft();
    }
  });

  /** 已保存 button 的 no-op handler — V2 已 auto-persist,这里只占位提示状态 */
  commandRegistry.register('note-view.flush-save', () => {
    // V2 updateNote 同步落 SurrealDB,无需手动 flush;占位等未来加 dirty 状态时填实
  });

  /** 重置 button 占位(V1 是 slot lock toggle,V2 无对应概念,先 no-op)*/
  commandRegistry.register('note-view.toolbar-reset', () => {
    // 占位:V2 无 slot lock / 联动锁概念,后续接入时填实
  });

  /**
   * 田 dropdown 视图切换 — 在 right slot 打开指定 view(空白,无 payload)。
   * commandArg = 目标 viewId(e.g. 'note-view' / 'ebook-view' / 'web-view')。
   * 已装同类直接覆盖重开(openRight 是幂等的)。
   */
  registerWsCommand('note-view.open-right-slot', () => wsId, (ctx, arg) => {
    const bus = workspaceManager.getBus(ctx.wsId);
    if (!bus) return;
    if (typeof arg === 'string') {
      bus.slot.openRight(arg);
    } else if (arg && typeof arg === 'object' && 'viewId' in arg) {
      const { viewId, subId } = arg as { viewId: string; subId: string };
      bus.slot.openRight(viewId, { subId });
    }
  });

  /**
   * 右栏 toolbar 的 ⊞ —— 用选中的 view **替换右栏自己**。
   *
   * 与 open-right-slot 的落点相同(都是 right 槽),但语义来源不同:
   * 那个是"左栏想在右边开个副窗",这个是"右栏想换成别的 view"。
   * 分成两个命令是为了让 SlotPicker 的调用方意图显式,不靠猜。
   */
  registerWsCommand('note-view.open-in-right-slot-self', () => wsId, (ctx, arg) => {
    const bus = workspaceManager.getBus(ctx.wsId);
    if (!bus) return;
    if (typeof arg === 'string') {
      bus.slot.openRight(arg);
    } else if (arg && typeof arg === 'object' && 'viewId' in arg) {
      const { viewId, subId } = arg as { viewId: string; subId: string };
      bus.slot.openRight(viewId, { subId });
    }
  });

  /**
   * ai-sync feature 跨 view 入口 — 把一段 AI turn (user + assistant) 追加进当前
   * active workspace 的 Note PM 实例。两种 mode:
   *
   *   - mode='end'           : 总是落到 doc 末尾(空段替换 — auto-sync 自动同步用)
   *   - mode='cursor-or-end' : PM hasFocus=true 落光标处当前 block 之后;否则末尾
   *
   * 调用约定:
   *   commandRegistry.execute('note-view.append-ai-turn', { serviceId, turn, mode })
   *
   * 块结构: ❓ Callout (user message) + 🔀 Toggle (回答 (服务名)) + ─ 分隔
   * 适用场景:单 turn 同步(auto-sync)— user/assistant 配对清晰。
   *
   * 返:boolean(true=插入成功;false=未插入,典型场景 instance 未注册 / 节点全失败)
   * 边界:命令不校验 slot 组合(由调用方判);只要 active workspace 有 PM 实例就插。
   */
  registerWsCommand('note-view.append-ai-turn', () => wsId, (ctx, arg) => {
    const p = (arg ?? {}) as {
      serviceId?: AIServiceId;
      turn?: AISyncTurn;
      mode?: 'end' | 'cursor-or-end';
    };
    if (!p.serviceId || !p.turn) return false;
    const wsId = ctx.wsId;

    const nodes = buildAITurnPmNodes(p.serviceId, p.turn);
    if (nodes.length === 0) return false;

    const api = tea();
    // NoteView 用 instanceId = workspaceId(参考 NoteView.tsx Host config)
    if (p.mode === 'cursor-or-end') {
      return api.insertNodesAtCursorOrEnd(wsId, nodes);
    }
    return api.insertNodesAtEnd(wsId, nodes);
  });

  /**
   * 把一段已转好的 PM 节点(NoteDocEnvelope.payload.content)插入当前 active Note。
   *
   * 适用场景:"提取整页对话"— extractFull 返完整 markdown(多 turn + ## 用户/## AI
   * 标题已自带),aiMarkdownToNoteDoc 转出来直接是带 heading 的多 block,不需要再
   * 用 ❓+🔀 包一层(那是单 turn 才有的语义)。
   *
   * 调用约定:
   *   commandRegistry.execute('note-view.append-pm-nodes', { nodes: unknown[], mode })
   *
   * 返:boolean
   */
  registerWsCommand('note-view.append-pm-nodes', () => wsId, (ctx, arg) => {
    const p = (arg ?? {}) as { nodes?: unknown; mode?: 'end' | 'cursor-or-end' };
    if (!Array.isArray(p.nodes) || p.nodes.length === 0) return false;
    const wsId = ctx.wsId;
    const api = tea();
    if (p.mode === 'cursor-or-end') {
      return api.insertNodesAtCursorOrEnd(wsId, p.nodes);
    }
    return api.insertNodesAtEnd(wsId, p.nodes);
  });
}
