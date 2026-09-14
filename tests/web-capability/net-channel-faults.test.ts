/**
 * ⭐⭐ `web.net` 故障注入 —— **本步的命脉**(`07` §3 故障注入清单)
 *
 * 这一层的失败形态**不是抛异常,是静默失聪**:通道没了,订阅者不报错、不重试,
 * 只是安静地再也收不到数据 —— 表现为「采集突然变 0」。
 * 所以本文件测的**不是「能用」,而是「坏掉时会响」**。
 *
 * 三条命脉,一一对应 `07` §2.2 的验收表:
 *  1. A 结束不会掐掉 B(X 现有疑似真 bug,`x/refactor-02` §3.3)
 *  2. attach 失败 → 订阅者收到明确 Failed(V1 只 console.warn 的坑,`04` §2.1)
 *  3. 通道被外部抢占 → 订阅者收到通知
 *
 * ⚠️ 用的是**假 debugger**(不是真 Electron)。这是有意的:
 * 真 CDP 的行为在这一层测不了,那属于 D 类真机验证。
 * 本文件测的是**本层自己的逻辑**:失败发生时,广播链路是否真的把消息送到订阅者。
 * mock 清单见交付报告。
 */
import { describe, it, expect, vi } from 'vitest';
import { NetworkEventBus, CdpBodyProvider, type PageHost, type DebuggerLike } from '@platform/main/web-capability/net';
import type { NetworkEvent } from '@platform/main/web-capability/net';
import type { PageId } from '@platform/main/web-capability/page';

const PAGE_A = 'page_a' as PageId;

/** 可控的假 debugger —— 能造 attach 失败、能造被外部 detach */
function fakeDebugger(opts: { attachThrows?: Error; alreadyAttached?: boolean } = {}) {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const sent: Array<{ method: string; params?: unknown }> = [];
  let attached = opts.alreadyAttached ?? false;

  const dbg: DebuggerLike = {
    isAttached: () => attached,
    attach: () => {
      if (opts.attachThrows) throw opts.attachThrows;
      attached = true;
    },
    sendCommand: async (method, params) => {
      sent.push({ method, params });
      return {};
    },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(listener);
      handlers.set(event, list);
    },
  };

  return {
    dbg,
    sent,
    /** 模拟通道被外部掐掉 */
    fireDetach: (reason = 'target closed') => {
      for (const h of handlers.get('detach') ?? []) h({}, reason);
    },
    fireMessage: (method: string, params: unknown) => {
      for (const h of handlers.get('message') ?? []) h({}, method, params);
    },
  };
}

function fakeHost(hostId: number, dbg: DebuggerLike) {
  const destroyListeners: Array<() => void> = [];
  const host: PageHost = {
    hostId,
    debugger: dbg,
    onDestroyed: (l) => { destroyListeners.push(l); },
  };
  return { host, destroy: () => { for (const l of destroyListeners) l(); } };
}

describe('⭐⭐ 命脉 1 —— A 结束不会掐掉 B(X 现有疑似真 bug)', () => {
  it('⭐ 订阅者 B 常驻期间,A 跑完退出,B 之后仍收到载荷(> 0 条)', () => {
    // 复刻真实场景:notification-watch(B)常驻,期间跑一次 author-profile 采集(A)。
    // 旧模型里 A 结束时 detach 会把 B 一起掐掉,B 静默失聪。
    const bus = new NetworkEventBus();

    const bReceived: NetworkEvent[] = [];
    const unsubB = bus.subscribe(PAGE_A, {}, (e) => { bReceived.push(e); });

    // A 上线、收了一条、然后退出(**取消订阅**,这是业务方唯一能做的「结束」动作)
    const aReceived: NetworkEvent[] = [];
    const unsubA = bus.subscribe(PAGE_A, {}, (e) => { aReceived.push(e); });
    bus.recordRequestStart({
      requestId: 'r1', pageId: PAGE_A, url: 'https://x.com/api/1',
      method: 'GET', startedAt: new Date().toISOString(),
    });
    expect(aReceived.length).toBeGreaterThan(0);
    unsubA();   // ← A 结束

    // ⭐ A 走后再来载荷,B 必须仍然收得到
    const beforeCount = bReceived.length;
    bus.recordRequestStart({
      requestId: 'r2', pageId: PAGE_A, url: 'https://x.com/api/2',
      method: 'GET', startedAt: new Date().toISOString(),
    });
    bus.recordResponseComplete({
      requestId: 'r2', pageId: PAGE_A, url: 'https://x.com/api/2',
      method: 'GET', status: 200, startedAt: new Date().toISOString(),
    }, new TextEncoder().encode('{"ok":true}'));

    const afterA = bReceived.length - beforeCount;
    expect(afterA).toBeGreaterThan(0);
    expect(bReceived.some((e) => e.kind === 'response-complete')).toBe(true);
    // 且 B 没收到任何「通道没了」的信号 —— 因为通道确实没被掐
    expect(bReceived.some((e) => e.kind === 'channel-lost')).toBe(false);
    unsubB();
  });

  it('⭐ 接口层面就没有 detach —— 业务方拿不到「关灯」这个动作', () => {
    // 这是「A 掐掉 B」不可能发生的**根本原因**:不是约定,是能力上就没有。
    const bus = new NetworkEventBus();
    expect((bus as unknown as Record<string, unknown>).detach).toBeUndefined();
    expect((bus as unknown as Record<string, unknown>).attach).toBeUndefined();

    const provider = new CdpBodyProvider(bus);
    expect((provider as unknown as Record<string, unknown>).detach).toBeUndefined();
    expect((provider as unknown as Record<string, unknown>).release).toBeUndefined();
  });

  it('⭐ 同一宿主重复 attach 是幂等的,不会装两次(单一持有者)', () => {
    const bus = new NetworkEventBus();
    const provider = new CdpBodyProvider(bus);
    const { dbg, sent } = fakeDebugger();
    const { host } = fakeHost(1, dbg);

    expect(provider.attach(host, PAGE_A)).toBe(true);
    expect(provider.attach(host, PAGE_A)).toBe(true);
    expect(provider.attach(host, PAGE_A)).toBe(true);

    // Network.enable 只该发一次
    expect(sent.filter((s) => s.method === 'Network.enable')).toHaveLength(1);
  });

  it('别人(如 devtools)已经 attach 时复用,不重复 attach', () => {
    const bus = new NetworkEventBus();
    const provider = new CdpBodyProvider(bus);
    const { dbg } = fakeDebugger({ alreadyAttached: true });
    const attachSpy = vi.spyOn(dbg, 'attach');
    const { host } = fakeHost(1, dbg);

    expect(provider.attach(host, PAGE_A)).toBe(true);
    expect(attachSpy).not.toHaveBeenCalled();
  });
});

