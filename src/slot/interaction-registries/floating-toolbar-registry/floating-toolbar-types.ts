/** FloatingToolbar 类型(选区上方工具条)*/

import type { ToolbarItemContext } from '@slot/toolbar-registry/toolbar-types';

export interface FloatingToolbarItem {
  id: string;
  label: string;
  /**
   * kind:
   * - 'button'(默认/缺省)— 点击执行 command
   * - 'popup-trigger'(L5-B3.4)— 点击调 popupController.toggle(popupId, anchorEl)
   */
  kind?: 'button' | 'popup-trigger';
  /** kind='button' 时执行的命令 ID;kind='popup-trigger' 时可省 */
  command?: string;
  commandArg?: unknown;
  /** kind='popup-trigger' 时必填;指向 popupRegistry 已注册的 popup ID */
  popupId?: string;
  view?: string;
  /** 图标 ID(对应 Lucide 图标名,可选)*/
  icon?: string;
  group?: string;
  order?: number;
  /** L5-B3.1:订阅 selection capability 计算 active 高亮 */
  activeWhen?: (ctx: ToolbarItemContext) => boolean;
}
