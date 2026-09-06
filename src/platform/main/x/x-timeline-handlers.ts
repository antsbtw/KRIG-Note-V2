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
import { setParentContext } from '../db/tweet-inbox-repo';
import { queryInbox, insertFeedback, queryFeedbackSamples, applyHumanVerdict, queryMissingTranslation, setTranslation, getGenuineAiVerdict, getFeedbackStats, markReplied } from '../db/tweet-inbox-repo';
import { googleTranslate, translateCircuitOpen } from './google-translate';
import { scanRecipe, abortScan } from './x-timeline-scan';
import { runJudgeBatch, startJudgeDrain, getJudgeConfig } from './x-ai-judge';
import { planReplies, planOneReply, textFingerprint } from './x-reply-planner';
import { insertReplyFeedback, getReadiness, getApprovedExamples } from '../db/x-reply-feedback-repo';
import { harvestAuthorProfile, PROFILE_STALE_HOURS } from './x-author-profile';
import { probeSearchSyntax } from './x-search-syntax-spike';
import { fetchParentTweet } from './x-parent-tweet';
import type { ReplyFeedback } from '../db/x-reply-feedback-repo';
import { setActiveXWcId, getActiveWcId } from './x-search-scheduler';
import { blockAuthor, unblockAuthor, listBlocked, getBlockedHandleSet, setSelfAuthor, getSelfHandle,
  watchAuthor, unwatchAuthor, listWatched, getAuthorStats, listWatchCandidates, watchAllAccepted } from '../db/x-author-repo';
import { probeSelfHandle } from './x-self-account';
import { getWsRole, setWsRole, listWsRoles,
  setWsAccount, getWsAccount, requireWsAccount, listWsAccounts } from '../db/x-ws-role-repo';
import { fetchArticleReplies, listOwnArticles, parseTweetUrl } from './x-article-replies';
import { upsertCampaignReplies, markMissingAsDeleted, campaignStats,
  upsertInteractions, interactionStats, verifyListForArticle } from '../db/x-campaign-repo';
