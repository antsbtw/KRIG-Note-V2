/**
 * 回复关系落库 —— 「我回复了谁的哪条推」。
 *
 * 调用边界:仅 main 进程。走 **X 库(krig_x)** —— getXDB()。
 *
 * 设计依据:docs/10-business-design/x/reply-relationship-design.md
 * 数据来源:X GraphQL 响应 legacy 对象的**权威字段**(载荷勘查 §2.4 实测):
 *   in_reply_to_status_id_str / in_reply_to_screen_name /
 *   in_reply_to_user_id_str / conversation_id_str
 *
 * ⚠️ 不做任何推断。此前从 DOM 猜连接线像素 / idx 相邻 / 正则匹配「Replying to」
 *    的三套判据**全部作废** —— 它们都是在页面外面自造判据,有损且错了不报错。
 */

import { getXDB } from '@storage/surreal/client';
import { normalizeHandle } from '@shared/types/x-timeline-types';

/** 一条回复关系(来自 X 载荷的权威字段) */
export interface ReplyRelation {
  /** 这条回复自身的 tweet id */
  tweetId: string;
  /** 被回复的那条推的 id */
  inReplyToStatusId: string;
  /** 被回复者 handle(存归一化形态) */
  inReplyToScreenName?: string;
  /** 会话根 id */
  conversationId?: string;
}

export interface ReplyBackfillResult {
  /** 传入的关系条数 */
  received: number;
  /** 父推在库里存在、因而被标记 replied 的条数 */
  markedReplied: number;
  /** 其中原本是「已采纳」的条数 —— 业务主线关心的就是这批 */
  amongAccepted: number;
  /** 父推不在库里的条数(我回复过但从没采集过的推) */
  parentNotInDb: number;
}

/**
 * 用采集到的回复关系回填 `replied`。
 *
 * **语义修正**(见设计文档 §2.2):此前 `replied` 只由手动「↩ 已回复」按钮设置,
 * 记录的是「我点没点过那个按钮」,而非「我是否真的回复过」—— 用户明确说过
 * 自建回复功能不好使、没在用,所以全库为 0。
 * 现改为由**采集到的客观事实**推导:抓到即事实,手机上回的、网页上回的一律算数。
 *
 * ⚠️ 与 markReplied 的区别:本函数**不动 status**。
 *    markReplied 会把 status 置成 'replied' 用于「已确认视图清场」,
 *    那是人工操作的语义;回填是补事实,不该把卡片从视图里挪走。
 *
 * ⚠️ **回复即永久**:置 expires_at = NONE,让 TTL 跳过 ——
 *    我回复过谁是画像素材,丢了不可再生(与 markReplied 同理)。
 */
export async function backfillRepliedFromRelations(
  relations: ReplyRelation[],
): Promise<ReplyBackfillResult> {
  const db = getXDB();
  const result: ReplyBackfillResult = {
    received: relations.length, markedReplied: 0, amongAccepted: 0, parentNotInDb: 0,
  };
  if (relations.length === 0) return result;

  // 去重:同一条父推可能被回复多次
  const parentIds = [...new Set(relations.map((r) => r.inReplyToStatusId).filter(Boolean))];
  if (parentIds.length === 0) return result;

  // 先查哪些父推在库里、其中哪些是已采纳 —— 先量后改,便于如实汇报战果
  const pre = await db.query<[Array<{ tweet_id: string; accepted: boolean | null }>]>(
    `SELECT tweet_id, accepted FROM x_tweet WHERE tweet_id IN $ids`,
    { ids: parentIds },
  );
  const existing = pre[0] ?? [];
  result.parentNotInDb = parentIds.length - existing.length;
  result.amongAccepted = existing.filter((r) => r.accepted === true).length;

  if (existing.length === 0) return result;

  const existingIds = existing.map((r) => r.tweet_id);
  // 只置 replied / replied_at / expires_at,**不动 status**(理由见上)
  await db.query(
    `UPDATE x_tweet SET replied = true, replied_at = time::now(), expires_at = NONE
     WHERE tweet_id IN $ids AND replied != true`,
    { ids: existingIds },
  );
  result.markedReplied = existing.length;

  return result;
}

/**
 * 把回复关系写到**回复自身**那条推上(若它已在库里)。
 *
 * 与 backfillRepliedFromRelations 是两件事:
 *   - 那个:标记**被回复的推**(线索)为「我回复过了」
 *   - 这个:给**我的回复**这条推补上它指向谁
 * 前者服务收件箱 UI,后者服务 n 层关系分析(conversation_id GROUP BY)。
 *
 * ⚠️ handle 一律 normalizeHandle —— 与 x_author.handle 同形态,
 *    否则跨表比对恒不命中且不报错(B 期踩过的坑)。
 */
export async function saveReplyRelations(relations: ReplyRelation[]): Promise<number> {
  const db = getXDB();
  let updated = 0;

  for (const r of relations) {
    if (!r.tweetId || !r.inReplyToStatusId) continue;
    const handle = r.inReplyToScreenName ? normalizeHandle(r.inReplyToScreenName) : undefined;

    // ⚠️ option 字段传 undefined→NONE,绝不传 null(SurrealDB 的 NONE ≠ NULL)
    const res = await db.query<[unknown[]]>(
      `UPDATE x_tweet SET
         in_reply_to = $parent,
         in_reply_to_user = $handle,
         conversation_id = $conv
       WHERE tweet_id = $tweet_id`,
      {
        tweet_id: r.tweetId,
        parent: r.inReplyToStatusId,
        handle: handle || undefined,
        conv: r.conversationId || undefined,
      },
    );
    if ((res[0] ?? []).length > 0) updated++;
  }
  return updated;
}

/**
 * 统计:我回复过的已采纳线索有多少条(业务主线的核心指标)。
 * 「找到需要买 VPN 的人 → 回复他们」—— 这个数就是主线的产出量。
 */
export async function countRepliedAccepted(): Promise<{ repliedAccepted: number; totalAccepted: number }> {
  const db = getXDB();
  const res = await db.query<[Array<{ c: number }>, Array<{ c: number }>]>(
    `SELECT count() AS c FROM x_tweet WHERE accepted = true AND replied = true GROUP ALL;
     SELECT count() AS c FROM x_tweet WHERE accepted = true GROUP ALL;`,
  );
  return {
    repliedAccepted: res[0]?.[0]?.c ?? 0,
    totalAccepted: res[1]?.[0]?.c ?? 0,
  };
}