describe('⭐⭐ 命脉 2 —— attach 失败时订阅者收到明确 Failed', () => {
  it('⭐ attach 抛错 → 订阅者收到 channel-failed,不是静默等', () => {
    // V1 在这里只 console.warn 就 return,订阅者会安静等一个永不来的载荷(`04` §2.1)。
    const bus = new NetworkEventBus();
    const provider = new CdpBodyProvider(bus);
    const received: NetworkEvent[] = [];
    bus.subscribe(PAGE_A, {}, (e) => { received.push(e); });

    const { dbg } = fakeDebugger({ attachThrows: new Error('Another debugger is already attached') });
    const { host } = fakeHost(1, dbg);

    const okAttach = provider.attach(host, PAGE_A);
    expect(okAttach).toBe(false);

    const failure = received.find((e) => e.kind === 'channel-failed');
    expect(failure).toBeDefined();
    if (failure?.kind !== 'channel-failed') throw new Error('unreachable');
    expect(failure.reason).toContain('attach 失败');
    expect(failure.reason).toContain('Another debugger is already attached');
    expect(failure.retryable).toBe(true);
  });

  it('⭐ attach 失败后该宿主不算已装(可以再试)', () => {
    const bus = new NetworkEventBus();
    const provider = new CdpBodyProvider(bus);
    const { dbg } = fakeDebugger({ attachThrows: new Error('boom') });
    const { host } = fakeHost(1, dbg);
    provider.attach(host, PAGE_A);
    expect(provider.isAttached(1)).toBe(false);
  });

  it('⭐ Network.enable 失败也要响(装上了但收不到载荷,等价于失聪)', async () => {
    const bus = new NetworkEventBus();
    const provider = new CdpBodyProvider(bus);
    const received: NetworkEvent[] = [];
    bus.subscribe(PAGE_A, {}, (e) => { received.push(e); });

    const { dbg } = fakeDebugger();
    vi.spyOn(dbg, 'sendCommand').mockRejectedValue(new Error('domain unavailable'));
    const { host } = fakeHost(1, dbg);
    provider.attach(host, PAGE_A);

    await Promise.resolve();
    await Promise.resolve();

    const failure = received.find((e) => e.kind === 'channel-failed');
    expect(failure).toBeDefined();
    if (failure?.kind !== 'channel-failed') throw new Error('unreachable');
    expect(failure.reason).toContain('Network.enable 失败');
  });

  it('⭐ channel-failed 不受 kinds 过滤 —— 只订 response-complete 的人也必须收到', () => {
    // 若让告警被 kinds 过滤掉,等于**把失聪告警本身也静默了**,这个机制就白做了。
    const bus = new NetworkEventBus();
    const provider = new CdpBodyProvider(bus);
    const received: NetworkEvent[] = [];
    bus.subscribe(PAGE_A, { kinds: ['response-complete'] }, (e) => { received.push(e); });

    const { dbg } = fakeDebugger({ attachThrows: new Error('boom') });
    const { host } = fakeHost(1, dbg);
    provider.attach(host, PAGE_A);

    expect(received.some((e) => e.kind === 'channel-failed')).toBe(true);
  });

  it('⭐ channel-failed 也不受 urlIncludes 过滤', () => {
    const bus = new NetworkEventBus();
    const provider = new CdpBodyProvider(bus);
    const received: NetworkEvent[] = [];
    bus.subscribe(PAGE_A, { urlIncludes: '/api/tweets' }, (e) => { received.push(e); });

    const { dbg } = fakeDebugger({ attachThrows: new Error('boom') });
    const { host } = fakeHost(1, dbg);
    provider.attach(host, PAGE_A);

    expect(received.some((e) => e.kind === 'channel-failed')).toBe(true);
  });

  it('⭐ waitFor 在 attach 失败时立刻返回 Failed,不干等到超时', async () => {
    const bus = new NetworkEventBus();
    const provider = new CdpBodyProvider(bus);
    // 给一个很长的超时 —— 如果没有 channel-failed 打断,这条会挂 30 秒
    const pending = bus.waitFor(PAGE_A, { urlIncludes: '/api/x' }, 30_000);

    const { dbg } = fakeDebugger({ attachThrows: new Error('boom') });
    const { host } = fakeHost(1, dbg);
    provider.attach(host, PAGE_A);

    const result = await pending;
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('unreachable');
    expect(result.reason).toContain('等不到载荷');
  });
});

