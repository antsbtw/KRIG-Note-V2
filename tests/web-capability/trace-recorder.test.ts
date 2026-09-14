/**
 * `web.trace` 记录器 —— 三条流 / 配额 / 站点改版可统计 / 自愈留痕
 *
 * 守的几条:
 *  - ⭐ **站点改版可统计**:selector 失效 = 「格式外」,且**可按站点计数**(`05` §3.3 / §4.5)
 *  - ⭐ **三条流分开存**:degradation 保留策略与流水不同,一波流水不许把故障记录挤掉
 *  - ⭐ **自愈必须留痕**:静默自愈 = 把问题藏起来(纲领铁律三)
 *  - ⭐ **底座不判断敏感数据**:如实记录传进来的东西(`05` §4.4,用户已裁定)
 */
import { describe, it, expect } from 'vitest';
import { TraceRecorder, type TraceSink } from '@platform/main/web-capability/trace';

describe('⭐ 站点改版可统计(`05` §3.3 的关键映射)', () => {
  it('⭐⭐ selector 失效记为「格式外」,并可按站点计数', () => {
    // 这条映射的价值:让「X 改版了」从一次次孤立报障,变成**可统计的指标**。
    // 某 adapter 的格式外计数突然上升 = 那个站改版了 → 看板自己变红。
    const r = new TraceRecorder();
    for (let i = 0; i < 7; i++) {
      r.degradation({
        layer: 'web.dom', capability: 'x', operation: 'query:composeBox',
        category: 'unexpected-format', reason: 'selector 未命中任何元素',
      });
    }
    r.degradation({
      layer: 'web.dom', capability: 'claude', operation: 'query:artifactCard',
      category: 'unexpected-format', reason: 'selector 未命中',
    });

    const counts = r.countByCapability('unexpected-format');
    expect(counts).toEqual({ x: 7, claude: 1 });
  });

  it('⭐ 按站点计数只算「格式外」,不把别的类别混进来', () => {
    const r = new TraceRecorder();
    r.degradation({ layer: 'web.dom', capability: 'x', operation: 'q', category: 'unexpected-format', reason: 'a' });
    r.degradation({ layer: 'web.net', capability: 'x', operation: 'attach', category: 'systemic', reason: 'b' });
    r.degradation({ layer: 'web.net', capability: 'x', operation: 'fetch', category: 'resource-failure', reason: 'c' });

    expect(r.countByCapability('unexpected-format')).toEqual({ x: 1 });
    expect(r.countByCapability('systemic')).toEqual({ x: 1 });
  });

  it('可按时间窗计数(用于「最近成功率」看板)', () => {
    let now = 1_000_000;
    const r = new TraceRecorder({ now: () => now });
    r.degradation({ layer: 'web.dom', capability: 'x', operation: 'q', category: 'unexpected-format', reason: 'old' });
    now += 60_000;
    r.degradation({ layer: 'web.dom', capability: 'x', operation: 'q', category: 'unexpected-format', reason: 'new' });

    expect(r.countByCapability('unexpected-format')).toEqual({ x: 2 });
    expect(r.countByCapability('unexpected-format', now)).toEqual({ x: 1 });
  });

  it('没给 capability 的记录归到 (unknown),不丢', () => {
    const r = new TraceRecorder();
    r.degradation({ layer: 'web.dom', operation: 'q', category: 'unexpected-format', reason: 'x' });
    expect(r.countByCapability('unexpected-format')).toEqual({ '(unknown)': 1 });
  });

  it('五类 category 都能记(纲领 §2 分类学完整)', () => {
    const r = new TraceRecorder();
    const cats = ['unexpected-format', 'parse-crash', 'resource-failure', 'contract-violation', 'systemic'] as const;
    for (const c of cats) {
      r.degradation({ layer: 'web.net', operation: 'op', category: c, reason: c });
    }
    expect(r.listDegradations()).toHaveLength(5);
    for (const c of cats) {
      expect(r.listDegradations({ category: c })).toHaveLength(1);
    }
  });
});

describe('⭐ 三条流分开存(`05` §3.2:保留策略不同)', () => {
  it('⭐⭐ 一大波 lifecycle 流水不会把 degradation 挤掉', () => {
    // 这是「分开存」的**真正理由**。混在一个缓冲里,流水一冲,
    // 宝贵的故障记录就没了 —— 而它正是「这类 bug 发生过多少次」的唯一依据。
    const r = new TraceRecorder({ quota: { maxLifecycle: 10 } });
    r.degradation({ layer: 'web.net', operation: 'attach', category: 'systemic', reason: '要留住的' });

    for (let i = 0; i < 500; i++) {
      r.lifecycle({ layer: 'web.page', event: `nav-${i}` });
    }

    expect(r.listLifecycle()).toHaveLength(10);
    expect(r.listDegradations()).toHaveLength(1);
    expect(r.listDegradations()[0].reason).toBe('要留住的');
  });

  it('degradation 的默认配额比流水大一个量级(低频高价值)', () => {
    const r = new TraceRecorder({ switches: { network: true } });
    for (let i = 0; i < 6000; i++) {
      r.degradation({ layer: 'web.net', operation: 'op', category: 'systemic', reason: `r${i}` });
    }
    for (let i = 0; i < 2000; i++) {
      r.network({ pageId: 'p', requestId: `r${i}`, url: 'u', method: 'GET', gotBody: true });
    }
    expect(r.listDegradations().length).toBeGreaterThan(r.listNetwork().length);
  });
});

