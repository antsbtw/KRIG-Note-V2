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
        parent: r.inReplyToStatusId || undefined,
        handle: handle || undefined,
        conv: r.conversationId || undefined,
      },
    );
    if ((res[0] ?? []).length > 0) updated++;
  }
  return updated;
}

/** 我自己发的一条回复(采自 X 载荷,字段比 DOM 抓取全) */
/**
 * 我自己发的一条推 —— **原创推与回复统一用这个结构**。
 *
 * 用户 2026-09-02 定的目的:「用户所有的发帖回复都要爬取,因为未来人工智能
 * 要学习用户的方式,帮助发帖和回复。」
 * → 这是**训练素材**,不是统计口径问题。所以:
 *   · 原创推与回复都要,缺一半就学不全说话方式
 *   · 正文必须保真:长推的 legacy.full_text **会被截断**,真全文在 note_tweet
 *   · metrics 要带上:哪条说法有人搭理,是「学得好不好」的反馈信号
 */
export interface OwnPost {
  tweetId: string;
  text: string;
  authorHandle: string;
  createdAt?: string;
  lang?: string;
  /** 非空 = 这是回复;空 = 原创推 */
  inReplyToStatusId?: string;
  inReplyToScreenName?: string;
  conversationId?: string;
  /** 这条推收到的互动 —— 促转发/评估话术效果/给 AI 当反馈信号 */
  metrics?: { likes?: number; retweets?: number; replies?: number; quotes?: number; bookmarks?: number };
}

/** @deprecated 用 OwnPost —— 保留别名避免一次性大改 */
export type OwnReply = OwnPost;

/**
 * 把**我自己发的回复**入库。
 *
 * 为什么要存(用户 2026-09-02 同意):
 *  1. `conversation_id` 的 n 层关系分析需要足够样本 —— 只存被回复方,
 *     会话链是断的(实测:84 条关系里只有 6 条的「我的回复」在库中)
 *  2. 「我回复了什么内容」可查 —— 话术效果复盘的前提
 *  3. 促转发时要知道**哪条回复带来了互动** —— metrics 就在载荷里,顺手存
 *
 * ⚠️ `source = 'self_reply'`,与搜索采集的 'search' 区分:
 *    收件箱查询按 is_self 排除自己的推(B 期已实现),不会污染待处理列表。
 * ⚠️ `expires_at = NONE` 永久保留 —— 自己的发言是画像素材,丢了不可再生。
 * ⚠️ status 置 'replied':它不是待判线索,不该进 AI 判断队列。
 */
export async function saveOwnReplies(replies: OwnPost[]): Promise<{ inserted: number; skipped: number }> {
  const db = getXDB();
  let inserted = 0;
  let skipped = 0;

  for (const r of replies) {
    // 原创推没有父推 —— 只要有 id 就存(此前要求 inReplyToStatusId,
    // 会把原创推全部丢掉,而 AI 学说话方式恰恰需要原创推)
    if (!r.tweetId) { skipped++; continue; }
    // INSERT IGNORE:重复采集不报错也不覆盖(与 upsertTweet 同语义)
    const res = await db.query<[unknown[]]>(
      `INSERT IGNORE INTO x_tweet {
        tweet_id: $tweet_id,
        text: $text,
        author_handle: $author_handle,
        created_at: $created_at,
        fetched_at: time::now(),
        lang: $lang,
        in_reply_to: $parent,
        in_reply_to_user: $handle,
        conversation_id: $conv,
        metrics: $metrics,
        source: $source,
        status: 'replied',
        replied: false,
        expires_at: NONE,
        filter_score: 0,
        backfilled: false
      }`,
      {
        tweet_id: r.tweetId,
        text: r.text ?? '',
        author_handle: r.authorHandle,
        // 区分原创与回复:两者都是训练素材,但语料性质不同(主动表达 vs 应答)
        source: r.inReplyToStatusId ? 'self_reply' : 'self_post',
        created_at: r.createdAt ? new Date(r.createdAt) : undefined,
        lang: r.lang || undefined,
        parent: r.inReplyToStatusId || undefined,
        handle: r.inReplyToScreenName ? normalizeHandle(r.inReplyToScreenName) : undefined,
        conv: r.conversationId || undefined,
        metrics: r.metrics ?? {},
      },
    );
    if ((res[0] ?? []).length > 0) inserted++; else skipped++;
  }
  return { inserted, skipped };
}

