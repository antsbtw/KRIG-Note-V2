/**
 * X 任务调度器
 *
 * 职责：
 * 1. 按任务 intervalMinutes 轮询 enabled 任务，取 webview 租约后执行采集
 * 2. 积累 pending >= batchSize 时触发 AI 判断
 * 3. 每 24h 执行一次 TTL 清理
 *
 * ⚠️⚠️ **重构期间自动采集一律关闭** —— 见下方 `AUTO_COLLECT_ENABLED`。
 */

/**
 * ⭐⭐ 自动采集总开关(2026-09-15,用户拍板「甲+丙一起做」)。
 *
 * ── 为什么要这道代码层的保险 ──
 *
 * 光把库里的 `x_task.enabled` 置 false 不够(那是甲):它是**运行期状态**,
 * 谁在界面上一改配置、或哪次 migration 顺手改回来,采集就又跑起来了。
 * 用户 2026-09-15 撞到过一次:四条任务在重构期间一直 30 分钟一轮地跑,
 * 一晚自动采了 204 条 —— 而那时我们正在换任务模型、换面板。
 *
 * ⚠️ **恢复条件**(三条都满足才改回 true):
 *  1. 任务面板接上 `X_LIST_TASKS` / `X_UPSERT_TASK`,能在界面上开关任务
 *  2. 盯人采集真机验过一轮(至今**一次都没跑过**)
 *  3. 用户明确说「可以自动跑了」
 *
 * ⚠️ 关掉的只是**定时轮询**。手动触发(界面点执行)不受影响 ——
 * 重构期间正需要「想跑就跑一次」来验证。
 */
const AUTO_COLLECT_ENABLED = false;

import {
  listEnabledTasks, updateTaskLastRunAt, setTaskRunState, recoverStuckTasks,
} from '../db/x-task-repo';
import { collectStrategies, registerInitialStrategies } from '@capabilities/x-collect';
import { pageRegistry } from '../web-capability/wiring/runtime';
import { xPageId, wsIdOf } from './x-net-capture';
import { resolveAnyXWebContents } from './x-webcontents';
import { scanRecipe } from './x-timeline-scan';
import { collectWatchlist } from './x-watchlist-collect';
import { webContents } from 'electron';
import type { XTask } from '@shared/types/x-task';
import type { SearchRecipe } from '@shared/types/x-timeline-types';
import { runJudgeBatch, startJudgeDrain, getJudgeConfig } from './x-ai-judge';
import { cleanExpired, recoverStuckAiJudging, countPending } from '../db/tweet-inbox-repo';
import { reconcileRepliedFromOwnReplies } from '../db/x-reply-relation-repo';
import { getBlockedHandleSet } from '../db/x-author-repo';
import { getWsRole } from '../db/x-ws-role-repo';
import { DEFAULT_FILTER_CONFIG } from '@shared/types/x-timeline-types';
import type { JudgeConfig, TimelineFilterConfig } from '@shared/types/x-timeline-types';

/** 当前活跃的 X webContents id（per-ws Map，由 registerXTimelineHandlers 更新） */
const activeXWcMap = new Map<string, number>();

export function setActiveXWcId(wsId: string, wcId: number | null): void {
  if (wcId === null) activeXWcMap.delete(wsId);
  else activeXWcMap.set(wsId, wcId);
}

export function getActiveWcId(wsId: string): number | null {
  return activeXWcMap.get(wsId) ?? null;
}

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let ttlTimer: ReturnType<typeof setInterval> | null = null;
let judgeRecoverTimer: ReturnType<typeof setInterval> | null = null;
let backlogTimer: ReturnType<typeof setInterval> | null = null;
/**
 * ⭐ 盯人采集轮询(2026-09-14 新增)。
 *
 * ⚠️ 此前追踪名单「四层齐了,唯独采集循环不存在」—— 加得进名单、看得到统计,
 * 但**没有任何东西会因为『他在名单里』而去抓他的新推**。这个 timer 就是那一层。
 *
 * ⚠️ 铁律:常驻 timer **必须在 `stopScheduler` 里有停止调用**
 * (记忆 `project-graceful-shutdown`:否则 before-quit 走不完,Ctrl+C 不退)。
 */
let watchlistTimer: ReturnType<typeof setInterval> | null = null;

