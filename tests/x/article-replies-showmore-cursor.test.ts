/**
 * 「Show probable spam」折叠区 —— X 自己给的「还有更多」游标。
 *
 * ⚠️ 2026-09-06 真机 TweetDetail 载荷坐实(此前一份都没留过,全靠猜):
 * ```
 * entryId    : "cursor-showmorethreads-2096729716814774201"
 * cursorType : "ShowMoreThreads"
 * displayTreatment.actionText : "Show probable spam"   ← 页面上那个蓝字按钮
 * value      : "DAAKCgAB…"
 * ```
 * X **明确说了「还有,拿这个 cursor 来取」**,而原先的代码在数
 * 「连续 4 轮没新增」就判「翻完了」——真源摆在载荷里没人读
 * (与时间线丢 83% 那次 commit a9d9bc75 同一形态)。
 *
 * ⚠️ 被折进去的正是活动参与者那一类:新账号 + 带链接 + 带图,
 *   X 判为 probable spam;而契约恰恰只认 has_media 的留言。
 *   实测:同一篇文章库存 9 条,单次抓取只翻到 6 条。
 */

import { describe, it, expect } from 'vitest';
import { findShowMoreCursor } from '@platform/main/x/x-article-replies';

/** 真机载荷的结构(字段名与层级照抄 detail-*.json,只去掉无关正文) */
const realShape = {
  data: { threaded_conversation_with_injections_v2: { instructions: [
    { type: 'TimelineAddEntries', entries: [
      { entryId: 'tweet-2095910972506427676',
        content: { entryType: 'TimelineTimelineItem', itemContent: { __typename: 'TimelineTweet' } } },
      { entryId: 'cursor-showmorethreads-2096729716814774201', content: {
        __typename: 'TimelineTimelineCursor',
        entryType: 'TimelineTimelineCursor',
        cursorType: 'ShowMoreThreads',
        displayTreatment: { actionText: 'Show probable spam' },
        value: 'DAAKCgABHRkUkYi__7cLAAIAAACQRW1QQzZ3QUFm',
      } },
    ] },
    { type: 'TimelineTerminateTimeline' },
  ] } },
};

describe('折叠区游标', () => {
  it('⭐ 认出 ShowMoreThreads 游标,并带出按钮文案与 value', () => {
    const c = findShowMoreCursor(realShape);
    expect(c, '认不出就会把「没抓完」当成「翻完了」').toBeDefined();
    expect(c!.actionText).toBe('Show probable spam');
    expect(c!.value).toMatch(/^DAAK/);
    expect(c!.entryId).toContain('showmorethreads');
  });

  it('会话中段的 ShowMore 断层也要认', () => {
    const c = findShowMoreCursor({ x: {
      __typename: 'TimelineTimelineCursor', cursorType: 'ShowMore',
      value: 'abc', displayTreatment: { actionText: 'Show more replies' },
    } });
    expect(c?.actionText).toBe('Show more replies');
  });

  it('⭐ 普通上下翻页游标(Bottom/Top)不算「还有折叠内容」', () => {
    // 认错会导致每次都去点不存在的按钮,白耗 budget
    expect(findShowMoreCursor({ x: {
      __typename: 'TimelineTimelineCursor', cursorType: 'Bottom', value: 'v' } })).toBeUndefined();
    expect(findShowMoreCursor({ x: {
      __typename: 'TimelineTimelineCursor', cursorType: 'Top', value: 'v' } })).toBeUndefined();
  });

  it('⭐ 没有折叠区时返回 undefined —— 这才是真的「翻完了」', () => {
    expect(findShowMoreCursor({ data: { instructions: [
      { entries: [{ entryId: 'tweet-1', content: { itemContent: { __typename: 'TimelineTweet' } } }] },
    ] } })).toBeUndefined();
  });

  it('没有 value 的游标不算(点了也取不到东西)', () => {
    expect(findShowMoreCursor({ x: {
      __typename: 'TimelineTimelineCursor', cursorType: 'ShowMoreThreads' } })).toBeUndefined();
  });

  /** 反向注入:认不出游标时,真机样本必须变红 */
  it('反向注入:恒返回 undefined 时,真机样本会暴露差异', () => {
    const broken = (): undefined => undefined;
    expect(findShowMoreCursor(realShape)).not.toBe(broken());
  });
});
