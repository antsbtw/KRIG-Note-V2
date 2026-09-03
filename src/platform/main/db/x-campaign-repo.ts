/**
 * x_campaign_reply 表 CRUD —— 活动留言入库(2026-09-03)
 *
 * 用户定的流程第 ③ 步:「元数据入库,按照数据契约提供服务即可」。
 *
 * 调用边界:仅 main 进程。走 **X 库(krig_x)**,用 getXDB()。
 *
 * 幂等键 = 契约 §2.1 的 (article_id, tweet_id) —— 「重复推送只更新、不新增」。
 * 表里额外记推送状态,因为契约 §2.3 要求「爬虫重启后把上次未确认成功的
 * 批次重推一遍」—— 没有 pushed_at 就不知道哪些没推成功。
 */

import { createHash } from 'node:crypto';
import { getXDB } from '@storage/surreal/client';
import { normalizeHandle } from '@shared/types/x-timeline-types';
import type { ArticleReplyItem } from '../x/x-article-replies';

/** 入库结果 —— 与契约响应的 accepted/updated 语义对齐,便于观测 */
export interface UpsertResult {
  /** 新增 */
  inserted: number;
  /** 已存在且**内容有变**(如 has_media 由 false 变 true、deleted) */
  changed: number;
  /** 已存在且内容一致 —— 不必重推 */
  unchanged: number;
}

/**
 * 内容指纹:只覆盖**会影响判定或展示**的字段。
 *
 * 为什么要指纹:契约区分 accepted / updated,而「更新了什么」只能靠比对。
 * last_seen_at 每次都变,不能进指纹 —— 否则每次采集都判成「变了」而重推,
 * 白白打爆对方接口。
 */
function payloadHash(it: ArticleReplyItem, deleted: boolean): string {
  const key = JSON.stringify([
    it.kind, it.x_uid ?? '', it.username, it.has_media,
    it.created_at, it.in_reply_to_tweet_id ?? '', deleted,
  ]);
  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}

/**
 * 批量入库(幂等)。
 *
 * ⚠️ 只更新**内容字段与 last_seen_at**,不动 pushed_at ——
 * 推送成功与否由 markPushed 单独维护。内容变了要重推,
 * 所以变更时把 pushed_at 清成 NONE(见下)。
 */
export async function upsertCampaignReplies(
  articleId: string,
  items: ArticleReplyItem[],
): Promise<UpsertResult> {
  if (!articleId) throw new Error('[x-campaign-repo] articleId required');
  const db = getXDB();
  const res: UpsertResult = { inserted: 0, changed: 0, unchanged: 0 };

  for (const it of items) {
    if (!it.tweet_id || !it.username || !it.created_at) continue;   // 契约必填缺失
    const hash = payloadHash(it, false);

    const existing = await db.query<[Array<{ payload_hash?: string }>]>(
      `SELECT payload_hash FROM x_campaign_reply
       WHERE article_id = $a AND tweet_id = $t LIMIT 1`,
      { a: articleId, t: it.tweet_id },
    );
    const row = existing[0]?.[0];

    const params = {
      a: articleId, t: it.tweet_id,
      kind: it.kind, uid: it.x_uid || undefined, username: it.username,
      media: it.has_media, created: new Date(it.created_at),
      parent: it.in_reply_to_tweet_id || undefined,
      excerpt: it.text_excerpt || undefined,
      hash,
    };

    if (!row) {
      await db.query(
        `CREATE x_campaign_reply SET
          article_id = $a, tweet_id = $t, kind = $kind, x_uid = $uid,
          username = $username, has_media = $media, created_at = $created,
          in_reply_to_tweet_id = $parent, text_excerpt = $excerpt,
          deleted = false, payload_hash = $hash,
          first_seen_at = time::now(), last_seen_at = time::now(),
          pushed_at = NONE`,
        params,
      );
      res.inserted++;
    } else if (row.payload_hash !== hash) {
      // 内容变了 → 更新并**清 pushed_at**,让它重新进待推队列
      await db.query(
        `UPDATE x_campaign_reply SET
          kind = $kind, x_uid = $uid, username = $username, has_media = $media,
          created_at = $created, in_reply_to_tweet_id = $parent,
          text_excerpt = $excerpt, payload_hash = $hash,
          last_seen_at = time::now(), pushed_at = NONE
         WHERE article_id = $a AND tweet_id = $t`,
        params,
      );
      res.changed++;
    } else {
      // 只刷新「还在」的时间戳,不动 pushed_at
      await db.query(
        `UPDATE x_campaign_reply SET last_seen_at = time::now()
         WHERE article_id = $a AND tweet_id = $t`,
        { a: articleId, t: it.tweet_id },
      );
      res.unchanged++;
    }
  }
  return res;
}

/**
 * 取待推送的条目(新增或内容变化过的)。
 *
 * 契约 §2.1:一次 1–500 条,超过分多次 —— 故 limit 默认 500。
 */
