/** Slash 命令类型 */

export interface SlashItem {
  id: string;
  label: string;
  /** 字符串引用 commandRegistry */
  command: string;
  /** 关键词(用户输入 / 后过滤)*/
  keywords?: string[];
  /** 关联 view(undefined = 全局)*/
  view?: string;
  /**
   * 条目作用域(L5-G4.5,与 floating-toolbar 同形态):
   * - 'view'(默认):仅 view===viewId 时可见
   * - 'global':所有 PM-using view 可见(turn-into H1-H3 / list / quote 等通用)
   */
  scope?: 'view' | 'global';
  group?: string;
  order?: number;
}
