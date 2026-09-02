/**
 * X 时间线智能筛选 — 搜索配方驱动的批量推文采集（Phase 1）
 *
 * 铁律遵守：
 * 1. webview 操作通过 requireXWebContents（web-service-base），不自己包 executeJavaScript
 * 3. 采集/注入失败 → throw（fail loud）
 * 4. 本 Phase 无写推文操作
 */

import { webContents } from 'electron';
import { TWEET_SCRAPE_FN_BODY } from '../tweet-fetcher/extract-script';
import { upsertTweet, insertFilteredOut, getTweetIdSet } from '../db/tweet-inbox-repo';
import { googleTranslateBatch } from './google-translate';
import type { XTweetData } from './x-extract-tweet';
import { normalizeHandle } from '@shared/types/x-timeline-types';
import type {
  SearchRecipe,
  TimelineFilterConfig,
  TweetInboxRecord,
} from '@shared/types/x-timeline-types';


/** per-ws abort 标志（wsId → abort） */
const scanAbortMap = new Map<string, boolean>();

export function abortScan(wsId: string): void {
  scanAbortMap.set(wsId, true);
}

/**
 * 从上次运行时间推算搜索起点 —— **叠加 48 小时**。
 *
 * 用户 2026-09-02:「搜索完毕,就往下滚动,采用叠加方式,比上一次的最后时间
 * 多叠加 48 个小时。所有的缓存做比对,就能够获取需要的帖子了。」
 *
 * 为什么必须叠加(而不是从 lastRunAt 精确接上):
 *  · X 的搜索索引有延迟 —— 一条推可能在发布几小时后才进入 since: 的结果
 *  · 采集本身可能中断/失败,那段窗口就永久丢了
 *  · since: 只精确到**天**(X 的语法限制),边界本就模糊
 * 重叠抓回来的靠 tweet_id 去重(seenIds + INSERT IGNORE),成本只是多滚几屏,
 * 换来的是**不漏**。宁可重复,不可遗漏。
 *
 * 没有 lastRunAt(首次运行)→ 回落到 recipe.sinceHours。
 */
export function computeSinceDate(recipe: SearchRecipe, overlapHours = 48): Date {
  if (recipe.lastRunAt) {
    const last = new Date(recipe.lastRunAt).getTime();
    if (Number.isFinite(last)) {
      return new Date(last - overlapHours * 3_600_000);
    }
  }
  return new Date(Date.now() - (recipe.sinceHours ?? 24) * 3_600_000);
}

/** 按 SearchRecipe 拼装 X 搜索 URL */
export function buildSearchUrl(recipe: SearchRecipe): string {
  const parts: string[] = [];

  if (recipe.keywords?.length) {
    parts.push(`(${recipe.keywords.map((k) => `"${k}"`).join(' OR ')})`);
  }

  if (recipe.fromAccounts?.length) {
    parts.push(`(${recipe.fromAccounts.map((a) => `from:${a}`).join(' OR ')})`);
  }

  if (recipe.template === 'help-wanted' && recipe.helpSignals?.length) {
    parts.push(`(${recipe.helpSignals.map((s) => `"${s}"`).join(' OR ')})`);
  }

  if (recipe.minLikes) parts.push(`min_faves:${recipe.minLikes}`);
  if (recipe.minRetweets) parts.push(`min_retweets:${recipe.minRetweets}`);
  if (recipe.lang) parts.push(`lang:${recipe.lang}`);

  // ⚠️ 起点从**上次运行时间往前推 48h**,不是从「现在往前 24h」——
  // 后者与上次运行毫无关系:app 关两天,那两天的窗口就永久丢了。
  const sinceStr = computeSinceDate(recipe).toISOString().split('T')[0];
  parts.push(`since:${sinceStr}`);

  const q = encodeURIComponent(parts.join(' '));
  const f = recipe.resultType === 'top' ? 'top' : 'live';
  return `https://x.com/search?q=${q}&f=${f}`;
}

