/**
 * ⭐⭐⭐ 研判层 —— **只研判不执行**
 *
 * 用户 2026-10-03 定的逻辑(原话):
 * 「先 tweetid,然后**研判**这个推文是需要 showall 还是需要点击进入 article,
 * 　最后**根据业务的要求**来执行是否要获取全部内容。」
 * 「是否需要逐层获取,**根据采集的要求定下来**就可以了。」
 */
import { describe, it, expect } from 'vitest';
import {
  judgeTweet, decideFetch,
  type TweetNeed,
} from '@modules/x/x-fetch-plan';
import type { TweetAudit } from '@modules/x/x-timeline-audit';

/** ⭐ 只造研判要看的字段 —— 其余用默认,免得测试被无关字段绑住 */
const audit = (p: Partial<TweetAudit>): TweetAudit => ({
  id: '1', preview: '', hasText: true, textLen: 10,
  isLongText: false, isArticle: false,
  hasAuthor: true, handle: 'a', authorRestId: '1', authorName: 'A', hasAvatar: true,
  hasCreatedAt: true, lang: 'zh', metrics: {}, hasConversationId: true, hasTweetUrl: true,
  isBlueVerified: false, hasMedia: false, mediaTypes: [], isReply: false,
  ...p,
} as TweetAudit);

describe('⭐⭐⭐ 研判:这条推缺什么、补它走哪条路', () => {
  it('⭐ 正文完整 → 什么都不用做', () => {
    const n = judgeTweet(audit({}));
    expect(n.level).toBe('complete');
    expect(n.route.kind).toBe('none');
    expect(n.why, '没留理由 —— 成功路径也要留痕').toBeTruthy();
  });

  it('⭐⭐ 正文被折叠 → **当前页展开**,不离开页面', () => {
    const n = judgeTweet(audit({ incomplete: 'text-truncated' }));
    expect(n.level).toBe('collapsed');
    expect(n.route.kind, '折叠的推被判成要进详情页 —— 代价白白大一档')
      .toBe('expand-in-place');
  });

  it('⭐⭐⭐ 长文缺正文 → **进单篇页**,并带上地址', () => {
    const n = judgeTweet(audit({
      isArticle: true, incomplete: 'article-no-body',
      articleUrl: 'https://x.com/i/article/999',
    }));
    expect(n.level).toBe('article-stub');
    expect(n.route.kind).toBe('open-article');
    expect(
      n.route.kind === 'open-article' ? n.route.url : '',
      '没带地址 —— 上层就只能自己猜 URL 了',
    ).toBe('https://x.com/i/article/999');
  });

  it('⭐⭐ 长文正文已到手 → 不用再跑一趟', () => {
    const n = judgeTweet(audit({ isArticle: true }));
    expect(n.level).toBe('article-full');
    expect(n.route.kind).toBe('none');
  });

  /**
   * ⚠️⚠️ 长文**没有地址**时不许退化成「当前页展开」——
   * 列表页展开拿不到长文正文,那只会「跑了一趟、看着做了事、正文还是没有」。
   */
  it('⚠️⚠️ 长文没地址 → 说**补不了**,不退化成展开', () => {
    const n = judgeTweet(audit({ isArticle: true, incomplete: 'article-no-body' }));
    expect(n.route.kind, '退化成了展开 —— 白跑一趟还以为补上了').not.toBe('expand-in-place');
    expect(n.route.kind).toBe('none');
    expect(n.level, '被当成「不缺」了 —— 缺口会从报告里消失').toBe('article-stub');
    expect(n.why).toContain('补不了');
  });

  /**
   * ⚠️ 一条推可以**既是长文又带截断标记**。
   * 那种情况必须判成「进单篇页」—— 在列表页展开照样没有正文。
   */
  it('⚠️ 长文 + 截断标记 → 仍判「进单篇页」(长文先判)', () => {
    const n = judgeTweet(audit({
      isArticle: true, incomplete: 'article-no-body',
      articleUrl: 'https://x.com/i/article/7',
    }));
    expect(n.route.kind, '判成了当前页展开 —— 长文正文不在这一页').toBe('open-article');
  });
});

