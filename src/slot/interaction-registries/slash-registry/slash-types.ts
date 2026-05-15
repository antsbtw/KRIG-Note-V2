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
  group?: string;
  order?: number;
}
