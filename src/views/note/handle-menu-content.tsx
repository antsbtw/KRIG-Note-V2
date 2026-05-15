/**
 * NoteView HandleMenu 注册(L5-B3.11 完整对齐 V1;2026-05-15 Color 统一 submenu 式样)
 *
 * V1 handle 菜单层级:
 *   ↔ Turn Into  ▸    (子菜单 — 11 项 button)
 *   🎨 Color      ▸    (子菜单 — submenuRender 自定义 swatch grid,2026-05-15 接入)
 *   ▣ 框定         ▸    (子菜单 — V2 暂无 frame block,占位)
 *   ─── 分隔
 *   📋 Copy
 *   🔗 Copy Link
 *   ⧉ Duplicate
 *   💭 Thought         (顶层占位 — V2 暂无 thought 系统,disabled)
 *   🤖 Ask AI           (顶层占位 — V2 暂无 AI 集成,disabled)
 *   ─── 分隔
 *   🗑 Delete
 *
 * 统一交互式样(2026-05-15):
 * - 顶层叶 item:click → 触发命令
 * - 顶层带 ▸ item:hover → 右侧浮出 submenu
 * - submenu 内容:默认 button 列表(submenuOf 子项)或 submenuRender 自定义渲染
 *
 * 注册原则:永远不会显示的 item 不注册(V1 Format ▸ visibleWhen=false 项已删,
 * indent attr 实装后再加回 — Notion 实际也不在 ⠿ 菜单放 indent,走 Tab/Shift-Tab)。
 */

import { handleRegistry } from '@slot/interaction-registries/handle-registry/handle-registry';
import { HandleColorSubmenu } from '@capabilities/text-editing/ui/color-picker/HandleColorSubmenu';

const VIEW = 'note-view';

// 占位:暂未实现的命令(渲染 disabled,鼠标 hover 不展开 submenu)
const TODO = '';

export function registerHandleMenu(): void {
  handleRegistry.register([
    // ── 顶层:submenu 容器 ──(对齐 V1 顺序)
    { id: 'note-view.h.turn-into', icon: '↔', label: 'Turn Into', command: TODO,
      submenuId: 'turn-into', view: VIEW, group: 'transform', order: 10 },
    { id: 'note-view.h.color', icon: '🎨', label: 'Color', command: TODO,
      submenuId: 'color', view: VIEW, group: 'transform', order: 20,
      submenuRender: (ctx) => <HandleColorSubmenu ctx={ctx} /> },
    { id: 'note-view.h.frame', icon: '▣', label: '框定', command: TODO,
      submenuId: 'frame', view: VIEW, group: 'transform', order: 30 },

    // ── 顶层:block 操作 ── (group 切换 → 自动分隔符)
    { id: 'note-view.h.copy', icon: '📋', label: 'Copy', command: 'text-editing.handle-copy-block',
      view: VIEW, group: 'block-actions', order: 50 },
    { id: 'note-view.h.copy-link', icon: '🔗', label: 'Copy Link', command: 'note-view.handle-copy-block-link',
      view: VIEW, group: 'block-actions', order: 51 },
    { id: 'note-view.h.duplicate', icon: '⧉', label: 'Duplicate', command: 'text-editing.handle-duplicate-block',
      view: VIEW, group: 'block-actions', order: 52 },
    { id: 'note-view.h.thought', icon: '💭', label: 'Thought', command: TODO,
      view: VIEW, group: 'block-actions', order: 53 },
    { id: 'note-view.h.ask-ai', icon: '🤖', label: 'Ask AI', command: TODO,
      view: VIEW, group: 'block-actions', order: 54 },

    // ── 顶层:destructive ──
    { id: 'note-view.h.delete', icon: '🗑', label: 'Delete', command: 'text-editing.handle-delete-block',
      view: VIEW, group: 'destructive', order: 90 },

    // ── submenu: turn-into(11 项)──
    { id: 'note-view.h.sub.turn-p', icon: '¶', label: 'Paragraph',
      command: 'text-editing.handle-turn-paragraph', submenuOf: 'turn-into', view: VIEW, order: 10 },
    { id: 'note-view.h.sub.turn-h1', icon: 'H1', label: 'Heading 1',
      command: 'text-editing.handle-turn-h1', submenuOf: 'turn-into', view: VIEW, order: 11 },
    { id: 'note-view.h.sub.turn-h2', icon: 'H2', label: 'Heading 2',
      command: 'text-editing.handle-turn-h2', submenuOf: 'turn-into', view: VIEW, order: 12 },
    { id: 'note-view.h.sub.turn-h3', icon: 'H3', label: 'Heading 3',
      command: 'text-editing.handle-turn-h3', submenuOf: 'turn-into', view: VIEW, order: 13 },
    { id: 'note-view.h.sub.turn-bullet', icon: '•', label: 'Bullet List',
      command: 'text-editing.handle-turn-bullet', submenuOf: 'turn-into', view: VIEW, order: 14 },
    { id: 'note-view.h.sub.turn-ordered', icon: '1.', label: 'Numbered List',
      command: 'text-editing.handle-turn-ordered', submenuOf: 'turn-into', view: VIEW, order: 15 },
    { id: 'note-view.h.sub.turn-task', icon: '☐', label: 'Task List',
      command: 'text-editing.handle-turn-task', submenuOf: 'turn-into', view: VIEW, order: 16 },
    { id: 'note-view.h.sub.turn-quote', icon: '"', label: 'Quote',
      command: 'text-editing.handle-turn-quote', submenuOf: 'turn-into', view: VIEW, order: 17 },
    { id: 'note-view.h.sub.turn-code', icon: '<>', label: 'Code Block',
      command: 'text-editing.handle-turn-code', submenuOf: 'turn-into', view: VIEW, order: 18 },
    { id: 'note-view.h.sub.turn-callout', icon: '!', label: 'Callout',
      command: 'text-editing.handle-turn-callout', submenuOf: 'turn-into', view: VIEW, order: 19 },
    { id: 'note-view.h.sub.turn-toggle', icon: '▸', label: 'Toggle List',
      command: 'text-editing.handle-turn-toggle', submenuOf: 'turn-into', view: VIEW, order: 20 },

    // ── submenu: color ── (走 submenuRender 自定义渲染,无 submenuOf 子项)

    // ── submenu: frame ── (V2 暂无 frame block,保留占位)
    { id: 'note-view.h.sub.frame-todo', icon: '⏳', label: '暂未实现 — frame block 留 Phase D',
      command: TODO, submenuOf: 'frame', view: VIEW, order: 10 },
  ]);
}
