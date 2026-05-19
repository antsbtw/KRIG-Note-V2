/**
 * handle-menu item 工厂(C4 上提,D-B 决议)
 *
 * 任何 PM-using view 可调本工厂拼装自己的 ⠿ 拖手柄菜单:
 *
 *   handleRegistry.register([
 *     createTurnIntoContainer('note-view'),       // ↔ Turn Into ▸
 *     createColorContainer('note-view'),           // 🎨 Color ▸ (submenuRender 走 HandleColorSubmenu)
 *     ...createTurnIntoSubmenu('note-view'),       // 11 项 submenu(P/H1-3/Bullet/Ordered/Task/Quote/Code/Callout/Toggle)
 *     ...createBlockActions('note-view'),          // 📋 Copy / ⧉ Duplicate / 🗑 Delete
 *     ...myOwnViewActions('note-view'),            // view 自己的增量(Copy Link / Thought / Ask AI / Frame 等)
 *   ]);
 *
 * 设计原则:
 * - 工厂只返回 Item[],不调 register(N-1 唯一注册源仍在 view)
 * - viewId 决定 item id 前缀(`${viewId}.h.copy`)+ item.view 字段
 * - command 走 C1 重命名后的 text-editing.* 命名空间
 *
 * 留 view 自注册的部分(C0 §三 §🟢 决议 D-7):
 * - Copy Link(依 noteId,note-view 专属业务)
 * - Thought(NoteView 计划业务,future)
 * - Ask AI(NoteView 计划业务,future)
 * - 框定(frame 容器 + submenu placeholder,V2 frame block 未实装)
 *
 * Color 容器走 submenuRender + HandleColorSubmenu:
 * - HandleColorSubmenu 已在 capabilities/text-editing/ui/color-picker/(C1 前已上提)
 * - 直接 import 即可,无需 view 注入
 */

import type { HandleItem } from '@slot/interaction-registries/handle-registry/handle-types';
import { HandleColorSubmenu } from '../color-picker/HandleColorSubmenu';
import { HandleFormatSubmenu } from './HandleFormatSubmenu';

/** ↔ Turn Into 容器(顶层 submenu 容器,group='transform') */
export function createTurnIntoContainer(viewId: string): HandleItem {
  return {
    id: `${viewId}.h.turn-into`,
    icon: '↔',
    label: 'Turn Into',
    command: '',
    submenuId: 'turn-into',
    view: viewId,
    group: 'transform',
    order: 10,
  };
}

/** 🎨 Color 容器(submenuRender 渲染 HandleColorSubmenu,group='transform') */
export function createColorContainer(viewId: string): HandleItem {
  return {
    id: `${viewId}.h.color`,
    icon: '🎨',
    label: 'Color',
    command: '',
    submenuId: 'color',
    view: viewId,
    group: 'transform',
    order: 20,
    submenuRender: (ctx) => <HandleColorSubmenu ctx={ctx} />,
  };
}

/** ¶ Format 容器(submenuRender 渲染 HandleFormatSubmenu — indent/outdent/text-indent/align)*/
export function createFormatContainer(viewId: string): HandleItem {
  return {
    id: `${viewId}.h.format`,
    icon: '¶',
    label: 'Format',
    command: '',
    submenuId: 'format',
    view: viewId,
    group: 'transform',
    order: 30,
    submenuRender: (ctx) => <HandleFormatSubmenu ctx={ctx} />,
  };
}

/** 11 项 turn-into submenu 子项(submenuOf='turn-into') */
export function createTurnIntoSubmenu(viewId: string): HandleItem[] {
  return [
    {
      id: `${viewId}.h.sub.turn-p`, icon: '¶', label: 'Paragraph',
      command: 'text-editing.handle-turn-paragraph', submenuOf: 'turn-into', view: viewId, order: 10,
    },
    {
      id: `${viewId}.h.sub.turn-h1`, icon: 'H1', label: 'Heading 1',
      command: 'text-editing.handle-turn-h1', submenuOf: 'turn-into', view: viewId, order: 11,
    },
    {
      id: `${viewId}.h.sub.turn-h2`, icon: 'H2', label: 'Heading 2',
      command: 'text-editing.handle-turn-h2', submenuOf: 'turn-into', view: viewId, order: 12,
    },
    {
      id: `${viewId}.h.sub.turn-h3`, icon: 'H3', label: 'Heading 3',
      command: 'text-editing.handle-turn-h3', submenuOf: 'turn-into', view: viewId, order: 13,
    },
    {
      id: `${viewId}.h.sub.turn-bullet`, icon: '•', label: 'Bullet List',
      command: 'text-editing.handle-turn-bullet', submenuOf: 'turn-into', view: viewId, order: 14,
    },
    {
      id: `${viewId}.h.sub.turn-ordered`, icon: '1.', label: 'Numbered List',
      command: 'text-editing.handle-turn-ordered', submenuOf: 'turn-into', view: viewId, order: 15,
    },
    {
      id: `${viewId}.h.sub.turn-task`, icon: '☐', label: 'Task List',
      command: 'text-editing.handle-turn-task', submenuOf: 'turn-into', view: viewId, order: 16,
    },
    {
      id: `${viewId}.h.sub.turn-quote`, icon: '"', label: 'Quote',
      command: 'text-editing.handle-turn-quote', submenuOf: 'turn-into', view: viewId, order: 17,
    },
    {
      id: `${viewId}.h.sub.turn-code`, icon: '<>', label: 'Code Block',
      command: 'text-editing.handle-turn-code', submenuOf: 'turn-into', view: viewId, order: 18,
    },
    {
      id: `${viewId}.h.sub.turn-callout`, icon: '!', label: 'Callout',
      command: 'text-editing.handle-turn-callout', submenuOf: 'turn-into', view: viewId, order: 19,
    },
    {
      id: `${viewId}.h.sub.turn-toggle`, icon: '▸', label: 'Toggle List',
      command: 'text-editing.handle-turn-toggle', submenuOf: 'turn-into', view: viewId, order: 20,
    },
  ];
}

/** 3 项 block 操作(📋 Copy / ⧉ Duplicate / 🗑 Delete,group='block-actions'/'destructive') */
export function createBlockActions(viewId: string): HandleItem[] {
  return [
    {
      id: `${viewId}.h.copy`,
      icon: '📋',
      label: 'Copy',
      command: 'text-editing.handle-copy-block',
      view: viewId,
      group: 'block-actions',
      order: 50,
    },
    {
      id: `${viewId}.h.duplicate`,
      icon: '⧉',
      label: 'Duplicate',
      command: 'text-editing.handle-duplicate-block',
      view: viewId,
      group: 'block-actions',
      order: 52,
    },
    {
      id: `${viewId}.h.delete`,
      icon: '🗑',
      label: 'Delete',
      command: 'text-editing.handle-delete-block',
      view: viewId,
      group: 'destructive',
      order: 90,
    },
  ];
}
