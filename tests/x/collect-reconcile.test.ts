/**
 * ⭐⭐ 采集完整性对账 —— **真调函数**,纯逻辑无依赖
 *
 * ── 用户 2026-09-18 定的采集层要求 ──
 *
 * > 「不能缺少数据。要可验证。」
 * > 「每一种方法都采一次,比对都有哪些数据,取它的并集。」
 *
 * 所以这里钉两件事:
 *  ① **对账要说得出差异在哪**(不是给个「成功率 95%」)
 *  ② **并集不能丢任何一路独有的字段**
 */
import { describe, it, expect } from 'vitest';
import { reconcile, mergeTweet } from '@platform/main/x/x-collect-reconcile';
import type { XTweetData } from '@platform/main/x/x-extract-tweet';
import type { HarvestedTweet } from '@platform/main/x/x-timeline-harvester';

const dom = (over: Partial<XTweetData> = {}): XTweetData => ({
  tweetId: '111', text: '求推荐机场', authorHandle: '@Somebody',
  authorName: '某人', authorAvatar: 'https://pbs.twimg.com/a.jpg',
  tweetUrl: 'https://x.com/somebody/status/111',
  metrics: { likes: 3, views: 100 },
  ...over,
});

const payload = (over: Partial<HarvestedTweet> = {}): HarvestedTweet => ({
  tweetId: '111', text: '求推荐机场', authorHandle: 'somebody',
  authorRestId: '9988', conversationId: '100',
  hasMedia: false, isLongText: false,
  metrics: { likes: 3, quotes: 1, bookmarks: 2 },
  self: { favorited: true },
  ...over,
});

describe('⭐⭐ 对账:差异要说得出在哪', () => {
  it('⭐ 两路都采到同一条 → both', () => {
    const r = reconcile([dom()], [payload()]);
    expect(r.total).toBe(1);
    expect(r.bothTweets).toBe(1);
    expect(r.domOnlyTweets).toBe(0);
    expect(r.payloadOnlyTweets).toBe(0);
  });

  it('⭐⭐ 一路漏了整条推 → 分别计数(不是笼统「少了几条」)', () => {
    const r = reconcile(
      [dom({ tweetId: '111' }), dom({ tweetId: '222' })],
      [payload({ tweetId: '111' }), payload({ tweetId: '333' })],
    );
    expect(r.total, '并集算错了').toBe(3);
    expect(r.bothTweets).toBe(1);
    expect(r.domOnlyTweets, '只有 DOM 采到的没数出来').toBe(1);
    expect(r.payloadOnlyTweets, '只有载荷采到的没数出来').toBe(1);
  });

  it('⭐⭐ 单路独有的字段 → payloadOnly / domOnly 全额', () => {
    const r = reconcile([dom()], [payload()]);

    const conv = r.fields.find((f) => f.field === 'conversationId')!;
    expect(conv.payloadOnly, 'conversationId 只有载荷有,没体现出来').toBe(1);
    expect(conv.domHas).toBe(0);

    const avatar = r.fields.find((f) => f.field === 'authorAvatar')!;
    expect(avatar.domOnly, 'authorAvatar 只有 DOM 有,没体现出来').toBe(1);
    expect(avatar.payloadHas).toBe(0);
  });
});

describe('⭐⭐ 冲突必须报 —— 假数据比缺数据更坏', () => {
  it('⭐⭐ 同字段两路值不同 → conflict,且给出样本', () => {
    const r = reconcile(
      [dom({ text: '被渲染截断的正文…' })],
      [payload({ text: '完整正文' })],
    );

    const f = r.fields.find((x) => x.field === 'text')!;
    expect(f.conflict, '两路值不同却没报冲突 —— 至少一路在产假数据').toBe(1);
    expect(f.agree).toBe(0);

    expect(r.conflictSamples.length, '只给数字不给样本 —— 没法查是谁解错的')
      .toBeGreaterThan(0);
    const s = r.conflictSamples[0];
    expect(s.field).toBe('text');
    expect(s.dom).toContain('截断');
    expect(s.payload).toBe('完整正文');
  });

  it('⭐⭐ handle 大小写/@ 前缀不算冲突(必须归一化后比)', () => {
    /**
     * 库里 author_handle 是「@Miekko22」,x_author.handle 是「miekko22」。
     * 不归一化就比,冲突数会虚高到几乎每条都冲突,真冲突反而被淹掉
     * (记忆 project-x-handle-normalize)。
     */
    const r = reconcile([dom({ authorHandle: '@Somebody' })], [payload({ authorHandle: 'somebody' })]);

    const f = r.fields.find((x) => x.field === 'authorHandle')!;
    expect(f.conflict, '大小写差异被当成了冲突').toBe(0);
    expect(f.agree).toBe(1);
  });
});

