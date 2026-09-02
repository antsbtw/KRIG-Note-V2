/**
 * x_tweet 表 CRUD（X 时间线智能筛选）
 *
 * 调用边界：仅 main 进程调用，直接 import @storage/surreal/client。
 * ⚠️ 走 **X 库(krig_x)**,不是笔记库 —— 用 getXDB() 而非 getDB()。
 *
 * A 期起真源表是 `x_tweet`(单表模型,方案 §4.1(4)):采纳与否是 item 的**属性**
 * 而不是分表依据。是否永久保留取决于 `expires_at`:
 *   - 有值   → 到期由 cleanExpired 删除(普通采集,7 天窗口)
 *   - NONE   → **永久保留**(人工采纳/回复过的)
 *
 * ⚠️ 这是 A 期止血的核心:旧 tweet_inbox 的 expires_at 是 TYPE datetime(非 option),
 * 「设 NONE 让 TTL 跳过」根本走不通 —— 于是采纳过的推文照样 7 天后被删,
 * 607 条历史采纳里 449 条(74%)正文就是这么丢的。x_tweet 建成 option<datetime> 修掉了根因。
 */

import { getXDB } from '@storage/surreal/client';
import type { TweetInboxRecord, AIVerdict, TweetInboxStatus, TweetFeedback, FeedbackVerdict } from '@shared/types/x-timeline-types';
import { DEFAULT_TASK_ID } from '@shared/types/x-timeline-types';

/** 写入或忽略（tweet_id 唯一索引冲突 = 重复，直接跳过） */
export async function upsertTweet(record: TweetInboxRecord): Promise<void> {
  const db = getXDB();
  await db.query(
    `INSERT IGNORE INTO x_tweet {
      tweet_id: $tweet_id,
      text: $text,
      author_name_at_post: $author_name_at_post,
      author_handle: $author_handle,
      author_avatar: $author_avatar,
      tweet_url: $tweet_url,
      lang: $lang,
      metrics: $metrics,
      fetched_at: $fetched_at,
      created_at: $created_at,
      in_reply_to: $in_reply_to,
      expires_at: $expires_at,
      source: $source,
      search_recipe: $search_recipe,
      task_id: $task_id,
      ws_id: $ws_id,
      filter_score: $filter_score,
      filter_reason: $filter_reason,
      ai_verdict: $ai_verdict,
      translation: $translation,
      status: $status,
      accepted: $accepted,
      accepted_at: $accepted_at,
      replied: $replied,
      replied_at: $replied_at,
      reply_draft: $reply_draft,
      backfilled: $backfilled
    }`,
    {
      tweet_id: record.tweet_id,
      text: record.text,
      // 发推当时的展示名快照(与 x_author.display_name 语义不同 —— 后者是当前名,会变)
      author_name_at_post: record.author_name || undefined,
      author_handle: record.author_handle,
      author_avatar: record.author_avatar ?? undefined,
      tweet_url: record.tweet_url ?? undefined,
      lang: record.lang ?? undefined,
      metrics: record.metrics,
      fetched_at: new Date(record.fetched_at),
      // A':extract 早就提取了这两个字段,只是组装记录时没带上
      created_at: record.created_at ? new Date(record.created_at) : undefined,
      in_reply_to: record.in_reply_to ?? undefined,
      // ⚠️ undefined → NONE(永久保留);绝不写 null —— option<T> 只认 NONE,NULL 会被拒
      expires_at: record.expires_at ? new Date(record.expires_at) : undefined,
      source: record.source,
      search_recipe: record.search_recipe ?? undefined,
      task_id: record.task_id ?? DEFAULT_TASK_ID,
      ws_id: record.ws_id ?? undefined,
      filter_score: record.filter_score,
      filter_reason: record.filter_reason ?? undefined,
      ai_verdict: record.ai_verdict ?? undefined,
      translation: record.translation ?? undefined,
      status: record.status,
      accepted: record.accepted ?? undefined,
      accepted_at: record.accepted_at ? new Date(record.accepted_at) : undefined,
      replied: record.replied ?? false,
      replied_at: record.replied_at ? new Date(record.replied_at) : undefined,
      reply_draft: record.reply_draft ?? undefined,
      backfilled: record.backfilled ?? false,
    },
  );
}

