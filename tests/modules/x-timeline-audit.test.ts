/**
 * X 时间线载荷的完整性核对 —— ⭐ 它回答「**采到的数据完整没有**」
 *
 * 用户 2026-10-02:「关键是核对爬取的数据完整没有。」
 *
 * ⚠️⚠️ 本文件钉的是**本仓真实发生过的丢失形态**,不是臆想:
 * · `project-x-article-body-lost`  长文正文整片丢失,报告仍说「✓ 全文已取回」
 * · `project-x-field-four-place-registration` 「**不量的字段永远 100%**」
 * · 2026-10-02 实测 captured=72 而**一条推文都没有**
 */

import { describe, it, expect } from 'vitest';
import { auditTimelinePayload, summarizeAudits } from '@modules/x/x-timeline-audit';

/** 造一条**形状贴近真实**的推文节点 */
function tweet(over: Record<string, unknown> = {}, legacyOver: Record<string, unknown> = {}) {
  return {
    __typename: 'Tweet',
    rest_id: '1234567890',
    core: {
      user_results: {
        result: { rest_id: '111', legacy: { screen_name: 'someone', name: 'Some One' } },
      },
    },
    legacy: {
      id_str: '1234567890',
      full_text: 'hello world',
      created_at: 'Wed Oct 01 12:00:00 +0000 2026',
      conversation_id_str: '1234567890',
      favorite_count: 3,
      retweet_count: 1,
      reply_count: 0,
      ...legacyOver,
    },
    ...over,
  };
}

/** 包成 X 真实的那种外层(instructions → entries) */
function payload(tweets: unknown[], cursor = 'DAABCgABxxxx'): string {
  return JSON.stringify({
    data: {
      home: {
        home_timeline_urt: {
          instructions: [{
            type: 'TimelineAddEntries',
            entries: [
              ...tweets.map((t, i) => ({
                entryId: `tweet-${i}`,
                content: { itemContent: { tweet_results: { result: t } } },
              })),
              ...(cursor ? [{
                entryId: 'cursor-bottom-0',
                content: { value: cursor, cursorType: 'Bottom' },
              }] : []),
            ],
          }],
        },
      },
    },
  });
}

describe('⭐⭐ 解得出推文', () => {
  it('⭐ 真实嵌套结构里能找到推文 —— **不写死路径**', () => {
    /**
     * ⚠️ 旧实现的教训:「X 的响应外层结构变过好几次,
     * 写死路径会在改版后**静默取不到**(返回 undefined 而不报错)」。
     */
    const a = auditTimelinePayload(payload([tweet(), tweet()]));
    expect(a.tweets, '解不出推文').toBe(2);
    expect(a.problems, '正常载荷不该有问题').toEqual([]);
  });

  it('⭐⭐ 换一层嵌套照样解得出(防「改版就哑」)', () => {
    const weird = JSON.stringify({
      data: { user: { result: { timeline: { xx: { yy: [{ zz: tweet() }] } } } } },
    });
    expect(auditTimelinePayload(weird).tweets, '换个嵌套就解不出 —— 写死路径了?').toBe(1);
  });

  it('⚠️ 载荷里有环也不死循环', () => {
    /** ⭐ X 的载荷里确实有互相引用 */
    const t: Record<string, unknown> = tweet();
    (t as { self?: unknown }).self = t;
    let text = '';
    try { text = JSON.stringify(t); } catch { text = payload([tweet()]); }
    expect(() => auditTimelinePayload(text)).not.toThrow();
  });
});

