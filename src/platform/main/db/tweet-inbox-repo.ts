/**
 * tweet_inbox 表 CRUD（X 时间线智能筛选 Phase 1）
 *
 * 调用边界：仅 main 进程调用，直接 import @storage/surreal/client。
 */

import { getDB } from '@storage/surreal/client';
import type { TweetInboxRecord, AIVerdict, TweetInboxStatus, TweetFeedback, FeedbackVerdict } from '@shared/types/x-timeline-types';
import { DEFAULT_TASK_ID } from '@shared/types/x-timeline-types';

/** 写入或忽略（tweet_id 唯一索引冲突 = 重复，直接跳过） */
export async function upsertTweet(record: TweetInboxRecord): Promise<void> {
  const db = getDB();
  await db.query(
    `INSERT IGNORE INTO tweet_inbox {
      tweet_id: $tweet_id,
      text: $text,
      author_name: $author_name,
      author_handle: $author_handle,
      author_avatar: $author_avatar,
      tweet_url: $tweet_url,
      lang: $lang,
      metrics: $metrics,
      fetched_at: $fetched_at,
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
      replied_at: $replied_at,
      reply_draft: $reply_draft
    }`,
    {
      tweet_id: record.tweet_id,
      text: record.text,
      author_name: record.author_name,
      author_handle: record.author_handle,
      author_avatar: record.author_avatar ?? undefined,
      tweet_url: record.tweet_url ?? undefined,
      lang: record.lang ?? undefined,
      metrics: record.metrics,
      fetched_at: new Date(record.fetched_at),
      expires_at: new Date(record.expires_at),
      source: record.source,
      search_recipe: record.search_recipe ?? undefined,
      task_id: record.task_id ?? DEFAULT_TASK_ID,
      ws_id: record.ws_id ?? undefined,
      filter_score: record.filter_score,
      filter_reason: record.filter_reason ?? undefined,
      ai_verdict: record.ai_verdict ?? undefined,
      translation: record.translation ?? undefined,
      status: record.status,
      replied_at: record.replied_at ? new Date(record.replied_at) : undefined,
      reply_draft: record.reply_draft ?? undefined,
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
 *  - 不限时间窗：人工拒绝(skip)过的推文永远不重新抓入
 *  - windowHours 保留参数签名兼容，但只用于 filtered_out 过期清理，不影响核心去重
 */
export async function getTweetIdSet(_windowHours: number): Promise<Set<string>> {
  const db = getDB();
  const res = await db.query<[Array<{ tweet_id: string }>]>(
    `SELECT tweet_id FROM tweet_inbox`,
  );
  const rows = res[0] ?? [];
  return new Set(rows.map((r) => r.tweet_id));
}

/** 查询 pending 推文（AI 判断前批量拉取）
 *  - 传 wsId → 只取该 ws 的 pending（AI 判断 per-ws 隔离，防跨 ws 混批）
 *  - 不传 wsId → 保持原全局行为（向后兼容）
 */
export async function queryPending(limit = 50, wsId?: string): Promise<TweetInboxRecord[]> {
  const db = getDB();
  const wsFilter = wsId ? 'AND ws_id = $wsId' : '';
  const res = await db.query<[TweetInboxRecord[]]>(
    `SELECT * FROM tweet_inbox WHERE status = 'pending' ${wsFilter} ORDER BY fetched_at ASC LIMIT $limit`,
    { limit, wsId: wsId ?? null },
  );
  return res[0] ?? [];
}

/** 将一批推文状态更新为 ai_judging */
export async function markAiJudging(tweetIds: string[]): Promise<void> {
  if (tweetIds.length === 0) return;
  const db = getDB();
  await db.query(
    `UPDATE tweet_inbox SET status = 'ai_judging' WHERE tweet_id IN $ids`,
    { ids: tweetIds },
  );
}

/** 写回 AI 判断结果（worth / skip）+ 可选翻译 */
export async function updateVerdict(tweetId: string, verdict: AIVerdict): Promise<void> {
  const db = getDB();
  const status: TweetInboxStatus = verdict.worth ? 'worth' : 'skip';
  await db.query(
    `UPDATE tweet_inbox SET ai_verdict = $verdict, status = $status, translation = $translation WHERE tweet_id = $tweet_id`,
    { verdict, status, translation: verdict.translation ?? undefined, tweet_id: tweetId },
  );
}

/** 查询 tweet_inbox（Review Queue 用，支持按 status / lang 过滤） */
export async function queryInbox(opts: {
  status?: TweetInboxStatus;
  statuses?: TweetInboxStatus[];   // 多状态 IN 过滤（与 status 互斥，优先级更高）
  wsId?: string;
  lang?: string;
  searchRecipe?: string;           // 按配方切片
  taskId?: string;                 // 按处理任务维度切片（阶段B恒 'judge-value'）
  limit?: number;
  offset?: number;
}): Promise<TweetInboxRecord[]> {
  const db = getDB();
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const conditions: string[] = [];
  if (opts.statuses?.length)       conditions.push('status IN $statuses');
  else if (opts.status)            conditions.push('status = $status');
  if (opts.wsId)                   conditions.push('ws_id = $wsId');
  if (opts.lang)                   conditions.push('lang = $lang');
  if (opts.searchRecipe)           conditions.push('search_recipe = $searchRecipe');
  if (opts.taskId)                 conditions.push('task_id = $taskId');
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const res = await db.query<[TweetInboxRecord[]]>(
    `SELECT * FROM tweet_inbox ${where} ORDER BY fetched_at DESC LIMIT $limit START $offset`,
    { status: opts.status, statuses: opts.statuses ?? null, wsId: opts.wsId ?? null, lang: opts.lang ?? null, searchRecipe: opts.searchRecipe ?? null, taskId: opts.taskId ?? null, limit, offset },
  );
  return res[0] ?? [];
}

/** TTL 清理：删除 expires_at 已过期的推文 */
export async function cleanExpired(): Promise<void> {
  const db = getDB();
  await db.query(`DELETE tweet_inbox WHERE expires_at < time::now()`);
}

/** 查询缺翻译的非中文推文（补填用） */
export async function queryMissingTranslation(limit = 100): Promise<Array<{ tweet_id: string; text: string; lang: string }>> {
  const db = getDB();
  // lang 不是 zh/zh-Hans/zh-Hant，且 translation 缺失
  const res = await db.query<[Array<{ tweet_id: string; text: string; lang: string }>]>(
    `SELECT tweet_id, text, lang FROM tweet_inbox
     WHERE (lang IS NOT NONE AND lang != 'zh' AND lang != 'zh-Hans' AND lang != 'zh-Hant')
       AND (translation IS NONE OR translation = '')
     LIMIT $limit`,
    { limit },
  );
  return res[0] ?? [];
}

/** 写回单条翻译 */
export async function setTranslation(tweetId: string, translation: string): Promise<void> {
  const db = getDB();
  await db.query(
    `UPDATE tweet_inbox SET translation = $translation WHERE tweet_id = $tweet_id`,
    { translation, tweet_id: tweetId },
  );
}

/** 写入人工反馈（accept / reject），允许同一 tweet_id 多次投票 */
export async function insertFeedback(fb: TweetFeedback): Promise<void> {
  const db = getDB();
  await db.query(
    `INSERT INTO tweet_feedback {
      tweet_id:      $tweet_id,
      text:          $text,
      lang:          $lang,
      author_handle: $author_handle,
      verdict:       $verdict,
      reason_tag:    $reason_tag,
      source_recipe: $source_recipe,
      created_at:    $created_at
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
    },
  );
}

/** 查询 feedback 样本（Phase 3b few-shot 用） */
export async function queryFeedbackSamples(opts: {
  verdict: FeedbackVerdict;
  lang?: string;
  limit?: number;
}): Promise<TweetFeedback[]> {
  const db = getDB();
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
