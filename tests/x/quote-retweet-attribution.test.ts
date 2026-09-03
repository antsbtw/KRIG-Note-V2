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
