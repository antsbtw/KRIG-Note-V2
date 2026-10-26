/**
 * ⭐⭐ X 的站点说明书(P2 2026-10-19)—— 数据在 `manual/x.manual.json`,引擎在底座 `web-capability/manual`
 *
 * 这里只做两件事:加载时自检(不过就抛,fail loud),把通用清点结果换成 X 逐页账用的形状。
 * ⚠️ 说明书外的(还留在代码里的)登记在 JSON 的 `outside` 段,不在这里。
 */
import { census, loadManual } from '@platform/main/web-capability/manual';
import raw from './manual/x.manual.json';
import type { PageCensus } from './x-page-ledger';

export const X_MANUAL = loadManual(raw);

const MAPPED_KINDS = ['tweet', 'promoted', 'user'];

/** 照说明书清点一份 X 载荷;不是 JSON → null */
export function censusByManual(text: string): PageCensus | null {
  const c = census(X_MANUAL.data.census, text);
  if (!c) return null;
  const cursors: { top?: string; bottom?: string } = {};
  if (c.cursors.up !== undefined) cursors.top = c.cursors.up;
  if (c.cursors.down !== undefined) cursors.bottom = c.cursors.down;
  /** ⚠️ 说明书将来新加的种类,逐页账还不认识 → 记进「不认识」,不静默丢 */
  const other: Record<string, number> = { ...c.unknown };
  for (const [k, ids] of Object.entries(c.items)) if (!MAPPED_KINDS.includes(k)) other[k] = (other[k] ?? 0) + ids.length;
  for (const [k, n] of Object.entries(c.counts)) if (k !== 'tombstone') other[k] = (other[k] ?? 0) + n;
  return {
    tweetIds: c.items.tweet ?? [],
    promotedIds: c.items.promoted ?? [],
    tombstones: c.counts.tombstone ?? 0,
    userIds: c.items.user ?? [],
    cursors,
    other,
    instructions: c.containers,
  };
}
