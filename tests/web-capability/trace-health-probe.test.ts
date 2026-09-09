/**
 * ⭐⭐ `web.trace` 健康探针 —— **本步的命脉**(`05` §4.1 / `07` §2.5)
 *
 * 守的是一件事:**通道哑了会自己举手**。
 *
 * X 现有的失效形态是静默失聪 —— 通道被掐了,订阅者不报错、不重试,
 * 只是安静地再也收不到载荷,表现为「采集突然变 0」,**没有任何东西会响**。
 * `05` §7 决定 1 明确:这条探针必做,因为它让失聪**自己举手**。
 *
 * ⚠️ 本步是**为步 3 的验收而做的**:步 3 要迁移 AI、换掉取数层,
 * 而那部分没有任何测试覆盖。步 3 能不能验收,取决于这个探针是否真的会响。
 */
import { describe, it, expect } from 'vitest';
import { HealthProbe, SILENT_CHANNEL_WINDOW_MS } from '@platform/main/web-capability/trace';

/** 可控时钟 —— 让「近 5 分钟」这件事在测试里是确定的,不靠真等 */
function clocked(start = 1_000_000) {
  let now = start;
  return {
    probe: new HealthProbe({ now: () => now }),
    advance: (ms: number) => { now += ms; },
    at: () => now,
  };
}

describe('⭐⭐ 命脉 —— 有订阅者但零捕获 = 通道哑了', () => {
  it('⭐⭐ 有 3 个订阅者 + 窗口内零捕获 → alive:false,且问题里说清原因', () => {
    const { probe, at } = clocked();
    const report = probe.net({
      sessions: 1,
      subscribers: 3,
      capturesInWindow: 0,
      lastCaptureAt: at() - 10 * 60 * 1000,   // 10 分钟前还好好的
    });

    expect(report.alive).toBe(false);
    expect(report.problems).toHaveLength(1);
    // 问题必须能让人**一眼看懂发生了什么**,不能只说 "unhealthy"
    expect(report.problems[0]).toContain('通道疑似哑了');
    expect(report.problems[0]).toContain('3 个订阅者');
    expect(report.problems[0]).toContain('零捕获');
    // 指标要带上,便于看板
    expect(report.metrics.subscribers).toBe(3);
    expect(report.metrics.capturesInWindow).toBe(0);
  });

  it('⭐ 从未捕获过时也报,且说明是「从未捕获过」而不是编一个时长', () => {
    const { probe } = clocked();
    const report = probe.net({ sessions: 1, subscribers: 2, capturesInWindow: 0 });
    expect(report.alive).toBe(false);
    expect(report.problems[0]).toContain('从未捕获过');
  });

  it('⭐⭐ 零订阅者时零捕获是**正常**的 —— 不许误报', () => {
    // 没人在听当然没数据。把这两种情形混起来会让探针天天误报,
    // 而**天天误报的探针等于没有探针** —— 人会学会无视它。
    const { probe } = clocked();
    const report = probe.net({ sessions: 1, subscribers: 0, capturesInWindow: 0 });
    expect(report.alive).toBe(true);
    expect(report.problems).toEqual([]);
  });

  it('有订阅者且有捕获 → 健康', () => {
    const { probe, at } = clocked();
    const report = probe.net({
      sessions: 1, subscribers: 3, capturesInWindow: 42, lastCaptureAt: at() - 1000,
    });
    expect(report.alive).toBe(true);
    expect(report.problems).toEqual([]);
    expect(report.metrics.capturesInWindow).toBe(42);
  });

  it('窗口默认是 300s —— 05 §4.1 定的 5 分钟', () => {
    expect(SILENT_CHANNEL_WINDOW_MS).toBe(5 * 60 * 1000);
  });
});

describe('⭐ 通道故障能被探针看见(步 2 与本步的接缝)', () => {
  it('⭐ 有通道故障 → alive:false,且带上最近一次原因', () => {
    const { probe } = clocked();
    const report = probe.net({
      sessions: 1, subscribers: 1, capturesInWindow: 5,   // 还在捕获,但故障过
      channelFailures: 2,
      lastChannelFailure: 'CDP 通道被外部 detach: target closed',
    });
    expect(report.alive).toBe(false);
    expect(report.problems.some((p) => p.includes('通道故障 2 次'))).toBe(true);
    expect(report.problems.some((p) => p.includes('target closed'))).toBe(true);
    expect(report.metrics.channelFailures).toBe(2);
  });

  it('⭐ 两个问题同时存在时都要报出来(不是只报第一个)', () => {
    const { probe } = clocked();
    const report = probe.net({
      sessions: 1, subscribers: 3, capturesInWindow: 0,
      channelFailures: 1, lastChannelFailure: 'attach 失败',
    });
    expect(report.alive).toBe(false);
    expect(report.problems).toHaveLength(2);
  });

  it('零故障时不报', () => {
    const { probe } = clocked();
    const report = probe.net({ sessions: 1, subscribers: 1, capturesInWindow: 1, channelFailures: 0 });
    expect(report.alive).toBe(true);
  });
});

