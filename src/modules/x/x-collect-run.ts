/**
 * ⭐⭐⭐ **采一页的全流程** —— 采集 → 研判 → 按深度补全 → 核对
 *
 * ── 用户 2026-10-03 定的逻辑(原话)──
 * 「先 tweetid,然后**研判**这个推文是需要 showall 还是需要点击进入 article,
 * 　最后**根据业务的要求**来执行是否要获取全部内容。」
 * 「是否需要逐层获取,**根据采集的要求定下来**就可以了。」
 *
 * ⭐ 为什么是一个模块而不是写在按钮里:
 * 原先这 60 行编排全挤在 JSX 的 onClick 里,再往里加「逐篇补正文」
 * 只会更糟 —— 而且**写在 onClick 里的东西测不了**。
 *
 * ⚠️ 本模块**不碰 Electron、不碰 React**:所有动作经 `RunDeps` 注入,
 * 所以它能在单测里跑完整条链路(含补全循环),不用真机。
 */

import {
  auditTimelinePayload, summarizeAudits, mergeExpandedText,
  type TimelineAudit, type TweetAudit,
} from './x-timeline-audit';
import { judgeTweet, decideFetch, type FetchDepth, type TweetNeed } from './x-fetch-plan';
import { carriesTweets, X_NOISY_URLS, X_PAGE_MATCHERS, X_PAGE_NAME } from './x-pages';
import { X_SCRIPTS } from './x-dom-scripts';

/** ⭐ 一次采集回来的东西 —— 与底座 `HarvestReport` 同形,只取用得上的 */
export type RunHarvest = {
  readonly items: ReadonlyArray<{ readonly url: string; readonly text: string }>;
  readonly afterRound?: readonly unknown[];
  readonly rounds?: number;
  readonly scrolledPx?: number;
  readonly reachedBottom?: boolean;
  readonly stopReason?: string;
};

/**
 * ⭐ 外部动作 —— ⚠️ 全部注入,本模块一个都不自己实现。
 */
export type RunDeps = {
  /** 采当前页(或先去某页再采) */
  harvest(plan: {
    wantPages?: number;
    pageUrlIncludes?: readonly string[];
    noisyUrlSubstrings?: readonly string[];
    afterRoundScriptId?: string;
    maxRounds?: number;
    gotoPage?: { name: string; params?: Record<string, string> };
  }): Promise<RunHarvest | null>;
  /**
   * ⭐⭐ 跑一个**带参数**的预注册脚本(翻页用)。
   * ⚠️ 可选 —— 不给就不主动翻页(老调用方行为不变)。
   */
  runScript?(scriptId: string, params: Record<string, unknown>): Promise<unknown>;
  /**
   * ⭐⭐⭐ **还翻不翻** —— 业务的研判,采集层不替它决定。
   * ⚠️ 不给就一直翻到 X 不给为止(没游标 / 游标不变),只有安全网兜底。
   */
  stopPaging?(state: PagingState): PagingDecision;
  /**
   * ⭐⭐ 回到指定 URL —— 逐篇补完之后用。
   * ⚠️ 可选:没提供就不回(老调用方行为不变),但那样下一轮会从错的页开始。
   */
  goBack?(): Promise<boolean>;
  /** ⭐ 每做完一步报一次 —— 长流程必须让人看见进度 */
  onProgress?(msg: string): void;
};

export type RunResult = {
  readonly audits: readonly TimelineAudit[];
  /**
   * ⭐⭐ **整轮**的响应总数(列表页 + 逐篇长文页)。
   *
   * ⚠️⚠️ 不能用 `harvest.items.length` 当这个数:那只是**第一趟**的。
   * 真机 2026-10-04 的报告因此写出「收到 **20** 条响应,其中 **64** 条是
   * 时间线载荷」—— 64 > 20,一眼假。两个数来自不同的跑,却摆在一句话里。
   */
  readonly totalResponses: number;
  readonly summary: ReturnType<typeof summarizeAudits> | null;
  readonly harvest: RunHarvest | null;
  /** ⭐⭐ 研判与执行的账 —— 三类分开,不许混 */
  readonly plan: {
    readonly depth: FetchDepth;
    readonly todo: readonly TweetNeed[];
    readonly skipped: readonly TweetNeed[];
    readonly impossible: readonly TweetNeed[];
  } | null;
  /** ⭐ 逐篇补正文的结果 —— 成/败都记 */
  readonly fetched: ReadonlyArray<{
    readonly id: string;
    readonly url: string;
    readonly ok: boolean;
    readonly textLen?: number;
    readonly why?: string;
  }>;
};

