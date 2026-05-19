/**
 * NoteView HandleMenu 注册(C4:工厂函数化,PM 通用项 + NoteView 业务增量)
 *
 * Handle 菜单层级(frame-format step 调整后):
 *   ↔ Turn Into  ▸    (PM 通用)
 *   🎨 Color      ▸    (PM 通用 — submenuRender swatch grid)
 *   ¶ Format     ▸    (PM 通用 — submenuRender indent/text-indent/align)
 *   ─── 分隔
 *   📋 Copy            — PM 通用
 *   🔗 Copy Link       — NoteView 业务
 *   ⧉ Duplicate        — PM 通用
 *   ─── 分隔
 *   🗑 Delete          — PM 通用
 *
 * 注意:
 * - ▣ 框定 已挪到 context menu(右键)— 单 block 操作走 handle,
 *   多块框定 / 框组操作语义更适合右键场景
 * - 💭 Thought / 🤖 Ask AI 由 context menu 提供
 *
 * 注册:
 * - PM 通用 → @capabilities/text-editing/ui/handle-menu/items 工厂(C0 决议 D-B)
 * - NoteView 业务 → 本文件 createNoteSpecificHandleItems 增量
 */

import { handleRegistry } from '@slot/interaction-registries/handle-registry/handle-registry';
import type { HandleItem } from '@slot/interaction-registries/handle-registry/handle-types';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';

const VIEW = 'note-view';

/** NoteView 业务专属 handle item(目前仅 Copy Link)*/
function createNoteSpecificHandleItems(): HandleItem[] {
  return [
    {
      id: `${VIEW}.h.copy-link`, icon: '🔗', label: 'Copy Link',
      command: 'note-view.handle-copy-block-link',
      view: VIEW, group: 'block-actions', order: 51,
    },
  ];
}

export function registerHandleMenu(): void {
  const ui = requireCapabilityApi<TextEditingApi>('text-editing').ui.handleMenu;
  handleRegistry.register([
    // ── 顶层 submenu 容器(对齐 V1 顺序):Turn Into / Color / Format ──
    ui.createTurnIntoContainer(VIEW),
    ui.createColorContainer(VIEW),
    ui.createFormatContainer(VIEW),

    // ── PM 通用 turn-into submenu(11 项)──
    ...ui.createTurnIntoSubmenu(VIEW),

    // ── PM 通用 block 操作 + destructive(Copy / Duplicate / Delete)──
    ...ui.createBlockActions(VIEW),

    // ── NoteView 业务增量(Copy Link)──
    ...createNoteSpecificHandleItems(),
  ]);
}
