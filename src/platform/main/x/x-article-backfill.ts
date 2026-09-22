/**
 * 长文正文逐篇补全 —— 把「只有标题+摘要」的长文补成全文。
 *
 * ── 为什么需要它(2026-09-22 同账号三入口实测)──
 *
 * | 入口 | 接口 | 长文 | 带正文 |
 * |---|---|---|---|
 * | `x.status`(单篇详情页) | `TweetDetail` / `TweetResultByRestId` | 1 | **1 ✅** |
 * | `x.articles`(文章标签页) | `UserArticlesTweets` | 4 | 0 |
 * | `x.profile`(主页) | `UserOriginalsTimeline` | 3 | 0 |
 *
 * ⭐ **正文只在详情页的载荷里** —— 列表页和主页都只给标题+摘要。
 * 这是 X 的设计,不是 bug;要拿全文就**必须逐篇进详情页**。
 *
 * ── 这个模块**不做**什么 ──
 *
 * ⚠️ **不照搬 `fetchArticleReplies`**。那个函数为「把回复翻完」设计:
 * 实测一篇 **76.7 秒 / 23 轮**,而正文在**第一个 `TweetDetail` 响应**里 ——
 * 22 轮全是白滚的。这里靠 `stopWhen` 拿到正文就停。
 *
 * ⚠️ **不碰解析器**。`extractTweetsFrom` 早就会解 `article_results.result.content_state`
 * (2026-09-22 留痕坐实:`TweetDetail` 的 `articlesWithBody:1`)—— 一个字都不用改。
 *
 * ⚠️ **不与 campaign 那条线缠在一起**。`fetchArticleReplies` 走
 * `resolveAnyXWebContents`(无人值守)且只用 role='campaign' 的 ws,跑在另一台机器上;
 * 补正文是**采集侧**的活,走采集侧的 wcId。缠在一起的现象是「活动偶尔抓不到」,极难定位。
 *
 * ── 为什么回填天然安全 ──
 * `upsertTweet` 的 `text` **只许变长**(2026-09-22 落地的合并策略)。
 * 所以这里即便某篇没拿到正文、只拿回标题+摘要,也**不可能**把已有全文写短。
 */

import { harvestTimeline, type HarvestedTweet } from './x-timeline-harvester';
import { upsertTweet, listArticlesMissingBody } from '../db/tweet-inbox-repo';
import { normalizeHandle } from '@shared/types/x-timeline-types';
import { writeBackfillJournal } from './x-collect-journal';

/**
 * 判定「这篇算拿到正文了吗」。
 *
 * ⭐ 判据是 `isLongText` —— 解析器**只在真解出 `content_state` 时**才置真
 * (摘要不算,见 harvester 里 `articleBody` 的注释)。
 *
 * ⚠️ **不能**用「字数变多了」当判据:列表页的摘要也可能比库里的旧值长,
 * 那样会把「还是摘要」误判成「拿到正文了」,下次就不再补它 —— 静默漏掉。
 */
export function gotBody(t: HarvestedTweet): boolean {
  return t.isLongText === true;
}

/** 单篇结果 —— 每一项都要能回答「这篇到底怎么了」 */
export interface BackfillItem {
  tweetId: string;
  authorHandle?: string;
  /** 补之前库里的字数 */
  lenBefore: number;
  /** 这趟采回来的字数(没采到这条推则 undefined) */
  lenAfter?: number;
  /** 拿到正文了吗(isLongText) */
  gotBody: boolean;
  /** 写库了吗 —— ⚠️ 与 gotBody 分开:采到了但写库炸了也要看得见 */
  saved: boolean;
  /** 本篇耗时 */
  elapsedMs: number;
  /** 停止原因(harvester 给的) */
  stopReason?: string;
  /** 这篇为什么没成 —— 空 = 没问题 */
  problem?: string;
}

export interface BackfillReport {
  /** 候选总数(库里 is_article=true 且没正文的) */
  candidates: number;
  /** 本批实际尝试几篇 */
  attempted: number;
  /** 拿到正文的篇数 */
  withBody: number;
  /** 真写进库的篇数 */
  saved: number;
  items: BackfillItem[];
  elapsedMs: number;
  problems: string[];
  notes: string[];
  /** 留痕文件路径 —— 「下次验证不靠人」 */
  journalPath?: string;
}

