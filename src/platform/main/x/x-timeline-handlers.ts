/**
 * X 时间线智能筛选 IPC handlers（Phase 1 + Phase 2）
 *
 * 通道：
 * - X_RUN_RECIPE：手动触发指定配方（Phase 2: 新增 wsId）
 * - X_SCAN_PAUSE：暂停指定 ws 扫描（Phase 2: 改为 invoke + wsId）
 * - X_AI_JUDGE_BATCH：手动触发 AI 批判断
 * - X_INBOX_QUERY：查询 tweet_inbox（Review Queue 用）
 * - X_LIST_RECIPES：查询所有配方（Phase 2）
 * - X_GET_ACTIVE_WC：取指定 ws 当前活跃 wcId（Phase 2）
 * - X_REPLY_TWEET：导航 X webview 到目标推文（Phase 2）
 */

import { ipcMain, webContents } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { getRecipeById, listAllRecipes, upsertRecipe, deleteRecipe, getRecipeStats } from '../db/search-recipe-repo';
import { queryInbox, insertFeedback, queryFeedbackSamples, updateVerdict, queryMissingTranslation, setTranslation } from '../db/tweet-inbox-repo';
import { googleTranslate } from './google-translate';
import { scanRecipe, abortScan } from './x-timeline-scan';
import { runJudgeBatch } from './x-ai-judge';
import { setActiveXWcId, getActiveWcId } from './x-search-scheduler';
import { DEFAULT_FILTER_CONFIG, DEFAULT_JUDGE_CONFIG } from '@shared/types/x-timeline-types';
import type { TweetInboxStatus, TweetFeedback, FeedbackVerdict, SearchRecipe } from '@shared/types/x-timeline-types';