/** 写入 filtered_out 推文（status=filtered_out，不触发 AI 判断） */
export async function insertFilteredOut(
  record: Omit<TweetInboxRecord, 'status' | 'filter_score' | 'ai_verdict'> & { filter_reason: string },
): Promise<void> {
  await upsertTweet({
    ...record,
    status: 'filtered_out',
    filter_score: 0,
    ai_verdict: undefined,
  });
}

/** 取已存在的 tweet_id 集合（去重用）
 *
 *  不限时间窗:人工拒绝(skip)过、采纳过的推文都永远不再重新抓入。
 *
 *  ⚠️ A 期修掉的重复爬根因:原签名收了 `_windowHours` 却**根本没用**
 *  (函数体直接全表扫),于是去重范围恒等于 inbox 存活的 7 天 —— 采纳的推文
 *  一旦过期就会被当成新推文重新抓回来。现在 x_tweet 里永久行不会消失,
 *  去重集合天然覆盖全部历史;那个从未生效的参数一并删掉,不留误导。
 */
export async function getTweetIdSet(): Promise<Set<string>> {
  const db = getXDB();
  const res = await db.query<[Array<{ tweet_id: string }>]>(
    `SELECT tweet_id FROM x_tweet`,
  );
  const rows = res[0] ?? [];
  return new Set(rows.map((r) => r.tweet_id));
}

/** 查询 pending 推文（AI 判断前批量拉取）
 *  - 传 wsId → 只取该 ws 的 pending（AI 判断 per-ws 隔离，防跨 ws 混批）
 *  - 不传 wsId → 保持原全局行为（向后兼容）
 */
export async function queryPending(limit = 50, wsId?: string): Promise<TweetInboxRecord[]> {
  const db = getXDB();
  const wsFilter = wsId ? 'AND ws_id = $wsId' : '';
  const res = await db.query<[TweetInboxRecord[]]>(
    `SELECT * FROM x_tweet WHERE status = 'pending' ${wsFilter} ORDER BY fetched_at ASC LIMIT $limit`,
    { limit, wsId: wsId ?? null },
  );
  return res[0] ?? [];
}

/** 将一批推文状态更新为 ai_judging */
export async function markAiJudging(tweetIds: string[]): Promise<void> {
  if (tweetIds.length === 0) return;
  const db = getXDB();
  await db.query(
    `UPDATE x_tweet SET status = 'ai_judging' WHERE tweet_id IN $ids`,
    { ids: tweetIds },
  );
}

/**
 * 启动自愈:把卡在 ai_judging 的推文退回 pending。
 *
 * `ai_judging` 是「AI 判断已领取、结果未写回」的中间态。正常路径下
 * updateVerdict 会把它推向 worth/skip,Ollama 调用失败也会显式退回 pending
 * (x-ai-judge.ts)。但**进程直接没了**就没人管了 —— app 退出、sidecar 崩溃、
 * 被 kill,这些行会永远停在 ai_judging:不会被重判(queryPending 只捞 pending),
 * 也不会出现在收件箱里(UI 视图筛的是 worth/skip),等于静默丢失。
 * 2026-09-01 实测有 10 条这样卡住。
 *
 * 为什么无条件退回、不设时间阈值:**启动那一刻不可能有正在跑的批次**
 * (判断任务不跨进程存活),所以不存在误伤正在处理的行。
 * 加 ai_judging_at 时间戳 + 阈值反而要多一条 migration,还多一个要调的参数,
 * 换不来额外的正确性。
 *
 * @returns 退回的行数(0 表示没有卡住的,属正常)
 */
export async function recoverStuckAiJudging(): Promise<number> {
  const db = getXDB();
  const res = await db.query<[Array<{ tweet_id: string }>]>(
    `UPDATE x_tweet SET status = 'pending' WHERE status = 'ai_judging' RETURN tweet_id`,
  );
  return (res[0] ?? []).length;
}

/** 写回 AI 判断结果（worth / skip）+ 可选翻译。
 *
 *  **仅供 Gemma 的机器判断使用** —— 它不改 expires_at,机器判 worth 的推文
 *  仍按 7 天窗口过期。人工表态请走 `applyHumanVerdict`(那条才置永久)。
 */
