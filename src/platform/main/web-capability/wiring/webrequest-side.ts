/**
 * ⭐⭐ `web.net` 的 **webRequest 侧接线** —— 这一层建好三个月没人接的那一半
 *
 * ── 实测真因(2026-09-15 起,守卫钉着)──
 *
 * 用户点「抓画像」,日志刷上百行 `body 关联失败 … 配不上任何 webRequest 记录`,
 * 其中就有 `UserByScreenName?screen_name=…` —— **正是抓画像要的那条载荷**。
 *
 * 链条是这样断的:
 *
 *   webRequest 侧**零监听**(全仓没有任何 `session.webRequest.on*`)
 *     → `recordRequestStart` 零生产调用 → `candidatesFor(pageId)` 恒空
 *       → `findClosestMatch` 恒 null → `attachProviderBody` 恒「关联失败」
 *         → `captureXPayloads` 的 `onPayload` **永不触发**
 *           → 抓画像空转 12s,报「未截获账号载荷」
 *
 * ⚠️ CDP 那一侧**一直是好的**(`body-provider.ts` 在 `Network.requestWillBeSent`
 * 里调 `bindProviderRequest`)。少的自始至终只有这一半 ——
 * 「层建好了、测试六份、接线为零」,本仓反复出现的形态。
 *
 * ── 为什么挂在 session 上而不是 webContents 上 ──
 *
 * Electron 的 `webRequest` 是 **session 级**的。per-ws partition
 * (`persist:webview-${wsId}`)下,X / AI / 普通浏览**共用同一个 session**,
 * 所以这一个监听会看见该 ws 的全部流量。
 *
 * ⭐ 那正是要的:**本层不认识 X**。它只做一件事 ——
 * 把「能映射到已登记页面」的请求记进 bus,其余丢掉。
 * 谁登记了页面、为什么登记,是业务的事。
 *
 * ⚠️ `details.webContentsId` 是**可选**的(service worker / 某些 preload 请求没有)。
 * 拿不到就丢 —— **绝不猜**一个 pageId:猜错会把别的页面的流量关联到这个页面上,
 * 而那种错误在数据里看不出来。
 */

import { session } from 'electron';
import type { PageId } from '../page/types';
import type { NetworkEventBus } from '../net';

/** 已接线的 partition —— 同一个 session 只挂一次(重复挂会让每条请求记两遍) */
const wired = new Set<string>();

/** 依赖倒置:pageId 反查由业务注入,本层不 import 任何业务模块 */
export type PageIdLookup = (wcId: number) => PageId | null;

let lookup: PageIdLookup | null = null;

/**
 * 业务侧注册「wcId → pageId」的反查。
 *
 * ⚠️ 没注册时本层**什么都不记**(而不是记一堆无主记录)——
 * 并且会 warn:静默不记会让「关联失败」看起来像 CDP 侧的问题,
 * 排查方向完全相反。
 */
export function registerPageIdLookup(fn: PageIdLookup): void {
  lookup = fn;
}

/**
 * 给一个 partition 的 session 挂上 webRequest 监听。
 *
 * ⚠️ 幂等:同一 partition 重复调只挂一次。
 * ⚠️ Electron 的 `onBeforeRequest` / `onCompleted` 每个 session
 * **只能有一个监听器**(后挂的覆盖先挂的),所以绝不能让别处再挂一遍 ——
 * 那会让这一侧又悄悄失效。
 */
export function wireWebRequestSide(bus: NetworkEventBus, partition: string): void {
  if (wired.has(partition)) return;
  wired.add(partition);

  const sess = session.fromPartition(partition);

  sess.webRequest.onBeforeRequest((details, callback) => {
    try {
      recordStart(bus, details);
    } catch (err) {
      // ⚠️ 绝不让留痕的错误挡住真实请求 —— callback 必须照常放行
      console.warn('[web.net] webRequest 记录失败(请求照常放行):', err);
    }
    callback({});
  });

  sess.webRequest.onCompleted((details) => {
    try {
      recordDone(bus, details);
    } catch (err) {
      console.warn('[web.net] webRequest 完成记录失败:', err);
    }
  });

  console.log(`[web.net] webRequest 侧已接线(${partition})`);
}

function pageOf(webContentsId: number | undefined): PageId | null {
  if (typeof webContentsId !== 'number') return null;
  if (!lookup) {
    console.warn('[web.net] 没有注册 pageId 反查 —— webRequest 侧不记任何东西');
    return null;
  }
  return lookup(webContentsId);
}

function recordStart(
  bus: NetworkEventBus,
  details: Electron.OnBeforeRequestListenerDetails,
): void {
  const pageId = pageOf(details.webContentsId);
  if (!pageId) return;   // 没映射到已登记页面 —— 丢掉,不猜

  bus.recordRequestStart({
    requestId: String(details.id),
    pageId,
    url: details.url,
    method: details.method,
    resourceType: details.resourceType?.toLowerCase(),
    startedAt: new Date(details.timestamp).toISOString(),
  });
}

function recordDone(
  bus: NetworkEventBus,
  details: Electron.OnCompletedListenerDetails,
): void {
  const pageId = pageOf(details.webContentsId);
  if (!pageId) return;

  /**
   * ⚠️ 方法名是 `recordResponseComplete`,不是 `recordRequestEnd`。
   * 我初版按对称性**编了个名字**,编译器当场拦下 —— 而同样的编名字问题
   * 在守卫里(`noteProviderRequest`)躲过了检查,因为那是字符串,
   * 编译器看不见。**凡是写在字符串里的符号名,都得自己去核对。**
   */
  bus.recordResponseComplete({
    requestId: String(details.id),
    pageId,
    url: details.url,
    method: details.method,
    resourceType: details.resourceType?.toLowerCase(),
    status: details.statusCode,
    startedAt: new Date(details.timestamp).toISOString(),
    finishedAt: new Date().toISOString(),
  });
}

/** 测试/重置用 —— 生产不调 */
export function resetWebRequestWiring(): void {
  wired.clear();
  lookup = null;
}
