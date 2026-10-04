/**
 * ⭐⭐⭐ 采一页的全流程 —— 采集 → 研判 → 按深度补全 → 再核对
 *
 * ⭐ 这些测试能存在,正因为编排从 JSX 的 onClick 里**搬了出来**:
 * 写在 onClick 里的东西测不了,而「逐篇补 38 篇」这种循环
 * 恰恰是最该测的(`feedback-pdca-close-the-loop`:循环要闭环)。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * ⭐⭐ 响应数要**算整轮** —— 2026-10-04 真机
 *
 * 那份报告写着「收到 **20** 条响应,其中 **64** 条是时间线载荷」——
 * 64 > 20,一眼假。真因:`pages` 算的是整轮(列表页 + 38 篇长文页),
 * 而 `totalResponses` 只拿了**第一趟**的 `harvest.items.length`。
 * ⚠️ 两个数来自不同的跑,却摆在同一句话里。
 */
describe('⭐⭐ 响应数算整轮,不是只算第一趟', () => {
  it('⭐⭐ 补了几篇,响应数就要把那几篇算进去', async () => {
    const { deps } = makeDeps({
      listTweets: [articleTweet('901', false), articleTweet('902', false)],
    });
    const r = await runCollect(deps, { wantPages: 1, depth: 'full' });
    /** 列表页 1 条 + 两篇各 1 条 = 3 */
    expect(
      r.totalResponses,
      '响应数只算了第一趟 —— 报告会写出「收到 20 条、其中 64 条」这种话',
    ).toBe(3);
  });

  it('⭐ 不补时就是第一趟那个数', async () => {
    const { deps } = makeDeps({ listTweets: [articleTweet('901', false)] });
    const r = await runCollect(deps, { wantPages: 1, depth: 'as-is' });
    expect(r.totalResponses).toBe(1);
  });

  /**
   * ⭐⭐ 失败原因要**分得开** —— 真机 2 篇失败时
   * 「进去了但没解出正文」一句话盖住了三种成因,看了不知道查哪。
   */
  it('⭐⭐ 失败原因按成因分:没响应 / 没推文 / 有推文没正文', async () => {
    const { deps } = makeDeps({
      listTweets: [articleTweet('901', false)],
      emptyArticles: new Set(['901']),
    });
    const r = await runCollect(deps, { wantPages: 1, depth: 'full' });
    expect(r.fetched[0].ok).toBe(false);
    expect(
      r.fetched[0].why,
      '失败原因没说清是哪一种 —— 留了痕也等于没留',
    ).toContain('它没正文');
  });
});

/**
 * ⭐⭐⭐ 回读产出要回读**那一条**的 —— 2026-10-04 真机
 *
 * 面板报「取回长文正文 **19/19**」,报告里却只有 **17 篇**有正文。
 * ⚠️⚠️ 真因:成功判据是 `find(t => t.isArticle && !t.incomplete)` ——
 * **任意一条**有正文的长文都算数。而单篇页载荷里不止一条推
 * (引用的、相关的都在),于是认的根本不是我要的那一条。
 *
 * ⭐ `feedback-pdca-close-the-loop`:「数错元素致该数恒为 0」——
 * 这次是反过来,**数错元素致该数恒为满**,一样等于没在看。
 */
