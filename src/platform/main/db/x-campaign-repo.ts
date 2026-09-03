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
