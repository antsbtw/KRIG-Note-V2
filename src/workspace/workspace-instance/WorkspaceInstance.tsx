/**
 * WorkspaceInstance — 单 Workspace 完整 React 组件树
 *
 * 按 charter § 1.4 + view-hierarchy-v2.md:
 * - 应用级 UI 全在 Workspace Container 内(NavSide / Toolbar / Slot / 5 大交互浮层 / 通用 Overlay)
 * - view 平等(所有 Workspace 共享同一套式样)
 *
 * 切 Workspace 时:旧实例 hide(visibility),新实例 show — 状态保留(不销毁不重建)
 */

import { useRef } from 'react';
import { NavSideFrame } from './nav-side-frame/NavSideFrame';
import { ToolbarFrame } from './toolbar-frame/ToolbarFrame';
import { SlotArea } from './slot-area/SlotArea';
import { OverlayFrames } from './overlay-frames';
import { workspaceManager } from '../workspace-state/workspace-manager';
import { useContextMenuTrigger } from '@slot/triggers/use-context-menu-trigger';
import type { WorkspaceState } from '../workspace-state/workspace-state';
import './workspace-instance.css';

interface WorkspaceInstanceProps {
  state: WorkspaceState;
  isActive: boolean;
}

export function WorkspaceInstance({ state, isActive }: WorkspaceInstanceProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const handleDividerChange = (ratio: number) => {
    workspaceManager.update(state.id, { dividerRatio: ratio });
  };

  // L4 阶段:取当前活跃 view ID(优先 left slot)— 用作 NavSide / Toolbar / Overlay 的过滤参考
  // L5 view 注册后 slotBinding 会包含具体 viewId
  const activeViewId = state.slotBinding.left ?? state.slotBinding.right ?? null;

  // 4 大交互触发器统一在 WorkspaceInstance 挂(选项 A)— 范围 = Workspace 根 DOM,自然按 Workspace 隔离。
  // viewId 为 null 时 hook 不挂监听器(待 view 注册后自动激活)。
  useContextMenuTrigger(rootRef, activeViewId);

  return (
    <div
      ref={rootRef}
      className="krig-workspace-instance"
      style={{ display: isActive ? 'flex' : 'none' }}
      data-workspace-id={state.id}
    >
      {!state.navSideCollapsed && (
        <NavSideFrame workspaceId={state.id} width={state.navSideWidth} viewId={activeViewId} />
      )}
      <div className="krig-workspace-main">
        <ToolbarFrame viewId={activeViewId} />
        <SlotArea
          slotBinding={state.slotBinding}
          dividerRatio={state.dividerRatio}
          onDividerChange={handleDividerChange}
        />
      </div>
      <OverlayFrames viewId={activeViewId} />
    </div>
  );
}