/** 本地漏斗 L1-L4 */
export function applyFilter(
  tweet: XTweetData,
  config: TimelineFilterConfig,
  seenIds: Set<string>,
): { pass: boolean; reason?: string } {
  // L1 黑名单
  if (config.keywordBlacklist.some((kw) => tweet.text?.includes(kw))) {
    return { pass: false, reason: 'keyword_blacklist' };
  }
  // ⚠️ 必须归一化后再比:库里 authorHandle 是 '@Miekko22'(带 @、保留大小写),
  // 而 accountBlacklist 按契约存的是归一化形态。少这一步 = 屏蔽恒不命中且不报错。
  if (tweet.authorHandle && config.accountBlacklist.includes(normalizeHandle(tweet.authorHandle))) {
    return { pass: false, reason: 'account_blacklist' };
  }

  // L2 语言
  if (config.allowedLangs.length && tweet.lang && !config.allowedLangs.includes(tweet.lang)) {
    return { pass: false, reason: 'lang_filter' };
  }

  // L3 互动阈值
  if ((tweet.metrics?.likes ?? 0) < config.minLikes) {
    return { pass: false, reason: 'min_likes' };
  }
  if ((tweet.metrics?.retweets ?? 0) < config.minRetweets) {
    return { pass: false, reason: 'min_retweets' };
  }

  // L4 去重
  if (!tweet.tweetId || seenIds.has(tweet.tweetId)) {
    return { pass: false, reason: 'duplicate' };
  }

  return { pass: true };
}

/**
 * 等待 X 页面推文元素出现（poll，最多 10s）。
 * 失败 → throw（fail loud）。
 */
async function waitForTweetElements(wc: Electron.WebContents, timeoutMs = 10_000): Promise<void> {
  const script = `document.querySelectorAll('article[data-testid="tweet"]').length`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await wc.executeJavaScript(script);
    if (typeof count === 'number' && count > 0) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('[x-timeline-scan] timeout waiting for tweet elements after 10s');
}

/** 在 webContents 内批量提取当前可见推文（复用 TWEET_SCRAPE_FN_BODY） */
async function extractVisibleTweets(wc: Electron.WebContents): Promise<XTweetData[]> {
  const script = `
    (function() {
      ${TWEET_SCRAPE_FN_BODY}
      try {
        var articles = document.querySelectorAll('article[data-testid="tweet"]');
        var results = [];
        for (var i = 0; i < articles.length; i++) {
          try { results.push(scrapeTweetArticle(articles[i])); } catch(e) {}
        }
        return results;
      } catch(e) {
        return [];
      }
    })()
  `;
  const raw = await wc.executeJavaScript(script);
  if (!Array.isArray(raw)) {
    throw new Error('[x-timeline-scan] extractVisibleTweets returned non-array');
  }
  return raw as XTweetData[];
}

export interface ScanResult {
  fetched: number;
  saved: number;
  filteredOut: number;
}

/**
 * 执行一次完整的搜索配方采集。
 *
 * @param recipe          搜索配方
 * @param wsId            workspace id（per-ws abort 定向）
 * @param targetWcId      X Host guest webContents id（per-ws 定向，fail loud 不回退全局）
 * @param filterConfig    漏斗配置
 * @param onPendingReady  每批写库后通知，供调度器决定是否触发 AI 判断
 * @param maxScrollRounds 最大翻页轮次（默认 5，约 50 条）
 */
