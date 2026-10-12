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
  it('⭐⭐⭐ 只拿「这一轮」的记录判 —— 置顶推文只在首页,不经过这里', () => {
    const SRC = readFileSync(join(process.cwd(), 'src/modules/x/x-collect-run.ts'), 'utf8');
    expect(SRC).toMatch(/roundRecords: got\.flatMap\(\(a\) => a\.items\.map\(\(i\) => i\.record\)\)/);
  });
});
