/**
 * WorkspaceBar — 顶部 28px 栏
 *
 * 按 src/shell/DESIGN.md v0.3:
 * - 左端:NavSide Toggle(≡)
 * - 中间:Workspace Tabs(L3 阶段:从 WorkspaceManager 渲染列表)
 * - 右端:[+] 新建 Workspace 按钮
 *
 * L3 阶段(2026-05-05):接入 WorkspaceManager,3 类控件全生效
 */

import { NavSideToggle } from './NavSideToggle';
import { AddWorkspaceButton } from './AddWorkspaceButton';
import { WorkspaceTab } from './WorkspaceTab';
import { useFullscreen } from './use-fullscreen';
import { useAllWorkspaces, useActiveWorkspaceId } from '@workspace/workspace-instance/use-workspace';
import './workspace-bar.css';

export function WorkspaceBar() {
  const isFullscreen = useFullscreen();
  const workspaces = useAllWorkspaces();
  const activeId = useActiveWorkspaceId();
  const className = `krig-workspace-bar ${isFullscreen ? 'krig-workspace-bar--fullscreen' : ''}`;

  return (
    <div className={className} role="toolbar" aria-label="Workspace Bar">
      <NavSideToggle />
      <div className="krig-workspace-tabs">
        {workspaces.length === 0 ? (
          <div className="krig-workspace-tabs-empty">No workspace</div>
        ) : (
          workspaces.map((ws) => (
            <WorkspaceTab
              key={ws.id}
              id={ws.id}
              label={ws.label}
              active={ws.id === activeId}
            />
          ))
        )}
        {/* [+] 按钮紧贴最后一个 Tab,不再靠最右端 */}
        <AddWorkspaceButton />
      </div>
    </div>
  );
}