export async function listUnpushed(
  articleId?: string,
  limit = 500,
): Promise<ArticleReplyItem[]> {
  const db = getXDB();
  const filter = articleId ? 'AND article_id = $a' : '';
  const res = await db.query<[Array<Record<string, unknown>>]>(
    `SELECT * FROM x_campaign_reply
     WHERE pushed_at = NONE ${filter}
     ORDER BY created_at ASC LIMIT $limit`,
    { a: articleId ?? null, limit },
  );
  return (res[0] ?? []).map((r) => ({
    tweet_id: String(r.tweet_id),
    kind: r.kind as 'reply' | 'quote',
    x_uid: r.x_uid ? String(r.x_uid) : undefined,
    username: String(r.username),
    has_media: r.has_media === true,
    created_at: new Date(String(r.created_at)).toISOString(),
    in_reply_to_tweet_id: r.in_reply_to_tweet_id ? String(r.in_reply_to_tweet_id) : undefined,
    text_excerpt: r.text_excerpt ? String(r.text_excerpt) : undefined,
  }));
}

/** 标记已成功推送(契约确认后才调,失败不标 → 下次自动重推) */
export async function markPushed(articleId: string, tweetIds: string[]): Promise<void> {
  if (tweetIds.length === 0) return;
  const db = getXDB();
  await db.query(
    `UPDATE x_campaign_reply SET pushed_at = time::now()
     WHERE article_id = $a AND tweet_id IN $ids`,
    { a: articleId, ids: tweetIds },
  );
}

/**
 * 标记已删除(契约 §2.1 的 deleted)。
 *
 * 判据:某条此前见过,但本次采集在**同一篇文章**里没再出现。
 * ⚠️ 只在「本次采集完整」时才可调 —— partial(budget 用尽)时没抓完,
 *    没出现不等于被删了,那样会误标一片。调用方负责把这个前提传对。
 */
export async function markMissingAsDeleted(
  articleId: string,
  seenTweetIds: string[],
): Promise<number> {
  const db = getXDB();
  const res = await db.query<[Array<{ tweet_id: string }>]>(
    `UPDATE x_campaign_reply SET deleted = true, pushed_at = NONE, last_seen_at = time::now()
     WHERE article_id = $a AND deleted != true AND tweet_id NOT IN $seen
     RETURN tweet_id`,
    { a: articleId, seen: seenTweetIds },
  );
  return (res[0] ?? []).length;
}

/** 某篇文章的统计 —— UI 显示用 */
export async function campaignStats(articleId: string): Promise<{
  total: number; withMedia: number; unpushed: number; deleted: number;
}> {
  const db = getXDB();
  const q = async (cond: string) => {
    const r = await db.query<[Array<{ count: number }>]>(
      `SELECT count() FROM x_campaign_reply WHERE article_id = $a ${cond} GROUP ALL`,
      { a: articleId },
    );
    return r[0]?.[0]?.count ?? 0;
  };
  return {
    total: await q(''),
    withMedia: await q('AND has_media = true AND deleted != true'),
    unpushed: await q('AND pushed_at = NONE'),
    deleted: await q('AND deleted = true'),
  };
}

// ── 入向互动(通知页具名名单)──────────────────────────────────────
import type { Interaction } from '../x/x-notifications';

/**
 * 批量入库入向互动(幂等)。
 *
 * 幂等键 (kind, actor_uid, target_id):同一人对同一条推的同一种行为只算一次。
 * ⚠️ 归属到 ws —— 通知是「别人对**我**」,而「我」是该 ws 登录的账号;
 *    多 ws 多账号并存时不记 ws 就分不清是谁收到的。
 */
export async function upsertInteractions(
  wsId: string, ownerHandle: string | undefined, list: Interaction[],
): Promise<{ inserted: number; existing: number }> {
  const db = getXDB();
  let inserted = 0;
  let existing = 0;

  for (const it of list) {
    if (!it.actorUid || !it.kind) continue;
    const target = it.targetId || '';
    const found = await db.query<[Array<{ kind: string }>]>(
      `SELECT kind FROM x_interaction
       WHERE kind = $k AND actor_uid = $a AND target_id = $t LIMIT 1`,
      { k: it.kind, a: it.actorUid, t: target },
    );
    if ((found[0] ?? []).length > 0) { existing++; continue; }

    await db.query(
      `CREATE x_interaction SET
        kind = $k, actor_uid = $a, target_id = $t, actor_handle = $ah,
        ws_id = $ws, owner_handle = $oh, notified_at = $at,
        message = $msg, first_seen_at = time::now(),
        target_conversation_id = $conv, target_has_media = $media,
        target_text = $ttext, target_created_at = $tat`,
      {
        k: it.kind, a: it.actorUid, t: target,
        ah: it.actorHandle || undefined,
        ws: wsId, oh: ownerHandle || undefined,
        at: it.notifiedAt ? new Date(it.notifiedAt) : undefined,
        msg: it.message || undefined,
        // ⭐ 这四个此前**解出来却没落库** —— 导致只能全局汇总,
        //    答不了「这条推文谁点赞了」(用户 2026-09-03 指正的正是这点)
        conv: it.targetConversationId || undefined,
        media: typeof it.targetHasMedia === 'boolean' ? it.targetHasMedia : undefined,
        ttext: it.targetText || undefined,
        tat: it.targetCreatedAt ? new Date(it.targetCreatedAt) : undefined,
      },
    );
    inserted++;
  }
  return { inserted, existing };
}

