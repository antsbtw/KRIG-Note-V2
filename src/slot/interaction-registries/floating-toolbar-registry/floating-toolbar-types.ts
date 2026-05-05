/** FloatingToolbar 类型(选区上方工具条)*/

export interface FloatingToolbarItem {
  id: string;
  label: string;
  command: string;
  view?: string;
  /** 图标 ID(对应 Lucide 图标名,可选)*/
  icon?: string;
  group?: string;
  order?: number;
}
