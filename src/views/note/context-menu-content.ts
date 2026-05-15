/**
 * NoteView ContextMenu 注册(C5:工厂函数化,PM 通用 7 项 + NoteView 业务增量)
 *
 * V1 右键菜单层级(参考 src/plugins/note/components/ContextMenu.tsx):
 *   Cut / Copy / Paste(剪贴板组)— PM 通用
 *   ─── 分隔
 *   Select All                  — PM 通用
 *   ─── 分隔
 *   ✖ 移除格式 / 🔗 移除链接     — PM 通用(real-mark 检测留 sub-stage)
 *   ─── 分隔
 *   📖 查词 / 🌐 翻译           — NoteView learning 业务
 *   ─── 分隔
 *   🗑 删除 Block                — PM 通用
 *
 * 注册:
 * - PM 通用 7 项 → @capabilities/text-editing/ui/context-menu/items 工厂
 * - NoteView learning 业务 2 项 → 本文件 createNoteSpecificContextItems
 *
 * 设计:
 * - **Turn Into 已从 context menu 移除**(归 handle 菜单 — cm = "改文字 / 操作选区",
 *   "改 block 类型"走 handle ⠿ 菜单)
 * - V1 规划但 V2 未实装项(Ask AI / Frame / Thought 等)沿用 "不注册" 策略
 */

import { contextMenuRegistry } from '@slot/interaction-registries/context-menu-registry/context-menu-registry';
import type { ContextMenuItem } from '@slot/interaction-registries/context-menu-registry/context-menu-types';
import {
  createClipboardGroup,
  createSelectAllItem,
  createRemoveMarksGroup,
  createDeleteBlockItem,
} from '@capabilities/text-editing/ui/context-menu/items';

const VIEW = 'note-view';

/** NoteView learning 业务专属(2 项:查词/翻译) */
function createNoteSpecificContextItems(): ContextMenuItem[] {
  return [
    {
      id: `${VIEW}.cm.dictionary-lookup`,
      label: '📖 查词',
      command: 'note-view.cm-dictionary-lookup',
      view: VIEW,
      enabledWhen: 'has-selection',
      group: 'learning',
      order: 40,
    },
    {
      id: `${VIEW}.cm.translate-text`,
      label: '🌐 翻译',
      command: 'note-view.cm-translate-text',
      view: VIEW,
      enabledWhen: 'has-selection',
      group: 'learning',
      order: 41,
    },
  ];
}

export function registerContextMenu(): void {
  contextMenuRegistry.register([
    ...createClipboardGroup(VIEW),       // Cut / Copy / Paste
    createSelectAllItem(VIEW),            // Select All
    ...createRemoveMarksGroup(VIEW),      // 移除格式 / 移除链接
    ...createNoteSpecificContextItems(),  // 查词 / 翻译(view 业务)
    createDeleteBlockItem(VIEW),          // 删除 Block
  ]);
}
