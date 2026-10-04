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
