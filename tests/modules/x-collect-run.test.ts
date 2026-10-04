/**
 * ⭐⭐⭐ 采一页的全流程 —— 采集 → 研判 → 按深度补全 → 再核对
 *
 * ⭐ 这些测试能存在,正因为编排从 JSX 的 onClick 里**搬了出来**:
 * 写在 onClick 里的东西测不了,而「逐篇补 38 篇」这种循环
 * 恰恰是最该测的(`feedback-pdca-close-the-loop`:循环要闭环)。
 */
import { describe, it, expect } from 'vitest';
import { runCollect, type RunDeps, type RunHarvest } from '@modules/x/x-collect-run';

const TIMELINE_URL = 'https://x.com/i/api/graphql/abc/UserTweetsTimeline';
const ARTICLE_URL = 'https://x.com/i/api/graphql/abc/TweetResultByRestId';

/** ⭐ 一条长文:列表页那份(无正文)/ 单篇页那份(有正文) */
function articleTweet(id: string, withBody: boolean): unknown {
  const result: Record<string, unknown> = { title: `标题${id}` };
  if (withBody) result.content_state = { blocks: [{ text: '正文'.repeat(60), type: 'unstyled' }] };
  return {
    rest_id: id,
    legacy: {
      id_str: id,
      full_text: `https://t.co/a${id}`,
      entities: { urls: [{ url: `https://t.co/a${id}`, expanded_url: `https://x.com/i/article/${id}` }] },
    },
    article: { article_results: { result } },
    core: { user_results: { result: { legacy: { screen_name: 'KA594594' } } } },
  };
}

/** ⭐ 一条被折叠的普通推 */
function foldedTweet(id: string): unknown {
  return {
    rest_id: id,
    legacy: { id_str: id, full_text: '开头…' },
    core: { user_results: { result: { legacy: { screen_name: 'KA594594' } } } },
  };
}

const timelinePayload = (tweets: unknown[]): string => JSON.stringify({
  data: { user: { result: { timeline: { timeline: { instructions: [
    {
      type: 'TimelineAddEntries',
      entries: tweets.map((t, i) => ({
        entryId: `tweet-${i}`, content: { itemContent: { tweet_results: { result: t } } },
      })),
    },
  ] } } } } },
});

const singlePayload = (t: unknown): string => JSON.stringify({
  data: { tweetResult: { result: t } },
});

/**
 * ⭐ 假底座:第一次 harvest 回列表页,之后每次 `gotoPage` 回对应那篇的正文。
 * ⚠️ `failArticles` 用来造「进去了但没拿到」。
 */
function makeDeps(opts: {
  listTweets: unknown[];
  failArticles?: ReadonlySet<string>;
  emptyArticles?: ReadonlySet<string>;
}): { deps: RunDeps; calls: string[] } {
  const calls: string[] = [];
  const deps: RunDeps = {
    async harvest(plan) {
      if (plan.gotoPage) {
        const url = plan.gotoPage.params?.articleId ?? '';
        const id = /\/i\/article\/(\d+)/.exec(url)?.[1] ?? '?';
        calls.push(`article:${id}`);
        if (opts.failArticles?.has(id)) return null;
        const body = !opts.emptyArticles?.has(id);
        return {
          items: [{ url: ARTICLE_URL, text: singlePayload(articleTweet(id, body)) }],
        } satisfies RunHarvest;
      }
      calls.push('list');
      return {
        items: [{ url: TIMELINE_URL, text: timelinePayload(opts.listTweets) }],
        rounds: 3, scrolledPx: 900, reachedBottom: true, stopReason: '已到底',
      } satisfies RunHarvest;
    },
  };
  return { deps, calls };
}

describe('⭐⭐⭐ 深度决定跑不跑、跑几趟', () => {
  const listTweets = [articleTweet('901', false), articleTweet('902', false), foldedTweet('903')];

  it('⭐ as-is:**一趟都不多跑**', async () => {
    const { deps, calls } = makeDeps({ listTweets });
    const r = await runCollect(deps, { wantPages: 1, depth: 'as-is' });
    expect(calls, 'as-is 还去取长文 —— 那就不是 as-is').toEqual(['list']);
    expect(r.plan?.todo, 'as-is 不该有要做的').toEqual([]);
    expect(r.plan?.skipped.length, '缺的没如实记账').toBe(3);
  });

  it('⭐⭐ expand-only:**不进**单篇页(展开已由每轮脚本做掉)', async () => {
    const { deps, calls } = makeDeps({ listTweets });
    const r = await runCollect(deps, { wantPages: 1, depth: 'expand-only' });
    expect(calls, 'expand-only 偷偷进了单篇页').toEqual(['list']);
    expect(r.plan?.skipped.map((n) => n.id), '两篇长文该被挡下').toEqual(['901', '902']);
  });

  it('⭐⭐⭐ full:**逐篇**进单篇页,一篇一趟', async () => {
    const { deps, calls } = makeDeps({ listTweets });
    const r = await runCollect(deps, { wantPages: 1, depth: 'full' });
    expect(calls, '没逐篇去取').toEqual(['list', 'article:901', 'article:902']);
    expect(r.fetched.length).toBe(2);
    expect(r.fetched.every((f) => f.ok), '取回来却报失败').toBe(true);
  });
});

