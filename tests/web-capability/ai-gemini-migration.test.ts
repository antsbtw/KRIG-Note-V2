/**
 * ⭐⭐ 步 3 迁移证据 —— Gemini 载荷**经 `web.net` 到达**,不是旧路径兜底
 *
 * ── 为什么必须有这个文件(addendum §3)──
 *
 * A 方案的风险是:**壳子还在、内部换了,从外面看不出来**。
 * 万一 `web.net` 没真正接上、旧 CDP 路径悄悄兜底,`tests/ai/` 那 120 条**照样全绿**
 * (它们测的是「载荷 → 结构化」,而本步换的是「载荷怎么拿到」)。
 *
 * 所以本文件的每条断言都要能回答:**「如果没接上,这条还会成立吗?」**
 * —— 这是步 2.5 的教训(那次「零捕获」是被测试自己布置的时间窗顺带遮出来的)。
 *
 * ⚠️ 用假 debugger,不是真 Electron。但 §2 已用**真 Electron 40.6.0** 实测确认
 * 假 debugger 模拟的四条行为(attach 失败抛异常 / 抛 Error 子类 /
 * detach 回调 args[1] 是 reason / isAttached 反映真实状态)与真实一致。
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NetworkEventBus, CdpBodyProvider, type DebuggerLike, type PageHost } from '@platform/main/web-capability/net';
import { PageRegistry } from '@platform/main/web-capability/page';
import { NetMonitor, HealthProbe } from '@platform/main/web-capability/trace';
import type { NetworkEvent } from '@platform/main/web-capability/net';

const SRC = join(process.cwd(), 'src/platform/main/ai/interceptor.ts');
const code = readFileSync(SRC, 'utf-8');
const codeNoComments = code
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

describe('⭐⭐ 新链路真的接上了(不是形式上接了)', () => {
  it('⭐ startGeminiCDP 里调的是 web.net,不是自己 attach', () => {
    // 取出 startGeminiCDP 的函数体(到 readPartition 为止)
    const start = codeNoComments.indexOf('private startGeminiCDP(');
    const end = codeNoComments.indexOf('private readPartition(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = codeNoComments.slice(start, end);

    // ⭐ 必须走 web.net
    expect(body).toMatch(/netBus\.subscribe\(/);
    expect(body).toMatch(/bodyProvider\.attach\(/);
    // ⭐ 且**不许**自己碰 debugger —— 如果没接上而是旧写法,这条会红
    expect(body).not.toMatch(/debugger\.attach/);
    expect(body).not.toMatch(/debugger\.on\(/);
    expect(body).not.toMatch(/getResponseBody/);
  });

  it('⭐⭐ stop() 不再 detach —— 业务方没有关灯这个动作', () => {
    // 这是 `04` §2 要治的病:旧写法业务方持有 detach,X 那 8 处因此
    // 踩了「A 结束时把共用的 B 一起掐掉」。
    const start = codeNoComments.indexOf('stop(): void {');
    const end = codeNoComments.indexOf('getAllGeminiResponses(');
    const body = codeNoComments.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(body).not.toMatch(/debugger\.detach/);
    expect(body).toMatch(/unsubscribeNet/);
  });

  it('⭐⭐ 旧 CDP 实现已**删除**(2026-09-30 —— 从「保留对照」升级为「不留平行实现」)', () => {
    /**
     * ⚠️ 本条的规则变了,连同断言一起改 —— **不是放宽,是收紧**。
     *
     * 原规则(`08` §1.2):旧实现保留但零调用,"为了出问题能对照"。
     * 当时合理:迁移刚做完,新路径还没被真机验证过。
     *
     * 新规则(用户 2026-09-30 定的「一层算完成」硬规矩之二):
     * **旧实现当场删或降级为带守卫的死代码;留着两份平行实现 = 下次有人改错那份。**
     * 新路径已服役数月(`netBus` / `bodyProvider`),对照的价值没了,
     * 而"还有一份看起来能用的旧实现"的风险还在 —— git 历史才是对照的正确位置。
     *
     * ⭐ 同批退役的还有 `web-service-base` 的三个零消费者原语
     * (`locateSendButton` / `feedFilesToInput` / `feedVideoToInput`)。
     */
    expect(
      codeNoComments,
      '旧 CDP 实现又回来了 —— 对照请查 git 历史,不要在仓里留第二份能跑的实现',
    ).not.toMatch(/startGeminiCDPLegacy/);
  });

  it('⭐⭐ 删旧实现之后,本文件里**不许**再出现裸 CDP 网络抓取', () => {
    /**
     * ⭐ 这才是删旧实现真正要守住的东西:
     * 「没有第二份实现」不等于「没人再写一份」。
     * L1 收口的判据是 **CDP 网络抓取只有 web-capability 一个入口**。
     *
     * ⚠️ 只禁网络抓取三件套,不禁 `debugger` 全部 ——
     * 将来若有正当的非网络 CDP 用法(如 Input 域),不该被这条误伤。
     */
    for (const bad of ['Network.enable', 'Network.getResponseBody', "debugger.on('message'"]) {
      expect(
        codeNoComments,
        `裸 CDP 网络抓取又出现了(${bad})—— 载荷捕获只能走 web-capability 的 netBus`,
      ).not.toContain(bad);
    }
  });

  it('⭐ 对外接口一字未动(A 方案的边界)', () => {
    // orchestrator 靠这两个方法取数;它们的存在与形状是「不用改 orchestrator」的前提
    expect(code).toMatch(/getAllGeminiResponses\(\):\s*readonly SSEResponseRecord\[\]/);
    expect(code).toMatch(/getWebContents\(\):\s*Electron\.WebContents/);
    expect(code).toMatch(/start\(\):\s*void/);
    expect(code).toMatch(/stop\(\):\s*void/);
  });
});

