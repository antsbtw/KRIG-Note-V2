/**
 * NoteView HandleMenu 注册(L5-B3.11 完整对齐 V1;2026-05-15 Color 接入)
 *
 * V1 handle 菜单层级(完整对齐截图):
 *   ↔ Turn Into  ▸    (子菜单 — 11 项)
 *   🎨 Color      ▸    (panel 模式 — Notion 同款栈式切换,2026-05-15 接入)
 *   ▣ 框定         ▸    (子菜单 — V2 暂无 frame block,占位)
 *   ¶ Format      ▸    (子菜单 — 仅在 indent attr 存在时显示;V2 暂无 indent,
 *                       条件 visibleWhen 留 false 直到 indent attr 实现)
 *   ─── 分隔
 *   📋 Copy
 *   🔗 Copy Link
 *   ⧉ Duplicate
 *   💭 Thought         (占位 — V2 暂无 thought 系统)
 *   🤖 Ask AI           (占位 — V2 暂无 AI 集成)
 *   ─── 分隔
 *   🗑 Delete
 *
 * 占位项约定:command 留空字符串 → HandleMenuBinding 渲染 disabled,点击无效。
 * 子菜单容器项:submenuId 设置,无 command → 仅展开子菜单,不响应点击。
 * Panel 容器项:panelId + panelRender 设置 → 点击切换主菜单为 panel(Notion 模式)。
 * 条件显示:visibleWhen 返回 false 时不渲染该 item(对齐 V1 Format 仅在有 indent 时)。
 */

import { createElement } from 'react';
import { handleRegistry } from '@slot/interaction-registries/handle-registry/handle-registry';
import { HandleColorPanel } from './color-picker/HandleColorPanel';

const VIEW = 'note-view';

// 占位:暂未实现的命令(渲染 disabled)
const TODO = '';

export function registerHandleMenu(): void {
  handleRegistry.register([
    // ── 顶层:5 个 submenu 容器 ──(对齐 V1 顺序)
    { id: 'note-view.h.turn-into', icon: '↔', label: 'Turn Into', command: TODO,
      submenuId: 'turn-into', view: VIEW, group: 'transform', order: 10 },
    { id: 'note-view.h.color', icon: '🎨', label: 'Color', command: TODO,
      panelId: 'color', view: VIEW, group: 'transform', order: 20,
      panelRender: (ctx) => createElement(HandleColorPanel, { ctx }) },
    { id: 'note-view.h.frame', icon: '▣', label: '框定', command: TODO,
      submenuId: 'frame', view: VIEW, group: 'transform', order: 30 },
    { id: 'note-view.h.format', icon: '¶', label: 'Format', command: TODO,
      submenuId: 'format', view: VIEW, group: 'transform', order: 40,
      // V1:仅在 block 有 indent attr 时显示;V2 schema 暂无 indent → 永远 false
      // 留 sub-stage 实现 indent 时改成 ctx => ctx.blockAttrs.indent !== undefined && !ctx.blockAttrs.isTitle
      visibleWhen: () => false },

    // ── 顶层:block 操作 ── (group 切换 → 自动分隔符)
    { id: 'note-view.h.copy', icon: '📋', label: 'Copy', command: 'note-view.handle-copy-block',
      view: VIEW, group: 'block-actions', order: 50 },
    { id: 'note-view.h.copy-link', icon: '🔗', label: 'Copy Link', command: 'note-view.handle-copy-block-link',
      view: VIEW, group: 'block-actions', order: 51 },
    { id: 'note-view.h.duplicate', icon: '⧉', label: 'Duplicate', command: 'note-view.handle-duplicate-block',
      view: VIEW, group: 'block-actions', order: 52 },
    { id: 'note-view.h.thought', icon: '💭', label: 'Thought', command: TODO,
      view: VIEW, group: 'block-actions', order: 53 },
    { id: 'note-view.h.ask-ai', icon: '🤖', label: 'Ask AI', command: TODO,
      view: VIEW, group: 'block-actions', order: 54 },

    // ── 顶层:destructive ──
    { id: 'note-view.h.delete', icon: '🗑', label: 'Delete', command: 'note-view.handle-delete-block',
      view: VIEW, group: 'destructive', order: 90 },

    // ── submenu: turn-into(11 项)──
    { id: 'note-view.h.sub.turn-p', icon: '¶', label: 'Paragraph',
      command: 'note-view.handle-turn-paragraph', submenuOf: 'turn-into', view: VIEW, order: 10 },
    { id: 'note-view.h.sub.turn-h1', icon: 'H1', label: 'Heading 1',
      command: 'note-view.handle-turn-h1', submenuOf: 'turn-into', view: VIEW, order: 11 },
    { id: 'note-view.h.sub.turn-h2', icon: 'H2', label: 'Heading 2',
      command: 'note-view.handle-turn-h2', submenuOf: 'turn-into', view: VIEW, order: 12 },
    { id: 'note-view.h.sub.turn-h3', icon: 'H3', label: 'Heading 3',
      command: 'note-view.handle-turn-h3', submenuOf: 'turn-into', view: VIEW, order: 13 },
    { id: 'note-view.h.sub.turn-bullet', icon: '•', label: 'Bullet List',
      command: 'note-view.handle-turn-bullet', submenuOf: 'turn-into', view: VIEW, order: 14 },
    { id: 'note-view.h.sub.turn-ordered', icon: '1.', label: 'Numbered List',
      command: 'note-view.handle-turn-ordered', submenuOf: 'turn-into', view: VIEW, order: 15 },
    { id: 'note-view.h.sub.turn-task', icon: '☐', label: 'Task List',
      command: 'note-view.handle-turn-task', submenuOf: 'turn-into', view: VIEW, order: 16 },
    { id: 'note-view.h.sub.turn-quote', icon: '"', label: 'Quote',
      command: 'note-view.handle-turn-quote', submenuOf: 'turn-into', view: VIEW, order: 17 },
    { id: 'note-view.h.sub.turn-code', icon: '<>', label: 'Code Block',
      command: 'note-view.handle-turn-code', submenuOf: 'turn-into', view: VIEW, order: 18 },
    { id: 'note-view.h.sub.turn-callout', icon: '!', label: 'Callout',
      command: 'note-view.handle-turn-callout', submenuOf: 'turn-into', view: VIEW, order: 19 },
    { id: 'note-view.h.sub.turn-toggle', icon: '▸', label: 'Toggle List',
      command: 'note-view.handle-turn-toggle', submenuOf: 'turn-into', view: VIEW, order: 20 },

    // ── (color 走 panel 模式,见上面 note-view.h.color 的 panelId/panelRender)──

    // ── submenu: frame(占位 — V2 暂无 frame block)──
    { id: 'note-view.h.sub.frame-todo', icon: '⏳', label: '暂未实现 — frame block 留 Phase D',
      command: TODO, submenuOf: 'frame', view: VIEW, order: 10 },

    // ── submenu: format(占位 — V2 暂无 indent)── (visibleWhen 现在返回 false,sub 不显示)
    { id: 'note-view.h.sub.format-todo', icon: '⏳', label: '暂未实现 — indent attr 留 sub-stage',
      command: TODO, submenuOf: 'format', view: VIEW, order: 10 },
  ]);
}
