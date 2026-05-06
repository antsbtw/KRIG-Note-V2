/** FloatingToolbar 类型(选区上方工具条)*/

import type { ToolbarItemContext } from '@slot/toolbar-registry/toolbar-types';

export interface FloatingToolbarItem {
  id: string;
  label: string;
  command: string;
  commandArg?: unknown;
  view?: string;
  /** 图标 ID(对应 Lucide 图标名,可选)*/
  icon?: string;
  group?: string;
  order?: number;
  /** L5-B3.1:订阅 selection capability 计算 active 高亮 */
  activeWhen?: (ctx: ToolbarItemContext) => boolean;
}
