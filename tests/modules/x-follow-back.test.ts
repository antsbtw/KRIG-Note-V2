/**
 * ⭐⭐ 蓝V互关第 4 阶段:查回关 + 人的互动时间线(2026-10-19)
 * 用户 10-17:「要记录关注时间,定期检查对方是否回关,建立和对方互动的时间线。」
 * 10-19 选:每天自动一次 · 满 N 天没回关只列出来由人决定 · 时间线放人卡「互动」栏。
 */
import { describe, it, expect } from 'vitest';
import { buildTimeline, classifyAsks, followCheckDue, makeKnownRunTracker } from '@modules/x/x-follow-back';
import { scanFollowersUntilCaughtUp } from '@modules/x/x-follow-scan';
import { pickAskTweet } from '@modules/x/x-ask-plan';
import type { TweetRecord } from '@modules/x/x-timeline-audit';

describe('追上了没有 —— 连续 N 个老关注者', () => {
  it('新人清零、老人累加;满 N 个才算追上;同一个人只算一次', () => {
    const t = makeKnownRunTracker(new Set(['a', 'b', 'c', 'd']), 3);
    t.feed(['n1', 'a', 'b', 'n2', 'a', 'c']);
    expect(t.state).toMatchObject({ run: 1, caughtUp: false, seen: 5, fresh: ['n1', 'n2'] });
    t.feed(['d']);
    expect(t.state.caughtUp).toBe(false);
    t.feed(['b2'].filter(Boolean));
    expect(t.state.run).toBe(0);
  });
  it('满阈值即追上;追上之后的人不再计数(10-19 真机:停因写成「连续 15 个」、老关注者被算成新人)', () => {
    const t = makeKnownRunTracker(new Set(['a', 'b', 'c']), 3);
    t.feed(['x', 'a', 'b', 'c', 'y']);
    expect(t.state).toMatchObject({ caughtUp: true, run: 3, fresh: ['x'] });
    t.feed(['z']);
    expect(t.state).toMatchObject({ run: 3, fresh: ['x'] });
  });
});

describe('每天自动一次', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  it('没查过 → 查;成功的隔一天;失败的隔 2 小时', () => {
    expect(followCheckDue(null, now)).toBe(true);
    expect(followCheckDue({ at: '2026-10-19T13:00:00Z', ok: true }, now)).toBe(false);
    expect(followCheckDue({ at: '2026-10-19T11:59:00Z', ok: true }, now)).toBe(true);
    expect(followCheckDue({ at: '2026-10-20T10:30:00Z', ok: false }, now)).toBe(false);
    expect(followCheckDue({ at: '2026-10-20T09:59:00Z', ok: false }, now)).toBe(true);
  });
});

