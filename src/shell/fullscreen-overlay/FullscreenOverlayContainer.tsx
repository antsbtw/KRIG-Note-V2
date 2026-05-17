/**
 * Fullscreen Overlay Container — L2 Shell sibling 容器
 *
 * 与 WorkspaceContainer 并列,在 <App> 内三 sibling 之一:
 *   <WorkspaceBar />
 *   <WorkspaceContainer />
 *   <FullscreenOverlayContainer />  ← 本组件
 *
 * 本组件只是 FullscreenOverlayBinding 的轻量包装(对齐 PopupFrame 模式),
 * 主要意义在于:
 * - 作为 L2 Shell 子目录的 React 入口
 * - 让 App 入口的层级清晰:三 sibling 各司其职
 *
 * 显隐由 FullscreenOverlayBinding 自管(inactive 时 binding 返回 null)。
 * 与之配套,App 入口需要在 active 时给 WorkspaceBar + WorkspaceContainer
 * 加 display:none(否则它们仍占布局,但被 binding 的 fixed inset:0 视觉覆盖)。
 */

import { FullscreenOverlayBinding } from './FullscreenOverlayBinding';
import './fullscreen-overlay.css';

export function FullscreenOverlayContainer() {
  return <FullscreenOverlayBinding />;
}
