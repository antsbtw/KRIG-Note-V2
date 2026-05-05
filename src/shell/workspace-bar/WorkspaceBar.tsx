/**
 * WorkspaceBar — 顶部 28px 栏
 *
 * 按 src/shell/DESIGN.md v0.3:
 * - 左端:NavSide Toggle(≡)
 * - 中间:Workspace Tabs(L2 阶段空,L3 接入 WorkspaceManager)
 * - 右端:[+] 新建 Workspace 按钮
 *
 * L2 阶段:渲染 3 类控件占位,触发暂不工作(等 L3)
 */

import { NavSideToggle } from './NavSideToggle';
import { AddWorkspaceButton } from './AddWorkspaceButton';
import { useFullscreen } from './use-fullscreen';
import './workspace-bar.css';

export function WorkspaceBar() {
  const isFullscreen = useFullscreen();
  const className = `krig-workspace-bar ${isFullscreen ? 'krig-workspace-bar--fullscreen' : ''}`;

  return (
    <div className={className} role="toolbar" aria-label="Workspace Bar">
      <NavSideToggle />
      <div className="krig-workspace-tabs">
        {/* L2 阶段:占位文字。L3 阶段:从 WorkspaceManager 拿列表渲染 WorkspaceTab */}
        <div className="krig-workspace-tabs-empty">Workspace Bar (待 L3)</div>
      </div>
      <AddWorkspaceButton />
    </div>
  );
}