describe('⭐⭐⭐ 成功判据只认目标那一条', () => {
  /** ⭐ 单篇页载荷里**另有**一条带正文的长文(引用/相关),但目标那条没有 */
  function depsWithBystander(): RunDeps {
    return {
      async harvest(plan) {
        if (plan.gotoPage) {
          return {
            items: [{
              url: ARTICLE_URL,
              text: JSON.stringify({
                data: { threaded_conversation: { instructions: [{
                  type: 'TimelineAddEntries',
                  entries: [
                    // 目标那条:**没有**正文
                    { entryId: 'a', content: { itemContent: { tweet_results: {
                      result: articleTweet('901', false),
                    } } } },
                    // 旁边那条:有正文 —— 旧判据会认它
                    { entryId: 'b', content: { itemContent: { tweet_results: {
                      result: articleTweet('999', true),
                    } } } },
                  ],
                }] } },
              }),
            }],
          } satisfies RunHarvest;
        }
        return {
          items: [{ url: TIMELINE_URL, text: timelinePayload([articleTweet('901', false)]) }],
        } satisfies RunHarvest;
      },
    };
  }

  it('⭐⭐⭐ 同页另一条有正文 → 目标那条仍记**失败**', async () => {
    const r = await runCollect(depsWithBystander(), { wantPages: 1, depth: 'full' });
    /** ⚠️ 先确认样本真造出了「旁边那条有正文」 */
    const got = r.summary?.items.find((t) => t.id === '999');
    expect(got?.incomplete, '样本里旁边那条没正文 —— 测不到该现象').toBeUndefined();

    expect(
      r.fetched[0].ok,
      '认了旁边那条 —— 面板会报 19/19 而报告只有 17 篇',
    ).toBe(false);
    expect(r.fetched[0].why, '没说清是「它没正文」').toContain('它没正文');
  });

  it('⭐⭐ 面板的「取回 N/N」要与报告里真有正文的篇数**对得上**', async () => {
    const { deps } = makeDeps({
      listTweets: [articleTweet('901', false), articleTweet('902', false)],
    });
    const r = await runCollect(deps, { wantPages: 1, depth: 'full' });
    const okCount = r.fetched.filter((f) => f.ok).length;
    const withBody = (r.summary?.items ?? [])
      .filter((t) => t.isArticle && t.incomplete === undefined).length;
    expect(
      okCount,
      `面板说取回 ${okCount} 篇、报告里有正文的 ${withBody} 篇 —— 两边对不上`,
    ).toBe(withBody);
  });
});

/**
 * ⭐⭐⭐ 采完要**回到原来那一页** —— 2026-10-04 真机
 *
 * 用户 2026-10-03 原话:
 * 「点击进去观看,观看完毕,**点击返回上一下**,继续往下浏览。」
 *
 * ⚠️⚠️ 我上一版只做了前半句。四次跑的实测后果:
 *   推文 **97 → 40 → 21**,而每次都报「滚到底 ✓」。
 * 因为每轮跑完都停在最后一篇长文页,而「采这一页」采的是**当前页** ——
 * 下一次跑时当前页已经不是主页而是一篇文章。三张截图的地址栏坐实了这点。
 */
describe('⭐⭐⭐ 采完回到原来那一页', () => {
  function withBack(listTweets: unknown[]): { deps: RunDeps; calls: string[] } {
    const base = makeDeps({ listTweets });
    const calls = base.calls;
    return {
      calls,
      deps: {
        ...base.deps,
        goBack: async () => { calls.push('goBack'); return true; },
      },
    };
  }

  it('⭐⭐⭐ 补过长文 → **最后要回去**', async () => {
    const { deps, calls } = withBack([articleTweet('901', false)]);
    await runCollect(deps, { wantPages: 1, depth: 'full' });
    expect(calls, '补完没回原页 —— 下一轮会从长文页开始采')
      .toEqual(['list', 'article:901', 'goBack']);
  });

  it('⭐⭐ 回去必须在**所有篇都补完之后** —— 不是补一篇回一次', async () => {
    const { deps, calls } = withBack([articleTweet('901', false), articleTweet('902', false)]);
    await runCollect(deps, { wantPages: 1, depth: 'full' });
    expect(calls).toEqual(['list', 'article:901', 'article:902', 'goBack']);
  });

  it('⚠️ 一篇都没补 → **不必回**(压根没离开过)', async () => {
    const { deps, calls } = withBack([articleTweet('901', false)]);
    await runCollect(deps, { wantPages: 1, depth: 'as-is' });
    expect(calls, '没离开页面却跑去导航了 —— 白跑一趟还可能打断现场')
      .toEqual(['list']);
  });

  it('⚠️ 回不去**不算整轮失败** —— 数据已经采到了,但要留痕', async () => {
    const base = makeDeps({ listTweets: [articleTweet('901', false)] });
    const deps: RunDeps = { ...base.deps, goBack: async () => false };
    const r = await runCollect(deps, { wantPages: 1, depth: 'full' });
    expect(r.fetched[0].ok, '回不去把已经采到的也判成失败了').toBe(true);
    expect(r.summary?.items.length, '数据没留下').toBeGreaterThan(0);
  });

  it('⚠️ 调用方没给 goBack → 不崩(老行为不变)', async () => {
    const { deps } = makeDeps({ listTweets: [articleTweet('901', false)] });
    const r = await runCollect(deps, { wantPages: 1, depth: 'full' });
    expect(r.fetched[0].ok).toBe(true);
  });
});