describe('⭐⭐ 端到端:载荷经 web.net 到达消费者', () => {
  /** 复刻 interceptor 迁移后的链路(同样的组件、同样的调用顺序) */
  function wire() {
    const bus = new NetworkEventBus();
    const provider = new CdpBodyProvider(bus);
    const registry = new PageRegistry();
    const monitor = new NetMonitor();
    const probe = new HealthProbe();

    const facts = registry.register({
      window: 'main', ws: 'ws-1', slot: 'left',
      partition: 'persist:webview-ws-1', owner: 'ai-service',
      service: 'gemini', url: 'https://gemini.google.com/app/abc', state: 'complete',
    });

    const captured: string[] = [];
    const faults: string[] = [];
    bus.subscribe(facts.pageId, {}, (event: NetworkEvent) => {
      monitor.observe(event);
      if (event.kind === 'channel-failed' || event.kind === 'channel-lost') {
        faults.push(event.reason);
        return;
      }
      if (event.kind !== 'response-complete' || !event.bodyRef) return;
      const rec = bus.list(facts.pageId, {}).find((r) => r.requestId === event.requestId);
      if (!rec || rec.url.indexOf('StreamGenerate') === -1) return;
      const body = bus.body(event.bodyRef);
      if (body.status !== 'ok') return;
      captured.push(new TextDecoder().decode(body.value));
    });

    return { bus, provider, registry, monitor, probe, facts, captured, faults };
  }

  it('⭐⭐ StreamGenerate 载荷经 web.net 送到消费者', () => {
    const { bus, facts, captured } = wire();
    const ts = new Date().toISOString();
    bus.recordRequestStart({
      requestId: 'r1', pageId: facts.pageId,
      url: 'https://gemini.google.com/_/BardChatUi/data/assistant.StreamGenerate',
      method: 'POST', startedAt: ts,
    });
    bus.recordResponseComplete(
      { requestId: 'r1', pageId: facts.pageId,
        url: 'https://gemini.google.com/_/BardChatUi/data/assistant.StreamGenerate',
        method: 'POST', status: 200, startedAt: ts, finishedAt: ts },
      new TextEncoder().encode('GEMINI-PAYLOAD'),
    );
    expect(captured).toEqual(['GEMINI-PAYLOAD']);
  });

  it('⭐ interceptor **源码里**真的有 StreamGenerate 过滤(端到端那条测的是复刻链路)', () => {
    // ⚠️ 下面那条端到端用例**复刻**了链路,所以它测不出「真源码里漏了过滤」——
    // 实测:把 interceptor 里的过滤删掉,那条照样绿。这条补上这个缺口。
    // (步 2.5 的教训:问一句「如果被测逻辑是错的,这条断言还会成立吗?」)
    const start = codeNoComments.indexOf('private startGeminiCDP(');
    const end = codeNoComments.indexOf('private readPartition(');
    const body = codeNoComments.slice(start, end);
    // 端点判据取自服务档案的单一来源(`ai-service-types.ts` 的 intercept.endpointPattern),
    // 所以这里断言的是「有拿 endpointPattern 去过滤」,而不是硬编码字面量。
    expect(body).toMatch(/endpointPattern/);
    expect(body).toMatch(/indexOf\(endpointPattern\)\s*===\s*-1/);
  });

  it('⭐ 非 StreamGenerate 的请求不会被当成回复(URL 过滤生效)', () => {
    const { bus, facts, captured } = wire();
    const ts = new Date().toISOString();
    bus.recordRequestStart({
      requestId: 'r1', pageId: facts.pageId,
      url: 'https://gemini.google.com/static/app.js', method: 'GET', startedAt: ts,
    });
    bus.recordResponseComplete(
      { requestId: 'r1', pageId: facts.pageId, url: 'https://gemini.google.com/static/app.js',
        method: 'GET', status: 200, startedAt: ts, finishedAt: ts },
      new TextEncoder().encode('not a reply'),
    );
    expect(captured).toEqual([]);
  });

  it('⭐ 页面在 web.page 里有 pageId,facts 字段正确(含 partition)', () => {
    const { registry, facts } = wire();
    const got = registry.facts(facts.pageId);
    expect(got.status).toBe('ok');
    if (got.status !== 'ok') throw new Error('unreachable');
    expect(got.value).toMatchObject({
      ws: 'ws-1', owner: 'ai-service', service: 'gemini',
      partition: 'persist:webview-ws-1', slot: 'left',
    });
    // pageId 不透明:不含任何维度值
    for (const dim of ['ws-1', 'gemini', 'ai-service']) {
      expect(String(facts.pageId)).not.toContain(dim);
    }
  });
});

