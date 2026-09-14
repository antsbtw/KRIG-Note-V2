/**
 * ⭐⭐ 顺序依赖 —— 旧模型的病根,`web.net` 在结构上消掉的东西
 *
 * ── 这条测试守的是什么 ──
 *
 * 旧模型(X 的 7 个模块各自 `attach → on(message) → ... → detach`,靠
 * `catch { /* 已被 attach,共用即可 *​/ }` 共用)有一个**顺序依赖的洞**:
 *
 * | 上线顺序 | 结果 |
 * |---|---|
 * | B(常驻)先 → A(一次性)后 | A 的 `attached=false`,不 detach,**B 安全** |
 * | **A 先 → B 共用** | A 走时**真的 detach**,B 静默失聪,且 `state.attached` **仍是 true** |
 *
 * ⚠️ 最狠的是最后半句:**B 以为自己还在监听**。它不重连、不告警,只是聋了 ——
 * 表现为「采集突然变 0」。
 *
 * `x-author-profile.ts` 那句注释只防住一半:
 *   「只在**本函数 attach 的**时候才 detach:别人先 attach 的话会把人家的监听掐掉」
 * —— 它防的是「A 掐掉先来的 B」,**没防「A 先来、B 共用、A 走时掐掉 B」**。
 *
 * 这也解释了为什么这个 bug 难复现:日常 notification-watch 通常先开着,
 * 所以大部分时候没事;**只有「先跑一次采集、期间开监听」这个顺序才炸。**
 *
 * ⭐ 而 `web.net` 解的不只是「A 掐 B」,是**顺序依赖本身** ——
 * 业务方压根没有 detach 这个动作,谁先谁后都一样。
 * 这个 bug 在**结构上消失了**,而不是「被小心避开了」。
 */
import { describe, it, expect } from 'vitest';
import { NetworkEventBus, CdpBodyProvider, type DebuggerLike, type PageHost } from '@platform/main/web-capability/net';
import type { NetworkEvent } from '@platform/main/web-capability/net';
import type { PageId } from '@platform/main/web-capability/page';

const PAGE = 'page_x' as PageId;

/**
 * 复刻旧模型下的 debugger 语义(按步 3 真机实测的行为):
 *  - 重复 attach **抛异常**(实测:TypeError: Debugger is already attached to the target)
 *  - `detach()` 是**全局**的,不分谁装的 —— 这正是 A 能掐掉 B 的原因
 */
function realisticDebugger() {
  let attached = false;
  const listeners: Array<{ owner: string; fn: (m: string) => void }> = [];
  return {
    attach() { if (attached) throw new Error('Debugger is already attached to the target'); attached = true; },
    detach() { attached = false; },
    on(owner: string, fn: (m: string) => void) { listeners.push({ owner, fn }); },
    off(owner: string) {
      const i = listeners.findIndex((l) => l.owner === owner);
      if (i >= 0) listeners.splice(i, 1);
    },
    /** 只有还 attach 着才会有载荷 —— 掐掉之后就是「安静地什么都收不到」 */
    emit(m: string) { if (!attached) return; for (const l of listeners) l.fn(m); },
    get isAttached() { return attached; },
  };
}

describe('⭐⭐ 旧模型:顺序一换就静默失聪(这条必须在旧模型下红)', () => {
  it('⭐ 情形 1:B 先 A 后 → B 安全(所以日常大部分时候没事)', () => {
    const dbg = realisticDebugger();

    // B(notification-watch,常驻)先上线
    let bAttached = false;
    try { dbg.attach(); bAttached = true; } catch { /* 已被 attach,共用 */ }
    const b: string[] = [];
    dbg.on('B', (m) => b.push(m));
    dbg.emit('p1');

    // A(author-profile,一次性)后上线 —— attach 抛,走 catch
    let aAttached = false;
    try { dbg.attach(); aAttached = true; } catch { /* 已被别处 attach,共用即可 */ }
    dbg.on('A', () => {});
    dbg.emit('p2');

    // A 结束:aAttached=false,所以**不** detach
    dbg.off('A');
    if (aAttached) dbg.detach();
    dbg.emit('p3');

    expect(bAttached).toBe(true);
    expect(b).toEqual(['p1', 'p2', 'p3']);   // B 全收到
  });

  it('⭐⭐ 情形 2:A 先 B 后 → A 走后 B 收到 **0** 条,且 B 以为自己还在监听', () => {
    const dbg = realisticDebugger();

    // A(一次性采集)先上线
    let aAttached = false;
    try { dbg.attach(); aAttached = true; } catch { /* 共用 */ }
    dbg.on('A', () => {});

    // B(常驻监听)后上线 —— attach 抛,它以为「共用即可」
    let bAttached = false;
    try { dbg.attach(); bAttached = true; } catch { /* 已被 attach,共用 */ }
    const b: string[] = [];
    dbg.on('B', (m) => b.push(m));

    dbg.emit('p1');
    const beforeAExits = b.length;
    expect(beforeAExits).toBe(1);   // B 此时正常

    // A 结束 —— 这次 aAttached=true,它**真的 detach 了**
    dbg.off('A');
    if (aAttached) dbg.detach();

    dbg.emit('p2');
    dbg.emit('p3');

    // ⚠️ 三条断言合起来才是完整的病症
    expect(b.length - beforeAExits, 'A 走后 B 应该一条都收不到(静默失聪)').toBe(0);
    expect(dbg.isAttached, '通道已被 A 掐断').toBe(false);
    expect(bAttached, '⚠️ 而 B 自己的 attached 标志是 false —— 它压根不知道发生了什么').toBe(false);
  });
});

