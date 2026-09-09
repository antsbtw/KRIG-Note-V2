/**
 * `web.net` 事件总线 —— 订阅 / 分发 / 记录 / 关联(纯内存,零 Electron 依赖,可完全单测)
 *
 * ── 本文件解决的核心问题:静默失聪 ──
 *
 * `x/refactor-02` §3.3 记的疑似真 bug:X 有 8 处各自 attach CDP,靠注释级约定「共用」。
 * 先 attach 的 A 结束时 `detach()`,**把正在共用的 B 一起掐掉**;
 * B 的 `attached=false`,它**不重连、不报错,只是安静地再也收不到任何载荷** ——
 * 表现为「采集突然变 0」。
 *
 * 本层的解法有两半,缺一不可:
 *  1. **单一持有者模型**(见 `body-provider.ts`):业务方压根没有 detach 这个动作,
 *     「最后一个人关灯」这个时刻不存在 → 也就无从关错灯
 *  2. **通道故障必须广播**(本文件的 `channelFailed` / `channelLost`):
 *     即使真的失去通道,订阅者也**立刻知道**,而不是安静等下去
 *
 * ⚠️ V1 两半都只做了第一半。第二半是本步补的。
 */

import type { PageId } from '../page/types';
import { type Result, failed, ok } from '../result';
import {
  type CorrelationCandidate,
  findClosestMatch,
  normalizeResourceType,
  resourceTypesMatch,
} from './correlate';
import type {
  DownloadRecord,
  NetworkEvent,
  NetworkEventKind,
  NetworkFilter,
  NetworkMatcher,
  NetworkRecord,
} from './types';

export type NetworkListener = (event: NetworkEvent) => void;

type Subscription = {
  readonly pageId: PageId;
  readonly kinds: ReadonlySet<NetworkEventKind> | null;
  readonly frameId?: string;
  readonly urlIncludes?: string;
  readonly listener: NetworkListener;
};

/** CDP 侧登记的请求,等着与 webRequest 侧配对 */
type ProviderBinding = {
  readonly pageId: PageId;
  readonly providerRequestId: string;
  readonly url: string;
  readonly method: string;
  readonly resourceType?: string;
  readonly startedAt: string;
  canonicalRequestId?: string;
};

/**
 * ⭐ 通道故障类事件**不受 kinds 过滤**。
 *
 * 理由:订阅者订的是「我要 response-complete」,但它更需要知道「你再也等不到了」。
 * 若让 channel-failed 被 kinds 过滤掉,就等于**把失聪告警本身也静默了** ——
 * 那这个机制就白做了。所以这两类无条件送达该 pageId 的所有订阅者。
 */
const ALWAYS_DELIVERED: ReadonlySet<NetworkEventKind> = new Set<NetworkEventKind>([
  'channel-failed',
  'channel-lost',
]);

let subCounter = 0;
let bodyRefCounter = 0;

export class NetworkEventBus {
  static readonly MAX_REQUESTS_PER_PAGE = 500;
  static readonly MAX_RESPONSE_BODIES = 256;
  static readonly MAX_PROVIDER_BINDINGS = 1024;

  private readonly subscriptions = new Map<string, Subscription>();
  private readonly requests = new Map<PageId, NetworkRecord[]>();
  private readonly downloadsByPage = new Map<PageId, DownloadRecord[]>();
  private readonly bodiesByRef = new Map<string, Uint8Array>();
  /** bodyRef 的插入序,用于老化(Map 迭代序即插入序) */
  private readonly providerBindings = new Map<string, ProviderBinding>();

  constructor(private readonly now: () => number = Date.now) {}

  // ── 订阅 ──

  /**
   * 订阅某个页面的网络事件。
   *
   * ⭐ 应用**只订阅,永不 attach/detach**(`06` §3.2)——
   * 接口上就没有暴露 attach 能力,所以「关错灯」在类型层面就发生不了。
   */
  subscribe(pageId: PageId, matcher: NetworkMatcher, listener: NetworkListener): () => void {
    subCounter += 1;
    const id = `sub_${subCounter.toString(36)}`;
    this.subscriptions.set(id, {
      pageId,
      kinds: matcher.kinds ? new Set(matcher.kinds) : null,
      frameId: matcher.frameId,
      urlIncludes: matcher.urlIncludes,
      listener,
    });
    return () => { this.subscriptions.delete(id); };
  }

  /** 当前订阅数(诊断/测试用) */
  subscriberCount(pageId?: PageId): number {
    if (pageId === undefined) return this.subscriptions.size;
    let n = 0;
    for (const s of this.subscriptions.values()) if (s.pageId === pageId) n += 1;
    return n;
  }

