/**
 * ⭐⭐⭐ 搜索翻页要拿 **bottom** 游标(2026-10-16 真机)
 *
 * 用户 10-16:「原来经过长时间验证的配方采集推文不是这样的结果的呀?!」「配方搜索,然后把所有的推文采集下来,
 * 这是基本函数/功能,必须保证的哦。」
 * 真机:30 轮翻页,后 29 轮几乎 0 条、偶尔冒 1 条刚发的 —— 拿的是 top 游标(往新翻)。
 * 原条件「bottom 或 值以 DAAD 开头」:搜索页 top / bottom 都以 DAAD 开头、top 在前 → 恒取 top。
 * 旧测试的假载荷**只放了 bottom 一个游标**,所以一直没抓到 —— 这里按真实形状造:top 在前、bottom 在后。
 */
import { describe, it, expect } from 'vitest';
import { auditTimelinePayload } from '@modules/x/x-timeline-audit';

const tweet = (n: number) => ({
  entryId: `tweet-${n}`,
  content: { itemContent: { tweet_results: { result: {
    rest_id: `t${n}`,
    legacy: { id_str: `t${n}`, full_text: `推文${n}` },
    core: { user_results: { result: { legacy: { screen_name: 'a' } } } },
  } } } },
});
const TOP = 'DAADDAABCgABG-TOP-cursor';
const BOTTOM = 'DAADDAABCgABG-BOTTOM-cursor';
const wrap = (instructions: unknown[]) =>
  JSON.stringify({ data: { search_by_raw_query: { search_timeline: { timeline: { instructions } } } } });

describe('搜索页游标', () => {
  it('⭐⭐⭐ 第一页:top 在前、bottom 在后(两个都以 DAAD 开头)→ 取 bottom', () => {
    const text = wrap([{ type: 'TimelineAddEntries', entries: [
      { entryId: 'cursor-top-1', content: { cursorType: 'Top', value: TOP } },
      tweet(1), tweet(2),
      { entryId: 'cursor-bottom-1', content: { cursorType: 'Bottom', value: BOTTOM } },
    ] }]);
    expect(auditTimelinePayload(text).cursor).toBe(BOTTOM);
  });

  it('⭐⭐ 后续页:游标在 TimelineReplaceEntry 里(top 先替换、bottom 后替换)→ 仍取 bottom', () => {
    const text = wrap([
      { type: 'TimelineAddEntries', entries: [tweet(3), tweet(4)] },
      { type: 'TimelineReplaceEntry', entry_id_to_replace: 'cursor-top-1', entry: { entryId: 'cursor-top-2', content: { cursorType: 'Top', value: TOP } } },
      { type: 'TimelineReplaceEntry', entry_id_to_replace: 'cursor-bottom-1', entry: { entryId: 'cursor-bottom-2', content: { cursorType: 'Bottom', value: BOTTOM } } },
    ]);
    expect(auditTimelinePayload(text).cursor).toBe(BOTTOM);
  });

  it('只有 top → 没有往下翻的游标(不能拿 top 冒充)', () => {
    const text = wrap([{ type: 'TimelineAddEntries', entries: [
      { entryId: 'cursor-top-1', content: { cursorType: 'Top', value: TOP } }, tweet(1),
    ] }]);
    expect(auditTimelinePayload(text).cursor).toBeUndefined();
  });

  it('没有 cursorType 标记的老形状 → 仍按 DAAD 开头认', () => {
    const text = wrap([{ type: 'TimelineAddEntries', entries: [tweet(1), { entryId: 'c', content: { value: BOTTOM } }] }]);
    expect(auditTimelinePayload(text).cursor).toBe(BOTTOM);
  });
});

describe('报告里的游标简写分得开(头尾相同、中间不同)', () => {
  it('shortHash 不同 → 不再误报「重复的游标」', async () => {
    const { shortHash } = await import('@modules/x/x-collect-run');
    const a = 'DAADDAABCgAB' + 'x'.repeat(40) + 'YOWYzTDQ9AAA';
    const b = 'DAADDAABCgAB' + 'y'.repeat(40) + 'YOWYzTDQ9AAA';
    expect(shortHash(a)).not.toBe(shortHash(b));
    expect(shortHash(a)).toMatch(/^[0-9a-f]{8}$/);
  });
});
