/**
 * ⭐⭐ 无人工采集 —— **不用点击就能拿到**
 *
 * ── 用户 2026-09-18 定的要求 ──
 *
 * > 「我的建议是不用点击就有办法拿到蓝V关系,这是我们反复调试的。
 * >   而不是我点击推文进来才可以拿。」
 *
 * 实测确认过的事实链:
 *  · 关注关系/蓝V **在时间线载荷里就有**(`relationship_perspectives`),零额外请求
 *  · 但**要有新载荷**才截得到 —— 页面早就渲染好的推不会重新请求
 *  · 悬停弹卡片零网络请求(用户的操作流证实)→ 数据在前端内存,磁盘上没有
 *
 * ⭐ 所以正解不是"等人操作",是**主动导航一次** ——
 * 导航必然触发 HomeTimeline/UserTweets 载荷,字段自然全。
 *
 * ── 与既有采集路径的分工 ──
 *
 * | | 走哪条 | 字段 |
 * |---|---|---|
 * | `x-timeline-scan`(配方采集) | DOM 提取 | 少(无关系/会话串/restId) |
 * | **本文件** | **载荷** | 全 |
 *
 * ⚠️ 本文件**不替换**配方采集,只补「作者维度」这一块 ——
 * 那正是盘点里最缺的(bio 2%、关系 2%、会话串 11%)。
 *
 * ── 纪律 ──
 *
 * ⚠️ **采集层无条件全收**(用户既定铁律:「丢掉的永远查不回来」)——
 * 本文件不做任何内容过滤,判断是后面编排的事。
 * ⚠️ **只写库,不判断**:它是取数执行者,不是判决者。
 */

import { harvestTimeline, type HarvestedTweet } from './x-timeline-harvester';
import { upsertTweet } from '../db/tweet-inbox-repo';
import { saveAuthorCounts } from '../db/x-author-repo';
import { normalizeHandle, type TweetInboxRecord } from '@shared/types/x-timeline-types';

export interface AutoCollectReport {
  url: string;
  /** 采到多少条推(载荷 + DOM 并集后) */
  tweets: number;
  /** 其中真从载荷来的(字段全) */
  fromPayload: number;
  /** 入库成功的条数 */
  saved: number;
  /** ⭐ 采到关系数据的作者数 —— 这正是「不用点击就能拿到」的成果 */
  authorsWithRelation: number;
  /** 采到 bio 的作者数 */
  authorsWithBio: number;
  /** 载荷条数;0 说明导航没触发请求(页面可能用了缓存) */
  payloads: number;
  problems: string[];
  stopReason: string;
  elapsedMs: number;
}

/** `HarvestedTweet` → 入库记录。⚠️ 载荷字段**一个都不丢** */
function toRecord(t: HarvestedTweet, wsId?: string): TweetInboxRecord {
  return {
    tweet_id: t.tweetId,
    text: t.text ?? '',
    author_name: t.authorName ?? '',
    // ⚠️ 存归一化形态 —— 与 x_author.handle 一致,漂移会让关联恒查不到且不报错
    author_handle: normalizeHandle(t.authorHandle ?? ''),
    author_avatar: t.authorAvatar,
    tweet_url: t.tweetUrl,
    lang: t.lang,
    metrics: t.metrics ?? {},
    fetched_at: new Date().toISOString(),
    created_at: t.createdAt,
    // ⭐ 载荷独有的三样 —— 盘点里最缺的正是这些
    in_reply_to: t.inReplyToStatusId,
    in_reply_to_user: t.inReplyToScreenName,
    source: 'watchlist',
    ws_id: wsId,
    filter_score: 1.0,
    status: 'pending',
  };
}

/**
 * 跑一次无人工采集。
 *
 * @param url 目标页面(首页时间线 / 某人主页 / 搜索结果都行)
 * @param targetWcId X webview 的 wcId
 * @param opts.maxRounds 滚动轮数上限 —— **是参数不是常量**(用户定过)
 */
export async function autoCollect(
  url: string,
  targetWcId?: number,
  opts: { maxRounds?: number; budgetMs?: number; wsId?: string } = {},
): Promise<AutoCollectReport | { error: string }> {
  const t0 = Date.now();

  // ⭐ 导航 + 滚动 + 解析载荷,一条龙 —— 现成的,不重写
  const r = await harvestTimeline(url, targetWcId, opts.maxRounds ?? 8, {
    budgetMs: opts.budgetMs ?? 30_000,
  });
  if ('error' in r) return { error: r.error };

  let saved = 0;
  let authorsWithRelation = 0;
  let authorsWithBio = 0;
  const seenAuthors = new Set<string>();

  for (const t of r.tweets) {
    if (!t.tweetId) continue;

    // ── 推文入库(全收,不过滤)──
    try {
      await upsertTweet(toRecord(t, opts.wsId));
      saved += 1;
    } catch (err) {
      // ⚠️ 单条失败不拦整批 —— 但**不静默**:一条都存不进去要看得出来
      console.warn(`[x-auto-collect] 推文 ${t.tweetId} 入库失败:`, err);
    }

    // ── 作者维度:关系 / 蓝V 入库 ──
    const h = normalizeHandle(t.authorHandle ?? '');
    if (!h || seenAuthors.has(h)) continue;
    seenAuthors.add(h);

    /**
     * ⚠️ 只在**确实取到**时才写,`undefined` 一律不写 ——
     * 「载荷没带这个字段」与「查过了,是 false」含义相反,
     * 混起来会让追踪名单判错人(记忆 feedback-check-sample-contains-phenomenon)。
     */
    const hasRelation = t.iFollow !== undefined || t.followsMe !== undefined;
    if (!hasRelation && t.isBlueVerified === undefined) continue;

    try {
      await saveAuthorCounts(h, {
        iFollow: t.iFollow,
        followsMe: t.followsMe,
        isBlueVerified: t.isBlueVerified,
      });
      if (hasRelation) authorsWithRelation += 1;
    } catch (err) {
      console.warn(`[x-auto-collect] 作者 ${h} 入库失败:`, err);
    }
  }

  const fromPayload = r.tweets.filter((t) => !t.fromDom).length;

  return {
    url: r.url,
    tweets: r.tweets.length,
    fromPayload,
    saved,
    authorsWithRelation,
    authorsWithBio,
    payloads: r.payloads,
    problems: r.problems,
    stopReason: r.stopReason,
    elapsedMs: Date.now() - t0,
  };
}