/**
 * ⭐ 一篇长文的正文补全。
 *
 * @param tweetId 要补的那一篇
 * @param authorHandle 拼详情页 URL 用;没有就用 `i`(X 会自己跳到真作者)
 * @param targetWcId 采集侧的 webContents
 * @param budgetMs 单篇时间闸门
 */
export async function backfillOne(
  tweetId: string,
  authorHandle: string | undefined,
  targetWcId?: number,
  opts: { wsId?: string; budgetMs?: number } = {},
): Promise<{ tweet?: HarvestedTweet; stopReason: string; elapsedMs: number; error?: string }> {
  const t0 = Date.now();
  const h = authorHandle ? normalizeHandle(authorHandle) : '';
  /**
   * ⚠️ handle 缺失时用 `i` —— X 会把 `/i/status/<id>` 重写成 `/{真作者}/status/<id>`。
   * 这与 `x-pages.ts` 的 `x.status` 同一口径,别在这里另起一套。
   */
  const url = `https://x.com/${h || 'i'}/status/${tweetId}`;

  /**
   * ⭐⭐ **拿到正文就停** —— 这是与 `fetchArticleReplies` 最本质的区别。
   *
   * `stopWhen` 在每轮结束时查一次已采到的推,命中即 break。
   * 正文在第一个 `TweetDetail` 响应里,所以正常情况**第一轮就停**。
   *
   * ⚠️ 必须同时判 `tweetId` —— 详情页会连着回复一起下发,
   * 其中任何一条长推都可能 `isLongText=true`,只判 `gotBody` 会**被别人的推文顶掉**,
   * 于是「根本没拿到这一篇的正文」却提前停了(而且看起来是成功的)。
   */
  const r = await harvestTimeline(url, targetWcId, undefined, {
    budgetMs: opts.budgetMs ?? 20_000,
    stopWhen: (t) => t.tweetId === tweetId && gotBody(t),
  });
  if ('error' in r) {
    return { stopReason: 'error', elapsedMs: Date.now() - t0, error: r.error };
  }

  const mine = r.tweets.find((t) => t.tweetId === tweetId);
  return { tweet: mine, stopReason: r.stopReason, elapsedMs: Date.now() - t0 };
}

/**
 * ⭐ 一批长文的正文补全(手动触发,小批上限)。
 *
 * ── 为什么是手动 + 小批(用户 2026-09-22 拍板)──
 * 逐篇进详情页 = 每篇一次导航,X 会限流。所以:
 *  · **不**跟在采集后面自动跑 —— 两件事缠在一起,出事时难定位
 *  · 一次只跑 `limit` 篇,篇与篇之间**随机间隔**
 *
 * ⚠️ 单篇失败**不拦整批**,但也**不静默** —— 每篇的结果都进 `items`。
 */