/**
 * ⭐⭐⭐ **判断-执行-再判断** —— 2026-10-04 真机
 *
 * 那一跑:面板报「取回长文正文 **38/38**」零失败,报告却说「**缺 19 篇**」。
 * ⚠️ 两个数都对 —— 补长文时**单篇页载荷里还夹着别的长文**(引用的、相关的),
 * 它们被一起收进账,**却从来没被请求过**。
 *
 * ⭐ `feedback-pdca-close-the-loop` 的①:
 * 反复执行的循环必须「判断-执行-**再判断**-再执行」。
 */
describe('⭐⭐⭐ 补的时候带出新的长文 → 同一轮里补上', () => {
  /** ⭐ 取 901 时,单篇页载荷里**夹带**一篇没正文的 902 */
  function depsBringsAlong(): { deps: RunDeps; calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      deps: {
        async harvest(plan) {
          if (plan.gotoPage) {
            const id = /\/i\/article\/(\d+)/.exec(plan.gotoPage.params?.articleId ?? '')?.[1] ?? '?';
            calls.push(`article:${id}`);
            const tweets = [articleTweet(id, true)];
            // ⭐ 取第一篇时夹带出 902(没正文)
            if (id === '901') tweets.push(articleTweet('902', false));
            return {
              items: [{ url: ARTICLE_URL, text: timelinePayload(tweets) }],
            } satisfies RunHarvest;
          }
          calls.push('list');
          return {
            items: [{ url: TIMELINE_URL, text: timelinePayload([articleTweet('901', false)]) }],
          } satisfies RunHarvest;
        },
      },
    };
  }

  it('⭐⭐⭐ 夹带出来的那篇**同一轮补上**,不留到下次', async () => {
    const { deps, calls } = depsBringsAlong();
    const r = await runCollect(deps, { wantPages: 1, depth: 'full' });
    expect(calls, '夹带出来的 902 没被补 —— 报告会说「缺 1 篇」而面板说零失败')
      .toEqual(['list', 'article:901', 'article:902']);
    expect(r.fetched.length).toBe(2);
    expect(r.fetched.every((f) => f.ok), '补回来的报了失败').toBe(true);
  });

  it('⭐⭐ 补完之后账上**不再缺** —— 面板与报告说同一件事', async () => {
    const { deps } = depsBringsAlong();
    const r = await runCollect(deps, { wantPages: 1, depth: 'full' });
    const stillMissing = (r.summary?.items ?? [])
      .filter((t) => t.incomplete === 'article-no-body');
    expect(
      stillMissing.length,
      `面板说取回 ${r.fetched.filter((f) => f.ok).length} 篇零失败，账上却还缺 ${stillMissing.length} 篇`,
    ).toBe(0);
  });

  /** ⚠️ 取不到正文的那几篇**不许**让循环空转 */
  it('⚠️⚠️ 取不到正文的不重试 —— 否则循环空转', async () => {
    const { deps, calls } = makeDeps({
      listTweets: [articleTweet('901', false)],
      emptyArticles: new Set(['901']),
    });
    const r = await runCollect(deps, { wantPages: 1, depth: 'full' });
    const tries = calls.filter((c) => c === 'article:901').length;
    expect(tries, '同一篇试了多次 —— 取不到的会把循环拖死').toBe(1);
    expect(r.fetched[0].ok).toBe(false);
  });

  it('⭐ 没有夹带时只跑一轮 —— 不做无谓的再判', async () => {
    const { deps, calls } = makeDeps({ listTweets: [articleTweet('901', false)] });
    await runCollect(deps, { wantPages: 1, depth: 'full' });
    expect(calls).toEqual(['list', 'article:901']);
  });
});

/**
 * ⭐⭐⭐ **主动翻页** —— 2026-10-04 真机逼出来的
 *
 * 配方搜索三跑,每跑都只拿到 **1 条 `SearchTimeline`**。排除法验过:
 * · 不是噪音(挡掉 m3u8 后 6 条响应全干净,仍是 1)
 * · 不是滚动不够(21 条推文约 17000px,**实际滚了 47360px**)
 * · 不是结果就这么多(**「游标 1/1 页有」—— X 自己说还有下一页**)
 * ⭐ 对照 x.profile 同样滚 4 万 px 出 **43** 条载荷 ——
 * **个人主页滚动会自动翻页,搜索页不会**。
 */
