/**
 * NoteView FloatingToolbar 注册 — Q1=A:4 mark 按钮(同顶部 Toolbar)
 *
 * 见 docs/RefactorV2/stages/L5B3.1-interactions-design.md § 5.1。
 */

import { floatingToolbarRegistry } from '@slot/interaction-registries/floating-toolbar-registry/floating-toolbar-registry';
import type { FloatingToolbarItem } from '@slot/interaction-registries/floating-toolbar-registry/floating-toolbar-types';

const VIEW = 'note-view';

export function registerFloatingToolbar(): void {
  const items: FloatingToolbarItem[] = [
    {
      id: 'note-view.ft.bold',
      label: 'B',
      command: 'note-view.toggle-bold',
      view: VIEW,
      order: 10,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('bold'),
    },
    {
      id: 'note-view.ft.italic',
      label: 'I',
      command: 'note-view.toggle-italic',
      view: VIEW,
      order: 20,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('italic'),
    },
    {
      id: 'note-view.ft.underline',
      label: 'U',
      command: 'note-view.toggle-underline',
      view: VIEW,
      order: 25,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('underline'),
    },
    {
      id: 'note-view.ft.strike',
      label: 'S',
      command: 'note-view.toggle-strike',
      view: VIEW,
      order: 30,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('strike'),
    },
    {
      id: 'note-view.ft.code',
      label: '<>',
      command: 'note-view.toggle-code',
      view: VIEW,
      order: 40,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('code'),
    },
    // L5-B3.3:文字色 / 高亮(循环 6 色;完整 ColorPicker UI 留 L5-B3.4)
    {
      id: 'note-view.ft.text-color',
      label: 'A',
      command: 'note-view.cycle-text-color',
      view: VIEW,
      order: 50,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('textStyle'),
    },
    {
      id: 'note-view.ft.highlight',
      label: 'A̲',
      command: 'note-view.cycle-highlight',
      view: VIEW,
      order: 60,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('highlight'),
    },
  ];
  floatingToolbarRegistry.register(items);
}
