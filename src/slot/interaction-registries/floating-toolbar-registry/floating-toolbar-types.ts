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
  /**
   * 条目作用域(L5-G4.5):
   * - 'view'(默认 — 缺省即此值,保 NoteView 现有行为零回归):仅 view===viewId 时可见
   * - 'global':对所有 PM-using view 可见(mark / link / color 这种通用 PM 编辑能力)
   *
   * 显式优于"忘填"语义:scope: 'global' 是注册者**主动声明**这条对所有 view 可用,
   * 不是 view 字段为空时的隐含通用.
   */
  scope?: 'view' | 'global';
  /** 图标 ID(对应 Lucide 图标名,可选)*/
  icon?: string;
  group?: string;
  order?: number;
  /** L5-B3.1:订阅 selection capability 计算 active 高亮 */
  activeWhen?: (ctx: ToolbarItemContext) => boolean;
}