describe('⭐ 配额有效 —— 不无限增长,且淘汰不静默', () => {
  it('超配额后从最旧的开始淘汰', () => {
    const r = new TraceRecorder({ quota: { maxDegradation: 5 } });
    for (let i = 0; i < 12; i++) {
      r.degradation({ layer: 'web.net', operation: 'op', category: 'systemic', reason: `r${i}` });
    }
    const kept = r.listDegradations();
    expect(kept).toHaveLength(5);
    expect(kept[0].reason).toBe('r7');
    expect(kept[kept.length - 1].reason).toBe('r11');
  });

  it('⭐ 被淘汰的条数可见 —— 否则「记录悄悄丢了」本身就是静默的', () => {
    const r = new TraceRecorder({ quota: { maxDegradation: 5 } });
    for (let i = 0; i < 12; i++) {
      r.degradation({ layer: 'web.net', operation: 'op', category: 'systemic', reason: `r${i}` });
    }
    expect(r.droppedCounts().degradation).toBe(7);
  });

  it('四条流各自独立计配额', () => {
    const r = new TraceRecorder({
      quota: { maxLifecycle: 2, maxNetwork: 3, maxDegradation: 4, maxRecovery: 1 },
      switches: { network: true },
    });
    for (let i = 0; i < 10; i++) {
      r.lifecycle({ layer: 'web.page', event: 'e' });
      r.network({ pageId: 'p', requestId: `r${i}`, url: 'u', method: 'GET', gotBody: true });
      r.degradation({ layer: 'web.net', operation: 'o', category: 'systemic', reason: 'r' });
      r.recovery({ layer: 'web.net', what: 'reattach', outcome: 'recovered' });
    }
    expect(r.listLifecycle()).toHaveLength(2);
    expect(r.listNetwork()).toHaveLength(3);
    expect(r.listDegradations()).toHaveLength(4);
    expect(r.listRecoveries()).toHaveLength(1);
  });

  it('clear 清空一切并归零计数(`05` §4.4:一键清除)', () => {
    const r = new TraceRecorder({ quota: { maxDegradation: 1 } });
    r.degradation({ layer: 'web.net', operation: 'o', category: 'systemic', reason: 'a' });
    r.degradation({ layer: 'web.net', operation: 'o', category: 'systemic', reason: 'b' });
    r.clear();
    expect(r.listDegradations()).toEqual([]);
    expect(r.droppedCounts().degradation).toBe(0);
  });
});

describe('⭐ 自愈必须留痕(`05` §4.2 / §7 决定 3)', () => {
  it('⭐ 自愈成功要留痕', () => {
    // 静默自愈 = 把问题藏起来,违反可靠性纲领铁律三。
    // V2 已有正面先例:recoverStuckAiJudging() 会打印「自愈:N 条已退回 pending」
    const r = new TraceRecorder();
    r.recovery({ layer: 'web.net', what: 'CDP 被外部 detach 后重新 attach', outcome: 'recovered', detail: '第 1 次尝试成功' });
    const list = r.listRecoveries();
    expect(list).toHaveLength(1);
    expect(list[0].outcome).toBe('recovered');
    expect(list[0].what).toContain('重新 attach');
  });

  it('⭐ 自愈失败同样留痕(修不了要明确说)', () => {
    const r = new TraceRecorder();
    r.recovery({ layer: 'web.net', what: '重新 attach', outcome: 'failed', detail: '连续 3 次失败' });
    expect(r.listRecoveries()[0].outcome).toBe('failed');
  });
});

