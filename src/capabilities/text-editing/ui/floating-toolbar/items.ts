/**
 * floating-toolbar item 工厂(C2 上提,D-B 决议)
 *
 * 任何 PM-using view 可调本工厂拼装自己的 floating-toolbar:
 *
 *   floatingToolbarRegistry.register([
 *     ...createMarkButtons('note-view'),
 *     createMathButton('note-view'),
 *     createLinkButton('note-view'),
 *     createColorButton('note-view'),
 *     ...myOwnButtons('note-view'),  // view 自己的增量
 *   ]);
 *
 * 设计原则:
 * - 工厂只返回 Item[],不调 register(N-1 唯一注册源仍在 view)
 * - viewId 决定 item id 前缀(`${viewId}.ft.bold`)+ item.view 字段
 *   (controller 按 view 字段过滤;同 viewId 多 view 实例共享菜单内容)
 * - command 走 C1 重命名后的 text-editing.* 命名空间
 */

import type { FloatingToolbarItem } from '@slot/interaction-registries/floating-toolbar-registry/floating-toolbar-types';

/** 5 个 mark 按钮:B / I / U / S / `<>` */
export function createMarkButtons(viewId: string): FloatingToolbarItem[] {
  return [
    {
      id: `${viewId}.ft.bold`,
      label: 'B',
      command: 'text-editing.toggle-bold',
      view: viewId,
      group: 'marks',
      order: 10,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('bold'),
    },
    {
      id: `${viewId}.ft.italic`,
      label: 'I',
      command: 'text-editing.toggle-italic',
      view: viewId,
      group: 'marks',
      order: 20,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('italic'),
    },
    {
      id: `${viewId}.ft.underline`,
      label: 'U',
      command: 'text-editing.toggle-underline',
      view: viewId,
      group: 'marks',
      order: 25,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('underline'),
    },
    {
      id: `${viewId}.ft.strike`,
      label: 'S',
      command: 'text-editing.toggle-strike',
      view: viewId,
      group: 'marks',
      order: 30,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('strike'),
    },
    {
      id: `${viewId}.ft.code`,
      label: '<>',
      command: 'text-editing.toggle-code',
      view: viewId,
      group: 'marks',
      order: 40,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('code'),
    },
  ];
}

/** ∑ 行内公式按钮(选区转 mathInline) */
export function createMathButton(viewId: string): FloatingToolbarItem {
  return {
    id: `${viewId}.ft.math-inline`,
    label: '∑',
    command: 'text-editing.insert-math-inline',
    view: viewId,
    group: 'math',
    order: 50,
  };
}

/** 🔗 链接按钮(popup-trigger 弹 LinkPanel) */
export function createLinkButton(viewId: string): FloatingToolbarItem {
  return {
    id: `${viewId}.ft.link`,
    label: '🔗',
    kind: 'popup-trigger',
    popupId: 'text-editing.popup.link',
    view: viewId,
    group: 'link',
    order: 60,
    activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('link'),
  };
}

/**
 * A 颜色按钮(popup-trigger 弹 ColorPickerPanel 双区:文字色 + 背景色)
 *
 * L5-B3.11 修订:对齐 V1 单按钮综合 popup,不再拆 A / A̲ 双按钮。
 */
export function createColorButton(viewId: string): FloatingToolbarItem {
  return {
    id: `${viewId}.ft.color`,
    label: 'A',
    kind: 'popup-trigger',
    popupId: 'text-editing.popup.color',
    view: viewId,
    group: 'color',
    order: 70,
    activeWhen: (ctx) =>
      !!ctx.selection?.activeMarks?.includes('textStyle') ||
      !!ctx.selection?.activeMarks?.includes('highlight'),
  };
}
