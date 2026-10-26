/**
 * ⭐ 第 3 件事:已互关蓝V的互动(2026-10-22 重做)
 * 用户 10-22:刚互关的分「互动过 / 没互动」;一周没互动的 = 先采全最近 7 天,再对互关蓝V做补集。
 */
import { describe, it, expect } from 'vitest';
import { advanceCursor, buildRecentView, engageCollectDue, engageCoverageDone, nextEngageRun, recentCoverageGaps, touchesFromTweets, SEGMENT_PAGES, type MutualRow } from '@modules/x/x-engage';
import { budgetOf, SEARCH_CAP, SEARCH_RESERVE } from '@modules/x/x-search-budget';

const ME = 'ME';
const t = (id: string, author: string, at: string, rel: { to?: string; mentions?: string[] }, text = '') =>
  ({ tweet_id: id, author_rest_id: author, created_at: at, in_reply_to_user_id: rel.to, mention_ids: rel.mentions, text });

describe('互动从哪来', () => {
  it('回复 / 提及两个方向都算;不在互关蓝V里的不算;我同一条又回又提到只算一次', () => {
    const set = new Set(['A', 'B', 'C']);
    const r = touchesFromTweets(ME, set, [
      t('1', ME, '2026-10-20T00:00:00Z', { to: 'A', mentions: ['A'] }),
      t('2', 'B', '2026-10-20T00:00:00Z', { mentions: [ME] }, '谢谢'),
      t('3', 'X', '2026-10-20T00:00:00Z', { to: ME }),
      t('4', ME, '2026-10-20T00:00:00Z', { to: 'X' }),
    ]);
    expect(r).toEqual([
      { person: 'A', who: 'me', at: '2026-10-20T00:00:00Z' },
      { person: 'B', who: 'him', at: '2026-10-20T00:00:00Z', tweetId: '2', text: '谢谢' },
    ]);
  });
});

describe('⭐⭐ 刚互关 / 一周没互动', () => {
  const now = new Date('2026-10-22T12:00:00Z');
  const row = (id: string, extra: Partial<MutualRow> = {}): MutualRow => ({ restId: id, handle: id.toLowerCase(), ...extra });
  const rows = [
    row('N1', { mutualSince: { at: '2026-10-21T00:00:00Z', firstSeen: false } }),
    row('N2', { mutualSince: { at: '2026-10-20T00:00:00Z', firstSeen: true } }),
    row('Q1', { followers: 10 }), row('Q2', { followers: 900 }), row('Q3', { followers: 5 }),
    row('T1'), row('OLD'),
  ];
  const touches = [
    { person: 'N2', who: 'me' as const, at: '2026-10-21T00:00:00Z' },
    { person: 'T1', who: 'him' as const, at: '2026-10-21T00:00:00Z', tweetId: 'h1', text: '在吗' },
    /** 8 天前的 —— 不在这周,OLD 算一周没互动 */
    { person: 'OLD', who: 'me' as const, at: '2026-10-14T00:00:00Z' },
  ];
  const latest = new Map([['Q3', { id: 'p3', text: '新帖', at: '2026-10-21T00:00:00Z' }]]);
  const v = buildRecentView(rows, touches, latest, now);
  it('刚互关(7 天内)按互动过 / 没互动分开,新的在前', () => {
    expect(v.newUntouched.map((p) => p.restId)).toEqual(['N1']);
    expect(v.newTouched.map((p) => p.restId)).toEqual(['N2']);
  });
  it('⭐ 一周没互动 = 补集:这周有来往的不列(只计数);8 天前的互动不算这周;有最近帖子的在前,其余粉丝多的在前', () => {
    expect(v.quiet.map((p) => p.restId)).toEqual(['Q3', 'Q2', 'Q1', 'OLD']);
    expect(v.touchedCount).toBe(1);
    expect(v.quiet[0].latestPost?.id).toBe('p3');
  });
  it('他找过我、我之后没回 → 记下那条(互动卡回它);我回过了就不算没回', () => {
    const w = buildRecentView([row('T1')], [...touches, { person: 'T1', who: 'me' as const, at: '2026-10-21T05:00:00Z' }], new Map(), now);
    expect(v.quiet.find((p) => p.restId === 'T1')).toBeUndefined();
    expect(buildRecentView([row('T1', { mutualSince: { at: '2026-10-21T00:00:00Z', firstSeen: false } })], touches, new Map(), now).newTouched[0].unanswered?.tweetId).toBe('h1');
    expect(w.touchedCount).toBe(1);
    expect(buildRecentView([row('T1', { mutualSince: { at: '2026-10-21T00:00:00Z', firstSeen: false } })], [...touches, { person: 'T1', who: 'me' as const, at: '2026-10-21T05:00:00Z' }], new Map(), now).newTouched[0].unanswered).toBeUndefined();
  });
  it('⭐ 最近 7 天没采全 → 列出差在哪(补集不可信);采全且 24 小时内补过新的 → 空', () => {
    const fresh = '2026-10-22T06:00:00Z';
    expect(recentCoverageGaps({
      mine: { oldest: '2026-10-18T00:00:00Z', newest: fresh, at: fresh },
      toMe: { oldest: '2026-09-27T00:00:00Z', newest: fresh, at: '2026-10-20T00:00:00Z' },
      mentionMe: {},
    }, now)).toEqual([
      { key: 'mine', why: '只采到 10-18,还差 10-15 ~ 10-18' },
      { key: 'toMe', why: '超过 24 小时没补新的' },
      { key: 'mentionMe', why: '还没采' },
    ]);
    const ok = { oldest: '2026-10-01T00:00:00Z', newest: fresh, at: fresh };
    expect(recentCoverageGaps({ mine: ok, toMe: ok, mentionMe: ok }, now)).toEqual([]);
  });
});

