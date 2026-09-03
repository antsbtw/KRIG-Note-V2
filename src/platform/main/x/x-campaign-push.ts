/**
 * 接口 A 客户端 —— 把活动留言推给 campaign-tasks(契约 §2)。
 *
 * 契约要点(逐条对应实现):
 *  · §2.1 一次 1–500 条,超过分批;请求体上限 1 MB
 *  · §2.1 幂等键 (article_id, tweet_id) —— 重复推没有副作用,故可放心重试
 *  · §2.3 5xx/超时/连接失败 → 退避 2s → 8s → 30s → 2min → 之后每 5min
 *  · §2.3 4xx **不重试**;401 **停下报警**而不是循环(密钥错了越试越糟)
 *  · §2.3 重启后把上次未确认成功的批次重推一遍 —— 靠 pushed_at 天然实现
 */

import { getCampaignConfig } from './x-campaign-config';
import { listUnpushed, markPushed } from '../db/x-campaign-repo';
import type { ArticleReplyItem } from './x-article-replies';

/** 契约 §2.3 的退避序列(毫秒),最后一档之后固定 5 分钟一次 */
const BACKOFF_MS = [2_000, 8_000, 30_000, 120_000];
const BACKOFF_TAIL_MS = 300_000;

/** 一次推送的结果 */
export interface PushResult {
  attempted: number;
  accepted: number;
  updated: number;
  rejected: Array<{ tweet_id: string; reason: string }>;
  matchedPending: number;
  /** 已确认成功、可标 pushed_at 的 id */
  confirmedIds: string[];
  /** 致命错误(401/400 等 4xx)—— 调用方应停下报警,不要重试 */
  fatal?: string;
  /** 可重试错误(5xx/网络) */
  retryable?: string;
}

/** 按契约上限切批:≤500 条,且请求体 <1MB */
export function chunkItems(items: ArticleReplyItem[], maxCount = 500): ArticleReplyItem[][] {
  const out: ArticleReplyItem[][] = [];
  let cur: ArticleReplyItem[] = [];
  let bytes = 0;
  const LIMIT = 900_000;                       // 留 ~10% 余量给信封与编码膨胀
  for (const it of items) {
    const size = JSON.stringify(it).length + 2;
    if (cur.length >= maxCount || (bytes + size > LIMIT && cur.length > 0)) {
      out.push(cur); cur = []; bytes = 0;
    }
    cur.push(it); bytes += size;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** 推一批(单次尝试,不含重试)—— 重试策略由 pushPending 编排 */
export async function pushBatch(
  articleId: string, items: ArticleReplyItem[],
): Promise<PushResult> {
  const cfg = getCampaignConfig();
  const base: PushResult = {
    attempted: items.length, accepted: 0, updated: 0,
    rejected: [], matchedPending: 0, confirmedIds: [],
  };
  if (!cfg) {
    // 未配置不是"网络问题",必须说清楚,否则会被当成对方没起服务排查半天
    return { ...base, fatal: '未配置 CAMPAIGN_TASKS_IMPORT_URL / X_SCRAPER_SECRET' };
  }
  if (items.length === 0) return base;

  const body = JSON.stringify({
    article_id: articleId,
    source: `scraper-${process.platform}`,
    items,
  });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);   // 契约 §1:等对方最多 10s
  try {
    const resp = await fetch(cfg.importUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Scraper-Secret': cfg.secret,
      },
      body,
      signal: ctl.signal,
    });

    if (resp.status === 401) {
      return { ...base, fatal: '401 UNAUTHORIZED —— 密钥不对。已停止推送(契约要求报警而非循环重试)' };
    }
    if (resp.status === 400 || resp.status === 413) {
      const t = await resp.text().catch(() => '');
      return { ...base, fatal: `${resp.status} —— 请求结构问题,不重试:${t.slice(0, 200)}` };
    }
    if (!resp.ok) {
      return { ...base, retryable: `${resp.status} ${resp.statusText}` };
    }

    const json = await resp.json() as {
      success?: boolean;
      data?: { accepted?: number; updated?: number; matched_pending?: number;
        rejected?: Array<{ tweet_id: string; reason: string }> };
      error?: { code?: string; message?: string };
    };
    if (!json.success) {
      return { ...base, retryable: `对方返回 success=false: ${json.error?.code ?? '?'}` };
    }

    const d = json.data ?? {};
    const rejected = d.rejected ?? [];
    const rejectedIds = new Set(rejected.map((r) => r.tweet_id));
    return {
      ...base,
      accepted: d.accepted ?? 0,
      updated: d.updated ?? 0,
      matchedPending: d.matched_pending ?? 0,
      rejected,
      // ⚠️ 单条被拒的**不标已推**:标了就再也不会重试,而 rejected 里
      // 有些是可修的(如 MISSING_USERNAME 下次采集补全了字段就能过)。
      confirmedIds: items.map((i) => i.tweet_id).filter((id) => !rejectedIds.has(id)),
    };
  } catch (err) {
    const msg = String(err);
    // AbortError = 超时,属可重试(契约 §2.3 把超时归入重试类)
    return { ...base, retryable: msg.includes('Abort') ? '请求超时(10s)' : msg };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 推送某篇文章的待推队列(带契约退避重试)。
 *
 * @param maxAttempts 单批最多尝试几次;超过则留在队列里等下一轮定时推送
 */
export async function pushPending(
  articleId: string, maxAttempts = 4,
): Promise<{ batches: number; accepted: number; updated: number;
  rejected: number; matchedPending: number; fatal?: string }> {
  const pending = await listUnpushed(articleId);
  const summary = { batches: 0, accepted: 0, updated: 0, rejected: 0, matchedPending: 0 };
  if (pending.length === 0) return summary;

  for (const batch of chunkItems(pending)) {
    let attempt = 0;
    for (;;) {
      const r = await pushBatch(articleId, batch);

      if (r.fatal) {
        // 401/400:停下报警,**不重试**(契约 §2.3)
        console.error('[campaign-push] 致命错误,停止推送:', r.fatal);
        return { ...summary, fatal: r.fatal };
      }

      if (!r.retryable) {
        if (r.confirmedIds.length) await markPushed(articleId, r.confirmedIds);
        summary.batches++;
        summary.accepted += r.accepted;
        summary.updated += r.updated;
        summary.rejected += r.rejected.length;
        summary.matchedPending += r.matchedPending;
        if (r.rejected.length) {
          console.warn('[campaign-push] 单条被拒(不影响同批其他条):', r.rejected.slice(0, 5));
        }
        break;
      }

      attempt++;
      if (attempt >= maxAttempts) {
        // 留在队列里(没标 pushed_at),下一轮定时推送会再试 —— 幂等,无副作用
        console.warn(`[campaign-push] 批次重试 ${attempt} 次仍失败(${r.retryable}),`
          + `留在队列等下轮`);
        break;
      }
      const wait = BACKOFF_MS[attempt - 1] ?? BACKOFF_TAIL_MS;
      console.warn(`[campaign-push] ${r.retryable} → ${wait / 1000}s 后重试(第 ${attempt} 次)`);
      await new Promise((res) => setTimeout(res, wait));
    }
  }
  return summary;
}
