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
import { queryInbox, insertFeedback, queryFeedbackSamples, applyHumanVerdict, queryMissingTranslation, setTranslation, getGenuineAiVerdict, getFeedbackStats, markReplied } from '../db/tweet-inbox-repo';
import { googleTranslate, translateCircuitOpen } from './google-translate';
import { scanRecipe, abortScan } from './x-timeline-scan';
import { runJudgeBatch, startJudgeDrain, getJudgeConfig } from './x-ai-judge';
import { setActiveXWcId, getActiveWcId } from './x-search-scheduler';
import { blockAuthor, unblockAuthor, listBlocked, getBlockedHandleSet, setSelfAuthor, getSelfHandle } from '../db/x-author-repo';
import { probeSelfHandle } from './x-self-account';
import { runWatchlistSpike } from './x-watchlist-spike';
import { DEFAULT_FILTER_CONFIG } from '@shared/types/x-timeline-types';
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
      // 屏蔽名单现取(与调度器同源):失败直接抛给下面的 catch → 返回 error,
      // 绝不退化成空黑名单继续采集(feedback-fail-loud-no-fallback)
      const accountBlacklist = await getBlockedHandleSet();
      const result = await scanRecipe(recipe, p.wsId, targetWcId, {
        ...DEFAULT_FILTER_CONFIG,
        accountBlacklist,
      });
      if (result.saved > 0) {
        // 只判触发它的那个 ws（p.wsId 已在上方校验为 string），防跨 ws 混批
        runJudgeBatch(getJudgeConfig(), p.wsId).catch((err) => {
          console.error(`[x-timeline-handlers] judge batch after manual run ws=${p.wsId} failed:`, err);
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

  // X_AI_JUDGE_BATCH — 手动触发 AI 批判断（面板自己知道 ws，须带 wsId 只判本 ws）
  ipcMain.handle(IPC_CHANNELS.X_AI_JUDGE_BATCH, async (_e, payload: unknown) => {
    const p = payload as { wsId?: unknown } | null;
    if (!p || typeof p.wsId !== 'string' || !p.wsId) {
      // fail loud：缺 wsId 是调用方 bug，留痕不静默退回全局混判
      console.error('[x-timeline-handlers] X_AI_JUDGE_BATCH missing wsId, refusing to run (would mix cross-ws)');
      return { success: false, error: 'wsId required' };
    }
    try {
      // 首批 await:让 UI 立刻拿到真实战果(判了几条/失败原因);
      // 剩余积压交给后台 drain 逐批清,出错即停并留痕
      const first = await runJudgeBatch(getJudgeConfig(), p.wsId);
      const remaining = (await queryInbox({ status: 'pending', wsId: p.wsId, limit: 5000 })).length;
      if (remaining > 0) startJudgeDrain(getJudgeConfig(), p.wsId);
      return { success: true, judged: first.judged, worth: first.worth, remaining, draining: remaining > 0 };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // X_INBOX_QUERY — 查询 tweet_inbox（Review Queue 用）
  ipcMain.handle(IPC_CHANNELS.X_INBOX_QUERY, async (_e, payload: unknown) => {
    const p = payload as { status?: unknown; statuses?: unknown; wsId?: unknown; lang?: unknown; searchRecipe?: unknown; taskId?: unknown; humanReviewed?: unknown; orderBy?: unknown; limit?: unknown; offset?: unknown; excludeHidden?: unknown } | null;
    try {
      const records = await queryInbox({
        status: typeof p?.status === 'string' ? (p.status as TweetInboxStatus) : undefined,
        statuses: Array.isArray(p?.statuses) ? (p.statuses as TweetInboxStatus[]) : undefined,
        wsId: typeof p?.wsId === 'string' ? p.wsId : undefined,
        lang: typeof p?.lang === 'string' ? p.lang : undefined,
        searchRecipe: typeof p?.searchRecipe === 'string' ? p.searchRecipe : undefined,
        taskId: typeof p?.taskId === 'string' ? p.taskId : undefined,
        humanReviewed: typeof p?.humanReviewed === 'boolean' ? p.humanReviewed : undefined,
        orderBy: p?.orderBy === 'confidence' ? 'confidence' : undefined,
        limit: typeof p?.limit === 'number' ? p.limit : 50,
        offset: typeof p?.offset === 'number' ? p.offset : 0,
        // 缺省即隐藏屏蔽者/自己的推文;调用方显式传 false 才看得到全量
        excludeHidden: typeof p?.excludeHidden === 'boolean' ? p.excludeHidden : undefined,
      });
      // datetime/RecordId 等 SDK 类型过 structured clone 会丢原型(renderer 拿到空对象,
      // new Date() 解析成 NaN → 卡片显示"NaNd前");JSON 边界统一压成 ISO 字符串
      return { success: true, records: JSON.parse(JSON.stringify(records)) };
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

  // X_INVALIDATE_WC — 强制指定 guest 全量重绘。
  //
  // ⚠️ 这条是「打开 DevTools 侧栏就正确了」的解药。
  // 隐藏的 view 挂在 display:none 下保活(SlotArea.tsx:86),其 <webview> 的
  // OS surface 随之脱离;重新上台时 surface 挂回来,带的却是**上次画的那一帧**。
  // guest 内部布局其实早就算对了(实测 host=1679 时左导航已排成展开 389px),
  // 只是没画出来 —— 所以派发多少次 resize 都没用,那是布局侧的药。
  // 开 DevTools 之所以"一按就好",正是因为它顺带强制了一次真实重绘。
  //
  // webContents.invalidate() = "Schedules a full repaint",是 renderer 侧
  // 拿不到的主进程 API(<webview> 标签只暴露 getWebContentsId)。
  ipcMain.handle(IPC_CHANNELS.X_INVALIDATE_WC, (_e, payload: unknown) => {
    const wcId = (payload as { wcId?: unknown } | null)?.wcId;
    if (typeof wcId !== 'number') return { success: false, error: 'wcId required' };
    const wc = webContents.fromId(wcId);
    if (!wc || wc.isDestroyed()) return { success: false, error: 'webContents not found' };
    try {
      wc.invalidate();
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
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
      // 先抄 Gemma 原始判断快照：下面 applyHumanVerdict 会用 human:* 覆盖 ai_verdict，
      // 且 inbox 有 7 天 TTL —— 此快照是准确率对账的唯一持久来源（migration 1.8.7）
      const aiVerdictSnapshot = await getGenuineAiVerdict(p.tweet_id);
      await insertFeedback({
        tweet_id:      p.tweet_id,
        text:          p.text ?? '',
        lang:          p.lang,
        author_handle: p.author_handle ?? '',
        verdict:       p.verdict as FeedbackVerdict,
        reason_tag:    p.reason_tag,
        source_recipe: p.source_recipe,
        created_at:    new Date().toISOString(),
        ai_verdict:    aiVerdictSnapshot,
      });
      // 同步更新 x_tweet:accept → worth + **永久保留**(expires_at=NONE),reject → skip
      // (A 期止血:此前这里走 updateVerdict,不动 expires_at,采纳的推文照样 7 天后被 TTL 删掉)
      await applyHumanVerdict(p.tweet_id, p.verdict as FeedbackVerdict);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // X_FEEDBACK_STATS — 近7天 Gemma 建议采纳率 / 捞回漏判数（侧栏仪表）
  ipcMain.handle(IPC_CHANNELS.X_FEEDBACK_STATS, async () => {
    try {
      const stats = await getFeedbackStats();
      return { success: true, stats };
    } catch (err) {
      return { success: false, error: String(err), stats: null };
    }
  });

  // X_MARK_REPLIED — 标记推文已回复（已确认视图清场）
  ipcMain.handle(IPC_CHANNELS.X_MARK_REPLIED, async (_e, payload: unknown) => {
    const p = payload as { tweetId?: unknown } | null;
    if (typeof p?.tweetId !== 'string') {
      return { success: false, error: 'invalid payload: tweetId required' };
    }
    try {
      await markReplied(p.tweetId);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // ── 屏蔽名单（B 期）─────────────────────────────────────────────
  // 语义:屏蔽只约束**未来采集**,已抓的历史推文一律保留(方案 §3.3 已拍板)。

  // X_BLOCK_AUTHOR — 屏蔽某作者
  ipcMain.handle(IPC_CHANNELS.X_BLOCK_AUTHOR, async (_e, payload: unknown) => {
    const p = payload as { handle?: unknown; reason?: unknown } | null;
    if (typeof p?.handle !== 'string' || !p.handle.trim()) {
      return { success: false, error: 'invalid payload: handle required' };
    }
    const reason = typeof p.reason === 'string' && p.reason.trim() ? p.reason.trim() : undefined;
    try {
      await blockAuthor(p.handle, reason);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // X_UNBLOCK_AUTHOR — 解除屏蔽
  ipcMain.handle(IPC_CHANNELS.X_UNBLOCK_AUTHOR, async (_e, payload: unknown) => {
    const p = payload as { handle?: unknown } | null;
    if (typeof p?.handle !== 'string' || !p.handle.trim()) {
      return { success: false, error: 'invalid payload: handle required' };
    }
    try {
      await unblockAuthor(p.handle);
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // X_LIST_BLOCKED — 取屏蔽名单
  ipcMain.handle(IPC_CHANNELS.X_LIST_BLOCKED, async () => {
    try {
      const authors = await listBlocked();
      return { success: true, authors };
    } catch (err) {
      return { success: false, error: String(err), authors: [] };
    }
  });

  // X_DETECT_SELF — 探测当前登录的 X 账号并标记 is_self
  // ⚠️ 探测不到就返回失败,**绝不写一个猜的 handle** —— 写错会把别人的推当成
  // 自己的永久隐藏,现象是"推文莫名消失",极难查。
  ipcMain.handle(IPC_CHANNELS.X_DETECT_SELF, async (_e, payload: unknown) => {
    const p = payload as { wcId?: unknown } | null;
    const wcId = typeof p?.wcId === 'number' ? p.wcId : undefined;
    try {
      const probe = await probeSelfHandle(wcId);
      if (!probe.handle) {
        // 留痕:tried 里有每条策略的命中情况,是 spike 时定位 X DOM 变化的唯一线索
        console.error('[x-timeline-handlers] detect self failed, tried:', probe.tried);
        return { success: false, error: `未能识别当前登录账号(${probe.tried.join(' | ')})` };
      }
      await setSelfAuthor(probe.handle);
      console.log(`[x-timeline-handlers] self account = @${probe.handle} (via ${probe.via})`);
      return { success: true, handle: probe.handle, via: probe.via, tried: probe.tried };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // X_GET_SELF — 取已标记的「我自己」
  ipcMain.handle(IPC_CHANNELS.X_GET_SELF, async () => {
    try {
      return { success: true, handle: await getSelfHandle() };
    } catch (err) {
      return { success: false, error: String(err), handle: null };
    }
  });

  // X_WATCHLIST_SPIKE — B' 期实机诊断:哪种搜索写法能抓到「推文+回复」
  // ⚠️ 只读不写:不落库、不改状态,结果由人判读后再定实现(交接文档 §4.1)
  ipcMain.handle(IPC_CHANNELS.X_WATCHLIST_SPIKE, async (_e, payload: unknown) => {
    const p = payload as { handle?: unknown; wcId?: unknown } | null;
    if (typeof p?.handle !== 'string' || !p.handle.trim()) {
      return { success: false, error: 'invalid payload: handle required' };
    }
    const wcId = typeof p.wcId === 'number' ? p.wcId : undefined;
    try {
      const r = await runWatchlistSpike(p.handle, wcId);
      if ('error' in r) return { success: false, error: r.error };
      return { success: true, ...r };
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

/**
 * 批量补填缺翻译的非中文推文，逐条调 Google 翻译。
 *
 * 限速 / 退避 / 熔断都在 googleTranslate 内部，这里不重复实现。
 * 被限流(熔断)时**提前收工**而不是空转到底 —— 没翻成的条目 DB 里仍缺
 * translation，下次启动会被重新查出来，不会丢。
 */
async function backfillTranslations(): Promise<void> {
  const rows = await queryMissingTranslation(1000);
  console.log(`[backfillTranslations] found ${rows.length} tweets needing translation`);
  if (rows.length === 0) return;

  let done = 0;
  let failed = 0;
  let aborted = false;

  for (const row of rows) {
    if (translateCircuitOpen()) {
      aborted = true;
      break;
    }
    const translation = await googleTranslate(row.text);
    if (translation) {
      await setTranslation(row.tweet_id, translation);
      done++;
      if (done % 20 === 0) {
        console.log(`[backfillTranslations] ${done}/${rows.length} done`);
      }
    } else {
      failed++;
    }
  }

  // 如实汇报:成功多少、失败多少、是否被限流打断(反静默坍缩)
  const remaining = rows.length - done - failed;
  console.log(
    `[backfillTranslations] ${aborted ? '被限流中断' : 'completed'} — ` +
      `成功 ${done} / 失败 ${failed}` +
      (remaining > 0 ? ` / 未尝试 ${remaining}` : '') +
      ` (共 ${rows.length},未成功的下次启动会重试)`,
  );
}
