/**
 * Popup Registry 类型(L5-B3.4)
 *
 * popup 是 anchor-positioned 弹层(对比 OverlayBinding 是全屏 backdrop dialog):
 * - 位置:跟某个触发按钮 anchor 关联(右下展开,溢出时翻边)
 * - 关闭:点击外部 / Esc / 显式 onClose 调用
 * - 内容:由 view 提供 React 组件(view 知道自己 popup 怎么长)
 *
 * 跟 4 大 menu 的区别:popup 是"半受控弹层"— content 是 React 组件,
 * 而非 menu items 列表;事件由 popup 内部处理。
 */

import type { ComponentType } from 'react';

/** popup 内部组件接收的 props(用于自管关闭)*/
export interface PopupCloseProps {
  /** 关闭 popup(popup 内部确认完成 / 取消时调用)*/
  onClose: () => void;
}

export interface PopupItem {
  /** popup ID,跨 view 唯一(命名建议:`<view>.popup.<name>`)*/
  id: string;

  /** view 作用域过滤(undefined = 全 view 可用)*/
  view?: string;

  /** popup 内容组件 — view 实现 */
  Component: ComponentType<PopupCloseProps>;

  /**
   * 估算尺寸(给 PopupBinding 用作初始定位防溢出);
   * 缺则按 anchor 右下展开,实际大小由内容定。
   */
  estimatedSize?: { width: number; height: number };
}