/** 累计待判断 pending 条数（per-ws：各 ws 各自累计、各自达阈值、各自清零，防跨 ws 混批） */
const pendingAccumulated = new Map<string, number>();

/**
 * 纯函数：给某 ws 累加 saved 条数，判断是否达到 batchSize。
 * 达到 → 返回 { fire:true }，并把该 ws 计数清零（调用方负责真正触发判断）。
 * 抽成纯函数便于离线单测计数器隔离逻辑（不依赖 Electron 主进程）。
 */
export function accumulatePending(
  counters: Map<string, number>,
  wsId: string,
  saved: number,
  batchSize: number,
): { fire: boolean; accumulated: number } {
  const next = (counters.get(wsId) ?? 0) + saved;
  if (next >= batchSize) {
    counters.set(wsId, 0);
    return { fire: true, accumulated: next };
  }
  counters.set(wsId, next);
  return { fire: false, accumulated: next };
}

const judgeConfig: JudgeConfig = getJudgeConfig();  // 模型可被 KRIG_JUDGE_MODEL 环境变量覆盖

/**
 * 组装本轮采集的漏斗配置 —— 屏蔽名单**每轮现取,不缓存**。
 *
 * 为什么不缓存:缓存会让「刚屏蔽的人还在被爬」持续一整个缓存周期,
 * 且这个现象与「过滤逻辑压根没生效」在表现上无法区分,极难排查。
 *
 * ⚠️ 查库失败直接**抛**(不 catch 成空数组):空黑名单与「查不到」是两件事,
 * 后者兜底 = 屏蔽悄悄失效。调用方负责跳过本轮并留痕。
 */
async function buildFilterConfig(): Promise<TimelineFilterConfig> {
  const accountBlacklist = await getBlockedHandleSet();
  return { ...DEFAULT_FILTER_CONFIG, accountBlacklist };
}

/**
 * ⚠️ **空转刹车**(2026-09-21):drain 连续「跑了却一条没判成」时逐步退避。
 *
 * 原先的形态:本 timer 每 2 分钟无条件重启 drain,而 drain 自己连续失败 3 次
 * 就停 —— 于是「停 → 2 分钟后原样再来 → 再停」**永远循环**,日志被刷屏,
 * 积压一条不动。刹车在 drain 里,油门在这儿,两边互不知道。
 *
 * 现在:drain 判成了 → 清零;一条没判成 → 退避翻倍(2→4→8…最多 30 分钟)。
 * ⚠️ 退避只压**重试频率**,不压错误本身 —— 失败照常 console.error 留痕
 * (「不刷屏」不等于「不报错」,后者是把故障藏起来)。
 */
const MAX_BACKOFF_MS = 30 * 60_000;
let drainBackoffMs = 0;
let drainNextAllowedAt = 0;

/** drain 结束时回调:判成了就解除退避,零产出就翻倍。 */
function noteDrainOutcome(judged: number): void {
  if (judged > 0) {
    if (drainBackoffMs > 0) {
      console.log('[x-search-scheduler] drain 恢复正常,解除退避');
    }
    drainBackoffMs = 0;
    drainNextAllowedAt = 0;
    return;
  }
  drainBackoffMs = drainBackoffMs === 0 ? 2 * 60_000 : Math.min(drainBackoffMs * 2, MAX_BACKOFF_MS);
  drainNextAllowedAt = Date.now() + drainBackoffMs;
  console.warn(
    `[x-search-scheduler] drain 零产出,退避 ${Math.round(drainBackoffMs / 60_000)} 分钟后再试`,
  );
}

/**
 * 清理**存量积压** —— 与采集完全解耦。
 *
 * ⚠️ 2026-09-03 两次实机观察踩到的坑,记下来别再犯:
 *  第一次:判断触发点只挂在「本轮新采到多少条」上,存量没人管 → 945 条静躺。
 *  第二次:我把清理塞进 runEnabledRecipes 末尾,但那个函数**开头就有**
 *          `if (activeXWcMap.size === 0) return` —— 没有活跃 X webview 时
 *          直接返回,**根本走不到**清理那行。重启后依旧纹丝不动。
 *
 * 关键认知:**判断积压不需要 webContents** —— 它只跟 Ollama 和数据库打交道。
 * 采集才需要浏览器。把两者绑在一起是我的错误,现已拆开独立调度。
 */