  // ── 记录(由 provider / session-capture 调用)──

  recordRequestStart(record: NetworkRecord): void {
    const list = this.requests.get(record.pageId) ?? [];
    // 反向关联:这条 webRequest 记录能不能配上某个已登记的 CDP 请求
    const providerRequestId = this.findProviderRequestId(record);
    const next: NetworkRecord = providerRequestId
      ? { ...record, providerRequestId }
      : record;
    this.requests.set(
      record.pageId,
      this.capRequests([...list.filter((r) => r.requestId !== record.requestId), next]),
    );
    this.emit({
      kind: 'request-start',
      pageId: next.pageId,
      frameId: next.frameId ?? null,
      requestId: next.requestId,
      url: next.url,
      method: next.method,
      at: next.startedAt,
    });
  }

  recordResponseComplete(record: NetworkRecord, body?: Uint8Array): void {
    const list = this.requests.get(record.pageId) ?? [];
    let stored: NetworkRecord = record;
    if (body) {
      const bodyRef = record.bodyRef ?? this.mintBodyRef();
      this.storeBody(bodyRef, body);
      stored = { ...record, bodyRef, bodyBytes: body.byteLength };
    }
    this.requests.set(
      record.pageId,
      this.capRequests([...list.filter((r) => r.requestId !== record.requestId), stored]),
    );
    this.emit({
      kind: 'response-complete',
      pageId: stored.pageId,
      frameId: stored.frameId ?? null,
      requestId: stored.requestId,
      status: stored.status,
      bodyRef: stored.bodyRef,
      at: stored.finishedAt ?? new Date(this.now()).toISOString(),
    });
  }

  recordResponseChunk(input: {
    pageId: PageId;
    frameId?: string | null;
    requestId: string;
    mimeType?: string;
    chunkText?: string;
    at?: string;
  }): void {
    this.emit({
      kind: 'response-chunk',
      pageId: input.pageId,
      frameId: input.frameId ?? null,
      requestId: input.requestId,
      mimeType: input.mimeType,
      chunkText: input.chunkText,
      at: input.at ?? new Date(this.now()).toISOString(),
    });
  }

  recordDownload(record: DownloadRecord): void {
    const list = this.downloadsByPage.get(record.pageId) ?? [];
    this.downloadsByPage.set(record.pageId, [
      ...list.filter((d) => d.downloadId !== record.downloadId),
      record,
    ]);
    if (record.status === 'completed') {
      this.emit({
        kind: 'download-complete',
        pageId: record.pageId,
        frameId: record.frameId ?? null,
        downloadId: record.downloadId,
        filename: record.filename,
        storageRef: record.storageRef,
        at: record.finishedAt ?? new Date(this.now()).toISOString(),
      });
    }
  }

  // ── ⭐ 通道故障广播(V1 缺的那一半)──

  /**
   * 通道建立失败 —— 该页面的订阅者**立刻**收到明确错误。
   *
   * V1 在这里只 `console.warn` 就 return,订阅者会安静等一个永不来的载荷
   * (`04` §2.1 明确要求移植时必须改)。
   */
  channelFailed(pageId: PageId, reason: string, retryable: boolean): void {
    this.emit({
      kind: 'channel-failed',
      pageId,
      reason,
      retryable,
      at: new Date(this.now()).toISOString(),
    });
  }

  /** 通道中途失去(被外部抢占 / 页面销毁)—— 订阅者据此知道自己聋了 */
  channelLost(pageId: PageId, reason: string): void {
    this.emit({
      kind: 'channel-lost',
      pageId,
      reason,
      at: new Date(this.now()).toISOString(),
    });
  }

  // ── 查询 ──

  /**
   * 列出某页面的请求记录。
   *
   * ⚠️ 页面从没有过记录时返回空数组 —— 这是**如实说没有**,不是兜底。
   * 兜底是「这个页面没有就返回别的页面的」,那才是被禁的。
   */
  list(pageId: PageId, filter: NetworkFilter = {}): NetworkRecord[] {
    const records = this.requests.get(pageId) ?? [];
    let out = records.filter((record) => {
      if (filter.frameId !== undefined && record.frameId !== filter.frameId) return false;
      if (filter.urlIncludes !== undefined && !record.url.includes(filter.urlIncludes)) return false;
      if (filter.resourceType !== undefined && !resourceTypesMatch(record.resourceType, filter.resourceType)) return false;
      return true;
    });
    if (typeof filter.limit === 'number') out = out.slice(-filter.limit);
    return out;
  }

  downloads(pageId: PageId): DownloadRecord[] {
    return [...(this.downloadsByPage.get(pageId) ?? [])];
  }

