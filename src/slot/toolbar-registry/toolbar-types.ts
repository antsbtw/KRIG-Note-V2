/** Toolbar 项类型 — L5-B2 升级 */

import type { SelectionPayload } from '@capabilities/selection';

/** ToolbarItem 渲染时上下文(订阅 selection capability 计算) */
export interface ToolbarItemContext {
  selection: SelectionPayload | null;
}

export type ToolbarKind = 'button' | 'dropdown' | 'separator';

export interface DropdownOption {
  id: string;
  label: string;
  command: string;
  commandArg?: unknown;
  /** 当前选中态判定(给 dropdown 内单项 active 高亮)*/
  activeWhen?: (ctx: ToolbarItemContext) => boolean;
}

export interface ToolbarItem {
  id: string;
  label: string;
  /** 默认 'button' */
  kind?: ToolbarKind;
  /** button / dropdown option 用 */
  command?: string;
  /** 静态 commandArg(button/option 都用得到)*/
  commandArg?: unknown;
  /** 图标名(对应 Lucide 或简单字符)*/
  icon?: string;
  /** 关联 view(undefined = 全局)*/
  view?: string;
  /** 显示位置 */
  group?: 'left' | 'center' | 'right';
  order?: number;
  /** 当前是否激活高亮(button 用;订阅 selection capability 计算) */
  activeWhen?: (ctx: ToolbarItemContext) => boolean;
  /** dropdown 选项列表 */
  options?: DropdownOption[];
  /** dropdown 当前显示 label(动态 — 例如 "Paragraph" / "H2")*/
  currentLabel?: (ctx: ToolbarItemContext) => string;
}