describe('⭐ 开关(`05` §4.3)', () => {
  it('⭐ 默认只开 lifecycle + degradation,network 默认关', () => {
    const r = new TraceRecorder();
    expect(r.getSwitches()).toEqual({ lifecycle: true, network: false, degradation: true, recovery: true });

    r.lifecycle({ layer: 'web.page', event: 'created' });
    r.network({ pageId: 'p', requestId: 'r', url: 'u', method: 'GET', gotBody: true });
    r.degradation({ layer: 'web.net', operation: 'o', category: 'systemic', reason: 'x' });

    expect(r.listLifecycle()).toHaveLength(1);
    expect(r.listNetwork()).toHaveLength(0);   // ← 默认关
    expect(r.listDegradations()).toHaveLength(1);
  });

  it('排查时可临时打开 network 全量', () => {
    const r = new TraceRecorder();
    r.setSwitches({ network: true });
    r.network({ pageId: 'p', requestId: 'r', url: 'u', method: 'GET', gotBody: true });
    expect(r.listNetwork()).toHaveLength(1);
  });

  it('关掉 degradation 后不再记(调用方的选择,底座不拦)', () => {
    const r = new TraceRecorder({ switches: { degradation: false } });
    r.degradation({ layer: 'web.net', operation: 'o', category: 'systemic', reason: 'x' });
    expect(r.listDegradations()).toHaveLength(0);
  });
});

describe('⭐ 底座不判断敏感数据(`05` §4.4,用户已裁定)', () => {
  it('⭐ rawSnippet 原样记录 —— 底座不过滤、不脱敏、不猜哪些字段敏感', () => {
    // 分工:底座提供「可按参数过滤 / 可关闭 / 可清除」的能力;
    // 应用决定本站点记什么。底座内置规则会让接医疗站/财务站时要回来改底座。
    const r = new TraceRecorder();
    const snippet = '{"authorization":"Bearer secret","body":"私信内容"}';
    r.degradation({
      layer: 'web.net', capability: 'x', operation: 'parse',
      category: 'parse-crash', reason: 'JSON 解析失败', rawSnippet: snippet,
    });
    expect(r.listDegradations()[0].rawSnippet).toBe(snippet);
  });

  it('⭐ 源码里没有任何站点名单/敏感字段名单', () => {
    // 与步 2 同一条守卫思路:站点适配不进底层
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const dir = path.join(process.cwd(), 'src/platform/main/web-capability/trace');
    const code = fs.readdirSync(dir)
      .filter((f: string) => f.endsWith('.ts'))
      .map((f: string) => fs.readFileSync(path.join(dir, f), 'utf-8'))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const site of ['anthropic.com', 'openai.com', 'x.com', 'twitter.com', 'claude.ai']) {
      expect(code, `底座硬编码了 ${site}`).not.toContain(site);
    }
    for (const field of ['authorization', 'cookie', 'password']) {
      expect(code.toLowerCase(), `底座内置了敏感字段名单 ${field}`).not.toContain(field);
    }
  });
});

describe('sink —— 记录与落盘分两层(§6 取舍)', () => {
  it('给了 sink 就转发,没给也照常记(sink 是可选的)', () => {
    const seen: string[] = [];
    const sink: TraceSink = {
      writeDegradation: (r) => { seen.push(r.reason); },
      writeLifecycle: (r) => { seen.push(r.event); },
    };
    const r = new TraceRecorder({ sink });
    r.degradation({ layer: 'web.net', operation: 'o', category: 'systemic', reason: 'boom' });
    r.lifecycle({ layer: 'web.page', event: 'created' });
    expect(seen).toEqual(['boom', 'created']);

    const noSink = new TraceRecorder();
    expect(() => noSink.degradation({ layer: 'web.net', operation: 'o', category: 'systemic', reason: 'x' })).not.toThrow();
  });

  it('开关关掉时 sink 也不会被调用', () => {
    let called = 0;
    const r = new TraceRecorder({ switches: { network: false }, sink: { writeNetwork: () => { called += 1; } } });
    r.network({ pageId: 'p', requestId: 'r', url: 'u', method: 'GET', gotBody: true });
    expect(called).toBe(0);
  });
});

describe('回捞过滤', () => {
  it('按 layer / capability / category / since 过滤', () => {
    let now = 1_000;
    const r = new TraceRecorder({ now: () => now });
    r.degradation({ layer: 'web.net', capability: 'x', operation: 'a', category: 'systemic', reason: '1' });
    now = 2_000;
    r.degradation({ layer: 'web.dom', capability: 'x', operation: 'b', category: 'unexpected-format', reason: '2' });
    now = 3_000;
    r.degradation({ layer: 'web.dom', capability: 'claude', operation: 'c', category: 'unexpected-format', reason: '3' });

    expect(r.listDegradations({ layer: 'web.dom' })).toHaveLength(2);
    expect(r.listDegradations({ capability: 'x' })).toHaveLength(2);
    expect(r.listDegradations({ category: 'unexpected-format' })).toHaveLength(2);
    expect(r.listDegradations({ since: 2_500 })).toHaveLength(1);
    expect(r.listDegradations({ layer: 'web.dom', capability: 'claude' })).toHaveLength(1);
  });

  it('返回的是快照,改它不影响内部', () => {
    const r = new TraceRecorder();
    r.degradation({ layer: 'web.net', operation: 'o', category: 'systemic', reason: 'a' });
    r.listDegradations().length = 0;
    expect(r.listDegradations()).toHaveLength(1);
  });
});
