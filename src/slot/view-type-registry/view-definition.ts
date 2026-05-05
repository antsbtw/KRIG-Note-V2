/**
 * ViewDefinition 类型
 *
 * L5 view 注册自身的声明(charter § 1.4 view 是能力组合声明)。
 */

import type { ContextMenuItem } from '../interaction-registries/context-menu-registry/context-menu-types';
import type { SlashItem } from '../interaction-registries/slash-registry/slash-types';
import type { HandleItem } from '../interaction-registries/handle-registry/handle-types';
import type { FloatingToolbarItem } from '../interaction-registries/floating-toolbar-registry/floating-toolbar-types';
import type { ToolbarItem } from '../toolbar-registry/toolbar-types';

export interface ViewDefinition {
  /** view ID(命名反映能力组合,如 'note' / 'graph-canvas')*/
  id: string;
  /** install 的能力 ID 列表 */
  install: string[];
  /** view 独有右键菜单项(可选;注册时自动拆到 contextMenuRegistry,view 字段补为 id)*/
  contextMenu?: Omit<ContextMenuItem, 'view'>[];
  /** view 独有 Toolbar 项 */
  toolbar?: Omit<ToolbarItem, 'view'>[];
  /** view 独有 Slash 项 */
  slash?: Omit<SlashItem, 'view'>[];
  /** view 独有 Handle 项 */
  handle?: Omit<HandleItem, 'view'>[];
  /** view 独有 FloatingToolbar 项 */
  floatingToolbar?: Omit<FloatingToolbarItem, 'view'>[];
}
