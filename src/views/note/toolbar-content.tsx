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
import { popupController } from '@slot/triggers/popup-controller';
import { useSyncExternalStore } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { useWsId } from '@workspace/workspace-context/ws-id-context';
import { NoteOpenPopup } from './note-open-popup/NoteOpenPopup';
import { useAllNotes } from './use-notes-folders';
import { getNoteWsState, getActiveNoteId } from './data-model';
import type { ToolbarItemContext } from '@slot/toolbar-registry/toolbar-types';
import { SLOT_PICKER_POPUP_ID, slotPickerContext } from '@shell/slot-picker';
import { TocToolbarButton } from './toc/TocToolbarButton';

const VIEW = 'note-view';

const OPEN_POPUP_ID = 'note-view.popup.open';

/** Toolbar title 组件 — 显示**本槽** active note 的标题(V1 NoteView.tsx:772 同款)
 *
 * fix/slot-per-slot-active-note:左右双开时两条 toolbar 各显各的笔记标题,
 * 故按 ctx.slot 读对应字段(省略 = left,兼容非 SlotArea 调用方)。
 */
function NoteToolbarTitle({ ctx }: { ctx?: ToolbarItemContext }) {
  const wsId = useWsId();
  const allNotes = useAllNotes();
  const slot = ctx?.slot ?? 'left';
  const activeNoteId = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(wsId);
      if (!ws) return null;
      return getActiveNoteId(getNoteWsState(ws), slot);
    },
  );
  const note = activeNoteId ? allNotes.find((n) => n.id === activeNoteId) : null;
  const title = note?.title || 'Note';
  return <span className="krig-toolbar-title">{title}</span>;
}

/** ⊞ 按钮 — 点击先注入 commandId 再弹 SlotPicker
 *
 * fix/slot-toolbar-command-targets-own-slot:右栏的 ⊞ 应替换**右栏自己**,
 * 左栏的 ⊞ 才是"在右栏打开"。原先两栏都硬编码 open-right-slot,
 * 导致右栏的 ⊞ 换的是自己以外的语义混乱。
 */
function NoteSlotSwitchButton({ ctx }: { ctx?: ToolbarItemContext }) {
  const isRight = ctx?.slot === 'right';
  return (
    <button
      type="button"
      className="krig-toolbar-button krig-toolbar-button--default"
      title={isRight ? '替换本栏视图' : '在右栏打开视图'}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        slotPickerContext.setCommandId(
          isRight ? 'note-view.open-in-right-slot-self' : 'note-view.open-right-slot',
        );
        popupController.toggle(SLOT_PICKER_POPUP_ID, e.currentTarget);
      }}
    >
      ⊞
    </button>
  );
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
    // ── 目录开关(紧挨导航箭头,体验一致)──
    // custom-render:用 lucide 线性图标对齐 ‹ › 箭头,不用 emoji(风格割裂)
    {
      id: 'note-view.toggle-toc',
      view: VIEW,
      group: 'left',
      label: '目录',
      kind: 'custom-render',
      Component: TocToolbarButton,
      order: 25,
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
      label: '在右栏打开视图',
      kind: 'custom-render',
      Component: NoteSlotSwitchButton,
      order: 50,
    },
    {
      id: 'note-view.close',
      view: VIEW,
      group: 'right',
      label: '关闭此面板',
      icon: '×',
      command: 'note-view.close-view',
      variant: 'close',
      order: 60,
    },
  ]);
}