/** ⚠️ 补全有上限 —— 安全网,不是目标(`feedback-pdca-close-the-loop`) */
const MAX_ARTICLE_FETCH = 50;
/**
 * ⚠️ 再判几轮的**上限** —— 安全网不是目标。
 * ⭐ 正常情况 2~3 轮就没新的了(停止由数据判据定);
 * 这个数只防「每篇都带出新的」那种病态情况把一轮跑无限拖下去。
 */
const MAX_PASSES = 5;

/** ⭐ 从一次 harvest 的响应里解析出核对结果 */
function auditsOf(rep: RunHarvest): TimelineAudit[] {
  /** ⭐ 每轮展开的全文 —— 按「**只许变长**」合并 */
  const merged = new Map<string, string>();
  for (const one of rep.afterRound ?? []) {
    const tweets = (one as { tweets?: Array<{ id: string; text: string }> }).tweets ?? [];
    for (const t of tweets) {
      const prev = merged.get(t.id);
      if (!prev || t.text.length > prev.length) merged.set(t.id, t.text);
    }
  }
  const domList = [...merged.entries()].map(([id, text]) => ({ id, text }));
  return rep.items
    /**
     * ⚠️⚠️ 用 `carriesTweets` **不是** `isTimelineOp`:
     * 补回来的长文走 `TweetResultByRestId` —— 它**带推文但不算一页**。
     * 只用 `isTimelineOp` 筛会把补回来的 38 篇整个筛掉,
     * 跑完 38 趟一条都不进账。**是测试逼出来的,不是我想到的**。
     */
    .filter((it) => carriesTweets(it.url))
    .map((it) => auditTimelinePayload(it.text))
    .map((a) => mergeExpandedText(a, domList));
}

/**
 * ⚠️ 翻页**兜底**轮次 —— 只在调用方没给 `stopPaging` 时用。
 *
 * ⚠️⚠️ 它**不是**「采多少算够」的判据 —— 那是编排的事(见 `PagingDecision`)。
 * 这里只防「X 一直给新游标、程序永远转下去」那种病态情况。
 */
const PAGING_SAFETY_ROUNDS = 200;
/**
 * ⭐⭐⭐ **翻到第几页该不该继续** —— 由**调用方**答,不由采集层答。
 *
 * ── 用户 2026-10-04 定的分界(原话)──
 * 「判断是否停下来是由**业务编排时的研判逻辑**来定,
 * 　而不是你在**采集**中定下来。」
 *
 * ⭐ 采集层只回答一件事:**X 还给不给**(没游标 / 游标不变)。
 * 「够了没有」「值不值得再翻」是业务的判断 —— 不同配方答案不同:
 * 盯人可能要翻到底,热点扫一眼就够。
 *
 * ⚠️⚠️ 我在这上面连栽两次,**两次都是把业务判断写死进采集**:
 * ① `EMPTY_ROUNDS_TO_STOP = 3` —— 连 3 轮没新推就停。
 * 　 真机对照实验证否:窄配方 43 条 / 宽配方 42 条(查询放宽十几倍结果一样),
 * 　 而 **4/4 页都有游标** —— 是刹车踩早了。
 * 　 `project-x-cursor-paging` 早写过:当年这条把 2604 账号卡死在 2244。
 * ② 然后我「改成 12」—— **还是同一个错误**,只是换了个数。
 */
export type PagingDecision = {
  /** ⭐ 还要不要翻下一页 */
  readonly go: boolean;
  /** ⚠️ 不翻了的话**说清为什么** —— 报告要印得出来 */
  readonly why?: string;
};

