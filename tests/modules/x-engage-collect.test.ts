/**
 * ⭐ 采互动的边界推进 —— 悄悄限流不能被当成「没有更早的了」(2026-10-22 真机:限流时三条都只给 1 页、显示滚到底,没有 429)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

let pagesFor: (q: string) => number = () => 1;
const written: Record<string, { oldest?: string; newest?: string }> = {};
vi.mock('@modules/x/x-account-repo', () => ({ readWsAccount: async () => ({ handle: 'me', restId: 'ME' }) }));
vi.mock('@modules/x/x-search-scroll', () => ({
  collectSearchByScroll: async (i: { q: string }) => ({ ok: true, rateLimited: false, pages: [], totals: { pages: pagesFor(i.q), uniqueTweets: 0, badPages: 0 } }),
}));
const cov = {
  mine: { oldest: '2026-10-10T00:00:00Z', newest: '2026-10-21T00:00:00Z' },
  toMe: { oldest: '2026-10-10T00:00:00Z', newest: '2026-10-21T00:00:00Z' },
  mentionMe: { oldest: '2026-10-10T00:00:00Z', newest: '2026-10-21T00:00:00Z' },
};
vi.mock('@modules/x/x-engage-repo', () => ({
  readEngageCoverage: async () => cov,
  /** 往更早翻的一轮:一条都没命中 */
  runRange: async () => ({}),
  writeEngageCursor: async (_h: string, key: string, c: { oldest?: string; newest?: string }) => { written[key] = c; },
}));

import { collectEngagement } from '@modules/x/x-engage-collect';

describe('往更早翻一条没有', () => {
  beforeEach(() => { for (const k of Object.keys(written)) delete written[k]; });
  it('这一轮每条都只给 1 页(疑似悄悄限流)→ 不推进,还是 10-10', async () => {
    pagesFor = () => 1;
    await collectEngagement('ws-1');
    expect(written.mine?.oldest).toBe('2026-10-10T00:00:00Z');
  });
  it('这一轮有一条翻过多页(搜索正常)→ 往更早翻空 = 窗口里没有更早的了,边界到 90 天前', async () => {
    pagesFor = (q) => (q.includes('until:') ? 0 : 4);
    await collectEngagement('ws-1');
    expect(Date.parse(written.mine?.oldest ?? '')).toBeLessThan(Date.parse('2026-08-01T00:00:00Z'));
  });
});
