/**
 * Workspace Container — 全屏容器
 *
 * S4:单 ws 直接渲染（活跃 ws 由主进程楼长决定，IPC 快照驱动）。
 * 启动时 IPC 状态尚未到达会短暂显示 Loading。
 */

import { useActiveWorkspace } from '@workspace/workspace-instance/use-workspace';
import { WorkspaceInstance } from '@workspace/workspace-instance/WorkspaceInstance';
import './workspace-container.css';

export function WorkspaceContainer() {
  const ws = useActiveWorkspace();

  if (!ws) {
    // 启动时 IPC 状态尚未到达的短暂空窗
    return (
      <div className="krig-workspace-container krig-workspace-container--empty">
        <div className="krig-workspace-container-empty">Loading…</div>
      </div>
    );
  }

  return (
    <div className="krig-workspace-container">
      <WorkspaceInstance state={ws} />
    </div>
  );
}
