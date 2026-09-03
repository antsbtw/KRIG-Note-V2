/**
 * 守卫:通知页驱动的活动主循环。
 *
 * 用户 2026-09-03 拍板:「上线后重点关注的是 notification 这个页面,
 *   观察谁点赞,谁转发」「用户操作,后台有操作记录,就可以认可匹配了」
 * 并点出「回复和点赞那个文章,应该是可以找到对应的元数据的」——**对**,
 * 实测 target_objects 带完整推文对象,契约三要素一次全给。
 */
import { describe, it, expect } from 'vitest';
import { interactionsToContractItems } from '@platform/main/x/x-campaign-loop';
import { isRealInteraction } from '@platform/main/x/x-notifications';
import type { Interaction } from '@platform/main/x/x-notifications';

const ARTICLE = '2092213139139854555';

function ix(over: Partial<Interaction>): Interaction {
  return {
    kind: 'reply', actorUid: '444', actorHandle: 'someuser',
    targetId: 't1', targetConversationId: ARTICLE,
    targetHasMedia: true, targetCreatedAt: '2026-09-05T08:12:33.000Z',
    ...over,
  };
}

describe('推荐流过滤', () => {
  it('⭐ recommendation_icon 不是互动(实测 16 条里 13 条是推荐)', () => {
    expect(isRealInteraction('recommendation_icon', 'Recent post from X')).toBe(false);
  });
  it('heart_icon 是互动', () => {
    expect(isRealInteraction('heart_icon', 'X liked your reply')).toBe(true);
  });
  it('report/announcement 等系统通知也不是互动', () => {
    expect(isRealInteraction('report_icon')).toBe(false);
  });

  it('⭐ 推荐流的文案里含 liked/reposted 也不算互动(显式过滤必须先于文案兜底)', () => {
    // 这是 icon 过滤真正不可省的地方:文案兜底会把「X liked something」
    // 这类推荐误判成 like。仅靠 kind==='other' 挡不住。
    expect(isRealInteraction('recommendation_icon', 'X liked something')).toBe(false);
    expect(isRealInteraction('recommendation_icon', 'someone reposted a post')).toBe(false);
  });
});

describe('通知 → 契约 item', () => {
  it('⭐ 回复且属于该文章 → 产出 item', () => {
    const r = interactionsToContractItems([ix({})], ARTICLE);
    expect(r).toHaveLength(1);
    expect(r[0].tweet_id).toBe('t1');
    expect(r[0].x_uid).toBe('444');
  });

  it('⭐ has_media 取自被操作推自己(契约的发奖励硬条件)', () => {
    expect(interactionsToContractItems([ix({ targetHasMedia: true })], ARTICLE)[0].has_media).toBe(true);
    expect(interactionsToContractItems([ix({ targetHasMedia: false })], ARTICLE)[0].has_media).toBe(false);
    // undefined 必须当 false,不能当真(宁可漏发也不误发)
    expect(interactionsToContractItems([ix({ targetHasMedia: undefined })], ARTICLE)[0].has_media).toBe(false);
  });

  it('⭐ 点赞/关注不算「留言」—— 契约 §4 只认 reply/quote', () => {
    expect(interactionsToContractItems([ix({ kind: 'like' })], ARTICLE)).toHaveLength(0);
    expect(interactionsToContractItems([ix({ kind: 'follow' })], ARTICLE)).toHaveLength(0);
  });

  it('⭐ 不属于该文章的整条排除(靠 conversation_id 归属)', () => {
    expect(interactionsToContractItems([ix({ targetConversationId: 'other' })], ARTICLE)).toHaveLength(0);
    expect(interactionsToContractItems([ix({ targetConversationId: undefined })], ARTICLE)).toHaveLength(0);
  });

  it('引用 → kind=quote', () => {
    expect(interactionsToContractItems([ix({ kind: 'quote' })], ARTICLE)[0].kind).toBe('quote');
  });

  it('契约必填缺失就跳过', () => {
    expect(interactionsToContractItems([ix({ actorHandle: undefined })], ARTICLE)).toHaveLength(0);
    expect(interactionsToContractItems([ix({ targetCreatedAt: undefined })], ARTICLE)).toHaveLength(0);
  });
});