async function drainBacklog(): Promise<void> {
  if (drainNextAllowedAt > 0 && Date.now() < drainNextAllowedAt) return;  // 退避中,安静跳过
  // 没有 ws 上下文时用 undefined 查全局积压(queryPending/countPending 的 wsId 可选)
  const wsIds = activeXWcMap.size > 0 ? [...activeXWcMap.keys()] : [undefined];
  for (const wsId of wsIds) {
    try {
      const backlog = await countPending(wsId);
      if (backlog > 0) {
        console.log(`[x-search-scheduler] 存量积压 ${backlog} 条`
          + `${wsId ? `(ws=${wsId})` : '(全局)'},启动 drain`);
        startJudgeDrain(judgeConfig, wsId ?? '', noteDrainOutcome);
      }
    } catch (err) {
      console.error('[x-search-scheduler] 查积压失败:', err);
    }
  }
}

/**
 * ⭐⭐ 任务 → 配方的**反向组装**(1b 过渡期)。
 *
 * ⚠️ 为什么还要组装成 `SearchRecipe`:`scanRecipe` 内部同时做了「跑策略」和
 * 「过滤 + 翻译 + 入库」两件事。1b 只该换**驱动方式**(配方表 → 任务表),
 * 把入库那半也一起重写会让这一步的风险面从 1 个文件涨到 4 个。
 *
 * ⏳ `scanRecipe` 与本函数一起删在 **1c**,那时入库逻辑迁进任务执行链。
 *
 * ⚠️ `params` 的 key 必须与 `keywordStrategy.paramsSchema` 逐字对应 ——
 * 拼错不报错,只会让那个参数**静默失效**(如 keywords 丢了就搜空串)。
 */
function taskToRecipe(task: XTask): SearchRecipe {
  const p = task.params ?? {};
  const arr = (v: unknown): string[] | undefined =>
    Array.isArray(v) && v.length ? v.filter((x): x is string => typeof x === 'string') : undefined;
  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

  return {
    id: task.id,
    name: task.name,
    enabled: task.enabled,
    // help_signals 只在 help-wanted 下生效,故有信号词就按 help-wanted 走
    template: arr(p.helpSignals) ? 'help-wanted' : 'custom',
    keywords: arr(p.keywords),
    fromAccounts: arr(p.fromAccounts),
    helpSignals: arr(p.helpSignals),
    minLikes: num(p.minLikes),
    minRetweets: num(p.minRetweets),
    lang: typeof p.lang === 'string' ? p.lang : undefined,
    sinceHours: num(p.sinceHours),
    resultType: p.resultType === 'top' ? 'top' : 'latest',
    includeReplies: p.includeReplies === true,
    intervalMinutes: task.intervalMinutes,
    lastRunAt: task.lastRunAt,
  };
}

/**
 * ⭐⭐ 执行到期的任务(1b:调度器从**任务表**驱动,不再读配方表)。
 *
 * ── 与配方时代的三处关键差别 ──
 *
 * ① 读 `x_task` 而非 `search_recipes`
 * ② ⭐ **执行前取 webview 租约** —— 「两个任务撞车不能同时执行」的落地点。
 *    此前只靠「周期错开」碰运气(配方 60s / 盯人 30min),真撞上只能指望
 *    落地校验兜底。现在是显式互斥:占着就跳过,并留痕说明被谁占着。
 * ③ 运行态入库(`run_state`/`last_error`)——「跑了没成功」与「没跑」
 *    在界面上长得一样,不记原因就等于静默。
 */
/**
 * ⭐⭐ 找出本轮可用的 (wsId, wcId) —— **不依赖手动登记**。
 *
 * ⚠️⚠️ 2026-09-14 实测的既有缺陷:`activeXWcMap` 的**唯一**填充点是
 * `X_RUN_RECIPE` handler(`x-timeline-handlers.ts:74`),也就是**人点「开始扫描」**。
 * 于是 app 重启后没点过扫描,定时采集每轮都在 `size === 0` 处静默早退 ——
 * **配方时代就是这样**,只是手点扫描顺带登记了 wc,看起来才像在自动跑。
 *
 * ⚠️ 且 `x-webcontents.ts` 有段注释说「wcId 由 SocialView 挂载时登记」——
 * **那是错的**,SocialView 零调用(2026-09-14 grep 证实),它描述了一个不存在的机制。
 *
 * ⭐ 解法用仓库里现成的 `resolveAnyXWebContents()`,它的注释正是为这个场景写的:
 * 「绕过登记表,直接在所有存活的 webContents 里找 x.com 的那个……
 *   仅供**后台/无人值守**路径使用」——定时采集正是无人值守路径。
 *
 * ⚠️ 登记表**优先**:它是显式定向的,多 ws 时比扫描准。回落只在表为空时用。
 */
