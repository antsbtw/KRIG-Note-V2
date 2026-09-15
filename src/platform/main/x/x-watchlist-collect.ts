/**
 * ⭐⭐ 盯人采集 —— 追踪名单的调用入口(`agent/Module5-02-x-pipeline.md` §1.2 / §8)
 *
 * ── 为什么这个文件是「可插拔」的**证明**,不只是一个功能 ──
 *
 * §8:「拿 `author-watch` 当第二个实现,**只有第二个接进来时零改动**,
 *      『可插拔』才算被证明。」
 *
 * 本文件**没有一行导航、等待、滚动、判停代码** —— 它只是:
 *   取名单 → 对每人调 `runCollectStrategy(authorWatchStrategy, …)` → 入库
 * 骨架完全复用 keyword 那条已经跑通的路径。
 *
 * ── ⚠️ 这条路此前「四层齐了,唯独采集循环从不存在」 ──
 *
 * | 层 | 状态(改造前) |
 * |---|---|
 * | 存储(`x_author.watched/watch_depth`) | ✅ |
 * | Repo(`watchAuthor`/`listWatched`) | ✅ |
 * | IPC(`X_WATCHLIST`) | ✅ |
 * | UI(`WatchlistView`) | ✅ |
 * | **定时采集** | ❌ **不存在** —— 调度器里只有 `scanRecipe` |
 *
 * 「可以把人加进名单、能看到名单和统计,但**没有任何东西会因为
 *   『他在名单里』而去定期抓他的新推**。」本文件补的就是这一层。
 *
 * ── ⚠️⚠️ 措辞纪律(用户 2026-09-09 纠正过一次)──
 *
 * schema 那条「watchlist 推文**不进 AI 判断队列**」只管**排不排队等 Gemma**,
 * **不管采不采、存不存**。采集/入库层**无条件全采全存**(用户 2026-09-03 定):
 *
 * > 「不要过滤,入库后前端就可以请求了」……原先在**采集层**就把推荐流丢掉,
 * >   结果是**丢掉的永远查不回来**。
 *
 * 一律写「不进判断队列」,**绝不许写成「不采」「过滤掉」「跳过」**。
 */

import { webContents } from 'electron';
import { authorWatchStrategy } from '@capabilities/x-collect';
import { runCollectStrategy } from './x-collect-runner';
import { upsertTweet, getTweetIdSet } from '../db/tweet-inbox-repo';
import { listWatched } from '../db/x-author-repo';
import { normalizeHandle } from '@shared/types/x-timeline-types';
import type { TimelineFilterConfig, TweetInboxRecord } from '@shared/types/x-timeline-types';
import type { XTweetData } from './x-extract-tweet';
import { extractVisibleTweets } from './x-timeline-scan';

/** per-ws abort 标志 —— 与 scanRecipe 各用各的,互不干扰 */
const watchAbortMap = new Map<string, boolean>();

export function abortWatchCollect(wsId: string): void {
  watchAbortMap.set(wsId, true);
}

export interface WatchCollectResult {
  /** 名单里有几个人 */
  authors: number;
  /** 实际跑了几个(被屏蔽的、handle 空的会跳过) */
  visited: number;
  fetched: number;
  saved: number;
  duplicates: number;
  /** 单人失败不影响整批,但要报出来 —— 静默会让「名单里的人悄悄不采了」 */
  failures: Array<{ handle: string; error: string }>;
  elapsedMs: number;
}

/**
 * 跑一遍追踪名单。
 *
 * ⚠️ **单人失败不中止整批**,但**必须记进 failures** ——
 * 一个账号私密/注销是常事,整批中止就太脆;可全都失败而无人知晓更坏
 * (现象是「名单里的人再也没有新推」,查不到原因)。
 */