  /**
   * 取 body。
   *
   * ⚠️ 取不到返回 `Failed`,**不返回空 bytes 假装成功**(`06` §4.2)——
   * 空 body 和「body 已被老化淘汰」是两件完全不同的事,混起来就是静默坍缩。
   */
  body(bodyRef: string): Result<Uint8Array> {
    const bytes = this.bodiesByRef.get(bodyRef);
    if (!bytes) {
      return failed(`body not available: ${bodyRef}(可能已被老化淘汰或从未捕获)`, false);
    }
    return ok(bytes);
  }

  /**
   * 等一个匹配的请求。
   *
   * 超时返回 `Failed(retryable)` —— **不返回 null**,调用方必须显式处理。
   */
  waitFor(
    pageId: PageId,
    matcher: { urlIncludes?: string; method?: string; resourceType?: string },
    timeoutMs: number,
  ): Promise<Result<NetworkRecord>> {
    const matches = (record: NetworkRecord): boolean => {
      if (matcher.urlIncludes !== undefined && !record.url.includes(matcher.urlIncludes)) return false;
      if (matcher.method !== undefined && record.method !== matcher.method) return false;
      if (matcher.resourceType !== undefined && !resourceTypesMatch(record.resourceType, matcher.resourceType)) return false;
      return true;
    };

    const existing = (this.requests.get(pageId) ?? []).find(matches);
    if (existing) return Promise.resolve(ok(existing));

    return new Promise<Result<NetworkRecord>>((resolve) => {
      let settled = false;
      const finish = (result: Result<NetworkRecord>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(result);
      };

      const timer = setTimeout(() => {
        finish(failed(`waitFor 超时(${timeoutMs}ms):${JSON.stringify(matcher)}`, true));
      }, timeoutMs);
      // 不要吊住 Node 事件循环(记忆 project-graceful-shutdown)
      (timer as unknown as { unref?: () => void }).unref?.();

      const unsubscribe = this.subscribe(pageId, {}, (event) => {
        // ⭐ 通道没了就别再等 —— 这正是「安静等一个永不来的载荷」的解药
        if (event.kind === 'channel-failed') {
          finish(failed(`通道建立失败,等不到载荷了:${event.reason}`, event.retryable));
          return;
        }
        if (event.kind === 'channel-lost') {
          finish(failed(`通道已失去,等不到载荷了:${event.reason}`, true));
          return;
        }
        const candidate = (this.requests.get(pageId) ?? []).find(matches);
        if (candidate) finish(ok(candidate));
      });
    });
  }

  // ── 关联(CDP ↔ webRequest)──

  /** CDP 侧登记一个请求,等着与 webRequest 侧配对 */
  bindProviderRequest(
    pageId: PageId,
    providerRequestId: string,
    input: { url: string; method: string; resourceType?: string; startedAt: string },
  ): void {
    const key = `${pageId}:${providerRequestId}`;
    const canonicalRequestId = findClosestMatch(this.candidatesFor(pageId), input) ?? undefined;
    this.providerBindings.set(key, {
      pageId,
      providerRequestId,
      url: input.url,
      method: input.method,
      resourceType: normalizeResourceType(input.resourceType),
      startedAt: input.startedAt,
      canonicalRequestId,
    });
    this.capProviderBindings();
  }

  /**
   * 把 CDP 拿到的 body 贴到对应的 webRequest 记录上。
   *
   * ⚠️ 配不上时返回 `Failed`,**不静默丢**(prompt §7)——
   * 「解析/关联失败不许静默丢」。调用方据此留 degradation 记录。
   */
  attachProviderBody(
    pageId: PageId,
    providerRequestId: string,
    input: {
      url: string;
      method: string;
      resourceType?: string;
      mimeType?: string;
      responseHeaders?: Record<string, string>;
      body: Uint8Array;
    },
  ): Result<NetworkRecord> {
    const key = `${pageId}:${providerRequestId}`;
    const binding = this.providerBindings.get(key);
    const canonicalRequestId =
      binding?.canonicalRequestId ??
      findClosestMatch(this.candidatesFor(pageId), {
        url: input.url,
        method: input.method,
        resourceType: input.resourceType,
        startedAt: new Date(this.now()).toISOString(),
      });

    if (!canonicalRequestId) {
      return failed(
        `关联失败:CDP 请求 ${providerRequestId}(${input.method} ${input.url})配不上任何 webRequest 记录`,
        false,
      );
    }

    const list = this.requests.get(pageId) ?? [];
    const target = list.find((r) => r.requestId === canonicalRequestId);
    if (!target) {
      return failed(`关联到 ${canonicalRequestId} 但该记录已不存在(可能已被老化淘汰)`, false);
    }

    const bodyRef = target.bodyRef ?? this.mintBodyRef();
    this.storeBody(bodyRef, input.body);
    const next: NetworkRecord = {
      ...target,
      providerRequestId,
      bodyRef,
      bodyBytes: input.body.byteLength,
      mimeType: input.mimeType ?? target.mimeType,
      responseHeaders: input.responseHeaders ?? target.responseHeaders,
    };
    this.requests.set(
      pageId,
      this.capRequests(list.map((r) => (r.requestId === canonicalRequestId ? next : r))),
    );
    if (binding) {
      this.providerBindings.set(key, { ...binding, canonicalRequestId });
    }
    return ok(next);
  }

