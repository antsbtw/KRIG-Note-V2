/**
 * NavSide Toggle 按钮
 *
 * 按 src/shell/DESIGN.md v0.3 § 1:
 * - UI 渲染在 L2 WorkspaceBar(本组件)
 * - 状态归 L3 WorkspaceState.navSideCollapsed
 * - 触发时调 workspaceManager.toggleNavSide(activeId)
 *
 * L3 阶段(2026-05-05):接入 WorkspaceManager,实际生效
 */

import { PanelLeft } from 'lucide-react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { useActiveWorkspaceId } from '@workspace/workspace-instance/use-workspace';

export function NavSideToggle() {
  const activeId = useActiveWorkspaceId();

  const handleClick = () => {
    if (activeId) {
      workspaceManager.toggleNavSide(activeId);
    }
  };

  return (
    <button
      type="button"
      className="krig-navside-toggle"
      onClick={handleClick}
      title="折叠/展开 NavSide"
      aria-label="Toggle NavSide"
      disabled={!activeId}
    >
      <PanelLeft size={16} />
    </button>
  );
}
