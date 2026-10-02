/**
 * 采集会话 —— ⭐⭐ **只管「收到了什么、够不够」**,不碰页面
 *
 * ── 用户 2026-10-02 ──
 * 「我觉得不要改变前面的逻辑,**控制是控制,采集是采集**。
 * 　你现在是简化了,但是**违背了逻辑**。控制/输出是分开的。」
 *
 * ⭐ 对的。我上一版把 `reload` / `scrollOnce` / 轮次循环揉了进来,
 * 于是采集替控制做了「要不要翻页」的决定。
 * ⚠️ 实测当场看见后果:`rounds=0 scrolledPx=0` ——
 * 重载后首屏就够数,**一轮都没滚**,而人从输出那栏看不出来页面没动过。
 *
 * ── ⭐ 现在的分工 ──
 *
 * | 栏 | 管什么 |
 * |---|---|
 * | **控制**(web.page) | goto / 重载 / 滚动 —— **人决定页面怎么动** |
 * | **输出**(本层)     | 开始收 / 停止收 / 收到了什么 + 完整性 |
 *
 * ⚠️ 本层**零 Electron、零站点知识** —— 外部动作走 `AcquireDeps`。
 */

import type { PageId } from '../page/types';
import type { AcquireDeps, AcquireGoal, AcquiredItem, AcquireReport } from './types';

/** 等待的安全网。⚠️ 防「等一个永远不来的载荷」 */
export const DEFAULT_MAX_MS = 120_000;
/** 查一次「够了没」的间隔 */
export const POLL_MS = 400;

function hits(item: AcquiredItem, want: readonly string[]): boolean {
  if (want.length === 0) return true;
  return want.some((w) => item.url.includes(w));
}

function countWanted(items: readonly AcquiredItem[], want: readonly string[]): number {
  return items.filter((x) => hits(x, want)).length;
}

/**
 * ⭐ 开始收。**立即返回**,不等 —— 页面怎么动由控制那栏决定。
 *
 * ⚠️ 返回各条腿是否就绪:**两条都没起来才算失败**,
 * 少一条是降级不是失败 —— 这正是多条腿的意义。
 */
export async function startAcquire(
  deps: AcquireDeps,
  pageId: PageId,
): Promise<{ ok: boolean; cdpAttached: boolean; hookInstalled: boolean }> {
  const legs = await deps.startAll(pageId);
  return { ok: legs.cdpAttached || legs.hookInstalled, ...legs };
}

/**
 * ⭐ 停止收,并给出这一轮的报告(含完整性判据)。
 *
 * ⚠️ `problems` 空才算采全 —— `ok` 由它算出,不是独立字段
 * (两者各说各话就是撒谎的入口)。
 */
export function finishAcquire(
  deps: AcquireDeps,
  pageId: PageId,
  goal: AcquireGoal = {},
  startedAt?: number,
): AcquireReport {
  const want = goal.wantUrlIncludes ?? [];
  deps.stopAll(pageId);

  const items = [...deps.snapshot(pageId)];
  const wanted = countWanted(items, want);
  const legStats = deps.legStats(pageId);
  const fromCount = (k: AcquiredItem['from']): number => items.filter((x) => x.from === k).length;

  const problems: string[] = [];
  if (items.length === 0) {
    problems.push('一条响应都没有 —— 页面可能没发请求(先去控制那栏翻页/滚动),或两条腿都失效');
  } else if (want.length > 0 && wanted === 0) {
    problems.push(
      `采到 ${items.length} 条响应,但**没有一条**命中目标(${want.join(' / ')})`
      + ' —— 可能页面不对,或该站点的接口路径变了',
    );
  }
  if (goal.wantAtLeast !== undefined && wanted < goal.wantAtLeast) {
    problems.push(
      `只采到 ${wanted} 条,不足目标 ${goal.wantAtLeast} 条 —— `
      + '结果不完整(**去控制那栏多翻几页**再回来停)',
    );
  }

  return {
    ok: problems.length === 0,
    problems,
    items,
    wanted,
    elapsedMs: startedAt === undefined ? 0 : deps.now() - startedAt,
    stopReason: '人工停止',
    legs: {
      cdp: fromCount('cdp'),
      hook: fromCount('hook'),
      both: fromCount('both'),
      hookInjected: legStats.hookInjected,
      // ⚠️ 到这一步已经停了,只能回报当下是否仍有腿在 —— 如实说
      cdpAttached: fromCount('cdp') + fromCount('both') > 0,
    },
  };
}

/**
 * ⭐ 当前进度 —— 给面板实时显示「收到几条了」。
 * ⚠️ 不停、不改任何状态:纯读。
 */
export function peekAcquire(
  deps: AcquireDeps,
  pageId: PageId,
  goal: AcquireGoal = {},
): { total: number; wanted: number; cdp: number; hook: number; both: number } {
  const items = deps.snapshot(pageId);
  const want = goal.wantUrlIncludes ?? [];
  const n = (k: AcquiredItem['from']): number => items.filter((x) => x.from === k).length;
  return {
    total: items.length,
    wanted: countWanted(items, want),
    cdp: n('cdp'), hook: n('hook'), both: n('both'),
  };
}

/**
 * ⚠️ **可选**的便利函数:开始收 → 等到够了 → 停。
 *
 * ⭐ 它**仍然不碰页面** —— 只是替调用方省掉轮询,
 * 页面该怎么动由调用方在**另一条线**上做(控制那栏)。
 * ⚠️ 没有调用方时不要保留它:本仓「建好了没接线」已栽过五次。
 */
export async function awaitEnough(
  deps: AcquireDeps,
  pageId: PageId,
  goal: AcquireGoal,
  sleep: (ms: number) => Promise<void>,
): Promise<AcquireReport> {
  const t0 = deps.now();
  const maxMs = goal.maxMs ?? DEFAULT_MAX_MS;
  const want = goal.wantUrlIncludes ?? [];

  await startAcquire(deps, pageId);
  while (deps.now() - t0 < maxMs) {
    if (goal.wantAtLeast !== undefined
      && countWanted(deps.snapshot(pageId), want) >= goal.wantAtLeast) break;
    await sleep(POLL_MS);
  }
  const r = finishAcquire(deps, pageId, goal, t0);
  return {
    ...r,
    stopReason: r.wanted >= (goal.wantAtLeast ?? 0)
      ? `已采够 ${r.wanted} 条(目标 ${goal.wantAtLeast})`
      : `等到 ${maxMs}ms 超时,只采到 ${r.wanted} 条`,
  };
}
