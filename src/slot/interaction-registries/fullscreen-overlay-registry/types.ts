/**
 * Fullscreen Overlay Registry 类型(第七类交互系统)
 *
 * 与 5 大 view-scoped 浮层(context-menu / handle-menu / slash-menu / popup /
 * floating-toolbar)的本质区别:
 *
 * - 5 大浮层:**view-scoped**,挂在 L3 Workspace 内,服务局部弹层,被同一
 *   Workspace 内的 NavSide/Toolbar/View 包围,有 anchor/位置/点外关闭语义
 * - fullscreen-overlay:**app-scoped**,挂在 L2 Shell 内(与 WorkspaceContainer
 *   并列),撑满整个 viewport(含 WorkspaceBar 区域),无 anchor,只能 Esc 或
 *   显式 onClose 关闭
 *
 * 概念定位:全屏专注式编辑视图,与 Workspace 平起平坐 — 用户进入 = 离开
 * Workspace,进入"专注模式";关闭 = 回 Workspace,状态原样保留。
 *
 * 设计契约:
 * - 同一时刻只能一个 overlay 活跃(controller 单例)
 * - overlay 内部布局完全自治(business 想做单面板 / 多 tab / 嵌套 view 都行)
 * - controller 仅约束"外层槽位是否活跃 + 是哪个 id",不约束内部结构
 * - active 时 WorkspaceBar + WorkspaceContainer 一起 display:none
 *
 * 典型使用场景:
 * - mermaid 全屏编辑(代码 + 实时预览)
 * - LaTeX/math 全屏编辑器
 * - 画板全屏编辑
 * - PDF/电子书全屏阅读
 * - 图片预览 + 标注
 * - 视频播放
 * - 设置/对话框 modal
 */

import type { ComponentType } from 'react';

/** overlay 组件接收的 props(用于自管关闭)*/
export interface FullscreenOverlayCloseProps {
  /** 关闭 overlay(组件内部确认完成 / 取消时调用)*/
  onClose: () => void;
}

export interface FullscreenOverlayItem {
  /** overlay ID,全局唯一(命名建议:`<feature>.fullscreen.<name>`)*/
  id: string;

  /** overlay 内容组件 — business 实现,layout 自由 */
  Component: ComponentType<FullscreenOverlayCloseProps>;
}