describe('⭐⭐⭐ 拿游标主动翻页', () => {
  const SEED = 'https://x.com/i/api/graphql/qid/SearchTimeline?variables=%7B%22rawQuery%22%3A%22vpn%22%7D';

  /** ⭐ 第 n 页:带 n 条推 + 一个游标(最后一页没有游标) */
  const page = (n: number, cursor: string | null): string => {
    const entries: unknown[] = [{
      entryId: `tweet-${n}`,
      content: { itemContent: { tweet_results: { result: {
        rest_id: `t${n}`,
        legacy: { id_str: `t${n}`, full_text: `第${n}页` },
        core: { user_results: { result: { legacy: { screen_name: 'a' } } } },
      } } } },
    }];
    if (cursor !== null) {
      entries.push({ entryId: 'cursor-bottom', content: { cursorType: 'Bottom', value: cursor } });
    }
    return JSON.stringify({
      data: { search_by_raw_query: { search_timeline: { timeline: {
        instructions: [{ type: 'TimelineAddEntries', entries }],
      } } } },
    });
  };

  /** ⭐ 假底座:首页给 seed,之后每次 runScript 推进一页 */
  function pagingDeps(pages: ReadonlyArray<string | null>): {
    deps: RunDeps; scripts: Array<{ id: string; cursor: string }>;
  } {
    const scripts: Array<{ id: string; cursor: string }> = [];
    let idx = 0;
    const deps: RunDeps = {
      async harvest(plan) {
        if (plan.gotoPage) return { items: [] };
        const cur = pages[idx];
        return {
          items: cur === null ? [] : [{ url: SEED, text: cur }],
        } satisfies RunHarvest;
      },
      async runScript(id, params) {
        scripts.push({ id, cursor: String(params.cursor ?? '') });
        idx += 1;
        return { ok: true };
      },
    };
    return { deps, scripts };
  }

  it('⭐⭐⭐ 有游标就一直翻 —— 不是只采第一页', async () => {
    const { deps, scripts } = pagingDeps([
      page(1, 'c1'), page(2, 'c2'), page(3, null),
    ]);
    const r = await runCollect(deps, { wantPages: 1, depth: 'as-is' });
    expect(scripts.length, '只翻了一次或没翻 —— 搜索页会永远停在 20 条').toBe(2);
    expect(scripts.map((x) => x.cursor), '游标没跟着往后走').toEqual(['c1', 'c2']);
    expect(r.summary?.items.length, '后面几页的推文没进账').toBe(3);
  });

  it('⭐⭐ 没有游标 → **立刻停**,不空转', async () => {
    const { deps, scripts } = pagingDeps([page(1, null)]);
    await runCollect(deps, { wantPages: 1, depth: 'as-is' });
    expect(scripts.length, '没游标还去翻 —— 白跑').toBe(0);
  });

  /** ⚠️ 游标不变 = 翻不动了,必须停 —— 否则 40 轮空转 */
  it('⚠️⚠️ 游标**不再变化** → 停,不死循环', async () => {
    const { deps, scripts } = pagingDeps([
      page(1, 'same'), page(2, 'same'), page(3, 'same'),
    ]);
    await runCollect(deps, { wantPages: 1, depth: 'as-is' });
    expect(scripts.length, '同一个游标翻了多次 —— 会空转到轮次上限').toBe(1);
  });

  it('⚠️ 翻页脚本抛错 → **不毁整轮**,已采到的还在', async () => {
    const deps: RunDeps = {
      async harvest(plan) {
        if (plan.gotoPage) return { items: [] };
        return { items: [{ url: SEED, text: page(1, 'c1') }] };
      },
      async runScript() { throw new Error('页面没了'); },
    };
    const r = await runCollect(deps, { wantPages: 1, depth: 'as-is' });
    expect(r.summary?.items.length, '第一页也丢了 —— 翻页失败不该毁掉已采的').toBe(1);
  });

  /**
   * ⭐⭐⭐ **X 会一直给新游标、却回同一批推** —— 2026-10-04 真机
   *
   * 那一跑翻满 40 轮上限:44 页载荷、原始 680 条,**去重后只剩 42 条**。
   * ⚠️⚠️ 原判据写 `这一页有几条推 === 0` 才停 —— 而 X 每页照样回 15 条,
   * 停止条件**永远到不了**。
   * ⭐ `feedback-pdca-close-the-loop` 的「数错元素」:
   * 数「页里有几条」而不是「**新收了几条**」,该数恒 > 0 等于没在判。
   */
  it('⭐⭐⭐ 游标一直变但推文是同一批 → **按「没有新推文」停**', async () => {
    /** ⭐ 每页都有推、都有新游标,但**推文 id 永远是 t1** */
    const samePage = (cursorNo: number): string => JSON.stringify({
      data: { search_by_raw_query: { search_timeline: { timeline: { instructions: [{
        type: 'TimelineAddEntries',
        entries: [
          { entryId: 'tweet-1', content: { itemContent: { tweet_results: { result: {
            rest_id: 't1',
            legacy: { id_str: 't1', full_text: '同一条' },
            core: { user_results: { result: { legacy: { screen_name: 'a' } } } },
          } } } } },
          { entryId: 'cursor-bottom', content: { cursorType: 'Bottom', value: `c${cursorNo}` } },
        ],
      }] } } } },
    });
    let n = 0;
    const deps: RunDeps = {
      async harvest(plan) {
        if (plan.gotoPage) return { items: [] };
        return { items: [{ url: SEED, text: samePage(n) }] };
      },
      async runScript() { n += 1; return { ok: true }; },
    };
    /**
     * ⭐⭐⭐ **停不停由调用方说** —— 用户 2026-10-04:
     * 「判断是否停下来是由**业务编排时的研判逻辑**来定,
     * 　而不是你在采集中定下来。」
     *
     * ⚠️⚠️ 我在这上面连栽两次,**两次都是把业务判断写死进采集层**:
     * ① `EMPTY_ROUNDS_TO_STOP = 3` → 真机对照实验证否(窄 43 / 宽 42,
     * 　 查询放宽十几倍结果一样,而 4/4 页都有游标 —— 刹车踩早了)
     * ② 然后我「改成 12」—— **还是同一个错误**,只换了个数。
     *
     * ⭐ 所以本条现在喂一个 `stopPaging` 进去,钉的是
     * 「**采集层照业务说的办**」,不再钉某个魔法数字。
     */
    const r = await runCollect(
      { ...deps, stopPaging: (st) => (st.emptyRounds >= 3 ? { go: false, why: '业务:够了' } : { go: true }) },
      { wantPages: 1, depth: 'as-is' },
    );
    expect(n, '业务说停了却还在翻 —— 采集层自作主张').toBeLessThanOrEqual(4);
    expect(r.summary?.items.length, '同一条推被算成了多条').toBe(1);
  });

  /** ⚠️ 一轮重复不许立刻停 —— X 偶尔回一页旧的,下一页又有新的 */
  it('⚠️⚠️ 中间夹一页重复的 → **不停**,继续往后翻', async () => {
    const pages = [page(1, 'c1'), page(1, 'c2'), page(2, 'c3'), page(3, null)];
    let n = 0;
    const deps: RunDeps = {
      async harvest(plan) {
        if (plan.gotoPage) return { items: [] };
        return { items: [{ url: SEED, text: pages[Math.min(n, pages.length - 1)] }] };
      },
      async runScript() { n += 1; return { ok: true }; },
    };
    const r = await runCollect(deps, { wantPages: 1, depth: 'as-is' });
    expect(
      r.summary?.items.length,
      '夹了一页重复就停了 —— 后面的新推文全丢（2604 账号卡死在 2244 就是这么来的）',
    ).toBe(3);
  });

  it('⚠️ 调用方没给 runScript → 不翻页(老行为不变)', async () => {
    const { deps } = pagingDeps([page(1, 'c1'), page(2, null)]);
    const noScript: RunDeps = { harvest: deps.harvest };
    const r = await runCollect(noScript, { wantPages: 1, depth: 'as-is' });
    expect(r.summary?.items.length).toBe(1);
  });
});