describe('⭐⭐ 命脉 3 —— 通道被外部抢占时会响', () => {
  it('⭐ 外部 detach → 订阅者收到 channel-lost', () => {
    const bus = new NetworkEventBus();
    const provider = new CdpBodyProvider(bus);
    const received: NetworkEvent[] = [];
    bus.subscribe(PAGE_A, {}, (e) => { received.push(e); });

    const { dbg, fireDetach } = fakeDebugger();
    const { host } = fakeHost(1, dbg);
    provider.attach(host, PAGE_A);

    fireDetach('target closed');

    const lost = received.find((e) => e.kind === 'channel-lost');
    expect(lost).toBeDefined();
    if (lost?.kind !== 'channel-lost') throw new Error('unreachable');
    expect(lost.reason).toContain('外部 detach');
    expect(lost.reason).toContain('target closed');
  });

  it('⭐ 被抢占后该宿主不算已装 —— 允许重新装(而不是永远聋着)', () => {
    const bus = new NetworkEventBus();
    const provider = new CdpBodyProvider(bus);
    const { dbg, fireDetach } = fakeDebugger();
    const { host } = fakeHost(1, dbg);
    provider.attach(host, PAGE_A);
    expect(provider.isAttached(1)).toBe(true);

    fireDetach();
    expect(provider.isAttached(1)).toBe(false);
  });

  it('⭐ 页面销毁 → 订阅者收到 channel-lost(唯一的正常清理时机)', () => {
    const bus = new NetworkEventBus();
    const provider = new CdpBodyProvider(bus);
    const received: NetworkEvent[] = [];
    bus.subscribe(PAGE_A, {}, (e) => { received.push(e); });

    const { dbg } = fakeDebugger();
    const { host, destroy } = fakeHost(1, dbg);
    provider.attach(host, PAGE_A);

    destroy();

    const lost = received.find((e) => e.kind === 'channel-lost');
    expect(lost).toBeDefined();
    if (lost?.kind !== 'channel-lost') throw new Error('unreachable');
    expect(lost.reason).toContain('页面已销毁');
  });

  it('⭐ waitFor 在通道失去时立刻返回 Failed(retryable)', async () => {
    const bus = new NetworkEventBus();
    const provider = new CdpBodyProvider(bus);
    const pending = bus.waitFor(PAGE_A, { urlIncludes: '/api/x' }, 30_000);

    const { dbg, fireDetach } = fakeDebugger();
    const { host } = fakeHost(1, dbg);
    provider.attach(host, PAGE_A);
    fireDetach();

    const result = await pending;
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('unreachable');
    expect(result.reason).toContain('通道已失去');
    expect(result.retryable).toBe(true);
  });

  it('通道故障只送给该页面的订阅者,不惊动别的页面', () => {
    const bus = new NetworkEventBus();
    const provider = new CdpBodyProvider(bus);
    const other = 'page_b' as PageId;
    const aEvents: NetworkEvent[] = [];
    const bEvents: NetworkEvent[] = [];
    bus.subscribe(PAGE_A, {}, (e) => { aEvents.push(e); });
    bus.subscribe(other, {}, (e) => { bEvents.push(e); });

    const { dbg, fireDetach } = fakeDebugger();
    const { host } = fakeHost(1, dbg);
    provider.attach(host, PAGE_A);
    fireDetach();

    expect(aEvents.some((e) => e.kind === 'channel-lost')).toBe(true);
    expect(bEvents).toHaveLength(0);
  });
});
