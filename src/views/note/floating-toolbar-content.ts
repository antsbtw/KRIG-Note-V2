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
    // L5-B3.4:link mark — popup-trigger 弹 LinkPanel
    {
      id: 'note-view.ft.link',
      label: '🔗',
      kind: 'popup-trigger',
      popupId: 'note-view.popup.link',
      view: VIEW,
      order: 45,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('link'),
    },
    // L5-B3.4:文字色 / 高亮 — popup-trigger 弹 ColorPickerPanel(完整 10 色 swatch)
    // 注:cycle 命令(L5-B3.3 缩水版)保留作快捷键备份(本阶段不绑;后续 Cmd+Shift+H 之类可绑)
    {
      id: 'note-view.ft.text-color',
      label: 'A',
      kind: 'popup-trigger',
      popupId: 'note-view.popup.color',
      view: VIEW,
      order: 50,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('textStyle'),
    },
    {
      id: 'note-view.ft.highlight',
      label: 'A̲',
      kind: 'popup-trigger',
      popupId: 'note-view.popup.color',
      view: VIEW,
      order: 60,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('highlight'),
    },
    // L5-B3.6:行内公式 — 选中文字(LaTeX 源码)→ 转 mathInline atom 渲染
    //   选区为空时 insert 空 atom,用户单击触发编辑弹窗(备份路径)
    {
      id: 'note-view.ft.math-inline',
      label: '∑',
      command: 'note-view.insert-math-inline',
      view: VIEW,
      order: 70,
    },
  ];
  floatingToolbarRegistry.register(items);
}