/**
 * ⭐⭐⭐ **「几轮没新推文」不许当主判据** —— 2026-10-04 对照实验
 *
 * 同一条链路只换查询:
 *   窄配方(9关键词 AND 6求助词 AND lang:zh) → **43 条 / 5 页**
 *   宽配方(3关键词,不加求助词,不限语言)     → **42 条 / 4 页**
 * ⚠️ 查询放宽十几倍结果几乎一样 → 42 不是「真实数量」,**是刹车踩早了**。
 * 而那一跑 **4/4 页都有游标** —— X 一直说还有下一页。
 *
 * ⭐ `project-x-cursor-paging` 早写过同一条:
 * 「几页没新人」当到底,把 2604 个账号卡死在 2244(三跑同数),
 * 拆掉刹车后 2244 → 2634。**我昨天又加了回来,同一个坑第二次。**
 */
describe('⭐⭐⭐ 翻页停止只认「X 说了算」', () => {
  const SEED2 = 'https://x.com/i/api/graphql/qid/SearchTimeline?variables=%7B%7D';

  /** ⭐ 前 5 轮全是旧推(真机那种),第 6 轮才出新的 —— 刹车=3 会在此之前停 */
  it('⭐⭐⭐ 中间连着好几轮旧推 → **不停**,后面的新推文要采到', async () => {
    const tweet = (id: string): unknown => ({
      rest_id: id,
      legacy: { id_str: id, full_text: `推${id}` },
      core: { user_results: { result: { legacy: { screen_name: 'a' } } } },
    });
    const mk = (ids: string[], cursor: string): string => JSON.stringify({
      data: { search_by_raw_query: { search_timeline: { timeline: { instructions: [{
        type: 'TimelineAddEntries',
        entries: [
          ...ids.map((id) => ({
            entryId: `tweet-${id}`,
            content: { itemContent: { tweet_results: { result: tweet(id) } } },
          })),
          { entryId: 'cursor-bottom', content: { cursorType: 'Bottom', value: cursor } },
        ],
      }] } } } },
    });
    /** 第 0 页新,1~5 页全旧,第 6 页又有新的 */
    const pages = [
      mk(['t1'], 'c0'), mk(['t1'], 'c1'), mk(['t1'], 'c2'),
      mk(['t1'], 'c3'), mk(['t1'], 'c4'), mk(['t1'], 'c5'),
      mk(['t9'], 'c6'),
    ];
    let n = 0;
    const deps: RunDeps = {
      async harvest(plan) {
        if (plan.gotoPage) return { items: [] };
        return { items: [{ url: SEED2, text: pages[Math.min(n, pages.length - 1)] }] };
      },
      async runScript() { n += 1; return { ok: true }; },
    };
    const r = await runCollect(deps, { wantPages: 1, depth: 'as-is' });
    expect(
      r.summary?.items.map((t) => t.id).sort(),
      '连着几轮旧推就停了 —— 后面的新推文全丢（2604 卡死在 2244 就是这么来的）',
    ).toEqual(['t1', 't9']);
  });
});

