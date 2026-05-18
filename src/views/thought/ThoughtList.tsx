/**
 * ThoughtList — 主舞台中区 thought 列表
 *
 * 显示:全部 thought,按 pinned/updatedAt 排序。
 * 卡片摘要:icon + title + source 标签 + resolved 横线。
 * 点击切 active(走 thought-view.set-active 命令)。
 */

import { commandRegistry } from '@slot/command-registry/command-registry';
import type { ThoughtInfo } from '@capabilities/thought/types';
import { THOUGHT_TYPE_META } from '@shared/ipc/thought-types';
import { deriveThoughtTitle, relativeTime } from './tree-builder';

interface ThoughtListProps {
  workspaceId: string;
  thoughts: ThoughtInfo[];
  activeId: string | null;
}

function sourceLabel(t: ThoughtInfo): string {
  if (!t.anchor) return '独立';
  switch (t.anchor.source) {
    case 'note':   return '📝 Note';
    case 'book':   return '📚 Book';
    case 'graph':  return '📊 Graph';
    case 'canvas': return '🎨 Canvas';
  }
}

export function ThoughtList({ thoughts, activeId }: ThoughtListProps) {
  const sorted = [...thoughts].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });

  if (sorted.length === 0) {
    return (
      <div className="krig-thought-list-empty">
        暂无思考 — 左上方 +Thought 新建一条
      </div>
    );
  }

  return (
    <ul className="krig-thought-list">
      {sorted.map((t) => {
        const meta = THOUGHT_TYPE_META[t.type];
        const isActive = t.id === activeId;
        const itemClass = [
          'krig-thought-list-item',
          isActive ? 'active' : '',
          t.resolved ? 'resolved' : '',
          t.pinned ? 'pinned' : '',
        ].filter(Boolean).join(' ');
        return (
          <li
            key={t.id}
            className={itemClass}
            onClick={() => commandRegistry.execute('thought-view.set-active', t.id)}
          >
            <span className="krig-thought-list-icon" aria-hidden>{meta.icon}</span>
            <div className="krig-thought-list-body">
              <div className="krig-thought-list-title">
                {t.pinned && <span className="krig-thought-list-pin" aria-hidden>📌</span>}
                {deriveThoughtTitle(t)}
              </div>
              <div className="krig-thought-list-meta">
                <span className="krig-thought-list-source">{sourceLabel(t)}</span>
                <span className="krig-thought-list-time">{relativeTime(t.updatedAt)}</span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