describe('web.page 探针 —— 租约泄漏', () => {
  it('租约只增不减 → 报泄漏', () => {
    const { probe } = clocked();
    const report = probe.page({ activePages: 3, activeLeases: 50, leasesTrend: 'growing' });
    expect(report.alive).toBe(false);
    expect(report.problems[0]).toContain('租约疑似泄漏');
  });

  it('⭐ 零页面却有租约 = 孤儿租约', () => {
    const { probe } = clocked();
    const report = probe.page({ activePages: 0, activeLeases: 2 });
    expect(report.alive).toBe(false);
    expect(report.problems[0]).toContain('孤儿租约');
  });

  it('页面与租约都正常 → 健康', () => {
    const { probe } = clocked();
    expect(probe.page({ activePages: 3, activeLeases: 1, leasesTrend: 'stable' }).alive).toBe(true);
  });
});

describe('web.dom / web.input 探针 —— 成功率骤降 = 站点改版', () => {
  it('注入成功率跌破阈值 → 不健康,并点名「站点可能改版了」', () => {
    const { probe } = clocked();
    const report = probe.dom({ attempts: 20, successes: 3 });
    expect(report.alive).toBe(false);
    expect(report.problems[0]).toContain('注入成功率骤降');
    expect(report.problems[0]).toContain('站点可能改版了');
    expect(report.metrics.successRate).toBeCloseTo(0.15);
  });

  it('落地确认成功率同理', () => {
    const { probe } = clocked();
    const report = probe.input({ attempts: 10, successes: 2 });
    expect(report.alive).toBe(false);
    expect(report.problems[0]).toContain('落地确认成功率骤降');
  });

  it('⭐ 零尝试时不判断成功率 —— 启动后不许立刻误报', () => {
    // 没试过就不算失败。否则 app 一起来探针就红,同样是「天天误报 = 等于没有」
    const { probe } = clocked();
    const report = probe.dom({ attempts: 0, successes: 0 });
    expect(report.alive).toBe(true);
    expect(report.problems).toEqual([]);
  });

  it('成功率高于阈值 → 健康', () => {
    const { probe } = clocked();
    expect(probe.dom({ attempts: 10, successes: 9 }).alive).toBe(true);
  });
});

describe('web.trace 自己的健康', () => {
  it('写盘失败 → 不健康', () => {
    const { probe } = clocked();
    const report = probe.trace({ bytesWritten: 100, quotaHit: false, writeFailures: 3 });
    expect(report.alive).toBe(false);
    expect(report.problems[0]).toContain('写盘失败 3 次');
  });

  it('⭐ 触配额要说出来 —— 否则「记录被淘汰」这件事是静默的', () => {
    const { probe } = clocked();
    const report = probe.trace({ bytesWritten: 999, quotaHit: true });
    expect(report.alive).toBe(false);
    expect(report.problems[0]).toContain('触配额');
  });

  it('一切正常 → 健康', () => {
    const { probe } = clocked();
    expect(probe.trace({ bytesWritten: 100, quotaHit: false }).alive).toBe(true);
  });
});

describe('⭐ 报告形状契约(`06` §3.5)', () => {
  it('problems 为空 ⟺ alive 为 true', () => {
    const { probe } = clocked();
    const reports = [
      probe.net({ sessions: 1, subscribers: 0, capturesInWindow: 0 }),
      probe.net({ sessions: 1, subscribers: 1, capturesInWindow: 0 }),
      probe.page({ activePages: 1, activeLeases: 0 }),
      probe.dom({ attempts: 10, successes: 1 }),
    ];
    for (const r of reports) {
      expect(r.alive).toBe(r.problems.length === 0);
    }
  });

  it('每个报告都带 layer / since / metrics', () => {
    const { probe } = clocked();
    const r = probe.net({ sessions: 1, subscribers: 1, capturesInWindow: 1 });
    expect(r.layer).toBe('web.net');
    expect(typeof r.since).toBe('number');
    expect(r.metrics).toBeDefined();
  });

  it('⚠️ 层名用 web.* 不用 L0/L1(避免与 V2 启动期 [L1] Window 混淆)', () => {
    const { probe } = clocked();
    const layers = [
      probe.net({ sessions: 0, subscribers: 0, capturesInWindow: 0 }).layer,
      probe.page({ activePages: 0, activeLeases: 0 }).layer,
      probe.dom({ attempts: 0, successes: 0 }).layer,
      probe.input({ attempts: 0, successes: 0 }).layer,
      probe.trace({ bytesWritten: 0, quotaHit: false }).layer,
    ];
    expect(layers).toEqual(['web.net', 'web.page', 'web.dom', 'web.input', 'web.trace']);
    for (const l of layers) expect(l).not.toMatch(/^L\d/);
  });
});
