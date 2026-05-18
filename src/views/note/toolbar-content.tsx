/**
 * NoteView 顶部 Toolbar 注册 — V1 风格 view 操作条
 *
 * 本文件职责:
 * - 决定 NoteView 的 toolbar items + 顺序(view 拼装)
 * - 注册 NoteOpenPopup(Open 按钮 popup)
 *
 * 布局(对齐 V1 NoteView toolbar 上排):
 * - left:  ‹ go-back  ›  go-forward
 * - right: [已保存] [+新建] [Open ▾] [🔄] [⊞ ▾] [×]
 *
 * 注意:V2 ToolbarItem 不支持 view 内的格式化(heading/mark/link/color)了 —
 * 那些已从顶部移除,后续如需保留可在 selection floating-toolbar 接入。
 */

import { toolbarRegistry } from '@slot/toolbar-registry/toolbar-registry';
import { popupRegistry } from '@slot/interaction-registries/popup-registry/popup-registry';
import { useSyncExternalStore } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { NoteOpenPopup } from './note-open-popup/NoteOpenPopup';
import { useAllNotes } from './use-notes-folders';
import { getNoteWsState } from './data-model';

const VIEW = 'note-view';

const OPEN_POPUP_ID = 'note-view.popup.open';

/** Toolbar title 组件 — 显示当前 active note 的标题(V1 NoteView.tsx:772 同款)*/
function NoteToolbarTitle() {
  const wsId = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => workspaceManager.getActiveId(),
  );
  const allNotes = useAllNotes();
  const activeNoteId = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = wsId ? workspaceManager.get(wsId) : undefined;
      return ws ? getNoteWsState(ws).activeNoteId : null;
    },
  );
  const note = activeNoteId ? allNotes.find((n) => n.id === activeNoteId) : null;
  const title = note?.title || 'Note';
  return <span className="krig-toolbar-title">{title}</span>;
}

export function registerToolbar(): void {
  // 注册 Open popup(全局唯一,本 view 独占)
  popupRegistry.register({
    id: OPEN_POPUP_ID,
    view: VIEW,
    Component: NoteOpenPopup,
    estimatedSize: { width: 320, height: 420 },
  });

  toolbarRegistry.register([
    // ── 左侧:导航箭头(V1 透明无边框样式)──
    {
      id: 'note-view.nav-back',
      view: VIEW,
      group: 'left',
      label: '后退 (⌘[)',
      icon: '‹',
      command: 'note-view.go-back',
      variant: 'plain',
      order: 10,
    },
    {
      id: 'note-view.nav-forward',
      view: VIEW,
      group: 'left',
      label: '前进 (⌘])',
      icon: '›',
      command: 'note-view.go-forward',
      variant: 'plain',
      order: 20,
    },
    // ── 笔记标题(V1 NoteView toolbar 同款)──
    {
      id: 'note-view.title',
      view: VIEW,
      group: 'left',
      label: '当前笔记标题',
      kind: 'custom-render',
      Component: NoteToolbarTitle,
      order: 30,
    },

    // ── 右侧:view 操作 ──
    {
      id: 'note-view.saved-status',
      view: VIEW,
      group: 'right',
      label: '已保存(自动)',
      icon: '已保存',
      command: 'note-view.flush-save',
      order: 10,
    },
    {
      id: 'note-view.new-note',
      view: VIEW,
      group: 'right',
      label: '新建笔记',
      icon: '+ 新建',
      command: 'note-view.create-note',
      // commandArg 留空 = 根目录新建(create-note handler 接受 null/undefined)
      order: 20,
    },
    {
      id: 'note-view.open',
      view: VIEW,
      group: 'right',
      label: '打开笔记',
      kind: 'popup-trigger',
      icon: 'Open',
      popupId: OPEN_POPUP_ID,
      order: 30,
    },
    {
      id: 'note-view.toolbar-reset',
      view: VIEW,
      group: 'right',
      label: '重置(占位)',
      icon: '🔄',
      command: 'note-view.toolbar-reset',
      order: 40,
    },
    {
      id: 'note-view.view-switch',
      view: VIEW,
      group: 'right',
      label: '切换视图(占位)',
      kind: 'dropdown',
      icon: '⊞',
      currentLabel: () => '⊞',
      options: [
        {
          id: 'switch-note',
          label: '📝 Note',
          command: 'note-view.open-right-slot',
          commandArg: 'note-view',
        },
        {
          id: 'switch-ebook',
          label: '📕 eBook',
          command: 'note-view.open-right-slot',
          commandArg: 'ebook-view',
        },
        {
          id: 'switch-web',
          label: '🌐 Web',
          command: 'note-view.open-right-slot',
          commandArg: 'web-view',
        },
        // AI / Thought:V2 暂无对应 view,UI 保留但禁用
        {
          id: 'switch-ai',
          label: '🤖 AI (未实现)',
          command: 'note-view.open-right-slot',
          commandArg: '',
          disabled: true,
        },
        {
          id: 'switch-thought',
          label: '💭 Thought (未实现)',
          command: 'note-view.open-right-slot',
          commandArg: '',
          disabled: true,
        },
      ],
      order: 50,
    },
    {
      id: 'note-view.close',
      view: VIEW,
      group: 'right',
      label: '关闭此面板',
      icon: '×',
      command: 'note-view.close-view',
      variant: 'plain',
      order: 60,
    },
  ]);
}
