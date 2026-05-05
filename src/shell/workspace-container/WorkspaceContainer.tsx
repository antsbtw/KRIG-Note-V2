/**
 * Workspace Container — 全屏容器
 *
 * 按 src/shell/DESIGN.md v0.3:
 * - L2 阶段:占位空容器
 * - L3 阶段:从 WorkspaceManager 拿活跃 Workspace 实例,mount 对应 Workspace React 组件树
 */

import './workspace-container.css';

export function WorkspaceContainer() {
  return (
    <div className="krig-workspace-container">
      <div className="krig-workspace-container-empty">
        Workspace Container (待 L3 挂载 Workspace 实例)
      </div>
    </div>
  );
}
