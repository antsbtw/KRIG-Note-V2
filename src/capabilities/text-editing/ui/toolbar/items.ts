/**
 * 顶部 toolbar item 工厂(C2 上提,D-B 决议)
 *
 * 任何 PM-using view 可调本工厂拼装自己的顶部 toolbar:
 *
 *   toolbarRegistry.register([
 *     createHeadingDropdown('note-view'),
 *     createSeparator('note-view', 'sep1', 20),
 *     ...createToolbarMarkButtons('note-view'),
 *     createToolbarLinkButton('note-view'),
 *     ...createToolbarColorButtons('note-view'),
 *     ...myOwnButtons('note-view'),  // view 自己的增量
 *   ]);
 *
 * 设计原则:
 * - 工厂只返回 Item[],不调 register(N-1 唯一注册源仍在 view)
 * - viewId 决定 item id 前缀(`${viewId}.heading`)+ item.view 字段
 * - command 走 C1 重命名后的 text-editing.* 命名空间
 *
 * 注:toolbar 颜色按钮目前是双按钮(A / A̲),floating-toolbar 已经统一单按钮 'A'。
 *    本工厂保留双按钮以与当前 NoteView 行为字面一致;后续 stage 独立做对齐。
 */

import type { ToolbarItem } from '@slot/toolbar-registry/toolbar-types';

/** Heading dropdown:Paragraph / H1 / H2 / H3 */
export function createHeadingDropdown(viewId: string): ToolbarItem {
  return {
    id: `${viewId}.heading`,
    view: viewId,
    kind: 'dropdown',
    label: 'Heading',
    group: 'left',
    order: 10,
    currentLabel: (ctx) => {
      const lvl = ctx.selection?.activeLevel ?? null;
      if (lvl == null) return 'Paragraph';
      return `H${lvl}`;
    },
    options: [
      {
        id: 'p',
        label: 'Paragraph',
        command: 'text-editing.set-heading-level',
        commandArg: null,
        activeWhen: (ctx) => (ctx.selection?.activeLevel ?? null) === null,
      },
      {
        id: 'h1',
        label: 'H1',
        command: 'text-editing.set-heading-level',
        commandArg: 1,
        activeWhen: (ctx) => ctx.selection?.activeLevel === 1,
      },
      {
        id: 'h2',
        label: 'H2',
        command: 'text-editing.set-heading-level',
        commandArg: 2,
        activeWhen: (ctx) => ctx.selection?.activeLevel === 2,
      },
      {
        id: 'h3',
        label: 'H3',
        command: 'text-editing.set-heading-level',
        commandArg: 3,
        activeWhen: (ctx) => ctx.selection?.activeLevel === 3,
      },
    ],
  };
}

/** 分隔符(toolbar 内 separator kind) */
export function createSeparator(viewId: string, id: string, order: number): ToolbarItem {
  return { id, view: viewId, kind: 'separator', label: '', group: 'left', order };
}

/** 5 个 mark 按钮:B / I / U / S / `<>` */
export function createToolbarMarkButtons(viewId: string): ToolbarItem[] {
  return [
    {
      id: `${viewId}.bold`,
      view: viewId,
      kind: 'button',
      label: 'B',
      command: 'text-editing.toggle-bold',
      group: 'left',
      order: 30,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('bold'),
    },
    {
      id: `${viewId}.italic`,
      view: viewId,
      kind: 'button',
      label: 'I',
      command: 'text-editing.toggle-italic',
      group: 'left',
      order: 31,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('italic'),
    },
    {
      id: `${viewId}.underline`,
      view: viewId,
      kind: 'button',
      label: 'U',
      command: 'text-editing.toggle-underline',
      group: 'left',
      order: 31.5,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('underline'),
    },
    {
      id: `${viewId}.strike`,
      view: viewId,
      kind: 'button',
      label: 'S',
      command: 'text-editing.toggle-strike',
      group: 'left',
      order: 32,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('strike'),
    },
    {
      id: `${viewId}.code`,
      view: viewId,
      kind: 'button',
      label: '<>',
      command: 'text-editing.toggle-code',
      group: 'left',
      order: 33,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('code'),
    },
  ];
}

/** 🔗 链接按钮(popup-trigger 弹 LinkPanel) */
export function createToolbarLinkButton(viewId: string): ToolbarItem {
  return {
    id: `${viewId}.link`,
    view: viewId,
    kind: 'popup-trigger',
    label: '🔗',
    popupId: 'text-editing.popup.link',
    group: 'left',
    order: 33.5,
    activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('link'),
  };
}

/**
 * 颜色按钮:A / A̲ 双按钮(均弹同一 popup.color)
 *
 * 与 floating-toolbar 单按钮 'A' 不同 — 此处字面 1:1 保留 NoteView 现状,
 * 单按钮对齐留独立 stage。
 */
export function createToolbarColorButtons(viewId: string): ToolbarItem[] {
  return [
    {
      id: `${viewId}.text-color`,
      view: viewId,
      kind: 'popup-trigger',
      label: 'A',
      popupId: 'text-editing.popup.color',
      group: 'left',
      order: 34,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('textStyle'),
    },
    {
      id: `${viewId}.highlight`,
      view: viewId,
      kind: 'popup-trigger',
      label: 'A̲',
      popupId: 'text-editing.popup.color',
      group: 'left',
      order: 35,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('highlight'),
    },
  ];
}
