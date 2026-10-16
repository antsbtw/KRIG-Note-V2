/**
 * ⭐⭐ 采集留痕 —— goto / harvest 的「去了哪 / 收到了什么」落盘
 *
 * 2026-10-13 从 `ipc-dom.ts` 的 `goto` / `harvest` 两个 case **原样抽出**(后台采集策略 3a)。
 *
 * ── 为什么单独一个文件 ──
 * 用户拍板:厚重留痕**不进采集引擎**(引擎只采 + 返回数据),由调用方打。
 * 而调用方现在有两个:renderer 经 IPC(`ipc-dom.ts`)、X 在主进程直接调(人卡 / 后台 runner)。
 * ⚠️ 两边各抄一份就会漂 —— 漂的表现是「同一次采集,走 IPC 有端点清单、走主进程没有」,
 * 而那正是 2026-10-04「`harvest` 取代手动流程时**漏带了**」的同一个病。
 * ⭐ 所以留痕写一份,两个调用方都调它。
 */

import { traceRecorder } from './runtime';
import type { HarvestReport } from '../harvest/types';
import type { PageId } from '../page/types';

/** 导航结果落盘 —— 每次 goto(不论成败)都调 */
export function traceGoto(
  pageId: PageId,
  name: string,
  params: Readonly<Record<string, string>> | undefined,
  r: { readonly status: string },
): void {
  /**
   * ⭐⭐ 导航结果落盘 —— 2026-10-02 补。
   *
   * ⚠️ 起因:载荷捕到 0 条时,我**读不到人到底去了哪一页**,
   * 只能反过来问 —— 又回到「靠截图」(用户点破的那条)。
   * ⭐ `landedUrl` 尤其要紧:它与 `requestedUrl` 不同就说明
   * 站点自己接管了导航(X 常有),而那会改变后面该看什么。
   */
  traceRecorder.lifecycle({
    layer: 'web.page',
    event: r.status === 'ok' ? 'goto' : `goto-${r.status}`,
    pageId: String(pageId),
    detail: {
      name: name,
      params: params ?? {},
      landedUrl: (r as { value?: { landedUrl?: string } }).value?.landedUrl,
      reason: (r as { reason?: string }).reason,
    },
  });
}

/** harvest 结果落盘 + 终端一行 —— 每次 harvest 跑完都调 */
export function traceHarvest(pageId: PageId, url: string, rep: HarvestReport): void {
  if (rep.cdpSettle && rep.cdpSettle.waitedMs > 0) {
    console.log(`[web.harvest] 收尾等 CDP 在途取回 ${rep.cdpSettle.waitedMs}ms`
      + `${rep.cdpSettle.leftInFlight > 0 ? `,⚠️ 等满仍剩 ${rep.cdpSettle.leftInFlight} 条没到` : ',全部落地'}`);
  }
  traceRecorder.lifecycle({
    layer: 'web.net',
    event: rep.ok ? 'harvest-ok' : 'harvest-incomplete',
    pageId: String(pageId),
    detail: {
      url,
      total: rep.items.length,
      pages: rep.pages,
      rounds: rep.rounds,
      scrolledPx: Math.round(rep.scrolledPx),
      elapsedMs: rep.elapsedMs,
      stopReason: rep.stopReason,
      legs: rep.legs,
      /** ⭐ 收尾前等 CDP 在途取回:等了多久 / 还剩几条 —— 种子没头时先看这个 */
      cdpSettle: rep.cdpSettle,
      problems: rep.problems,
      /**
       * ⭐⭐ **收到的是什么** —— 2026-10-04 补。
       *
       * ⚠️ 起因:配方搜索滚了 60 轮 39983px,却只有 **1 条**时间线载荷,
       * 而我**读不出那 40 条响应里都是些什么** —— 只能回头猜。
       * ⭐ 这正是 2026-10-02 补过的那条(「我知道捕到 37 条,
       * 却不知道捕到的是什么」),`harvest` 取代手动流程时**漏带了**。
       *
       * ⚠️ 只记**路径尾段 + 条数**,不记完整 URL(带长 queryId)、
       * 更不记正文(几十 KB 会把留痕写爆)。
       */
      endpoints: (() => {
        const n = new Map<string, number>();
        for (const it of rep.items) {
          const tail = it.url.split('?')[0].split('/').filter(Boolean).pop() ?? '(无)';
          n.set(tail, (n.get(tail) ?? 0) + 1);
        }
        return [...n.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([tail, count]) => `${count}× ${tail}`);
      })(),
      /** ⭐ 展开的产出摘要 —— 「跑没跑」要分得清 */
      expand: rep.afterRound.length > 0
        ? {
          轮数: rep.afterRound.length,
          点开了: rep.afterRound.reduce<number>(
            (n, x) => n + (((x as { expanded?: number }).expanded) ?? 0), 0,
          ),
        }
        : '(未启用)',
      /** ⭐ 采到了什么 —— 全量按类型聚合,不截断 */
      byKind: (() => {
        const g = new Map<string, number>();
        for (const x of rep.items) {
          const tail = x.url.split('?')[0].split('/').filter(Boolean).pop() ?? '(无)';
          const key = /\.(m4s|mp4|m3u8|ts)$/.test(tail)
            ? `(视频分片 *.${tail.split('.').pop()})` : tail;
          g.set(key, (g.get(key) ?? 0) + 1);
        }
        return Object.fromEntries([...g.entries()].sort((a, b) => b[1] - a[1]));
      })(),
    },
  });
  console.log(
    `[web.harvest] ${rep.ok ? '✓' : '⚠'} pageId=${pageId} —— `
    + `${rep.pages} 页 / ${rep.items.length} 条 / ${rep.rounds} 轮 / ${rep.stopReason}`,
  );
}
