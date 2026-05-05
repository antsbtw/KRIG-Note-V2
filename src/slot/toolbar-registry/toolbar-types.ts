/** Toolbar 项类型 */

export interface ToolbarItem {
  id: string;
  label: string;
  /** 字符串引用 commandRegistry */
  command: string;
  /** 图标名(对应 Lucide 图标,可选)*/
  icon?: string;
  /** 关联 view(undefined = 全局)*/
  view?: string;
  /** 显示位置 */
  group?: 'left' | 'center' | 'right';
  order?: number;
}