/**
 * 我已入库的回复里,最旧那条是什么时候 —— 增量采集的锚点。
 *
 * 用途:单次采集受 X 懒加载限制只能覆盖约 2.6 天(实测两次都停在这个数),
 * 但**多次采集可以累积**:每次抓到的都并进库里,库里的覆盖深度会一次次往前推。
 * 本函数让 UI 能如实显示「库里累计覆盖了多久」,与「单次抓到多深」分开报。
 */
export async function getOwnReplyCoverage(): Promise<{
  count: number; posts: number; replies: number;
  oldest: string | null; newest: string | null; spanDays: number | null;
}> {
  const db = getXDB();
  // ⚠️ 不用 math::min/max —— 实测对 datetime 返回 NULL(字段明明有值)。
  // 改用 ORDER BY + LIMIT 1,已实测可用。
  // 原创(self_post)与回复(self_reply)都是我的发言 —— 训练素材两者都算
  const res = await db.query<[Array<{ c: number }>, string[], string[],
    Array<{ c: number }>, Array<{ c: number }>]>(
    `SELECT count() AS c FROM x_tweet WHERE source IN ['self_reply','self_post'] GROUP ALL;
     SELECT VALUE created_at FROM x_tweet WHERE source IN ['self_reply','self_post'] ORDER BY created_at ASC LIMIT 1;
     SELECT VALUE created_at FROM x_tweet WHERE source IN ['self_reply','self_post'] ORDER BY created_at DESC LIMIT 1;
     SELECT count() AS c FROM x_tweet WHERE source = 'self_post' GROUP ALL;
     SELECT count() AS c FROM x_tweet WHERE source = 'self_reply' GROUP ALL;`,
  );
  const count = res[0]?.[0]?.c ?? 0;
  if (!count) return { count: 0, posts: 0, replies: 0, oldest: null, newest: null, spanDays: null };
  const oldest = res[1]?.[0] ? String(res[1][0]) : null;
  return {
    count,
    posts: res[3]?.[0]?.c ?? 0,
    replies: res[4]?.[0]?.c ?? 0,
    oldest,
    newest: res[2]?.[0] ? String(res[2][0]) : null,
    spanDays: oldest
      ? Math.round((Date.now() - new Date(oldest).getTime()) / 86_400_000 * 10) / 10
      : null,
  };
}

/**
 * 反向对账:新采到的线索,我是不是**早就回复过了**。
 *
 * 用户 2026-09-02 发现:「请检查一下第一条,是否已经回复过了,也爬取过了,
 * 怎么还会显示呢?」
 *
 * 根因是回填只有**单向**:采到我的回复时,去标记它的父推。
 * 但顺序反过来就漏了 ——
 *   12:08 采到我的回复(那时父推还不在库里,无从标记)
 *   23:38 搜索才采到那条父推 → 它带着 replied=false 进了「待判」
 * 结果:我明明回过的人,又出现在待处理列表里,会被重复回复。
 *
 * 所以每次采集写库后都要跑一次本函数:拿新写入的 tweet_id 反查
 * 「我的回复里有没有指向它的」,有就补标。
 *
 * @param tweetIds 本轮新写入的线索 id;不传则全量对账(启动时用)
 */
