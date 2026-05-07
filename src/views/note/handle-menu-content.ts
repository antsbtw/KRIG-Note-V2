/**
 * NoteView HandleMenu 注册(L5-B3.9 重组,对齐 V1)
 *
 * V1 handle 菜单层级(参考 src/plugins/note/components/HandleMenu.tsx):
 *   Turn Into ▸(子菜单)
 *   Color ▸(子菜单)
 *   Frame ▸(子菜单 — V2 暂无 frame block,留 Phase D)
 *   Format ▸(只在有 indent 时显示)
 *   Collapse/Expand(只在 heading 时显示)
 *   ─── 分隔
 *   Copy
 *   Copy Link
 *   Thought(V2 暂无 thought,留 Phase D)
 *   Ask AI(V2 暂无 AI 集成,留 Phase D 跟 L5-B4.3 一起)
 *   ─── 分隔
 *   Delete
 *
 * V2 当前(L5-B3.9):
 * - 菜单 binding 已支持 group 分组(item.group 切换 → 渲染分隔符)
 * - 子菜单暂未实现(留 sub-stage),Turn Into 各项目前平铺;Color 留 sub-stage 接 popup
 *
 * 分组(用 group 字段控制分隔符):
 * - 'turn-into' — 11 个 Turn Into 选项(平铺)
 * - 'block-actions' — Copy / Copy Link / Duplicate
 * - 'destructive' — Delete
 */

import { handleRegistry } from '@slot/interaction-registries/handle-registry/handle-registry';

const VIEW = 'note-view';

export function registerHandleMenu(): void {
  handleRegistry.register([
    // ── group: turn-into ──
    { id: 'note-view.h.turn-p', label: '↔ Paragraph', command: 'note-view.handle-turn-paragraph',
      view: VIEW, group: 'turn-into', order: 10 },
    { id: 'note-view.h.turn-h1', label: '↔ Heading 1', command: 'note-view.handle-turn-h1',
      view: VIEW, group: 'turn-into', order: 11 },
    { id: 'note-view.h.turn-h2', label: '↔ Heading 2', command: 'note-view.handle-turn-h2',
      view: VIEW, group: 'turn-into', order: 12 },
    { id: 'note-view.h.turn-h3', label: '↔ Heading 3', command: 'note-view.handle-turn-h3',
      view: VIEW, group: 'turn-into', order: 13 },
    { id: 'note-view.h.turn-bullet', label: '↔ Bullet List', command: 'note-view.handle-turn-bullet',
      view: VIEW, group: 'turn-into', order: 14 },
    { id: 'note-view.h.turn-ordered', label: '↔ Numbered List', command: 'note-view.handle-turn-ordered',
      view: VIEW, group: 'turn-into', order: 15 },
    { id: 'note-view.h.turn-task', label: '↔ Task List', command: 'note-view.handle-turn-task',
      view: VIEW, group: 'turn-into', order: 16 },
    { id: 'note-view.h.turn-quote', label: '↔ Quote', command: 'note-view.handle-turn-quote',
      view: VIEW, group: 'turn-into', order: 17 },
    { id: 'note-view.h.turn-code', label: '↔ Code Block', command: 'note-view.handle-turn-code',
      view: VIEW, group: 'turn-into', order: 18 },
    { id: 'note-view.h.turn-callout', label: '↔ Callout', command: 'note-view.handle-turn-callout',
      view: VIEW, group: 'turn-into', order: 19 },
    { id: 'note-view.h.turn-toggle', label: '↔ Toggle List', command: 'note-view.handle-turn-toggle',
      view: VIEW, group: 'turn-into', order: 20 },
    // ── group: block-actions(分隔)──
    { id: 'note-view.h.copy', label: '📋 Copy', command: 'note-view.handle-copy-block',
      view: VIEW, group: 'block-actions', order: 30 },
    { id: 'note-view.h.copy-link', label: '🔗 Copy Link', command: 'note-view.handle-copy-block-link',
      view: VIEW, group: 'block-actions', order: 31 },
    { id: 'note-view.h.duplicate', label: '⧉ Duplicate', command: 'note-view.handle-duplicate-block',
      view: VIEW, group: 'block-actions', order: 32 },
    // ── group: destructive(分隔)──
    { id: 'note-view.h.delete', label: '🗑 Delete', command: 'note-view.handle-delete-block',
      view: VIEW, group: 'destructive', order: 40 },
  ]);
}
