/**
 * 把 `web.page` 的生命周期事件接进 `web.trace` —— 「当时在哪个页面」
 *
 * ── 为什么这个文件必须存在 ──
 *
 * `PageRegistry` 一直在 `emit` 四种事件(created / destroyed / navigated / moved),
 * `subscribeLifecycle` 也一直存在 —— 但全仓**零订阅者**。
 * 于是 lifecycle 这条流永远是空的:磁盘上连目录都没建出来
 * (2026-09-15 读真实留痕时发现)。
 *
 * ⚠️ 这是同一形态的第八次:**建好了、测过了、没接线**。
 *
 * ── 为什么这条流值得接 ──
 *
 * `03-observability.md` §3.2 给它的用途是「**当时在哪个页面**」。
 * 排查采集类问题时,这恰恰是第一个要回答的问题 ——
 * 「抓到 0 条」到底是选择器坏了,还是当时页面压根导航走了。
 * degradation 只记「哪里坏了」,回答不了「当时在哪」。
 */

import { pageRegistry, traceRecorder } from './runtime';

let unsubscribe: (() => void) | null = null;

/** 开始把页面生命周期写进 trace。幂等 */
export function startTraceLifecycle(): void {
  if (unsubscribe) return;
  unsubscribe = pageRegistry.subscribeLifecycle((event) => {
    // ⚠️ 只记**事实**,不记页面内容 —— url 已经是可能含敏感信息的上限
    //    (§4.4:记什么由调用方决定,底座不内置过滤)
    traceRecorder.lifecycle({
      layer: 'web.page',
      event: event.kind,
      pageId: String(event.pageId),
      detail: event.kind === 'page-created' || event.kind === 'page-moved'
        ? { ws: event.facts.ws, slot: event.facts.slot, owner: event.facts.owner,
            service: event.facts.service, url: event.facts.url }
        : event.kind === 'page-navigated'
          ? { url: event.url, service: event.service }
          : undefined,
      ts: event.at,
    });
  });
}

/** 停止订阅(对称,供 before-quit / 测试用) */
export function stopTraceLifecycle(): void {
  unsubscribe?.();
  unsubscribe = null;
}