export async function scanRecipe(
  recipe: SearchRecipe,
  wsId: string,
  targetWcId: number,
  filterConfig: TimelineFilterConfig,
  onPendingReady?: (pendingCount: number) => void,
  maxScrollRounds = 5,
): Promise<ScanResult> {
  scanAbortMap.set(wsId, false);

  const wc = webContents.fromId(targetWcId);
  if (!wc || wc.isDestroyed()) {
    throw new Error(`[x-timeline-scan] webContents ${targetWcId} not found or destroyed`);
  }

  const searchUrl = buildSearchUrl(recipe);
  console.log(`[x-timeline-scan] navigating to: ${searchUrl}`);

  // 导航到搜索页
  wc.loadURL(searchUrl);
  await waitForTweetElements(wc);

  // 预加载去重窗口内已有的 tweet_id
  // 去重集合来自 x_tweet 全表(含 expires_at=NONE 的永久行) —— 采纳过的推文
  // 不会因为过期而"消失"再被重新抓回来(A 期修掉的重复爬根因)。
  const seenIds = await getTweetIdSet();

  let fetched = 0;
  let saved = 0;
  let filteredOut = 0;
  const nowIso = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();

  for (let round = 0; round < maxScrollRounds; round++) {
    if (scanAbortMap.get(wsId)) {
      console.log(`[x-timeline-scan] aborted by user (ws=${wsId})`);
      break;
    }

    const tweets = await extractVisibleTweets(wc);
    fetched += tweets.length;

    const pendingBatch: TweetInboxRecord[] = [];

    for (const tweet of tweets) {
      const { pass, reason } = applyFilter(tweet, filterConfig, seenIds);

      if (!pass) {
        // filtered_out 也写库（供 V4 统计分布），但 tweetId 缺失的静默跳过（无法去重）
        if (tweet.tweetId && reason !== 'duplicate') {
          await insertFilteredOut({
            tweet_id: tweet.tweetId,
            text: tweet.text ?? '',
            author_name: tweet.authorName ?? '',
            // ⚠️ 存归一化形态(migration 1.0.2 统一):不归一化则同一人被算成两个
            author_handle: normalizeHandle(tweet.authorHandle ?? ''),
            author_avatar: tweet.authorAvatar,
            tweet_url: tweet.tweetUrl,
            lang: tweet.lang,
            metrics: tweet.metrics ?? {},
            fetched_at: nowIso,
            created_at: tweet.createdAt || undefined,
            in_reply_to: tweet.inReplyTo || undefined,
            expires_at: expiresAt,
            source: 'search',
            search_recipe: recipe.id,
            filter_reason: reason ?? 'unknown',
            replied_at: undefined,
            reply_draft: undefined,
          });
          seenIds.add(tweet.tweetId);
          filteredOut++;
        }
        continue;
      }

      seenIds.add(tweet.tweetId!);
      const record: TweetInboxRecord = {
        tweet_id: tweet.tweetId!,
        text: tweet.text ?? '',
        author_name: tweet.authorName ?? '',
        // ⚠️ 同上:存归一化形态,与 x_author.handle / normalizeHandle 一致
        author_handle: normalizeHandle(tweet.authorHandle ?? ''),
        author_avatar: tweet.authorAvatar,
        tweet_url: tweet.tweetUrl,
        lang: tweet.lang,
        metrics: tweet.metrics ?? {},
        fetched_at: nowIso,
        // A':extract-script 早就提取了这两个字段(:75 / :147),此前组装记录时漏带 —— 只是接线
        created_at: tweet.createdAt || undefined,
        in_reply_to: tweet.inReplyTo || undefined,
        expires_at: expiresAt,
        source: 'search',
        search_recipe: recipe.id,
        ws_id: wsId,
        filter_score: 1.0,
        status: 'pending',
      };
      pendingBatch.push(record);
    }

    // 对非中文推文批量翻译（Google 翻译，失败条目静默跳过，不阻断采集）
    const toTranslate = pendingBatch
      .filter((r) => r.lang && r.lang !== 'zh')
      .map((r) => ({ tweetId: r.tweet_id, text: r.text }));
    if (toTranslate.length > 0) {
      const translations = await googleTranslateBatch(toTranslate);
      for (const r of pendingBatch) {
        const t = translations.get(r.tweet_id);
        if (t) r.translation = t;
      }
    }

    // 批量写库
    for (const r of pendingBatch) {
      await upsertTweet(r);
      saved++;
    }

    if (pendingBatch.length > 0) {
      onPendingReady?.(saved);
    }

    // 滚动加载更多
    if (round < maxScrollRounds - 1) {
      await wc.executeJavaScript(`window.scrollBy(0, 1500)`);
      // 短暂等待懒加载
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  console.log(
    `[x-timeline-scan] recipe="${recipe.name}" fetched=${fetched} saved=${saved} filteredOut=${filteredOut}`,
  );
  return { fetched, saved, filteredOut };
}
