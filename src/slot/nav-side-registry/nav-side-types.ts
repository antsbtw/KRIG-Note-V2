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
  /**
   * 搜索框 placeholder(可选 — 不填不渲染搜索框)
   *
   * 例:Note view 填 "搜索笔记...",eBook 填 "搜索书库..."
   */
  searchPlaceholder?: string;
  /**
   * 搜索回调(raw — view 自己 debounce)
   *
   * 设计取舍(Q1=A):binding 不内置 debounce,因为各 view 搜索成本不同。
   * view 拿到 raw input 后自由 debounce / 节流。
   */
  onSearch?: (query: string) => void;
  /** 内容渲染器(React 组件)— 由能力 / view 提供 */
  contentRenderer: () => ReactElement;
}
