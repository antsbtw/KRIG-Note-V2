/**
 * NoteView HandleMenu 注册(C4:工厂函数化,PM 通用项 + NoteView 业务增量)
 *
 * V1 handle 菜单层级:
 *   ↔ Turn Into  ▸    (子菜单 — 11 项 button)— PM 通用
 *   🎨 Color      ▸    (子菜单 — submenuRender 自定义 swatch grid)— PM 通用
 *   ▣ 框定         ▸    (子菜单 — V2 暂无 frame block,占位)— NoteView 业务(未实装)
 *   ─── 分隔
 *   📋 Copy            — PM 通用
 *   🔗 Copy Link       — NoteView 业务(依 noteId)
 *   ⧉ Duplicate        — PM 通用
 *   💭 Thought         — NoteView 业务(占位,V2 未实装)
 *   🤖 Ask AI          — NoteView 业务(占位,V2 未实装)
 *   ─── 分隔
 *   🗑 Delete          — PM 通用
 *
 * 注册:
 * - PM 通用 → @capabilities/text-editing/ui/handle-menu/items 工厂(C0 决议 D-B)
 * - NoteView 业务 → 本文件 createNoteSpecificHandleItems 增量
 *
 * 注册原则:永远不会显示的 item 不注册(V1 Format ▸ visibleWhen=false 项已删,
 * indent attr 实装后再加回 — Notion 实际也不在 ⠿ 菜单放 indent,走 Tab/Shift-Tab)。
 */

import { handleRegistry } from '@slot/interaction-registries/handle-registry/handle-registry';
import type { HandleItem } from '@slot/interaction-registries/handle-registry/handle-types';
import {
  createTurnIntoContainer,
  createColorContainer,
  createTurnIntoSubmenu,
  createBlockActions,
} from '@capabilities/text-editing/ui/handle-menu/items';

const VIEW = 'note-view';

// 占位:暂未实现的命令(渲染 disabled,鼠标 hover 不展开 submenu)
const TODO = '';

/** NoteView 业务专属 handle item(Copy Link / Thought / Ask AI / Frame 容器 + Frame submenu placeholder) */
function createNoteSpecificHandleItems(): HandleItem[] {
  return [
    // 顶层容器:▣ 框定(submenu placeholder)
    {
      id: `${VIEW}.h.frame`, icon: '▣', label: '框定', command: TODO,
      submenuId: 'frame', view: VIEW, group: 'transform', order: 30,
    },
    // block-actions:🔗 Copy Link(依 noteId)/ 💭 Thought / 🤖 Ask AI
    {
      id: `${VIEW}.h.copy-link`, icon: '🔗', label: 'Copy Link',
      command: 'note-view.handle-copy-block-link',
      view: VIEW, group: 'block-actions', order: 51,
    },
    {
      id: `${VIEW}.h.thought`, icon: '💭', label: 'Thought', command: TODO,
      view: VIEW, group: 'block-actions', order: 53,
    },
    {
      id: `${VIEW}.h.ask-ai`, icon: '🤖', label: 'Ask AI', command: TODO,
      view: VIEW, group: 'block-actions', order: 54,
    },
    // submenu: frame placeholder
    {
      id: `${VIEW}.h.sub.frame-todo`, icon: '⏳',
      label: '暂未实现 — frame block 留 Phase D',
      command: TODO, submenuOf: 'frame', view: VIEW, order: 10,
    },
  ];
}

export function registerHandleMenu(): void {
  handleRegistry.register([
    // ── 顶层 submenu 容器(对齐 V1 顺序):Turn Into / Color (PM 通用) + Frame (业务) ──
    createTurnIntoContainer(VIEW),
    createColorContainer(VIEW),

    // ── PM 通用 turn-into submenu(11 项)──
    ...createTurnIntoSubmenu(VIEW),

    // ── PM 通用 block 操作 + destructive(Copy / Duplicate / Delete)──
    ...createBlockActions(VIEW),

    // ── NoteView 业务增量(Frame 容器 + Copy Link / Thought / Ask AI + Frame submenu)──
    ...createNoteSpecificHandleItems(),
  ]);
}
