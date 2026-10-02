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

/**
 * 造一条**形状贴近真实**的推文节点。
 *
 * ⚠️⚠️ 2026-10-02 重写:原来只有 8 个字段,那是**我挑的**。
 * 查旧实现 `x-timeline-harvester.ts`(1871 行)与 `x_tweet` 表 schema 后,
 * 真实载荷有 22 项 —— 样本必须贴近真实,否则
 * 「字段缺了量不量得出来」这类测试**根本测不到**
 * (`feedback-check-sample-contains-phenomenon`)。
 *
 * ⭐ 尤其是这几个**两个位置**的:显示名 / 头像 / 蓝V / 关系 / bio ——
 * 旧实现踩过「只读一个位置会漏」,样本里两边都给才试得出来。
 */
function tweet(over: Record<string, unknown> = {}, legacyOver: Record<string, unknown> = {}) {
  return {
    __typename: 'Tweet',
    rest_id: '1234567890',
    views: { count: '1234', state: 'EnabledWithCount' },
    core: {
      user_results: {
        result: {
          rest_id: '111',
          // ⭐ 新形态:core.screen_name / core.name / avatar.image_url
          core: { screen_name: 'someone', name: 'Some One' },
          avatar: { image_url: 'https://pbs.twimg.com/a_normal.jpg' },
          is_blue_verified: true,
          relationship_perspectives: { following: false, followed_by: true },
          profile_bio: { description: '一段 bio' },
          // 旧形态同时给(真实载荷里两种都可能出现)
          legacy: { screen_name: 'someone', name: 'Some One' },
        },
      },
    },
    legacy: {
      id_str: '1234567890',
      full_text: 'hello world',
      created_at: 'Wed Oct 01 12:00:00 +0000 2026',
      conversation_id_str: '1234567890',
      lang: 'zh',
      favorite_count: 3,
      retweet_count: 1,
      reply_count: 0,
      quote_count: 2,
      bookmark_count: 5,
      favorited: false,
      retweeted: false,
      bookmarked: true,
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
    for (const k of ['正文', '作者', '作者id', '显示名', '头像', '发布时间',
      '语言', '互动数', '会话id', '推文链接', '蓝V', '关系', '作者bio']) {
      expect(a.coverage[k], `${k} 没量到 100%`).toBe(100);
    }
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

  it('⭐⭐ 互动数**六项都要齐** —— 缺一项就看得见', () => {
    /**
     * ⭐ 旧实现取六项:likes/retweets/replies/quotes/bookmarks/views。
     * ⚠️ 只量「有没有互动数」的话,缺了 quotes/bookmarks/views 照样报 100% ——
     * 又一次「不量的字段永远 100%」。
     */
    const t = tweet({ views: undefined }, { quote_count: undefined, bookmark_count: undefined });
    const a = auditTimelinePayload(payload([t, tweet()]));
    expect(a.coverage['互动数'], '缺了三项却报满').toBe(50);
    expect(a.items[0].metricsCount, '没数清缺了几项').toBe(3);
  });

  it('⭐⭐ `views.count` 是**字符串** —— 要转成数字', () => {
    /** ⚠️ 旧实现专门记着这条:「views.count 是字符串,state=Enabled 时没有数字」 */
    const a = auditTimelinePayload(payload([tweet()]));
    expect(a.items[0].metrics.views, 'views 没解出来').toBe(1234);
  });

  it('⭐⭐ 作者的**两个位置**都要看(新/旧形态)', () => {
    /**
     * ⚠️ 旧实现踩过:只读一个位置 → tweet_url 77% 空、author_avatar 80% 空。
     */
    const onlyLegacy = tweet();
    const u = ((onlyLegacy.core as Record<string, unknown>).user_results as Record<string, unknown>)
      .result as Record<string, unknown>;
    delete u.core; delete u.avatar;
    (u.legacy as Record<string, unknown>).profile_image_url_https = 'https://x/a.jpg';
    const a = auditTimelinePayload(payload([onlyLegacy]));
    expect(a.items[0].handle, '旧形态的 handle 没读到').toBe('someone');
    expect(a.items[0].authorName, '旧形态的显示名没读到').toBe('Some One');
    expect(a.items[0].hasAvatar, '旧形态的头像没读到').toBe(true);
  });

  it('⭐⭐ 蓝V/关系/bio 的**第二个位置**也要读', () => {
    /**
     * ⚠️⚠️ 注入验证抓到:我的样本**两个位置都给了蓝V**,
     * 所以「只读一个位置」的实现**照样全绿** ——
     * 样本里根本没有「只有第二个位置有」这个现象
     * (`feedback-check-sample-contains-phenomenon`,今天第三次栽)。
     *
     * ⭐ 旧实现原话:「只读一个会漏 —— 那正是 x_author 里蓝V只有 2% 的成因之一」。
     * ⭐ 真能区分的样本:**只给第二个位置**(verification.is_blue_verified)。
     */
    const onlySecond = tweet();
    const u = ((onlySecond.core as Record<string, unknown>).user_results as Record<string, unknown>)
      .result as Record<string, unknown>;
    delete u.is_blue_verified;                       // 第一个位置拿掉
    u.verification = { is_blue_verified: true };     // 只剩第二个
    delete u.relationship_perspectives;              // 关系也只留旧形态
    (u.legacy as Record<string, unknown>).following = true;
    delete u.profile_bio;                            // bio 也只留旧形态
    (u.legacy as Record<string, unknown>).description = '旧形态 bio';

    const a = auditTimelinePayload(payload([onlySecond]));
    expect(a.items[0].isBlueVerified, '只读第一个位置 —— 蓝V 会漏掉').toBe(true);
    expect(a.items[0].iFollow, '关系只读新形态 —— 旧形态会漏').toBe(true);
    expect(a.items[0].authorBio, 'bio 只读新形态 —— 旧形态会漏').toBe('旧形态 bio');
  });

  it('⭐ 带了就有值,**没带是 undefined 不是 false**', () => {
    /** ⚠️ 「没关注」与「不知道关注没」是两件事,混起来会让追踪名单判错人 */
    const a = auditTimelinePayload(payload([tweet()]));
    expect(a.items[0].isBlueVerified).toBe(true);
    expect(a.items[0].iFollow).toBe(false);
    expect(a.items[0].followsMe).toBe(true);
    expect(a.items[0].authorBio).toBe('一段 bio');

    const bare = tweet();
    const u2 = ((bare.core as Record<string, unknown>).user_results as Record<string, unknown>)
      .result as Record<string, unknown>;
    delete u2.is_blue_verified; delete u2.relationship_perspectives; delete u2.profile_bio;
    delete (u2.legacy as Record<string, unknown>).following;
    const b = auditTimelinePayload(payload([bare]));
    expect(b.items[0].iFollow, '没带关系却兜底成了 false').toBeUndefined();
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
    const pureArticle = tweet(
      { rest_id: '2', article: { article_results: { result: { content_state: { x: 1 } } } } },
      { id_str: '2' },
    );
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

/**
 * ⭐⭐⭐ **逐条明细** —— 用户 2026-10-02:
 * 「对于推文中的**数据是否完整**没有显示哦。」
 *
 * ⚠️ 只给覆盖率百分比的话,人不知道**哪几条**不完整、缺的是什么,
 * 也不知道采到的到底是什么内容。
 */
describe('⭐⭐⭐ 「数据是否完整」要逐条说清', () => {
  it('⭐⭐ 每条带**正文开头** —— 一眼看出采到的是什么', () => {
    const t = tweet({}, { full_text: '这是一条很长的推文内容'.repeat(20) });
    const a = auditTimelinePayload(payload([t]));
    expect(a.items[0].preview.length, '没有正文摘要 —— 人看不出采到了什么')
      .toBeGreaterThan(0);
    expect(a.items[0].preview.length, '摘要太长会把面板撑爆').toBeLessThanOrEqual(80);
  });

  it('⚠️ 摘要里的换行要去掉 —— 否则面板布局撑开', () => {
    const a = auditTimelinePayload(payload([tweet({}, { full_text: 'a\nb\n\nc' })]));
    expect(a.items[0].preview, '换行没去掉').toBe('a b c');
  });

  it('⭐⭐⭐ `incomplete` 逐条列出**缺了什么**', () => {
    const bad = tweet({}, { full_text: '', conversation_id_str: undefined });
    const good = tweet({ rest_id: '2' }, { id_str: '2' });
    const sum = summarizeAudits([auditTimelinePayload(payload([bad, good]))]);

    expect(sum.incomplete.length, '没列出有缺失的那条').toBe(1);
    expect(sum.incomplete[0].missing.join(), '缺的字段没说清').toContain('正文');
    expect(sum.incomplete[0].missing.join()).toContain('会话id');
    // ⭐ 完好的那条不该进来
    expect(sum.incomplete.some((x) => x.audit.id === '2'), '完好的被当成了有缺失').toBe(false);
  });

  it('⚠️ 长推/长文**不算缺失** —— 它们是种类不是必备字段', () => {
    /** ⭐ 否则普通推文会被全部报成「缺长推、缺长文」—— 噪音淹掉真问题 */
    const sum = summarizeAudits([auditTimelinePayload(payload([tweet()]))]);
    expect(sum.incomplete, '普通推文被报成有缺失').toEqual([]);
  });

  it('⭐⭐ `items` 带回**去重后**的全部明细', () => {
    const p1 = auditTimelinePayload(payload([tweet(), tweet({ rest_id: '2' }, { id_str: '2' })]));
    const p2 = auditTimelinePayload(payload([tweet({ rest_id: '2' }, { id_str: '2' }),
      tweet({ rest_id: '3' }, { id_str: '3' })]));
    const sum = summarizeAudits([p1, p2]);
    expect(sum.items.length, '明细没去重 —— 两页之间会重叠').toBe(3);
    expect(sum.items.map((x) => x.id).sort()).toEqual(['1234567890', '2', '3']);
  });

  it('⭐ 明细里带 handle 与字数 —— 判断「这条对不对」用得上', () => {
    const sum = summarizeAudits([auditTimelinePayload(payload([tweet()]))]);
    expect(sum.items[0].handle, '没带作者').toBe('someone');
    expect(sum.items[0].textLen, '没带字数').toBeGreaterThan(0);
  });

  it('⚠️ 零条时 incomplete 与 items 都是空数组,不是 undefined', () => {
    const sum = summarizeAudits([]);
    expect(sum.items).toEqual([]);
    expect(sum.incomplete).toEqual([]);
  });
});
