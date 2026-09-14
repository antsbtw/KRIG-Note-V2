/**
 * `web.trace` 记录器 —— 三条流 + 配额 + 开关(`05` §3.2 / §4.3)
 *
 * ── §6 取舍:记录与落盘分两层(本步只做记录)──
 *
 * `05` §3.4 要求 trace 落盘(V1 的 `responses/` 目录)。但落盘 = 真 `fs` + `app.getPath`,
 * 单测要 mock,且与配额纠缠。本实现把两者**分开**:
 *   - 记录器(本文件):**纯逻辑**,零 IO,可完全单测
 *   - 落盘:可插拔的 `TraceSink`,接线时再接真 fs
 * 这与步 1 / 步 2 的做法一致(纯逻辑核心先立,接线单独一步)。
 * ⚠️ 代价说明白:**进程一关内存里的 trace 就丢** —— 那正是纲领点名的盲区,
 * 要等接线时接上 sink 才真正补上。本步交付的是「能记、能查、有配额」这一半。
 *
 * ── 三条流为什么分开存(`05` §3.2)──
 * lifecycle / network 是**高频流水**(保留短),degradation 是**低频事件**(保留长)。
 * 混在一个环形缓冲里,一波流水就会把宝贵的故障记录挤掉 ——
 * 而故障记录正是「这类 bug 发生过多少次」的唯一依据。
 */

import type {
  CapabilityLayer,
  DegradationCategory,
  DegradationRecord,
  LifecycleRecord,
  NetworkTraceRecord,
  RecoveryRecord,
  TraceQuota,
  TraceSwitches,
} from './types';

/**
 * 落盘出口。本步不实现任何真 fs 版本 —— 只留接口,接线时接。
 * 底座**不判断**写什么进去,写什么由调用方通过开关/参数决定(`05` §4.4)。
 */
export interface TraceSink {
  writeLifecycle?(record: LifecycleRecord): void;
  writeNetwork?(record: NetworkTraceRecord): void;
  writeDegradation?(record: DegradationRecord): void;
  writeRecovery?(record: RecoveryRecord): void;
}

/** 默认配额(`05` §4.3)。degradation 留得比流水多一个量级 —— 它是低频高价值 */
const DEFAULT_QUOTA: Required<TraceQuota> = {
  maxLifecycle: 500,
  maxNetwork: 1000,
  maxDegradation: 5000,
  maxRecovery: 500,
};

/**
 * 默认开关(`05` §4.3 字面):**默认只开 lifecycle + degradation**;
 * network 全量默认关,排查时才开。
 */
const DEFAULT_SWITCHES: Required<TraceSwitches> = {
  lifecycle: true,
  network: false,
  degradation: true,
  recovery: true,
};

export type TraceRecorderOptions = {
  readonly quota?: TraceQuota;
  readonly switches?: TraceSwitches;
  readonly sink?: TraceSink;
  readonly now?: () => number;
};

export class TraceRecorder {
  private readonly quota: Required<TraceQuota>;
  private switches: Required<TraceSwitches>;
  private readonly sink?: TraceSink;
  private readonly now: () => number;

  private lifecycleFlow: LifecycleRecord[] = [];
  private networkFlow: NetworkTraceRecord[] = [];
  private degradations: DegradationRecord[] = [];
  private recoveries: RecoveryRecord[] = [];

  /** 被配额淘汰掉的条数 —— ⚠️ 必须可见,否则「记录丢了」本身就是静默的 */
  private dropped = { lifecycle: 0, network: 0, degradation: 0, recovery: 0 };

  constructor(options: TraceRecorderOptions = {}) {
    this.quota = { ...DEFAULT_QUOTA, ...options.quota };
    this.switches = { ...DEFAULT_SWITCHES, ...options.switches };
    this.sink = options.sink;
    this.now = options.now ?? Date.now;
  }

  /** 运行期改开关(排查时临时打开 network 全量) */
  setSwitches(next: TraceSwitches): void {
    this.switches = { ...this.switches, ...next };
  }

  getSwitches(): Required<TraceSwitches> {
    return { ...this.switches };
  }

  // ── 三条流 ──

