/**
 * 回复 / 引用走 **TimelineTweet**,不是 TimelineNotification。
 *
 * ⚠️ 2026-09-04 真机坐实:用户说「有一个回复过来了」,而面板显示
 *   「收到载荷 25 个 · 事件 0 条」—— 采集一直正常,是**解析看不见回复**。
 *
 *   X 只把**可聚合的反应**(赞/转/关注)做成 TimelineNotification;
 *   有实体推文可展示的(回复、提及、引用)直接投推文本身。
 *   真实首屏 22 条里 **9 条是 TimelineTweet**,第一版解析全跳过了 ——
 *   于是契约最需要的 reply/quote **从头到尾一条都没解析过**
 *   (不是入库改动引入的回归)。
 *
 * ⚠️ 第二个坑:**不能见 TimelineTweet 就收**。通知页也推「我参与的会话」,
 *   真实样本里就有 NetLab2GFW 回复 heibagou / dmfiv58749997 的推 ——
 *   那是「别人对别人」,收进来就是脏数据。判据必须是「指向我」。
 */

import { describe, it, expect } from 'vitest';
import { extractInteractions, type Interaction } from '@platform/main/x/x-notifications';

/** 仿真实载荷结构(字段路径取自真机 notif-*.json) */
function tweetEntry(opts: {
  restId: string; authorId: string; authorHandle: string;
  conversationId?: string; inReplyToScreenName?: string | null;
  quotedStatusId?: string | null; media?: boolean;
  /** 被引用推的作者 —— 缺省视为「我」(载荷里带 quoted_status_result) */
  quotedAuthor?: string;
}) {
  return {
    content: {
      itemContent: {
        __typename: 'TimelineTweet',
        tweet_results: {
          result: {
            rest_id: opts.restId,
            core: { user_results: { result: {
              rest_id: opts.authorId,
              core: { screen_name: opts.authorHandle },
            } } },
            legacy: {
              conversation_id_str: opts.conversationId ?? opts.restId,
              in_reply_to_screen_name: opts.inReplyToScreenName ?? undefined,
              quoted_status_id_str: opts.quotedStatusId ?? undefined,
              created_at: 'Wed Sep 02 13:48:49 +0000 2026',
              full_text: '正文',
              extended_entities: opts.media ? { media: [{ type: 'photo' }] } : undefined,
            },
            quoted_status_result: opts.quotedStatusId ? { result: {
              core: { user_results: { result: {
                core: { screen_name: opts.quotedAuthor ?? 'OTun_MyVPN' },
              } } },
            } } : undefined,
          },
        },
      },
    },
  };
}

const ME = 'otun_myvpn';

function run(payload: unknown, owner?: string): Interaction[] {
  const out: Interaction[] = [];
  extractInteractions(payload, out, owner);
  return out;
}

describe('TimelineTweet:回复与引用', () => {
  it('⭐ 别人回复我 → 解析成 reply(真机样本 ZirongF888 → OTun_MyVPN)', () => {
    const r = run(tweetEntry({
      restId: '2094723709621932310', authorId: '1997840752165228544',
      authorHandle: 'ZirongF888', conversationId: '2094561233781334399',
      inReplyToScreenName: 'OTun_MyVPN',
    }), ME);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('reply');
    expect(r[0].actorHandle).toBe('zirongf888');
    // 契约要的 tweet_id = 这条回复自己
    expect(r[0].targetId).toBe('2094723709621932310');
    expect(r[0].targetConversationId).toBe('2094561233781334399');
  });

  it('⭐ 别人引用我的推 → 解析成 quote(真机样本 NetLab2GFW 引用活动文章)', () => {
    const r = run(tweetEntry({
      restId: '2094379485902586346', authorId: '2011076877453332481',
      authorHandle: 'NetLab2GFW', quotedStatusId: '2092213139139854555',
    }), ME);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('quote');
    expect(r[0].targetQuotedStatusId).toBe('2092213139139854555');
  });

  it('⭐⭐ 别人回复**别人** → 一条都不能收(真机样本 NetLab2GFW → heibagou)', () => {
    // 这是最危险的一类:通知页会推「我参与的会话」,收进来就是脏数据
    const r = run(tweetEntry({
      restId: '2095146935220875297', authorId: '2011076877453332481',
      authorHandle: 'NetLab2GFW', inReplyToScreenName: 'heibagou',
    }), ME);
    expect(r).toHaveLength(0);
  });

  it('我自己发的推不算「别人对我」', () => {
    const r = run(tweetEntry({
      restId: '999', authorId: '111', authorHandle: 'OTun_MyVPN',
      inReplyToScreenName: 'OTun_MyVPN',
    }), ME);
    expect(r).toHaveLength(0);
  });

  it('没传 ownerHandle 时只收 quote,不猜 reply —— 宁可少收不可收错', () => {
    const replyOnly = tweetEntry({
      restId: '1', authorId: '2', authorHandle: 'someone',
      inReplyToScreenName: 'OTun_MyVPN',
    });
    expect(run(replyOnly, undefined)).toHaveLength(0);

    const quoted = tweetEntry({
      restId: '3', authorId: '4', authorHandle: 'someone',
      quotedStatusId: '2092213139139854555',
    });
    expect(run(quoted, undefined)).toHaveLength(1);
  });

  it('handle 比对不区分大小写(库里存归一化小写,X 给的是原样)', () => {
    const r = run(tweetEntry({
      restId: '5', authorId: '6', authorHandle: 'someone',
      inReplyToScreenName: 'OTun_MyVPN',      // X 给带大小写的
    }), 'otun_myvpn');                          // 我们存的是小写
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('reply');
  });

  it('带图的回复要标出 has_media(契约发奖励的硬条件)', () => {
    const r = run(tweetEntry({
      restId: '7', authorId: '8', authorHandle: 'someone',
      inReplyToScreenName: 'OTun_MyVPN', media: true,
    }), ME);
    expect(r[0].targetHasMedia).toBe(true);
  });

  it('⭐ 引用的是**第三方**的推 → 不能收(与我无关)', () => {
    // 「有 quoted_status_id 就算 quote」太松:那只说明引用了某人,不说明引用的是我。
    // 真机 8 条引用恰好全是引用我们的帖子,侥幸没暴露 —— 但门是开着的。
    const r = run(tweetEntry({
      restId: '10', authorId: '11', authorHandle: 'someone',
      quotedStatusId: '999', quotedAuthor: 'thirdparty',
    }), ME);
    expect(r).toHaveLength(0);
  });

  it('拿不到被引用推作者时保守放行(X 未展开引用对象的情况确实存在)', () => {
    const entry = tweetEntry({
      restId: '12', authorId: '13', authorHandle: 'someone',
      quotedStatusId: '888',
    }) as any;
    // 删掉 quoted_status_result,模拟 X 没展开
    delete entry.content.itemContent.tweet_results.result.quoted_status_result;
    const r = run(entry, ME);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('quote');
  });

  /**
   * 反向注入(feedback-verify-guard-can-fail):
   * 若「指向我」的判据被拿掉(见谁都收),那条「回复别人」的样本必须变红。
   */
  it('反向注入:不校验指向我时,会把「别人对别人」误收', () => {
    const brokenWouldCollect = 1;   // 掏空判据后的产出条数
    const actual = run(tweetEntry({
      restId: '2095146935220875297', authorId: '2011076877453332481',
      authorHandle: 'NetLab2GFW', inReplyToScreenName: 'heibagou',
    }), ME).length;
    expect(actual).not.toBe(brokenWouldCollect);
  });
});
