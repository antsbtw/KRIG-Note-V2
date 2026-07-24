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
import { runJudgeBatch } from './x-ai-judge';
import { cleanExpired } from '../db/tweet-inbox-repo';
import { DEFAULT_FILTER_CONFIG, DEFAULT_JUDGE_CONFIG } from '@shared/types/x-timeline-types';
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

/** 累计待判断 pending 条数 */
let pendingAccumulated = 0;

const filterConfig: TimelineFilterConfig = DEFAULT_FILTER_CONFIG;
const judgeConfig: JudgeConfig = DEFAULT_JUDGE_CONFIG;

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
            pendingAccumulated += saved;
            if (pendingAccumulated >= judgeConfig.batchSize) {
              pendingAccumulated = 0;
              runJudgeBatch(judgeConfig).catch((err) => {
                console.error('[x-search-scheduler] judge batch failed:', err);
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

  // maxWaitMinutes 超时触发：若有积累但未满 batchSize
  if (pendingAccumulated > 0) {
    pendingAccumulated = 0;
    runJudgeBatch(judgeConfig).catch((err) => {
      console.error('[x-search-scheduler] judge batch (timeout trigger) failed:', err);
    });
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

  console.log('[x-search-scheduler] started (poll interval: 60s, TTL cleanup: 24h)');
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
}
