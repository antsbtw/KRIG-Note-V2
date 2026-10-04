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

  let audits = auditsOf(rep);
  if (audits.length === 0) {
    return { audits, totalResponses, summary: null, harvest: rep, plan: null, fetched: [] };
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
  const articles = decided.todo.filter((n) => n.route.kind === 'open-article');
  const capped = articles.slice(0, MAX_ARTICLE_FETCH);
  const extraAudits: TimelineAudit[] = [];

  for (let i = 0; i < capped.length; i += 1) {
    const n = capped[i];
    const url = n.route.kind === 'open-article' ? n.route.url : '';
    say(`取长文正文 ${i + 1}/${capped.length}…`);
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
      continue;
    }
    totalResponses += one.items.length;
    const got = auditsOf(one);
    extraAudits.push(...got);
    /**
     * ⭐⭐ **回读真实产出** —— 不是「跑完了」就算成,
     * 要这一篇的正文**真的变长了**才算
     * (`feedback-pdca-close-the-loop`:我踩过「数错元素致该数恒为 0」)。
     */
    const all = got.flatMap((a) => a.items);
    const hit = all.find((t) => t.isArticle && t.incomplete === undefined);
    /**
     * ⭐⭐ 失败要说清**是哪一种** —— 2026-10-04 真机 38 篇里 2 篇失败,
     * 而「进去了但没解出正文」这一句**三种成因都盖住了**,
     * 看了也不知道该查哪:页面没载荷 / 载荷里没推文 / 有推文但没正文。
     * ⚠️ 一句话盖住多种成因 = 留了痕也等于没留。
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
            : `解出 ${all.length} 条推文但**都没正文** —— 这一篇可能真的没给 content_state`,
      });
  }

  // ── ④ 把补回来的并进账 ──
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
