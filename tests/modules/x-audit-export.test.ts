/**
 * 核对报告导出 —— ⭐ **人和 AI 看同一份**
 *
 * 用户 2026-10-02:
 * 「我不知道你采的数据是否完整。显示这些采集的内容包括元数据,**我来一条条对**吧。」
 *
 * ⚠️ 它是**共同依据**:报告写错了,人和 AI 会一起判错。
 * ⭐ 所以本文件钉的是「有没有如实写出来」,不是「格式好不好看」。
 */

import { describe, it, expect } from 'vitest';
import { exportAuditText } from '@modules/x/x-audit-export';
import { auditTimelinePayload } from '@modules/x/x-timeline-audit';

function tweet(over: Record<string, unknown> = {}, legacyOver: Record<string, unknown> = {}) {
  return {
    rest_id: '111',
    views: { count: '999' },
    core: {
      user_results: {
        result: {
          rest_id: 'u1',
          core: { screen_name: 'someone', name: 'Some One' },
          avatar: { image_url: 'https://x/a.jpg' },
          is_blue_verified: true,
          relationship_perspectives: { following: true, followed_by: false },
          profile_bio: { description: '我的 bio' },
          legacy: { screen_name: 'someone', name: 'Some One' },
        },
      },
    },
    legacy: {
      id_str: '111', full_text: '这是正文', created_at: 'Wed Oct 01 12:00:00 +0000 2026',
      conversation_id_str: '111', lang: 'zh',
      favorite_count: 1, retweet_count: 2, reply_count: 3,
      quote_count: 4, bookmark_count: 5,
      favorited: true, retweeted: false, bookmarked: false,
      ...legacyOver,
    },
    ...over,
  };
}

const payload = (ts: unknown[], cursor = 'DAAB'): string => JSON.stringify({
  data: { home: { instructions: [{ entries: [
    ...ts.map((t, i) => ({ entryId: `t${i}`, content: { itemContent: { tweet_results: { result: t } } } })),
    ...(cursor ? [{ entryId: 'c', content: { value: cursor, cursorType: 'Bottom' } }] : []),
  ] }] } },
});

const meta = { pages: 1, totalResponses: 10 };

describe('⭐⭐ 22 个字段都要写出来', () => {
  const text = exportAuditText([auditTimelinePayload(payload([tweet()]))], meta);

  it('⭐⭐⭐ 每一个字段名都出现在报告里', () => {
    /**
     * ⚠️ 这是本文件最硬的一条:**少写一个字段,人就对不了那一项**,
     * 而且他**不会知道少了**(报告看起来完整)。
     * ⭐ 又是「不量的字段永远 100%」的变体 —— 不写的字段永远没问题。
     */
    for (const f of [
      '推文id', '正文', '作者', '显示名', '作者id', '头像', '作者bio',
      '蓝V', '我关注他', '他关注我', '发布时间', '语言', '会话id',
      '推文链接', '互动数', '我的操作', '媒体', '是回复', '引用推文',
    ]) {
      expect(text, `报告里少了「${f}」—— 人对不了这一项,而且不会知道少了`).toContain(f);
    }
  });

  it('⭐⭐ 互动数**六项逐个列**,不是一句「有」', () => {
    /** ⚠️ 「缺互动数」太笼统 —— 要知道缺的是哪一项 */
    expect(text).toContain('赞 1');
    expect(text).toContain('转 2');
    expect(text).toContain('评 3');
    expect(text).toContain('引用 4');
    expect(text).toContain('收藏 5');
    expect(text, 'views 没写出来').toContain('浏览 999');
    expect(text, '没写明几项齐了').toContain('6/6 项');
  });

  it('⭐ 正文内容要写出来 —— 人要能看出采到的是什么', () => {
    expect(text).toContain('这是正文');
  });

  it('⭐ 作者的具体值要写出来,不只是 ✓', () => {
    expect(text).toContain('@someone');
    expect(text).toContain('Some One');
    expect(text, '作者 id 没写值').toContain('u1');
    expect(text, 'bio 没写值').toContain('我的 bio');
  });
});

describe('⭐⭐⭐ 「不知道」与「没有」必须分开', () => {
  it('⭐⭐ 载荷没带关系 → 写「—（载荷没带）」,**不是「否」**', () => {
    /**
     * ⚠️⚠️ 这是最容易误导的一条:
     * 「我没关注他」与「载荷没告诉我关注没有」是两件事,
     * 混起来会让追踪名单判错人(旧实现原话)。
     */
    const t = tweet();
    const u = ((t.core as Record<string, unknown>).user_results as Record<string, unknown>)
      .result as Record<string, unknown>;
    delete u.relationship_perspectives;
    delete u.is_blue_verified;
    const text = exportAuditText([auditTimelinePayload(payload([t]))], meta);

    expect(text, '没带的被写成了「否」—— 会让人以为确实没关注').toContain('载荷没带');
    const line = text.split('\n').find((x) => x.includes('我关注他')) ?? '';
    expect(line, '「不知道」被写成了「否」').not.toMatch(/我关注他\s+否/);
  });

  it('⭐ 真的是 false 时写「否」 —— 别矫枉过正', () => {
    const text = exportAuditText([auditTimelinePayload(payload([tweet()]))], meta);
    const line = text.split('\n').find((x) => x.includes('他关注我')) ?? '';
    expect(line, 'followed_by=false 没写成「否」').toContain('否');
  });
});