export async function updateVerdict(tweetId: string, verdict: AIVerdict): Promise<void> {
  const db = getXDB();
  const status: TweetInboxStatus = verdict.worth ? 'worth' : 'skip';
  await db.query(
    `UPDATE x_tweet SET ai_verdict = $verdict, status = $status, translation = $translation WHERE tweet_id = $tweet_id`,
    { verdict, status, translation: verdict.translation ?? undefined, tweet_id: tweetId },
  );
}

/**
 * 人工表态(采纳/拒绝)—— **A 期止血的落点**。
 *
 * 与 updateVerdict 分开是刻意的:两者写的是不同层次的东西。
 *   - updateVerdict     = Gemma 的机器判断,可被推翻,不影响留存
 *   - applyHumanVerdict = 我的最终态度,不可重算,且**采纳即永久**
 * 用「reason 以 human: 开头」来嗅探人工意图是脆的(字符串约定会漂),
 * 所以这里走独立函数、显式语义。
 *
 * accept → expires_at = NONE(永久保留,TTL 跳过)+ accepted = true
 * reject → 保持原有过期时间(拒绝的推文没有长期留存价值,但 tweet_feedback
 *          里的标注记录仍在 —— 那才是训练/评估的真源)
 */
export async function applyHumanVerdict(
  tweetId: string,
  verdict: FeedbackVerdict,
): Promise<void> {
  const db = getXDB();
  const accepted = verdict === 'accept';
  const status: TweetInboxStatus = accepted ? 'worth' : 'skip';
  const aiVerdict: AIVerdict = {
    worth: accepted,
    confidence: 1,
    reason: `human:${verdict}`,
    tags: [],
    suggestReply: accepted,
  };
  if (accepted) {
    await db.query(
      `UPDATE x_tweet SET ai_verdict = $aiVerdict, status = $status,
         accepted = true, accepted_at = time::now(), expires_at = NONE
       WHERE tweet_id = $tweet_id`,
      { aiVerdict, status, tweet_id: tweetId },
    );
  } else {
    await db.query(
      `UPDATE x_tweet SET ai_verdict = $aiVerdict, status = $status, accepted = false
       WHERE tweet_id = $tweet_id`,
      { aiVerdict, status, tweet_id: tweetId },
    );
  }
}

