/** Handle 菜单类型(块手柄)*/

export interface HandleItem {
  id: string;
  label: string;
  command: string;
  view?: string;
  /** 关联的 block 类型(可选,如只对 textBlock 显示)*/
  blockType?: string;
  group?: string;
  order?: number;
}
