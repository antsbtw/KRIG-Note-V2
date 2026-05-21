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

/**
 * 排序 key — 返 [numKey, strKey],supports book(pageNum)和 note(blockId 字典序)混排。
 *
 * L7 升级(decision 026 §10.1):note locator pmPos 字面换为 blockId。
 * - book locator 字面 pageNum(整数页码)= numKey,strKey 空
 * - note locator blockId 是 ULID(字典序 ≈ 时间序 ≈ 创建顺序)= strKey,numKey 大常数靠后
 * - 无 anchor → numKey=0 字面最前(独立 thought)
 *
 * 字面**不**走 PM doc 内当前位置序(那需 getNote → 找 pos 异步);
 * 字面用创建顺序近似 — Stage 7 字面 verify 用户体感是否符合预期。
 */
function getAnchorSortKey(t: ThoughtInfo): [number, string] {
  if (!t.anchor) return [0, ''];
  const loc = t.anchor.locator as { blockId?: string; pageNum?: number };
  if (typeof loc.pageNum === 'number') return [loc.pageNum, ''];
  if (typeof loc.blockId === 'string') return [Number.MAX_SAFE_INTEGER, loc.blockId];
  return [0, ''];
}

export function ThoughtPanel({
  thoughts,
  activeId,
  onActivate,
  source,
  resourceId,
}: ThoughtPanelProps) {
  // 按 anchor 位置排序(V1 ThoughtPanel 同模式;L7 升级:复合 key [numKey, strKey])
  const sorted = useMemo(
    () =>
      [...thoughts].sort((a, b) => {
        const [an, as] = getAnchorSortKey(a);
        const [bn, bs] = getAnchorSortKey(b);
        if (an !== bn) return an - bn;
        return as < bs ? -1 : as > bs ? 1 : 0;
      }),
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