describe('⭐⭐ 故障会响(C 类)', () => {
  function wireWithProvider(attachThrows?: Error) {
    const bus = new NetworkEventBus();
    const provider = new CdpBodyProvider(bus);
    const registry = new PageRegistry();
    const monitor = new NetMonitor();
    const probe = new HealthProbe();
    const facts = registry.register({
      window: 'main', ws: 'ws-1', slot: 'left', partition: 'persist:webview-ws-1',
      owner: 'ai-service', service: 'gemini', url: 'https://gemini.google.com/app/a', state: 'complete',
    });
    const faults: NetworkEvent[] = [];
    bus.subscribe(facts.pageId, {}, (e) => { monitor.observe(e); if (e.kind.startsWith('channel-')) faults.push(e); });

    const handlers = new Map<string, Array<(...a: unknown[]) => void>>();
    let attached = false;
    const dbg: DebuggerLike = {
      isAttached: () => attached,
      attach: () => { if (attachThrows) throw attachThrows; attached = true; },
      sendCommand: async () => ({}),
      on: (ev: string, l: (...a: unknown[]) => void) => {
        const list = handlers.get(ev) ?? []; list.push(l); handlers.set(ev, list);
      },
    };
    const host: PageHost = { hostId: 1, debugger: dbg, onDestroyed: () => {} };
    return {
      bus, provider, monitor, probe, facts, faults, host,
      fireDetach: (r = 'target closed') => { for (const h of handlers.get('detach') ?? []) h({}, r); },
    };
  }

  it('⭐ attach 失败 → 订阅者收到 channel-failed(真机实测 attach 确实抛)', () => {
    // ⚠️ 旧实现在这里是 `console.warn` + `return` —— 订阅者什么都收不到,干等。
    const w = wireWithProvider(new Error('Debugger is already attached to the target'));
    const ok = w.provider.attach(w.host, w.facts.pageId);
    expect(ok).toBe(false);
    expect(w.faults.map((f) => f.kind)).toContain('channel-failed');
    expect(w.faults[0].kind === 'channel-failed' && w.faults[0].reason)
      .toContain('already attached');
  });

  it('⭐ 通道被外部 detach → 订阅者收到 channel-lost', () => {
    const w = wireWithProvider();
    w.provider.attach(w.host, w.facts.pageId);
    w.fireDetach('target closed');
    expect(w.faults.map((f) => f.kind)).toContain('channel-lost');
  });

  it('⭐⭐ 有订阅者但零捕获 → health(web.net) 报不健康', () => {
    let now = 1_000_000;
    const bus = new NetworkEventBus(() => now);
    const monitor = new NetMonitor({ now: () => now });
    const probe = new HealthProbe({ now: () => now });
    const registry = new PageRegistry();
    const facts = registry.register({
      window: 'main', ws: 'ws-1', slot: 'left', partition: 'persist:webview-ws-1',
      owner: 'ai-service', service: 'gemini', url: 'u', state: 'complete',
    });
    bus.subscribe(facts.pageId, {}, (e) => { monitor.observe(e); });

    // 先正常捕获一条 → 健康
    const ts = new Date(now).toISOString();
    bus.recordResponseComplete(
      { requestId: 'r1', pageId: facts.pageId, url: 'https://g/StreamGenerate', method: 'POST', startedAt: ts, finishedAt: ts },
      new TextEncoder().encode('x'),
    );
    expect(probe.net(monitor.facts({ sessions: 1, subscribers: bus.subscriberCount(facts.pageId) })).alive).toBe(true);

    // ⭐ 通道悄悄哑了:什么都不做,只是时间过去 6 分钟
    now += 6 * 60 * 1000;
    const report = probe.net(monitor.facts({ sessions: 1, subscribers: bus.subscriberCount(facts.pageId) }));
    expect(report.alive).toBe(false);
    expect(report.problems[0]).toContain('通道疑似哑了');
  });
});

