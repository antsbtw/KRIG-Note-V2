/**
 * math-visual 分帧 —— 纯函数(题意图 P2,2026-11-07)
 *
 * 设计稿:docs/10-business-design/math/题意图-几何对象与分帧设计.md §3.2
 * 帧号 1 起数。
 */

import type { FrameEntry, FrameRange } from './types';

/** 有 2 帧及以上才算「分帧」;0~1 帧与原来完全一样 */
export function isFramed(frames: FrameEntry[] | undefined): frames is FrameEntry[] {
  return Array.isArray(frames) && frames.length >= 2;
}

/** 对象在第 i 帧是否可见:没标帧 = 每帧都显示 */
export function visibleInFrame(range: FrameRange | undefined, i: number): boolean {
  if (!range) return true;
  return i >= range.from && (range.to === undefined || i <= range.to);
}

/** 新帧:在 after 之后插入(缺省放最后) */
export function makeFrame(index: number): FrameEntry {
  return { id: `fr-${Date.now()}-${index}`, text: '' };
}

/**
 * 删掉第 k 帧后,对象的出现范围怎么改:
 * - 在 k 之后的帧号都减 1
 * - 只在第 k 帧出现的对象,删帧后没有帧可出现 → 返回 null(调用方提示 / 处理,不静默吞)
 * - 跨过 k 的,范围缩一格
 */
export function rangeAfterRemovingFrame(range: FrameRange | undefined, k: number): FrameRange | undefined | null {
  if (!range) return undefined;
  const shift = (n: number) => (n > k ? n - 1 : n);
  if (range.from === k && range.to === k) return null;
  const from = range.from > k ? range.from - 1 : range.from;
  const to = range.to === undefined ? undefined : shift(range.to === k ? k - 1 : range.to);
  if (to !== undefined && to < from) return { from, to: from };
  return { from: Math.max(1, from), ...(to !== undefined ? { to } : {}) };
}

/** 在第 k 帧之后插入一帧:k 之后的帧号都加 1;跨过插入点的对象自然延续到新帧 */
export function rangeAfterInsertingFrame(range: FrameRange | undefined, k: number): FrameRange | undefined {
  if (!range) return undefined;
  const from = range.from > k ? range.from + 1 : range.from;
  const to = range.to === undefined ? undefined : range.to > k ? range.to + 1 : range.to;
  return { from, ...(to !== undefined ? { to } : {}) };
}
