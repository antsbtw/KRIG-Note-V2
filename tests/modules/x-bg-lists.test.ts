/**
 * ⭐⭐ 人卡采他的三个名单(2026-10-19)
 * 用户:「在人卡中增加自动采集follower/following/verified followers这三个自动采集的方法吧。」
 * 选「后台慢慢采全」+「人卡显示名单 + 标出候选」→ 后台任务加 kind = lists,复用调度 / 暂停 / 续采。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const listCalls: Array<Record<string, unknown>> = [];
const saveUsersCalls: Array<{ ctx: { listSource: string } }> = [];
const memberCalls: Array<{ owner: string; list: string; ids: string[] }> = [];
let personTabCalls = 0;

vi.mock('@modules/x/x-collect-ports', () => ({ webviewPorts: vi.fn(() => fakePorts) }));
vi.mock('@platform/main/web-capability/wiring/runtime', () => ({ traceRecorder: { lifecycle: vi.fn() } }));
vi.mock('@modules/x/x-tweet-repo', () => ({ saveTweets: vi.fn(async () => ({ inserted: 0, updated: 0, failed: [] })) }));
vi.mock('@modules/x/x-person-collect', () => ({
  collectPersonTab: vi.fn(async () => { personTabCalls += 1; return { reached: false, reason: 'x' }; }),
  personCollectProgress: vi.fn(() => null),
}));
vi.mock('@modules/x/x-account-repo', () => ({ accountForWrite: vi.fn(async () => ({ kind: 'ok', restId: 'ME', handle: 'me' })) }));
vi.mock('@modules/x/x-user-repo', () => ({
  saveUsers: vi.fn(async (_u: unknown, ctx: { listSource: string }) => { saveUsersCalls.push({ ctx }); return { inserted: 0, updated: 0, failed: [] }; }),
  existingUserIds: vi.fn(async (ids: string[]) => ids),
  writeRelations: vi.fn(async () => ({ report: { written: 0, changed: 0, failed: 0 }, before: new Map() })),
}));
/** 库:采集器开头查「库里已有的人」(增量追上判据)—— 测试里给 knownIds */
let knownIds: string[] = [];
vi.mock('@storage/surreal/client', () => ({ getXDB: () => ({ query: async () => [knownIds] }) }));
vi.mock('@modules/x/x-list-member-repo', () => ({
  writeListMembers: vi.fn(async (owner: string, list: string, ids: string[]) => { memberCalls.push({ owner, list, ids }); return ids.length; }),
}));
vi.mock('@modules/x/x-people-repo', () => ({ scanMutualIntent: vi.fn(async () => ({})) }));

const FOLLOWERS = 'https://x.com/i/api/graphql/zz/Followers?variables=%7B%7D';
/** 真机形状:每页带 Top terminate + Bottom 游标;最后一页加 Bottom terminate */
const page = (ids: string[], cursor: string, end = false): string => JSON.stringify({ data: { user: { result: { timeline: { timeline: { instructions: [
  { type: 'TimelineTerminateTimeline', direction: 'Top' },
  ...(end ? [{ type: 'TimelineTerminateTimeline', direction: 'Bottom' }] : []),
  { type: 'TimelineAddEntries', entries: [
    ...ids.map((id) => ({ entryId: `user-${id}`, content: { itemContent: { user_results: { result: {
      rest_id: id, core: { screen_name: `h${id}`, name: `n${id}` }, legacy: {},
    } } } } })),
    { entryId: 'cursor-bottom', content: { cursorType: 'Bottom', value: cursor } },
  ] },
] } } } } } });
let pages: string[] = [];
let n = 0;
const fakePorts = {
  goto: vi.fn(async () => ({ ok: true })),
  async harvest(plan: { gotoPage?: unknown }) {
    if (plan.gotoPage) return { items: [] };
    const text = pages[Math.min(n, pages.length - 1)];
    n += 1;
    return { items: [{ url: FOLLOWERS, text, status: 200, requestHeaders: { authorization: 'B', 'x-csrf-token': 'c' } }] };
  },
  async runScript() { return { ok: true }; },
};

import { allTabsDone, describeProgress, nextTab, tabsOf, type BgJob } from '@modules/x/x-bg-job';
import { runSegment } from '@modules/x/x-bg-segment';
import { makeSegmentDeps } from '@modules/x/x-bg-runner';
import { collectPersonListSegment } from '@modules/x/x-person-list-collect';