describe('⭐⭐ 采集过程的事实也要写', () => {
  it('⭐⭐ 响应条数与推文条数都写 —— 否则分不清「采少了」还是「页面就这么多」', () => {
    const text = exportAuditText([auditTimelinePayload(payload([tweet()]))],
      { pages: 1, totalResponses: 76, rounds: 30, scrolledPx: 22266 });
    expect(text, '没写收到多少响应').toContain('76 条响应');
    expect(text, '没写解析出多少推文').toContain('1 条推文');
    expect(text, '没写滚动轮次 —— 「只有 1 条」就无从判断').toContain('30 轮');
  });

  it('⭐⭐ 翻页游标要写 —— 它回答「还能不能继续翻」', () => {
    const withCursor = exportAuditText([auditTimelinePayload(payload([tweet()], 'DAAB'))], meta);
    expect(withCursor).toContain('翻页游标：1/1');

    const noCursor = exportAuditText([auditTimelinePayload(payload([tweet()], ''))], meta);
    expect(noCursor, '没游标时没警告 —— 「翻不动」会被当成「到底了」').toContain('翻不动');
  });

  it('⭐ 去重 —— 两页之间会重叠', () => {
    const p1 = auditTimelinePayload(payload([tweet(), tweet({ rest_id: '2' }, { id_str: '2' })]));
    const p2 = auditTimelinePayload(payload([tweet({ rest_id: '2' }, { id_str: '2' })]));
    const text = exportAuditText([p1, p2], { pages: 2, totalResponses: 20 });
    expect(text, '没去重 —— 条数会报虚高').toContain('2 条推文');
  });
});

describe('⭐⭐ 不完整要**显眼**', () => {
  it('⭐⭐ 正文被截断 → 单独一行警告', () => {
    /** ⚠️ 旧实现:「没拿全」和「本来就这么短」在库里长得一模一样 */
    const t = tweet({}, { full_text: '开头…' });
    const text = exportAuditText([auditTimelinePayload(payload([t]))], meta);
    expect(text, '截断没被标出来').toContain('正文被截断');
  });

  it('⭐⭐ 长文没正文 → 单独一行警告', () => {
    const t = tweet({ article: { article_results: {} } });
    const text = exportAuditText([auditTimelinePayload(payload([t]))], meta);
    expect(text, '长文没正文没被标出来').toContain('长文没正文');
  });

  it('⚠️ 一条都没解出来时**明说**,不是交一份空报告', () => {
    const text = exportAuditText([auditTimelinePayload('{"data":{}}')], meta);
    expect(text, '空报告看起来像「采到了但都是空的」').toContain('一条推文都没解出来');
  });
});

/**
 * ⭐⭐⭐ 报告要能**自证** —— 2026-10-03
 *
 * 真机报告写着「⚠️⚠️ 正文被截断」,我却**拿不出它凭什么这么说**:
 * 原始载荷只在内存、跑完就没。回头一查那条是**误报**(链接卡片)。
 *
 * ⭐ 判据(用户 2026-10-02 立的):
 * 「下次验证能不能不靠人、只靠留下的东西说清楚」。
 */
describe('⭐⭐⭐ 判据要留痕:报告自己说清凭什么', () => {
  it('⭐⭐ 报了截断 → 连**依据**一起印', () => {
    const t = tweet({}, { full_text: '开头…' });
    const text = exportAuditText([auditTimelinePayload(payload([t]))], meta);
    expect(text, '报了截断却不说凭什么 —— 又要回头猜判据').toContain('截断判据');
    expect(text, '没印出是哪条判据命中').toContain('省略号');
  });

  it('⭐⭐ **没报**截断的也印依据 —— 成功路径也要留痕', () => {
    const text = exportAuditText([auditTimelinePayload(payload([tweet()]))], meta);
    expect(text, '只有出问题才留痕 —— 采集成功时依据照样蒸发').toContain('截断判据');
  });

  it('⭐⭐ 链接卡片 → 印出 t.co 的归属和展开地址(人一眼能核)', () => {
    const t = tweet({}, {
      full_text: '新人必备 跟上峰哥的节奏 https://t.co/4QMNIjlI8f',
      entities: {
        urls: [{ url: 'https://t.co/4QMNIjlI8f', expanded_url: 'https://example.com/landing' }],
      },
    });
    const text = exportAuditText([auditTimelinePayload(payload([t]))], meta);
    expect(text, '没印 t.co 归属 —— 判成卡片的依据读不出来').toContain('末尾t.co在entities.urls里=是');
    expect(text, '没印展开地址 —— 人没法核这到底是不是卡片').toContain('https://example.com/landing');
  });

  it('⭐ display_text_range 命中时印出区间和正文长度', () => {
    const t = tweet({}, { full_text: '这条正文很长但被砍了', display_text_range: [0, 4] });
    const text = exportAuditText([auditTimelinePayload(payload([t]))], meta);
    expect(text, '没印出 X 自己给的区间').toContain('display_text_range=[0,4]');
  });
});
