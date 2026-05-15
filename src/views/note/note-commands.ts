/**
 * NoteView 命令注册
 *
 * L5-A 命令(create-note / delete-active / set-active)+ L5-B1 8 个新命令。
 * 见 docs/RefactorV2/stages/L5B1-folder-tree-design.md § 4.5。
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { MarkName, TextEditingApi } from '@capabilities/text-editing/types';
import { handleMenuController } from '@slot/triggers/handle-menu-controller';
import { contextMenuController } from '@slot/triggers/context-menu-controller';
import { popupController } from '@slot/triggers/popup-controller';
import {
  createNote,
  deleteNote,
  setActiveNote,
  getNoteWsState,
  createFolder,
  deleteFolder,
  cycleSortByTitle,
  cycleSortByDate,
  setSelectedIds,
} from './data-model';
import {
  copyToClipboard,
  pasteFromClipboard,
  deleteSelected,
} from './tree-operations';
import { decodeTreeId, encodeNoteId, encodeFolderId } from './tree-builder';
import { triggerRename } from './context-menu-registrations';
import type { FolderCapabilityApi } from '@capabilities/folder/types';
import { goBack as historyGoBack, goForward as historyGoForward, canGoBack, canGoForward } from './note-navigation-history';
import { showDictionaryPanel, showTranslationPanel } from './learning-integration';

/**
 * W5 C4:lazy getter — 命令 handler 内部用,避免 module load 时 require
 * (capability 注册副作用顺序敏感),每次调用拿最新 api。
 */
function tea(): TextEditingApi['api'] {
  return requireCapabilityApi<TextEditingApi>('text-editing').api;
}

/** 确保 slotBinding.left = 'note-view' */
function ensureNoteViewActive(wsId: string): void {
  const ws = workspaceManager.get(wsId);
  if (!ws) return;
  if (ws.slotBinding.left === 'note-view') return;
  workspaceManager.update(wsId, {
    slotBinding: { ...ws.slotBinding, left: 'note-view' },
  });
}