describe('⭐⭐ 翻我的 followers 直到追上(行为测试:真 runCollect + 假页面,名单页用 10-19 真机形状)', () => {
  const FOLLOWERS = 'https://x.com/i/api/graphql/zz/Followers?variables=%7B%7D';
  /** 真机形状:每页都带 `TimelineTerminateTimeline direction: Top` + Bottom 游标(10-19 前这一条让第一页就停) */
  const page = (ids: string[], cursor: string, end = false): string => JSON.stringify({ data: { user: { result: { timeline: { timeline: { instructions: [
    { type: 'TimelineClearCache' },
    { type: 'TimelineTerminateTimeline', direction: 'Top' },
    ...(end ? [{ type: 'TimelineTerminateTimeline', direction: 'Bottom' }] : []),
    { type: 'TimelineAddEntries', entries: [
      ...ids.map((id) => ({ entryId: `user-${id}`, content: { itemContent: { user_results: { result: {
        rest_id: id, core: { screen_name: `h${id}`, name: `n${id}` }, legacy: {},
      } } } } })),
      { entryId: 'cursor-bottom', content: { cursorType: 'Bottom', value: cursor } },
      { entryId: 'cursor-top', content: { cursorType: 'Top', value: `-1|${cursor}` } },
    ] },
  ] } } } } } });
  const fake = (pages: string[]) => {
    let n = 0;
    const saved: string[][] = [];
    return {
      saved,
      deps: {
        async harvest(plan: { gotoPage?: unknown }) {
          if (plan.gotoPage) return { items: [] };
          const text = pages[Math.min(n, pages.length - 1)];
          n += 1;
          return { items: [{ url: FOLLOWERS, text, status: 200, requestHeaders: { authorization: 'B', 'x-csrf-token': 'c' } }] };
        },
        async runScript() { return { ok: true }; },
        async save(users: ReadonlyArray<{ restId: string }>) { saved.push(users.map((u) => u.restId)); return { inDb: users.map((u) => u.restId) }; },
      },
    };
  };
  const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => `${from + i}`);

  it('新关注的 60 人在前、之后全是老关注者 → 第 2 页追上就停,不翻到上限;新人 60 个', async () => {
    const known = new Set(ids(1000, 500));
    const f = fake([page([...ids(1, 50)], 'c1'), page([...ids(51, 10), ...ids(1000, 40)], 'c2'), page(ids(1040, 50), 'c3'), page(ids(1090, 50), 'c4')]);
    const r = await scanFollowersUntilCaughtUp(f.deps as never, { known, limit: 30, maxPages: 20 });
    expect(r.caughtUp).toBe(true);
    expect(r.stopReason).toMatch(/追上了/);
    expect(r.tracker.state.fresh).toHaveLength(60);
    expect(r.pages).toBeLessThanOrEqual(3);
    expect(f.saved.flat()).toContain('60');
  });

  it('翻到上限还没追上 → caughtUp=false,停因说清楚(调用方据此不把「没看到」当「没回关」)', async () => {
    const f = fake([page(ids(1, 50), 'c1'), page(ids(51, 50), 'c2'), page(ids(101, 50), 'c3'), page(ids(151, 50), 'c4')]);
    const r = await scanFollowersUntilCaughtUp(f.deps as never, { known: new Set(['x']), limit: 30, maxPages: 3 });
    expect(r.caughtUp).toBe(false);
    expect(r.stopReason).toMatch(/页数上限 3/);
  });

  it('X 说名单到头(Bottom terminate)= 整份看过,也算追上', async () => {
    const f = fake([page(ids(1, 20), 'c1'), page(ids(21, 5), 'c2', true)]);
    const r = await scanFollowersUntilCaughtUp(f.deps as never, { known: new Set(), limit: 30, maxPages: 20 });
    expect(r.caughtUp).toBe(true);
    expect(r.stopReason).toMatch(/到头/);
  });
});

describe('求关对象的回关状态', () => {
  const now = new Date('2026-10-25T12:00:00Z');
  const ask = (person: string, at: string, followed: 'ok' | 'already' | 'failed' = 'ok') => ({ person, handle: `h${person}`, at, followed });
  it('已回关(带时间范围)/ 求关前就关注 / 等待中 / 满 7 天确认没回 / 未确认 / 已取关 / 关注失败的不算', () => {
    const r = classifyAsks({
      asks: [
        ask('1', '2026-10-17T10:00:00Z'), ask('1', '2026-10-17T09:00:00Z', 'failed'),
        ask('2', '2026-10-17T10:00:00Z', 'already'),
        ask('3', '2026-10-22T10:00:00Z'),
        ask('4', '2026-10-17T10:00:00Z'),
        ask('5', '2026-10-17T10:00:00Z', 'failed'),
        ask('6', '2026-10-17T10:00:00Z'),
      ],
      relations: new Map([
        ['1', { follows_me: true, i_follow: true }], ['2', { follows_me: true, i_follow: true }],
        ['3', { follows_me: false, i_follow: true }], ['4', { follows_me: false, i_follow: true }],
        ['6', { follows_me: false, i_follow: false }],
      ]),
      changes: [
        { person: '1', observed_at: '2026-10-19T12:52:00Z', prev_observed_at: '2026-10-17T10:44:00Z', from_follows_me: false, to_follows_me: true, source: 'tweet-authors' },
        { person: '2', observed_at: '2026-10-16T00:00:00Z', to_follows_me: true, to_i_follow: true, source: 'migration' },
      ],
      lastCaughtUp: '2026-10-25T09:00:00Z', now, revisitDays: 7,
    });
    const by = Object.fromEntries(r.map((x) => [x.person, x]));
    expect(by['1']).toMatchObject({ status: 'back', askedAt: '2026-10-17T10:00:00Z', backBetween: { from: '2026-10-17T10:44:00Z', to: '2026-10-19T12:52:00Z' } });
    expect(by['2']).toMatchObject({ status: 'back', alreadyBefore: true });
    expect(by['3'].status).toBe('waiting');
    expect(by['4']).toMatchObject({ status: 'overdue', askDays: 8 });
    expect(by['5']).toBeUndefined();
    expect(by['6'].status).toBe('dropped');
  });
  it('⭐ 没有一次「追上了」的查回关在求关之后 → 满 7 天也只能是「未确认」,不说他没回关', () => {
    const r = classifyAsks({
      asks: [ask('4', '2026-10-17T10:00:00Z')], relations: new Map([['4', { follows_me: false, i_follow: true }]]),
      changes: [], lastCaughtUp: '2026-10-16T00:00:00Z', now, revisitDays: 7,
    });
    expect(r[0].status).toBe('unconfirmed');
    expect(classifyAsks({ asks: [ask('4', '2026-10-17T10:00:00Z')], relations: new Map([['4', { follows_me: false, i_follow: true }]]), changes: [], now, revisitDays: 7 })[0].status).toBe('unconfirmed');
  });
});

