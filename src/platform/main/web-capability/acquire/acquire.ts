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

/**
 * ⭐ 开始收。**立即返回**,不等 —— 页面怎么动由控制那栏决定。
 *
 * ⚠️ 返回各条腿是否就绪:**两条都没起来才算失败**,
 * 少一条是降级不是失败 —— 这正是多条腿的意义。
 */
export async function startAcquire(
  deps: AcquireDeps,
  pageId: PageId,
  /** ⚠️ 不要的 URL 子串 —— 原样透传给 deps,本层不认识任何站点 */
  noisy?: readonly string[],
): Promise<{ ok: boolean; cdpAttached: boolean; hookInstalled: boolean }> {
  const legs = await deps.startAll(pageId, noisy);
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
  startedAt?: number,
): AcquireReport {
  deps.stopAll(pageId);

  const items = [...deps.snapshot(pageId)];
  const legStats = deps.legStats(pageId);
  const fromCount = (k: AcquiredItem['from']): number => items.filter((x) => x.from === k).length;

  /**
   * ⭐⭐ `problems` —— **只报采集本身的问题**,不做研判。
   *
   * ⚠️ 2026-10-02 删掉了「没一条命中目标」「不足目标条数」两条:
   * 那是**研判**(哪些算有用、够不够),不是采集的事
   * (用户:「采集数据就是全面的采集,没有数据研判的功能呀?」)。
   * ⭐ 采集只知道一件事:**一条都没收到** —— 那才是它自己的问题。
   */
  const problems: string[] = [];
  if (items.length === 0) {
    problems.push('一条响应都没有 —— 页面可能没发请求(先去控制那栏翻页/滚动),或两条腿都失效');
  }

  return {
    ok: problems.length === 0,
    problems,
    items,
    elapsedMs: startedAt === undefined ? 0 : deps.now() - startedAt,
    stopReason: '人工停止',
    legs: {
      cdp: fromCount('cdp'),
      hook: fromCount('hook'),
      both: fromCount('both'),
      hookInjected: legStats.hookInjected,
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
): { total: number; cdp: number; hook: number; both: number } {
  const items = deps.snapshot(pageId);
  const n = (k: AcquiredItem['from']): number => items.filter((x) => x.from === k).length;
  // ⚠️ 只报**收到了多少** —— 「其中几条有用」是上层的事
  return { total: items.length, cdp: n('cdp'), hook: n('hook'), both: n('both') };
}

/**
 * ⚠️ **可选**的便利函数:开始收 → 等到够了 → 停。
 *
 * ⭐ 它**仍然不碰页面** —— 只是替调用方省掉轮询,
 * 页面该怎么动由调用方在**另一条线**上做(控制那栏)。
 * ⚠️ 没有调用方时不要保留它:本仓「建好了没接线」已栽过五次。
 */
export async function awaitFor(
  deps: AcquireDeps,
  pageId: PageId,
  ms: number,
  sleep: (ms: number) => Promise<void>,
): Promise<AcquireReport> {
  const t0 = deps.now();
  await startAcquire(deps, pageId);
  await sleep(ms);
  const r = finishAcquire(deps, pageId, t0);
  return { ...r, stopReason: `收了 ${ms}ms` };
}