const listJob = (over: Partial<BgJob> = {}): BgJob => ({
  id: 'L', restId: 'OWNER', handle: 'owner', wsId: 'ws-1', range: 'all', status: 'queued', kind: 'lists',
  profile: { done: false }, replies: { done: false }, reposts: { done: false },
  followers: { done: false }, following: { done: false }, verifiedFollowers: { done: false },
  totalPages: 0, totalSaved: 0, createdAt: '', updatedAt: '', ...over,
} as BgJob);

describe('任务模型:名单任务只看三个名单;老任务不受影响', () => {
  it('标签页 / 下一个 / 完成', () => {
    expect(tabsOf(listJob())).toEqual(['followers', 'following', 'verifiedFollowers']);
    expect(nextTab(listJob({ followers: { done: true } }))).toBe('following');
    expect(allTabsDone(listJob({ followers: { done: true }, following: { done: true }, verifiedFollowers: { done: true } }))).toBe(true);
    /** 帖子三页没到底不影响名单任务完成 */
    expect(allTabsDone(listJob({ followers: { done: true }, following: { done: true }, verifiedFollowers: { done: true }, profile: { done: false } }))).toBe(true);
    const old = { ...listJob(), kind: undefined, followers: undefined, following: undefined, verifiedFollowers: undefined } as BgJob;
    expect(tabsOf(old)).toEqual(['profile', 'replies', 'reposts']);
    expect(describeProgress(listJob({ followers: { done: true }, following: { done: false, cursor: 'c' } }))).toMatch(/关注者 已到底／他关注的 翻到一半／蓝V关注者 待采/);
  });
});

describe('跑一段:名单页 + 标签页传给采集器;翻够本段上限 ≠ 到底', () => {
  it('上限停 → 存断点不到底;X 说到头 → 这个名单到底,下一个', async () => {
    const seen: Array<{ tab: string; page: string; resumeCursor?: string }> = [];
    const deps = (r: { exhausted: boolean; stopReason: string; nextCursor?: string }) => ({
      async runOne(input: { tab: string; page: string; resumeCursor?: string }) {
        seen.push(input);
        return { pages: 10, saved: 500, ...r };
      },
    });
    const a = await runSegment(listJob({ followers: { done: false, cursor: 'C0' } }), deps({ exhausted: false, stopReason: '本段翻够 10 页上限', nextCursor: 'C1' }) as never, 10, new Date());
    expect(seen[0]).toMatchObject({ tab: 'followers', page: 'x.followers', resumeCursor: 'C0' });
    expect(a.job.followers).toEqual({ cursor: 'C1', oldestAt: undefined, done: false });
    const b = await runSegment(a.job, deps({ exhausted: true, stopReason: 'X 说名单到头了' }) as never, 10, new Date());
    expect(b.job.followers?.done).toBe(true);
    expect(nextTab(b.job)).toBe('following');
  });
});

describe('runner:名单任务走名单采集器,不走帖子采集器', () => {
  beforeEach(() => { personTabCalls = 0; listCalls.length = 0; pages = [page(['1', '2'], 'c1', true)]; n = 0; });
  it('按种类分派', async () => {
    const r = await makeSegmentDeps(7, listJob(), new Date()).runOne({ tab: 'followers', page: 'x.followers', handle: 'owner', pageCap: 10 });
    expect(personTabCalls).toBe(0);
    expect(r.exhausted).toBe(true);
    const bad = await makeSegmentDeps(7, listJob(), new Date()).runOne({ tab: 'profile', page: 'x.profile', handle: 'owner', pageCap: 10 });
    expect(bad.failure).toMatch(/不是名单的标签页/);
  });
});