/**
 * ⭐⭐⭐ **分界:采集层只答「X 还给不给」** —— 用户 2026-10-04 原话
 *
 * 「判断是否停下来是由**业务编排时的研判逻辑**来定,
 * 　而不是你在**采集**中定下来。」
 *
 * ⚠️⚠️ 我在这上面连栽两次,两次都是把业务判断写死进采集层
 * (先 `EMPTY_ROUNDS_TO_STOP = 3`,被证否后「改成 12」——**还是同一个错误**)。
 */
describe('⭐⭐⭐ 停不停由业务定,不由采集层定', () => {
  const S = 'https://x.com/i/api/graphql/q/SearchTimeline?variables=%7B%7D';
  const mk = (id: string, cursor: string): string => JSON.stringify({
    data: { search_by_raw_query: { search_timeline: { timeline: { instructions: [{
      type: 'TimelineAddEntries',
      entries: [
        { entryId: `tweet-${id}`, content: { itemContent: { tweet_results: { result: {
          rest_id: id,
          legacy: { id_str: id, full_text: `推${id}` },
          core: { user_results: { result: { legacy: { screen_name: 'a' } } } },
        } } } } },
        { entryId: 'cursor-bottom', content: { cursorType: 'Bottom', value: cursor } },
      ],
    }] } } } },
  });

  /** ⭐ X 一直有新东西给:每轮都是新推 + 新游标 */
  function endless(): { deps: RunDeps; rounds: () => number } {
    let n = 0;
    const deps: RunDeps = {
      async harvest(plan) {
        if (plan.gotoPage) return { items: [] };
        return { items: [{ url: S, text: mk(`t${n}`, `c${n}`) }] };
      },
      async runScript() { n += 1; return { ok: true }; },
    };
    return { deps, rounds: () => n };
  }

  it('⭐⭐⭐ 业务说「翻 3 轮就够」→ 采集层**照办**', async () => {
    const { deps, rounds } = endless();
    await runCollect(
      { ...deps, stopPaging: (st) => (st.round >= 3 ? { go: false, why: '业务:翻够 3 轮' } : { go: true }) },
      { wantPages: 1, depth: 'as-is' },
    );
    expect(rounds(), '业务说停了还在翻').toBe(3);
  });

  it('⭐⭐⭐ 业务说「一直翻」→ 采集层**不自作主张**停', async () => {
    const { deps, rounds } = endless();
    await runCollect(
      { ...deps, stopPaging: () => ({ go: true }) },
      { wantPages: 1, depth: 'as-is' },
    );
    /** ⚠️ X 一直给新的,业务也没喊停 → 只有安全网能拦住它 */
    expect(rounds(), '采集层自己踩了刹车 —— 那是业务的判断').toBeGreaterThan(50);
  });

  /**
   * ⚠️ 「连续几轮没新推文」**只是事实,不是判据** ——
   * 采集层把它报给业务,**由业务决定要不要当刹车**。
   */
  it('⭐⭐ 连续空轮只上报,**不自己停**', async () => {
    /** X 一直回同一条推、但游标一直变(真机那种) */
    let n = 0;
    const seen: number[] = [];
    const deps: RunDeps = {
      async harvest(plan) {
        if (plan.gotoPage) return { items: [] };
        return { items: [{ url: S, text: mk('same', `c${n}`) }] };
      },
      async runScript() { n += 1; return { ok: true }; },
      stopPaging: (st) => {
        seen.push(st.emptyRounds);
        return st.emptyRounds >= 5 ? { go: false, why: '业务:连 5 轮没新的' } : { go: true };
      },
    };
    await runCollect(deps, { wantPages: 1, depth: 'as-is' });
    expect(seen, '没把「连续空轮」如实报给业务').toContain(5);
    expect(n, '业务说停了却没停').toBe(5);
  });

  it('⚠️ 不给 stopPaging → 翻到 X 不给为止(游标不变就停)', async () => {
    let n = 0;
    const deps: RunDeps = {
      async harvest(plan) {
        if (plan.gotoPage) return { items: [] };
        /** ⚠️ 游标**恒定** = X 翻不动了 —— 这条是采集层该管的 */
        return { items: [{ url: S, text: mk(`t${n}`, 'same-cursor') }] };
      },
      async runScript() { n += 1; return { ok: true }; },
    };
    await runCollect(deps, { wantPages: 1, depth: 'as-is' });
    expect(n, '游标不变还在翻 —— 「X 还给不给」是采集层的本职').toBe(1);
  });
});