describe('⭐⭐ 0 和 false 算「有值」', () => {
  it('⭐⭐ metrics 为 0 不算缺失(0 赞是事实,不是没采到)', () => {
    /**
     * 用 `if (!v)` 判有没有值,会把 0 赞、false 当成「没采到」——
     * 于是「这条推没人赞」和「我们没抓到赞数」混成一种。
     */
    const r = reconcile(
      [dom({ metrics: { likes: 0 } })],
      [payload({ metrics: { likes: 0 } })],
    );

    const f = r.fields.find((x) => x.field === 'metrics.likes')!;
    expect(f.domHas, '0 被当成了没有值').toBe(1);
    expect(f.payloadHas).toBe(1);
    expect(f.agree).toBe(1);
  });

  it('⭐ self.favorited=false 同样算有值', () => {
    const r = reconcile([], [payload({ self: { favorited: false } })]);
    const f = r.fields.find((x) => x.field === 'self.favorited')!;
    expect(f.payloadHas, 'false 被当成了没有值').toBe(1);
  });

  it('⭐ 空串**不算**有值(采到空 = 没采到)', () => {
    const r = reconcile([dom({ text: '   ' })], []);
    const f = r.fields.find((x) => x.field === 'text')!;
    expect(f.domHas).toBe(0);
  });
});

describe('⭐⭐ 并集:一路独有的都不能丢', () => {
  it('⭐⭐ DOM 独有(头像/媒体/url)+ 载荷独有(会话串/restId)全都在', () => {
    const m = mergeTweet(
      dom({ media: [{ type: 'image', url: 'https://x/i.jpg' }] }),
      payload(),
    )!;

    // 只有 DOM 有的
    expect(m.authorAvatar, '头像丢了 —— 只有 DOM 路能拿到').toBeTruthy();
    expect(m.tweetUrl, 'tweetUrl 丢了').toBeTruthy();
    expect(m.media, '媒体丢了').toBeTruthy();
    // 只有载荷有的
    expect(m.conversationId, '会话串丢了 —— 只有载荷能拿到').toBe('100');
    expect(m.authorRestId, 'restId 丢了 —— 改名后就找不回这个人了').toBe('9988');
    expect((m.metrics as { bookmarks?: number }).bookmarks).toBe(2);
  });

  it('⭐⭐ 只有一路采到这条推 → 照样出结果,不丢', () => {
    const onlyPayload = mergeTweet(undefined, payload())!;
    expect(onlyPayload.tweetId).toBe('111');
    expect(onlyPayload.conversationId).toBe('100');

    const onlyDom = mergeTweet(dom(), undefined)!;
    expect(onlyDom.tweetId).toBe('111');
    expect(onlyDom.authorAvatar).toBeTruthy();
  });

  it('⭐⭐ 两路都有值时载荷优先(DOM 是渲染结果,会省略/本地化)', () => {
    /**
     * 实测:DOM 上的 views 常是「1.2万」这类省略形式,而载荷是精确数字。
     * ⚠️ 但**只在两路都有值时**才轮到优先级 —— 只有一方有就取那方。
     */
    const m = mergeTweet(
      dom({ metrics: { likes: 12000, views: 99 } }),
      payload({ metrics: { likes: 12345 } }),
    )!;
    const metrics = m.metrics as { likes?: number; views?: number };
    expect(metrics.likes, '两路都有时没按载荷优先').toBe(12345);
    expect(metrics.views, '只有 DOM 有的值被丢了').toBe(99);
  });

  it('⭐ 记下每条推来自哪几路(出问题能追到是谁解错的)', () => {
    const both = mergeTweet(dom(), payload())!;
    expect(both._sources).toEqual({ dom: true, payload: true });

    const p = mergeTweet(undefined, payload())!;
    expect(p._sources).toEqual({ dom: false, payload: true });
  });

  it('⭐ 两路都没有 tweetId → null(不造一条无主记录)', () => {
    expect(mergeTweet(undefined, undefined)).toBeNull();
    expect(mergeTweet(dom({ tweetId: undefined }), undefined)).toBeNull();
  });
});