function resolveSchedulerTargets(): Array<[string, number]> {
  if (activeXWcMap.size > 0) return [...activeXWcMap.entries()];

  const found = resolveAnyXWebContents();
  if ('error' in found) return [];

  const wsId = wsIdOf(found.wc);
  if (!wsId) {
    // ⚠️ 反推不出 ws 就不猜 —— 猜错会把任务跑到别的 ws 上,而且不报错
    console.warn('[x-search-scheduler] 找到 X webview 但反推不出 wsId(partition 形状变了?),跳过');
    return [];
  }
  console.log(`[x-search-scheduler] 登记表为空,回落到无人值守扫描:ws=${wsId} wc#${found.wc.id}`);
  return [[wsId, found.wc.id]];
}

/**
 * ⭐⭐ 跑某个 ws 自己的任务。
 *
 * ⚠️⚠️ **不再「对每个活跃 ws 跑一遍同一个任务」**(用户 2026-09-14 拍板):
 *
 * > 「在哪个窗口配置,就是打开哪个窗口才执行……任何的配置只是对自己的窗口负责。」
 *
 * 旧模型(`wsId` 留空 = 所有 ws 都跑)实测有三个洞:同一批推抓两遍、
 * 翻译调两次(刚被 429 限流过)、`lastResult` 被后完成的那个 ws 覆盖。
 * ⚠️ 而 webview 租约**挡不住** —— 两个 ws 是两个 pageId,各拿各的。
 *
 * ⭐ 归属模型下这些**结构上不可能发生**:任务只属于一个 ws,
 * 本函数只查那个 ws 的任务,循环那层整个消失。
 */
async function runTasksForWs(
  wsId: string,
  wcId: number,
  filterConfig: TimelineFilterConfig,
): Promise<void> {
  let tasks: XTask[];
  try {
    tasks = await listEnabledTasks(wsId);
  } catch (err) {
    console.error(`[x-search-scheduler] ws=${wsId} 取任务列表失败:`, err);
    return;
  }
  if (tasks.length === 0) return;

  // ⭐ 角色守卫(用户 2026-09-03「一个 ws 只干一件事」):
  // 只在 role='search' 的 ws 上跑定时采集。campaign ws 专供活动核验 ——
  // 在它上面导航到搜索页,正在抓的 conversation 就断了。
  const roleCfg = await getWsRole(wsId).catch(() => null);
  if (!roleCfg || roleCfg.role !== 'search') {
    console.log(`[x-search-scheduler] 跳过 ws=${wsId}(role=${roleCfg?.role ?? '?'},非 search)`);
    return;
  }

  const wc = webContents.fromId(wcId);
  if (!wc || wc.isDestroyed()) return;

  const now = Date.now();
  for (const task of tasks) {
    // 到期判定
    if (task.lastRunAt) {
      const lastRun = new Date(task.lastRunAt).getTime();
      if (Number.isFinite(lastRun) && now - lastRun < task.intervalMinutes * 60_000) continue;
    }

    // ⚠️ 策略取不到直接跳过并记错 —— fail loud。
    //    `registry.get` 自己会抛(列出已注册的 id),错误信息比这里能写的更有用。
    try {
      collectStrategies.get(task.strategyId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[x-search-scheduler] 任务「${task.name}」策略不可用:`, msg);
      await setTaskRunState(task.id, 'failed', { error: msg }).catch(() => {});
      continue;
    }

    /**
     * ⭐⭐ 取 webview 租约 —— 「同一 webview 上两个任务撞车」的防线。
     *
     * ⚠️ 它防不了「同一任务跨 ws 并行」(两个 ws 两个 pageId,各拿各的)——
     * 那个由**归属模型**防:任务只属于一个 ws,根本不会在别处跑。
     * 两道防线管两件事,别指望其中一道兼管另一件。
     */
    const pageId = xPageId(wc);
    const leased = pageRegistry.lease(pageId, `task:${task.name}`, 20 * 60_000);
    if (leased.status !== 'ok') {
      console.log(
        `[x-search-scheduler] 任务「${task.name}」跳过:webview 被占用`
        + `(${leased.status === 'failed' ? leased.reason : ''})`,
      );
      continue;
    }

    console.log(`[x-search-scheduler] 执行任务「${task.name}」 ws=${wsId}`);
    await setTaskRunState(task.id, 'running').catch(() => {});
    try {
      const recipe = taskToRecipe(task);
      const r = await scanRecipe(
        recipe,
        wsId,
        wcId,
        // ⚠️ 关键词兜底必须**按任务**给 —— filterConfig 是全局共用的,
        //    把 requireKeywords 塞进去会让所有任务共用同一批词。
        { ...filterConfig, requireKeywords: recipe.keywords ?? [] },
        (saved) => {
          // per-ws 累计:只判触发它的那个 ws,绝不跨 ws 混批
          const { fire } = accumulatePending(pendingAccumulated, wsId, saved, judgeConfig.batchSize);
          if (fire) {
            runJudgeBatch(judgeConfig, wsId).catch((err) => {
              console.error(`[x-search-scheduler] judge batch ws=${wsId} failed:`, err);
            });
          }
        },
      );
      await setTaskRunState(task.id, 'idle', {
        result: {
          fetched: r.fetched, saved: r.saved,
          duplicates: r.duplicates, elapsedMs: r.elapsedMs,
        },
      }).catch(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[x-search-scheduler] 任务「${task.name}」ws=${wsId} 失败:`, msg);
      // ⚠️ 失败要留痕:「跑了没成功」与「没跑」在界面上长得一样
      await setTaskRunState(task.id, 'failed', { error: msg }).catch(() => {});
    } finally {
      // ⚠️ 租约**必须**在 finally 释放 —— 一次异常就永久占着,
      //    之后所有任务都会「被占用」而永远跑不了(同 timer 那条铁律)。
      const released = pageRegistry.release(leased.value);
      if (released.status !== 'ok') {
        console.warn(`[x-search-scheduler] 释放租约失败(page=${pageId}):`,
          released.status === 'failed' ? released.reason : '');
      }
    }
    await updateTaskLastRunAt(task.id, new Date().toISOString());
  }
}

