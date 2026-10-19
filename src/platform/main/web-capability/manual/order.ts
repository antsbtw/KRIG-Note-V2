/**
 * 翻页方向 —— 照说明书判「这一页按不按时间排」,再判「方向反没反」(纯函数)
 *
 * 由 X 的 `isChronological` / `directionWrong`(2026-10-16)抽出,判据不变。
 */
import type { OrderedByTimeRule } from './types';

/**
 * ⚠️ 推荐流、按热度排的搜索、单篇详情不是按时间排的,判方向会误报 —— 哪些按时间排由说明书说。
 * 第一条 url 命中的规则说了算;一条都不中 → 不是。
 */
export function orderedByTime(rules: readonly OrderedByTimeRule[], url: string): boolean {
  let u = url;
  try { u = decodeURIComponent(url); } catch { /* 原样用 */ }
  const r = rules.find((x) => new RegExp(x.url).test(u));
  if (!r) return false;
  return (r.require ?? []).every((s) => u.includes(s));
}

/**
 * 这一页的条目时间(去掉置顶)多数比上一页最新那条还新 → 方向反了。
 * ⚠️ 只在两页都有时间时判;一页没时间就不判(不猜)。
 */
export function directionWrong(prevNewestMs: number | undefined, pageTimesMs: readonly number[]): boolean {
  if (prevNewestMs === undefined || pageTimesMs.length === 0) return false;
  const newer = pageTimesMs.filter((t) => t > prevNewestMs).length;
  return newer * 2 > pageTimesMs.length;
}