/** 某条推的互动名单 —— 「点赞多少次(名单)」的查询入口 */
export async function interactionsForTarget(targetId: string): Promise<{
  like: Array<{ uid: string; handle?: string }>;
  retweet: Array<{ uid: string; handle?: string }>;
  reply: Array<{ uid: string; handle?: string }>;
}> {
  const db = getXDB();
  const res = await db.query<[Array<Record<string, unknown>>]>(
    `SELECT kind, actor_uid, actor_handle FROM x_interaction WHERE target_id = $t`,
    { t: targetId },
  );
  const out = { like: [] as Array<{ uid: string; handle?: string }>,
    retweet: [] as Array<{ uid: string; handle?: string }>,
    reply: [] as Array<{ uid: string; handle?: string }> };
  for (const r of res[0] ?? []) {
    const k = String(r.kind);
    if (k !== 'like' && k !== 'retweet' && k !== 'reply') continue;
    out[k].push({ uid: String(r.actor_uid),
      handle: r.actor_handle ? String(r.actor_handle) : undefined });
  }
  return out;
}

/** 互动统计 —— UI 显示用 */
export async function interactionStats(): Promise<Record<string, number>> {
  const db = getXDB();
  const res = await db.query<[Array<{ kind: string; count: number }>]>(
    `SELECT kind, count() FROM x_interaction GROUP BY kind`);
  const out: Record<string, number> = {};
  for (const r of res[0] ?? []) out[String(r.kind)] = Number(r.count);
  return out;
}

/**
 * 某篇文章的**核验名单** —— 活动核验的正确口径。
 *
 * 用户 2026-09-03 指正:「这里首先明确是哪一条推文,然后才可以正确匹配
 *   这个通知都有哪些属于这个推文的。你随便抓随便统计可不行。」
 * → 「点赞 5 / 转发 2」这种全局汇总**没有主语**:那 5 个赞散在 4 条不同的推上。
 *   活动要问的是「**这条推文**谁点赞了、谁转发了」,才能与页面数字对账。
 *
 * 归属判据两条(任一命中):
 *  · target_id == 文章本身 —— 直接对文章点赞/转发
 *  · conversation_id == 文章 —— 对该文章会话内某条回复的互动
 *
 * ⚠️ 默认排除自己(excludeHandles):活动是给用户发奖励,
 *    自己给自己点赞不该算参与。
 */
export async function verifyListForArticle(
  articleId: string,
  opts: { excludeHandles?: string[] } = {},
): Promise<{
  articleId: string;
  like: Array<{ uid: string; handle?: string; targetId: string }>;
  retweet: Array<{ uid: string; handle?: string; targetId: string }>;
  reply: Array<{ uid: string; handle?: string; targetId: string; hasMedia?: boolean }>;
  quote: Array<{ uid: string; handle?: string; targetId: string; hasMedia?: boolean }>;
  excluded: number;
}> {
  const db = getXDB();
  const res = await db.query<[Array<Record<string, unknown>>]>(
    `SELECT kind, actor_uid, actor_handle, target_id, target_has_media
     FROM x_interaction
     WHERE target_id = $a OR target_conversation_id = $a`,
    { a: articleId },
  );
  const exclude = new Set((opts.excludeHandles ?? []).map((h) => normalizeHandle(h)));
  const out = {
    articleId,
    like: [] as Array<{ uid: string; handle?: string; targetId: string }>,
    retweet: [] as Array<{ uid: string; handle?: string; targetId: string }>,
    reply: [] as Array<{ uid: string; handle?: string; targetId: string; hasMedia?: boolean }>,
    quote: [] as Array<{ uid: string; handle?: string; targetId: string; hasMedia?: boolean }>,
    excluded: 0,
  };
  for (const r of res[0] ?? []) {
    const handle = r.actor_handle ? String(r.actor_handle) : undefined;
    if (handle && exclude.has(handle)) { out.excluded++; continue; }
    const row = { uid: String(r.actor_uid), handle, targetId: String(r.target_id),
      hasMedia: r.target_has_media === true };
    const k = String(r.kind);
    if (k === 'like') out.like.push(row);
    else if (k === 'retweet') out.retweet.push(row);
    else if (k === 'reply') out.reply.push(row);
    else if (k === 'quote') out.quote.push(row);
  }
  return out;
}