/**
 * ⭐ 一轮调度:找到可用的 ws,各跑各自的任务。
 *
 * ⚠️⚠️ **这里没有「对每个 ws 跑一遍同一个任务」那层循环了** ——
 * 任务归属于 ws(用户 2026-09-14),所以是「每个 ws 问自己有哪些任务」,
 * 而不是「每个任务问自己该在哪些 ws 跑」。方向反过来,洞就没了。
 */
async function runEnabledTasks(): Promise<void> {
  const targets = resolveSchedulerTargets();
  if (targets.length === 0) {
    console.log('[x-search-scheduler] 找不到可用的 X webview,skip');
    return;
  }

  // 屏蔽名单现取:失败则整轮跳过并大声留痕 —— 绝不以空黑名单继续采集,
  // 否则被屏蔽的人会照爬不误,而日志上什么都看不出来。
  let filterConfig: TimelineFilterConfig;
  try {
    filterConfig = await buildFilterConfig();
  } catch (err) {
    console.error('[x-search-scheduler] failed to load blocked authors, SKIPPING this round '
      + '(refusing to scan with an empty blacklist):', err);
    return;
  }

  for (const [wsId, wcId] of targets) {
    await runTasksForWs(wsId, wcId, filterConfig);
  }

  // maxWaitMinutes 超时触发：逐 ws 处理未满 batchSize 的残留积累，各判各的
  for (const [wsId, count] of pendingAccumulated.entries()) {
    if (count > 0) {
      pendingAccumulated.set(wsId, 0);
      runJudgeBatch(judgeConfig, wsId).catch((err) => {
        console.error(`[x-search-scheduler] judge batch (timeout trigger) ws=${wsId} failed:`, err);
      });
    }
  }


}

/**
 * ⭐ 跑一遍追踪名单(盯人采集)。
 *
 * ⚠️ 与配方采集**共用同一个 X webview**,所以必须串行让路 ——
 * 两者同时导航会互相把对方正在滚的页面顶掉,现象是「采集时断时续」。
 * 这里靠**错开周期**(配方 60s / 盯人 30min)+ 同一个角色守卫实现,
 * 真撞上了由 `runCollectStrategy` 的落地校验挡住(不会把别人的页面当结果)。
 */