export function registerXTimelineHandlers(): void {
  // X_RUN_RECIPE — 手动触发指定配方
  ipcMain.handle(IPC_CHANNELS.X_RUN_RECIPE, async (_e, payload: unknown) => {
    const p = payload as { recipeId?: unknown; wsId?: unknown; targetWcId?: unknown } | null;
    if (!p || typeof p.recipeId !== 'string') {
      return { success: false, error: 'invalid payload: recipeId required' };
    }
    if (typeof p.wsId !== 'string') {
      return { success: false, error: 'invalid payload: wsId required' };
    }
    const targetWcId = typeof p.targetWcId === 'number' ? p.targetWcId : null;
    if (targetWcId === null) {
      return { success: false, error: 'invalid payload: targetWcId required' };
    }

    const recipe = await getRecipeById(p.recipeId).catch(() => null);
    if (!recipe) {
      return { success: false, error: `recipe ${p.recipeId} not found` };
    }

    setActiveXWcId(p.wsId, targetWcId);

    try {
      const result = await scanRecipe(recipe, p.wsId, targetWcId, DEFAULT_FILTER_CONFIG);
      if (result.saved > 0) {
        runJudgeBatch(DEFAULT_JUDGE_CONFIG).catch((err) => {
          console.error('[x-timeline-handlers] judge batch after manual run failed:', err);
        });
      }
      return { success: true, ...result };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // X_SCAN_PAUSE — 暂停指定 ws 扫描（invoke + wsId）
  ipcMain.handle(IPC_CHANNELS.X_SCAN_PAUSE, (_e, payload: unknown) => {
    const p = payload as { wsId?: string } | null;
    if (p?.wsId) {
      abortScan(p.wsId);
      console.log(`[x-timeline-handlers] scan paused for ws=${p.wsId}`);
    }
  });

  // X_AI_JUDGE_BATCH — 手动触发 AI 批判断
  ipcMain.handle(IPC_CHANNELS.X_AI_JUDGE_BATCH, async () => {
    try {
      await runJudgeBatch(DEFAULT_JUDGE_CONFIG);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // X_INBOX_QUERY — 查询 tweet_inbox（Review Queue 用）
  ipcMain.handle(IPC_CHANNELS.X_INBOX_QUERY, async (_e, payload: unknown) => {
    const p = payload as { status?: unknown; statuses?: unknown; wsId?: unknown; lang?: unknown; limit?: unknown; offset?: unknown } | null;
    try {
      const records = await queryInbox({
        status: typeof p?.status === 'string' ? (p.status as TweetInboxStatus) : undefined,
        statuses: Array.isArray(p?.statuses) ? (p.statuses as TweetInboxStatus[]) : undefined,
        wsId: typeof p?.wsId === 'string' ? p.wsId : undefined,
        lang: typeof p?.lang === 'string' ? p.lang : undefined,
        limit: typeof p?.limit === 'number' ? p.limit : 50,
        offset: typeof p?.offset === 'number' ? p.offset : 0,
      });
      return { success: true, records };
    } catch (err) {
      return { success: false, error: String(err), records: [] };
    }
  });

  // X_LIST_RECIPES — 查询所有配方
  ipcMain.handle(IPC_CHANNELS.X_LIST_RECIPES, async () => {
    try {
      const recipes = await listAllRecipes();
      return { success: true, recipes };
    } catch (err) {
      return { success: false, error: String(err), recipes: [] };
    }
  });

  // X_GET_ACTIVE_WC — 面板加载时拿到自己 ws 的 wcId
  ipcMain.handle(IPC_CHANNELS.X_GET_ACTIVE_WC, (_e, payload: unknown) => {
    const p = payload as { wsId?: string } | null;
    if (!p?.wsId) return { wcId: null };
    const wcId = getActiveWcId(p.wsId);
    return { wcId };
  });

  // X_REPLY_TWEET — 导航 X webview 到目标推文（不填内容，写方向红线）
  // wcId 优先用 payload 里 renderer 直传的值，没有时才回退到 activeXWcMap
  ipcMain.handle(IPC_CHANNELS.X_REPLY_TWEET, async (_e, payload: unknown) => {
    const p = payload as { tweetUrl?: string; tweetId?: string; wsId?: string; wcId?: number } | null;
    if (!p?.tweetUrl) return { success: false, error: 'tweetUrl required' };
    try {
      const wcId = typeof p.wcId === 'number' ? p.wcId : (p.wsId ? getActiveWcId(p.wsId) : null);
      if (!wcId) return { success: false, error: 'no active X webview for this workspace' };
      const wc = webContents.fromId(wcId);
      if (!wc || wc.isDestroyed()) return { success: false, error: 'X webview not available' };
      wc.loadURL(p.tweetUrl);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // X_SUBMIT_FEEDBACK — 人工反馈 accept/reject
  ipcMain.handle(IPC_CHANNELS.X_SUBMIT_FEEDBACK, async (_e, payload: unknown) => {
    const p = payload as Partial<TweetFeedback> | null;
    if (!p?.tweet_id || !p?.verdict || !['accept', 'reject'].includes(p.verdict)) {
      return { success: false, error: 'invalid payload: tweet_id and verdict required' };
    }
    try {
      await insertFeedback({
        tweet_id:      p.tweet_id,
        text:          p.text ?? '',
        lang:          p.lang,
        author_handle: p.author_handle ?? '',
        verdict:       p.verdict as FeedbackVerdict,
        reason_tag:    p.reason_tag,
        source_recipe: p.source_recipe,
        created_at:    new Date().toISOString(),
      });
      // 同步更新 tweet_inbox 状态：accept → worth，reject → skip（UI 不再展示 skip）
      const newStatus = p.verdict === 'accept' ? 'worth' : 'skip';
      await updateVerdict(p.tweet_id, { worth: newStatus === 'worth', confidence: 1, reason: `human:${p.verdict}`, tags: [], suggestReply: newStatus === 'worth' });
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // X_QUERY_FEEDBACK — 查询 feedback 样本（Phase 3b 预留）
  ipcMain.handle(IPC_CHANNELS.X_QUERY_FEEDBACK, async (_e, payload: unknown) => {
    const p = payload as { verdict?: string; lang?: string; limit?: number } | null;
    if (!p?.verdict || !['accept', 'reject'].includes(p.verdict)) {
      return { success: false, error: 'verdict required', samples: [] };
    }
    try {
      const samples = await queryFeedbackSamples({
        verdict: p.verdict as FeedbackVerdict,
        lang: p.lang,
        limit: p.limit,
      });
      return { success: true, samples };
    } catch (err) {
      return { success: false, error: String(err), samples: [] };
    }
  });

  // X_UPSERT_RECIPE — 新建或更新配方
  ipcMain.handle(IPC_CHANNELS.X_UPSERT_RECIPE, async (_e, payload: unknown) => {
    const p = payload as Partial<SearchRecipe> | null;
    if (!p || typeof p.name !== 'string' || !p.name.trim()) {
      throw new Error('invalid payload: name required');
    }
    const recipe = await upsertRecipe({
      id: typeof p.id === 'string' ? p.id : undefined,
      name: p.name.trim(),
      enabled: p.enabled ?? true,
      template: p.template ?? 'help-wanted',
      keywords: p.keywords ?? [],
      fromAccounts: p.fromAccounts ?? [],
      helpSignals: p.helpSignals ?? [],
      minLikes: p.minLikes ?? 0,
      minRetweets: p.minRetweets ?? 0,
      lang: p.lang,
      sinceHours: p.sinceHours ?? 24,
      resultType: p.resultType ?? 'latest',
      intervalMinutes: p.intervalMinutes ?? 30,
    });
    return { success: true, recipe };
  });

  // X_DELETE_RECIPE — 删除配方
  ipcMain.handle(IPC_CHANNELS.X_DELETE_RECIPE, async (_e, payload: unknown) => {
    const p = payload as { recipeId?: string } | null;
    if (!p?.recipeId) throw new Error('invalid payload: recipeId required');
    await deleteRecipe(p.recipeId);
    return { success: true };
  });

  // X_GET_RECIPE_STATS — 采纳率统计
  ipcMain.handle(IPC_CHANNELS.X_GET_RECIPE_STATS, async (_e, payload: unknown) => {
    const p = payload as { recipeId?: string } | null;
    if (!p?.recipeId) throw new Error('invalid payload: recipeId required');
    const stats = await getRecipeStats(p.recipeId);
    return { success: true, stats };
  });

  // 启动时后台补填历史非中文推文翻译（延迟 8s 等 DB ready，fire-and-forget）
  setTimeout(() => {
    backfillTranslations().catch((err) =>
      console.error('[x-timeline-handlers] backfillTranslations failed:', err),
    );
  }, 8_000);
}

/** 批量补填缺翻译的非中文推文，逐条调 Google 翻译，失败条目静默跳过 */
async function backfillTranslations(): Promise<void> {
  const rows = await queryMissingTranslation(1000);
  console.log(`[backfillTranslations] found ${rows.length} tweets needing translation`);
  if (rows.length === 0) return;

  let total = 0;
  for (const row of rows) {
    const translation = await googleTranslate(row.text);
    if (translation) {
      await setTranslation(row.tweet_id, translation);
      total++;
      if (total % 10 === 0) {
        console.log(`[backfillTranslations] ${total}/${rows.length} done`);
      }
    }
  }

  console.log(`[backfillTranslations] completed, total=${total}/${rows.length}`);
}
