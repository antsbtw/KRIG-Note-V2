/**
 * ThoughtView HandleMenu 注册(对齐 V1 ThoughtEditor + V2 charter §1.4)
 *
 * V1 ThoughtEditor 字面继承 NoteEditor 全部能力,handle menu 默认开。
 *
 * V2 实施:仅注册 PM 通用项(turn-into / color / block actions);
 * NoteView 的业务专属项(Copy Link 依 noteId / 💭 Thought 防自递归 / 🤖 Ask AI
 * 字面禁)thought-view 不注册。
 */

import { handleRegistry } from '@slot/interaction-registries/handle-registry/handle-registry';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';

const VIEW = 'thought-view';

export function registerHandleMenu(): void {
  const ui = requireCapabilityApi<TextEditingApi>('text-editing').ui.handleMenu;
  handleRegistry.register([
    // 顶层 submenu 容器
    ui.createTurnIntoContainer(VIEW),
    ui.createColorContainer(VIEW),
    // PM 通用 turn-into submenu(11 项)
    ...ui.createTurnIntoSubmenu(VIEW),
    // PM 通用 block 操作 + destructive(Copy / Duplicate / Delete)
    ...ui.createBlockActions(VIEW),
  ]);
}
