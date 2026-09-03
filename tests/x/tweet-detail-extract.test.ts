/**
 * 守卫:TweetDetail(文章详情页)载荷的抽取。
 *
 * 起因(2026-09-03 实测):试抓报「翻到 42 条 → 属于本文章 0 条」,
 * 且日期空洞跨 48 天。查载荷勘查记录发现**从未捕获过 TweetDetail** ——
 * 那 42 条来自时间线接口:代码复用了 harvestTimeline(为「翻完某人历史」设计),
 * 在详情页上会一路滚进推荐流,抓回一堆无关内容。
 *
 * TweetDetail 的结构与时间线**不同**,回复多包一层 items[].item.itemContent,
 * 这个测试钉死抽取能穿透两种结构。
 */
import { describe, it, expect } from 'vitest';
import { extractTweetsFrom, type HarvestedTweet } from '@platform/main/x/x-timeline-harvester';
import { toContractItems } from '@platform/main/x/x-article-replies';

const ARTICLE = '2092213139139854555';

/** 仿真 TweetDetail:文章本体走 content.itemContent,回复走 content.items[].item.itemContent */
const detailPayload = {
  data: { threaded_conversation_with_injections_v2: { instructions: [{
    type: 'TimelineAddEntries',
    entries: [
      { entryId: `tweet-${ARTICLE}`, content: { itemContent: { tweet_results: { result: {
        rest_id: ARTICLE,
        core: { user_results: { result: { rest_id: '111', core: { screen_name: 'OTun_MyVPN' } } } },
        legacy: { id_str: ARTICLE, full_text: '文章正文',
          created_at: 'Mon Sep 01 10:00:00 +0000 2026', conversation_id_str: ARTICLE },
      } } } } },
      { entryId: 'conversationthread-999', content: { items: [
        { item: { itemContent: { tweet_results: { result: {
          rest_id: '555',
          core: { user_results: { result: { rest_id: '444', core: { screen_name: 'someUser' } } } },
          legacy: { id_str: '555', full_text: '用了三天很稳',
            created_at: 'Mon Sep 01 11:00:00 +0000 2026',
            conversation_id_str: ARTICLE, in_reply_to_status_id_str: ARTICLE,
            extended_entities: { media: [{ type: 'photo' }] } },
        } } } } },
        { item: { itemContent: { tweet_results: { result: {
          rest_id: '556',
          core: { user_results: { result: { rest_id: '445', core: { screen_name: 'noPic' } } } },
          legacy: { id_str: '556', full_text: '纯文字回复',
            created_at: 'Mon Sep 01 12:00:00 +0000 2026',
            conversation_id_str: ARTICLE, in_reply_to_status_id_str: ARTICLE },
        } } } } },
      ] } },
    ],
  }] } },
};

function extract(): HarvestedTweet[] {
  const m = new Map<string, HarvestedTweet>();
  extractTweetsFrom(detailPayload, m);
  return [...m.values()];
}

describe('TweetDetail 抽取', () => {
  it('⭐ 穿透 items[].item.itemContent 这层嵌套(与时间线结构不同)', () => {
    const all = extract();
    expect(all.map((t) => t.tweetId).sort()).toEqual([ARTICLE, '555', '556']);
  });

  it('⭐ 转契约 item 时排除文章本体,只留回复', () => {
    const items = toContractItems(extract(), ARTICLE, 'otun_myvpn');
    expect(items.map((i) => i.tweet_id).sort()).toEqual(['555', '556']);
  });

  it('has_media 逐条准确(带图的 true,纯文字的 false)', () => {
    const items = toContractItems(extract(), ARTICLE, 'otun_myvpn');
    expect(items.find((i) => i.tweet_id === '555')?.has_media).toBe(true);
    expect(items.find((i) => i.tweet_id === '556')?.has_media).toBe(false);
  });

  it('x_uid 取自 user_results.result.rest_id,不是 conversation 里的别的 id', () => {
    const items = toContractItems(extract(), ARTICLE, 'otun_myvpn');
    expect(items.find((i) => i.tweet_id === '555')?.x_uid).toBe('444');
  });
});