describe('⭐⭐ 名单采集器(行为测试:真 runCollect + 真机形状的假页面)', () => {
  beforeEach(() => { saveUsersCalls.length = 0; memberCalls.length = 0; n = 0; });
  it('每页存人(listSource 固定 person-list)+ 记进他的名单;翻够本段页数就停并交出断点', async () => {
    pages = [page(['1', '2'], 'c1'), page(['3'], 'c2'), page(['4'], 'c3'), page(['5'], 'c4'), page(['6'], 'c5')];
    const r = await collectPersonListSegment({ wcId: 7, page: 'x.followers', list: 'followers', handle: 'owner', ownerRestId: 'OWNER', pageCap: 2 });
    expect(r.failure).toBeUndefined();
    expect(r.exhausted).toBe(false);
    expect(r.stopReason).toMatch(/上限/);
    expect(r.nextCursor).toBeDefined();
    expect(saveUsersCalls.every((c) => c.ctx.listSource === 'person-list')).toBe(true);
    expect(memberCalls.every((c) => c.owner === 'OWNER' && c.list === 'followers')).toBe(true);
    expect(memberCalls.flatMap((c) => c.ids)).toEqual(expect.arrayContaining(['1', '2', '3']));
  });
  it('只有 Top terminate 不算到头;Bottom terminate 才到头', async () => {
    pages = [page(['1'], 'c1'), page(['2'], 'c2', true)];
    const r = await collectPersonListSegment({ wcId: 7, page: 'x.followers', list: 'followers', handle: 'owner', ownerRestId: 'OWNER', pageCap: 10 });
    expect(r.exhausted).toBe(true);
    expect(memberCalls.flatMap((c) => c.ids)).toEqual(expect.arrayContaining(['1', '2']));
  });
});

describe('⭐⭐ 关系采集策略(2026-10-20)', () => {
  beforeEach(() => { saveUsersCalls.length = 0; memberCalls.length = 0; n = 0; knownIds = []; });
  const ids = (from: number, k: number) => Array.from({ length: k }, (_, i) => `${from + i}`);
  const plan = (mode: 'full' | 'incremental', xCount?: number) => ({ mode, xCount, dbCount: 100, why: '', estPages: 3 });

  it('增量:连续 30 个库里已有的 = 追上,这个名单做完,不翻到本段上限', async () => {
    knownIds = ids(1000, 200);
    pages = [page([...ids(1, 10), ...ids(1000, 40)], 'c1'), page(ids(1040, 50), 'c2'), page(ids(1090, 50), 'c3')];
    const r = await collectPersonListSegment({ wcId: 7, page: 'x.followers', list: 'followers', handle: 'owner', ownerRestId: 'OWNER', pageCap: 10, plan: plan('incremental') });
    expect(r.caughtUp).toBe(true);
    expect(r.stopReason).toMatch(/追上了/);
    expect(r.listStats).toMatchObject({ fresh: 10 });
    expect(r.pages).toBeLessThanOrEqual(2);
  });

  it('撞限流(翻页请求回 429):不判失败、保住断点、写明会放慢', async () => {
    pages = [page(ids(1, 5), 'c1')];
    const origRun = fakePorts.runScript;
    fakePorts.runScript = (async () => ({ ok: false, status: 429, why: 'Rate limit exceeded' })) as never;
    try {
      const r = await collectPersonListSegment({ wcId: 7, page: 'x.followers', list: 'followers', handle: 'owner', ownerRestId: 'OWNER', pageCap: 10, resumeCursor: 'OLD', plan: plan('full', 5000) });
      expect(r.stopReason).toMatch(/429/);
      expect(r.failure).toBeUndefined();
      expect(r.note).toMatch(/限流/);
      expect(r.nextCursor).toBeDefined();
      expect(r.exhausted).toBe(false);
    } finally {
      fakePorts.runScript = origRun;
    }
  });

  it('我自己的号:listSource 用名单名(写「他和我」的关系),不记 x_list_member', async () => {
    pages = [page(ids(1, 3), 'c1', true)];
    const r = await collectPersonListSegment({ wcId: 7, page: 'x.followers', list: 'followers', handle: 'me', ownerRestId: 'ME', pageCap: 10, self: true, plan: plan('incremental') });
    expect(r.failure).toBeUndefined();
    expect(saveUsersCalls.every((c) => c.ctx.listSource === 'followers')).toBe(true);
    expect(memberCalls).toHaveLength(0);
  });

  it('任务说采我自己,可 X 网页登录的是别的号 → 停下说清楚(不把别人的名单写成我的关系)', async () => {
    const r = await collectPersonListSegment({ wcId: 7, page: 'x.followers', list: 'followers', handle: 'x', ownerRestId: 'SOMEONE', pageCap: 10, self: true });
    expect(r.failure).toMatch(/登录的是/);
  });
});
