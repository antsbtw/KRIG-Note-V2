/**
 * 新建 Workspace [+] 按钮
 *
 * L3 阶段:接入 WorkspaceManager.create(),自动切到新 Workspace
 */

import { Plus } from 'lucide-react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';

export function AddWorkspaceButton() {
  const handleClick = () => {
    const ws = workspaceManager.create();
    workspaceManager.setActive(ws.id);
  };

  return (
    <button
      type="button"
      className="krig-add-workspace"
      onClick={handleClick}
      title="新建 Workspace"
      aria-label="Add Workspace"
    >
      <Plus size={14} />
    </button>
  );
}
