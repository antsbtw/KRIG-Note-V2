/**
 * ⭐⭐ 接缝测试 —— 步 2 的**真实总线** → 本步探针
 *
 * 前两个文件分别测记录器和探针的**单元**行为(喂假事实)。
 * 本文件不喂假事实,而是**接真的 `NetworkEventBus`**,验证整条链路:
 *
 *   真事件(response-complete / channel-failed / channel-lost)
 *     → NetMonitor.observe()
 *       → HealthProbe.net()
 *         → alive / problems
 *
 * ⚠️ 这才是步 3 验收真正依赖的东西:步 3 换掉 AI 的取数层后,
 * 「还能不能收到载荷」要靠这条链路回答,而不是靠人点几下。
 *
 * ⭐ 特别验证步 2 那个设计决定在这里兑现:
 * `channel-failed` / `channel-lost` **不受 kinds 过滤**,所以 NetMonitor
 * 即使只关心载荷,也一定收得到故障 —— 否则失聪告警自己就被静默了。
 */
import { describe, it, expect } from 'vitest';
import { NetworkEventBus, CdpBodyProvider, type PageHost, type DebuggerLike } from '@platform/main/web-capability/net';
import { NetMonitor, HealthProbe, TraceRecorder } from '@platform/main/web-capability/trace';
import type { PageId } from '@platform/main/web-capability/page';

const PAGE = 'page_seam' as PageId;

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; }, at: () => now };
}

function fakeDebugger(opts: { attachThrows?: Error } = {}) {
  const handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  let attached = false;
  const dbg: DebuggerLike = {
    isAttached: () => attached,
    attach: () => { if (opts.attachThrows) throw opts.attachThrows; attached = true; },
    sendCommand: async () => ({}),
    on: (event: string, l: (...a: unknown[]) => void) => {
      const list = handlers.get(event) ?? []; list.push(l); handlers.set(event, list);
    },
  };
  return {
    dbg,
    fireDetach: (reason = 'target closed') => { for (const h of handlers.get('detach') ?? []) h({}, reason); },
  };
}

function fakeHost(hostId: number, dbg: DebuggerLike) {
  const listeners: Array<() => void> = [];
  return {
    host: { hostId, debugger: dbg, onDestroyed: (l: () => void) => { listeners.push(l); } } as PageHost,
    destroy: () => { for (const l of listeners) l(); },
  };
}

/** 造一条「捕获到载荷」的完整事件 */
function captureOne(bus: NetworkEventBus, at: number, id: string) {
  const ts = new Date(at).toISOString();
  bus.recordRequestStart({
    requestId: id, pageId: PAGE, url: `https://x.com/api/${id}`,
    method: 'GET', startedAt: ts,
  });
  bus.recordResponseComplete(
    { requestId: id, pageId: PAGE, url: `https://x.com/api/${id}`, method: 'GET', status: 200, startedAt: ts, finishedAt: ts },
    new TextEncoder().encode('{"ok":1}'),
  );
}