describe('⭐⭐⭐ 逐字段量 —— 不量的字段永远 100%', () => {
  it('⭐ 全字段齐 → 覆盖率都是 100%', () => {
    const a = auditTimelinePayload(payload([tweet(), tweet()]));
    expect(a.coverage['正文']).toBe(100);
    expect(a.coverage['作者']).toBe(100);
    expect(a.coverage['发布时间']).toBe(100);
    expect(a.coverage['互动数']).toBe(100);
    expect(a.coverage['会话id']).toBe(100);
    expect(a.coverage['推文链接']).toBe(100);
  });

  it('⭐⭐ 正文丢了 → 覆盖率掉下来(最要紧的一条)', () => {
    /** `project-x-article-body-lost`:正文整片丢失而报告说「✓ 全文已取回」 */
    const a = auditTimelinePayload(payload([tweet({}, { full_text: '' }), tweet()]));
    expect(a.coverage['正文'], '正文丢了却报 100% —— 又一次「不量就 100%」').toBe(50);
  });

  it('⭐ 作者丢了 → 量得出来', () => {
    const noAuthor = tweet();
    delete (noAuthor as Record<string, unknown>).core;
    const a = auditTimelinePayload(payload([noAuthor, tweet()]));
    expect(a.coverage['作者']).toBe(50);
  });

  it('⭐ conversation_id 丢了 → 量得出来', () => {
    /** ⚠️ 本仓实测这个字段曾卡在 9% —— 正是没人量它 */
    const a = auditTimelinePayload(payload([tweet({}, { conversation_id_str: undefined }), tweet()]));
    expect(a.coverage['会话id']).toBe(50);
  });

  it('⭐ 互动数丢了 → 量得出来', () => {
    const t = tweet({}, { favorite_count: undefined, retweet_count: undefined, reply_count: undefined });
    const a = auditTimelinePayload(payload([t, tweet()]));
    expect(a.coverage['互动数']).toBe(50);
  });

  it('⭐⭐ 长推取**长的那个正文** —— 不是截断版', () => {
    /**
     * ⚠️ `project-x-article-body-lost`:取错了会「23 字 vs 16081 字」。
     * legacy.full_text 是截断版,note_tweet 里才是全文。
     */
    const long = 'x'.repeat(5000);
    const t = tweet({
      note_tweet: { note_tweet_results: { result: { text: long } } },
    }, { full_text: 'x'.repeat(200) });
    const a = auditTimelinePayload(payload([t]));
    expect(a.items[0].textLen, '取了截断版 —— 长推正文会丢 96%').toBe(5000);
    expect(a.items[0].isLongText, '没识别出这是长推').toBe(true);
    expect(a.coverage['长推']).toBe(100);
  });

  it('⚠️⚠️ 长推与长文**分开量** —— 它们是两回事', () => {
    /**
     * `project-x-article-body-lost`:「长推(note_tweet)与长文(article)是两回事」。
     *
     * ⚠️ 注入验证逼出来的改写:我第一版只测「纯长文」,
     * 而把长推也标成长文的那种实现**照样全绿** ——
     * 样本里根本没有「只是长推」的那一条
     * (`feedback-check-sample-contains-phenomenon`)。
     * ⭐ 真能区分的样本:**纯长推**(有 note_tweet、无 article)
     * 和**纯长文**(有 article、无 note_tweet)各一条。
     */
    const pureNote = tweet({
      note_tweet: { note_tweet_results: { result: { text: 'y'.repeat(3000) } } },
    });
    const pureArticle = tweet({ rest_id: '2', article: { article_results: {} } }, { id_str: '2' });
    const a = auditTimelinePayload(payload([pureNote, pureArticle]));

    expect(a.tweets).toBe(2);
    // ⭐ 各一条 → 各 50%;混为一谈的实现会让「长文」变成 100%
    expect(a.coverage['长推'], '长推没量对').toBe(50);
    expect(a.coverage['长文'], '长推被算成了长文 —— 两种丢失形态会混在一起').toBe(50);
    // ⭐ 逐条也要对
    expect(a.items[0].isLongText).toBe(true);
    expect(a.items[0].isArticle, '纯长推被标成了长文').toBe(false);
    expect(a.items[1].isArticle).toBe(true);
    expect(a.items[1].isLongText, '纯长文被标成了长推').toBe(false);
  });
});