export async function reconcileRepliedFromOwnReplies(
  tweetIds?: string[],
): Promise<number> {
  const db = getXDB();
  // 只认 self_reply 的 in_reply_to —— 那是「我回复了谁」的权威记录
  const scope = tweetIds?.length
    ? `AND tweet_id IN $ids`
    : '';
  const res = await db.query<[Array<{ tweet_id: string }>]>(
    `LET $mine = (SELECT VALUE in_reply_to FROM x_tweet
       WHERE source = 'self_reply' AND in_reply_to != NONE);
     UPDATE x_tweet SET replied = true, replied_at = time::now(), expires_at = NONE
       WHERE tweet_id IN $mine AND replied != true ${scope}
       RETURN tweet_id`,
    tweetIds?.length ? { ids: tweetIds } : {},
  );
  const n = (res[res.length - 1] as Array<{ tweet_id: string }> | undefined)?.length ?? 0;
  if (n > 0) {
    console.log(`[x-reply-relation-repo] 反向对账:${n} 条新线索其实我早就回过了,已补标`);
  }

  // ⚠️ 补标 replied 后必须**顺带把状态从 pending 挪走**,否则它们会永远滞留:
  // queryPending 已排除已回复的(不再送 AI 判),而没有别的东西会改它们的状态
  // —— 结果是一批「不会被判、也不会消失」的僵尸行。
  // 置 'replied':回复过就是最终态,不需要 AI 再判值不值。
  await db.query(
    `UPDATE x_tweet SET status = 'replied'
     WHERE status = 'pending' AND replied = true`,
  );

  return n;
}

/** 采集游标 —— 用 X 自己给的 Bottom cursor 续传 */
export interface CollectCursor {
  bottomCursor?: string;
  oldestAt?: string;
  exhausted: boolean;
}

/**
 * 读采集游标。
 *
 * X 每个 timeline 响应都自带 `TimelineTimelineCursor`(cursorType: Top/Bottom),
 * Bottom 就是「下一页从这里继续」的官方标记 —— 用它续传比拿时间戳猜边界精确得多,
 * 而且**用户不必知道有这回事**(一个按钮即可,不必选「增量」还是「补历史」)。
 */
export async function getCollectCursor(scope: string): Promise<CollectCursor> {
  const db = getXDB();
  const res = await db.query<[Array<{ bottom_cursor?: string; oldest_at?: string; exhausted?: boolean }>]>(
    `SELECT bottom_cursor, oldest_at, exhausted FROM x_collect_cursor WHERE scope = $scope LIMIT 1`,
    { scope },
  );
  const r = res[0]?.[0];
  return {
    bottomCursor: r?.bottom_cursor ?? undefined,
    oldestAt: r?.oldest_at ? String(r.oldest_at) : undefined,
    exhausted: r?.exhausted === true,
  };
}

/** 存采集游标(幂等 upsert) */
export async function saveCollectCursor(
  scope: string,
  cursor: { bottomCursor?: string; oldestAt?: string; exhausted?: boolean },
): Promise<void> {
  const db = getXDB();
  const existing = await db.query<[Array<{ scope: string }>]>(
    `SELECT scope FROM x_collect_cursor WHERE scope = $scope LIMIT 1`, { scope },
  );
  // ⚠️ option 字段传 undefined→NONE,不传 null(SurrealDB 的 NONE ≠ NULL)
  const params = {
    scope,
    bottom: cursor.bottomCursor || undefined,
    oldest: cursor.oldestAt ? new Date(cursor.oldestAt) : undefined,
    exhausted: cursor.exhausted === true,
  };
  if ((existing[0] ?? []).length > 0) {
    await db.query(
      `UPDATE x_collect_cursor SET bottom_cursor = $bottom, oldest_at = $oldest,
         exhausted = $exhausted, updated_at = time::now() WHERE scope = $scope`, params);
  } else {
    await db.query(
      `CREATE x_collect_cursor SET scope = $scope, bottom_cursor = $bottom,
         oldest_at = $oldest, exhausted = $exhausted, updated_at = time::now()`, params);
  }
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