export async function collectWatchlist(
  wsId: string,
  targetWcId: number,
  filterConfig: TimelineFilterConfig,
): Promise<WatchCollectResult> {
  watchAbortMap.set(wsId, false);
  const startedAt = Date.now();

  const wc = webContents.fromId(targetWcId);
  if (!wc || wc.isDestroyed()) {
    throw new Error(`[x-watchlist-collect] webContents ${targetWcId} not found or destroyed`);
  }

  const watched = await listWatched();
  const result: WatchCollectResult = {
    authors: watched.length, visited: 0, fetched: 0, saved: 0,
    duplicates: 0, failures: [], elapsedMs: 0,
  };
  if (watched.length === 0) {
    result.elapsedMs = Date.now() - startedAt;
    return result;
  }

  // 去重集合取一次,整批共用(同 scanRecipe:x_tweet 全表,含永久行)
  const seenIds = await getTweetIdSet();
  const nowIso = new Date().toISOString();

  for (const w of watched) {
    if (watchAbortMap.get(wsId)) {
      console.log(`[x-watchlist-collect] aborted by user (ws=${wsId})`);
      break;
    }

    const handle = normalizeHandle(w.handle);
    if (!handle) continue;

    // ⚠️ 被屏蔽的人不采 —— 「屏蔽」与「追踪」同时成立时,屏蔽优先。
    //    (两个名单都是人工意志,但屏蔽是「别再给我看他」,更强。)
    if (filterConfig.accountBlacklist.includes(handle)) {
      console.log(`[x-watchlist-collect] @${handle} 在屏蔽名单里,跳过`);
      continue;
    }

    result.visited += 1;

    /**
     * ⚠️ **必须是每人一个局部集合,不能是模块级共享**。
     *
     * 它是 `itemCount` 判停的计数来源:模块级会让「上一个人看过的条数」
     * 算进下一个人的进度 —— 第二个人可能一轮就被判「收够了」。
     * 多 ws 并发时更糟:两个 ws 的计数互相污染,而两边都不报错。
     */
    const perAuthorSeen = new Set<string>();

    try {
      await runCollectStrategy(
        authorWatchStrategy,
        { handle, depth: w.watchDepth },
        wc,
        {
          capture: () => extractVisibleTweets(wc),
          isAborted: () => watchAbortMap.get(wsId) === true,

          /**
           * ⭐ `itemCount` 判停要数「跨轮去重后的条数」,**不是 DOM 元素数**
           * (血泪②:虚拟列表滚过就删,DOM 数不涨反降)。
           * 这里数的是本人这一轮真正新入库 + 已见过的,即「看到了多少条他的推」。
           */
          countOf: () => perAuthorSeen.size,

          onRound: async ({ items }) => {
            const tweets = items as XTweetData[];
            result.fetched += tweets.length;

            for (const t of tweets) {
              if (!t.tweetId) continue;
              perAuthorSeen.add(t.tweetId);

              // ⚠️ 只收**这个人自己**的推:/with_replies 页面上也会出现
              //    他回复的那些原推(别人的),照单全收会把名单外的人也采进来。
              if (normalizeHandle(t.authorHandle ?? '') !== handle) continue;

              if (seenIds.has(t.tweetId)) { result.duplicates += 1; continue; }
              seenIds.add(t.tweetId);

              const record: TweetInboxRecord = {
                tweet_id: t.tweetId,
                text: t.text ?? '',
                author_name: t.authorName ?? '',
                author_handle: handle,
                author_avatar: t.authorAvatar,
                tweet_url: t.tweetUrl,
                lang: t.lang,
                metrics: t.metrics ?? {},
                fetched_at: nowIso,
                created_at: t.createdAt || undefined,
                in_reply_to: t.inReplyTo || undefined,
                in_reply_to_user: t.inReplyToUser || undefined,
                // ⚠️ 不设 TTL(与 scanRecipe 同):X 推文永久保存
                expires_at: undefined,
                source: 'watchlist',
                ws_id: wsId,
                filter_score: 1.0,
                /**
                 * ⭐⭐ `collected` 而**不是** `pending`(用户 2026-09-14 拍板「乙」)。
                 *
                 * schema 那条规则只说了「不置 pending,否则刷爆 Gemma 队列」,
                 * 没说该置什么 —— 于是此前**没有一个状态能表达它**。
                 *
                 * ⚠️ 它**不是**「被过滤掉」:`filtered_out` 语义撒谎且会混进
                 * 「过滤了多少」的统计。这些推**在库里、查得到**,
                 * 只是不排队等 Gemma。
                 */
                status: 'collected',
              };
              await upsertTweet(record);
              result.saved += 1;
            }
          },
        },
      );
    } catch (err) {
      // 单人失败不中止整批,但必须报出来
      const msg = err instanceof Error ? err.message : String(err);
      result.failures.push({ handle, error: msg });
      console.warn(`[x-watchlist-collect] @${handle} 采集失败(继续下一个):`, msg);
    }
  }

  result.elapsedMs = Date.now() - startedAt;
  console.log(
    `[x-watchlist-collect] 名单 ${result.authors} 人,跑了 ${result.visited} 人:`
    + `fetched=${result.fetched} saved=${result.saved} dup=${result.duplicates} `
    + `失败 ${result.failures.length} 人 ${(result.elapsedMs / 1000).toFixed(0)}s`,
  );
  return result;
}
