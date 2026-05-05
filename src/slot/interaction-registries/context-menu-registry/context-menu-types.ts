/**
 * ContextMenu 类型
 */

export type EnabledWhen = 'always' | 'has-selection' | 'is-editable';

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
  /** 鼠标位置 */
  x: number;
  y: number;
}
