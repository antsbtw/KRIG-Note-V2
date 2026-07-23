/**
 * Workspace Container — 全屏容器
 *
 * S4:单 ws 直接渲染（活跃 ws 由主进程楼长决定，IPC 快照驱动）。
 * 启动时 IPC 状态尚未到达会短暂显示 Loading。
 */

import { useWorkspace, getMyWsId } from '@workspace/workspace-instance/use-workspace';
import { WorkspaceInstance } from '@workspace/workspace-instance/WorkspaceInstance';
import './workspace-container.css';

export function WorkspaceContainer() {
  // 多窗口：每个窗口渲染自己绑定的 ws（myWsId），而非全局 snapshot.activeId。
  // myWsId 在 onMyWsIdReady 触发前为 null → 显示 Loading，就绪后重渲染。
  const ws = useWorkspace(getMyWsId());

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
