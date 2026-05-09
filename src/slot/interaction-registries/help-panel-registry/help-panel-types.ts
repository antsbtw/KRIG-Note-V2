/**
 * Help Panel Registry 类型(L4.1)
 *
 * help-panel 是右栏定宽长侧栏(对比 popup 是 anchor-positioned 小卡):
 * - 位置:`position: fixed; right: 0; top: var(--krig-help-panel-top, 0); width: 360px; height: 100vh - top`
 * - 形态:从 viewport 顶到底,贴右
 * - 关闭:× 按钮 / Esc / 点面板外(支持 excludeFromClickOutside 白名单)
 * - 互斥:同一时刻只一个 help-panel 可见(独立池,跟 popup 无关)
 * - 内容:由 view 提供 React 组件;shell(header + close × + body 容器)由 binding 渲染
 *
 * 用例(V1 → V2 渐进迁):
 * - L4.1 本期:dictionary(从 popup-registry 迁过来)
 * - 后续:latex / mermaid / math-visual / bookmarks(跟 mathBlock 等功能阶段一起迁)
 */

import type { ComponentType } from 'react';

/** 子面板 Component 接收的 props(用于自管关闭)*/
export interface HelpPanelCloseProps {
  /** 关闭面板(子面板内部确认完成 / 取消时调用)*/
  onClose: () => void;
}

export interface HelpPanelItem {
  /** 面板 ID,跨 view 唯一(命名建议:`<view>.help.<name>`)*/
  id: string;

  /** view 作用域过滤(undefined = 全 view 可用)*/
  view?: string;

  /** Header 标题文字 */
  title: string;

  /** Body 内容组件 — view 实现 */
  Component: ComponentType<HelpPanelCloseProps>;

  /**
   * 点这些 CSS selector 匹配的元素时,不算"点外部"(不关闭面板)。
   * 面板自身始终被排除。
   * 示例(V1):LaTeX 排除 `.math-block-wrapper` `.math-inline-editor`。
   */
  excludeFromClickOutside?: string[];
}
