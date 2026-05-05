/**
 * NavSideFrame — 左侧 NavSide 容器(式样)
 *
 * 按 charter § 1.4:式样在本组件,内容由 navSideRegistry 通过 NavSideBinding 渲染。
 *
 * V1 vs V2:
 * - V1 NavSide 是 Shell 全局 WebContentsView
 * - V2 NavSide 是每个 Workspace 自带的 React 组件(Workspace 隔离)
 */

import { DEFAULT_NAVSIDE_WIDTH } from '../../workspace-state/default-state';
import { NavSideBinding } from '@slot/frame-bindings/NavSideBinding';
import { ViewSwitcherFrame } from '../view-switcher-frame/ViewSwitcherFrame';
import './nav-side-frame.css';

interface NavSideFrameProps {
  /** Workspace ID(给 ViewSwitcher 切 view 用)*/
  workspaceId: string;
  /** NavSide 宽度(null = 默认 224px)*/
  width: number | null;
  /** 当前 view ID(用于按 view 取 NavSide 内容 + 高亮 ViewSwitcher tab)*/
  viewId: string | null;
}

export function NavSideFrame({ workspaceId, width, viewId }: NavSideFrameProps) {
  const w = width ?? DEFAULT_NAVSIDE_WIDTH;
  return (
    <div className="krig-nav-side-frame" style={{ width: w }}>
      <ViewSwitcherFrame workspaceId={workspaceId} activeViewId={viewId} />
      <NavSideBinding viewId={viewId} />
    </div>
  );
}
