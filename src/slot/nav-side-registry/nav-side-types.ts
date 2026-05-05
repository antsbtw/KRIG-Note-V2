/** NavSide 内容类型 */

import type { ReactElement } from 'react';

export interface NavSideAction {
  id: string;
  label: string;
  /** 字符串引用 commandRegistry */
  command: string;
}

export interface NavSideContent {
  /** 关联 view(view active 时显示对应 NavSide 内容)*/
  view: string;
  /** NavSide 顶部标题 */
  title: string;
  /** 顶部 action 按钮(可选)*/
  actions?: NavSideAction[];
  /** 内容渲染器(React 组件)— 由能力 / view 提供 */
  contentRenderer: () => ReactElement;
}