describe('⭐⭐ 采互动的策略(用户 10-22:「要有策略吧,这是一个常规行为」)', () => {
  const now = new Date('2026-10-22T00:00:00Z');
  /** 模拟一段:每条实际用 used(r) 页,不推进边界(只看排了什么) */
  const seg = (cov: Parameters<typeof nextEngageRun>[1], left: number, used: (r: { kind: string; pages: number }) => number = (r) => r.pages) => {
    const done = new Set<string>();
    const out: Array<{ kind: string; goal: string; key: string; q: string; pages: number }> = [];
    for (let r = nextEngageRun('antsbtw', cov, now, left, done); r; r = nextEngageRun('antsbtw', cov, now, left, done)) {
      done.add(`${r.key}:${r.kind}`);
      out.push(r);
      left -= Math.max(used(r), 1);
    }
    return out;
  };
  it('没采过 → 三条都从 90 天前采起;from: 带回复用 filter:replies;合计不超一段', () => {
    const r = seg({ mine: {}, toMe: {}, mentionMe: {} }, SEGMENT_PAGES);
    expect(r.map((x) => x.q)).toEqual([
      'from:antsbtw filter:replies since:2026-07-24',
      'to:antsbtw since:2026-07-24',
      '@antsbtw -from:antsbtw since:2026-07-24',
    ]);
    expect(r.reduce((n, x) => n + x.pages, 0)).toBeLessThanOrEqual(SEGMENT_PAGES);
  });
  const cov = {
    mine: { oldest: '2026-10-18T03:56:40Z', newest: '2026-10-21T18:00:00Z' },
    toMe: { oldest: '2026-07-20T00:00:00Z', newest: '2026-10-21T00:00:00Z' },
    mentionMe: { oldest: '2026-09-27T00:00:00Z', newest: '2026-10-21T00:00:00Z' },
  };
  it('⭐ 先补新的(精确到秒接着上次)→ 剩下的补齐最近 7 天;补新的按实际用的页数扣,不占补齐的份', () => {
    /** 补新的一般一两页就到头 */
    const r = seg(cov, 25, (x) => (x.kind === 'new' ? 2 : x.pages));
    expect(r.map((x) => [x.kind, x.goal, x.q, x.pages])).toEqual([
      ['new', 'recent', 'from:antsbtw filter:replies since_time:1792605599', 15],
      ['new', 'recent', 'to:antsbtw since_time:1792540799', 15],
      ['new', 'recent', '@antsbtw -from:antsbtw since_time:1792540799', 15],
      ['back', 'recent', 'from:antsbtw filter:replies since:2026-07-24 until_time:1792295801', 19],
    ]);
  });
  it('7 天没齐前不往 90 天前补;额度少 → 页数跟着少;没额度 → 一条都不排', () => {
    expect(seg(cov, 25, () => 2).some((x) => x.goal === 'deep')).toBe(false);
    expect(seg(cov, 6).reduce((n, x) => n + x.pages, 0)).toBeLessThanOrEqual(6);
    expect(seg(cov, 0)).toEqual([]);
  });
  it('7 天已齐 → 有余量才往 90 天前补', () => {
    const ok = { ...cov, mine: { oldest: '2026-10-10T00:00:00Z', newest: '2026-10-21T18:00:00Z' } };
    const r = seg(ok, 25, (x) => (x.kind === 'new' ? 1 : x.pages));
    expect(r.filter((x) => x.goal === 'deep').map((x) => x.key)).toEqual(['mine', 'mentionMe']);
    expect(engageCoverageDone(cov.toMe, now)).toBe(true);
    expect(engageCoverageDone(cov.mine, now)).toBe(false);
  });
  it('⭐ 边界推进:fresh 整段;back 更早才推进、一条没有或翻到头 = 到 90 天前;new 接上了或翻到头才推进', () => {
    expect(advanceCursor({}, { kind: 'fresh', oldest: '2026-10-10T00:00:00Z', newest: '2026-10-21T00:00:00Z', failed: false }, now))
      .toEqual({ oldest: '2026-10-10T00:00:00Z', newest: '2026-10-21T00:00:00Z' });
    const cur = { oldest: '2026-10-10T00:00:00Z', newest: '2026-10-21T00:00:00Z' };
    expect(advanceCursor(cur, { kind: 'back', oldest: '2026-09-20T00:00:00Z', newest: '2026-10-10T05:00:00Z', failed: true }, now).oldest).toBe('2026-09-20T00:00:00Z');
    expect(advanceCursor(cur, { kind: 'back', failed: false }, now).oldest).toBe('2026-07-24T00:00:00.000Z');
    expect(advanceCursor(cur, { kind: 'back', failed: true }, now)).toEqual(cur);
    expect(advanceCursor(cur, { kind: 'back', oldest: '2026-09-20T00:00:00Z', newest: '2026-10-10T05:00:00Z', failed: false, exhausted: true }, now).oldest).toBe('2026-07-24T00:00:00.000Z');
    expect(advanceCursor(cur, { kind: 'new', oldest: '2026-10-20T23:00:00Z', newest: '2026-10-22T00:00:00Z', failed: false }, now).newest).toBe('2026-10-22T00:00:00Z');
    /** 没接上、也没翻到头 → 中间有空档,不推进 */
    expect(advanceCursor(cur, { kind: 'new', oldest: '2026-10-21T12:00:00Z', newest: '2026-10-22T00:00:00Z', failed: false }, now)).toEqual(cur);
    /** 没接上但翻到头了(从上次那一秒起全看完)→ 推进 */
    expect(advanceCursor(cur, { kind: 'new', oldest: '2026-10-21T12:00:00Z', newest: '2026-10-22T00:00:00Z', failed: false, exhausted: true }, now).newest).toBe('2026-10-22T00:00:00Z');
  });
  it('⭐ 什么时候采一段:撞限流没过 15 分钟 / 额度不够 → 不采;7 天没齐 → 每 15 分钟;齐了 → 每 3 小时', () => {
    const t = Date.parse('2026-10-22T12:00:00Z');
    const fresh = '2026-10-22T11:50:00Z';
    const full = { oldest: '2026-10-01T00:00:00Z', newest: '2026-10-22T11:00:00Z' };
    const gap = { oldest: '2026-10-18T00:00:00Z', newest: '2026-10-22T11:00:00Z' };
    const free = { freePages: 35 };
    expect(engageCollectDue({ mine: { ...full, at: fresh }, toMe: { ...full, at: fresh }, mentionMe: {} }, t, free)).toBe(true);
    expect(engageCollectDue({ mine: { ...gap, at: '2026-10-22T11:44:00Z' }, toMe: { ...full, at: '2026-10-22T11:44:00Z' }, mentionMe: { ...full, at: '2026-10-22T11:44:00Z' } }, t, free)).toBe(true);
    expect(engageCollectDue({ mine: { ...gap, at: fresh }, toMe: { ...full, at: fresh }, mentionMe: { ...full, at: fresh } }, t, free)).toBe(false);
    const done = { mine: { ...full, at: '2026-10-22T10:00:00Z' }, toMe: { ...full, at: '2026-10-22T10:00:00Z' }, mentionMe: { ...full, at: '2026-10-22T10:00:00Z' } };
    expect(engageCollectDue(done, t, free)).toBe(false);
    expect(engageCollectDue(done, t + 2 * 3600_000, free)).toBe(true);
    expect(engageCollectDue({ mine: {}, toMe: {}, mentionMe: {} }, t, { freePages: 35, waitUntil: t + 60_000 })).toBe(false);
    expect(engageCollectDue({ mine: {}, toMe: {}, mentionMe: {} }, t, { freePages: 2 })).toBe(false);
  });
});

describe('搜索额度账本', () => {
  it('15 分钟内用的页数扣额度、留余量;撞了限流 15 分钟内额度为 0', () => {
    const t = 1_000_000_000;
    expect(budgetOf([{ at: t - 60_000, pages: 20 }, { at: t - 20 * 60_000, pages: 30 }], undefined, t)).toEqual({ usedPages: 20, freePages: SEARCH_CAP - SEARCH_RESERVE - 20, waitUntil: undefined });
    expect(budgetOf([], t - 5 * 60_000, t)).toMatchObject({ freePages: 0, waitUntil: t + 10 * 60_000 });
    expect(budgetOf([], t - 16 * 60_000, t).freePages).toBe(SEARCH_CAP - SEARCH_RESERVE);
  });
});
