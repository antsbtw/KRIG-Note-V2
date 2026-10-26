/**
 * ⭐⭐ 求关:选哪一条推文(2026-10-17)
 * 用户 10-17:「采集这个人的前10条推文,分析完毕,选择一条和互关相关的」「如果没有求关,bio也没有求关,先放弃这个人。」
 */
import { describe, it, expect } from 'vitest';
import { pickAskTweet, recentOwn, ASK_RECENT_N } from '@modules/x/x-ask-plan';
import type { TweetRecord } from '@modules/x/x-timeline-audit';

const t = (id: string, text: string, day: number, extra: Partial<TweetRecord> = {}): TweetRecord => ({
  id, text, authorRestId: 'he', createdAt: `2026-10-${String(day).padStart(2, '0')}T00:00:00Z`, tweetUrl: '', retweetOfId: '', ...extra,
} as TweetRecord);
const he = { restId: 'he', handle: 'he' };

describe('pickAskTweet', () => {
  it('⭐⭐ 用户 10-22「回复推荐以时间顺序优先」:推文里有求关 → 求,但回的是他最新一条(不是最新那条相关的)', () => {
    const p = pickAskTweet([t('1', '今天天气好', 9), t('2', '#蓝V互关 关注必回', 8), t('3', '互关互关', 5)], he);
    expect(p.kind).toBe('tweet');
    expect(p.kind !== 'skip' && p.tweet.id).toBe('1');
    expect(p.why).toContain('最新一条');
    expect(p.recent.map((x) => x.id)).toEqual(['1', '2', '3']);
  });

  it('⭐ 推文里没有、Bio 里求关 → 用最新一条原创推文', () => {
    const p = pickAskTweet([t('1', '早安', 3), t('2', '晚安', 9)], { ...he, bio: '互关必回' });
    expect(p.kind).toBe('bio-latest');
    expect(p.kind !== 'skip' && p.tweet.id).toBe('2');
  });

  it('名字里求关也算', () => {
    expect(pickAskTweet([t('1', '早安', 3)], { ...he, name: '米丽（蓝V互关）' }).kind).toBe('bio-latest');
  });

  it('⭐⭐ 推文和 Bio 都没有求关 → 放弃', () => {
    const p = pickAskTweet([t('1', '早安', 3)], { ...he, bio: '热爱生活' });
    expect(p.kind).toBe('skip');
    expect(p.why).toContain('放弃');
  });

  it('一条都没采到 → 放弃(原因说的是没采到,不是他没求关)', () => {
    const p = pickAskTweet([], { ...he, bio: '互关必回' });
    expect(p).toMatchObject({ kind: 'skip', recent: [] });
    expect(p.why).toContain('没采到');
  });

  it('⚠️ 转发 / 别人的推文不算 —— 求关不能用别人的话', () => {
    const p = pickAskTweet([
      t('1', '#蓝V互关', 9, { retweetOfId: '99' }),
      t('3', '#蓝V互关', 9, { authorRestId: 'other' }),
      t('4', '早安', 1),
    ], he);
    expect(p.kind).toBe('skip');
    expect(p.recent.map((x) => x.id)).toEqual(['4']);
  });

  it('⭐ 置顶也算,按它真实的发帖时间排(10-22 真机:置顶是 2 小时前刚发的,原来被排除没推)', () => {
    const p = pickAskTweet([t('2', '终于到3000粉了', 9, { pinned: true }), t('4', '每天都互关点不满怎么办', 8), t('5', '老置顶', 1, { pinned: true })], he);
    expect(p.kind !== 'skip' && p.tweet.id).toBe('2');
    expect(p.recent.map((x) => x.id)).toEqual(['2', '4', '5']);
  });
});

describe('recentOwn', () => {
  it(`只取最新 ${ASK_RECENT_N} 条、新→旧、去重`, () => {
    const recs = Array.from({ length: 15 }, (_, i) => t(String(i + 1), 'x', i + 1));
    const r = recentOwn([...recs, recs[14]], 'he');
    expect(r.map((x) => x.id)).toEqual(['15', '14', '13', '12', '11', '10', '9', '8', '7', '6']);
  });
});
