/**
 * ThoughtPanel — 卡片纵向列表(V1 形态对齐)
 *
 * 见 V1 src/plugins/thought/components/ThoughtPanel.tsx:
 *   按 anchor.locator.pos 排序;空态显引导文字。
 */

import { useMemo, useState } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  ThoughtCapabilityApi,
  ThoughtInfo,
  ThoughtSource,
} from '@capabilities/thought/types';
import { ThoughtCard, type ThoughtCardDrag } from './ThoughtCard';

interface ThoughtPanelProps {
  thoughts: ThoughtInfo[];
  /** 书标注颜色表 createdAt → color(卡片来源条与 PDF 方框同色);非书来源为空表 */
  annotationColors: Map<number, string>;
  activeId: string | null;
  /** thought.activate 计数(同一张卡再次激活也要重新展开 + 滚到可见) */
  activateSeq: number;
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

/**
 * 同页内的位置 key —— [y, x](先上后下,同一行先左后右)。
 *
 * 2026-10-17 补:原先只按页码排,同页多个标注的卡片落成创建顺序,与 PDF 上方框
 * 的上下次序对不上。框选用 rect,文字流用第一段 textRects。取不到位置 → 排本页最后。
 */
function getInPagePos(t: ThoughtInfo): [number, number] {
  const loc = t.anchor?.locator as
    | { rect?: { x: number; y: number }; textRects?: Array<{ x: number; y: number }> }
    | undefined;
  const r = loc?.rect ?? loc?.textRects?.[0];
  if (!r) return [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
  return [r.y, r.x];
}

/**
 * 「同一个标注」分组 key —— 只有同组卡片之间能拖动排序(2026-10-17 用户需求)。
 * book:bookAnchor.createdAt;note:blockId(+offset)。取不到 → null(不可拖)。
 */
function getGroupKey(t: ThoughtInfo): string | null {
  if (!t.anchor) return null;
  const loc = t.anchor.locator as { createdAt?: number; blockId?: string; offset?: number };
  if (t.anchor.source === 'book' && typeof loc.createdAt === 'number') {
    return `book:${loc.createdAt}`;
  }
  if (t.anchor.source === 'note' && typeof loc.blockId === 'string') {
    return `note:${loc.blockId}:${loc.offset ?? ''}`;
  }
  return null;
}

/** 组内顺序值:拖过的用 sortOrder,没拖过的用创建时间(同一刻度,可互相插中间) */
function orderKey(t: ThoughtInfo): number {
  return typeof t.sortOrder === 'number' ? t.sortOrder : t.createdAt;
}

/**
 * 把 dragged 放到 target 的前/后,算出 dragged 的新 sortOrder(只改被拖那一张)。
 * 取插入位置前后两张的中间值;在组首/组尾则 ±1000。
 */
function computeNewOrder(
  group: ThoughtInfo[],
  draggedId: string,
  targetId: string,
  before: boolean,
): number | null {
  const rest = group.filter((t) => t.id !== draggedId);
  const ti = rest.findIndex((t) => t.id === targetId);
  if (ti === -1) return null;
  const insertAt = before ? ti : ti + 1;
  const prev = rest[insertAt - 1];
  const next = rest[insertAt];
  if (prev && next) return (orderKey(prev) + orderKey(next)) / 2;
  if (next) return orderKey(next) - 1000;
  if (prev) return orderKey(prev) + 1000;
  return null;
}

/** 书来源卡片 → 它所挂标注的当前颜色;非书来源 / 标注已删 → undefined(卡片用类型色) */
function anchorColorOf(t: ThoughtInfo, colors: Map<number, string>): string | undefined {
  if (t.anchor?.source !== 'book') return undefined;
  const createdAt = (t.anchor.locator as { createdAt?: number }).createdAt;
  return typeof createdAt === 'number' ? colors.get(createdAt) : undefined;
}

export function ThoughtPanel({
  thoughts,
  annotationColors,
  activeId,
  activateSeq,
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
        if (as !== bs) return as < bs ? -1 : 1;
        const [ay, ax] = getInPagePos(a);
        const [by, bx] = getInPagePos(b);
        if (ay !== by) return ay - by;
        if (ax !== bx) return ax - bx;
        // 同一标注(同位置)内:按手动顺序(拖动排列)
        return orderKey(a) - orderKey(b);
      }),
    [thoughts],
  );

  /** groupKey → 组内卡片(已按 sorted 顺序);只有 ≥2 张的组才允许拖 */
  const groups = useMemo(() => {
    const m = new Map<string, ThoughtInfo[]>();
    for (const t of sorted) {
      const k = getGroupKey(t);
      if (!k) continue;
      const arr = m.get(k) ?? [];
      arr.push(t);
      m.set(k, arr);
    }
    return m;
  }, [sorted]);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; before: boolean } | null>(null);

  const dragOf = (t: ThoughtInfo): ThoughtCardDrag | undefined => {
    const key = getGroupKey(t);
    const group = key ? groups.get(key) : undefined;
    if (!key || !group || group.length < 2) return undefined;
    const dragging = dragId ? sorted.find((x) => x.id === dragId) : undefined;
    const draggingKey = dragging ? getGroupKey(dragging) : null;
    return {
      onDragStart: (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', t.id);
        setDragId(t.id);
      },
      onDragEnd: () => {
        setDragId(null);
        setDropHint(null);
      },
      onDragOver: (e) => {
        // 只接同组、非自身 —— 跨标注拖不允许(位置序由 PDF 决定)
        if (!dragId || dragId === t.id || draggingKey !== key) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const r = e.currentTarget.getBoundingClientRect();
        const before = e.clientY < r.top + r.height / 2;
        if (dropHint?.id !== t.id || dropHint.before !== before) setDropHint({ id: t.id, before });
      },
      onDrop: (e) => {
        e.preventDefault();
        const hint = dropHint;
        const draggedId = dragId;
        setDragId(null);
        setDropHint(null);
        if (!draggedId || !hint || hint.id !== t.id || draggingKey !== key) return;
        const next = computeNewOrder(group, draggedId, t.id, hint.before);
        if (next === null) return;
        const api = requireCapabilityApi<ThoughtCapabilityApi>('thought');
        api
          .updateThought(draggedId, { sortOrder: next })
          .catch((err) => console.error('[thought] 保存拖动顺序失败:', err));
      },
      dropIndicator: dropHint?.id === t.id ? (dropHint.before ? 'before' : 'after') : null,
      isDragging: dragId === t.id,
    };
  };

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
            anchorColor={anchorColorOf(thought, annotationColors)}
            isActive={thought.id === activeId}
            activateSeq={thought.id === activeId ? activateSeq : 0}
            drag={dragOf(thought)}
            onActivate={onActivate}
          />
        ))}
      </div>
    </div>
  );
}
