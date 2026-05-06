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
          command: 'note-view.set-heading-level',
          commandArg: null,
          activeWhen: (ctx) => (ctx.selection?.activeLevel ?? null) === null,
        },
        {
          id: 'h1',
          label: 'H1',
          command: 'note-view.set-heading-level',
          commandArg: 1,
          activeWhen: (ctx) => ctx.selection?.activeLevel === 1,
        },
        {
          id: 'h2',
          label: 'H2',
          command: 'note-view.set-heading-level',
          commandArg: 2,
          activeWhen: (ctx) => ctx.selection?.activeLevel === 2,
        },
        {
          id: 'h3',
          label: 'H3',
          command: 'note-view.set-heading-level',
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
      command: 'note-view.toggle-bold',
      group: 'left',
      order: 30,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('bold'),
    },
    {
      id: 'note-view.italic',
      view: VIEW,
      kind: 'button',
      label: 'I',
      command: 'note-view.toggle-italic',
      group: 'left',
      order: 31,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('italic'),
    },
    {
      id: 'note-view.underline',
      view: VIEW,
      kind: 'button',
      label: 'U',
      command: 'note-view.toggle-underline',
      group: 'left',
      order: 31.5,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('underline'),
    },
    {
      id: 'note-view.strike',
      view: VIEW,
      kind: 'button',
      label: 'S',
      command: 'note-view.toggle-strike',
      group: 'left',
      order: 32,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('strike'),
    },
    {
      id: 'note-view.code',
      view: VIEW,
      kind: 'button',
      label: '<>',
      command: 'note-view.toggle-code',
      group: 'left',
      order: 33,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('code'),
    },
  ];
  toolbarRegistry.register(items);
}