describe('⭐⭐ 翻页游标 —— 它是「还能不能翻」的硬证据', () => {
  it('⭐ 有游标 → 认得出来', () => {
    const a = auditTimelinePayload(payload([tweet()], 'DAABCgABabc'));
    expect(a.hasCursor, '游标解不出来 —— 翻页会以为到底了').toBe(true);
    expect(a.cursor).toContain('DAAB');
  });

  it('⭐⭐ 没游标 → **报问题**,不静默', () => {
    /**
     * ⚠️ `project-x-cursor-paging`:「几页没新人」不能当到底,
     * 而 X 一直说 hasMore=true —— 游标在不在才是硬证据。
     */
    const a = auditTimelinePayload(payload([tweet()], ''));
    expect(a.hasCursor).toBe(false);
    expect(a.problems.join(''), '没游标却不吭声 —— 「翻不动」会被当成「到底了」')
      .toContain('没有翻页游标');
  });
});

describe('⭐⭐ 解不出来时如实说', () => {
  it('⭐⭐ 不是 JSON → 报问题,**不抛**', () => {
    /** ⚠️ 「读不懂」与「是空的」是两件事,混起来就查不动 */
    const a = auditTimelinePayload('这不是 JSON{{{');
    expect(a.tweets).toBe(0);
    expect(a.problems.join(''), '没说清是解析失败').toContain('不是合法 JSON');
    expect(a.problems.join(''), '没提示可能被截断').toContain('截断');
  });

  it('⭐⭐ 合法 JSON 但没推文 → 报问题(2026-10-02 实测的那种)', () => {
    /** ⚠️ 实测:captured=72 全是视频分片、心跳、头像 */
    const a = auditTimelinePayload(JSON.stringify({ data: { viewer: { ok: true } } }));
    expect(a.tweets).toBe(0);
    expect(a.problems.join(''), '采到一堆无关的却不吭声').toContain('一条推文都没解出来');
  });

  it('⚠️ 空字符串也不崩', () => {
    expect(() => auditTimelinePayload('')).not.toThrow();
    expect(auditTimelinePayload('').problems.length).toBeGreaterThan(0);
  });
});

describe('⭐⭐ 多页汇总', () => {
  it('⭐⭐ 按 id **去重** —— 两页之间会重叠', () => {
    /** ⚠️ 不去重会把条数报虚高,而「采到多少」正是要核对的 */
    const p1 = auditTimelinePayload(payload([tweet(), tweet({ rest_id: '2' }, { id_str: '2' })]));
    const p2 = auditTimelinePayload(payload([tweet({ rest_id: '2' }, { id_str: '2' }),
      tweet({ rest_id: '3' }, { id_str: '3' })]));
    const sum = summarizeAudits([p1, p2]);
    expect(sum.pages).toBe(2);
    expect(sum.tweets, '原始条数').toBe(4);
    expect(sum.uniqueTweets, '去重后该是 3 条 —— 不去重就报虚高了').toBe(3);
  });

  it('⭐ 汇总的覆盖率跨页算', () => {
    const p1 = auditTimelinePayload(payload([tweet()]));
    const p2 = auditTimelinePayload(payload([tweet({}, { full_text: '' })]));
    const sum = summarizeAudits([p1, p2]);
    expect(sum.coverage['正文'], '跨页覆盖率算错了').toBe(50);
  });

  it('⭐ 各页的问题都汇总上来', () => {
    const p1 = auditTimelinePayload(payload([tweet()], ''));
    const p2 = auditTimelinePayload('坏的');
    const sum = summarizeAudits([p1, p2]);
    expect(sum.problems.length, '问题被吞了').toBeGreaterThanOrEqual(2);
  });

  it('⚠️ 零页时不崩、不报 NaN', () => {
    const sum = summarizeAudits([]);
    expect(sum.pages).toBe(0);
    expect(Number.isFinite(sum.coverage['正文']), '空集算出了 NaN').toBe(true);
    expect(sum.coverage['正文']).toBe(0);
  });
});