/** 查询 tweet_inbox（Review Queue 用，支持按 status / lang 过滤） */
export async function queryInbox(opts: {
  status?: TweetInboxStatus;
  statuses?: TweetInboxStatus[];   // 多状态 IN 过滤（与 status 互斥，优先级更高）
  wsId?: string;
  lang?: string;
  searchRecipe?: string;           // 按配方切片
  taskId?: string;                 // 按处理任务维度切片（阶段B恒 'judge-value'）
  humanReviewed?: boolean;         // true=只要人工确认过的(ai_verdict.reason 为 human:*)；
                                   // false=只要 Gemma 原判未复核的；缺省=不过滤
  orderBy?: 'fetched_at' | 'confidence';  // confidence=按 Gemma 置信度升序（漏判抽查视图用）
  limit?: number;
  offset?: number;
  /** true(默认)=剔除已屏蔽作者/自己的推文。仅影响**显示**,历史数据一行不删。 */
  excludeHidden?: boolean;
}): Promise<TweetInboxRecord[]> {
  const db = getXDB();
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const conditions: string[] = [];
  if (opts.statuses?.length)       conditions.push('status IN $statuses');
  else if (opts.status)            conditions.push('status = $status');
  if (opts.wsId)                   conditions.push('ws_id = $wsId');
  if (opts.lang)                   conditions.push('lang = $lang');
  if (opts.searchRecipe)           conditions.push('search_recipe = $searchRecipe');
  if (opts.taskId)                 conditions.push('task_id = $taskId');
  if (opts.humanReviewed === true)
    conditions.push(`ai_verdict != NONE AND string::starts_with(ai_verdict.reason, 'human:')`);
  else if (opts.humanReviewed === false)
    conditions.push(`ai_verdict != NONE AND !string::starts_with(ai_verdict.reason, 'human:')`);

  // 屏蔽者 / 自己发的推:**只从面板隐藏,绝不删数据**。
  // 「不再爬」约束未来(B 期 accountBlacklist),「不再显示」约束呈现 —— 两件事。
  // 解除屏蔽后这些行会原样回到列表,是过滤不是删除。
  //
  // ⚠️ 跨表比对必须归一化:x_tweet.author_handle 存 '@angeelfv'(带 @、原始大小写),
  // x_author.handle 存 'angeelfv'(归一化)。直接 IN 比对**恒不命中且不报错** ——
  // 与 B 期 applyFilter 同源的坑,见 normalizeHandle 的注释。
  // SQL 侧用 string::lowercase + 去 @,与 normalizeHandle() 同语义。
  if (opts.excludeHidden !== false) {
    conditions.push(
      `string::replace(string::lowercase(author_handle), '@', '') NOT IN `
      + `(SELECT VALUE handle FROM x_author WHERE blocked = true OR is_self = true)`,
    );
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const order = opts.orderBy === 'confidence' ? 'ai_verdict.confidence ASC' : 'fetched_at DESC';

  const res = await db.query<[TweetInboxRecord[]]>(
    `SELECT * FROM x_tweet ${where} ORDER BY ${order} LIMIT $limit START $offset`,
    { status: opts.status, statuses: opts.statuses ?? null, wsId: opts.wsId ?? null, lang: opts.lang ?? null, searchRecipe: opts.searchRecipe ?? null, taskId: opts.taskId ?? null, limit, offset },
  );
  return res[0] ?? [];
}

/** 标记推文已回复（已确认视图清场用）
 *
 *  **回复即永久**:同时把 expires_at 置 NONE,让 cleanExpired 跳过这行。
 *  回复过的推文是画像素材(我和谁互动过),丢了不可再生。
 */
export async function markReplied(tweetId: string): Promise<void> {
  const db = getXDB();
  await db.query(
    `UPDATE x_tweet SET status = 'replied', replied = true, replied_at = time::now(),
       expires_at = NONE
     WHERE tweet_id = $tweet_id`,
    { tweet_id: tweetId },
  );
}

export interface FeedbackStats {
  suggestedTotal: number;     // 近7天:带 Gemma worth 快照且被人工表态的条数
  suggestedAccepted: number;  // 其中人工 ✓ 的条数(精确率分子)
  rescuedFn: number;          // 近7天:Gemma 判 skip 但人工捞回 ✓ 的条数(漏判)
}

/** 近 7 天 Gemma 建议 vs 人工表态的统计（靠 tweet_feedback.ai_verdict 快照,migration 1.8.7 起有数据） */
export async function getFeedbackStats(): Promise<FeedbackStats> {
  const db = getXDB();
  const res = await db.query<[Array<{ c: number }>, Array<{ c: number }>, Array<{ c: number }>]>(
    `SELECT count() AS c FROM tweet_feedback WHERE created_at > time::now() - 7d AND ai_verdict != NONE AND ai_verdict.worth = true GROUP ALL;
     SELECT count() AS c FROM tweet_feedback WHERE created_at > time::now() - 7d AND ai_verdict != NONE AND ai_verdict.worth = true AND verdict = 'accept' GROUP ALL;
     SELECT count() AS c FROM tweet_feedback WHERE created_at > time::now() - 7d AND ai_verdict != NONE AND ai_verdict.worth = false AND verdict = 'accept' GROUP ALL;`,
  );
  return {
    suggestedTotal:    res[0]?.[0]?.c ?? 0,
    suggestedAccepted: res[1]?.[0]?.c ?? 0,
    rescuedFn:         res[2]?.[0]?.c ?? 0,
  };
}

/** TTL 清理：删除 expires_at 已过期的推文 */
/** TTL 清理。
 *
 *  `expires_at` 为 NONE 的行(采纳/回复过的永久行)**不满足** `expires_at < time::now()`,
 *  因此天然被跳过 —— 这正是 A 期止血依赖的机制。改这条语句前先想清楚这点。
 */
/**
 * TTL 清理 —— **已停用**(用户 2026-09-02 拍板:X 推文永久保存)。
 *
 * 为什么保留这个函数而不是删掉:调用点在调度器里(每 24h + 启动时各一次),
 * 保留成 no-op 比拆掉调用链更安全,也留下「这里曾经会删数据」的痕迹。
 * 将来真要做容量治理(用户:「等容量到了一定的程度,再考虑迁移新的架构」),
 * 应该是**迁移到冷存储**,而不是恢复这里的 DELETE。
 *
 * ⚠️ 绝不要简单地把 DELETE 加回来:
 *   A 期就因 TTL 丢过 449 条已采纳推文的正文(不可再生);
 *   而被 Gemma 判 skip / 被黑名单过滤的推,是竞品分析与语料素材,
 *   同样不可再生。删除是不可逆操作,恢复它需要明确的产品决策。
 */
export async function cleanExpired(): Promise<void> {
  // no-op:保留调用点,不再删除任何数据
  return;
}

/** 查询缺翻译的非中文推文（补填用） */
export async function queryMissingTranslation(limit = 100): Promise<Array<{ tweet_id: string; text: string; lang: string }>> {
  const db = getXDB();
  // lang 不是 zh/zh-Hans/zh-Hant，且 translation 缺失
  const res = await db.query<[Array<{ tweet_id: string; text: string; lang: string }>]>(
    `SELECT tweet_id, text, lang FROM x_tweet
     WHERE (lang IS NOT NONE AND lang != 'zh' AND lang != 'zh-Hans' AND lang != 'zh-Hant')
       AND (translation IS NONE OR translation = '')
     LIMIT $limit`,
    { limit },
  );
  return res[0] ?? [];
}

/** 写回单条翻译 */
export async function setTranslation(tweetId: string, translation: string): Promise<void> {
  const db = getXDB();
  await db.query(
    `UPDATE x_tweet SET translation = $translation WHERE tweet_id = $tweet_id`,
    { translation, tweet_id: tweetId },
  );
}

/** 写入人工反馈（accept / reject），允许同一 tweet_id 多次投票 */
export async function insertFeedback(fb: TweetFeedback): Promise<void> {
  const db = getXDB();
  await db.query(
    `INSERT INTO tweet_feedback {
      tweet_id:      $tweet_id,
      text:          $text,
      lang:          $lang,
      author_handle: $author_handle,
      verdict:       $verdict,
      reason_tag:    $reason_tag,
      source_recipe: $source_recipe,
      created_at:    $created_at,
      ai_verdict:    $ai_verdict
    }`,
    {
      tweet_id:      fb.tweet_id,
      text:          fb.text,
      lang:          fb.lang ?? undefined,
      author_handle: fb.author_handle,
      verdict:       fb.verdict,
      reason_tag:    fb.reason_tag ?? undefined,
      source_recipe: fb.source_recipe ?? undefined,
      created_at:    new Date(fb.created_at),
      ai_verdict:    fb.ai_verdict ?? undefined,
    },
  );
}

/**
 * 取 Gemma 对某推文的原始判断（准确率对账用）。
 * tweet_inbox.ai_verdict 会被人工标注覆盖成 reason='human:*'（见 X_SUBMIT_FEEDBACK），
 * 覆盖态不是 Gemma 的判断 → 返回 undefined；重复投票时上一次的覆盖态也因此不会被误抄。
 */
export async function getGenuineAiVerdict(tweetId: string): Promise<AIVerdict | undefined> {
  const db = getXDB();
  const res = await db.query<[Array<{ ai_verdict?: AIVerdict }>]>(
    `SELECT ai_verdict FROM x_tweet WHERE tweet_id = $tweet_id LIMIT 1`,
    { tweet_id: tweetId },
  );
  const verdict = res[0]?.[0]?.ai_verdict;
  if (!verdict || typeof verdict.reason !== 'string' || verdict.reason.startsWith('human:')) return undefined;
  return verdict;
}

/** 查询 feedback 样本（Phase 3b few-shot 用） */
export async function queryFeedbackSamples(opts: {
  verdict: FeedbackVerdict;
  lang?: string;
  limit?: number;
}): Promise<TweetFeedback[]> {
  const db = getXDB();
  const limit = opts.limit ?? 20;
  const conditions = ['verdict = $verdict'];
  if (opts.lang) conditions.push('lang = $lang');
  const where = `WHERE ${conditions.join(' AND ')}`;
  const res = await db.query<[TweetFeedback[]]>(
    `SELECT * FROM tweet_feedback ${where} ORDER BY created_at DESC LIMIT $limit`,
    { verdict: opts.verdict, lang: opts.lang ?? null, limit },
  );
  return res[0] ?? [];
}
