/**
 * NavSide Toggle 按钮
 *
 * 按 src/shell/DESIGN.md v0.3 § 1:
 * - UI 渲染在 L2 WorkspaceBar(本组件)
 * - 状态归 L3 WorkspaceState.navSideCollapsed
 * - 触发时调 workspaceManager.toggleNavSide(activeId)(L3 提供)
 *
 * L2 阶段:占位按钮,触发暂不工作(等 L3 接入 WorkspaceManager)
 *
 * 图标:Lucide PanelLeft(类似 SF Symbols sidebar.left,outline 风格)
 */

import { PanelLeft } from 'lucide-react';

export function NavSideToggle() {
  const handleClick = () => {
    // L2 阶段:无操作。L3 阶段接入 workspaceManager.toggleNavSide(activeId)
    console.log('[L2] NavSide toggle clicked (L3 待接入)');
  };

  return (
    <button
      type="button"
      className="krig-navside-toggle"
      onClick={handleClick}
      title="折叠/展开 NavSide(L3 待接入)"
      aria-label="Toggle NavSide"
    >
      <PanelLeft size={16} />
    </button>
  );
}
