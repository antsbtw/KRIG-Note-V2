/**
 * X 侧载荷捕获 —— 经 `web.net` 的统一入口(步 6a)
 *
 * ── 要治的病(`x/refactor-02` §3.3,已用可执行测试复现)──
 *
 * 迁移前,7 个模块各自写 `attach → on(message) → Network.enable → ... → detach`,
 * 靠一句注释级约定共用:`catch { /* 已被 attach,共用即可 *​/ }`。
 *
 * **这里有个顺序依赖的洞**(见 `tests/web-capability/x-cdp-order-dependence.test.ts`):
 *
 * | 上线顺序 | 结果 |
 * |---|---|
 * | 常驻 B 先 → 一次性 A 后 | A 的 `attached=false`,不 detach,B 安全 |
 * | **A 先 → B 共用** | A 走时**真的 detach**,B 静默失聪,`state.attached` **仍是 true** |
 *
 * ⚠️ 最狠的是后半句:**B 以为自己还在监听**,不重连不告警,只是聋了 ——
 * 表现为「采集突然变 0」。这也解释了它为什么难复现:
 * 日常 notification-watch 通常先开着,**只有「先跑采集、期间开监听」才炸**。
 *
 * ── 迁移后 ──
 *
 * 业务方**只订阅,没有 detach 这个动作**(接口上就没有),
 * 于是「谁先谁后」不再是变量 —— **这个 bug 在结构上消失了**,
 * 而不是「被小心避开了」。
 */

import type { PageId } from '../web-capability/page';
import { pageRegistry, netBus, bodyProvider, getNetMonitor } from '../web-capability/wiring/runtime';
import { toPageHost } from '../web-capability/wiring/electron-page-host';
import { bindPageHost } from '../web-capability/wiring/page-hosts';
import type { NetworkEvent } from '../web-capability/net';

/** 一个 X webContents 对应的 pageId(同一个 wc 复用同一个身份)*/
const pageIdByWc = new Map<number, PageId>();

/**
 * 从 webContents 反推它的 partition(形如 `persist:webview-ws-2`)。
 *
 * ⚠️ 2026-09-14 改为导出:调度器无人值守回落时要从 wc 反推 wsId。
 * ⭐ **绝不允许第二份实现** —— 反推规则写两遍,改一处漏一处,
 * 而现象是「多 ws 时任务跑到别的 ws 上」,极难定位。
 */
export function readPartition(wc: Electron.WebContents): string {
  try {
    const p = wc.session.storagePath;
    return p ? `persist:${p.split('/').pop()}` : 'persist:webview';
  } catch {
    return 'persist:webview';
  }
}

/**
 * 从 partition 反推 wsId。取不到返回 null。
 *
 * ⚠️ 与 `xPageId` 里的 `ws:` 同一条规则 —— 两处必须共用本函数,
 * 别再各写一次正则。
 */
export function wsIdOf(wc: Electron.WebContents): string | null {
  return readPartition(wc).match(/^persist:webview-(.+)$/)?.[1] ?? null;
}

/** 在 `web.page` 登记这个 X 页面并返回身份;已登记则直接返回 */
export function xPageId(wc: Electron.WebContents): PageId {
  const existing = pageIdByWc.get(wc.id);
  if (existing) {
    // ⚠️ **早返回这条路也要绑**(2026-09-15 补)。
    //
    // `bindPageHost` 原本只在下面「新登记」那一支里调 —— 而 `xPageId` 有三个调用方
    // (控制台 / captureXPayloads / 调度器),**只要有一处先跑过**,后面全走早返回,
    // 于是 `pageIdByWc` 答得出 pageId、`hosts` 里却没有 wc。
    // 今天没暴露是因为两张表同为模块级、一起随进程消失;
    // 一旦有人 `unbindPageHost`(已导出)或多一个登记方,就会出现
    // 「查得到身份、拿不到渲染目标」→ 报成「页面已关闭」,指向完全错误的方向。
    // `Map.set` 幂等,重复绑无副作用。
    bindPageHost(existing, wc);
    return existing;
  }
  const partition = readPartition(wc);
  const facts = pageRegistry.register({
    window: 'main',
    ws: partition.match(/^persist:webview-(.+)$/)?.[1] ?? 'unknown',
    slot: 'left',
    partition,
    owner: 'x-service',
    service: 'x',
    url: wc.getURL(),
    state: 'complete',
  });
  pageIdByWc.set(wc.id, facts.pageId);
  // ⭐ 反向绑定 —— 没有这一行,`web.page` / `web.input` 拿不到渲染目标,
  //    表现为「登记了页面但控制/输入调不动」,且**不报错**。
  bindPageHost(facts.pageId, wc);
  return facts.pageId;
}

/** 一条捕获到的 X 载荷(已解出 body 文本) */
export type XPayload = {
  readonly url: string;
  readonly requestId: string;
  readonly body: string;
};

export type XCaptureOptions = {
  /** 只要 URL 含这些子串的响应(如 `/i/api/graphql/` + `UserByScreenName`) */
  readonly urlIncludes: readonly string[];
  /** 收到一条匹配载荷 */
  readonly onPayload: (payload: XPayload) => void;
  /**
   * ⭐ 通道故障。旧实现在这里是**静默**的(attach 失败只 catch 一下就继续,
   * 订阅者安静等一个永不来的载荷)。迁移后必须让调用方看得见。
   */
  readonly onChannelFault?: (reason: string, kind: 'failed' | 'lost') => void;
};

/**
 * 订阅一个 X 页面的载荷。
 *
 * ⭐ 返回的是**退订函数,不是 detach** —— 调用方无论怎么用,
 * 都掐不断别的订阅者。这是本次迁移的全部要点。
 */
export function captureXPayloads(
  wc: Electron.WebContents,
  options: XCaptureOptions,
): () => void {
  const pageId = xPageId(wc);
  const monitor = getNetMonitor(String(pageId));

  const unsubscribe = netBus.subscribe(pageId, {}, (event: NetworkEvent) => {
    monitor.observe(event);

    if (event.kind === 'channel-failed') {
      options.onChannelFault?.(event.reason, 'failed');
      return;
    }
    if (event.kind === 'channel-lost') {
      options.onChannelFault?.(event.reason, 'lost');
      return;
    }
    if (event.kind !== 'response-complete' || !event.bodyRef) return;

    const record = netBus.list(pageId, {}).find((r) => r.requestId === event.requestId);
    if (!record) return;
    if (!options.urlIncludes.every((s) => record.url.includes(s))) return;

    const body = netBus.body(event.bodyRef);
    if (body.status !== 'ok') {
      // 拿不到 body 不静默丢 —— 旧实现这里是 `.catch(() => {})`
      console.warn(`[x-net] 载荷取不到 (${record.url}): ${body.status === 'failed' ? body.reason : ''}`);
      return;
    }
    options.onPayload({
      url: record.url,
      requestId: record.requestId,
      body: new TextDecoder().decode(body.value),
    });
  });

  // ⭐ 装通道。幂等 —— 别的模块已经装过就直接复用,不重复 attach、更不会互相掐。
  // attach 失败时 provider 会广播 channel-failed,上面的订阅者立刻收到。
  bodyProvider.attach(toPageHost(wc), pageId, {
    resourceTypes: ['fetch', 'document', 'xhr'],
  });

  return unsubscribe;
}