describe('⭐⭐ 接缝 1 —— 通道哑了,探针自己举手(端到端)', () => {
  it('⭐⭐ 有订阅者 + 5 分钟没载荷 → health 报不健康', () => {
    const c = clock();
    const bus = new NetworkEventBus(c.now);
    const monitor = new NetMonitor({ now: c.now });
    const probe = new HealthProbe({ now: c.now });

    // 一个常驻订阅者(模拟 notification-watch)
    bus.subscribe(PAGE, {}, (e) => { monitor.observe(e); });

    // 一开始好好的:捕获了 3 条
    captureOne(bus, c.at(), 'r1');
    captureOne(bus, c.at(), 'r2');
    captureOne(bus, c.at(), 'r3');

    let report = probe.net(monitor.facts({ sessions: 1, subscribers: bus.subscriberCount(PAGE) }));
    expect(report.alive).toBe(true);
    expect(report.metrics.capturesInWindow).toBe(3);

    // ⭐ 通道悄悄哑了(什么都不做,就是不再来载荷)—— 时间往前走 6 分钟
    c.advance(6 * 60 * 1000);

    report = probe.net(monitor.facts({ sessions: 1, subscribers: bus.subscriberCount(PAGE) }));
    expect(report.alive).toBe(false);
    expect(report.metrics.capturesInWindow).toBe(0);
    expect(report.metrics.subscribers).toBe(1);
    expect(report.problems[0]).toContain('通道疑似哑了');
  });

  it('⭐ 订阅者走光后不再报警(没人听,零捕获是正常的)', () => {
    const c = clock();
    const bus = new NetworkEventBus(c.now);
    const monitor = new NetMonitor({ now: c.now });
    const probe = new HealthProbe({ now: c.now });

    const un = bus.subscribe(PAGE, {}, (e) => { monitor.observe(e); });
    captureOne(bus, c.at(), 'r1');
    c.advance(6 * 60 * 1000);
    expect(probe.net(monitor.facts({ sessions: 1, subscribers: bus.subscriberCount(PAGE) })).alive).toBe(false);

    un();
    expect(probe.net(monitor.facts({ sessions: 1, subscribers: bus.subscriberCount(PAGE) })).alive).toBe(true);
  });

  it('⭐ 「有响应但拿不到 body」不算捕获 —— 这正是通道半哑的形态', () => {
    const c = clock();
    const bus = new NetworkEventBus(c.now);
    const monitor = new NetMonitor({ now: c.now });
    const probe = new HealthProbe({ now: c.now });
    bus.subscribe(PAGE, {}, (e) => { monitor.observe(e); });

    // 能看到请求完成,但**没有 bodyRef**(CDP 那半边死了)
    // ⚠️ 全部发生在**窗口内**(不推进时间)—— 这样测的才是「没 body 不算捕获」
    // 这一条本身,而不是被时间窗顺带遮掉。
    const ts = new Date(c.at()).toISOString();
    for (let i = 0; i < 20; i++) {
      bus.recordResponseComplete({
        requestId: `r${i}`, pageId: PAGE, url: 'https://x.com/api/x',
        method: 'GET', status: 200, startedAt: ts, finishedAt: ts,
      });   // ← 不给 body
    }

    const report = probe.net(monitor.facts({ sessions: 1, subscribers: 1 }));
    expect(report.metrics.capturesInWindow).toBe(0);
    expect(report.alive).toBe(false);
  });
});

