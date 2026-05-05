/**
 * ViewSwitcherFrame — NavSide 顶部固定区(应用级骨架)
 *
 * 三段:
 * 1. KRIG logo + 标题(应用品牌,硬编码)
 * 2. View 切换 tab 条(订阅 viewTypeRegistry.getAllForNavSide 渲染)
 *
 * 切 view 动作:把当前 Workspace 的 slotBinding.left 设成所选 view ID。
 * 约定:主 view 在左 slot,右 slot 用户自由组合(charter § 1.4)。
 *
 * V1 vs V2:
 * - V1 NavSide 顶部硬编码在 navside webContents 内,view 列表硬编码
 * - V2 view 列表来自 viewTypeRegistry 注册(L5 view 声明 navSideTab 自动出现)
 */

import { workspaceManager } from '../../workspace-state/workspace-manager';
import { ViewSwitcherBinding } from '@slot/frame-bindings/ViewSwitcherBinding';
import logoUrl from '@shell/assets/logo.jpeg';
import './view-switcher-frame.css';

interface ViewSwitcherFrameProps {
  /** 当前 Workspace ID(切 view 时用)*/
  workspaceId: string;
  /** 当前活跃 view ID(高亮)*/
  activeViewId: string | null;
}

export function ViewSwitcherFrame({ workspaceId, activeViewId }: ViewSwitcherFrameProps) {
  const handleSwitch = (viewId: string) => {
    const ws = workspaceManager.get(workspaceId);
    if (!ws) return;
    workspaceManager.update(workspaceId, {
      slotBinding: { ...ws.slotBinding, left: viewId },
    });
  };

  return (
    <div className="krig-view-switcher-frame">
      <div className="krig-view-switcher-brand">
        <img className="krig-view-switcher-logo" src={logoUrl} alt="KRIG" />
        <span className="krig-view-switcher-title">KRIG</span>
      </div>
      <ViewSwitcherBinding activeViewId={activeViewId} onSwitch={handleSwitch} />
    </div>
  );
}
