/**
 * ⭐⭐ 推文里的互动对象(2026-10-10,「他的朋友圈」的原料)
 *
 * 真机实测(10-10):转发页的载荷里,外层是「他的转发」、里层 `legacy.retweeted_status_result` 是原推文;
 * 第一版解析器把两层当两条推文存了,「转发了谁」丢了。引用同理只存了推文 id。
 * ⚠️ 下面的载荷是按 X 的结构**手写的最小样本**;字段路径是否完全对,要真机重采后查库确认。
 */
import { describe, it, expect } from 'vitest';
import { auditTimelinePayload } from '@modules/x/x-timeline-audit';

const user = (id: string, sn: string) => ({ user_results: { result: { rest_id: id, core: { screen_name: sn, name: sn }, legacy: {} } } });
const tweet = (id: string, authorId: string, sn: string, legacyExtra: Record<string, unknown> = {}, top: Record<string, unknown> = {}) => ({
  __typename: 'Tweet', rest_id: id, core: user(authorId, sn),
  legacy: { id_str: id, full_text: `text ${id}`, created_at: 'Fri Oct 10 12:00:00 +0000 2026', entities: {}, ...legacyExtra },
  ...top,
});
const payload = (...tweets: unknown[]) => JSON.stringify({ data: { user: { result: { timeline: { instructions: [{ entries: tweets.map((t, i) => ({ entryId: `tweet-${i}`, content: { itemContent: { tweet_results: { result: t } } } })) }] } } } } });
const rec = (text: string, id: string) => auditTimelinePayload(text).items.find((i) => i.record.id === id)!.record;

describe('互动对象', () => {
  it('⭐⭐⭐ 转发:外层记下「转发了哪条、原作者是谁」;原推文另存,作者是原作者', () => {
    const orig = tweet('900', '2', 'friend');
    const wrap = tweet('100', '1', 'me', { full_text: 'RT @friend: text 900', retweeted_status_result: { result: orig } });
    const text = payload(wrap);
    const outer = rec(text, '100');
    expect(outer.retweetOfId).toBe('900');
    expect(outer.retweetOfAuthorId).toBe('2');
    expect(outer.authorRestId).toBe('1');
    const inner = rec(text, '900');
    expect(inner.authorRestId).toBe('2');
    expect(inner.retweetOfId).toBe('');
  });

  it('⭐⭐ 转发的原推被可见性包装(TweetWithVisibilityResults)也要剥出来', () => {
    const orig = { __typename: 'TweetWithVisibilityResults', tweet: tweet('901', '3', 'hidden') };
    const wrap = tweet('101', '1', 'me', { retweeted_status_result: { result: orig } });
    expect(rec(payload(wrap), '101').retweetOfAuthorId).toBe('3');
  });

  it('⭐⭐ 引用:记下原作者 id', () => {
    const q = tweet('902', '4', 'quoted');
    const t = tweet('102', '1', 'me', { quoted_status_id_str: '902' }, { quoted_status_result: { result: q } });
    const r = rec(payload(t), '102');
    expect(r.quotedStatusId).toBe('902');
    expect(r.quotedAuthorId).toBe('4');
  });

  it('⭐⭐ 回复对象与提及都存数字 id', () => {
    const t = tweet('103', '1', 'me', {
      in_reply_to_status_id_str: '555', in_reply_to_screen_name: 'bob', in_reply_to_user_id_str: '5',
      entities: { user_mentions: [{ screen_name: 'bob', id_str: '5' }, { screen_name: 'cat', id_str: '6' }] },
    });
    const r = rec(payload(t), '103');
    expect(r.inReplyToUserId).toBe('5');
    expect(r.mentionIds).toEqual(['5', '6']);
    expect(r.mentions).toEqual(['bob', 'cat']);
  });

  it('普通推文:互动对象都是空,不编', () => {
    const r = rec(payload(tweet('104', '1', 'me')), '104');
    expect([r.inReplyToUserId, r.quotedAuthorId, r.retweetOfId, r.retweetOfAuthorId]).toEqual(['', '', '', '']);
    expect(r.mentionIds).toEqual([]);
  });
});