async function runWatchlist(): Promise<void> {
  // ⚠️ 同 runEnabledTasks:**不依赖手动登记** —— 登记表只在人点过
  //    「开始扫描」后才有值,盯人采集本就是无人值守路径(见 resolveSchedulerTargets)
  const targets = resolveSchedulerTargets();
  if (targets.length === 0) return;

  let filterConfig: TimelineFilterConfig;
  try {
    filterConfig = await buildFilterConfig();
  } catch (err) {
    // 同配方采集:绝不以空黑名单继续 —— 被屏蔽的人会照爬不误而日志上看不出来
    console.error('[x-search-scheduler] 盯人采集:屏蔽名单取不到,本轮跳过:', err);
    return;
  }

  for (const [wsId, wcId] of targets) {
    // ⭐ 同一条角色守卫(用户 2026-09-03「一个 ws 只干一件事」):
    // 只在 role='search' 的 ws 上跑,不去打扰 campaign ws 正在抓的会话
    const roleCfg = await getWsRole(wsId).catch(() => null);
    if (!roleCfg || roleCfg.role !== 'search') continue;

    try {
      const r = await collectWatchlist(wsId, wcId, filterConfig);
      // ⚠️ 单人失败已在内部记进 failures,这里把「有人失败」报出来 ——
      // 静默会让「名单里的人悄悄不采了」无从发现
      if (r.failures.length > 0) {
        console.warn(
          `[x-search-scheduler] 盯人采集 ws=${wsId}:${r.failures.length} 人失败,`
          + `首个 @${r.failures[0].handle}: ${r.failures[0].error}`,
        );
      }
    } catch (err) {
      console.error(`[x-search-scheduler] 盯人采集 ws=${wsId} 整批失败:`, err);
    }
  }
}

/**
 * 启动调度器。在 initStorage + seedRecipes 之后调用。
 * 调度器每分钟检查一次各配方是否到期，到期则执行。
 * TTL 清理每 24h 一次。
 */
