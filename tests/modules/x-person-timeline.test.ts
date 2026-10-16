/**
 * ⭐⭐ 按时间范围采一个人的三个标签页 —— 收手规则(2026-10-10)
 * 真机数据里的两个坑:置顶推文很老(主页 05-12、回复页 2023)、转发的原推很老。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PERSON_TABS, TIMELINE_RANGES, rangeStart, newestOwn, timeWindowStop } from '@modules/x/x-person-timeline';
import type { TweetRecord } from '@modules/x/x-timeline-audit';

const r = (authorRestId: string, createdAt: string): TweetRecord => ({ authorRestId, createdAt } as TweetRecord);
const NOW = new Date('2026-10-10T12:00:00Z');
const st = (round: number, roundRecords: TweetRecord[]) =>
  ({ round, uniqueTweets: 0, uniqueUsers: 0, freshThisRound: 1, emptyRounds: 0, roundRecords });

describe('三个标签页与范围', () => {
  it('⭐⭐ 接口名是真机探查确认的(回复页不是旧名 UserTweetsAndReplies)', () => {
    expect(PERSON_TABS.map((t) => t.endpoint)).toEqual(['UserOriginalsTimeline', 'UserRepliesTimeline', 'UserRepostsTimeline']);
  });
  it('四档范围;「全部」没有起点', () => {
    expect(TIMELINE_RANGES.map((x) => x.id)).toEqual(['month', 'halfYear', 'year', 'all']);
    expect(rangeStart('month', NOW)!.toISOString().slice(0, 10)).toBe('2026-09-10');
    expect(rangeStart('all', NOW)).toBeUndefined();
  });
});

describe('⭐⭐⭐ 收手规则', () => {
  const start = rangeStart('month', NOW)!;
  const stop = timeWindowStop('me', start, 30);

  it('这一页他自己最新的推文都早于起点 → 停', () => {
    expect(stop(st(3, [r('me', '2026-09-01T00:00:00Z'), r('me', '2026-08-20T00:00:00Z')])).go).toBe(false);
  });
  it('⭐⭐ 只看他自己的:转发的原推很老不算(原推作者是别人)', () => {
    const d = stop(st(2, [r('me', '2026-10-01T00:00:00Z'), r('friend', '2020-01-01T00:00:00Z')]));
    expect(d.go).toBe(true);
    expect(newestOwn([r('friend', '2020-01-01T00:00:00Z')], 'me')).toBeUndefined();
  });
  it('⭐ 这一页没有他自己的推文 → 不凭空停(继续翻)', () => {
    expect(stop(st(2, [r('friend', '2020-01-01T00:00:00Z')])).go).toBe(true);
  });
  it('⭐ 到当场采的页数上限 → 停,并说剩下的交给后台策略', () => {
    const d = stop(st(30, [r('me', '2026-10-05T00:00:00Z')]));
    expect(d.go).toBe(false);
    expect(d.why).toContain('后台策略');
  });
  it('「全部」没有起点:只按页数上限停', () => {
    const all = timeWindowStop('me', undefined, 30);
    expect(all(st(5, [r('me', '2010-01-01T00:00:00Z')])).go).toBe(true);
  });
  it('⭐⭐⭐ 置顶每页都回来(2026-10-15 真机)→ 不算「最新」,否则永远停不下来', () => {
    const pin = { ...r('me', '2026-10-05T00:00:00Z'), pinned: true } as TweetRecord;
    // 置顶比起点新,其余都早于起点 —— 必须停
    expect(stop(st(5, [pin, r('me', '2026-09-01T00:00:00Z'), r('me', '2026-08-30T00:00:00Z')])).go).toBe(false);
    expect(newestOwn([pin, r('me', '2026-09-01T00:00:00Z')], 'me')).toBe('2026-09-01T00:00:00.000Z');
    // 这一页只有置顶 → 当成「没有他自己的推文」,不凭置顶停也不凭置顶走
    expect(newestOwn([pin], 'me')).toBeUndefined();
  });

  it('⭐⭐⭐ 只拿「这一轮」的记录判(首页不经过这里)', () => {
    const SRC = readFileSync(join(process.cwd(), 'src/modules/x/x-collect-run.ts'), 'utf8');
    expect(SRC).toMatch(/roundRecords: got\.flatMap\(\(a\) => a\.items\.map\(\(i\) => i\.record\)\)/);
  });
});

describe('⭐⭐⭐ 置顶按载荷结构认出(TimelinePinEntry)', () => {
  /** 形状照真实载荷(x-payload-survey 2026-09-02):置顶是单独一条指令,普通推文在 TimelineAddEntries */
  const tweet = (id: string, at: string, quoted?: unknown): unknown => ({
    __typename: 'Tweet', rest_id: id,
    core: { user_results: { result: { rest_id: 'me', legacy: { screen_name: 'me' } } } },
    legacy: { id_str: id, full_text: `t${id}`, created_at: at },
    ...(quoted ? { quoted_status_result: { result: quoted } } : {}),
  });
  const item = (id: string, at: string, quoted?: unknown): unknown => ({
    entryId: `tweet-${id}`,
    content: { itemContent: { tweet_results: { result: tweet(id, at, quoted) } } },
  });
  const payload = JSON.stringify({ data: { user: { result: { timeline: { timeline: { instructions: [
    { type: 'TimelinePinEntry', entry: item('900', 'Thu Aug 27 10:20:00 +0000 2026', tweet('800', 'Tue May 12 13:56:03 +0000 2026')) },
    { type: 'TimelineAddEntries', entries: [item('101', 'Mon Jul 20 10:00:00 +0000 2026'), item('102', 'Sun Jul 19 10:00:00 +0000 2026')] },
  ] } } } } } });

  it('⭐⭐ 置顶条目整棵子树都算(置顶 + 它引用的);普通推文不算', async () => {
    // 2026-10-16 真机:置顶 08-27 引用 05-13、再引用 05-12,两条引用也跟着置顶每页回来 →「最新」卡在 05-13
    const { auditTimelinePayload } = await import('@modules/x/x-timeline-audit');
    const a = auditTimelinePayload(payload);
    const pinned = a.items.filter((i) => i.record.pinned === true).map((i) => i.id).sort();
    expect(a.items.length).toBeGreaterThanOrEqual(4);
    expect(pinned).toEqual(['800', '900']);
  });

  it('⭐⭐ 端到端:时间线翻到置顶引用的那条之前,「最新」不再被它卡住', async () => {
    const early = JSON.stringify({ data: { user: { result: { timeline: { timeline: { instructions: [
      { type: 'TimelinePinEntry', entry: item('900', 'Thu Aug 27 10:20:00 +0000 2026', tweet('800', 'Tue May 12 13:56:03 +0000 2026')) },
      { type: 'TimelineAddEntries', entries: [item('201', 'Tue May 05 10:00:00 +0000 2026'), item('202', 'Mon May 04 10:00:00 +0000 2026')] },
    ] } } } } } });
    const { auditTimelinePayload } = await import('@modules/x/x-timeline-audit');
    const recs = auditTimelinePayload(early).items.map((i) => i.record);
    expect(newestOwn(recs, 'me')?.slice(0, 10)).toBe('2026-05-05');
  });

  it('端到端:置顶不再顶住「采到」—— 最新是 07-20 不是 08-27', async () => {
    const { auditTimelinePayload } = await import('@modules/x/x-timeline-audit');
    const recs = auditTimelinePayload(payload).items.map((i) => i.record);
    expect(newestOwn(recs, 'me')?.slice(0, 10)).toBe('2026-07-20');
  });
});
