/**
 * ContextMenu 类型
 */

/**
 * enabledWhen 枚举:
 * - 'always'         总是显示
 * - 'has-selection'  选区非空(光标态隐藏)
 * - 'is-editable'    点击位置在可编辑区域
 * - 'has-link'(L5-B3.15)选区上覆盖 link mark — "移除链接"等条件项用
 *
 * 当 enabledWhen 不满足时:本 item 不渲染(对齐 V1 "条件显示"行为)。
 * 加新枚举时同步 use-context-menu-trigger 的 ContextInfo 计算逻辑。
 */
export type EnabledWhen = 'always' | 'has-selection' | 'is-editable' | 'has-link';

export interface ContextMenuItem {
  id: string;
  label: string;
  /** 字符串引用 commandRegistry */
  command: string;
  enabledWhen?: EnabledWhen;
  group?: string;
  order?: number;
  /** 关联的 view ID(undefined = 全局,所有 view 显示) */
  view?: string;
}

/** 触发时的上下文信息(用于 enabledWhen 判断) */
export interface ContextInfo {
  hasSelection: boolean;
  isEditable: boolean;
  /** L5-B3.15:选区上是否覆盖 link mark(给"移除链接"条件项用) */
  hasLink: boolean;
  /** 鼠标位置 */
  x: number;
  y: number;
}