export async function backfillArticleBodies(
  targetWcId?: number,
  opts: { limit?: number; wsId?: string; budgetMs?: number; handle?: string } = {},
): Promise<BackfillReport> {
  const t0 = Date.now();
  const limit = Math.max(1, Math.min(opts.limit ?? 10, 50));
  const problems: string[] = [];
  const notes: string[] = [];
  const items: BackfillItem[] = [];

  const all = await listArticlesMissingBody({ handle: opts.handle });
  const batch = all.slice(0, limit);

  if (all.length === 0) {
    /**
     * ⚠️ 「一篇候选都没有」有**两种**成因,报告里必须分开说,
     * 否则「功能没生效」会被当成「没什么要补的」(本仓反复踩的「看着成功实际没有」)。
     */
    notes.push('库里没有「是长文但缺正文」的行 —— ⚠️ 注意 `is_article` 是 1.2.7 才加的,'
      + '**存量老行标不上**(采的时候没这个字段),所以这里为 0 也可能只是'
      + '「还没有用新版采过长文」,不等于「都补全了」');
  }

  let withBody = 0;
  let saved = 0;

  for (let i = 0; i < batch.length; i++) {
    const c = batch[i];
    const r = await backfillOne(c.tweet_id, c.author_handle, targetWcId, {
      wsId: opts.wsId, budgetMs: opts.budgetMs,
    });

    const item: BackfillItem = {
      tweetId: c.tweet_id,
      authorHandle: c.author_handle,
      lenBefore: c.len,
      gotBody: false,
      saved: false,
      elapsedMs: r.elapsedMs,
      stopReason: r.stopReason,
    };

    if (r.error) {
      item.problem = `采集失败:${r.error}`;
      problems.push(`${c.tweet_id}: ${r.error}`);
    } else if (!r.tweet) {
      /**
       * ⚠️ 「详情页打开了,但这一篇没解出来」≠「这篇没正文」——
       * 可能是被删/不可见/登录态失效。必须如实区分,别记成「补过了」。
       */
      item.problem = '详情页没解出这条推(可能已删除/不可见/登录态失效)';
      problems.push(`${c.tweet_id}: 详情页没解出这条推`);
    } else {
      item.lenAfter = (r.tweet.text ?? '').length;
      item.gotBody = gotBody(r.tweet);
      if (item.gotBody) withBody += 1;
      else item.problem = '详情页也没给正文(载荷里没有 content_state)';

      try {
        /**
         * ⭐ 走**同一个** `upsertTweet` —— 合并策略(text 只许变长、空值不覆盖非空)
         * 全在那里,这里绝不另写一条写库语句。
         */
        await upsertTweet(toBackfillRecord(r.tweet, opts.wsId));
        item.saved = true;
        saved += 1;
      } catch (err) {
        item.problem = `入库失败:${String(err).slice(0, 160)}`;
        problems.push(`${c.tweet_id}: 入库失败 ${String(err).slice(0, 120)}`);
      }
    }

    items.push(item);

    /**
     * ⚠️ 篇与篇之间随机间隔 —— 逐篇导航是最容易被限流的形态。
     * 最后一篇之后不用等。
     */
    if (i < batch.length - 1) {
      await new Promise((res) => setTimeout(res, 2500 + Math.random() * 2000));
    }
  }

  const shrunk = items.filter((i) => i.lenAfter != null && i.lenAfter < i.lenBefore);
  if (shrunk.length > 0) {
    /**
     * ⭐ 采回来的比库里短是**正常的**(详情页没给正文时只有标题+摘要),
     * 关键是 `upsertTweet` 的 `text` 只许变长 —— 库里那份不会被写短。
     * 如实记下来,免得下次看见「采回来 267 字」以为数据被毁了。
     */
    notes.push(`${shrunk.length} 篇这趟采回来的比库里短 —— **库里那份没被改短**`
      + '(upsertTweet 的 text 只许变长),属正常,不是数据损坏');
  }

  const report: BackfillReport = {
    candidates: all.length,
    attempted: batch.length,
    withBody,
    saved,
    items,
    elapsedMs: Date.now() - t0,
    problems,
    notes,
  };

  if (all.length > batch.length) {
    notes.push(`还有 ${all.length - batch.length} 篇候选没补 —— 小批上限 ${limit} 篇,再点一次继续`);
  }

  report.journalPath = writeBackfillJournal(report);
  return report;
}

/**
 * 长文补全产出 → 写库记录。
 *
 * ⚠️ **刻意只带采集该负责的字段**,`accepted` / `ai_verdict` / `translation`
 * 一个都不碰(覆盖不可逆)。`upsertTweet` 的 ON DUPLICATE 子句本来也不动它们,
 * 这里不传是第二道闸。
 */
function toBackfillRecord(
  t: HarvestedTweet,
  wsId?: string,
): Parameters<typeof upsertTweet>[0] {
  return {
    tweet_id: t.tweetId,
    text: t.text ?? '',
    author_name: t.authorName ?? '',
    author_handle: normalizeHandle(t.authorHandle ?? ''),
    author_name_at_post: t.authorName,
    author_avatar: t.authorAvatar,
    tweet_url: t.tweetUrl,
    conversation_id: t.conversationId,
    /** ⭐ 补正文这趟是从详情页来的,长文标记照样要跟上 */
    is_article: t.isArticle,
    lang: t.lang,
    metrics: t.metrics ?? {},
    fetched_at: new Date().toISOString(),
    created_at: t.createdAt,
    in_reply_to: t.inReplyToStatusId,
    in_reply_to_user: t.inReplyToScreenName,
    source: 'watchlist',
    ws_id: wsId,
    filter_score: 1.0,
    status: 'pending',
  };
}
