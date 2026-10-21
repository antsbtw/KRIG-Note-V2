/**
 * ⭐ 互动卡选哪条(2026-10-22):他找过我 → 回那条;从没互动 → 他最近一条原创;互动过的避开
 */
import { describe, it, expect } from 'vitest';
import { pickEngageTweet } from '@modules/x/x-engage-prepare';
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
