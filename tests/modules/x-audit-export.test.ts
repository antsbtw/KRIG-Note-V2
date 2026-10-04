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

/**
 * ⭐⭐ 长文缺口要**可行动** —— 2026-10-03
 *
 * 真机 40 条里 38 条长文没正文。旧报告只在每条底下各标一句,
 * 散在 40 条中间看不出规模,也看不出「接下来去哪取」。
 */
describe('⭐⭐ 长文缺口:报规模,也报去处', () => {
  const articleTweet = (id: string, aid: string): ReturnType<typeof tweet> => tweet(
    { rest_id: id, article: { article_results: { result: { title: 't' } } } },
    {
      id_str: id,
      full_text: 'https://t.co/x' + id,
      entities: {
        urls: [{ url: 'https://t.co/x' + id, expanded_url: `https://x.com/i/article/${aid}` }],
      },
    },
  );

  it('⭐⭐ 汇总报「缺几篇、其中几篇有地址」', () => {
    const text = exportAuditText(
      [auditTimelinePayload(payload([articleTweet('1', '91'), articleTweet('2', '92')]))],
      meta,
    );
    expect(text, '没报长文缺口的规模 —— 38 条散着看不出来').toContain('长文正文缺 2 篇');
    expect(text, '没报有几篇能补').toContain('2 篇载荷给了地址');
  });

  it('⭐⭐ 地址逐条列出来 —— 下一步直接照着取', () => {
    const text = exportAuditText([auditTimelinePayload(payload([articleTweet('1', '91')]))], meta);
    expect(text, '没列出长文地址').toContain('https://x.com/i/article/91');
  });

  it('⭐⭐ 每条底下也写「正文去处」', () => {
    const text = exportAuditText([auditTimelinePayload(payload([articleTweet('1', '91')]))], meta);
    expect(text, '条目里没写去哪取').toContain('正文去处');
  });

  /**
   * ⚠️⚠️ **补不了的要单独数出来** —— 否则「有地址的补完了」
   * 会被当成「全补完了」(`project-x-article-body-lost`:
   * 不量的字段永远 100%)。
   */
  it('⚠️⚠️ 有长文没地址时**明说补不了**,不混进「有地址」里', () => {
    const noUrl = tweet(
      { rest_id: '3', article: { article_results: { result: {} } } },
      { id_str: '3', full_text: '标题' },
    );
    const text = exportAuditText(
      [auditTimelinePayload(payload([articleTweet('1', '91'), noUrl]))],
      meta,
    );
    expect(text).toContain('长文正文缺 2 篇');
    expect(text, '没地址的那篇被算进「可取」里 —— 补完了会假报 100%').toContain('1 篇载荷给了地址');
    expect(text, '没明说有几篇补不了').toContain('1 篇**没地址,补不了**');
  });
});

/**
 * ⭐⭐ 「为什么停的」 —— 2026-10-03
 *
 * 真机:滚 **60 轮(到上限)** 只拿到 2 页载荷,而那是个 6138 条的账号。
 * 报告当时只写「滚动 60 轮 41847px」——「到上限停」和「滚到底停」
 * 读起来**一模一样**,差别要我自己去算才看得出来。
 */
describe('⭐⭐ 停止原因:到上限 vs 到底', () => {
  it('⭐⭐ 没滚到底 → **明说还有内容没采到**', () => {
    const text = exportAuditText([auditTimelinePayload(payload([tweet()]))], {
      ...meta, rounds: 60, scrolledPx: 41847,
      reachedBottom: false, stopReason: '到轮次上限 60',
    });
    expect(text, '没写停止原因').toContain('到轮次上限 60');
    expect(text, '没滚到底却不提醒 —— 40 条会被当成「这账号就这些」').toContain('没滚到底');
  });

  it('⭐ 滚到底 → 写「已到底」,不发没必要的警告', () => {
    const text = exportAuditText([auditTimelinePayload(payload([tweet()]))], {
      ...meta, rounds: 12, reachedBottom: true, stopReason: '已到底',
    });
    expect(text).toContain('已到底');
    expect(text, '到底了还喊「没滚到底」—— 狼来了').not.toContain('没滚到底');
  });

  it('⚠️ 没给停止原因时不编一个 —— 整行不出现', () => {
    const text = exportAuditText([auditTimelinePayload(payload([tweet()]))], meta);
    expect(text, '没给却印了停止原因').not.toContain('停止原因');
  });
});

/**
 * ⭐⭐⭐ 报告与面板**必须说同一件事** —— 2026-10-04 真机
 *
 * 那一跑:面板说「取回长文正文 36/38」「第 3 条 4072 字」,
 * 报告说「第 3 条 23 字、长文没正文」「长文正文缺 94 篇」——
 * **36 篇正文取回来了,报告里一篇都看不见**。
 *
 * ⚠️⚠️ 真因:`exportAuditText` 里有**第三份**去重实现(「保留先出现的」)。
 * 我把 `summarizeAudits` 改成「留更全的那份」时**它没跟上**。
 * ⭐ 又是「两处做同一件事必漂」—— 修法是换信息来源,不是把第三份也改一遍。
 */
describe('⭐⭐⭐ 报告的去重 = summarizeAudits 的去重', () => {
  const art = (cs: unknown): string => JSON.stringify({
    data: { tweetResult: { result: {
      rest_id: '777',
      legacy: { id_str: '777', full_text: 'https://t.co/x' },
      article: { article_results: { result: { title: 'T', content_state: cs } } },
      core: { user_results: { result: { legacy: { screen_name: 'a' } } } },
    } } },
  });
  const listPage = art(undefined);
  const fullPage = art({ blocks: [{ text: '正文'.repeat(80), type: 'unstyled' }] });

  it('⭐⭐⭐ 补回来的正文**要出现在报告里**,不是只在面板上', () => {
    const text = exportAuditText(
      [auditTimelinePayload(listPage), auditTimelinePayload(fullPage)],
      meta,
    );
    expect(text, '报告还说这条长文没正文 —— 跑完 36 篇报告里看不见').not.toContain('长文没正文');
    expect(text, '报告里还是 23 字那份').not.toContain('✓ 23 字');
  });

  it('⭐⭐ 汇总也不该再报它缺 —— 「缺 94 篇」就是这么来的', () => {
    const text = exportAuditText(
      [auditTimelinePayload(listPage), auditTimelinePayload(fullPage)],
      meta,
    );
    expect(text, '补回来了还报缺').not.toContain('长文正文缺');
  });

  it('⭐ 顺序反过来结论一样 —— 不是靠「后面覆盖前面」', () => {
    const text = exportAuditText(
      [auditTimelinePayload(fullPage), auditTimelinePayload(listPage)],
      meta,
    );
    expect(text, '浅的那份把深的盖掉了').not.toContain('长文没正文');
  });
});