describe('⭐ 谁来查探针 —— 巡检有停止调用(记忆 project-graceful-shutdown)', () => {
  const watchSrc = readFileSync(
    join(process.cwd(), 'src/platform/main/web-capability/wiring/health-watch.ts'), 'utf-8',
  );
  const mainSrc = readFileSync(join(process.cwd(), 'src/platform/main/index.ts'), 'utf-8');

  it('⭐⭐ startHealthWatch 有配套的 stopHealthWatch,且 before-quit 真的调了', () => {
    // 本仓踩过的坑:stopScheduler 一直有导出但**全仓零调用方**,
    // 活着的 setInterval 吊住事件循环 → Ctrl+C 后 app 不退。
    expect(watchSrc).toMatch(/export function stopHealthWatch/);
    expect(mainSrc).toMatch(/startHealthWatch\(\)/);
    expect(mainSrc).toMatch(/stopHealthWatch\(\)/);

    // ⭐ 关键:stop 必须在 before-quit 那个回调**内部**
    const bqStart = mainSrc.indexOf("app.on('before-quit'");
    expect(bqStart).toBeGreaterThan(-1);
    const bqBlock = mainSrc.slice(bqStart, bqStart + 1200);
    expect(bqBlock, 'stopHealthWatch 必须在 before-quit 里被调到').toMatch(/stopHealthWatch\(\)/);
  });

  it('⭐ timer 有 unref(不吊住事件循环)', () => {
    expect(watchSrc).toMatch(/timer\.unref\?\.\(\)/);
  });

  it('⭐ 巡检只在健康状态翻转时发声(不刷屏)', () => {
    // 每次巡检都打日志 = 人会学会无视它,等于没有探针
    expect(watchSrc).toMatch(/if \(prev === report\.alive\) continue;/);
  });
});
