/**
 * context-menu item 工厂(C5 上提,D-B 决议)
 *
 * 任何 PM-using view 可调本工厂拼装自己的编辑区右键菜单:
 *
 *   contextMenuRegistry.register([
 *     ...createClipboardGroup('note-view'),    // ✂ Cut / 📋 Copy / 📄 Paste
 *     createSelectAllItem('note-view'),         // ☐ Select All
 *     ...createRemoveMarksGroup('note-view'),   // ✖ 移除格式 / 🔗 移除链接
 *     createDeleteBlockItem('note-view'),       // 🗑 删除 Block
 *     ...myOwnContextItems('note-view'),        // view 自己的增量(查词/翻译/Ask AI 等)
 *   ]);
 *
 * 设计原则:
 * - 工厂只返回 Item[],不调 register(N-1 唯一注册源仍在 view)
 * - viewId 决定 item id 前缀(`${viewId}.cm.cut`)+ item.view 字段
 * - command 走 C1 重命名后的 text-editing.* 命名空间
 *
 * 留 view 自注册的部分(C0 §三 §🟢 决议):
 * - 📖 查词 / 🌐 翻译(NoteView learning 业务,非 PM 通用)
 * - V1 还规划但 V2 未实装的 Ask AI / Frame / 添加标注 / 删除标注 等
 */

import type { ContextMenuItem } from '@slot/interaction-registries/context-menu-registry/context-menu-types';

/** 剪贴板组:✂ Cut / 📋 Copy / 📄 Paste(group='clipboard') */
export function createClipboardGroup(viewId: string): ContextMenuItem[] {
  return [
    {
      id: `${viewId}.cm.cut`,
      label: '✂ Cut',
      command: 'text-editing.cm-cut',
      view: viewId,
      enabledWhen: 'has-selection',
      group: 'clipboard',
      order: 10,
    },
    {
      id: `${viewId}.cm.copy`,
      label: '📋 Copy',
      command: 'text-editing.cm-copy',
      view: viewId,
      enabledWhen: 'has-selection',
      group: 'clipboard',
      order: 11,
    },
    {
      id: `${viewId}.cm.paste`,
      label: '📄 Paste',
      command: 'text-editing.cm-paste',
      view: viewId,
      enabledWhen: 'is-editable',
      group: 'clipboard',
      order: 12,
    },
  ];
}

/** ☐ Select All(group='selection') */
export function createSelectAllItem(viewId: string): ContextMenuItem {
  return {
    id: `${viewId}.cm.select-all`,
    label: '☐ Select All',
    command: 'text-editing.cm-select-all',
    view: viewId,
    enabledWhen: 'is-editable',
    group: 'selection',
    order: 20,
  };
}

/**
 * 移除 marks 组:✖ 移除格式 / 🔗 移除链接(group='marks')
 *
 * - "移除格式" 占位实现(真实"按选区当前 marks 动态显示移除项"留 sub-stage)
 * - "移除链接" L5-B3.15 实装,enabledWhen='has-link'
 */
export function createRemoveMarksGroup(viewId: string): ContextMenuItem[] {
  return [
    {
      id: `${viewId}.cm.remove-marks`,
      label: '✖ 移除格式',
      command: 'text-editing.cm-remove-marks',
      view: viewId,
      enabledWhen: 'has-selection',
      group: 'marks',
      order: 30,
    },
    {
      id: `${viewId}.cm.remove-link`,
      label: '🔗 移除链接',
      command: 'text-editing.cm-remove-link',
      view: viewId,
      enabledWhen: 'has-link',
      group: 'marks',
      order: 31,
    },
  ];
}

/** 🗑 删除 Block(group='destructive') */
export function createDeleteBlockItem(viewId: string): ContextMenuItem {
  return {
    id: `${viewId}.cm.delete-block`,
    label: '🗑 删除 Block',
    command: 'text-editing.cm-delete-block',
    view: viewId,
    enabledWhen: 'is-editable',
    group: 'destructive',
    order: 90,
  };
}
