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
  /**
   * ⭐⭐ 拟稿当时看到的**全部语境**(bio / 账号资料 / 这一楼的上文)。
   *
   * ⚠️ 与 `tweetTextOf` 同一个理由:**必须快照不能 join**,
   * `x_tweet` 有 TTL,过期后回看就不知道当时看到的是什么了。
   * ⭐ 没有它这批数据**教不了任何人** —— 模型学不到
   * 「在这种语境下该这么答」,只能学到「照抄这句话」。
   */
  contextOf?: (tweetId: string) => Record<string, unknown> | undefined;
  /** Claude/模型给的建议原文(人改之前的) */
  adviceRawOf?: (tweetId: string) => string | undefined;
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
           created_at = $createdAt,
           /**
            * ⚠️ **SQL 与参数两处都要登记** —— 本仓「加字段要登记四处」栽过多次:
            * 漏 SQL 这一处 → 字段静默恒空,而类型和 UI 看着都对。
            */
           context_snapshot = $contextSnapshot, advice_raw = $adviceRaw,
           review_count = 0`,
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
          /** ⚠️ option 字段传 undefined 不传 null(SurrealDB 的 NONE ≠ NULL) */
          contextSnapshot: opts.contextOf?.(d.tweetId) ?? undefined,
          adviceRaw: opts.adviceRawOf?.(d.tweetId) ?? undefined,
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

/**
 * ⭐⭐ **人点评** —— 用户 2026-09-26 定的学习环节。
 *
 * > 「用户确定并发送，数据记录并进入学习环节」
 * > 「后期用户可以对已经发送的数据继续点评纠正，这样迭代工作。」
 *
 * ⚠️⚠️ **可以重复点评**,`status` 是什么都行(包括已发送的)——
 * 这正是用户要的「迭代」。所以:
 *  · **不加 `status = 'pending'` 条件**(那会让已发送的改不了)
 *  · `review_count` 累加 —— 「改过几轮」本身是信号
 *  · `reviewed_at` 每次覆盖成最新
 *
 * ⭐ 学习不是「攒够就毕业」,是一直开着的 —— 这条记在数据模型里,
 * 不是 UI 的附加功能。
 *
 * @param finalText 人最终定的正文。与 `ai_text` 不同就说明人改过了。
 */
export async function reviewReplyDraft(
  tweetId: string,
  opts: {
    finalText?: string;
    note?: string;
    /** 改成什么状态;不传就只记点评不改状态(「发完之后回头补一句评价」) */
    status?: Exclude<ReplyDraftStatus, 'pending'>;
  } = {},
): Promise<{ updated: number }> {
  const db = getXDB();
  /**
   * ⭐ diff 由**写入端算**,不存两份正文让读的人自己比 ——
   * 比法一旦不一致(有人 trim 有人不 trim),统计就全废了。
   * ⚠️ 只记「改没改、改成什么」,不做字符级 diff:
   * 那需要额外依赖,而回归分析看的是**最终形态**不是编辑过程。
   */
  const res = await db.query<[Array<{ ai_text?: string }>]>(
    `SELECT ai_text FROM x_reply_draft WHERE tweet_id = $tweetId
       ORDER BY created_at DESC LIMIT 1`,
    { tweetId },
  );
  const aiText = res?.[0]?.[0]?.ai_text ?? '';
  const final = (opts.finalText ?? '').trim();
  /** ⚠️ 没传 finalText = 只补点评,不动 diff(别把它清空) */
  const diff = opts.finalText === undefined
    ? undefined
    : (final === aiText.trim() ? '' : final);

  const out = await db.query<[Array<unknown>]>(
    `UPDATE x_reply_draft SET
       review_count = (review_count ?? 0) + 1,
       reviewed_at = time::now(),
       user_edit_diff = $diff ?? user_edit_diff,
       review_note = $note ?? review_note,
       status = $status ?? status
     WHERE tweet_id = $tweetId`,
    {
      tweetId,
      /** ⚠️ option 字段传 undefined 不传 null */
      diff,
      note: opts.note?.trim() || undefined,
      status: opts.status ?? undefined,
    },
  );
  return { updated: (out?.[0] ?? []).length };
}

/**
 * ⭐⭐ **回看草稿** —— 用户 2026-09-26:
 * > 「后期用户可以对已经发送的数据继续点评纠正，这样迭代工作。」
 *
 * ⚠️ 与 `listPendingDrafts` 的区别:**不只看 pending**。
 * 已填入/已否决的照样要看得到,否则「回头改点评」根本无从下手。
 *
 * ⭐ 连 `context_snapshot` 一起取回:点评时要能看到
 * 「AI 当时看到的是什么」,否则人只能凭正文判断,
 * 与模型当时的处境不同 —— 那样的点评是不公平的。
 */
export async function listDraftsForReview(
  opts: { wsId?: string; status?: ReplyDraftStatus | 'all'; limit?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const db = getXDB();
  const conds: string[] = [];
  if (opts.wsId) conds.push('ws_id = $wsId');
  if (opts.status && opts.status !== 'all') conds.push('status = $status');
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const res = await db.query<[Array<Record<string, unknown>>]>(
    /**
     * ⚠️ ORDER BY 的字段**必须出现在 SELECT 里**(SurrealDB 3.x),
     * 否则 parse error —— 本仓踩过,而且错误会被 catch 吞掉。
     */
    `SELECT tweet_id, tweet_text, author_handle, lang, ai_text, source,
            confidence, ai_reason, run_id, status, ref,
            context_snapshot, advice_raw, user_edit_diff, review_note,
            review_count, reviewed_at, created_at
       FROM x_reply_draft ${where}
      ORDER BY created_at DESC LIMIT $limit`,
    { wsId: opts.wsId, status: opts.status, limit: opts.limit ?? 50 },
  );
  return res[0] ?? [];
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