export function registerNoteCommands(): void {
  // ── L5-A 命令(参数升级:create-note 加 folderId 可选)──

  commandRegistry.register('note-view.create-note', (folderId: unknown) => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const fid = typeof folderId === 'string' ? folderId : null;
    // L7-sub2:createNote 是 async,handler 是 sync,用 IIFE 包装拿 id 走后续选中
    void (async () => {
      const noteId = await createNote(wsId, fid);
      if (noteId) {
        // 选中新建笔记(单选)
        setSelectedIds(wsId, new Set([encodeNoteId(noteId)]));
      }
    })();
    ensureNoteViewActive(wsId);
  });

  commandRegistry.register('note-view.delete-active', () => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const ws = workspaceManager.get(wsId);
    if (!ws) return;
    const state = getNoteWsState(ws);
    // 优先批量删 selectedIds(L5-B1 多选支持)
    if (state.selectedIds.size > 0) {
      void deleteSelected(wsId);
      return;
    }
    // fallback:删活跃笔记
    if (state.activeNoteId) void deleteNote(state.activeNoteId);
  });

  commandRegistry.register('note-view.set-active', (noteId: unknown) => {
    if (typeof noteId !== 'string') return;
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    setActiveNote(wsId, noteId);
    ensureNoteViewActive(wsId);
  });

  /**
   * L5-C6:把 NoteView 装到右栏并把指定 note 设为 active。
   *
   * 跟 set-active 区别:set-active 把 NoteView 强切到 **left slot**(掩盖 left
   * 当前装的内容);本命令保留 left slot 不动,只**操作 right slot**(替换右栏
   * 当前装的 view 为 NoteView)。
   *
   * 适用场景:left slot 当前是用户主导的 view(如 EBookView 看 PDF),需要在右栏
   * 跳到刚导入的 note 而不打断左栏 — 走"left 不被系统自动关"约定。
   */
  commandRegistry.register('note-view.set-active-in-right', (noteId: unknown) => {
    if (typeof noteId !== 'string') return;
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const ws = workspaceManager.get(wsId);
    if (!ws) return;
    setActiveNote(wsId, noteId);
    if (ws.slotBinding.right !== 'note-view') {
      workspaceManager.update(wsId, {
        slotBinding: { ...ws.slotBinding, right: 'note-view' },
      });
    }
  });

  // ── L5-B1 新命令 ──

  commandRegistry.register('note-view.create-folder', (parentId: unknown) => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const pid = typeof parentId === 'string' ? parentId : null;
    ensureNoteViewActive(wsId);
    void (async () => {
      const created = await createFolder(wsId, pid);
      // fallbackTitle 用实际生成的 title(可能含序号 e.g. "新建文件夹 2"),
      // 绕过 useAllFolders 广播 race
      if (created) triggerRename(encodeFolderId(created.id), created.title);
    })();
  });

  /** 删除单个 treeId(注意跟 delete-active 区分:这条按 treeId 精确删,不依赖 selectedIds)*/
  commandRegistry.register('note-view.delete-by-tree-id', (treeId: unknown) => {
    if (typeof treeId !== 'string') return;
    const { type, id } = decodeTreeId(treeId);
    if (type === 'note') {
      void deleteNote(id);
    } else {
      // decision 021 §5.5 Q7 弱保护 (R3 字面各自实施):含资源 folder 删除前 confirm
      void (async () => {
        const folderCap = requireCapabilityApi<FolderCapabilityApi>('folder');
        const [preview, info] = await Promise.all([
          folderCap.previewDeleteFolder(id),
          folderCap.getFolder(id),
        ]);
        if (preview.resources > 0 || preview.folders > 0) {
          const folderTitle = info?.title ?? '(未命名)';
          const message =
            preview.resources > 0
              ? `删除文件夹「${folderTitle}」?包含 ${preview.folders} 个子文件夹 + ${preview.resources} 个文件,操作不可撤销(回收站功能未实施)`
              : `删除文件夹「${folderTitle}」?包含 ${preview.folders} 个子文件夹,操作不可撤销(回收站功能未实施)`;
          if (!window.confirm(message)) return;
        }
        await deleteFolder(id);
      })();
    }
  });

  commandRegistry.register('note-view.copy-by-tree-id', (treeId: unknown) => {
    if (typeof treeId !== 'string') return;
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    copyToClipboard(wsId, treeId);
  });

  /** 粘贴到目标 folder(commandArg 可以是 folderId 字符串 / null)*/
  commandRegistry.register('note-view.paste', (targetFolderId: unknown) => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const fid = typeof targetFolderId === 'string' ? targetFolderId : null;
    void pasteFromClipboard(wsId, fid);
  });

  commandRegistry.register('note-view.sort-cycle-title', (folderKey: unknown) => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const key = typeof folderKey === 'string' ? folderKey : '__root__';
    cycleSortByTitle(wsId, key);
  });

  commandRegistry.register('note-view.sort-cycle-date', (folderKey: unknown) => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const key = typeof folderKey === 'string' ? folderKey : '__root__';
    cycleSortByDate(wsId, key);
  });

  // ── L5-B2:marks / heading / undo-redo(走 driver instance-registry) ──

  function withInstance(fn: (instanceId: string) => void): () => void {
    return () => {
      // L5-G4.5:focus-first — 优先用真正持有焦点的 PM 实例 id.
      // 这让 NoteView 注册的"通用"命令(toggleMark / setHeading 等)能被 canvas-text-node
      // 嵌入的 popup 编辑器消费(那边 instanceId 是 `${workspaceId}::${nodeId}` 复合,
      // 与 workspaceManager.getActiveId() 不等).
      //
      // Fallback:focus 为空时(无 PM 实例聚焦,但 view 仍在),走 workspace activeId.
      // L5-A 约定保留:NoteView 自己的 driver instanceId == workspaceId.
      const focused = requireCapabilityApi<TextEditingApi>('text-editing')
        .instanceRegistry.getFocusedInstanceId();
      if (focused) {
        fn(focused);
        return;
      }
      const wsId = workspaceManager.getActiveId();
      if (!wsId) return;
      fn(wsId);
    };
  }

  function registerToggleMark(commandId: string, markName: MarkName): void {
    commandRegistry.register(commandId, withInstance((instanceId) => {
      tea().toggleMark(instanceId, markName);
    }));
  }

  registerToggleMark('text-editing.toggle-bold', 'bold');
  registerToggleMark('text-editing.toggle-italic', 'italic');
  registerToggleMark('text-editing.toggle-underline', 'underline');
  registerToggleMark('text-editing.toggle-strike', 'strike');
  registerToggleMark('text-editing.toggle-code', 'code');

  commandRegistry.register('text-editing.set-heading-level', (level: unknown) => {
    // 同 withInstance:focus-first,workspace fallback(L5-G4.5)
    const focused = requireCapabilityApi<TextEditingApi>('text-editing')
      .instanceRegistry.getFocusedInstanceId();
    const id = focused ?? workspaceManager.getActiveId();
    if (!id) return;
    const lvl = typeof level === 'number' ? level : null;
    tea().setHeading(id, lvl);
  });

  // ── L5-B3.3:文字颜色 / 背景高亮(Plan C-1 缩水版 — 6 色循环;完整 ColorPicker UI 留 L5-B3.4)──

  // 对齐 V1 ColorPicker 文字色板(6 个常用色,covers 90% 用例;V1 完整 10 色留 L5-B3.4)
  const TEXT_COLOR_CYCLE = [
    '',           // default(移除色)
    '#9aa0a6',    // gray
    '#f5c518',    // yellow
    '#8ab4f8',    // blue
    '#ea4335',    // red
    '#34a853',    // green
  ];

  // 对齐 V1 highlight 色板(rgba 半透明,看着柔和)
  const HIGHLIGHT_COLOR_CYCLE = [
    '',                                  // default
    'rgba(154, 160, 166, 0.2)',          // gray
    'rgba(245, 197, 24, 0.2)',           // yellow
    'rgba(138, 180, 248, 0.2)',          // blue
    'rgba(234, 67, 53, 0.2)',            // red
    'rgba(52, 168, 83, 0.2)',            // green
  ];

  commandRegistry.register('text-editing.cycle-text-color', withInstance((instanceId) => {
    const cur = tea().getActiveTextColor(instanceId);
    const idx = TEXT_COLOR_CYCLE.indexOf(cur ?? '');
    const next = TEXT_COLOR_CYCLE[(idx + 1) % TEXT_COLOR_CYCLE.length];
    tea().setTextColor(instanceId, next);
  }));

  commandRegistry.register('text-editing.cycle-highlight', withInstance((instanceId) => {
    const cur = tea().getActiveHighlight(instanceId);
    const idx = HIGHLIGHT_COLOR_CYCLE.indexOf(cur ?? '');
    const next = HIGHLIGHT_COLOR_CYCLE[(idx + 1) % HIGHLIGHT_COLOR_CYCLE.length];
    tea().setHighlight(instanceId, next);
  }));

  commandRegistry.register('text-editing.undo', withInstance((instanceId) => {
    tea().undo(instanceId);
  }));

  commandRegistry.register('text-editing.redo', withInstance((instanceId) => {
    tea().redo(instanceId);
  }));

  // ── L5-B3.2:Turn Into 9 种类型(slash / handle / cm 三套命令)──

  type TurnTarget =
    | 'paragraph' | 'h1' | 'h2' | 'h3'
    | 'bullet-list' | 'ordered-list' | 'task-list'
    | 'blockquote' | 'code-block' | 'horizontal-rule'
    | 'callout' | 'toggle-list';

  // ── slash:作用于光标当前 block(setHeading 走 selection)──
  function registerSlashTurn(commandId: string, target: TurnTarget): void {
    commandRegistry.register(commandId, withInstance((instanceId) => {
      tea().clearSlashTrigger(instanceId);
      // 作用于光标所在 block;driver 内部走 PM state.selection.$from.
      // L5-G4.5:不再 require workspace 存在(canvas-text-node 复合 id 拿不到 workspace),
      // turnIntoSelection 只需 driver instanceId,不依赖 workspace.
      tea().turnIntoSelection(instanceId, target);
    }));
  }
  registerSlashTurn('text-editing.slash-turn-paragraph', 'paragraph');
  registerSlashTurn('text-editing.slash-turn-h1', 'h1');
  registerSlashTurn('text-editing.slash-turn-h2', 'h2');
  registerSlashTurn('text-editing.slash-turn-h3', 'h3');
  registerSlashTurn('text-editing.slash-turn-bullet', 'bullet-list');
  registerSlashTurn('text-editing.slash-turn-ordered', 'ordered-list');
  registerSlashTurn('text-editing.slash-turn-task', 'task-list');
  registerSlashTurn('text-editing.slash-turn-quote', 'blockquote');
  registerSlashTurn('text-editing.slash-turn-code', 'code-block');
  registerSlashTurn('text-editing.slash-turn-divider', 'horizontal-rule');
  registerSlashTurn('text-editing.slash-turn-callout', 'callout');
  registerSlashTurn('text-editing.slash-turn-toggle', 'toggle-list');

  // L5-B3.5:slash insert-image — 插入图片 block(placeholder 态)
  // 跟 turn-* 不同:image 不能从段落 turn 出来(image 含 caption 内嵌结构),
  // 用专门的 insert API
  commandRegistry.register('note-view.slash-insert-image', withInstance((instanceId) => {
    tea().clearSlashTrigger(instanceId);
    tea().insertImageAtSelection(instanceId);
  }));

  // L5-B3.6:slash insert-math-block — 插入 mathBlock(空,自动进 edit 态)
  commandRegistry.register('text-editing.slash-insert-math-block', withInstance((instanceId) => {
    tea().clearSlashTrigger(instanceId);
    tea().insertMathBlockAtSelection(instanceId);
  }));

  // L5-B3.6:行内公式入口在 floating toolbar(选中文字 → 转 mathInline)
  // 选区为空时也允许插入(备份路径,弹编辑器)
  commandRegistry.register('text-editing.insert-math-inline', withInstance((instanceId) => {
    tea().insertMathInlineAtSelection(instanceId);
  }));

  // L5-B3.7:slash insert-table — 插入 3x3 表格(第一行 header)
  commandRegistry.register('note-view.slash-insert-table', withInstance((instanceId) => {
    tea().clearSlashTrigger(instanceId);
    tea().insertTableAtSelection(instanceId, 3, 3);
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

  // ── handle:作用于 handleMenuController.state.pos 指向的 block ──
  function getHandlePos(): { instanceId: string; pos: number } | null {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return null;
    const state = handleMenuController.getState();
    if (typeof state.pos !== 'number') return null;
    return { instanceId: wsId, pos: state.pos };
  }

  function registerHandleTurn(commandId: string, target: TurnTarget): void {
    commandRegistry.register(commandId, () => {
      const ctx = getHandlePos();
      if (!ctx) return;
      tea().turnIntoAt(ctx.instanceId, ctx.pos, target);
      handleMenuController.hide();
    });
  }
  registerHandleTurn('text-editing.handle-turn-paragraph', 'paragraph');
  registerHandleTurn('text-editing.handle-turn-h1', 'h1');
  registerHandleTurn('text-editing.handle-turn-h2', 'h2');
  registerHandleTurn('text-editing.handle-turn-h3', 'h3');
  registerHandleTurn('text-editing.handle-turn-bullet', 'bullet-list');
  registerHandleTurn('text-editing.handle-turn-ordered', 'ordered-list');
  registerHandleTurn('text-editing.handle-turn-task', 'task-list');
  registerHandleTurn('text-editing.handle-turn-quote', 'blockquote');
  registerHandleTurn('text-editing.handle-turn-code', 'code-block');
  registerHandleTurn('text-editing.handle-turn-callout', 'callout');
  registerHandleTurn('text-editing.handle-turn-toggle', 'toggle-list');

  // L5-B3.9:Copy(复制 block 文本到剪贴板)
  commandRegistry.register('text-editing.handle-copy-block', () => {
    const ctx = getHandlePos();
    if (!ctx) return;
    const text = tea().getBlockTextAt(ctx.instanceId, ctx.pos);
    if (text) {
      void navigator.clipboard.writeText(text).catch(() => {
        /* clipboard 失败静默 */
      });
    }
    handleMenuController.hide();
  });

  // L5-B3.9:Copy Link(`krig://block/<noteId>/<anchor>` 写剪贴板)
  // anchor 用 V1 同款规则:heading 用文本 / 普通 block 用 idx:preview
  commandRegistry.register('note-view.handle-copy-block-link', () => {
    const ctx = getHandlePos();
    if (!ctx) return;
    const anchor = tea().getBlockAnchorAt(ctx.instanceId, ctx.pos);
    if (!anchor) {
      handleMenuController.hide();
      return;
    }
    const ws = workspaceManager.get(ctx.instanceId);
    const noteId = ws ? getNoteWsState(ws).activeNoteId : null;
    if (!noteId) {
      handleMenuController.hide();
      return;
    }
    const link = `krig://block/${noteId}/${anchor}`;
    void navigator.clipboard.writeText(link).catch(() => {});
    handleMenuController.hide();
  });

  // L5-B3.9:Duplicate(在原 block 之后插入复本)— 复用既有 copyBlockAt
  commandRegistry.register('text-editing.handle-duplicate-block', () => {
    const ctx = getHandlePos();
    if (!ctx) return;
    tea().copyBlockAt(ctx.instanceId, ctx.pos);
    handleMenuController.hide();
  });

  commandRegistry.register('text-editing.handle-delete-block', () => {
    const ctx = getHandlePos();
    if (!ctx) return;
    tea().deleteBlockAt(ctx.instanceId, ctx.pos);
    handleMenuController.hide();
  });

  // ── context menu:从鼠标位置 resolveBlockAt ──
  function getCmBlockPos(): { instanceId: string; pos: number } | null {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return null;
    const state = contextMenuController.getState();
    const result = tea().resolveBlockAt(wsId, { x: state.x, y: state.y });
    if (!result) return null;
    return { instanceId: wsId, pos: result.pos };
  }

  // L5-B3.9 重组:context menu 不再做 turnInto(归 handle 菜单),改 V1 标准的
  // Cut / Copy / Paste / Select All / Delete / 移除 marks / 颜色 等。
  // 部分高级项(移除 marks / 颜色面板)留 sub-stage 接 mark 分析 / popup,本阶段用占位。

  // ── group: clipboard(Cut/Copy/Paste)— 走 document.execCommand 兼容 PM 默认 ──

  commandRegistry.register('text-editing.cm-cut', () => {
    document.execCommand('cut');
    contextMenuController.hide();
  });
  commandRegistry.register('text-editing.cm-copy', () => {
    document.execCommand('copy');
    contextMenuController.hide();
  });
  commandRegistry.register('text-editing.cm-paste', () => {
    // execCommand('paste') 在 Electron renderer 大多数情况不可用(安全策略)
    // 占位:后续 sub-stage 接 PM clipboardSerializer + handlePaste,先 noop
    // 用户走 Cmd+V 默认行为(PM 自带)即可
    contextMenuController.hide();
  });
  commandRegistry.register('text-editing.cm-select-all', () => {
    document.execCommand('selectAll');
    contextMenuController.hide();
  });

  // ── group: block-actions(右键作用于光标当前 block)──

  commandRegistry.register('text-editing.cm-delete-block', () => {
    const ctx = getCmBlockPos();
    if (!ctx) return;
    tea().deleteBlockAt(ctx.instanceId, ctx.pos);
    contextMenuController.hide();
  });

  // ── group: marks(占位 — 后续 sub-stage 接选区 mark 检测 + 移除)──

  commandRegistry.register('text-editing.cm-remove-marks', () => {
    // 占位:对当前选区移除所有 marks(L5-B+ 实现)
    console.warn('[note-view] cm-remove-marks: 占位,未实现');
    contextMenuController.hide();
  });

  // L5-B3.15:右键移除链接(对应 has-link 条件项)
  // UX 直觉:光标在 link 文字内(甚至无光标,只是右键到 link 上)就能移除,
  //         不强迫用户先选中文字。用 contextMenu 的鼠标坐标定位 PM pos,
  //         再扩展到完整 link 范围 + removeMark。
  commandRegistry.register('text-editing.cm-remove-link', () => {
    const wsId = workspaceManager.getActiveId();
    if (!wsId) return;
    const cm = contextMenuController.getState();
    tea().removeLinkAtClientPoint(wsId, cm.x, cm.y);
    contextMenuController.hide();
  });

  // ── L5-B3.20b → L4.1:learning 查词 / 翻译(contextMenu has-selection 触发,help-panel)──

  /** 选区单词查词 → 弹 dictionary help-panel(lookup 模式)*/
  commandRegistry.register('note-view.cm-dictionary-lookup', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (!text) return;
    showDictionaryPanel(text);
    contextMenuController.hide();
  });

  /** 选区句子 / 段落 → 弹 dictionary help-panel(translate 模式)*/
  commandRegistry.register('note-view.cm-translate-text', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (!text) return;
    showTranslationPanel(text);
    contextMenuController.hide();
  });

  // ── W4.1:keymap 命令(原内嵌 NoteView 全局 keymap useEffect 拆出)──

  /** Cmd+[ 笔记导航后退(keymap enabledWhen 已校验 in-view-area + not-in-input)*/
  commandRegistry.register('note-view.go-back', () => {
    if (canGoBack()) historyGoBack();
  });

  /** Cmd+] 笔记导航前进 */
  commandRegistry.register('note-view.go-forward', () => {
    if (canGoForward()) historyGoForward();
  });

  /**
   * Cmd+K 选中文字时弹 LinkPanel popover
   *
   * keymap enabledWhen 已校验 has-text-selection + in-view-area;handler 只负责
   * 找 anchor 并触发 popup。anchor 优先用 floating-toolbar 的 link 按钮(若已显示),
   * fallback 用选区 rect 制造虚拟 div anchor(popup 后立即 remove)。
   */
  commandRegistry.register('text-editing.popup-link', () => {
    const linkBtn = document.querySelector(
      '.krig-floating-toolbar [title="🔗"], .krig-floating-toolbar-item[title="🔗"]',
    );
    if (linkBtn instanceof Element) {
      popupController.show('text-editing.popup.link', linkBtn);
      return;
    }
    // fallback:选区 rect 模拟虚拟 anchor
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const fake = document.createElement('div');
    fake.style.position = 'fixed';
    fake.style.left = `${rect.left}px`;
    fake.style.top = `${rect.bottom}px`;
    fake.style.width = '1px';
    fake.style.height = '1px';
    document.body.appendChild(fake);
    popupController.show('text-editing.popup.link', fake);
    window.setTimeout(() => fake.remove(), 0);
  });
}