/** ⭐ 翻完一页之后问调用方:继续吗 */
export type PagingState = {
  /** 已经翻了几轮 */
  readonly round: number;
  /** 到目前为止一共多少条**不重复**推文 */
  readonly uniqueTweets: number;
  /** 这一轮**新增**了几条(0 = 这一页全是见过的) */
  readonly freshThisRound: number;
  /** ⚠️ 连续多少轮没有新的 —— 业务要用它定自己的刹车 */
  readonly emptyRounds: number;
};

/**
 * ⭐⭐⭐ **拿游标一直翻到没有为止**。
 *
 * ⚠️ 停止判据全部来自**数据**,不是猜的次数:
 * ① 没有新游标 → X 说到头了
 * ② 游标和上一轮一样 → 翻不动了(防死循环)
 * ③ 这一轮没解出新推文 → 请求发了但没回数据
 * ⭐ `MAX_PAGE_ROUNDS` 只在以上三条都没触发时兜底。
 *
 * ⭐ 实现上**复用 `harvest`**:发完请求用一次零滚动的 harvest 把响应收回来。
 * ⚠️ 不新开 `peekAcquire`/`wait` 这些 dep —— 那会让这一层多认识底座两件事。
 */
async function pageUntilDone(
  deps: RunDeps,
  audits: readonly TimelineAudit[],
  rep: RunHarvest,
  say: (m: string) => void,
  addResponses: (n: number) => void,
): Promise<TimelineAudit[]> {
  const all = [...audits];
  /**
   * ⭐ 翻页要用**页面自己发过的那条请求** —— queryId 与 features 都在里面,
   * 推不出来也不该写死(随 X 版本变)。
   */
  const seed = rep.items.find((it) => carriesTweets(it.url) && it.url.includes('variables='));
  if (seed === undefined) {
    say('没有可用来翻页的请求 —— 跳过主动翻页');
    return all;
  }

  const seenCursors = new Set<string>();
  /** ⭐ 已经见过的推文 id —— 判「这一轮有没有收到新东西」靠它 */
  const seenTweetIds = new Set<string>();
  for (const a of all) for (const t of a.items) if (t.id) seenTweetIds.add(t.id);
  let emptyRounds = 0;
  let round = 0;
  while (round < PAGING_SAFETY_ROUNDS) {
    /** ⭐ 游标取**最新那一份账**里的,不是第一页的 */
    const cursor = [...all].reverse()
      .map((a) => a.cursor)
      .find((c) => c !== undefined && c !== '');
    if (cursor === undefined) { say(`翻页结束：没有下一页游标（共 ${round} 轮）`); break; }
    /** ⚠️ 同一个游标出现两次 = 翻不动了,**立刻停**,别空转 */
    if (seenCursors.has(cursor)) { say(`翻页结束：游标不再变化（共 ${round} 轮）`); break; }
    seenCursors.add(cursor);

    round += 1;
    say(`主动翻页 第 ${round} 页…`);

    let one: RunHarvest | null;
    try {
      /**
       * ⭐ 一次零滚动的 harvest:它会装腿 → 跑脚本发请求 → 把响应收回来。
       * ⚠️ `maxRounds: 0` —— 这一步**不滚动**,只等响应。
       */
      await deps.runScript!(X_SCRIPTS.fetchNextPage, { url: seed.url, cursor });
      one = await deps.harvest({
        wantPages: 1,
        pageUrlIncludes: X_PAGE_MATCHERS,
        noisyUrlSubstrings: X_NOISY_URLS,
        maxRounds: 0,
      });
    } catch (e) {
      /** ⚠️ 翻页失败**不毁整轮** —— 已经采到的还在 */
      say(`翻页第 ${round} 轮失败：${e instanceof Error ? e.message : String(e)}`);
      break;
    }
    if (one === null) { say(`翻页第 ${round} 轮没收到响应`); break; }

    addResponses(one.items.length);
    const got = auditsOf(one);
    /**
     * ⭐⭐⭐ 判据是「**有没有没见过的推**」,不是「这一页有几条推」。
     *
     * ⚠️⚠️ 真机 2026-10-04 踩到:原先写 `tweets === 0` 就停,
     * 而 X **每页照样回 15 条、却是同一批**(游标也每轮都给新的)——
     * 于是停止条件**永远到不了**,跑满 40 轮上限,
     * 44 页载荷去重后只剩 **42 条推文**(680 原始 → 42)。
     *
     * ⭐ 又是 `feedback-pdca-close-the-loop` 的「数错元素」:
     * 数了「页里有几条」而不是「新收了几条」,该数恒 > 0 等于没在判。
     * ⚠️ `project-x-cursor-paging` 早记过同族:**「几页没新人」不能当到底** ——
     * 反过来「有人」也不能当还有,要看的是**新不新**。
     */
    const before = seenTweetIds.size;
    for (const a of got) {
      for (const t of a.items) if (t.id) seenTweetIds.add(t.id);
    }
    const fresh = seenTweetIds.size - before;
    emptyRounds = fresh === 0 ? emptyRounds + 1 : 0;
    all.push(...got);

    /**
     * ⭐⭐⭐ **问调用方:还翻吗** —— 用户 2026-10-04:
     * 「判断是否停下来是由**业务编排时的研判逻辑**来定,
     * 　而不是你在**采集**中定下来。」
     *
     * ⚠️ 采集层已经把它知道的事实都摆出来了(翻了几轮、共多少条、
     * 这轮新增几条、连续几轮没新的)——**怎么用是业务的事**。
     * ⚠️ 不给 `stopPaging` 就一直翻到 X 不给为止(只有安全网兜底)。
     */
    if (deps.stopPaging) {
      const d = deps.stopPaging({
        round, uniqueTweets: seenTweetIds.size, freshThisRound: fresh, emptyRounds,
      });
      if (!d.go) {
        say(`翻页结束：${d.why ?? '业务判定够了'}（共 ${round} 轮）`);
        break;
      }
    }
  }
  return all;
}

