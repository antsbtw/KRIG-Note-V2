/**
 * Workspace Container — 全屏容器
 *
 * 按 charter § 1.4 + view-hierarchy-v2.md:
 * - 渲染所有 Workspace 实例
 * - 通过 visibility 切换显示活跃 Workspace
 * - 非活跃 Workspace 状态保留(不销毁不重建)
 *
 * L3 阶段:接入 WorkspaceManager,渲染所有 Workspace 实例
 */

import { useOpenWorkspaces, useActiveWorkspaceId } from '@workspace/workspace-instance/use-workspace';
import { WorkspaceInstance } from '@workspace/workspace-instance/WorkspaceInstance';
import './workspace-container.css';

export function WorkspaceContainer() {
  // 只挂载打开的工作空间实例(收起的不挂,省内存;cookie 持久,重开重载但登录态在)
  const workspaces = useOpenWorkspaces();
  const activeId = useActiveWorkspaceId();

  if (workspaces.length === 0) {
    // 应该不会出现(WorkspaceManager.ensureMinimum 保证至少一个)
    return (
      <div className="krig-workspace-container krig-workspace-container--empty">
        <div className="krig-workspace-container-empty">No workspace</div>
      </div>
    );
  }

  return (
    <div className="krig-workspace-container">
      {workspaces.map((ws) => (
        <WorkspaceInstance
          key={ws.id}
          state={ws}
          isActive={ws.id === activeId}
        />
      ))}
    </div>
  );
}
