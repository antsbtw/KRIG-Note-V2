/**
 * ⭐ 第 3 件事:已互关蓝V的互动四组 + 互动队列(2026-10-22)
 * 用户选:互动 = 回复和提及;「只有他对我」排最前;从没互动的进队列。
 */
import { describe, it, expect } from 'vitest';
import { advanceCursor, countGroups, engageCollectDue, engageCoverageDone, engageQueue, groupEngagement, planEngageRuns, ENGAGE_PAGE_BUDGET } from '@modules/x/x-engage';

const ME = 'ME';
const t = (id: string, author: string, at: string, rel: { to?: string; mentions?: string[] }, text = '') =>
  ({ tweet_id: id, author_rest_id: author, created_at: at, in_reply_to_user_id: rel.to, mention_ids: rel.mentions, text });

describe('四组', () => {
  const mutual = ['A', 'B', 'C', 'D'];
  const tweets = [
    t('1', ME, '2026-10-01T00:00:00Z', { to: 'A' }),
    t('2', 'A', '2026-10-02T00:00:00Z', { to: ME }),
    t('3', ME, '2026-10-03T00:00:00Z', { mentions: ['B'] }),
    t('4', 'C', '2026-10-04T00:00:00Z', { mentions: [ME] }, '谢谢关注'),
    t('5', 'C', '2026-10-05T00:00:00Z', { to: ME }, '最近在忙啥'),
    t('6', 'X', '2026-10-05T00:00:00Z', { to: ME }),
    t('7', ME, '2026-10-06T00:00:00Z', { to: 'X' }),
  ];
  const g = groupEngagement(ME, mutual, tweets);
  const by = Object.fromEntries(g.map((p) => [p.restId, p]));
  it('回复 / 提及都算;不在互关蓝V里的人不算', () => {
    expect(by.A.group).toBe('both');
    expect(by.B.group).toBe('onlyMe');
    expect(by.C.group).toBe('onlyHim');
    expect(by.D.group).toBe('none');
    expect(by.X).toBeUndefined();
    expect(countGroups(g)).toEqual({ both: 1, onlyMe: 1, onlyHim: 1, none: 1 });
  });
  it('「只有他对我」记的是他最近那一条(互动卡要回它)', () => {
    expect(by.C.lastHis).toMatchObject({ tweetId: '5', text: '最近在忙啥' });
  });
});

describe('队列', () => {
  it('他找过我的最前(最近的在前),然后从没互动(粉丝多的在前);双向 / 只有我对他不进', () => {
    const people = [
      { restId: 'N1', group: 'none' as const }, { restId: 'N2', group: 'none' as const },
      { restId: 'H1', group: 'onlyHim' as const, lastHis: { tweetId: 'a', at: '2026-10-01T00:00:00Z' } },
      { restId: 'H2', group: 'onlyHim' as const, lastHis: { tweetId: 'b', at: '2026-10-09T00:00:00Z' } },
      { restId: 'B', group: 'both' as const }, { restId: 'M', group: 'onlyMe' as const },
    ];
    const q = engageQueue(people, new Map([['N1', 10], ['N2', 500]]));
    expect(q.map((p) => p.restId)).toEqual(['H2', 'H1', 'N2', 'N1']);
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
