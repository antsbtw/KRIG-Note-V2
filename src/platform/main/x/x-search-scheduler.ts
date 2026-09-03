/**
 * X 搜索配方调度器（Phase 1）
 *
 * 职责：
 * 1. 按配方 intervalMinutes 轮询 enabled 配方，触发 scanRecipe
 * 2. 积累 pending >= batchSize 时触发 AI 判断
 * 3. 每 24h 执行一次 TTL 清理
 */

import { listEnabledRecipes, updateLastRunAt } from '../db/search-recipe-repo';
import { scanRecipe } from './x-timeline-scan';
import { runJudgeBatch, startJudgeDrain, getJudgeConfig } from './x-ai-judge';
import { cleanExpired, recoverStuckAiJudging, countPending } from '../db/tweet-inbox-repo';
import { reconcileRepliedFromOwnReplies } from '../db/x-reply-relation-repo';
import { getBlockedHandleSet } from '../db/x-author-repo';
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
  // 没有 ws 上下文时用 undefined 查全局积压(queryPending/countPending 的 wsId 可选)
  const wsIds = activeXWcMap.size > 0 ? [...activeXWcMap.keys()] : [undefined];
  for (const wsId of wsIds) {
    try {
      const backlog = await countPending(wsId);
      if (backlog > 0) {
        console.log(`[x-search-scheduler] 存量积压 ${backlog} 条`
          + `${wsId ? `(ws=${wsId})` : '(全局)'},启动 drain`);
        startJudgeDrain(judgeConfig, wsId ?? '');
      }
    } catch (err) {
      console.error('[x-search-scheduler] 查积压失败:', err);
    }
  }
}

/** 执行一次配方扫描并按需触发 AI 判断 */
async function runEnabledRecipes(): Promise<void> {
  if (activeXWcMap.size === 0) {
    console.log('[x-search-scheduler] no active X webContents, skip');
    return;
  }

  let recipes;
  try {
    recipes = await listEnabledRecipes();
  } catch (err) {
    console.error('[x-search-scheduler] failed to list recipes:', err);
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

  const now = Date.now();
  for (const recipe of recipes) {
    // 检查是否到了执行时间
    if (recipe.lastRunAt) {
      const lastRun = new Date(recipe.lastRunAt).getTime();
      if (now - lastRun < recipe.intervalMinutes * 60_000) continue;
    }

    // 对每个活跃 ws 分别执行同一配方
    for (const [wsId, wcId] of activeXWcMap.entries()) {
      console.log(`[x-search-scheduler] running recipe "${recipe.name}" for ws=${wsId}`);
      try {
        await scanRecipe(
          recipe,
          wsId,
          wcId,
          filterConfig,
          (saved) => {
            // per-ws 累计：只判触发它的那个 ws，绝不跨 ws 混批
            const { fire } = accumulatePending(pendingAccumulated, wsId, saved, judgeConfig.batchSize);
            if (fire) {
              runJudgeBatch(judgeConfig, wsId).catch((err) => {
                console.error(`[x-search-scheduler] judge batch ws=${wsId} failed:`, err);
              });
            }
          },
        );
      } catch (err) {
        console.error(`[x-search-scheduler] recipe "${recipe.name}" ws=${wsId} failed:`, err);
      }
    }
    await updateLastRunAt(recipe.id, new Date().toISOString());
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
 * 启动调度器。在 initStorage + seedRecipes 之后调用。
 * 调度器每分钟检查一次各配方是否到期，到期则执行。
 * TTL 清理每 24h 一次。
 */
export function startScheduler(): void {
  if (schedulerTimer) return; // 防重复启动

  // 每 60s 检查一次（各配方内部按自己的 intervalMinutes 决定是否真正执行）
  schedulerTimer = setInterval(() => {
    runEnabledRecipes().catch((err) => {
      console.error('[x-search-scheduler] runEnabledRecipes error:', err);
    });
  }, 60_000);

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
}
