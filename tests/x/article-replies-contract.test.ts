/**
 * 守卫:文章回复 → campaign-tasks 契约 item 的转换。
 *
 * 契约(docs/10-business-design/x/X爬虫同步契约.md §2.1、§4)的判定链是
 * kind ∈ {reply,quote} ∧ has_media ∧ !deleted ∧ 时间≥文章发布,
 * 其中 **has_media 直接决定发不发奖励** —— 宽了会误发,所以本文件重点守它。
 */
import { describe, it, expect } from 'vitest';
import { toContractItems } from '@platform/main/x/x-article-replies';
import type { HarvestedTweet } from '@platform/main/x/x-timeline-harvester';

const ARTICLE = '1832000000000000000';

function tw(over: Partial<HarvestedTweet>): HarvestedTweet {
  return {
    tweetId: 't1', authorHandle: 'someone', text: 'hi',
    createdAt: '2026-09-05T08:12:33.000Z',
    hasMedia: false, isLongText: false, metrics: {}, self: {},
    conversationId: ARTICLE,
    ...over,
  } as HarvestedTweet;
}

describe('契约 item 转换', () => {
  it('会话内的回复 → kind=reply', () => {
    const r = toContractItems([tw({})], ARTICLE);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('reply');
  });

  it('引用文章 → kind=quote', () => {
    const r = toContractItems(
      [tw({ conversationId: 'other', quotedStatusId: ARTICLE })], ARTICLE);
    expect(r[0]?.kind).toBe('quote');
  });

  it('⭐ 排除文章本身 —— 它不是「留言」', () => {
    expect(toContractItems([tw({ tweetId: ARTICLE })], ARTICLE)).toHaveLength(0);
  });

  it('⭐ 排除 DOM 兜底来源 —— 它的 has_media 不可信(分不清预览卡)', () => {
    const r = toContractItems([tw({ fromDom: true, hasMedia: true })], ARTICLE);
    expect(r, 'DOM 来源必须整条排除,否则可能凭预览卡误发奖励').toHaveLength(0);
  });

  it('⭐ 排除自己的回复 —— 活动是给用户发奖励', () => {
    const r = toContractItems([tw({ authorHandle: 'NetLab2GFW' })], ARTICLE, 'netlab2gfw');
    expect(r).toHaveLength(0);
  });

  it('与本文章无关的推整条排除', () => {
    const r = toContractItems([tw({ conversationId: 'unrelated' })], ARTICLE);
    expect(r).toHaveLength(0);
  });

  it('契约必填字段缺失就跳过(username / created_at)', () => {
    expect(toContractItems([tw({ authorHandle: undefined })], ARTICLE)).toHaveLength(0);
    expect(toContractItems([tw({ createdAt: undefined })], ARTICLE)).toHaveLength(0);
  });

  it('username 归一化(不带 @、小写);x_uid 原样透传', () => {
    const r = toContractItems([tw({ authorHandle: '@SomeOne', authorRestId: '44196397' })], ARTICLE);
    expect(r[0].username).toBe('someone');
    expect(r[0].x_uid).toBe('44196397');
  });

  it('has_media 原样反映载荷,不猜', () => {
    expect(toContractItems([tw({ hasMedia: true })], ARTICLE)[0].has_media).toBe(true);
    expect(toContractItems([tw({ hasMedia: false })], ARTICLE)[0].has_media).toBe(false);
  });

  it('created_at 输出 ISO 8601 UTC 带 Z(契约 §1)', () => {
    const r = toContractItems([tw({ createdAt: 'Wed Sep 02 10:54:38 +0000 2026' })], ARTICLE);
    expect(r[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('text_excerpt 截 200 字(契约 §2.1)', () => {
    const r = toContractItems([tw({ text: 'x'.repeat(500) })], ARTICLE);
    expect(r[0].text_excerpt).toHaveLength(200);
  });
});
