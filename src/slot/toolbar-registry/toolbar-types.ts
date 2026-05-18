/** Toolbar 项类型 — L5-B2 升级 */

import type { ComponentType } from 'react';
import type { SelectionPayload } from '@capabilities/selection';

/** ToolbarItem 渲染时上下文(订阅 selection capability 计算) */
export interface ToolbarItemContext {
  selection: SelectionPayload | null;
}

export type ToolbarKind =
  | 'button'
  | 'dropdown'
  | 'separator'
  | 'popup-trigger'
  | 'custom-render';

export interface DropdownOption {
  id: string;
  label: string;
  command: string;
  commandArg?: unknown;
  /** 当前选中态判定(给 dropdown 内单项 active 高亮)*/
  activeWhen?: (ctx: ToolbarItemContext) => boolean;
  /** 禁用态(灰色 + 不响应点击) — 用于占位未实现的选项 */
  disabled?: boolean;
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
  /** kind='popup-trigger' 时必填,指向 popupRegistry 已注册的 popup ID */
  popupId?: string;
  /**
   * kind='custom-render' 时必填 — 自管渲染 React 组件。
   * 用于框架级 button/dropdown 表达不出来的项(如动态文字、特殊样式、
   * 直接耦合 view 数据的小组件)。组件应自行处理点击事件与样式。
   */
  Component?: ComponentType<{ ctx: ToolbarItemContext }>;
  /**
   * 视觉变体(对齐 V1 NoteView toolbar 字面样式):
   * - 'default'(缺省):带 1px solid #555 边框 + height 28 + font 12,
   *   如 V1 saveBtn/newBtn/iconBtn
   * - 'plain':透明无边框 + 24×24 + font 18,如 V1 navBtn(‹ ›)
   * - 'close':透明无边框 + 28×28 + font 16 + color #888,如 V1 closeSlotBtn(×)
   *
   * 仅对 kind='button' / 'popup-trigger' 生效;dropdown/separator 不受影响。
   */
  variant?: 'default' | 'plain' | 'close';
}
