/**
 * 新建 Workspace [+] 按钮
 *
 * L3 阶段:接入 WorkspaceManager.create(),自动切到新 Workspace
 * S3-a:楼长 API 改走 IPC(create/setActive → ipcWorkspace*)
 *       房客 API update() 仍走 renderer 本地 workspaceManager（S4 后再迁）
 *
 * 用户决策:从顶部 + 新建时,新空间默认停在「点 + 时所在的 view」——继承当前活跃空间
 * 的 slotBinding.left。在 note 里点 + 就停 note,在 web 里点就停 web(最贴近当下工作意图)。
 */

import { Plus } from 'lucide-react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { useActiveWorkspace } from '@workspace/workspace-instance/use-workspace';
import {
  ipcWorkspaceCreate,
  ipcWorkspaceSetActive,
} from '@workspace/ipc/workspace-ipc';

export function AddWorkspaceButton() {
  const activeWs = useActiveWorkspace();

  const handleClick = () => {
    const currentView = activeWs?.slotBinding.left ?? null;
    void ipcWorkspaceCreate().then((ws) => {
      // 继承 view 的 update 操作：S3-a 阶段暂时仍走 workspaceManager.update()
      // （update 是房客 API，不是楼长 API，本次不上移）
      if (currentView) {
        workspaceManager.update(ws.id, {
          slotBinding: { left: currentView, leftPayload: undefined, right: null, rightPayload: undefined },
        });
      }
      void ipcWorkspaceSetActive(ws.id);
    });
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