describe('人的互动时间线', () => {
  it('求关一条(三动作合在一起)· 求关以外的动作 · 他回关(时间范围)· 首次关系 · 双向推文往来;从早到晚', () => {
    const ev = buildTimeline({
      me: 'ME', person: 'P',
      asks: [{ person: 'P', handle: 'p', at: '2026-10-17T10:42:00Z', followed: 'ok', liked: 'ok', replied: 'ok', tweet_id: 't1', tweet_text: '求互关', reply_text: '已关,互关互助!', reply_id: 'r1' }],
      actions: [
        { at: '2026-10-17T10:42:01Z', action: 'like', result: 'ok', reason: '求关 · 推文 t1' },
        { at: '2026-10-26T08:00:00Z', action: 'unfollow', result: 'ok' },
      ],
      changes: [
        { person: 'P', observed_at: '2026-10-17T00:41:00Z', to_follows_me: false, to_i_follow: false, source: 'tweet-authors' },
        { person: 'P', observed_at: '2026-10-19T12:52:00Z', prev_observed_at: '2026-10-17T10:44:00Z', from_follows_me: false, to_follows_me: true, from_i_follow: true, to_i_follow: true, source: 'followers' },
      ],
      tweets: [
        { tweet_id: 'r1', created_at: '2026-10-17T10:42:02Z', author_rest_id: 'ME', in_reply_to_user_id: 'P', text: '已关,互关互助!' },
        { tweet_id: 't9', created_at: '2026-10-21T08:03:00Z', author_rest_id: 'P', in_reply_to_user_id: 'ME', text: '谢谢关注' },
        { tweet_id: 't10', created_at: '2026-10-22T08:03:00Z', author_rest_id: 'P', mention_ids: ['ME'], text: '@me 看这个' },
        { tweet_id: 't11', created_at: '2026-10-23T08:03:00Z', author_rest_id: 'ME', quoted_author_id: 'P', text: '好观点' },
        { tweet_id: 't12', created_at: '2026-10-24T08:03:00Z', author_rest_id: 'X', in_reply_to_user_id: 'ME', text: '别人' },
      ],
    });
    expect(ev.map((e) => e.text)).toEqual([
      '第一次记录关系:他没关注我 · 我没关注他',
      '求关(赞✓ 留言✓ 关注✓)',
      '他关注了我',
      '他回复了我',
      '他提到了我',
      '我引用了他',
      '取关',
    ]);
    expect(ev.find((e) => e.kind === 'followed-me')).toMatchObject({ from: '2026-10-17T10:44:00Z', at: '2026-10-19T12:52:00Z', who: 'him' });
    expect(ev.find((e) => e.kind === 'ask')?.detail).toContain('我留言「已关,互关互助!」');
  });
});

describe('再互动:选帖避开求关过的', () => {
  const rec = (id: string, text: string, at: string): TweetRecord => ({ id, text, createdAt: at, authorRestId: 'P' } as TweetRecord);
  const recs = [rec('3', '今天天气不错', '2026-10-24T00:00:00Z'), rec('2', '#互关 必回', '2026-10-23T00:00:00Z'), rec('1', '#蓝V互关', '2026-10-17T00:00:00Z')];
  it('和互关相关、没留过言的优先;没有就最新一条;全留过言 → 放弃(等新帖)', () => {
    expect(pickAskTweet(recs, { restId: 'P', handle: 'p' }, { avoidIds: new Set(['1']) })).toMatchObject({ kind: 'tweet', tweet: { id: '2' } });
    expect(pickAskTweet(recs, { restId: 'P', handle: 'p' }, { avoidIds: new Set(['1', '2']) })).toMatchObject({ kind: 'other', tweet: { id: '3' } });
    expect(pickAskTweet(recs, { restId: 'P', handle: 'p' }, { avoidIds: new Set(['1', '2', '3']) }).kind).toBe('skip');
  });
  it('不是再互动时照旧(第一次求关:没求关字眼就放弃)', () => {
    expect(pickAskTweet([rec('3', '今天天气不错', '2026-10-24T00:00:00Z')], { restId: 'P', handle: 'p' }).kind).toBe('skip');
  });
});
