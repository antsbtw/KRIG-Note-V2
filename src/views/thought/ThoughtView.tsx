/**
 * ThoughtView — view 主组件(对位 NoteView 形态:NavSide + 单栏主区)
 *
 * 用户语义("ThoughtView 是 NoteView 的变种"):
 * - NavSide 接 thought 列表(nav-side-content.tsx 的 FolderTreePanel)
 * - 主区只渲染**当前 active thought 的卡片**(无 list,无双栏)
 * - 三个场景同一组件:
 *   1) NavSide 点列表项 → wsState.activeThoughtId 改 → 本组件显该卡片
 *   2) Note ⌘⇧M 右槽召唤 → bus.channels 'thought.activate' → activeThoughtId
 *   3) 卡片切换:同组件 + ThoughtCard 内 key={thought.id} 强制 remount Host
 *
 * 不渲染列表是因为 NavSide 已经在列(charter §1.4 应用级 UI 在 Workspace
 * Container,view 不重复造)。
 */

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { useAllThoughts } from './use-thoughts-folders';
import { getThoughtWsState, setActiveThought } from './data-model';
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

  // 跨槽通信:监听 'thought.activate' 切到对应卡片
  //   - Note ⌘⇧M / 💭 / 🤖 触发(thought-commands 内 emit)
  //   - eBook 高亮触发(同理 emit channel)
  useEffect(() => {
    const bus = workspaceManager.getBus(workspaceId);
    if (!bus) return;
    const unsub = bus.channels.subscribe('thought.activate', (payload: unknown) => {
      const { thoughtId } = (payload ?? {}) as { thoughtId?: string };
      if (typeof thoughtId === 'string') setActiveThought(workspaceId, thoughtId);
    });
    return unsub;
  }, [workspaceId]);

  if (!wsState) {
    return <div className="krig-thought-empty">Workspace 未就绪</div>;
  }

  if (!activeThought) {
    return (
      <div className="krig-thought-empty">
        <div className="krig-thought-empty-icon">💭</div>
        <div className="krig-thought-empty-text">未选择思考</div>
        <div className="krig-thought-empty-hint">
          从左侧列表点选,或 NavSide 顶部 + Thought 新建
        </div>
      </div>
    );
  }

  return (
    <div className="krig-thought-view" data-view-id="thought-view">
      <div className="krig-thought-view-content">
        <ThoughtCard thought={activeThought} />
      </div>
    </div>
  );
}