/**
 * ⭐⭐⭐ 采集层**不许**再长出「采多少算够」的常量 —— 结构守卫
 *
 * ⚠️ 行为测试盖不住这件事:我可以加一个新常量、把测试一起改了,
 * 两边都绿。**而我已经连栽两次**(3 → 12,换个数还是同一个错)。
 */
describe('⭐⭐⭐ 采集层不许自带「够了没有」的阈值', () => {
  it('⭐⭐⭐ 没有 EMPTY_ROUNDS_TO_STOP 这类业务阈值', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', 'src/modules/x/x-collect-run.ts'),
      'utf-8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');  // ⚠️ 剥块注释 —— 注释里会提到这个名字

    expect(
      src,
      '采集层又写死了「连续几轮没新的就停」—— 那是业务的研判\n'
      + '⭐ 用户 2026-10-04:「判断是否停下来是由业务编排时的研判逻辑来定，'
      + '而不是你在采集中定下来。」',
    ).not.toMatch(/EMPTY_ROUNDS_TO_STOP|emptyRounds\s*>=\s*\d/);

    /** ⭐ 安全网**可以有**,但名字要说清它是安全网,且远大于业务阈值 */
    expect(src, '连安全网都没了 —— X 一直给新游标会永远转下去')
      .toContain('PAGING_SAFETY_ROUNDS');
  });

  it('⭐⭐ 停止判据里只有「X 还给不给」那两条', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', 'src/modules/x/x-collect-run.ts'),
      'utf-8',
    );
    const i = src.indexOf('async function pageUntilDone');
    expect(i, 'pageUntilDone 不见了 —— 本条要重写').toBeGreaterThan(-1);
    const body = src.slice(i, src.indexOf('\n}', i));
    expect(body.length, '切片空了 —— 断言会恒真').toBeGreaterThan(300);
    /** ① 没游标 ② 游标不变 —— 这两条是采集层的本职 */
    expect(body, '不判「没有下一页游标」').toContain('没有下一页游标');
    expect(body, '不判「游标不再变化」').toContain('游标不再变化');
  });
});

