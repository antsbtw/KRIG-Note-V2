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
import { upsertTweet } from '../db/tweet-inbox-repo';
import { normalizeHandle } from '@shared/types/x-timeline-types';
import { isAborted } from './x-collect-abort';

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

/**
 * ⭐⭐ **采集时当场补全长文正文** —— 由 `autoCollect` 在推文入库后直接调用。
 *
 * ── 为什么是这个形态(用户 2026-09-22 拍板)──
 *
 * 此前做成了「先采一次标记 `is_article` → 再点另一个按钮从库里找候选」两步。
 * 用户问「为什么要操作两步,你的目的是什么」,一句点破:
 * **那一步是在伺候实现,不是在完成目标** —— 它既不给正文、也不是人想做的事,
 * 纯粹是为了喂饱「从库里查候选」这个设计;而且**存量老行永远补不上**
 * (`is_article` 是新字段,老行标不上)。
 *
 * ⭐ 当场补就没有这个问题:**采到哪篇就补哪篇**,不经过库里的标记,
 * 存量行重采一次照样补得上。
 *
 * ⚠️ 判据是 `isArticle && !gotBody` —— 只补**这一趟真采到、且确实缺正文**的。
 * 详情页来的、以及长推(note_tweet),`isLongText` 本来就为真,不会白跑一趟。
 *
 * ⚠️ **绝不上抛**:推文已经入库了,补正文是**增量**。
 * 这里出错只记 problems,不让整趟采集翻案(纲领铁律②「降级要局部」)。
 *
 * @returns 没有要补的返回 undefined(⭐ 与「补了但全失败」区分开)
 */
export async function backfillArticlesInline(
  tweets: ReadonlyArray<HarvestedTweet>,
  targetWcId?: number,
  wsId?: string,
): Promise<{ note: string; problems: string[]; saved: number; items: BackfillItem[] } | undefined> {
  /** ⚠️ 只要「是长文」且「没拿到正文」的 —— 详情页来的已经有了,不重复跑 */
  const need = tweets.filter((t) => t.isArticle && !gotBody(t) && t.tweetId);
  if (need.length === 0) return undefined;

  /**
   * ⭐⭐ **这一页有几篇就采几篇 —— 没有上限。**
   *
   * ── 用户 2026-09-22 定的 ──
   * > 「长正文就不应该补,应该一次采集完毕。」
   *
   * 原来设了单趟 10 篇上限,超出的留给一个「补漏」按钮。
   * ⚠️ 那是**把半成品留给人去收尾** —— 而且正因为有上限,
   * 才需要那个按钮、才需要「从库里查候选」那一整套。
   * 用户点破后连按钮带查库一起删了:**采集就该一次采全**。
   *
   * ⚠️ 限流的风险靠**篇与篇之间的随机间隔**压,不靠少采 ——
   * 少采换来的是「看着成功实际没采全」,那是本仓最忌的形态。
   * ⚠️ 真出问题时:单篇失败不拦后面的,每篇都进 items 和 problems,
   * 报告里看得见是哪一篇、为什么。
   */
  const batch = need;

  const problems: string[] = [];
  const items: BackfillItem[] = [];
  let saved = 0;
  let withBody = 0;

  /** ⭐ 人按了停 —— 如实记下停在第几篇,不假装补完了 */
  let abortedAtIndex: number | undefined;

  for (let i = 0; i < batch.length; i++) {
    /**
     * ⚠️⚠️ **每一篇之前都要问一次** —— 用户 2026-09-22 提的暂停键。
     * 只在整批开始时问一次等于没有暂停:实测 261 篇要跑 43 分钟,
     * 人按了停却还要等半小时,那个按钮就是摆设。
     */
    if (isAborted(wsId)) { abortedAtIndex = i; break; }
    const t = batch[i];
    const lenBefore = (t.text ?? '').length;
    const item: BackfillItem = {
      tweetId: t.tweetId,
      authorHandle: t.authorHandle,
      lenBefore,
      gotBody: false,
      saved: false,
      elapsedMs: 0,
    };

    try {
      const r = await backfillOne(t.tweetId, t.authorHandle, targetWcId, { wsId });
      item.elapsedMs = r.elapsedMs;
      item.stopReason = r.stopReason;

      if (r.error) {
        item.problem = `补正文失败:${r.error}`;
        problems.push(`长文 ${t.tweetId} 补正文失败:${r.error}`);
      } else if (!r.tweet) {
        item.problem = '详情页没解出这条推(可能已删除/不可见/登录态失效)';
        problems.push(`长文 ${t.tweetId}:详情页没解出这条推`);
      } else {
        item.lenAfter = (r.tweet.text ?? '').length;
        item.gotBody = gotBody(r.tweet);
        if (item.gotBody) withBody += 1;
        /**
         * ⭐ 走同一个 `upsertTweet` —— `text` 只许变长的合并策略全在那里。
         * 所以即便这趟没拿到正文,也**不可能**把已有全文写短。
         */
        await upsertTweet(toBackfillRecord(r.tweet, wsId));
        item.saved = true;
        saved += 1;
      }
    } catch (err) {
      /** ⚠️ 单篇炸了不拦后面的,也不拦采集 —— 但不静默 */
      item.problem = `补正文异常:${String(err).slice(0, 160)}`;
      problems.push(`长文 ${t.tweetId} 补正文异常:${String(err).slice(0, 120)}`);
    }

    items.push(item);
    /** ⚠️ 篇与篇之间随机间隔 —— 逐篇导航最容易撞限流 */
    if (i < batch.length - 1) {
      await new Promise((res) => setTimeout(res, 2500 + Math.random() * 2000));
    }
  }

  /**
   * ⚠️⚠️ 「人停的」与「补完了」**绝不能长得一样** ——
   * 否则报告会把「才补了 80/261」说成「这一页补完了」。
   */
  if (abortedAtIndex !== undefined) {
    problems.push(`⏸ 补长文正文**被人停下**:补了 ${abortedAtIndex}/${batch.length} 篇,`
      + `**剩下 ${batch.length - abortedAtIndex} 篇没补** —— 不是补完了`);
  }

  const lens = items
    .filter((i) => i.lenAfter != null)
    .map((i) => `${i.lenBefore}→${i.lenAfter}${i.gotBody ? '✓' : '✗'}`)
    .join(' · ');

  /**
   * ⭐ 这句话要能**单独回答「补上了没有」** —— 报告会截断,要紧的写在前面。
   * ⚠️ 「试了几篇」与「拿到正文几篇」分开说:两者相等才是全成。
   */
  /**
   * ⭐ 「几篇缺正文」与「拿到几篇」必须分开说 —— 两者相等才是全成。
   * ⚠️ 不相等时 problems 里有逐篇原因,别只看这一句。
   */
  const note = `长文正文:这一页 ${need.length} 篇长文缺正文,`
    + `逐篇进详情页取回 **${withBody}/${need.length} 篇**`
    + (lens ? `(字数 ${lens})` : '')
    + (abortedAtIndex !== undefined
      ? ` ⏸ **被人停下**(剩 ${batch.length - abortedAtIndex} 篇没补)`
      : withBody < need.length ? ' ⚠️ **没取全,见 problems**' : '');


  return { note, problems, saved, items };
}