describe('⭐⭐ 接缝 2 —— 步 2 的通道故障能被探针看见', () => {
  it('⭐ attach 失败 → 探针不健康 + degradation 留痕(系统级)', () => {
    const c = clock();
    const bus = new NetworkEventBus(c.now);
    const recorder = new TraceRecorder({ now: c.now });
    const monitor = new NetMonitor({ now: c.now, recorder });
    const probe = new HealthProbe({ now: c.now });

    bus.subscribe(PAGE, {}, (e) => { monitor.observe(e); });

    const provider = new CdpBodyProvider(bus);
    const { dbg } = fakeDebugger({ attachThrows: new Error('Another debugger is already attached') });
    const { host } = fakeHost(1, dbg);
    provider.attach(host, PAGE);

    const report = probe.net(monitor.facts({ sessions: 1, subscribers: 1 }));
    expect(report.alive).toBe(false);
    expect(report.problems.some((p) => p.includes('通道故障'))).toBe(true);

    // ⭐ 同时进了 degradation,category = 系统级(`05` §3.3 映射表)
    const degs = recorder.listDegradations({ category: 'systemic' });
    expect(degs).toHaveLength(1);
    expect(degs[0].layer).toBe('web.net');
    expect(degs[0].reason).toContain('attach 失败');
  });

  it('⭐ 外部 detach → 探针不健康 + 留痕', () => {
    const c = clock();
    const bus = new NetworkEventBus(c.now);
    const recorder = new TraceRecorder({ now: c.now });
    const monitor = new NetMonitor({ now: c.now, recorder });
    const probe = new HealthProbe({ now: c.now });
    bus.subscribe(PAGE, {}, (e) => { monitor.observe(e); });

    const provider = new CdpBodyProvider(bus);
    const { dbg, fireDetach } = fakeDebugger();
    const { host } = fakeHost(1, dbg);
    provider.attach(host, PAGE);
    fireDetach('target closed');

    const report = probe.net(monitor.facts({ sessions: 1, subscribers: 1 }));
    expect(report.alive).toBe(false);
    expect(report.problems.some((p) => p.includes('target closed'))).toBe(true);
    expect(recorder.listDegradations({ category: 'systemic' })).toHaveLength(1);
  });

  it('⭐⭐ 只订 response-complete 的 monitor 也收得到故障(步 2 的不过滤决定在此兑现)', () => {
    // 若 channel-failed 被 kinds 过滤掉,失聪告警自己就被静默了 —— 这层就白做了
    const c = clock();
    const bus = new NetworkEventBus(c.now);
    const monitor = new NetMonitor({ now: c.now });
    const probe = new HealthProbe({ now: c.now });

    bus.subscribe(PAGE, { kinds: ['response-complete'] }, (e) => { monitor.observe(e); });

    const provider = new CdpBodyProvider(bus);
    const { dbg } = fakeDebugger({ attachThrows: new Error('boom') });
    const { host } = fakeHost(1, dbg);
    provider.attach(host, PAGE);

    expect(probe.net(monitor.facts({ sessions: 1, subscribers: 1 })).alive).toBe(false);
  });

  it('页面销毁也算通道失去,被探针看见', () => {
    const c = clock();
    const bus = new NetworkEventBus(c.now);
    const monitor = new NetMonitor({ now: c.now });
    const probe = new HealthProbe({ now: c.now });
    bus.subscribe(PAGE, {}, (e) => { monitor.observe(e); });

    const provider = new CdpBodyProvider(bus);
    const { dbg } = fakeDebugger();
    const { host, destroy } = fakeHost(1, dbg);
    provider.attach(host, PAGE);
    destroy();

    expect(probe.net(monitor.facts({ sessions: 1, subscribers: 1 })).alive).toBe(false);
  });
});

describe('⭐ 接缝 3 —— 自愈后要能恢复健康,且留痕', () => {
  it('⭐ 重新 attach 成功 → 清故障计数 + 记 recovery,探针转健康', () => {
    const c = clock();
    const bus = new NetworkEventBus(c.now);
    const recorder = new TraceRecorder({ now: c.now });
    const monitor = new NetMonitor({ now: c.now, recorder });
    const probe = new HealthProbe({ now: c.now });
    bus.subscribe(PAGE, {}, (e) => { monitor.observe(e); });

    const provider = new CdpBodyProvider(bus);
    const { dbg, fireDetach } = fakeDebugger();
    const { host } = fakeHost(1, dbg);
    provider.attach(host, PAGE);
    fireDetach();
    expect(probe.net(monitor.facts({ sessions: 1, subscribers: 1 })).alive).toBe(false);

    // 自愈:重新装上 + 恢复捕获
    provider.attach(host, PAGE);
    captureOne(bus, c.at(), 'r-after');
    monitor.resetChannelFailures();
    // ⭐ 必须留痕,否则就是静默自愈
    recorder.recovery({ layer: 'web.net', what: 'CDP 被 detach 后重新 attach', outcome: 'recovered' });

    const report = probe.net(monitor.facts({ sessions: 1, subscribers: 1 }));
    expect(report.alive).toBe(true);
    expect(recorder.listRecoveries()).toHaveLength(1);
    // 故障本身的记录**仍然留着** —— 自愈不擦除历史
    expect(recorder.listDegradations({ category: 'systemic' })).toHaveLength(1);
  });
});
