/**
 * 守卫:引用转发的归属。
 *
 * 用户 2026-09-03 一句「我觉得转发后,文章没有内容,应该只有一个链接」
 * 点破了一类**整体漏判**:
 *
 * 引用转发某篇文章时,那条推:
 *   full_text        = 'https://t.co/xxx'        ← 正文只有一个链接
 *   conversation_id  = 它自己所在的会话           ← **不是**被引用的文章
 *   quoted_status_id = 被引用的文章 id            ← 关联藏在这里
 *
 * 只按 target_id / conversation_id 归属,会把「引用转发」整类判成
 * 「不属于本文章」—— 而这恰恰是活动最常见的参与形式。
 * 实测:该判据补上后,核验名单从 0 条变成 2 条。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractInteractions, type Interaction } from '@platform/main/x/x-notifications';
import { interactionsToContractItems } from '@platform/main/x/x-campaign-loop';

const repo = readFileSync(
  resolve(__dirname, '../../src/platform/main/db/x-campaign-repo.ts'), 'utf-8');

const ARTICLE = '2092213139139854555';

/** 仿真实测结构:引用转发那篇文章的推 */
const quotePayload = { x: {
  __typename: 'TimelineNotification',
  notification_icon: 'retweet_icon',
  rich_message: { text: 'KRIG Note reposted 2 of your posts' },
  timestamp_ms: '2026-09-03T10:00:00.000Z',
  template: {
    from_users: [{ user_results: { result: { rest_id: 'u1', core: { screen_name: 'netlab2gfw' } } } }],
    target_objects: [{ tweet_results: { result: {
      rest_id: '2092213581563465730',
      legacy: {
        full_text: 'https://t.co/9hzfb4VND7',
        conversation_id_str: '2092069228715094394',   // 自己的会话,不是文章
        quoted_status_id_str: ARTICLE,                 // 文章在这里
        created_at: 'Wed Sep 02 10:00:00 +0000 2026',
        is_quote_status: true,
      },
    } } }],
  },
} };

describe('引用转发归属', () => {
  it('⭐ 解析必须带出 quoted_status_id', () => {
    const out: Interaction[] = [];
    extractInteractions(quotePayload, out);
    expect(out).toHaveLength(1);
    expect(out[0].targetQuotedStatusId, '漏了它,引用转发整类都会归属失败').toBe(ARTICLE);
  });

  it('⭐ conversation_id 确实不等于文章(所以不能只靠它归属)', () => {
    const out: Interaction[] = [];
    extractInteractions(quotePayload, out);
    expect(out[0].targetConversationId).not.toBe(ARTICLE);
    expect(out[0].targetId).not.toBe(ARTICLE);
  });

  it('⭐ 归属查询必须包含 quoted_status_id 这条判据', () => {
    const fn = repo.slice(repo.indexOf('export async function verifyListForArticle'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
    expect(body).toContain('target_quoted_status_id = $a');
    // 三条判据缺一不可
    expect(body).toContain('target_id = $a');
    expect(body).toContain('target_conversation_id = $a');
  });

  it('落库必须写入 quoted_status_id(解出来却不存等于没解)', () => {
    expect(repo).toContain('target_quoted_status_id = $quoted');
  });
});

describe('防错配', () => {
  it('⭐ 归属必须逐条给出原因,不能只给人名', () => {
    // 用户 2026-09-03:「关键要搞清楚点赞那个推文,不要再出现类似的错配」
    // 没有原因就无法核对,错配会静默混进名单。
    const fn = repo.slice(repo.indexOf('export async function verifyListForArticle'));
    const body = fn.slice(0, fn.indexOf('\n}\n') + 1);
    expect(body).toContain('why');
    for (const reason of ['直接对文章', '引用转发', '会话内回复']) {
      expect(body, `归属原因缺少「${reason}」`).toContain(reason);
    }
  });

  it('⭐ 不属于本文章的互动一律不进名单(三条判据都不命中即排除)', () => {
    const other = { x: {
      __typename: 'TimelineNotification',
      notification_icon: 'heart_icon',
      rich_message: { text: 'someone liked your post' },
      template: {
        from_users: [{ user_results: { result: { rest_id: 'u2', core: { screen_name: 'bob' } } } }],
        target_objects: [{ tweet_results: { result: {
          rest_id: '9999999999999999999',
          legacy: { full_text: '别的推', conversation_id_str: '8888888888888888888',
            created_at: 'Wed Sep 02 10:00:00 +0000 2026' },
        } } }],
      },
    } };
    const out: Interaction[] = [];
    extractInteractions(other, out);
    expect(out).toHaveLength(1);
    const i = out[0];
    const belongs = i.targetId === ARTICLE || i.targetConversationId === ARTICLE
      || i.targetQuotedStatusId === ARTICLE;
    expect(belongs, '与本文章无关的互动不得算进来').toBe(false);
  });
});

/**
 * ⚠️ 2026-09-04 真机漏判:上面的用例守住了「解析」和「查询」两层,
 *   却没人守 **契约转换层**(interactionsToContractItems)——
 *   那里只写了 `targetConversationId !== articleId` 一条判据,
 *   于是引用转发整类进不了 x_campaign_reply。
 *
 *   现象极具迷惑性:面板显示「✓ 引用转发」(judgeBelongs 用三判据)、
 *   x_interaction 里也有,唯独契约表收不到 —— **判定与落库两套标准**。
 *   实例:推 2095912671543456158 引用文章 2095910972506427676,
 *         conv = 自己,q = 文章。
 */
describe('契约转换层的归属(与 judgeBelongs 必须同一套判据)', () => {
  const ART = '2095910972506427676';
  const base = {
    actorUid: 'u1', actorHandle: 'netlab2gfw',
    targetCreatedAt: '2026-09-04T16:31:00.000Z', targetText: '正文',
  };

  it('⭐ 引用转发:conv 是自己、quoted 才是文章 → 必须进契约', () => {
    const items = interactionsToContractItems([{
      ...base, kind: 'quote',
      targetId: '2095912671543456158',
      targetConversationId: '2095912671543456158',   // 自己的会话
      targetQuotedStatusId: ART,                      // 文章在这里
    }], ART);
    expect(items, '只认 conversation_id 会把引用转发整类丢掉').toHaveLength(1);
    expect(items[0].kind).toBe('quote');
    expect(items[0].tweet_id).toBe('2095912671543456158');
  });

  it('会话内回复照旧进契约', () => {
    const items = interactionsToContractItems([{
      ...base, kind: 'reply',
      targetId: '2095692212638032207', targetConversationId: ART,
    }], ART);
    expect(items).toHaveLength(1);
  });

  it('直接对文章的回复也算', () => {
    const items = interactionsToContractItems([{
      ...base, kind: 'reply', targetId: ART, targetConversationId: 'other',
    }], ART);
    expect(items).toHaveLength(1);
  });

  it('⭐ 三条判据都不命中 → 一条都不能进', () => {
    const items = interactionsToContractItems([{
      ...base, kind: 'reply',
      targetId: 'x', targetConversationId: 'y', targetQuotedStatusId: 'z',
    }], ART);
    expect(items).toHaveLength(0);
  });

  it('点赞/转发不是「留言」,再命中也不进契约(契约 §2.1 kind 只收 reply/quote)', () => {
    const items = interactionsToContractItems([
      { ...base, kind: 'like', targetId: ART, targetConversationId: ART },
      { ...base, kind: 'retweet', targetId: ART, targetConversationId: ART },
    ], ART);
    expect(items).toHaveLength(0);
  });
});
