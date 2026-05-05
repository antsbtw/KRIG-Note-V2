/**
 * NavSideFrame — 左侧 NavSide 容器(式样)
 *
 * 按 charter § 1.4:
 * - 式样由 Workspace Container 提供
 * - 内容由 L4 navSideRegistry 注册(L3 阶段:占位)
 *
 * V1 vs V2:
 * - V1 NavSide 是 Shell 全局共享的 WebContentsView
 * - V2 NavSide 是每个 Workspace 自带的 React 组件(Workspace 隔离)
 */

import { DEFAULT_NAVSIDE_WIDTH } from '../../workspace-state/default-state';
import './nav-side-frame.css';

interface NavSideFrameProps {
  /** NavSide 宽度(null = 用默认 224px)*/
  width: number | null;
}

export function NavSideFrame({ width }: NavSideFrameProps) {
  const w = width ?? DEFAULT_NAVSIDE_WIDTH;
  return (
    <div className="krig-nav-side-frame" style={{ width: w }}>
      <div className="krig-nav-side-empty">NavSide (待 L4 Registry 注册内容)</div>
    </div>
  );
}
