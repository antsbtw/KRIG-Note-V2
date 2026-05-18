/**
 * ThoughtPanel — 卡片纵向列表(V1 形态对齐)
 *
 * 见 V1 src/plugins/thought/components/ThoughtPanel.tsx:
 *   按 anchor.locator.pos 排序;空态显引导文字。
 */

import { useMemo } from 'react';
import type { ThoughtInfo, ThoughtSource } from '@capabilities/thought/types';
import { ThoughtCard } from './ThoughtCard';

interface ThoughtPanelProps {
  thoughts: ThoughtInfo[];
  activeId: string | null;
  onActivate: (id: string) => void;
  /** 当前 left slot 派生的 source(决定空态文案 + 卡片是否允许 scroll-to-source)*/
  source: ThoughtSource | null;
  resourceId: string | null;
}

function getAnchorPos(t: ThoughtInfo): number {
  if (!t.anchor) return 0;
  const loc = t.anchor.locator as { pmPos?: number; pageNum?: number };
  return loc.pmPos ?? loc.pageNum ?? 0;
}

export function ThoughtPanel({
  thoughts,
  activeId,
  onActivate,
  source,
  resourceId,
}: ThoughtPanelProps) {
  // 按 anchor 位置排序(V1 ThoughtPanel 同模式)
  const sorted = useMemo(
    () => [...thoughts].sort((a, b) => getAnchorPos(a) - getAnchorPos(b)),
    [thoughts],
  );

  if (!source || !resourceId) {
    return (
      <div className="thought-panel__empty">
        <p>请先在左侧打开 Note 或 eBook</p>
        <p className="thought-panel__empty-hint">Thought 跟随主视图当前资源</p>
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="thought-panel__empty">
        <p>还没有思考</p>
        <p className="thought-panel__empty-hint">
          {source === 'note'
            ? '选中文字后按 ⌘⇧M 或点击 💭 添加'
            : '在 eBook 上选区高亮 / 框选添加'}
        </p>
      </div>
    );
  }

  return (
    <div className="thought-panel">
      <div className="thought-panel__list">
        {sorted.map((thought) => (
          <ThoughtCard
            key={thought.id}
            thought={thought}
            isActive={thought.id === activeId}
            onActivate={onActivate}
          />
        ))}
      </div>
    </div>
  );
}
