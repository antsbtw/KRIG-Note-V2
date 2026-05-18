/**
 * ThoughtView — 横切思考层主舞台(NavSide 💭 tab 激活时显示)
 *
 * 数据流(charter §1.4 line 200 "view 极轻,仅订阅 + 编排"):
 * - 订阅 workspaceManager(per-ws activeThoughtId)
 * - 订阅 thoughtCapability.onListChanged(全局 thought 列表)
 * - 渲染:折叠列表(按 source 分组)+ active 卡片详情
 */

import { useMemo, useSyncExternalStore } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { useAllThoughts } from './use-thoughts-folders';
import { getThoughtWsState } from './data-model';
import { ThoughtList } from './ThoughtList';
import { ThoughtCard } from './ThoughtCard';
import './thought.css';

interface ThoughtViewProps {
  workspaceId: string;
}

export function ThoughtView({ workspaceId }: ThoughtViewProps) {
  const wsState = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws ? getThoughtWsState(ws) : null;
    },
  );

  const allThoughts = useAllThoughts();
  const activeId = wsState?.activeThoughtId ?? null;
  const activeThought = useMemo(
    () => (activeId ? allThoughts.find((t) => t.id === activeId) ?? null : null),
    [activeId, allThoughts],
  );

  if (!wsState) {
    return <div className="krig-thought-empty">Workspace 未就绪</div>;
  }

  return (
    <div className="krig-thought-view" data-view-id="thought-view">
      <div className="krig-thought-view-list">
        <ThoughtList
          workspaceId={workspaceId}
          thoughts={allThoughts}
          activeId={activeId}
        />
      </div>
      <div className="krig-thought-view-detail">
        {activeThought ? (
          <ThoughtCard thought={activeThought} />
        ) : (
          <div className="krig-thought-empty">
            <div className="krig-thought-empty-icon">💭</div>
            <div className="krig-thought-empty-text">未选择思考</div>
            <div className="krig-thought-empty-hint">
              左侧列表选中,或 NavSide 上方 +Thought 新建
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