import { harvestNotifications } from './x-notifications';
import { pauseCampaignLoop } from './x-campaign-loop';
import { startNotifWatch, stopNotifWatch, notifWatchSnapshot } from './x-notification-watch';
import { campaignConfigStatus } from './x-campaign-config';
import { campaignServerRunning } from './x-campaign-server';
import { getSelfHandle as getSelfHandleDb } from '../db/x-author-repo';
import type { XWsRole } from '@shared/types/x-ws-role-types';
import { probeAuthorTimeline } from './x-author-timeline-spike';
import { surveyXPayloads } from './x-payload-inspector';
import { collectReplyRelations } from './x-reply-collector';
import { harvestTimeline } from './x-timeline-harvester';
import { startCaptureMonitor, stopCaptureMonitor, getCaptureSnapshot } from './x-capture-monitor';
import { countRepliedAccepted, getOwnReplyCoverage } from '../db/x-reply-relation-repo';
import { getAuthorCounts } from '../db/x-author-repo';
import { DEFAULT_FILTER_CONFIG, normalizeHandle } from '@shared/types/x-timeline-types';
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
    pauseCampaignLoop();   // 手动跑配方要占 webview,先让自动循环让路(默认 45s)

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

  // X_PLAN_REPLIES — 给一批推文规划回复草稿。
  // ⚠️⚠️ 写方向红线:本 handler **只产草稿,不碰发布**。
  //   草稿要真正填进 X 回复框,仍走既有的 X_PASTE_REPLY(它也只填不点)。
  //   把「规划」与「填充」分开,是为了让用户在两步之间有机会逐条过目。
  ipcMain.handle(IPC_CHANNELS.X_PLAN_REPLIES, async (_e, payload: unknown) => {
    const p = payload as { wsId?: unknown; tweetIds?: unknown; limit?: unknown } | null;
    if (!p || typeof p.wsId !== 'string' || !p.wsId) {
      // 与 X_AI_JUDGE_BATCH 同样的守卫:缺 wsId 会跨 ws 混批
      console.error('[x-timeline-handlers] X_PLAN_REPLIES missing wsId, refusing to run');
      return { success: false, error: 'wsId required' };
    }
    try {
      // 候选:本 ws 里 Gemma judge 认为值得(worth)、且**还没回复过**的
      const wanted = Array.isArray(p.tweetIds)
        ? new Set(p.tweetIds.filter((x): x is string => typeof x === 'string'))
        : null;
      const pool = await queryInbox({
        status: 'worth', wsId: p.wsId, replied: false,
        limit: typeof p.limit === 'number' ? p.limit : 30,
      });
      const batch = wanted ? pool.filter((t) => wanted.has(t.tweet_id)) : pool;
      if (batch.length === 0) {
        return { success: true, drafts: [], skips: [], scanned: 0 };
      }

      // 上下文:已回过的推 / 近期回过的作者 —— 供前置规则挡掉重复打扰。
      // ⚠️ 不限 wsId:同一个人在别的 ws 被回过,也算回过。骚扰是按人算的,不按 ws 算。
      const replied = await queryInbox({ replied: true, limit: 5000 });
      const alreadyRepliedTweetIds = new Set(replied.map((t) => t.tweet_id));
      const recentlyRepliedAuthors = new Map<string, string>();
      for (const t of replied) {
        const h = normalizeHandle(t.author_handle ?? '');
        if (!h) continue;
        const at = t.fetched_at;
        const prev = recentlyRepliedAuthors.get(h);
        if (!prev || (at && at > prev)) recentlyRepliedAuthors.set(h, at);
      }

      // 文本指纹计数:识别「同一句话反复出现」的模板刷屏。
      // 单条文本判不出刷屏(模型一次只看一条),必须跨条统计 —— 2026-09-04
      // 评测里唯一残留的假阳正是此类(同一句在库里一字不差出现 3 次)。
      const corpus = await queryInbox({ wsId: p.wsId, limit: 5000 });
      const fingerprintCounts = new Map<string, number>();
      for (const t of corpus) {
        const fp = textFingerprint(t.text);
        if (fp) fingerprintCounts.set(fp, (fingerprintCounts.get(fp) ?? 0) + 1);
      }

      // 「我是谁」只认 x_ws_account —— 绝不回落全局 is_self(多 ws 下必然漂移,
      // 2026-09-04 两账号混淆就是这么来的)。取不到就让 buildRef 用默认值,
      // 不因此拦住整批(ref 错了是统计粒度问题,不是安全问题)。
      const acc = await getWsAccount(p.wsId).catch(() => null);
      const r = await planReplies(batch, getJudgeConfig(), {
        alreadyRepliedTweetIds, recentlyRepliedAuthors, fingerprintCounts,
        selfHandle: acc?.handle,
        ref: typeof (p as { ref?: unknown }).ref === 'string' ? (p as { ref: string }).ref : undefined,
      });
      return { success: true, drafts: r.drafts, skips: r.skips, scanned: batch.length };
    } catch (err) {
      // fail loud:解析失败/Ollama 挂了都会到这里,绝不返回空草稿装作「没什么可回的」
      console.error('[x-timeline-handlers] X_PLAN_REPLIES failed:', (err as Error).message);
      return { success: false, error: String(err) };
    }
  });

  // X_INBOX_QUERY — 查询 tweet_inbox（Review Queue 用）
  ipcMain.handle(IPC_CHANNELS.X_INBOX_QUERY, async (_e, payload: unknown) => {
    const p = payload as { status?: unknown; statuses?: unknown; wsId?: unknown; lang?: unknown; searchRecipe?: unknown; taskId?: unknown; humanReviewed?: unknown; orderBy?: unknown; limit?: unknown; offset?: unknown; excludeHidden?: unknown; replied?: unknown } | null;
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
        replied: typeof p?.replied === 'boolean' ? p.replied : undefined,
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
        // 存归一化形态(migration 1.0.2 统一),与 x_tweet / x_author 同形态
        author_handle: normalizeHandle(p.author_handle ?? ''),
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
    const p = payload as { wcId?: unknown; wsId?: unknown } | null;
    const wcId = typeof p?.wcId === 'number' ? p.wcId : undefined;
    try {
      const probe = await probeSelfHandle(wcId);
      if (!probe.handle) {
        // 留痕:tried 里有每条策略的命中情况,是 spike 时定位 X DOM 变化的唯一线索
        console.error('[x-timeline-handlers] detect self failed, tried:', probe.tried);
        return { success: false, error: `未能识别当前登录账号(${probe.tried.join(' | ')})` };
      }
      await setSelfAuthor(probe.handle);
      // ⭐ 身份归属到 ws(用户 2026-09-03:「当前 ws 登录什么账号,就核实这个 ws」)。
      // x_author.is_self 是全局单例,两个 ws 登不同账号时会互相覆盖 ——
      // 故权威来源是 x_ws_account,按 ws 记。
      if (typeof p?.wsId === 'string' && p.wsId) {
        await setWsAccount(p.wsId, probe.handle, probe.restId);
      }
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

  // X_WATCHLIST_SPIKE — 「取某账号全部发言」实机诊断(画像基础方法)
  // ⚠️ 只读不写:不落库、不改状态,结果由人判读后再定实现
  ipcMain.handle(IPC_CHANNELS.X_WATCHLIST_SPIKE, async (_e, payload: unknown) => {
    const p = payload as { handle?: unknown; wcId?: unknown; maxRounds?: unknown } | null;
    if (typeof p?.handle !== 'string' || !p.handle.trim()) {
      return { success: false, error: 'invalid payload: handle required' };
    }
    const wcId = typeof p.wcId === 'number' ? p.wcId : undefined;
    const maxRounds = typeof p.maxRounds === 'number' ? p.maxRounds : undefined;
    try {
      const r = await probeAuthorTimeline(p.handle, wcId, maxRounds);
      if ('error' in r) return { success: false, error: r.error };
      return { success: true, result: r };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // X_PAYLOAD_SURVEY — 勘查 X GraphQL 原始载荷:底层到底给了哪些字段
  // ⚠️ 只读:不落库不改状态。这是「能做到哪一步」的真实依据,不靠 DOM 推断
  ipcMain.handle(IPC_CHANNELS.X_PAYLOAD_SURVEY, async (_e, payload: unknown) => {
    const p = payload as { wcId?: unknown; seconds?: unknown } | null;
    const wcId = typeof p?.wcId === 'number' ? p.wcId : undefined;
    const seconds = typeof p?.seconds === 'number' ? p.seconds : undefined;
    try {
      const r = await surveyXPayloads(wcId, seconds);
      if ('error' in r) return { success: false, error: r.error };
      return { success: true, result: r };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // X_COLLECT_REPLIES — 采集回复关系(主线第一环:我回复了谁的哪条推)
  // 拦截 GraphQL 取权威字段,不从 DOM 猜。回填 replied 用的是**客观事实**,
  // 手机/网页上回的一律算数(此前 replied 只记录「我点没点过按钮」,故全库为 0)
  ipcMain.handle(IPC_CHANNELS.X_COLLECT_REPLIES, async (_e, payload: unknown) => {
    const p = payload as { handle?: unknown; wcId?: unknown } | null;
    if (typeof p?.handle !== 'string' || !p.handle.trim()) {
      return { success: false, error: 'invalid payload: handle required' };
    }
    const wcId = typeof p.wcId === 'number' ? p.wcId : undefined;

    try {
      // 一个入口即可:有游标就续传,没有就从头;抓到滚不动为止 —— 用户不必设参数
      const r = await collectReplyRelations(p.handle, wcId);
      if ('error' in r) return { success: false, error: r.error };
      const stats = await countRepliedAccepted();
      // 库里累计覆盖 ≠ 单次抓到的深度:单次受懒加载限制,但多次采集会累积
      const coverage = await getOwnReplyCoverage();
      // 基线 = X 官方的发推总数,采集完整度的分母(用户 2026-09-02 点出)
      const baseline = await getAuthorCounts(p.handle);
      return { success: true, result: r, stats, coverage, baseline };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // X_HARVEST — 通用时间线采集:把当前页 X 会显示的推文全部拿下 + 自校验
  // ⚠️ 只读不落库:这是**底座函数**的验证入口,过关后才谈接业务
  ipcMain.handle(IPC_CHANNELS.X_HARVEST, async (_e, payload: unknown) => {
    const p = payload as { url?: unknown; wcId?: unknown } | null;
    if (typeof p?.url !== 'string' || !p.url.trim()) {
      return { success: false, error: 'invalid payload: url required' };
    }
    const wcId = typeof p.wcId === 'number' ? p.wcId : undefined;
    try {
      const r = await harvestTimeline(p.url, wcId);
      if ('error' in r) return { success: false, error: r.error };
      // trace 可能上百条,只回传首尾便于判读;完整 trace 在主进程日志
      return {
        success: true,
        report: { ...r, tweets: r.tweets.length,
          sample: r.tweets.slice(0, 3),
          trace: [...r.trace.slice(0, 5), ...r.trace.slice(-5)] },
      };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // X_CAPTURE_START / STOP — 被动采集监视(左边浏览,右边实时显示抓到什么)
  // 用户 2026-09-02 定的验证方式:人眼对照 + 采集率统计,
  // 比「跑一遍自己报 ✅」可信 —— 后者校验与采集同源,一起错就一起瞎
  ipcMain.handle(IPC_CHANNELS.X_CAPTURE_START, async (_e, payload: unknown) => {
    const p = payload as { wcId?: unknown } | null;
    const wcId = typeof p?.wcId === 'number' ? p.wcId : undefined;
    try {
      const r = await startCaptureMonitor(wcId);
      if ('error' in r) return { success: false, error: r.error };
      return { success: true, snapshot: getCaptureSnapshot() };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.X_CAPTURE_STOP, async () => {
    try {
      return { success: true, snapshot: stopCaptureMonitor() };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // ── per-ws 角色配置（活动契约）—— 用户在 UI 里自己设定 ─────────────
  ipcMain.handle(IPC_CHANNELS.X_GET_WS_ROLES, async () => {
    try {
      // 一并给出各 ws 登录的账号 —— UI 上能一眼看出「这个 ws 是谁」
      return { success: true, roles: await listWsRoles(), accounts: await listWsAccounts() };
    } catch (err) {
      return { success: false, error: String(err), roles: [] };
    }
  });

  ipcMain.handle(IPC_CHANNELS.X_SET_WS_ROLE, async (_e, payload: unknown) => {
    const p = payload as {
      wsId?: unknown; role?: unknown; articleId?: unknown;
      servesRefresh?: unknown; intervalMinutes?: unknown;
    } | null;
    if (typeof p?.wsId !== 'string' || !p.wsId) {
      return { success: false, error: 'wsId required' };
    }
    const VALID: XWsRole[] = ['search', 'campaign', 'idle'];
    if (typeof p.role !== 'string' || !VALID.includes(p.role as XWsRole)) {
      return { success: false, error: `role 必须是 ${VALID.join(' / ')}` };
    }
    try {
      await setWsRole({
        wsId: p.wsId,
        role: p.role as XWsRole,
        articleId: typeof p.articleId === 'string' && p.articleId ? p.articleId : undefined,
        servesRefresh: p.servesRefresh === true,
        intervalMinutes: typeof p.intervalMinutes === 'number' ? p.intervalMinutes : undefined,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // X_LIST_ARTICLES — 探测本账号的 Article,供配置项下拉选(不写死默认值)
  ipcMain.handle(IPC_CHANNELS.X_LIST_ARTICLES, async (_e, payload: unknown) => {
    const p = payload as { wcId?: unknown; wsId?: unknown } | null;
    const wcId = typeof p?.wcId === 'number' ? p.wcId : undefined;
    try {
      // 按**本 ws** 的登录账号列 Article,不用全局 is_self
      if (typeof p?.wsId !== 'string' || !p.wsId) {
        return { success: false, error: 'wsId required' };
      }
      const acc = await requireWsAccount(p.wsId);
      const r = await listOwnArticles(acc.handle, wcId);
      if ('error' in r) return { success: false, error: r.error };
      return { success: true, articles: r };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // X_FETCH_ARTICLE_REPLIES — 试抓一篇文章的回复(测试用,只抓不推送)
  ipcMain.handle(IPC_CHANNELS.X_FETCH_ARTICLE_REPLIES, async (_e, payload: unknown) => {
    // 手动操作要占用 webview —— 先让自动循环让路(否则两边抢,页面一直转圈)
    pauseCampaignLoop();
    const p = payload as {
      wsId?: unknown; articleId?: unknown; wcId?: unknown; budgetMs?: unknown;
    } | null;
    if (typeof p?.articleId !== 'string' || !p.articleId) {
      return { success: false, error: 'articleId required' };
    }
    try {
      // ⚠️ 角色守卫:活动采集只能用 campaign ws。用错 ws 会与定时搜索互相
      // 导航打断,现象是「活动偶尔抓不到」,故 fail loud 而非静默继续。
      if (typeof p.wsId === 'string' && p.wsId) {
        const cfg = await getWsRole(p.wsId);
        if (cfg.role !== 'campaign') {
          return { success: false, error:
            `ws=${p.wsId} 的角色是 '${cfg.role}',活动采集需要 'campaign'。`
            + `请先在设置里把该 ws 配成 campaign。` };
        }
      }
      // 链接给出文章作者(拼详情页 URL 用);**本 ws 的登录账号**决定「我是谁」。
      // ⚠️ 用户 2026-09-03 指正:「当前 ws 是登录什么账号,就核实这个 ws 的状态,
      //    而不是跑到一个对应不上的 ws 来核实」。
      //    故不再回落全局 is_self —— 两个 ws 登不同账号时全局值只会是其中一个,
      //    拿它去核实另一个 ws 会静默抓错人。
      const parsed = parseTweetUrl(p.articleId);
      if ('error' in parsed) return { success: false, error: parsed.error };

      let handle = parsed.handle;
      if (!handle) {
        // 链接没带账号名(/i/status/xxx)→ 用**本 ws** 的登录账号
        if (typeof p.wsId !== 'string' || !p.wsId) {
          return { success: false, error: '链接里没有账号名,且未提供 wsId —— 请贴完整链接' };
        }
        const acc = await getWsAccount(p.wsId);
        if (!acc) {
          return { success: false, error:
            `链接里没有账号名,且 ws=${p.wsId} 尚未识别登录账号 —— `
            + `请在该 ws 里点「识别我的账号」,或贴完整链接` };
        }
        handle = acc.handle;
      }
      const r = await fetchArticleReplies(
        parsed.tweetId, handle,
        typeof p.wcId === 'number' ? p.wcId : undefined,
        { budgetMs: typeof p.budgetMs === 'number' ? p.budgetMs : undefined },
      );
      if ('error' in r) return { success: false, error: r.error };

      // ③ 入库(用户定的流程第三步)。幂等键 (article_id, tweet_id)。
      const saved = await upsertCampaignReplies(parsed.tweetId, r.items);

      // ⚠️ 只有**抓完整**时才判「消失=已删除」—— partial 时没抓完,
      // 没出现不等于被删,那样会误标一片(契约 §2.1 的 deleted 影响签发)。
      let markedDeleted = 0;
      if (!r.partial && r.problems.length === 0) {
        markedDeleted = await markMissingAsDeleted(
          parsed.tweetId, r.items.map((i) => i.tweet_id));
      }

      const stats = await campaignStats(parsed.tweetId);
      return { success: true, result: r, saved, markedDeleted, stats };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // X_HARVEST_NOTIFICATIONS — 抓通知页,解出「谁赞/转/回了我」的具名名单
  ipcMain.handle(IPC_CHANNELS.X_HARVEST_NOTIFICATIONS, async (_e, payload: unknown) => {
    // 手动操作要占用 webview —— 先让自动循环让路(否则两边抢,页面一直转圈)
    pauseCampaignLoop();
    const p = payload as { wsId?: unknown; wcId?: unknown } | null;
    if (typeof p?.wsId !== 'string' || !p.wsId) {
      return { success: false, error: 'wsId required' };
    }
    try {
      // 通知属于**该 ws 登录的账号** —— 跑到别的 ws 上抓会拿到别人的通知
      const acc = await getWsAccount(p.wsId);
      const r = await harvestNotifications(
        typeof p.wcId === 'number' ? p.wcId : undefined);
      if ('error' in r) return { success: false, error: r.error };

      const saved = await upsertInteractions(p.wsId, acc?.handle, r.interactions);
      const stats = await interactionStats();

      // ⭐ 按**配置的那篇文章**给核验名单 —— 全局汇总没有主语,
      // 「点赞 5 条」可能散在 4 条不同的推上,与页面数字对不上。
      // 默认排除本 ws 自己的账号(自己给自己点赞不算参与)。
      let verify: Awaited<ReturnType<typeof verifyListForArticle>> | undefined;
      const roleCfg = await getWsRole(p.wsId).catch(() => null);
      if (roleCfg?.articleId) {
        const parsed = parseTweetUrl(roleCfg.articleId);
        if (!('error' in parsed)) {
          verify = await verifyListForArticle(parsed.tweetId,
            { excludeHandles: acc?.handle ? [acc.handle] : [] });
        }
      }
      return { success: true, result: r, saved, stats, owner: acc?.handle, verify };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // X_CAMPAIGN_STATUS — 契约配置与服务状态(密钥只报有没有,绝不回传值)
  ipcMain.handle(IPC_CHANNELS.X_CAMPAIGN_STATUS, async () => {
    try {
      return { success: true, config: campaignConfigStatus(),
        serverRunning: campaignServerRunning() };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  // 通知实时监听 —— 给人核对「来了什么 / 解成了什么 / 算不算这篇的」
  ipcMain.handle(IPC_CHANNELS.X_NOTIF_WATCH_START, async (_e, payload: unknown) => {
    const p = payload as { wsId?: unknown; wcId?: unknown } | null;
    try {
      let articleId: string | undefined;
      if (typeof p?.wsId === 'string' && p.wsId) {
        const cfg = await getWsRole(p.wsId).catch(() => null);
        if (cfg?.articleId) {
          const parsed = parseTweetUrl(cfg.articleId);
          if (!('error' in parsed)) articleId = parsed.tweetId;
        }
      }
      const r = await startNotifWatch(articleId,
        typeof p?.wcId === 'number' ? p.wcId : undefined,
        // ⭐ wsId 透传:监听现在要入库,而通知是「别人对**该 ws 登录的账号**」——
        //   没有 ws 归属就写不了(也不该写),见 x-notification-watch 的 persistWatched
        typeof p?.wsId === 'string' ? p.wsId : undefined);
      if ('error' in r) return { success: false, error: r.error };
      return { success: true, snapshot: notifWatchSnapshot() };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.X_NOTIF_WATCH_STOP, () => {
    try { return { success: true, snapshot: stopNotifWatch() }; }
    catch (err) { return { success: false, error: String(err) }; }
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

  // X_REPLAY_REPLIES — 拿历史人工标注样本回放规划器。
  // 用途:活动专题还没抓到数据时(x_campaign_reply 为 0、worth 只剩个位数),
  // 先用不可再生的 7000+ 条人工标注看整套流程的实际效果。
  // ⚠️ **只算不发、不写库** —— 回放不产生任何副作用,更不碰 X 页面。
  //    因为样本自带人工 verdict,可以直接给出「模型与人工的一致率」。
  ipcMain.handle(IPC_CHANNELS.X_REPLAY_REPLIES, async (_e, payload: unknown) => {
    const p = payload as { accept?: unknown; reject?: unknown; lang?: unknown } | null;
    const nAccept = typeof p?.accept === 'number' ? p.accept : 10;
    const nReject = typeof p?.reject === 'number' ? p.reject : 10;
    const lang = typeof p?.lang === 'string' ? p.lang : undefined;
    try {
      const [acc, rej] = await Promise.all([
        queryFeedbackSamples({ verdict: 'accept', lang, limit: nAccept }),
        queryFeedbackSamples({ verdict: 'reject', lang, limit: nReject }),
      ]);
      const gold = new Map<string, FeedbackVerdict>();
      for (const f of acc) gold.set(f.tweet_id, 'accept');
      for (const f of rej) gold.set(f.tweet_id, 'reject');

      // 拼成 TweetInboxRecord 形态喂给规划器(回放不落库,故字段只填规划器要用的)
      const batch = [...acc, ...rej].map((f) => ({
        tweet_id: f.tweet_id,
        text: f.text,
        author_name: '',
        author_handle: f.author_handle ?? '',
        lang: f.lang,
        metrics: {},
        fetched_at: f.created_at,
        source: 'search' as const,
        filter_score: 1,
        status: 'worth' as const,
      }));
      if (batch.length === 0) {
        return { success: true, drafts: [], skips: [], scored: [], scanned: 0 };
      }

      // ⚠️ 回放刻意**不传** alreadyRepliedTweetIds/recentlyRepliedAuthors ——
      //    这些历史样本大多早就回过了,带上会被冷却规则整批挡掉,看不到模型表现。
      //    但**保留刷屏过滤**:那正是要观察的一层。
      const acct = await getWsAccount(typeof (p as { wsId?: string })?.wsId === 'string'
        ? (p as { wsId: string }).wsId : '').catch(() => null);
      const r = await planReplies(batch, getJudgeConfig(), {
        selfHandle: acct?.handle,
        ref: 'tw_replay',   // 回放用固定 ref,免得污染真实统计
      });

      // 对账:模型说该回的里,人工当时判 accept 的占多少
      const drafted = new Set(r.drafts.map((d) => d.tweetId));
      let tp = 0, fp = 0, tn = 0, fn = 0;
      for (const [tid, g] of gold) {
        const pred = drafted.has(tid);
        if (g === 'accept' && pred) tp += 1;
        else if (g === 'accept') fn += 1;
        else if (pred) fp += 1;
        else tn += 1;
      }
      return {
        success: true,
        drafts: r.drafts, skips: r.skips, scanned: batch.length,
        score: {
          tp, fp, tn, fn,
          precision: tp + fp > 0 ? tp / (tp + fp) : null,
          recall: tp + fn > 0 ? tp / (tp + fn) : null,
        },
      };
    } catch (err) {
      console.error('[x-timeline-handlers] X_REPLAY_REPLIES failed:', (err as Error).message);
      return { success: false, error: String(err) };
    }
  });

  // X_PLAN_ONE_REPLY — 为**单条**推文现写回复(卡片「送入回复」弹窗用)。
  // 与 X_PLAN_REPLIES 的区别:那个是批量预扫,这个是用户点开某条时按需生成。
  // ⚠️ 同样只产草稿,不碰发布。
  ipcMain.handle(IPC_CHANNELS.X_PLAN_ONE_REPLY, async (_e, payload: unknown) => {
    const p = payload as { wsId?: unknown; tweetId?: unknown; wcId?: unknown } | null;
    if (!p || typeof p.wsId !== 'string' || !p.wsId || typeof p.tweetId !== 'string') {
      return { success: false, error: 'wsId 与 tweetId 必填' };
    }
    // ⚠️ 必须由 renderer 显式传 wcId:不传的话 resolveXWebContents 回退到
    //    「登记表」,而登记表只在 X 视图挂载时才有值 —— 用户在收件箱页面时
    //    它是空的,画像采集与父推抓取都会静默失败(2026-09-06 实测:
    //    全库只有 1 个画像,还是走别的路径采的)。与 spike 那次同款的坑。
    const callerWcId = typeof p.wcId === 'number' ? p.wcId : undefined;
    try {
      // ⚠️ 三次 5000 行查询原本是**串行**的,加上模型两趟调用,单条要 ~27s。
      //    这里改并行取数 + 单次模型调用(planOneReply),两处都是用户
      //    2026-09-06 反馈「生成很慢」实测出来的耗时点。
      const [pool, replied, corpus, acct] = await Promise.all([
        queryInbox({ limit: 5000 }),
        queryInbox({ replied: true, limit: 5000 }),
        queryInbox({ wsId: p.wsId, limit: 5000 }),
        getWsAccount(p.wsId).catch(() => null),
      ]);
      const found = pool.find((t) => t.tweet_id === p.tweetId);
      if (!found) return { success: false, error: `库里找不到推文 ${p.tweetId}` };

      // 学习期回流:把用户原样认可过的例子当少样本喂回 prompt。
      // 不训练模型 —— in-context learning,立刻见效、随时可撤。
      const lang = (found.lang ?? '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
      const examples = await getApprovedExamples(lang, 5).catch(() => []);

      const fingerprintCounts = new Map<string, number>();
      for (const t of corpus) {
        const fp = textFingerprint(t.text);
        if (fp) fingerprintCounts.set(fp, (fingerprintCounts.get(fp) ?? 0) + 1);
      }
      const recentlyRepliedAuthors = new Map<string, string>();
      for (const t of replied) {
        const h = normalizeHandle(t.author_handle ?? '');
        if (!h) continue;
        const prev = recentlyRepliedAuthors.get(h);
        if (!prev || (t.fetched_at && t.fetched_at > prev)) recentlyRepliedAuthors.set(h, t.fetched_at);
      }

      // ⚠️ 单条也要走完整前置过滤 —— 用户点开某条不代表这条就该回,
      //    守卫不能因为「是手点的」就放行。planOneReply 内部先跑规则再问模型。
      // ① 的事实来源:先看库里有没有新鲜画像,没有就现去主页采一次。
      // ⚠️ 采集失败**不拦住回复** —— 没资料时模型会倾向 unclear,
      //    那是诚实的降级;但拿不到资料就不给回复,才是因小失大。
      const posterHandle = normalizeHandle(found.author_handle ?? '');
      let posterFacts;
      let profileError: string | undefined;
      if (posterHandle) {
        const cached = await getAuthorCounts(posterHandle).catch(() => null);
        const fresh = cached?.countsAt
          && (Date.now() - new Date(cached.countsAt).getTime()) < PROFILE_STALE_HOURS * 3_600_000;
        let prof = fresh ? cached : null;
        if (!prof) {
          const got = await harvestAuthorProfile(posterHandle, callerWcId, 12_000)
            .catch((e) => ({ error: String(e) }));
          if (!('error' in got)) prof = got;
          else {
            // ⚠️ 不拦住回复,但**把原因带给用户**:私密号/已注销是不可恢复的,
            //    网络慢/页面没加载完则重试就好 —— 让用户自己判断,别替他决定「不许回」
            profileError = got.error;
            console.warn(`[x-timeline-handlers] 画像采集失败(不拦回复):${got.error}`);
          }
        }
        if (prof) {
          const seen = corpus.filter(
            (t) => normalizeHandle(t.author_handle ?? '') === posterHandle).length;
          posterFacts = {
            handle: posterHandle,
            followersCount: prof.followersCount,
            followingCount: prof.followingCount,
            tweetCount: prof.tweetCount,
            accountCreatedAt: prof.accountCreatedAt,
            bio: (prof as { bio?: string }).bio,
            isBlueVerified: (prof as { isBlueVerified?: boolean }).isBlueVerified,
            seenTweets: seen,
            // ② 活跃度/真实性的强信号 —— 载荷自带,零额外请求
            followsMe: (prof as { followsMe?: boolean }).followsMe,
            iFollow: (prof as { iFollow?: boolean }).iFollow,
          };
        }
      }

      // ① 上一层内容 —— 链条第一步,正确性闸门(用户 2026-09-06)。
      // ⚠️ **只对真的是回复的推抓**:独立求助推本来就没有上文,
      //    为它们白跑一次导航是纯浪费(收件箱里绝大多数是独立求助推)。
      // ⚠️ 抓不到就是抓不到 —— 传 undefined 让 prompt 说「没取到」,
      //    模型会因此更保守;绝不编一个空上文冒充「上文是空的」。
      const looksReply = !!(found.in_reply_to_user || /^\s*@\w+/.test(found.text ?? ''));
      let parentTweet;
      // 预抓过就直接用 —— 省掉每条现等 10s 的导航(用户 2026-09-06 的要求就是这个)
      if (found.parent_text) {
        parentTweet = { text: found.parent_text, authorHandle: found.parent_handle };
      } else if (looksReply) {
        const got = await fetchParentTweet(
          found.tweet_url || `https://x.com/i/status/${found.tweet_id}`,
          callerWcId, 10_000,
        ).catch(() => null);
        if (got) parentTweet = { text: got.text, authorHandle: got.authorHandle };
        else console.warn(`[x-timeline-handlers] 上文没取到(${found.tweet_id}),模型会被告知「没看到」`);
      }

      const r = await planOneReply(found, getJudgeConfig(), {
        selfHandle: acct?.handle,
        posterFacts,
        profileError,
        parentTweet,
        approvedExamples: examples,
        fingerprintCounts,
        recentlyRepliedAuthors,
        alreadyRepliedTweetIds: new Set(replied.map((t) => t.tweet_id)),
      });
      return {
        success: true,
        draft: r.draft ?? null,
        skip: r.skip ?? null,
      };
    } catch (err) {
      console.error('[x-timeline-handlers] X_PLAN_ONE_REPLY failed:', (err as Error).message);
      return { success: false, error: String(err) };
    }
  });

  // X_REPLY_FEEDBACK — 记学习期反馈(AI 原文 vs 用户最终发的)
  ipcMain.handle(IPC_CHANNELS.X_REPLY_FEEDBACK, async (_e, payload: unknown) => {
    const p = payload as Record<string, unknown> | null;
    if (!p || typeof p.tweet_id !== 'string' || typeof p.ai_text !== 'string'
        || typeof p.final_text !== 'string') {
      return { success: false, error: 'tweet_id / ai_text / final_text 必填' };
    }
    try {
      // ⑤ n=1 自动入列:回复过的人进追踪名单(设计 §3.4「自动入列 + watch_depth=1」)。
      // ⚠️ 只在 action='filled' 时入列 —— dismissed 表示「不该回」,不该因此追踪他。
      // ⚠️ 失败不拦主流程:反馈记录比入列重要,后者可事后补。
      if (p.action !== 'dismissed' && typeof p.author_handle === 'string' && p.author_handle) {
        await watchAuthor(p.author_handle, { source: 'replied', depth: 1 })
          .catch((e: unknown) => console.warn('[x-timeline-handlers] 自动入列失败:', e));
      }

      await insertReplyFeedback({
        tweet_id:   p.tweet_id,
        tweet_text: typeof p.tweet_text === 'string' ? p.tweet_text : '',
        lang:       p.lang === 'zh' ? 'zh' : 'en',
        ai_text:    p.ai_text,
        source:     p.source === 'template' ? 'template' : 'generated',
        final_text: p.final_text,
        // 由主进程判定,不信 renderer 传的 —— 这是判据的分子,不能被写错
        edited:     p.final_text.trim() !== p.ai_text.trim(),
        action:     p.action === 'dismissed' ? 'dismissed' : 'filled',
        confidence: typeof p.confidence === 'number' ? p.confidence : undefined,
        ref:        typeof p.ref === 'string' ? p.ref : undefined,
        ws_id:      typeof p.wsId === 'string' ? p.wsId : undefined,
        // 推断链:回归分析的依据,缺一步就定位不了是哪一步坏的
        poster_kind: typeof p.poster_kind === 'string'
          ? (p.poster_kind as ReplyFeedback['poster_kind']) : undefined,
        poster_read: typeof p.poster_read === 'string' ? p.poster_read : undefined,
        trigger:     typeof p.trigger === 'string' ? p.trigger : undefined,
        ai_reason:   typeof p.ai_reason === 'string' ? p.ai_reason : undefined,
        in_thread:   p.in_thread === true,
        created_at: new Date().toISOString(),
      });
      return { success: true };
    } catch (err) {
      console.error('[x-timeline-handlers] X_REPLY_FEEDBACK failed:', (err as Error).message);
      return { success: false, error: String(err) };
    }
  });

  // X_REPLY_READINESS — 分语言原样通过率(放手自动的判据)
  ipcMain.handle(IPC_CHANNELS.X_REPLY_READINESS, async () => {
    try {
      return { success: true, readiness: await getReadiness() };
    } catch (err) {
      return { success: false, error: String(err), readiness: [] };
    }
  });

  // X_WATCHLIST — 追踪名单读写(需求 ②⑤)。
  // ⚠️ 措辞:一律「追踪名单」,**不出现「关注」**(设计 §0)——
  //    这是本 app 的采集清单,与 X 的 follow 无关。
  ipcMain.handle(IPC_CHANNELS.X_WATCHLIST, async (_e, payload: unknown) => {
    const p = payload as { op?: unknown; handle?: unknown; note?: unknown } | null;
    try {
      if (p?.op === 'add' && typeof p.handle === 'string') {
        await watchAuthor(p.handle, {
          source: 'manual', depth: 0,
          note: typeof p.note === 'string' ? p.note : undefined,
        });
      } else if (p?.op === 'remove' && typeof p.handle === 'string') {
        await unwatchAuthor(p.handle);
      } else if (p?.op === 'watch-accepted') {
        // 把所有「采纳过的推」的作者一次性建立追踪关系(用户 2026-09-06)
        const r = await watchAllAccepted();
        const watched = await listWatched();
        const withStats = await Promise.all(watched.map(async (w) => ({
          ...w, stats: await getAuthorStats(w.handle).catch(() => null),
        })));
        return { success: true, watched: withStats, bulk: r };
      } else if (p?.op === 'candidates') {
        // 从已有数据里挑候选 —— 免得用户凭记忆一个个手打
        return { success: true, watched: [], candidates: await listWatchCandidates(20) };
      } else if (p?.op !== 'list') {
        return { success: false, error: `未知操作:${String(p?.op)}`, watched: [] };
      }
      // 名单 + 每人的聚合统计(按需算,不存计数字段 —— 设计 §4.1(4))
      const watched = await listWatched();
      const withStats = await Promise.all(watched.map(async (w) => ({
        ...w, stats: await getAuthorStats(w.handle).catch(() => null),
      })));
      return { success: true, watched: withStats };
    } catch (err) {
      return { success: false, error: String(err), watched: [] };
    }
  });

  // X_PREFETCH_CONTEXT — 给「Gemma 建议采纳」的推批量预抓上文。
  //
  // ⭐ 用户 2026-09-06:「从 Gemma4 的建议名单中获取,因为每一个它建议的,
  //   都应该获取上下文。」——对。上文是①闸门的输入,等点开弹窗才抓
  //   意味着每条都要现等 10s;而建议名单是可预知的,可以提前批量抓好。
  //
  // ⚠️ 只抓**真是回复**的:独立求助推没有上文,白跑导航纯浪费。
  // ⚠️ 抓不到不算失败 —— 记下来让调用方知道哪些没拿到,不静默。
  ipcMain.handle(IPC_CHANNELS.X_PREFETCH_CONTEXT, async (_e, payload: unknown) => {
    const p = payload as
      { wsId?: unknown; wcId?: unknown; limit?: unknown; offset?: unknown } | null;
    if (!p || typeof p.wsId !== 'string' || !p.wsId) {
      return { success: false, error: 'wsId required' };
    }
    try {
      // ⚠️ **不加 humanReviewed 过滤**:2026-09-06 实测,ws-1 的 18 条 worth
      //    全都 reason='human:accept'(用户已表态),原本写 humanReviewed:false
      //    → 匹配 0 条 → 预抓静默什么都不做。
      //    而且方向本就反了:用户已确认要回的那些**更需要**上文,不是更不需要。
      // 同画像:**按当前页取**(操作纪律:处理一页时先把这页的资料备齐)。
      // 已抓过的跳过,不重抓。
      const pool = await queryInbox({
        status: 'worth', wsId: p.wsId,
        limit: typeof p.limit === 'number' ? p.limit : 20,
        offset: typeof p.offset === 'number' ? p.offset : 0,
      });
      const targets = pool
        .filter((t) => t.in_reply_to_user || /^\s*@\w+/.test(t.text ?? ''))
        .filter((t) => !t.parent_text);
      const wcId = typeof p.wcId === 'number' ? p.wcId : undefined;

      let ok = 0;
      const missed: string[] = [];
      for (const t of targets) {
        const got = await fetchParentTweet(
          t.tweet_url || `https://x.com/i/status/${t.tweet_id}`, wcId, 10_000,
        ).catch(() => null);
        if (got) {
          await setParentContext(t.tweet_id, got.text, got.authorHandle);
          ok += 1;
        } else {
          missed.push(t.tweet_id);
        }
      }
      const allReplies = pool.filter(
        (t) => t.in_reply_to_user || /^\s*@\w+/.test(t.text ?? ''));
      return {
        success: true,
        scanned: pool.length,
        isReply: allReplies.length,
        attempted: targets.length,
        fetched: ok,
        missed: missed.length,
        // 本页还差多少 —— 「这页备齐了没有」的判据
        remaining: missed.length,
      };
    } catch (err) {
      console.error('[x-timeline-handlers] X_PREFETCH_CONTEXT failed:', (err as Error).message);
      return { success: false, error: String(err) };
    }
  });

  // X_PREFETCH_PROFILES — 给建议名单里的作者批量预采画像。
  //
  // ⭐ 用户 2026-09-06:「如果数据不齐备,应该主动去切换 X 的页面来获取
  //   足够的数据才回复」——方向对。现在是点开某条时**现采**(每条等 12s);
  //   批量预采后点开即有,不用每条现等。
  //
  // ⚠️ 连续失败要告警:采不到单个账号是常事(私密号/已注销),
  //    但**连着一串都采不到**多半是采集机制坏了(如 X 改版让载荷截不到)。
  //    那时继续默默出草稿,用户会在毫不知情下连发一堆「只读正文」的判断。
  ipcMain.handle(IPC_CHANNELS.X_PREFETCH_PROFILES, async (_e, payload: unknown) => {
    const p = payload as
      { wsId?: unknown; wcId?: unknown; limit?: unknown; offset?: unknown } | null;
    if (!p || typeof p.wsId !== 'string' || !p.wsId) {
      return { success: false, error: 'wsId required' };
    }
    const wcId = typeof p.wcId === 'number' ? p.wcId : undefined;
    try {
      // ⭐ **按当前页取**(用户 2026-09-06 定的操作纪律):
      //   「在处理一页时先采集,完毕再回复,这样可靠性更高。」
      //   —— 这不是"少点几次"的问题,是**批次完整性**:
      //   你正在看的这一页,资料要么齐、要么明确知道缺哪几个,
      //   而不是边回边采、每条碰运气。将来交给 AI 自动跑也该守这个纪律。
      //
      //   我曾改成「一次扫全部、不按页」——那是把用户的问题理解成
      //   "怎么少点几次"了,方向反了。
      const offset = typeof p.offset === 'number' ? p.offset : 0;
      const pageSize = typeof p.limit === 'number' ? p.limit : 20;
      const pool = await queryInbox({
        status: 'worth', wsId: p.wsId, limit: pageSize, offset,
      });
      const handles = [...new Set(pool
        .map((t) => normalizeHandle(t.author_handle ?? ''))
        .filter(Boolean))];
      // 本页的人全部采完 —— 不设预算上限,否则「先采完再回复」就不成立
      const budget = handles.length;

      let fetched = 0; let cached = 0; let failed = 0;
      let consecutiveFail = 0; let maxConsecutive = 0;
      const errors: string[] = [];
      for (const h of handles) {
        // 采够本次预算就收工 —— 剩下的下次继续(断点续采)
        if (fetched + failed >= budget) break;
        const have = await getAuthorCounts(h).catch(() => null);
        const fresh = have?.countsAt
          && (Date.now() - new Date(have.countsAt).getTime()) < PROFILE_STALE_HOURS * 3_600_000;
        if (fresh) { cached += 1; consecutiveFail = 0; continue; }

        const got = await harvestAuthorProfile(h, wcId, 12_000)
          .catch((e) => ({ error: String(e) }));
        if ('error' in got) {
          failed += 1;
          consecutiveFail += 1;
          maxConsecutive = Math.max(maxConsecutive, consecutiveFail);
          if (errors.length < 3) errors.push(`@${h}: ${got.error}`);
        } else {
          fetched += 1;
          consecutiveFail = 0;
        }
      }
      // 连续 5 个失败 = 机制层面的怀疑,不是个别账号的问题
      const mechanismSuspect = maxConsecutive >= 5;
      // 还差多少没采 —— 让用户知道要不要再点一次,而不是猜
      const remaining = handles.length - cached - fetched - failed;
      return {
        success: true,
        authors: handles.length, fetched, cached, failed, remaining,
        mechanismSuspect, maxConsecutive, errors,
      };
    } catch (err) {
      console.error('[x-timeline-handlers] X_PREFETCH_PROFILES failed:', (err as Error).message);
      return { success: false, error: String(err) };
    }
  });

  // X_SEARCH_SYNTAX_SPIKE — 实测哪种搜索写法能连回复一起搜到。
  // 设计 §4.4⑤(a) 明令必须先 spike 再实施,不能照文档假设。
  ipcMain.handle(IPC_CHANNELS.X_SEARCH_SYNTAX_SPIKE, async (_e, payload: unknown) => {
    const p = payload as { handle?: unknown; wcId?: unknown } | null;
    if (!p || typeof p.handle !== 'string' || !p.handle) {
      return { success: false, error: '需要 handle(选一个你知道他最近回复过别人的账号)' };
    }
    try {
      const r = await probeSearchSyntax(
        p.handle, typeof p.wcId === 'number' ? p.wcId : undefined);
      if ('error' in r) return { success: false, error: r.error };
      return { success: true, ...r };
    } catch (err) {
      return { success: false, error: String(err) };
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
