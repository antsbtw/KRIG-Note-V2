/**
 * ⭐ 第 3 件事:已互关蓝V的互动(2026-10-22 重做)
 * 用户 10-22:刚互关的分「互动过 / 没互动」;一周没互动的 = 先采全最近 7 天,再对互关蓝V做补集。
 */
import { describe, it, expect } from 'vitest';
import { advanceCursor, buildRecentView, engageCollectDue, engageCoverageDone, planEngageRuns, recentCoverageGaps, touchesFromTweets, ENGAGE_PAGE_BUDGET, type MutualRow } from '@modules/x/x-engage';

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

describe('采互动:跨次续采(2026-10-22 真机:一次 20 页只覆盖 11 天)', () => {
  const now = new Date('2026-10-22T00:00:00Z');
  it('没采过 → 三条都从 90 天前采起;from: 带回复用 filter:replies;合计不超预算', () => {
    const r = planEngageRuns('antsbtw', { mine: {}, toMe: {}, mentionMe: {} }, now);
    expect(r.map((x) => x.q)).toEqual([
      'from:antsbtw filter:replies since:2026-07-24',
      'to:antsbtw since:2026-07-24',
      '@antsbtw -from:antsbtw since:2026-07-24',
    ]);
    expect(r.reduce((n, x) => n + x.pages, 0)).toBeLessThanOrEqual(ENGAGE_PAGE_BUDGET);
  });
  it('采过但没到 90 天前 → 先补新的(少页),再 until: 最早那天往更早翻;到了就不再往回翻', () => {
    const cov = { mine: { oldest: '2026-10-10T13:00:00Z', newest: '2026-10-21T18:00:00Z' }, toMe: { oldest: '2026-07-20T00:00:00Z', newest: '2026-10-21T00:00:00Z' }, mentionMe: {} };
    const r = planEngageRuns('antsbtw', cov, now);
    expect(r.map((x) => [x.kind, x.q])).toEqual([
      ['new', 'from:antsbtw filter:replies since:2026-10-21'],
      ['back', 'from:antsbtw filter:replies since:2026-07-24 until:2026-10-11'],
      ['new', 'to:antsbtw since:2026-10-21'],
      ['fresh', '@antsbtw -from:antsbtw since:2026-07-24'],
    ]);
    expect(r.filter((x) => x.kind === 'new').every((x) => x.pages === 5)).toBe(true);
    expect(r.reduce((n, x) => n + x.pages, 0)).toBeLessThanOrEqual(ENGAGE_PAGE_BUDGET);
    expect(engageCoverageDone(cov.toMe, now)).toBe(true);
    expect(engageCoverageDone(cov.mine, now)).toBe(false);
  });
  it('⭐ 边界推进:fresh 整段;back 更早才推进、一条没有且没出错 = 到 90 天前;new 接上了才推进,没接上不动(不留空档)', () => {
    expect(advanceCursor({}, { kind: 'fresh', oldest: '2026-10-10T00:00:00Z', newest: '2026-10-21T00:00:00Z', failed: false }, now))
      .toEqual({ oldest: '2026-10-10T00:00:00Z', newest: '2026-10-21T00:00:00Z' });
    const cur = { oldest: '2026-10-10T00:00:00Z', newest: '2026-10-21T00:00:00Z' };
    expect(advanceCursor(cur, { kind: 'back', oldest: '2026-09-20T00:00:00Z', newest: '2026-10-10T05:00:00Z', failed: true }, now).oldest).toBe('2026-09-20T00:00:00Z');
    expect(advanceCursor(cur, { kind: 'back', failed: false }, now).oldest).toBe('2026-07-24T00:00:00.000Z');
    expect(advanceCursor(cur, { kind: 'back', failed: true }, now)).toEqual(cur);
    expect(advanceCursor(cur, { kind: 'new', oldest: '2026-10-20T23:00:00Z', newest: '2026-10-22T00:00:00Z', failed: false }, now).newest).toBe('2026-10-22T00:00:00Z');
    /** 没接上(这次最旧比旧的最新还晚)→ 中间有空档,不推进 */
    expect(advanceCursor(cur, { kind: 'new', oldest: '2026-10-21T12:00:00Z', newest: '2026-10-22T00:00:00Z', failed: true }, now)).toEqual(cur);
  });
  it('每天自动:任何一条没采过或满 24 小时 → 采', () => {
    const t = Date.parse('2026-10-22T12:00:00Z');
    expect(engageCollectDue({ mine: { at: '2026-10-22T08:00:00Z' }, toMe: { at: '2026-10-22T08:00:00Z' }, mentionMe: {} }, t)).toBe(true);
    expect(engageCollectDue({ mine: { at: '2026-10-22T08:00:00Z' }, toMe: { at: '2026-10-22T08:00:00Z' }, mentionMe: { at: '2026-10-22T08:00:00Z' } }, t)).toBe(false);
    expect(engageCollectDue({ mine: { at: '2026-10-21T08:00:00Z' }, toMe: { at: '2026-10-22T08:00:00Z' }, mentionMe: { at: '2026-10-22T08:00:00Z' } }, t)).toBe(true);
  });
});