describe('⭐⭐ 新模型(web.net):顺序依赖在结构上消失', () => {
  function fakeHost(hostId: number) {
    const handlers = new Map<string, Array<(...a: unknown[]) => void>>();
    let attached = false;
    const dbg: DebuggerLike = {
      isAttached: () => attached,
      attach: () => {
        if (attached) throw new Error('Debugger is already attached to the target');
        attached = true;
      },
      sendCommand: async () => ({}),
      on: (ev: string, l: (...a: unknown[]) => void) => {
        const list = handlers.get(ev) ?? []; list.push(l); handlers.set(ev, list);
      },
    };
    return {
      host: { hostId, debugger: dbg, onDestroyed: () => {} } as PageHost,
      isAttached: () => attached,
    };
  }

  /** 造一条载荷送到总线(相当于 CDP 收到 loadingFinished 后 provider 贴 body) */
  function deliver(bus: NetworkEventBus, id: string) {
    const ts = new Date().toISOString();
    bus.recordRequestStart({
      requestId: id, pageId: PAGE, url: `https://x.com/i/api/graphql/${id}`,
      method: 'GET', startedAt: ts,
    });
    bus.recordResponseComplete(
      { requestId: id, pageId: PAGE, url: `https://x.com/i/api/graphql/${id}`,
        method: 'GET', status: 200, startedAt: ts, finishedAt: ts },
      new TextEncoder().encode('{"data":1}'),
    );
  }

  it('⭐⭐ 情形 2 的同一场景:A 先 B 后,A 退出后 B **仍收得到**', () => {
    const bus = new NetworkEventBus();
    const provider = new CdpBodyProvider(bus);
    const { host } = fakeHost(1);

    // A(一次性采集)上线:订阅 + 装通道
    const a: NetworkEvent[] = [];
    const unsubA = bus.subscribe(PAGE, {}, (e) => { a.push(e); });
    provider.attach(host, PAGE);

    // B(常驻监听)上线:只订阅。⭐ 它连 attach 都不用调 —— 通道已由底座独占
    const b: NetworkEvent[] = [];
    bus.subscribe(PAGE, {}, (e) => { b.push(e); });

    deliver(bus, 'p1');
    const beforeAExits = b.filter((e) => e.kind === 'response-complete').length;
    expect(beforeAExits).toBe(1);

    // ⭐ A 结束 —— 它能做的**只有退订**,没有 detach 这个动作
    unsubA();

    deliver(bus, 'p2');
    deliver(bus, 'p3');

    const afterAExits = b.filter((e) => e.kind === 'response-complete').length - beforeAExits;
    expect(afterAExits, 'A 退出后 B 必须仍收得到(旧模型这里是 0)').toBe(2);
    // 且 B 没收到任何「通道没了」的信号 —— 因为通道确实还在
    expect(b.some((e) => e.kind === 'channel-lost')).toBe(false);
  });

  it('⭐ 反序(B 先 A 后)结果**完全一样** —— 顺序不再是变量', () => {
    const bus = new NetworkEventBus();
    const provider = new CdpBodyProvider(bus);
    const { host } = fakeHost(1);

    const b: NetworkEvent[] = [];
    bus.subscribe(PAGE, {}, (e) => { b.push(e); });
    provider.attach(host, PAGE);

    const unsubA = bus.subscribe(PAGE, {}, () => {});
    deliver(bus, 'p1');
    const before = b.filter((e) => e.kind === 'response-complete').length;
    unsubA();
    deliver(bus, 'p2');
    deliver(bus, 'p3');

    expect(b.filter((e) => e.kind === 'response-complete').length - before).toBe(2);
  });

  it('⭐ 两个模块都调 attach 也无妨(幂等,不重复装)', () => {
    const bus = new NetworkEventBus();
    const provider = new CdpBodyProvider(bus);
    const { host } = fakeHost(1);
    expect(provider.attach(host, PAGE)).toBe(true);
    expect(provider.attach(host, PAGE)).toBe(true);   // 第二个模块调,不抛也不重复装
    expect(provider.isAttached(1)).toBe(true);
  });

  it('⭐⭐ 业务方拿不到 detach —— 这是「顺序依赖消失」的根本原因', () => {
    const bus = new NetworkEventBus();
    const provider = new CdpBodyProvider(bus);
    // 订阅者手里只有一个退订函数,没有任何关灯能力
    const unsub = bus.subscribe(PAGE, {}, () => {});
    expect(typeof unsub).toBe('function');
    expect((bus as unknown as Record<string, unknown>).detach).toBeUndefined();
    expect((provider as unknown as Record<string, unknown>).detach).toBeUndefined();
  });
});
