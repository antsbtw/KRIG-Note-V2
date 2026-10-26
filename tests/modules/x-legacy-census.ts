/**
 * ⚠️ 冻结的对照实现 —— 2026-10-16 版 `censusPage`(原 src/modules/x/x-page-ledger.ts),P2 切到说明书引擎时搬来(2026-10-19)
 *
 * 只给 tests/modules/x-manual-parity.test.ts 用:同一批载荷(手造 / 随机 / 本机真实样本)新旧逐条比。
 * ⭐ 不许改它 —— 它是「切换前的行为」的定义;说明书改了以后若与它不一致,要么是有意的修正(记进修改档案),要么是弄坏了。
 */
import type { PageCensus } from '@modules/x/x-page-ledger';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** TweetWithVisibilityResults 包了一层 */
function unwrapTweet(r: Record<string, unknown>): Record<string, unknown> {
  return str(r.__typename) === 'TweetWithVisibilityResults' && isObj(r.tweet) ? r.tweet : r;
}

function tweetIdOf(r: Record<string, unknown>): string {
  const t = unwrapTweet(r);
  const legacy = isObj(t.legacy) ? t.legacy : undefined;
  return str(t.rest_id) || str(legacy?.id_str);
}

/** entryId 去掉尾部数字/id,当类型名(who-to-follow-12345 → who-to-follow) */
function kindOf(entryId: string): string {
  return entryId.replace(/-\d[\w-]*$/, '').replace(/-[A-Za-z0-9_]{12,}$/, '') || '(无 entryId)';
}

export function legacyCensusPage(text: string): PageCensus | null {
  let root: unknown;
  try { root = JSON.parse(text); } catch { return null; }
  const tweetIds: string[] = [];
  const promotedIds: string[] = [];
  const userIds: string[] = [];
  let tombstones = 0;
  const cursors: { top?: string; bottom?: string } = {};
  const other: Record<string, number> = {};
  const instructions: Record<string, number> = {};

  const visitContent = (entryId: string, content: unknown): void => {
    if (!isObj(content)) { other[kindOf(entryId)] = (other[kindOf(entryId)] ?? 0) + 1; return; }
    const ct = str(content.cursorType).toLowerCase();
    if (ct !== '' || str(content.entryType) === 'TimelineTimelineCursor' || str(content.itemType) === 'TimelineTimelineCursor') {
      if (ct === 'top') cursors.top = str(content.value);
      else if (ct === 'bottom') cursors.bottom = str(content.value);
      return;
    }
    const ic = isObj(content.itemContent) ? content.itemContent : (isObj(content.content) ? content.content : undefined);
    if (ic && isObj(ic.tweet_results)) {
      const r = isObj(ic.tweet_results.result) ? ic.tweet_results.result : undefined;
      const id = r ? tweetIdOf(r) : '';
      const typename = r ? str(unwrapTweet(r).__typename) : '';
      if (!r || id === '' || /Tombstone|Unavailable/.test(typename)) { tombstones += 1; return; }
      if (entryId.includes('promoted') || isObj(ic.promotedMetadata)) promotedIds.push(id);
      else tweetIds.push(id);
      return;
    }
    if (ic && isObj(ic.user_results)) {
      const r = isObj(ic.user_results.result) ? ic.user_results.result : undefined;
      const id = r ? str(r.rest_id) : '';
      if (id !== '') userIds.push(id); else other['user(无id)'] = (other['user(无id)'] ?? 0) + 1;
      return;
    }
    /** 模块(对话串 / 推荐卡):里面一项一项再分 */
    if (Array.isArray(content.items)) {
      for (const it of content.items) {
        if (!isObj(it)) continue;
        visitContent(str(it.entryId) || entryId, it.item ?? it);
      }
      return;
    }
    other[kindOf(entryId)] = (other[kindOf(entryId)] ?? 0) + 1;
  };

  const visitEntry = (e: unknown): void => {
    if (!isObj(e)) return;
    visitContent(str(e.entryId), e.content ?? e.item);
  };

  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (!isObj(v)) return;
    if (Array.isArray(v.instructions)) {
      for (const ins of v.instructions) {
        if (!isObj(ins)) continue;
        const type = str(ins.type) || '(无 type)';
        instructions[type] = (instructions[type] ?? 0) + 1;
        if (Array.isArray(ins.entries)) for (const e of ins.entries) visitEntry(e);
        if (isObj(ins.entry)) visitEntry(ins.entry);
        if (Array.isArray(ins.moduleItems)) for (const e of ins.moduleItems) visitEntry(e);
      }
      return;
    }
    for (const x of Object.values(v)) walk(x);
  };
  walk(root);
  return { tweetIds: [...new Set(tweetIds)], promotedIds: [...new Set(promotedIds)], tombstones, userIds: [...new Set(userIds)], cursors, other, instructions };
}