/**
 * ⭐⭐⭐ 执行与否**由采集要求定** —— 不由代码定。
 * 「有的采集只要标题和互动数,进 38 篇详情页纯属浪费」。
 */
describe('⭐⭐⭐ 采集要求决定补到哪一层', () => {
  const needs: TweetNeed[] = [
    judgeTweet(audit({ id: 'ok' })),
    judgeTweet(audit({ id: 'fold', incomplete: 'text-truncated' })),
    judgeTweet(audit({
      id: 'art', isArticle: true, incomplete: 'article-no-body',
      articleUrl: 'https://x.com/i/article/9',
    })),
    judgeTweet(audit({ id: 'noUrl', isArticle: true, incomplete: 'article-no-body' })),
  ];

  it('⭐ as-is:一个都不补(最快)', () => {
    const d = decideFetch(needs, 'as-is');
    expect(d.todo, 'as-is 还去补 —— 那就不是 as-is 了').toEqual([]);
    expect(d.skipped.map((n) => n.id), '缺的没被如实列出来').toEqual(['fold', 'art']);
  });

  it('⭐⭐ expand-only:只展开,**不进**单篇页', () => {
    const d = decideFetch(needs, 'expand-only');
    expect(d.todo.map((n) => n.id)).toEqual(['fold']);
    expect(
      d.skipped.map((n) => n.id),
      '长文被偷偷补了 —— expand-only 不该离开页面',
    ).toEqual(['art']);
  });

  it('⭐⭐ full:展开 + 进单篇页都做', () => {
    const d = decideFetch(needs, 'full');
    expect(d.todo.map((n) => n.id)).toEqual(['fold', 'art']);
    expect(d.skipped).toEqual([]);
  });

  /**
   * ⚠️⚠️ 「本次不补」**不等于**「不缺」。
   * 混起来报告就会说「全都齐了」—— 那是
   * `project-x-article-body-lost` 的「不量的字段永远 100%」。
   */
  it('⚠️⚠️ 被深度挡下的要进 skipped,**不许当成不缺**', () => {
    const d = decideFetch(needs, 'as-is');
    expect(d.skipped.length, '挡下来的没留痕 —— 报告会显得「全齐了」').toBe(2);
    for (const n of d.skipped) {
      expect(n.level, 'skipped 里混进了本来就完整的').not.toBe('complete');
    }
  });

  /** ⚠️⚠️ **补不了的**要单独一类 —— 它与「这次不补」是两件事 */
  it('⚠️⚠️ 补不了的单独归类,不混进 skipped 也不混进「已完整」', () => {
    for (const depth of ['as-is', 'expand-only', 'full'] as const) {
      const d = decideFetch(needs, depth);
      expect(d.impossible.map((n) => n.id), `${depth}: 补不了的没单独报`).toEqual(['noUrl']);
      expect(d.skipped.map((n) => n.id), `${depth}: 补不了的混进了 skipped`).not.toContain('noUrl');
      expect(d.todo.map((n) => n.id), `${depth}: 补不了的混进了 todo —— 会白跑一趟`).not.toContain('noUrl');
    }
  });

  it('⭐ 三类加起来 = 所有缺的 —— 不许有推文凭空消失', () => {
    const d = decideFetch(needs, 'expand-only');
    const accounted = [...d.todo, ...d.skipped, ...d.impossible].map((n) => n.id).sort();
    const shouldBe = needs.filter((n) => n.level !== 'complete' && n.level !== 'article-full')
      .map((n) => n.id).sort();
    expect(accounted, '有推文既没做也没报 —— 从账上消失了').toEqual(shouldBe);
  });
});
