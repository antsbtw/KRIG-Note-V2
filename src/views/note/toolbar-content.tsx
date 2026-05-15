/**
 * NoteView Toolbar 注册 — Q5=B(heading dropdown + 4 mark 按钮)
 *
 * 见 docs/RefactorV2/stages/L5B2-marks-undo-design.md § 4.2。
 */

import { toolbarRegistry } from '@slot/toolbar-registry/toolbar-registry';
import type { ToolbarItem } from '@slot/toolbar-registry/toolbar-types';

const VIEW = 'note-view';

export function registerToolbar(): void {
  const items: ToolbarItem[] = [
    {
      id: 'note-view.heading',
      view: VIEW,
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
    },
    { id: 'sep1', view: VIEW, kind: 'separator', label: '', group: 'left', order: 20 },
    {
      id: 'note-view.bold',
      view: VIEW,
      kind: 'button',
      label: 'B',
      command: 'text-editing.toggle-bold',
      group: 'left',
      order: 30,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('bold'),
    },
    {
      id: 'note-view.italic',
      view: VIEW,
      kind: 'button',
      label: 'I',
      command: 'text-editing.toggle-italic',
      group: 'left',
      order: 31,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('italic'),
    },
    {
      id: 'note-view.underline',
      view: VIEW,
      kind: 'button',
      label: 'U',
      command: 'text-editing.toggle-underline',
      group: 'left',
      order: 31.5,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('underline'),
    },
    {
      id: 'note-view.strike',
      view: VIEW,
      kind: 'button',
      label: 'S',
      command: 'text-editing.toggle-strike',
      group: 'left',
      order: 32,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('strike'),
    },
    {
      id: 'note-view.code',
      view: VIEW,
      kind: 'button',
      label: '<>',
      command: 'text-editing.toggle-code',
      group: 'left',
      order: 33,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('code'),
    },
    // L5-B3.4:link mark — popup-trigger 弹 LinkPanel
    {
      id: 'note-view.link',
      view: VIEW,
      kind: 'popup-trigger',
      label: '🔗',
      popupId: 'text-editing.popup.link',
      group: 'left',
      order: 33.5,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('link'),
    },
    // L5-B3.4:文字色 / 高亮 — popup-trigger 弹 ColorPickerPanel
    {
      id: 'note-view.text-color',
      view: VIEW,
      kind: 'popup-trigger',
      label: 'A',
      popupId: 'text-editing.popup.color',
      group: 'left',
      order: 34,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('textStyle'),
    },
    {
      id: 'note-view.highlight',
      view: VIEW,
      kind: 'popup-trigger',
      label: 'A̲',
      popupId: 'text-editing.popup.color',
      group: 'left',
      order: 35,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('highlight'),
    },
  ];
  toolbarRegistry.register(items);
}
