/**
 * ⭐⭐⭐ X 网页登记 renderer → 主进程同步(2026-10-14,后台采集第 4 步)
 *
 * ⚠️⚠️ 为什么有这个文件:`x-host-registry` 是模块级 Map,**每个进程各一份**。
 * 登记(XWebView 的 wcId)只发生在 renderer;
 * 后台 runner 跑在**主进程**,读的是主进程那份 —— 不同步就恒空:
 * runner 把每个 ws 都当「没开 X 网页」跳过(一页不采、不报错)。
 * ⚠️ 「忙」不再同步(2026-10-23 syncBusy 退役):占网页改走主进程的锁(x-page-lock),renderer 只经 IPC 申请。
 *
 * ⭐ 做法:订阅本进程登记表,有变化就把**差异**发给主进程(按 ws / 按 wcId 一条条发,
 * 不发整表快照 —— 多窗口各有一个 renderer,整表会互相覆盖掉别的窗口的 ws)。
 *
 * ⚠️ 只在 renderer 用(`renderer.ts` 调 `startXHostSync`)。主进程那边由 x-data-ipc 的
 * syncHost 写进主进程的登记表,并在 webview 销毁时自己清掉。
 */

import { listXHostStates, subscribeXHost } from './x-host-registry';
import { xDataCall, type XDataInvoke } from './x-data-types';

/** 已发给主进程的样子(只比 wcId —— url 主进程不用,每次导航都发是白发) */
const sentHost = new Map<string, number>();

function send(p: XDataInvoke): void {
  void xDataCall(p).then((r) => {
    /** ⚠️ 同步失败 = 后台看不见这个 X 网页 —— 不能静默 */
    if (r.status !== 'ok') console.error(`[x.host-sync] ${p.op} 没同步到主进程:${r.reason}`);
  });
}

/** 比一次差异并发出去(导出给测试) */
export function syncOnce(): void {
  const hosts = listXHostStates();
  for (const [ws, st] of hosts) {
    if (sentHost.get(ws) !== st.wcId) { sentHost.set(ws, st.wcId); send({ op: 'syncHost', wsId: ws, wcId: st.wcId }); }
  }
  for (const ws of [...sentHost.keys()]) {
    if (!hosts.has(ws)) { sentHost.delete(ws); send({ op: 'syncHost', wsId: ws, wcId: null }); }
  }
}

let started = false;

/** ⚠️ 幂等;renderer 入口调一次 */
export function startXHostSync(): void {
  if (started) return;
  started = true;
  subscribeXHost(syncOnce);
  syncOnce();
}

/** 测试用 */
export function _resetXHostSync(): void {
  sentHost.clear();
}
