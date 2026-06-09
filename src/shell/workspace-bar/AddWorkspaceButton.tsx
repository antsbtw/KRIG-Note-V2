/**
 * 新建 Workspace [+] 按钮
 *
 * L3 阶段:接入 WorkspaceManager.create(),自动切到新 Workspace
 *
 * 用户决策:从顶部 + 新建时,新空间默认停在「点 + 时所在的 view」——继承当前活跃空间
 * 的 slotBinding.left。在 note 里点 + 就停 note,在 web 里点就停 web(最贴近当下工作意图)。
 * (NavSide 那个入口是另一回事:从 web NavSide 点工作空间项默认强制 web。)
 */

import { Plus } from 'lucide-react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';

export function AddWorkspaceButton() {
  const handleClick = () => {
    // 继承当前活跃空间的 view(left slot),新空间停在同一 view
    const currentView = workspaceManager.getActive()?.slotBinding.left ?? null;
    const ws = workspaceManager.create();
    if (currentView) {
      workspaceManager.update(ws.id, {
        slotBinding: { left: currentView, leftPayload: undefined, right: null, rightPayload: undefined },
      });
    }
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