  // ── 内部 ──

  private candidatesFor(pageId: PageId): CorrelationCandidate[] {
    return (this.requests.get(pageId) ?? []).map((r) => ({
      id: r.requestId,
      url: r.url,
      method: r.method,
      resourceType: r.resourceType,
      startedAt: r.startedAt,
    }));
  }

  /** 反向:webRequest 记录进来时,看能不能配上已登记的 CDP 请求 */
  private findProviderRequestId(record: NetworkRecord): string | null {
    const candidates: CorrelationCandidate[] = [];
    for (const binding of this.providerBindings.values()) {
      if (binding.pageId !== record.pageId) continue;
      if (binding.canonicalRequestId && binding.canonicalRequestId !== record.requestId) continue;
      candidates.push({
        id: binding.providerRequestId,
        url: binding.url,
        method: binding.method,
        resourceType: binding.resourceType,
        startedAt: binding.startedAt,
      });
    }
    const hit = findClosestMatch(candidates, {
      url: record.url,
      method: record.method,
      resourceType: record.resourceType,
      startedAt: record.startedAt,
    });
    if (hit) {
      const key = `${record.pageId}:${hit}`;
      const binding = this.providerBindings.get(key);
      if (binding) {
        this.providerBindings.set(key, { ...binding, canonicalRequestId: record.requestId });
      }
    }
    return hit;
  }

  private emit(event: NetworkEvent): void {
    for (const sub of Array.from(this.subscriptions.values())) {
      if (sub.pageId !== event.pageId) continue;
      // ⭐ 通道故障不受 kinds / frameId / urlIncludes 过滤 —— 见 ALWAYS_DELIVERED 注释
      if (!ALWAYS_DELIVERED.has(event.kind)) {
        if (sub.kinds && !sub.kinds.has(event.kind)) continue;
        if (sub.frameId !== undefined && event.kind !== 'channel-failed' && event.kind !== 'channel-lost') {
          const frameId = 'frameId' in event ? event.frameId : null;
          if (frameId !== sub.frameId) continue;
        }
        if (sub.urlIncludes !== undefined) {
          const url = this.urlForEvent(event);
          if (!url || !url.includes(sub.urlIncludes)) continue;
        }
      }
      try {
        sub.listener(event);
      } catch (err) {
        // 一个坏订阅者不许拖垮分发,但**必须留痕** —— 不静默吞
        console.warn('[web.net] 订阅者抛错', { pageId: event.pageId, kind: event.kind, err });
      }
    }
  }

  private urlForEvent(event: NetworkEvent): string | null {
    if (event.kind === 'request-start') return event.url;
    if (event.kind === 'response-chunk' || event.kind === 'response-complete') {
      return (this.requests.get(event.pageId) ?? [])
        .find((r) => r.requestId === event.requestId)?.url ?? null;
    }
    return null;
  }

  private mintBodyRef(): string {
    bodyRefCounter += 1;
    return `body_${bodyRefCounter.toString(36)}`;
  }

  private storeBody(bodyRef: string, body: Uint8Array): void {
    this.bodiesByRef.set(bodyRef, body);
    // 老化:Map 迭代序即插入序,淘汰最老的
    while (this.bodiesByRef.size > NetworkEventBus.MAX_RESPONSE_BODIES) {
      const oldest = this.bodiesByRef.keys().next().value;
      if (oldest === undefined) break;
      this.bodiesByRef.delete(oldest);
    }
  }

  private capRequests(records: NetworkRecord[]): NetworkRecord[] {
    if (records.length <= NetworkEventBus.MAX_REQUESTS_PER_PAGE) return records;
    return records.slice(-NetworkEventBus.MAX_REQUESTS_PER_PAGE);
  }

  private capProviderBindings(): void {
    while (this.providerBindings.size > NetworkEventBus.MAX_PROVIDER_BINDINGS) {
      const oldest = this.providerBindings.keys().next().value;
      if (oldest === undefined) break;
      this.providerBindings.delete(oldest);
    }
  }
}