/**
 * ⭐⭐⭐ **「停止」要停得住** —— 用户 2026-10-04:
 * 「停止按钮不起作用的,怎么点击停止也不停止?」
 *
 * ⚠️⚠️ 真因:「停止」只发底座的 `scrollStop`,那**只能停滚动**。
 * 一跑有三段,后两段是编排自己的循环(主动翻页 / 逐篇补长文),
 * **听不见** —— 而人点停止时多半正在这两段里。
 */
describe('⭐⭐⭐ 停止要停得住每一段', () => {
  const S2 = 'https://x.com/i/api/graphql/q/SearchTimeline?variables=%7B%7D';
  const mkPage = (id: string, cursor: string): string => JSON.stringify({
    data: { search_by_raw_query: { search_timeline: { timeline: { instructions: [{
      type: 'TimelineAddEntries',
      entries: [
        { entryId: `tweet-${id}`, content: { itemContent: { tweet_results: { result: {
          rest_id: id,
          legacy: { id_str: id, full_text: `推${id}` },
          core: { user_results: { result: { legacy: { screen_name: 'a' } } } },
        } } } } },
        { entryId: 'cursor-bottom', content: { cursorType: 'Bottom', value: cursor } },
      ],
    }] } } } },
  });

  it('⭐⭐⭐ 翻页中途喊停 → **立刻停**,已采到的留着', async () => {
    let n = 0;
    let stopped = false;
    const deps: RunDeps = {
      async harvest(plan) {
        if (plan.gotoPage) return { items: [] };
        return { items: [{ url: S2, text: mkPage(`t${n}`, `c${n}`) }] };
      },
      async runScript() { n += 1; if (n >= 3) stopped = true; return { ok: true }; },
      cancelled: () => stopped,
    };
    const r = await runCollect(deps, { wantPages: 1, depth: 'as-is' });
    expect(n, '喊停了还在翻 —— 「停止」是个摆设').toBe(3);
    expect(r.summary?.items.length, '停下来就把已采的丢了').toBeGreaterThan(0);
  });

  it('⭐⭐⭐ 补长文中途喊停 → **立刻停**(一篇 9 秒,38 篇 6 分钟)', async () => {
    let stopped = false;
    const base = makeDeps({
      listTweets: [
        articleTweet('901', false), articleTweet('902', false), articleTweet('903', false),
      ],
    });
    const calls = base.calls;
    const deps: RunDeps = {
      ...base.deps,
      async harvest(plan) {
        const r = await base.deps.harvest(plan);
        if (plan.gotoPage && calls.filter((c) => c.startsWith('article:')).length >= 2) {
          stopped = true;
        }
        return r;
      },
      cancelled: () => stopped,
    };
    await runCollect(deps, { wantPages: 1, depth: 'full' });
    const tries = calls.filter((c) => c.startsWith('article:')).length;
    expect(tries, '喊停了还在逐篇补 —— 人要干等 6 分钟').toBe(2);
  });

  it('⚠️ 不给 cancelled → 照常跑完(老调用方行为不变)', async () => {
    const { deps, calls } = makeDeps({ listTweets: [articleTweet('901', false)] });
    await runCollect(deps, { wantPages: 1, depth: 'full' });
    expect(calls).toContain('article:901');
  });
});
