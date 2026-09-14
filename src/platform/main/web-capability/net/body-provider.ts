/**
 * CDP body provider —— ⭐ **单一持有者模型**(`04` §2,已否决引用计数)
 *
 * ── 这个文件是本步的命脉,先读懂要治的病 ──
 *
 * 现状(`x/refactor-02` §3.3):X 有 8 处各自 `attach → on(message) → ... → detach`,
 * 靠一句注释级约定共用:`catch { /* 已被 attach,共用即可 *​/ }`。
 *
 * **漏洞**:「共用」的前提是先 attach 的那位还没走。
 * 先 attach 的 A 结束时会 `detach()`,**把正在共用的 B 一起掐掉**。
 * B 的 `attached=false`,它不重连、不报错,**只是安静地再也收不到任何载荷**。
 *
 * ── 本层的解法 ──
 *
 * | | 引用计数(已否决) | 单一持有者(本实现) |
 * |---|---|---|
 * | 「最后一个走关灯」时刻 | 存在 → 可能关错 | **不存在** |
 * | 业务方碰不碰 debugger | 碰 | **完全不碰,只 subscribe** |
 * | 被外部抢占 | 要额外检测 | `on('detach')` 天然收到 |
 *
 * ⭐ 关键:**provider 装上就不 detach**,业务方只 `subscribe`。
 * 「最后一个人关灯」这个时刻根本不存在 —— 也就无从关错灯。
 * 本文件**没有导出任何 detach 方法**,这是机器强制而非约定。
 *
 * ⚠️ 另补 V1 缺的一条(`04` §2.1):attach 失败时 V1 只 `console.warn` 就 return,
 * 订阅者收不到任何通知。本实现必须 `bus.channelFailed(...)` 广播出去。
 */

import type { PageId } from '../page/types';
import type { NetworkEventBus } from './bus';
import type { CapturePolicy } from './types';
import { normalizeResourceType } from './correlate';

/**
 * debugger 的最小接口 —— 只声明本层真正用到的方法。
 *
 * 这样做有两个好处:
 *  1. 本文件零 `import electron`,可完全单测(用假 debugger)
 *  2. **接口上没有 detach** —— 上层拿到的东西根本没有关灯的能力
 */
export interface DebuggerLike {
  isAttached(): boolean;
  attach(version: string): void;
  sendCommand(method: string, params?: unknown): Promise<unknown>;
  on(event: 'detach', listener: (...args: unknown[]) => void): void;
  on(event: 'message', listener: (...args: unknown[]) => void): void;
}

/** 一个可被 attach 的页面宿主(真实实现里是 WebContents,测试里是假的) */
export interface PageHost {
  /** 宿主的稳定标识 —— 用于「每个宿主只装一次」的去重 */
  readonly hostId: number;
  readonly debugger: DebuggerLike;
  /** 页面销毁时回调 —— **唯一**的清理时机 */
  onDestroyed(listener: () => void): void;
}

const DEFAULT_RESOURCE_TYPES: readonly string[] = ['fetch', 'document'];

/**
 * 该不该抓这条请求的 body。
 *
 * ⭐ **噪音名单由调用方给,底座一条都不内置**(`04` §3.1)。
 * V1 在 `session-capture.ts:31` 硬编码了 `s-cdn.anthropic.com/images/` ——
 * 那是 Claude 的站点适配漏进了底层,本层不重蹈。
 */
export function shouldCaptureBody(
  input: { url: string; resourceType?: string },
  policy: CapturePolicy = {},
): boolean {
  if (!input.url.startsWith('http://') && !input.url.startsWith('https://')) return false;
  for (const noisy of policy.noisyUrlSubstrings ?? []) {
    if (input.url.includes(noisy)) return false;
  }
  const allowed = policy.resourceTypes ?? DEFAULT_RESOURCE_TYPES;
  const type = normalizeResourceType(input.resourceType);
  if (!type) return false;
  return allowed.includes(type);
}

type PendingRequest = {
  url: string;
  method: string;
  resourceType?: string;
  status?: number;
  mimeType?: string;
  responseHeaders?: Record<string, string>;
};

/**
 * 单一持有者的 CDP body provider。
 *
 * 注意它**没有 detach / release / dispose** —— 这是有意的。
 * 通道只在**页面销毁**时随宿主一起消失(`onDestroyed`)。
 */
export class CdpBodyProvider {
  readonly providerId = 'cdp';
  /** 已经装过的宿主 —— 每个宿主只装一次(V1 字面) */
  private readonly attachedHosts = new Set<number>();

  constructor(private readonly bus: NetworkEventBus) {}

  isAttached(hostId: number): boolean {
    return this.attachedHosts.has(hostId);
  }

