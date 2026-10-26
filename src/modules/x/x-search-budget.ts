/**
 * ⭐⭐ 搜索额度账本 —— 主进程(2026-10-22)
 *
 * 用户 10-22(采互动撞了限流):「要有策略吧,这是一个常规行为,经常要采集自己的每天互动的哦。」
 * X 的搜索接口约 50 页 / 15 分钟(2026-10-22 真机第 50 页撞 429),而且会悄悄限流(只给第一页、不报 429)。
 * 配方搜索(第 1 件)、采互动(第 3 件)、操作台都走 collectSearchByScroll,共用这一个额度 —— 在这里记一本账:
 * 最近 15 分钟用了几页、什么时候撞过限流;采互动按它决定这一段能翻几页、要不要先等。
 * ⚠️ 模块级状态:只在主进程用(记忆 feedback-per-process-module-state)
 */

export const SEARCH_WINDOW_MS = 15 * 60_000;
/** X 的大约上限 */
export const SEARCH_CAP = 50;
/** 给你自己在 X 上搜、配方搜索留的余量 —— 自动采集最多用到 CAP - RESERVE */
export const SEARCH_RESERVE = 15;

const used: Array<{ at: number; pages: number }> = [];
let limitedAt: number | undefined;

/** 记一次搜索用掉的页数;撞了限流(429 或悄悄限流)记下时间 */
export function recordSearch(pages: number, limited: boolean, now = Date.now()): void {
  if (pages > 0) used.push({ at: now, pages });
  if (limited) limitedAt = now;
  while (used.length > 0 && now - used[0].at > SEARCH_WINDOW_MS) used.shift();
}

export type SearchBudget = {
  /** 最近 15 分钟用了几页 */
  readonly usedPages: number;
  /** 自动采集现在还能用几页(0 = 先等) */
  readonly freePages: number;
  /** 撞过限流:到这个时间之前别搜 */
  readonly waitUntil?: number;
};

/** 纯函数(导出给测试):按账本算现在还能用几页 */
export function budgetOf(entries: ReadonlyArray<{ at: number; pages: number }>, limited: number | undefined, now: number): SearchBudget {
  const usedPages = entries.filter((e) => now - e.at <= SEARCH_WINDOW_MS).reduce((n, e) => n + e.pages, 0);
  const waitUntil = limited !== undefined && now - limited < SEARCH_WINDOW_MS ? limited + SEARCH_WINDOW_MS : undefined;
  const freePages = waitUntil !== undefined ? 0 : Math.max(0, SEARCH_CAP - SEARCH_RESERVE - usedPages);
  return { usedPages, freePages, waitUntil };
}

export function searchBudget(now = Date.now()): SearchBudget {
  return budgetOf(used, limitedAt, now);
}

/** 测试用 */
export function resetSearchBudget(): void {
  used.length = 0;
  limitedAt = undefined;
}
