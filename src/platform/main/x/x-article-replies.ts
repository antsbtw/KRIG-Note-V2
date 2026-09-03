/**
 * 抓「某篇文章下的回复与引用」—— campaign-tasks 契约(§2)的数据来源。
 *
 * 业务:OTun-M 上线活动任务 2「在置顶文章下回复并附截图」。
 * 判定「有效留言」= kind ∈ {reply, quote} ∧ has_media ∧ !deleted ∧ 时间≥文章发布。
 * 判定在 campaign-tasks 侧做,本模块只**如实提供事实**。
 *
 * ⚠️ 与「某账号的时间线」不是一回事:
 *   时间线按作者取(UserTweets/UserRepliesTimeline);
 *   这里按**会话**取(TweetDetail)—— 打开文章详情页,X 会把整条 conversation
 *   连同各层回复一起下发,`conversation_id_str === article_id` 即属于本文章。
 *
 * ⚠️ 只用 role='campaign' 的 ws(用户 2026-09-03 拍板「一个 ws 只干一件事」)。
 *   跨角色复用会被定时搜索导航打断,现象是「活动偶尔抓不到」,极难定位。
 */

import { harvestTimeline, type HarvestedTweet } from './x-timeline-harvester';
import { normalizeHandle } from '@shared/types/x-timeline-types';

/** 契约 §2.1 的一条 item(字段名保持契约原样,便于直接序列化) */
export interface ArticleReplyItem {
  tweet_id: string;
  kind: 'reply' | 'quote';
  x_uid?: string;
  username: string;
  has_media: boolean;
  created_at: string;
  in_reply_to_tweet_id?: string;
  text_excerpt?: string;
}

export interface ArticleRepliesResult {
  articleId: string;
  items: ArticleReplyItem[];
  /** 本次翻到的条目总数(含不属于本文章的,契约 §3.3 的 fetched) */
  fetched: number;
  /** 命中 hint 的那个人(接口 B 用) */
  hintFound: boolean;
  /** 因 budget 提前返回 */
  partial: boolean;
  elapsedMs: number;
  problems: string[];
}

/**
 * 把 harvester 的产出转成契约 item。
 *
 * 归属判定:`conversationId === articleId` 或直接回复了文章本身。
 * ⚠️ **排除文章自己**(tweetId === articleId)—— 它不是"留言"。
 * ⚠️ **排除 DOM 兜底来源**:DOM 分不清用户上传的图与外链预览卡,
 *    has_media 会不可信,而这个字段直接决定发不发奖励(见 harvester 注释)。
 */
export function toContractItems(
  tweets: HarvestedTweet[],
  articleId: string,
  selfHandle?: string,
): ArticleReplyItem[] {
  const items: ArticleReplyItem[] = [];
  for (const t of tweets) {
    if (t.tweetId === articleId) continue;                 // 文章本身
    if (t.fromDom) continue;                               // has_media 不可信
    if (!t.authorHandle || !t.createdAt) continue;         // 契约必填缺失

    // 自己的回复不算参与(活动是给用户发奖励)
    if (selfHandle && normalizeHandle(t.authorHandle) === normalizeHandle(selfHandle)) continue;

    const isReply = t.conversationId === articleId || t.inReplyToStatusId === articleId;
    const isQuote = t.quotedStatusId === articleId;
    if (!isReply && !isQuote) continue;

    items.push({
      tweet_id: t.tweetId,
      // 同时满足两者时按 reply 记(契约 §4:两种都算,不影响判定)
      kind: isReply ? 'reply' : 'quote',
      x_uid: t.authorRestId,
      username: normalizeHandle(t.authorHandle),
      has_media: t.hasMedia,
      created_at: new Date(t.createdAt).toISOString(),
      in_reply_to_tweet_id: t.inReplyToStatusId,
      text_excerpt: t.text ? t.text.slice(0, 200) : undefined,
    });
  }
  return items;
}

/**
 * 抓一篇文章的回复与引用。
 *
 * @param articleId 文章(置顶 post)的 id
 * @param authorHandle 文章作者(拼详情页 URL 用),即本账号
 * @param opts.hint 正在等结果的用户 —— 翻到就可以提前结束(契约 §3.1)
 * @param opts.budgetMs 时间预算,超了返回 partial(契约 §3.1)
 */
export async function fetchArticleReplies(
  articleId: string,
  authorHandle: string,
  targetWcId?: number,
  opts: { hint?: { x_uid?: string; username?: string }; budgetMs?: number } = {},
): Promise<ArticleRepliesResult | { error: string }> {
  const started = Date.now();
  const h = normalizeHandle(authorHandle);
  if (!articleId) return { error: 'articleId required' };
  if (!h) return { error: 'authorHandle required' };

  const url = `https://x.com/${h}/status/${articleId}`;
  const budgetMs = opts.budgetMs;

  // hint 命中即可停:contract §3.1「翻到这个人的留言就不用把整个评论区抓完」
  const hintUid = opts.hint?.x_uid;
  const hintName = opts.hint?.username ? normalizeHandle(opts.hint.username) : undefined;
  const r = await harvestTimeline(url, targetWcId, undefined, {
    budgetMs,
    stopWhen: (hintUid || hintName)
      ? (t: HarvestedTweet) => {
          if (hintUid && t.authorRestId === hintUid) return true;
          if (hintName && t.authorHandle && normalizeHandle(t.authorHandle) === hintName) return true;
          return false;
        }
      : undefined,
  });
  if ('error' in r) return { error: r.error };

  const items = toContractItems(r.tweets, articleId, h);
  const hintFound = !!(hintUid || hintName) && items.some((i) =>
    (hintUid && i.x_uid === hintUid) || (hintName && i.username === hintName));

  return {
    articleId,
    items,
    fetched: r.tweets.length,
    hintFound,
    partial: r.stopReason.includes('budget') || r.stopReason.includes('hint'),
    elapsedMs: Date.now() - started,
    problems: r.problems,
  };
}
