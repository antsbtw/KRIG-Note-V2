/**
 * ⭐ 采互动一段 —— 悄悄限流 / 额度账本 / 翻到头(2026-10-22)
 * 用户 10-22:「要有策略吧,这是一个常规行为,经常要采集自己的每天互动的哦。」
 * 真机:悄悄限流时只给第一页(满 20 条)、显示滚到底,没有 429 —— 不能当成「没有更早的了」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Res = { pages: number; xTweets: number; bottom: boolean };
let resFor: (q: string, want: number) => Res = () => ({ pages: 1, xTweets: 3, bottom: true });
const qs: string[] = [];
const written: Record<string, { oldest?: string; newest?: string }> = {};
vi.mock('@modules/x/x-account-repo', () => ({ readWsAccount: async () => ({ handle: 'me', restId: 'ME' }) }));
vi.mock('@modules/x/x-search-scroll', () => ({
  collectSearchByScroll: async (i: { q: string; wantPages: number }) => {
    qs.push(i.q);
    const r = resFor(i.q, i.wantPages);
    return { ok: true, rateLimited: false, pages: [], harvest: { reachedBottom: r.bottom }, totals: { pages: r.pages, xTweets: r.xTweets, uniqueTweets: r.xTweets, badPages: 0 } };
  },
}));
const now = Date.now();
const iso = (msAgo: number): string => new Date(now - msAgo).toISOString();
let cov: Record<string, { oldest?: string; newest?: string; at?: string }> = {};
vi.mock('@modules/x/x-engage-repo', () => ({
  readEngageCoverage: async () => cov,
  /** 这一轮命中的范围:往更早翻一条没有 */
  runRange: async () => ({}),
  writeEngageCursor: async (_h: string, key: string, c: { oldest?: string; newest?: string }) => { written[key] = c; },
}));

import { collectEngagement } from '@modules/x/x-engage-collect';
import { resetSearchBudget, searchBudget } from '@modules/x/x-search-budget';

describe('采互动一段', () => {
  beforeEach(() => {
    for (const k of Object.keys(written)) delete written[k];
    qs.length = 0;
    resetSearchBudget();
    /** mine 还差最近 7 天(只到 3 天前),另两条齐了 */
    cov = {
      mine: { oldest: iso(3 * 86_400_000), newest: iso(3600_000) },
      toMe: { oldest: iso(100 * 86_400_000), newest: iso(3600_000) },
      mentionMe: { oldest: iso(100 * 86_400_000), newest: iso(3600_000) },
    };
  });

  it('⭐⭐ 第一页是满的却到头(悄悄限流)→ 停在这里、不推进、记进账本;再点一次不硬撞,说清几点自动接着采', async () => {
    resFor = () => ({ pages: 1, xTweets: 20, bottom: true });
    const r = await collectEngagement('ws-1');
    expect(r.ok && r.runs.length).toBe(1);
    expect(r.ok && r.note).toContain('15 分钟后自动接着采');
    expect(written.mine?.newest).toBe(cov.mine.newest);
    expect(searchBudget().waitUntil).toBeGreaterThan(Date.now());
    qs.length = 0;
    const again = await collectEngagement('ws-1');
    expect(qs).toEqual([]);
    expect(again.ok && again.note).toContain('自动接着采');
  });

  it('⭐ 搜索正常:补新的一两页到头 → 接着补齐 7 天;往更早翻一条没有且到头 = 窗口里没有更早的了', async () => {
    resFor = (q) => (q.includes('until_time:') ? { pages: 0, xTweets: 0, bottom: true } : { pages: 1, xTweets: 4, bottom: true });
    const r = await collectEngagement('ws-1');
    expect(qs.filter((q) => q.includes('since_time:')).length).toBe(3);
    expect(qs.some((q) => q.startsWith('from:me filter:replies since:') && q.includes('until_time:'))).toBe(true);
    expect(Date.parse(written.mine?.oldest ?? '')).toBeLessThan(now - 80 * 86_400_000);
    expect(r.ok && r.note).toBeUndefined();
  });

  it('最近 15 分钟搜得太多(给你自己留余量)→ 这一段不搜', async () => {
    const { recordSearch } = await import('@modules/x/x-search-budget');
    recordSearch(40, false);
    const r = await collectEngagement('ws-1');
    expect(qs).toEqual([]);
    expect(r.ok && r.note).toContain('额度留给你自己用');
  });
});
