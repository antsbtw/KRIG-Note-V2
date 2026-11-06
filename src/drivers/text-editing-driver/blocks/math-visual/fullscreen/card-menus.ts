/**
 * math-visual 说明卡片的编辑菜单 —— 用 note-card 公共组件生成的菜单项(与画板同一套),
 * 在自己的 viewId 下注册一次。
 *
 * 为什么注册在这里而不是 note-card 里:沿用 text-editing「工厂只返回 Item[],注册源在使用方」,
 * 且 capability 不允许依赖 slot 菜单注册表。块手柄关着(= 画板),所以不注册手柄菜单。
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import { slashRegistry } from '@slot/interaction-registries/slash-registry/slash-registry';
import { floatingToolbarRegistry } from '@slot/interaction-registries/floating-toolbar-registry/floating-toolbar-registry';
import type { NoteCardApi } from '@capabilities/note-card/types';

export const MV_CARD_VIEW_ID = 'math-visual-card';

let registered = false;
/** 幂等:菜单按 viewId 不按文档,重复注册会堆出重复项 */
export function ensureMathVisualCardMenus(): void {
  if (registered) return;
  registered = true;
  const items = requireCapabilityApi<NoteCardApi>('note-card').menuItems(MV_CARD_VIEW_ID);
  slashRegistry.register(items.slash);
  floatingToolbarRegistry.register(items.floatingToolbar);
}