  /**
   * 给一个页面装通道。重复调用是幂等的(第二次直接返回)。
   *
   * @returns true = 通道可用;false = 装不上(订阅者已收到 `channel-failed`)
   */
  attach(host: PageHost, pageId: PageId, policy: CapturePolicy = {}): boolean {
    if (this.attachedHosts.has(host.hostId)) return true;

    const dbg = host.debugger;
    try {
      // 别人(比如 Electron devtools)已经装了就复用,不重复 attach
      if (!dbg.isAttached()) {
        dbg.attach('1.3');
      }
    } catch (error) {
      // ⭐⭐ V1 在这里只 console.warn 就 return —— 订阅者会安静等一个永不来的载荷。
      // 本实现必须广播出去,让订阅者**立刻知道自己等不到了**。
      this.bus.channelFailed(
        pageId,
        `CDP attach 失败: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
      return false;
    }

    this.attachedHosts.add(host.hostId);

    void Promise.resolve(dbg.sendCommand('Network.enable')).catch((error: unknown) => {
      // 装上了但开不了 Network 域 = 一样收不到载荷,同样必须响
      this.bus.channelFailed(
        pageId,
        `Network.enable 失败: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    });

    const pending = new Map<string, PendingRequest>();

    dbg.on('message', (...args: unknown[]) => {
      // Electron 的签名是 (event, method, params)
      const method = args[1] as string;
      const params = args[2] as Record<string, unknown> | undefined;
      this.handleMessage(pageId, dbg, pending, method, params, policy);
    });

    // ⭐ 被外部抢占 → 订阅者必须知道(V1 有这个监听,但不通知订阅者)
    dbg.on('detach', (...args: unknown[]) => {
      this.attachedHosts.delete(host.hostId);
      const reason = args[1] !== undefined ? String(args[1]) : '未知原因';
      this.bus.channelLost(pageId, `CDP 通道被外部 detach: ${reason}`);
    });

    // 唯一的清理时机:页面销毁
    host.onDestroyed(() => {
      this.attachedHosts.delete(host.hostId);
      this.bus.channelLost(pageId, '页面已销毁');
    });

    return true;
  }

  private handleMessage(
    pageId: PageId,
    dbg: DebuggerLike,
    pending: Map<string, PendingRequest>,
    method: string,
    params: Record<string, unknown> | undefined,
    policy: CapturePolicy,
  ): void {
    if (!params) return;

    if (method === 'Network.requestWillBeSent') {
      const request = params.request as Record<string, unknown> | undefined;
      const url = typeof request?.url === 'string' ? request.url : '';
      if (!url) return;
      const providerRequestId = String(params.requestId);
      const httpMethod = String(request?.method ?? 'GET').toUpperCase();
      const resourceType = typeof params.type === 'string' ? params.type.toLowerCase() : undefined;
      pending.set(providerRequestId, { url, method: httpMethod, resourceType });
      this.bus.bindProviderRequest(pageId, providerRequestId, {
        url,
        method: httpMethod,
        resourceType,
        startedAt: new Date().toISOString(),
      });
      return;
    }

    if (method === 'Network.responseReceived') {
      const providerRequestId = String(params.requestId ?? '');
      const existing = pending.get(providerRequestId);
      if (!existing) return;
      const response = params.response as Record<string, unknown> | undefined;
      pending.set(providerRequestId, {
        ...existing,
        status: typeof response?.status === 'number' ? response.status : undefined,
        mimeType: typeof response?.mimeType === 'string' ? response.mimeType : undefined,
        responseHeaders: toHeaderMap(response?.headers),
      });
      return;
    }

    if (method === 'Network.loadingFinished') {
      const providerRequestId = String(params.requestId ?? '');
      const existing = pending.get(providerRequestId);
      if (!existing) return;
      pending.delete(providerRequestId);
      if (!shouldCaptureBody(existing, policy)) return;

      void this.fetchAndAttachBody(pageId, dbg, providerRequestId, existing, policy);
      return;
    }
  }

  private async fetchAndAttachBody(
    pageId: PageId,
    dbg: DebuggerLike,
    providerRequestId: string,
    pending: PendingRequest,
    policy: CapturePolicy,
  ): Promise<void> {
    let raw: { body?: string; base64Encoded?: boolean };
    try {
      raw = (await dbg.sendCommand('Network.getResponseBody', {
        requestId: providerRequestId,
      })) as { body?: string; base64Encoded?: boolean };
    } catch (error) {
      // 单条取不到 body 不是通道故障(通道还活着),所以不发 channel-lost;
      // 但也**不静默** —— 留痕,将来接 web.trace 时改成 degradation 记录。
      console.warn('[web.net] getResponseBody 失败', {
        pageId, providerRequestId, url: pending.url, error,
      });
      return;
    }

    const body = decodeBody(raw);
    if (!body) return;
    if (policy.maxBodyBytes !== undefined && body.byteLength > policy.maxBodyBytes) return;

    const result = this.bus.attachProviderBody(pageId, providerRequestId, {
      url: pending.url,
      method: pending.method,
      resourceType: pending.resourceType,
      mimeType: pending.mimeType,
      responseHeaders: pending.responseHeaders,
      body,
    });
    if (result.status === 'failed') {
      // ⚠️ 关联失败**不静默丢**(prompt §7)。这条留痕将来进 web.trace 的 degradation。
      console.warn('[web.net] body 关联失败', { pageId, providerRequestId, reason: result.reason });
    }
  }
}

export function decodeBody(raw: { body?: string; base64Encoded?: boolean }): Uint8Array | null {
  if (typeof raw.body !== 'string') return null;
  if (raw.base64Encoded) return new Uint8Array(Buffer.from(raw.body, 'base64'));
  return new TextEncoder().encode(raw.body);
}

function toHeaderMap(headers: unknown): Record<string, string> | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    if (typeof v === 'string') out[k.toLowerCase()] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