  lifecycle(record: Omit<LifecycleRecord, 'ts'> & { ts?: number }): void {
    if (!this.switches.lifecycle) return;
    const full: LifecycleRecord = { ...record, ts: record.ts ?? this.now() };
    this.lifecycleFlow.push(full);
    this.dropped.lifecycle += cap(this.lifecycleFlow, this.quota.maxLifecycle);
    this.sink?.writeLifecycle?.(full);
  }

  network(record: Omit<NetworkTraceRecord, 'ts'> & { ts?: number }): void {
    if (!this.switches.network) return;
    const full: NetworkTraceRecord = { ...record, ts: record.ts ?? this.now() };
    this.networkFlow.push(full);
    this.dropped.network += cap(this.networkFlow, this.quota.maxNetwork);
    this.sink?.writeNetwork?.(full);
  }

  /**
   * 记一次降级/失败/兜底。
   *
   * ⚠️ 底座**如实记录传进来的东西**,不判断 `rawSnippet` 里有没有敏感数据 ——
   * 那是应用层的事(`05` §4.4,用户已裁定;`06` §8.4 推翻留档)。
   */
  degradation(record: Omit<DegradationRecord, 'ts'> & { ts?: number }): void {
    if (!this.switches.degradation) return;
    const full: DegradationRecord = { ...record, ts: record.ts ?? this.now() };
    this.degradations.push(full);
    this.dropped.degradation += cap(this.degradations, this.quota.maxDegradation);
    this.sink?.writeDegradation?.(full);
  }

  /**
   * 自愈留痕(`05` §4.2 / §7 决定 3)。
   *
   * ⭐ **静默自愈 = 把问题藏起来**,违反可靠性纲领铁律三。
   * V2 已有正面先例:`recoverStuckAiJudging()` 自愈时会打印「自愈:N 条已退回 pending」。
   */
  recovery(record: Omit<RecoveryRecord, 'ts'> & { ts?: number }): void {
    if (!this.switches.recovery) return;
    const full: RecoveryRecord = { ...record, ts: record.ts ?? this.now() };
    this.recoveries.push(full);
    this.dropped.recovery += cap(this.recoveries, this.quota.maxRecovery);
    this.sink?.writeRecovery?.(full);
  }

  // ── 回捞 ──

  listLifecycle(): LifecycleRecord[] { return [...this.lifecycleFlow]; }
  listNetwork(): NetworkTraceRecord[] { return [...this.networkFlow]; }
  listRecoveries(): RecoveryRecord[] { return [...this.recoveries]; }

  listDegradations(filter: {
    layer?: CapabilityLayer;
    capability?: string;
    category?: DegradationCategory;
    since?: number;
  } = {}): DegradationRecord[] {
    return this.degradations.filter((r) => {
      if (filter.layer !== undefined && r.layer !== filter.layer) return false;
      if (filter.capability !== undefined && r.capability !== filter.capability) return false;
      if (filter.category !== undefined && r.category !== filter.category) return false;
      if (filter.since !== undefined && r.ts < filter.since) return false;
      return true;
    });
  }

  /**
   * ⭐ 按站点统计「格式外」计数 —— 站点改版的可统计指标(`05` §3.3 / §4.5)。
   *
   * 某个 adapter 的格式外计数突然上升 = 那个站改版了。
   * 这就是把「怎么不好使了」变成看板上自己变红的那一步。
   */
  countByCapability(category: DegradationCategory, since?: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.degradations) {
      if (r.category !== category) continue;
      if (since !== undefined && r.ts < since) continue;
      const key = r.capability ?? '(unknown)';
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  }

  /** 被配额淘汰的条数。⚠️ 暴露出来,免得「记录悄悄丢了」 */
  droppedCounts(): Readonly<typeof this.dropped> {
    return { ...this.dropped };
  }

  /** 一键清除(`05` §4.4 应用层参考做法 4) */
  clear(): void {
    this.lifecycleFlow = [];
    this.networkFlow = [];
    this.degradations = [];
    this.recoveries = [];
    this.dropped = { lifecycle: 0, network: 0, degradation: 0, recovery: 0 };
  }
}

/** 超配额时从头砍,返回砍掉的条数 */
function cap<T>(list: T[], max: number): number {
  if (list.length <= max) return 0;
  const excess = list.length - max;
  list.splice(0, excess);
  return excess;
}
