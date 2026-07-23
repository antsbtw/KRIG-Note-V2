/**
 * WorkspaceInstance — 单 Workspace 完整 React 组件树
 *
 * 按 charter § 1.4 + view-hierarchy-v2.md:
 * - 应用级 UI 全在 Workspace Container 内(NavSide / Toolbar / Slot / 5 大交互浮层 / 通用 Overlay)
 * - view 平等(所有 Workspace 共享同一套式样)
 *
 * S4:删除 isActive prop 和 display:none 切换（Container 直接渲染活跃 ws）。
 *    NavSideToggle 从 WorkspaceBar 移入，折叠时在 WorkspaceInstance 内部渲染展开按钮。
 */

import { useRef } from 'react';
import { NavSideFrame } from './nav-side-frame/NavSideFrame';
import { ActivityBar } from './activity-bar/ActivityBar';
import { SlotArea } from './slot-area/SlotArea';
import { OverlayFrames } from './overlay-frames';
import { SettingsModal } from './settings/SettingsModal';
import { workspaceManager } from '../workspace-state/workspace-manager';
import { useContextMenuTrigger } from '@slot/triggers/use-context-menu-trigger';
import { useSlashTrigger } from '@slot/triggers/use-slash-trigger';
import { useHandleTrigger } from '@slot/triggers/use-handle-trigger';
import { useFloatingToolbarTrigger } from '@slot/triggers/use-floating-toolbar-trigger';
import { WorkspaceBusContext } from '@slot/workspace-bus/use-workspace-bus';
import { WorkspaceIdContext } from '../workspace-context/ws-id-context';
import { viewTypeRegistry } from '@slot/view-type-registry/view-type-registry';
import type { WorkspaceState } from '../workspace-state/workspace-state';
import './workspace-instance.css';

interface WorkspaceInstanceProps {
  state: WorkspaceState;
}

export function WorkspaceInstance({ state }: WorkspaceInstanceProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const handleDividerChange = (ratio: number) => {
    workspaceManager.update(state.id, { dividerRatio: ratio });
  };

  const handleSwitch = (viewId: string) => {
    const viewDef = viewTypeRegistry.get(viewId);
    const navSideOnSwitch = viewDef?.navSideTab?.navSideOnSwitch ?? 'expand';
    const nextCollapsed = navSideOnSwitch === 'collapse';
    console.log(`[handleSwitch] view=${viewId} navSideOnSwitch=${navSideOnSwitch} → navSideCollapsed=${nextCollapsed} (当前=${state.navSideCollapsed})`);
    workspaceManager.update(
      state.id,
      {
        slotBinding: {
          left: viewId,
          leftPayload: undefined,
          right: null,
          rightPayload: undefined,
        },
        navSideCollapsed: nextCollapsed,
      },
      { source: 'navside' },
    );
  };

  const handleToggleCollapse = () => {
    workspaceManager.toggleNavSide(state.id);
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
  useSlashTrigger(rootRef, activeViewId);          // L5-B3.1
  useHandleTrigger(rootRef, activeViewId);         // L5-B3.1
  useFloatingToolbarTrigger(activeViewId);         // L5-B3.1

  // L3.5:Workspace bus(每 Workspace 一实例,跨 Workspace 不通)
  const bus = workspaceManager.getBus(state.id) ?? null;

  return (
    <WorkspaceIdContext.Provider value={state.id}>
      <WorkspaceBusContext.Provider value={bus}>
        <div
          ref={rootRef}
          className="krig-workspace-instance"
          data-workspace-id={state.id}
        >
          <ActivityBar
            activeViewId={activeViewId}
            navSideCollapsed={state.navSideCollapsed}
            onSwitch={handleSwitch}
            onToggleCollapse={handleToggleCollapse}
          />
          {!state.navSideCollapsed && (
            <NavSideFrame workspaceId={state.id} navSideWidths={state.navSideWidths ?? {}} viewId={activeViewId} />
          )}
          <div className="krig-workspace-main">
            {/* per-slot toolbar(fix/per-slot-toolbar):ToolbarFrame 下沉进 SlotArea 的
                每个 slot 容器内,left/right view 各自有独立 toolbar 不再越界。*/}
            <SlotArea
              workspaceId={state.id}
              slotBinding={effectiveSlotBinding}
              dividerRatio={state.dividerRatio}
              onDividerChange={handleDividerChange}
            />
          </div>
          <OverlayFrames viewId={activeViewId} />
          <SettingsModal />
        </div>
      </WorkspaceBusContext.Provider>
    </WorkspaceIdContext.Provider>
  );
}
