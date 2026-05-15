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
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import { handleMenuController } from '@slot/triggers/handle-menu-controller';
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

/**
 * lazy getter — 命令 handler 内部用,避免 module load 时 require
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

/** focus-first instanceId(同 capability/commands 风格,业务命令也用) */
function resolveInstanceId(): string | null {
  return (
    requireCapabilityApi<TextEditingApi>('text-editing')
      .instanceRegistry.getFocusedInstanceId() ?? workspaceManager.getActiveId()
  );
}

function withInstance(fn: (instanceId: string) => void): () => void {
  return () => {
    const id = resolveInstanceId();
    if (!id) return;
    fn(id);
  };
}

/** handle pos 解析(handle-copy-block-link 用) */
function getHandlePos(): { instanceId: string; pos: number } | null {
  const id = resolveInstanceId();
  if (!id) return null;
  const state = handleMenuController.getState();
  if (typeof state.pos !== 'number') return null;
  return { instanceId: id, pos: state.pos };
}

export function registerNoteCommands(): void {
  // ── 笔记 CRUD(4) ──

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

  // ── 文件夹 CRUD(4) ──

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

  // ── 文件夹排序(2) ──

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

  // L5-B3.9:Copy Link(`krig://block/<noteId>/<anchor>` 写剪贴板)
  // anchor 用 V1 同款规则:heading 用文本 / 普通 block 用 idx:preview
  commandRegistry.register('note-view.handle-copy-block-link', () => {
    const ctx = getHandlePos();
    if (!ctx) {
      handleMenuController.hide();
      return;
    }
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
}
