/**
 * NoteView FloatingToolbar 注册(L5-B3.10 重组,对齐 V1 顺序)
 *
 * V1 顺序(参考 src/plugins/note/components/FloatingToolbar.tsx):
 *   B / I / U / S / <>(5 mark)
 *   ─── 分隔
 *   ∑(行内公式 — V1 在颜色之前,选中文字 → 转 mathInline)
 *   ─── 分隔
 *   🔗(链接 popup)
 *   ─── 分隔
 *   颜色(V1 单按钮综合面板;V2 拆 A / A̲ 两个按钮 — 用户拍板,各自独立 popup)
 *
 * V2 当前(L5-B3.10):
 * - 5 mark / ∑ / 🔗 / A / A̲ 五组,group 字段控制分隔
 * - FloatingToolbarBinding 用 group-with-dividers 渲染竖线分隔符
 *
 * 占位项(留 sub-stage):
 * - V1 颜色按钮综合面板(IconTextColor 含上次用色记忆)— 留 ColorPicker UX 升级
 * - V1 没的"清除格式"按钮 — 跟 context menu 移除格式一起做
 */

import { floatingToolbarRegistry } from '@slot/interaction-registries/floating-toolbar-registry/floating-toolbar-registry';
import type { FloatingToolbarItem } from '@slot/interaction-registries/floating-toolbar-registry/floating-toolbar-types';

const VIEW = 'note-view';

export function registerFloatingToolbar(): void {
  const items: FloatingToolbarItem[] = [
    // ── group: marks(5 个 mark 按钮)──
    {
      id: 'note-view.ft.bold',
      label: 'B',
      command: 'note-view.toggle-bold',
      view: VIEW,
      group: 'marks',
      order: 10,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('bold'),
    },
    {
      id: 'note-view.ft.italic',
      label: 'I',
      command: 'note-view.toggle-italic',
      view: VIEW,
      group: 'marks',
      order: 20,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('italic'),
    },
    {
      id: 'note-view.ft.underline',
      label: 'U',
      command: 'note-view.toggle-underline',
      view: VIEW,
      group: 'marks',
      order: 25,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('underline'),
    },
    {
      id: 'note-view.ft.strike',
      label: 'S',
      command: 'note-view.toggle-strike',
      view: VIEW,
      group: 'marks',
      order: 30,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('strike'),
    },
    {
      id: 'note-view.ft.code',
      label: '<>',
      command: 'note-view.toggle-code',
      view: VIEW,
      group: 'marks',
      order: 40,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('code'),
    },
    // ── group: math(分隔)──
    {
      id: 'note-view.ft.math-inline',
      label: '∑',
      command: 'note-view.insert-math-inline',
      view: VIEW,
      group: 'math',
      order: 50,
    },
    // ── group: link(分隔)──
    {
      id: 'note-view.ft.link',
      label: '🔗',
      kind: 'popup-trigger',
      popupId: 'note-view.popup.link',
      view: VIEW,
      group: 'link',
      order: 60,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('link'),
    },
    // ── group: color(分隔)— V1 综合一个按钮;V2 拆两个 ──
    {
      id: 'note-view.ft.text-color',
      label: 'A',
      kind: 'popup-trigger',
      popupId: 'note-view.popup.color',
      view: VIEW,
      group: 'color',
      order: 70,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('textStyle'),
    },
    {
      id: 'note-view.ft.highlight',
      label: 'A̲',
      kind: 'popup-trigger',
      popupId: 'note-view.popup.color',
      view: VIEW,
      group: 'color',
      order: 80,
      activeWhen: (ctx) => !!ctx.selection?.activeMarks?.includes('highlight'),
    },
  ];
  floatingToolbarRegistry.register(items);
}
