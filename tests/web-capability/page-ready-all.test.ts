/**
 * ⭐⭐ `ready` 的 `all` 组合判据 —— **真调函数**
 *
 * ── 为什么这个分支存在(2026-09-15 实测)──
 *
 * 用户填了个**不存在的账号** `fang_dani` 跑 `goto x.withReplies`,结果 **`recovered`**。
 * 真因:X 对不存在的用户**保持 URL 不变**、在页内渲染「账号不存在」,
 * 而判据只比 URL —— 于是「到了他的页」与「到了错误页」**完全一样**。
 *
 * 四个判据分支互斥,表达不了「URL 对 **且** 页面上真有推文」。
 * `all` 就是为此,而这个文件守它别再退化。
 *
 * ⚠️ 用假宿主**真求值**:组合脚本会被拼成一段数组表达式注入,
 * 只断言「源码里有 all」对这些行为零区分力。
 */
import { describe, it, expect } from 'vitest';
import { ControlEngine } from '@platform/main/web-capability/page';
import type { ControlHost, AnchorResolver } from '@platform/main/web-capability/page';
import type { ReadyCriterion, AnchorName } from '@platform/main/web-capability/page/control-types';
import type { PageId } from '@platform/main/web-capability/page';
import { isOk, isFailed } from '@platform/main/web-capability';

const PAGE = 'page-all-1' as PageId;
const anchor = (n: string): AnchorName => n as AnchorName;

/**
 * 假宿主:真求值注入脚本。
 * 组合判据注入的是 `[(表达式A), (表达式B)]` —— 这里按子表达式各自回答。
 */
class FakeHost implements ControlHost {
  url = 'https://x.com/someone/with_replies';
  /** 页面上有没有推文元素 */
  hasTweets = true;

  async evaluate(_p: PageId, script: string): Promise<unknown> {
    // 组合脚本:数组表达式,逐个求值
    if (script.trim().startsWith('[')) {
      const inner = script.trim().slice(1, -1);
      // 按顶层逗号切(子脚本各自被 () 包住,不含裸逗号)
      const parts: string[] = [];
      let depth = 0; let cur = '';
      for (const ch of inner) {
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
        cur += ch;
      }
      if (cur.trim()) parts.push(cur);
      return parts.map((p) => this.answerOne(p));
    }
    return this.answerOne(script);
  }

  private answerOne(script: string): unknown {
    if (script.includes('href')) return this.url;
    // 锚点存在性脚本
    return this.hasTweets;
  }

  async sleep(): Promise<void> { /* 立刻返回 */ }
}

const anchors: AnchorResolver = {
  resolve: (a) => (a === 'tweet.article' ? 'article[data-testid="tweet"]' : null),
};

const engine = (h: ControlHost) => new ControlEngine(h, anchors);

/** 「URL 对 且 页面上真有推文」—— 就是 x-pages 给 profile 类页面的那个 */
const urlAndTweets = (fragment: string): ReadyCriterion => ({
  kind: 'all',
  of: [
    { kind: 'urlIncludes', fragment },
    { kind: 'anchorAppears', anchor: anchor('tweet.article') },
  ],
});

describe('⭐⭐ all:全部满足才算到位', () => {
  it('⭐ 两条都满足 → Ok', async () => {
    const host = new FakeHost();
    const r = await engine(host).ready(PAGE, urlAndTweets('/someone/with_replies'), 200);
    expect(isOk(r)).toBe(true);
  });

  it('⭐⭐ URL 对但页面没推文 → Failed(正是 fang_dani 那个场景)', async () => {
    // X 对不存在的用户保持 URL 不变、页内渲染「账号不存在」
    const host = new FakeHost();
    host.hasTweets = false;
    const r = await engine(host).ready(PAGE, urlAndTweets('/someone/with_replies'), 120);

    expect(isFailed(r), 'URL 对就放行 —— 「不存在的账号」会被当成「到了」').toBe(true);
  });

  it('⭐⭐ 有推文但 URL 不对 → Failed(跳到别人页面不算到位)', async () => {
    const host = new FakeHost();
    host.url = 'https://x.com/someone_else/with_replies';
    const r = await engine(host).ready(PAGE, urlAndTweets('/someone/with_replies'), 120);

    expect(isFailed(r)).toBe(true);
  });

  it('⭐⭐ 超时信息要说清**哪几条**判据 —— 只说 all 等于没说', async () => {
    const host = new FakeHost();
    host.hasTweets = false;
    const r = await engine(host).ready(PAGE, urlAndTweets('/someone/with_replies'), 120);

    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) return;
    expect(r.reason).toContain('all(');
    expect(r.reason, '没说清组合里有哪几条').toContain('urlIncludes:/someone/with_replies');
    expect(r.reason).toContain('anchorAppears:tweet.article');
  });
});

describe('⭐⭐ 空与嵌套:fail loud,不许恒真', () => {
  it('⭐⭐ of 为空 → Failed **且不可重试**(空的「全部满足」恒真)', async () => {
    /**
     * 空数组的 `every` 恒 true —— 那等于「没有判据」,
     * 而它**看起来像有**,比没有更坏(人会以为验过了)。
     */
    const r = await engine(new FakeHost()).ready(PAGE, { kind: 'all', of: [] }, 120);

    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) return;
    expect(r.reason).toContain('空数组');
    expect(r.retryable, '判据本身不合法,重试没有意义').toBe(false);
  });

  it('⭐ 嵌套 all → Failed(摊平写,免得说不清哪条没满足)', async () => {
    const nested: ReadyCriterion = {
      kind: 'all',
      of: [{ kind: 'all', of: [{ kind: 'urlIncludes', fragment: '/x' }] }],
    };
    const r = await engine(new FakeHost()).ready(PAGE, nested, 120);

    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) return;
    expect(r.reason).toContain('不支持嵌套');
  });

  it('⭐ 子判据自身不合法(锚点没登记)→ 整体 Failed,不静默跳过', async () => {
    const bad: ReadyCriterion = {
      kind: 'all',
      of: [
        { kind: 'urlIncludes', fragment: '/someone' },
        { kind: 'anchorAppears', anchor: anchor('nope.notRegistered') },
      ],
    };
    const r = await engine(new FakeHost()).ready(PAGE, bad, 120);

    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) return;
    expect(r.reason).toContain('无法解释成 selector');
    expect(r.retryable, '锚点没登记,重试没有意义').toBe(false);
  });
});

describe('⭐ 一次注入,同一瞬间', () => {
  it('⭐⭐ 子判据在**一次** evaluate 里全部求值(不是轮流注入)', async () => {
    /**
     * ⚠️ 轮流注入的话,一轮里各子判据看到的是**不同时刻**的页面 ——
     * 「URL 已经对了、推文还没渲染」会被当成同时满足。
     */
    let calls = 0;
    const host = new FakeHost();
    const spy: ControlHost = {
      evaluate: (p, s) => { calls += 1; return host.evaluate(p, s); },
      sleep: () => Promise.resolve(),
    };
    const r = await engine(spy).ready(PAGE, urlAndTweets('/someone/with_replies'), 200);

    expect(isOk(r)).toBe(true);
    expect(calls, '两条子判据被分成了两次注入 —— 看到的不是同一瞬间的页面').toBe(1);
  });
});
