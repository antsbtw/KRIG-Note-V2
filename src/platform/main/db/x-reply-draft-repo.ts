/**
 * `x_reply_draft` —— **拟出来的草稿落库**(migration 1.2.8)。
 *
 * ── 用户 2026-09-24 拍板 ──
 * > 「落库,这是未来AI学习和优化的环节吧?」
 *
 * ⭐ 对:草稿 + 人改成什么 + 发没发 = **「AI 写的 vs 人要的」差集**,
 *   那才是训练信号。不落库就没有这个差集。
 *
 * ── 为什么非有不可(编排实跑查实)──
 * 编排报「拟出 6 条草稿」而库里**一条都查不到**:
 * `planReplies` 只**返回**草稿,全仓没有任何地方写进库;
 * UI 那条路径放在 `useState` 里,关掉就没。
 * ⭐ 手点时人当场看得见,所以一直没暴露;**编排跑完没人看 → 草稿蒸发**。
 *
 * ── 与 `x_reply_feedback` 的分工(⚠️ 别混)──
 * 这张表 = **AI 产出了什么**(流水,没人参与也有行)
 * 那张表 = **人最终怎么表态**(结论,必须有人)
 * ⚠️ 人表态时**两张都写**:这张更新 status,那张照旧插一行 —— 各记各的。
 */

import { getXDB } from '@storage/surreal/client';
import type { ReplyDraft } from '@shared/types/x-reply-types';

/** 草稿的处置状态 —— `pending` 是刚拟出来还没人看 */
export type ReplyDraftStatus = 'pending' | 'filled' | 'dismissed' | 'expired';

export interface InsertDraftOptions {
  wsId?: string;
  /** ⭐ 哪次编排拟的 —— 没有它就说不清「这批草稿是哪一跑的产物」 */
  runId?: string;
  /** 拟稿当时的推文正文 —— ⚠️ 必须快照,x_tweet 有 TTL,过期后回看就没上下文 */
  tweetTextOf?: (tweetId: string) => string | undefined;
}

/**
 * 批量落库。
 *
 * ⚠️ **单条失败不拦整批**,但**不静默** —— 一条都存不进去要看得出来。
 * ⚠️ 不做 `tweet_id` 去重:同一条推可能被多次拟稿(重跑/改配方),
 *   每次都是独立的一份产出,合并会丢掉「模型这次写得不一样」这个信号。
 *
 * @returns 真正写进去的条数(⚠️ 与传入条数不等就是有失败)
 */
export async function insertReplyDrafts(
  drafts: readonly ReplyDraft[],
  opts: InsertDraftOptions = {},
): Promise<{ saved: number; failed: number; errors: string[] }> {
  if (drafts.length === 0) return { saved: 0, failed: 0, errors: [] };
  const db = getXDB();
  let saved = 0;
  const errors: string[] = [];

  for (const d of drafts) {
    try {
      await db.query(
        `CREATE x_reply_draft SET
           tweet_id = $tweetId, tweet_text = $tweetText, author_handle = $authorHandle,
           lang = $lang, ai_text = $aiText, source = $source, confidence = $confidence,
           poster_kind = $posterKind, poster_read = $posterRead,
           trigger = $trigger, ai_reason = $aiReason, in_thread = $inThread,
           status = 'pending', run_id = $runId, ref = $ref, ws_id = $wsId,
           created_at = $createdAt`,
        {
          tweetId: d.tweetId,
          /** ⚠️ 快照,不 join —— x_tweet 有 TTL */
          tweetText: opts.tweetTextOf?.(d.tweetId) ?? '',
          authorHandle: d.authorHandle || undefined,
          lang: d.lang,
          aiText: d.text,
          source: d.source,
          confidence: d.confidence,
          /** ⭐ 推断链 —— 「为什么这么写」,回归分析要用 */
          posterKind: d.trace?.posterKind,
          posterRead: d.trace?.posterRead,
          trigger: d.trace?.trigger,
          aiReason: d.reason || undefined,
          inThread: d.inThread,
          runId: opts.runId,
          ref: d.ref || undefined,
          wsId: opts.wsId,
          createdAt: d.createdAt ? new Date(d.createdAt) : new Date(),
        },
      );
      saved += 1;
    } catch (e) {
      /** ⚠️ fail loud:存不进去要看得见,别让「拟出 N 条」变成谎报 */
      const msg = `${d.tweetId}: ${String(e).slice(0, 160)}`;
      errors.push(msg);
      console.warn('[x-reply-draft-repo] 草稿入库失败:', msg);
    }
  }
  return { saved, failed: drafts.length - saved, errors };
}

/**
 * 人表态后更新状态。
 *
 * ⚠️ 只改**最近一条 pending** 的 —— 同一条推可能有多份历史草稿,
 * 把旧的一并改掉会让「那次拟的到底怎么处置的」失真。
 */
export async function resolveReplyDraft(
  tweetId: string,
  status: Exclude<ReplyDraftStatus, 'pending'>,
): Promise<void> {
  const db = getXDB();
  await db.query(
    `UPDATE x_reply_draft SET status = $status, resolved_at = time::now()
       WHERE tweet_id = $tweetId AND status = 'pending'`,
    { tweetId, status },
  );
}

/** 查还没处置的草稿 —— 编排跑完之后「回头挑着发」用 */
export async function listPendingDrafts(
  opts: { wsId?: string; limit?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const db = getXDB();
  const res = await db.query<[Array<Record<string, unknown>>]>(
    `SELECT tweet_id, tweet_text, author_handle, lang, ai_text, source,
            confidence, ai_reason, run_id, created_at
       FROM x_reply_draft
      WHERE status = 'pending' ${opts.wsId ? 'AND ws_id = $wsId' : ''}
      ORDER BY created_at DESC LIMIT $limit`,
    { wsId: opts.wsId, limit: opts.limit ?? 50 },
  );
  return res[0] ?? [];
}
