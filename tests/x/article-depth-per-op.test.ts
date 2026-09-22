/**
 * ⭐⭐ 长文深度**按接口**分开记 —— 2026-09-22 立此守卫。
 *
 * ── 为什么需要它 ──
 * `/articles` 标签页的接口(`UserArticlesTweets`)只给 `title` + `preview_text`;
 * **同一篇长文**走普通时间线接口(`UserTweets` 等)却带 `content_state`(几千到
 * 一万六千字正文,@0xEgorAI 那两条实测 16081 / 6812 字)。
 *
 * ⚠️ 此前报告把长文深度**汇总成一个数、不分接口** → 「哪个入口给得浅」
 * 从来没进过视野 → 被反推成「正文只在详情页才有」→ 白立了一个项
 * (docs/handoff/x-article-body-backfill.md)。
 *
 * ⭐ 所以这条守卫钉的是:**深度必须能按接口区分开**。
 *   汇总数相等、而分接口数不同,正是那个立项被证否的关键证据形态。
 */
import { describe, it, expect } from 'vitest';
import { extractTweetsFrom, type HarvestedTweet } from '../../src/platform/main/x/x-timeline-harvester';

/** 普通时间线接口给的长文:带 content_state(真正文) */
function timelinePayload(id: string, body: string) {
  return {
    data: { x: { result: {
      __typename: 'Tweet',
      rest_id: id,
      core: { user_results: { result: {
        rest_id: '1', core: { screen_name: '0xEgorAI', name: 'Egor' },
      } } },
      legacy: { id_str: id, full_text: 'https://t.co/short', created_at: 'Sat Sep 20 10:00:00 +0000 2026', lang: 'en' },
      article: { article_results: { result: {
        id: 'a', rest_id: 'b', title: 'How to Build an AI Trading Agent',
        content_state: { blocks: [{ text: body, type: 'unstyled' }] },
      } } },
    } } },
  };
}

/** `/articles` 标签页接口给的同一类长文:**没有** content_state */
function articlesTabPayload(id: string) {
  return {
    data: { x: { result: {
      __typename: 'Tweet',
      rest_id: id,
      core: { user_results: { result: {
        rest_id: '2', core: { screen_name: 'KA594594', name: '艾地声' },
      } } },
      legacy: { id_str: id, full_text: 'https://t.co/short2', created_at: 'Sat Sep 06 10:00:00 +0000 2026', lang: 'zh' },
      article: { article_results: { result: {
        id: 'c', rest_id: 'd', lifecycle_state: {}, cover_media: {}, metadata: {},
        title: '乡村文化人记忆',
        preview_text: '现代人的自由,很大程度上是一部「逃离共同体」的历史。',
      } } },
    } } },
  };
}

/** 复刻主进程的「按单个载荷量深度」那段(x-timeline-harvester 里 opEntry 的算法) */
function measure(payload: unknown): { articles: number; withBody: number } {
  const solo = new Map<string, HarvestedTweet>();
  extractTweetsFrom(payload, solo);
  const arts = [...solo.values()].filter((t) => t.isArticle);
  return { articles: arts.length, withBody: arts.filter((t) => t.isLongText).length };
}

describe('长文深度按接口区分', () => {
  it('⭐ 普通时间线接口:长文带正文', () => {
    const m = measure(timelinePayload('2099916828529082572', 'x'.repeat(16081)));
    expect(m.articles).toBe(1);
    expect(m.withBody).toBe(1);
  });

  it('⚠️ /articles 标签页接口:是长文,但没有正文', () => {
    const m = measure(articlesTabPayload('2098551151192866818'));
    expect(m.articles).toBe(1);
    // ⭐ 这一条就是「白立一个项」的根源:它是长文却没正文
    expect(m.withBody).toBe(0);
  });

  it('⭐⭐ 两个接口的长文总数相同,而带正文数不同 —— 汇总会抹平,分接口才看得见', () => {
    const deep = measure(timelinePayload('111', 'y'.repeat(6812)));
    const shallow = measure(articlesTabPayload('222'));

    // 汇总口径:两边都是「1 篇长文」,完全看不出差别
    expect(deep.articles).toBe(shallow.articles);

    // 分接口口径:差别在这里,而且正是那个被证否的前提
    expect(deep.withBody).toBe(1);
    expect(shallow.withBody).toBe(0);
    expect(deep.withBody).not.toBe(shallow.withBody);
  });

  it('⚠️ 摘要不许充当正文 —— 否则浅接口会伪装成深接口', () => {
    const solo = new Map<string, HarvestedTweet>();
    extractTweetsFrom(articlesTabPayload('333'), solo);
    const t = [...solo.values()][0];
    // 摘要要收(不然白丢),但**不能**让 isLongText 为真
    expect(t.text).toContain('逃离共同体');
    expect(t.isLongText).toBeFalsy();
  });
});
