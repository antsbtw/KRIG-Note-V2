/**
 * ⭐ 互动卡选哪条(2026-10-22):他找过我 → 回那条;从没互动 → 他最近一条原创;互动过的避开
 */
import { describe, it, expect } from 'vitest';
import { activeWithin, pickEngageTweet } from '@modules/x/x-engage-prepare';
import type { TweetRecord } from '@modules/x/x-timeline-audit';

const rec = (id: string, at: string, over: Partial<TweetRecord> = {}): TweetRecord =>
  ({ id, text: `t${id}`, createdAt: at, authorRestId: 'P', inReplyToUserId: '', ...over } as TweetRecord);
const recs = [rec('3', '2026-10-21T00:00:00Z', { inReplyToUserId: 'X' }), rec('2', '2026-10-20T00:00:00Z'), rec('1', '2026-10-19T00:00:00Z')];
const who = { restId: 'P', handle: 'p' };

describe('互动卡选帖', () => {
  it('他找过我 → 回那条(标 related)', () => {
    const r = pickEngageTweet(recs, who, { tweetId: '9', text: '@me 最近忙啥' }, new Set());
    expect(r).toMatchObject({ kind: 'tweet', tweet: { id: '9', related: true } });
  });
  it('从没互动 → 他最近一条原创(跳过他回复别人的那条)', () => {
    expect(pickEngageTweet(recs, who, undefined, new Set())).toMatchObject({ kind: 'other', tweet: { id: '2' } });
  });
  it('互动过的避开;都互动过 → 等新帖;他找我那条回过了 → 改回他最近的', () => {
    expect(pickEngageTweet(recs, who, undefined, new Set(['2']))).toMatchObject({ tweet: { id: '1' } });
    expect(pickEngageTweet(recs, who, undefined, new Set(['1', '2', '3'])).kind).toBe('skip');
    expect(pickEngageTweet(recs, who, { tweetId: '9', text: 'x' }, new Set(['9']))).toMatchObject({ kind: 'other', tweet: { id: '2' } });
  });
});

describe('⭐ 2 小时内有动静才互动(用户 10-23:「几天不更新的,互动没有意义呀。定2个小时如何?」)', () => {
  const now = new Date('2026-10-23T12:00:00Z');
  it('自己发的(含回复别人)2 小时内 → 互动;转发不算;他找我的那条也算动静', () => {
    expect(activeWithin([rec('1', '2026-10-23T10:30:00Z', { inReplyToUserId: 'X' })], 'P', undefined, now)).toEqual({ active: true });
    expect(activeWithin([rec('1', '2026-10-23T11:00:00Z', { retweetOfId: '9' }), rec('2', '2026-10-21T00:00:00Z')], 'P', undefined, now).active).toBe(false);
    expect(activeWithin([rec('2', '2026-10-21T00:00:00Z')], 'P', '2026-10-23T11:30:00Z', now)).toEqual({ active: true });
  });
  it('超过 2 小时 / 一条没采到 → 先不互动,说清最近一条多久前', () => {
    const r = activeWithin([rec('2', '2026-10-23T06:00:00Z')], 'P', undefined, now);
    expect(r.active === false && r.why).toContain('最近一条是 6 小时前');
    const z = activeWithin([], 'P', undefined, now);
    expect(z.active === false && z.why).toContain('没采到');
  });
});

describe('接线:prepareEngageOn(互动卡准备,2026-10-23 起由能力 x.engage.prepare 调)真的用了 2 小时这道检查', () => {
  it('选完帖子 → activeWithin → 没动静就换成 skip', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/modules/x/x-engage-prepare.ts', 'utf-8');
    const at = src.indexOf('export async function prepareEngageOn(');
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at);
    const i1 = body.indexOf('const picked = pickEngageTweet(');
    const i2 = body.indexOf('activeWithin(r.records, restId, his?.createdAt, new Date())');
    const i3 = body.indexOf("act && !act.active ? { kind: 'skip' as const");
    expect(i1).toBeGreaterThan(-1);
    expect(i1 < i2 && i2 < i3).toBe(true);
  });
});
