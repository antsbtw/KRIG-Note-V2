/**
 * ③ 菜单项:与画板文字节点注册的同一套(views/graph-canvas-view/index.ts registerTextEditingMenusForCanvas)
 *
 * - 斜杠:「转换为…」+ 块公式,过渲染闸(卡片是 atomsToSvg 画的,插了画不出的块会变灰字 / 丢内容)
 * - 浮动工具条:文字样式 / 公式 / 链接 / 颜色
 * - 手柄(仅打开块手柄时注册):转换 / 颜色 / 格式 / 块操作,「转换为…」同样过闸
 *
 * 只生成不注册 —— 注册源在使用方(text-editing 工厂约定;capability 不依赖 slot 菜单注册表)。
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';
import {
  filterSlashItemsToRenderable,
  filterHandleItemsToRenderable,
} from '../../lib/atom-serializers/svg/slash-render-gate';
import type { NoteCardMenuItems } from './types';

export function menuItems(viewId: string): NoteCardMenuItems {
  const ui = requireCapabilityApi<TextEditingApi>('text-editing').ui;
  return {
    slash: filterSlashItemsToRenderable([
      ...ui.slashMenu.createTurnIntoItems(viewId),
      ui.slashMenu.createMathBlockItem(viewId),
    ]),
    floatingToolbar: [
      ...ui.floatingToolbar.createMarkButtons(viewId),
      ui.floatingToolbar.createMathButton(viewId),
      ui.floatingToolbar.createLinkButton(viewId),
      ui.floatingToolbar.createColorButton(viewId),
    ],
    handle: filterHandleItemsToRenderable([
      ui.handleMenu.createTurnIntoContainer(viewId),
      ui.handleMenu.createColorContainer(viewId),
      ui.handleMenu.createFormatContainer(viewId),
      ...ui.handleMenu.createTurnIntoSubmenu(viewId),
      ...ui.handleMenu.createBlockActions(viewId),
    ]),
  };
}
