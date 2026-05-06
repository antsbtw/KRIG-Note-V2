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
import { WorkspaceBusContext } from '@slot/workspace-bus/use-workspace-bus';
import { viewTypeRegistry } from '@slot/view-type-registry/view-type-registry';
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
  // L5-A:用户感知的 active view — left slot 的 view,或 fallback 到第一个有 navSideTab 的 view
  // (新 Workspace slotBinding.left=null 时让 NavSide / SlotArea 至少能显第一个 view 的内容)
  let activeViewId: string | null = state.slotBinding.left ?? state.slotBinding.right ?? null;
  if (!activeViewId) {
    activeViewId = viewTypeRegistry.getAllForNavSide()[0]?.id ?? null;
  }
  // 计算"展示用 slotBinding"(left null 时 fallback 到 activeViewId,不改实际 state)
  const effectiveSlotBinding = state.slotBinding.left
    ? state.slotBinding
    : { ...state.slotBinding, left: activeViewId };

  // 4 大交互触发器统一在 WorkspaceInstance 挂(选项 A)— 范围 = Workspace 根 DOM,自然按 Workspace 隔离。
  // viewId 为 null 时 hook 不挂监听器(待 view 注册后自动激活)。
  useContextMenuTrigger(rootRef, activeViewId);

  // L3.5:Workspace bus(每 Workspace 一实例,跨 Workspace 不通)
  const bus = workspaceManager.getBus(state.id) ?? null;

  return (
    <WorkspaceBusContext.Provider value={bus}>
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
            workspaceId={state.id}
            slotBinding={effectiveSlotBinding}
            dividerRatio={state.dividerRatio}
            onDividerChange={handleDividerChange}
          />
        </div>
        <OverlayFrames viewId={activeViewId} />
      </div>
    </WorkspaceBusContext.Provider>
  );
}
