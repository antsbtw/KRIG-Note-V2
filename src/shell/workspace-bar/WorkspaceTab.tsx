/**
 * 单个 Workspace Tab
 *
 * L3 阶段:接入 WorkspaceManager,点击切 active,× 关闭
 */

import { workspaceManager } from '@workspace/workspace-state/workspace-manager';

interface WorkspaceTabProps {
  id: string;
  label: string;
  active: boolean;
}

export function WorkspaceTab({ id, label, active }: WorkspaceTabProps) {
  const handleClick = () => {
    workspaceManager.setActive(id);
  };

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    workspaceManager.close(id);
  };

  return (
    <div
      className={`krig-workspace-tab ${active ? 'krig-workspace-tab--active' : ''}`}
      onClick={handleClick}
    >
      <span className="krig-workspace-tab-label">{label}</span>
      <button
        type="button"
        className="krig-workspace-tab-close"
        onClick={handleClose}
        aria-label={`Close ${label}`}
      >
        ×
      </button>
    </div>
  );
}