/**
 * ⭐⭐⭐ 采一页 —— **采集 → 研判 → 按深度补全 → 再核对**。
 *
 * ⚠️ 补全回来的正文会**并回核对结果**,否则报告还是说「缺 38 篇」——
 * 「做了」和「账上记着」是两件事(`feedback-pdca-close-the-loop`:
 * 反复执行的循环必须回读真实产出量)。
 */
export async function runCollect(
  deps: RunDeps,
  opts: { wantPages: number; depth: FetchDepth; maxRounds?: number },
): Promise<RunResult> {
  const say = (m: string): void => deps.onProgress?.(m);

  // ── ① 采 ──
  const rep = await deps.harvest({
    wantPages: opts.wantPages,
    pageUrlIncludes: X_PAGE_MATCHERS,
    noisyUrlSubstrings: X_NOISY_URLS,
    afterRoundScriptId: X_SCRIPTS.expandAll,
    maxRounds: opts.maxRounds ?? 60,
  });
  if (!rep) {
    return { audits: [], totalResponses: 0, summary: null, harvest: null, plan: null, fetched: [] };
  }
  /** ⭐ 从第一趟开始累计 —— 后面每补一篇都加上 */
  let totalResponses = rep.items.length;

  /**
   * ⭐⭐⭐ **采完要回到原来那一页** —— 用户 2026-10-03 原话:
   * 「点击进去观看,观看完毕,**点击返回上一下**,继续往下浏览。」
   *
   * ⚠️⚠️ 我上一版只做了前半句。真机后果(四次跑的实测):
   *   推文 97 → 40 → 21,每次都报「滚到底 ✓」
   * 因为每轮跑完都**停在最后一篇长文页**,而「采这一页」采的是当前页 ——
   * 下一次跑时当前页已经不是主页而是一篇文章,自然越采越少。
   * ⭐ 三张截图的地址栏逐次坐实了这一点(停在 /article/…)。
   *
   * ⚠️ 起点由**调用方给**(它知道人选的是哪一页)——
   * 底座的 `harvest` 读不到当前 URL,为此改底座不值当。
   */
  let audits = auditsOf(rep);
  if (audits.length === 0) {
    return { audits, totalResponses, summary: null, harvest: rep, plan: null, fetched: [] };
  }

  /**
   * ── ①.5 **主动翻页** —— 滚动翻不动的页面靠它 ──
   *
   * ⚠️⚠️ 三跑实测:配方搜索每跑只拿到 **1 条 `SearchTimeline`**,而
   * · 不是噪音(挡掉 m3u8 后 6 条响应全干净,仍是 1)
   * · 不是滚动不够(21 条推文约 17000px,实际滚了 **47360px**,早在空滚)
   * · 不是结果就这么多(**报告写「游标 1/1 页有」—— X 自己说还有下一页**)
   * ⭐ 对照 `x.profile` 同样滚 4 万 px 出 **43** 条载荷 ——
   * **个人主页滚动会自动翻页,搜索页不会**,这是 X 的页面差异。
   *
   * ⭐ 做法:拿**页面自己发过的那条请求**(URL 里带 queryId 与 features),
   * 在 `variables` 里塞游标,在页面上下文里 fetch。响应**照常被两条腿捕到**。
   * ⚠️ 停止由**数据判据**定(没有新游标 / 没采到新东西就停),
   * 轮数上限只是安全网(`feedback-pdca-close-the-loop`)。
   */
  if (deps.runScript) {
    audits = await pageUntilDone(deps, audits, rep, say, (n) => { totalResponses += n; });
  }

  // ── ② 研判(只判不做)──
  const uniq = summarizeAudits(audits);
  const needs = uniq.items.map(judgeTweet);
  const decided = decideFetch(needs, opts.depth);
  say(`研判完毕：要补 ${decided.todo.length} 条`
    + `，本次不补 ${decided.skipped.length} 条`
    + `，补不了 ${decided.impossible.length} 条`);

  // ── ③ 按深度执行 ──
  const fetched: RunResult['fetched'] = [];
  /**
   * ⭐ 只有「进单篇页」这条路要在这里跑;
   * `expand-in-place` 已经由 `afterRoundScriptId` 每轮做掉了。
   */
  const extraAudits: TimelineAudit[] = [];
  /** ⭐ 已经试过的 —— 取不到正文的那几篇不许让循环空转 */
  const done = new Set<string>();

  /** ⭐ 补一篇:导航进去、采、回读**那一条**的产出 */
  async function fetchOne(n: TweetNeed, label: string): Promise<void> {
    const url = n.route.kind === 'open-article' ? n.route.url : '';
    done.add(n.id);
    say(`取长文正文 ${label}…`);
    const one = await deps.harvest({
      gotoPage: { name: X_PAGE_NAME.article, params: { articleId: url } },
      wantPages: 1,
      pageUrlIncludes: X_PAGE_MATCHERS,
      noisyUrlSubstrings: X_NOISY_URLS,
      /** ⚠️ 长文是一篇文章,采到正文就停 —— 轮数只是安全网 */
      maxRounds: 8,
    });
    if (!one) {
      (fetched as Array<RunResult['fetched'][number]>).push({
        id: n.id, url, ok: false, why: '导航或采集失败',
      });
      return;
    }
    totalResponses += one.items.length;
    const got = auditsOf(one);
    extraAudits.push(...got);

    const all = got.flatMap((a) => a.items);
    /**
     * ⭐⭐⭐ **只认 `n.id` 那一条** —— 2026-10-04 真机逼出来的。
     *
     * ⚠️⚠️ 原先是 `find(t => t.isArticle && t.incomplete === undefined)` ——
     * **任意一条**有正文的长文都算数。但单篇页载荷里不止一条推
     * (引用的、相关的都在里面),于是面板报「取回 19/19」而报告里只有 17 篇。
     * ⭐ `feedback-pdca-close-the-loop`:「数错元素致该数恒为 0」——
     * 这次是反过来,**数错元素致该数恒为满**,一样等于没在看。
     */
    const hit = all.find((t) => t.id === n.id && t.incomplete === undefined);
    /**
     * ⭐⭐ 失败要说清**是哪一种** —— 一句话盖住多种成因 = 留了痕也等于没留。
     * (真机实证:正是把这句拆开之后,「串轮」那个 bug 当场就露了。)
     */
    (fetched as Array<RunResult['fetched'][number]>).push(hit !== undefined
      ? { id: n.id, url, ok: true, textLen: hit.textLen }
      : {
        id: n.id,
        url,
        ok: false,
        why: one.items.length === 0
          ? '单篇页一条响应都没有 —— 多半没到位或腿没装上'
          : all.length === 0
            ? `收到 ${one.items.length} 条响应但**没有一条带推文** —— 端点判据可能不认`
            : all.some((t) => t.id === n.id)
              ? `载荷里有这一条但**它没正文**（同页另有 ${all.length - 1} 条）`
              : `解出 ${all.length} 条推文但**没有这一条** —— 多半是跳转去了别的页`,
      });
  }

  /**
   * ⭐⭐⭐ **判断-执行-再判断-再执行** —— `feedback-pdca-close-the-loop` 的①。
   *
   * ⚠️⚠️ 原先是「判一次 → 照单做完 → 收工」。真机 2026-10-04 的后果:
   * 面板报「取回长文正文 **38/38**」零失败,报告却说「**缺 19 篇**」——
   * 两个数都对:补长文时**单篇页载荷里还夹着别的长文**(引用的、相关的),
   * 它们被一起收进账,**却从来没被请求过**。
   *
   * ⭐ 停止由**数据判据**定(没有新的要补就停),不由预先猜的次数定;
   * 轮数上限只是安全网。⚠️ 每轮都**回读真实总账**再判,不凭印象。
   */
  let pending = decided.todo.filter((n) => n.route.kind === 'open-article');
  let pass = 0;
  while (pending.length > 0 && done.size < MAX_ARTICLE_FETCH && pass < MAX_PASSES) {
    pass += 1;
    const batch = pending.slice(0, MAX_ARTICLE_FETCH - done.size);
    for (let i = 0; i < batch.length; i += 1) {
      await fetchOne(batch[i], `${i + 1}/${batch.length}` + (pass > 1 ? `（第 ${pass} 轮）` : ''));
    }
    /** ⭐ 拿这一轮之后的**总账**再判一次;已经试过的不再排进来 */
    pending = summarizeAudits([...audits, ...extraAudits])
      .items.map(judgeTweet)
      .filter((n) => n.route.kind === 'open-article' && !done.has(n.id));
    if (pending.length > 0) {
      say(`又冒出 ${pending.length} 篇长文（补的时候带出来的）`);
    }
  }

  /**
   * ── ④ 回到原来那一页 ──
   * ⚠️ 只要**离开过**就要回,哪怕只补了一篇。
   * ⭐ 回不去不算整轮失败(数据已经采到了),但要留痕 ——
   * 下一轮会从错的页开始,人得知道。
   */
  if (done.size > 0 && deps.goBack) {
    say('采完了，回到原来那一页…');
    const back = await deps.goBack();
    if (!back) {
      console.warn('[x.collect] 回不到原页 —— 下一轮会从当前这页开始采');
    }
  }

  // ── ⑤ 把补回来的并进账 ──
  audits = [...audits, ...extraAudits];
  return {
    audits,
    totalResponses,
    /**
     * ⚠️⚠️ 重新汇总 —— 补回来的那几篇必须体现在账上。
     *
     * ⭐ 长文会出现两次(列表页那份 23 字 / 单篇页那份带正文),
     * `summarizeAudits` 去重时**留更全的那份**(只许变长)。
     * ⚠️ 这不是本来就对的:原先「保留先出现的」会把补回来的正文
     * 整个丢掉 —— 跑完 38 趟,报告照样说「缺 38 篇」。
     * 写这个模块时实测证出来的,已在 `summarizeAudits` 里改掉。
     */
    summary: summarizeAudits(audits),
    harvest: rep,
    plan: { depth: opts.depth, ...decided },
    fetched,
  };
}