export function startScheduler(): void {
  if (schedulerTimer) return; // 防重复启动

  /**
   * ⭐⭐ 注册采集策略 —— **必须在任何任务执行之前**。
   *
   * ⚠️ 2026-09-14 实测:`registerInitialStrategies` 此前**全仓零调用** ——
   * 注册表建好了但是空的,于是 `collectStrategies.get('keyword')` 会直接抛,
   * 所有任务都跑不起来。这是「建好了没人用」的又一例(与追踪名单同款)。
   *
   * ⚠️ 包 try:重复注册会撞 id 重复检查并抛(那是 register 有意的 fail loud),
   * 而 `startScheduler` 本身有防重入,正常只会走一次。
   */
  try {
    registerInitialStrategies();
    console.log(`[x-search-scheduler] 已注册采集策略:${collectStrategies.list().map((s) => s.id).join(', ')}`);
  } catch (err) {
    console.warn('[x-search-scheduler] 策略注册跳过(多半已注册过):', err);
  }

  /**
   * ⭐ 任务轮询(1b:从**任务表**驱动,不再读配方表)。
   *
   * 每 60s 检查一次;各任务按自己的 `intervalMinutes` 决定是否真正执行。
   * ⚠️ 执行前取 webview 租约 —— 撞车时跳过本轮而不是硬上(见 runEnabledTasks)。
   */
  if (AUTO_COLLECT_ENABLED) {
    schedulerTimer = setInterval(() => {
      runEnabledTasks().catch((err) => {
        console.error('[x-search-scheduler] runEnabledTasks error:', err);
      });
    }, 60_000);
  } else {
    // ⚠️ **必须说出来** —— 静默不启动会变成「以为在采、其实没采」,
    //    那和当初「以为没采、其实在采」是同一种病的两面。
    console.warn(
      '[x-search-scheduler] ⏸ 自动采集已关闭(重构期间)—— 定时轮询不启动。'
      + ' 手动执行不受影响;恢复条件见 AUTO_COLLECT_ENABLED 注释。',
    );
  }

  /**
   * ⚠️ 启动时复位卡住的任务:执行**不跨进程存活**,上次退出时正在跑的
   * 任务重启后 `run_state` 还是 'running',调度器会以为「还在跑」而永远跳过它。
   * 同 `recoverStuckAiJudging` 的理由。
   */
  recoverStuckTasks()
    .then((n) => { if (n > 0) console.warn(`[x-search-scheduler] 复位 ${n} 个卡在 running 的任务`); })
    .catch((err) => console.error('[x-search-scheduler] recoverStuckTasks error:', err));

  // ⚠️ **卡住自愈:每 10 分钟一次**(2026-09-02 实测踩到)
  // recoverStuckAiJudging 此前**只在启动时跑一次**(index.ts)。
  // 后果:app 长时间运行时,判断中断的行永久停在 ai_judging ——
  // 实测 460 条卡了十几个小时(最早一条 01:42),它们既不在「待判」
  // (那查的是 status='pending')也不在其他视图,**从收件箱里彻底消失**,
  // 而界面上毫无异常:用户只看到「采集 303 条」但待判是 0,以为全是重复。
  // 判断任务不跨进程存活,所以退回 pending 不会误伤正在处理的行。
  judgeRecoverTimer = setInterval(() => {
    recoverStuckAiJudging()
      .then((n) => { if (n > 0) console.warn(`[x-search-scheduler] 自愈:${n} 条卡在 ai_judging 已退回 pending`); })
      .catch((err) => console.error('[x-search-scheduler] recoverStuckAiJudging error:', err));
  }, 10 * 60_000);

  // 启动时先对一次账:上次运行期间采到的线索,可能有我早就回过的
  reconcileRepliedFromOwnReplies().catch((err) => {
    console.error('[x-search-scheduler] initial reconcile error:', err);
  });

  // 积压清理:**独立于采集调度** —— 判断只需要 Ollama + 数据库,不需要 X webview。
  // 绑在 runEnabledRecipes 里会被它开头的 `activeXWcMap.size === 0` 挡掉(踩过)。
  backlogTimer = setInterval(() => {
    drainBacklog().catch((err) => {
      console.error('[x-search-scheduler] drainBacklog error:', err);
    });
  }, 2 * 60_000);

  // 启动后延迟 10s 先跑一次:给 storage/Ollama 留出就绪时间
  setTimeout(() => {
    drainBacklog().catch((err) => {
      console.error('[x-search-scheduler] initial drainBacklog error:', err);
    });
  }, 10_000);

  /**
   * ⭐ 盯人采集:每 30 分钟一轮。
   *
   * ⚠️ 与配方采集(60s 轮询)**错开**:两者共用同一个 X webview,
   * 频率相近会频繁互相顶掉正在滚的页面。
   * 30 分钟对「追踪某人的新推」足够 —— 他不会每分钟发一条。
   *
   * ⚠️ 停止调用在 `stopScheduler`(常驻 timer 铁律)。
   */
  // ⚠️ 盯人轮询受同一个开关控制 —— 只关一个等于没关(它照样占 webview、照样采)
  if (AUTO_COLLECT_ENABLED) {
    watchlistTimer = setInterval(() => {
      runWatchlist().catch((err) => {
        console.error('[x-search-scheduler] runWatchlist error:', err);
      });
    }, 30 * 60_000);
  }

  // TTL 清理：每 24h 一次
  ttlTimer = setInterval(() => {
    cleanExpired().catch((err) => {
      console.error('[x-search-scheduler] cleanExpired error:', err);
    });
  }, 24 * 3_600_000);

  // 启动时先跑一次 TTL 清理
  cleanExpired().catch((err) => {
    console.error('[x-search-scheduler] initial cleanExpired error:', err);
  });

  console.log('[x-search-scheduler] started (poll: 60s, stuck-judge recovery: 10min, TTL: 24h)');
}

export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  if (ttlTimer) {
    clearInterval(ttlTimer);
    ttlTimer = null;
  }
  // 铁律:常驻 timer 必须在这里有停止调用,否则 before-quit 走不完(Ctrl+C 不退)
  if (judgeRecoverTimer) {
    clearInterval(judgeRecoverTimer);
    judgeRecoverTimer = null;
  }
  if (backlogTimer) {
    clearInterval(backlogTimer);
    backlogTimer = null;
  }
  // 同上铁律:新增的常驻 timer 必须在这里停
  if (watchlistTimer) {
    clearInterval(watchlistTimer);
    watchlistTimer = null;
  }
}