/**
 * ⭐⭐⭐ **跑完要回读真实产出** —— 不是「跑完了」就算成。
 * `feedback-pdca-close-the-loop`:我踩过「数错元素致该数恒为 0」。
 */
describe('⭐⭐⭐ 补回来的正文要真的进账', () => {
  it('⭐⭐⭐ 补完后**不再报「长文没正文」** —— 否则等于白跑', async () => {
    const { deps } = makeDeps({ listTweets: [articleTweet('901', false)] });
    const r = await runCollect(deps, { wantPages: 1, depth: 'full' });
    const item = r.summary?.items.find((t) => t.id === '901');
    expect(item, '补回来的那条不见了').toBeDefined();
    expect(
      item?.incomplete,
      '跑了一趟、报告照样说缺 —— 补回来的被去重丢掉了',
    ).toBeUndefined();
    expect(item!.textLen, '正文没并进去').toBeGreaterThan(50);
  });

  it('⭐⭐ 没补的那层照样报缺 —— 不许「看着全齐了」', async () => {
    const { deps } = makeDeps({ listTweets: [articleTweet('901', false)] });
    const r = await runCollect(deps, { wantPages: 1, depth: 'as-is' });
    const item = r.summary?.items.find((t) => t.id === '901');
    expect(item?.incomplete, '没补却不报缺 —— 报告会显得全齐了').toBe('article-no-body');
  });

  /** ⚠️ 进去了但没解出正文,**不许记成功** */
  it('⚠️⚠️ 进去了没拿到正文 → 记 **ok:false**,说清为什么', async () => {
    const { deps } = makeDeps({
      listTweets: [articleTweet('901', false)],
      emptyArticles: new Set(['901']),
    });
    const r = await runCollect(deps, { wantPages: 1, depth: 'full' });
    expect(r.fetched[0].ok, '没拿到正文却记成功 —— 账是假的').toBe(false);
    expect(r.fetched[0].why, '没说为什么失败').toBeTruthy();
  });

  it('⚠️ 导航失败 → 记失败,**不中断**其余几篇', async () => {
    const { deps, calls } = makeDeps({
      listTweets: [articleTweet('901', false), articleTweet('902', false)],
      failArticles: new Set(['901']),
    });
    const r = await runCollect(deps, { wantPages: 1, depth: 'full' });
    expect(calls, '一篇坏就不跑后面了 —— 一条坏不该让整批作废')
      .toEqual(['list', 'article:901', 'article:902']);
    expect(r.fetched[0].ok).toBe(false);
    expect(r.fetched[1].ok, '后面那篇被连累了').toBe(true);
  });
});

describe('⚠️ 边界', () => {
  it('⚠️ 一条都没采到 → 不崩,也不假报研判结果', async () => {
    const deps: RunDeps = { async harvest() { return { items: [] }; } };
    const r = await runCollect(deps, { wantPages: 1, depth: 'full' });
    expect(r.summary).toBeNull();
    expect(r.plan, '没推文却给了研判结果').toBeNull();
    expect(r.fetched).toEqual([]);
  });

  it('⚠️ 采集整个失败 → 如实回空,不往下跑补全', async () => {
    const deps: RunDeps = { async harvest() { return null; } };
    const r = await runCollect(deps, { wantPages: 1, depth: 'full' });
    expect(r.harvest).toBeNull();
    expect(r.audits).toEqual([]);
  });

  it('⭐ 全是完整的推 → 一趟都不多跑', async () => {
    const plain = {
      rest_id: '1', legacy: { id_str: '1', full_text: '一条正常的推文' },
      core: { user_results: { result: { legacy: { screen_name: 'a' } } } },
    };
    const { deps, calls } = makeDeps({ listTweets: [plain] });
    const r = await runCollect(deps, { wantPages: 1, depth: 'full' });
    expect(calls).toEqual(['list']);
    expect(r.plan?.todo).toEqual([]);
  });
});
