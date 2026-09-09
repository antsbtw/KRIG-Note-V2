/**
 * `web.trace` 健康探针 —— ⭐⭐ **本步的命脉**(`05` §4.1 / `07` §2.5)
 *
 * ── 为什么这个探针是整个重构最该有的一条 ──
 *
 * X 现有的失效形态是**静默失聪**:CDP 通道被掐了,订阅者不报错、不重试,
 * 只是安静地再也收不到载荷 —— 表现为「采集突然变 0」,而**没有任何东西会响**。
 *
 * `05` §4.1 定的那条指标就是解药:
 *   ⭐ **`web.net`:有订阅者但近 N 分钟零捕获 = 通道哑了**
 *
 * 有了它,通道**会自己举手**,而不是等人发现「怎么变 0 了」。
 *
 * ⚠️ 注意「有订阅者」这个前提不能省:零订阅者时零捕获是**正常**的
 * (没人在听,当然没数据)。把这两种情形混起来会让探针天天误报,
 * 而**天天误报的探针等于没有探针** —— 人会学会无视它。
 *
 * ── 时钟注入 ──
 * 构造器接受 `now`,与步 2 的 `NetworkEventBus` 一致,便于确定性地测「N 分钟内」。
 * ⚠️ **不用常驻 timer**:记忆 `project-graceful-shutdown` —— 常驻 timer 会吊住
 * Node 事件循环让进程不肯退,且本仓铁律要求每个常驻 timer 在 before-quit 有停止调用。
 * 本探针是**拉取式**(调 `health()` 时现算),没有这个负担。
 */

import type { CapabilityLayer, HealthReport } from './types';

/** ⭐ `05` §4.1 定的窗口:近 5 分钟 */
export const SILENT_CHANNEL_WINDOW_MS = 5 * 60 * 1000;

/** `web.net` 探针要的事实 —— 由调用方(接线层)喂进来,探针自己不碰 Electron */
export type NetFacts = {
  /** 挂载的 session 数 */
  readonly sessions: number;
  /** 当前订阅者数(步 2 的 `bus.subscriberCount()`) */
  readonly subscribers: number;
  /** 窗口内捕获到的载荷数 */
  readonly capturesInWindow: number;
  /** 最后一次捕获的时刻(epoch ms);从未捕获过则 undefined */
  readonly lastCaptureAt?: number;
  /** 累计的通道故障次数(步 2 的 channel-failed / channel-lost) */
  readonly channelFailures?: number;
  /** 最后一次通道故障的原因 */
  readonly lastChannelFailure?: string;
};

export type PageFacts = {
  readonly activePages: number;
  readonly activeLeases: number;
  /** 租约数只增不减 = 泄漏 */
  readonly leasesTrend?: 'growing' | 'stable';
};

export type RateFacts = {
  readonly attempts: number;
  readonly successes: number;
};

export type TraceFacts = {
  readonly bytesWritten: number;
  readonly quotaHit: boolean;
  readonly writeFailures?: number;
};

export type HealthOptions = {
  readonly now?: () => number;
  readonly silentWindowMs?: number;
  /** 成功率低于多少算不健康(`05` §4.1:成功率骤降 = 站点改版) */
  readonly minSuccessRate?: number;
};

export class HealthProbe {
  private readonly now: () => number;
  private readonly silentWindowMs: number;
  private readonly minSuccessRate: number;
  private readonly since: number;

  constructor(options: HealthOptions = {}) {
    this.now = options.now ?? Date.now;
    this.silentWindowMs = options.silentWindowMs ?? SILENT_CHANNEL_WINDOW_MS;
    this.minSuccessRate = options.minSuccessRate ?? 0.5;
    this.since = this.now();
  }

  /**
   * ⭐⭐ `web.net` 的健康 —— 本步最重要的一个函数。
   *
   * 不健康的判据(`05` §4.1):
   *  1. ⭐ **有订阅者但窗口内零捕获** = 通道哑了(静默失聪的唯一可观测形态)
   *  2. 有通道故障记录(步 2 广播的 channel-failed / channel-lost)
   */
  net(facts: NetFacts): HealthReport {
    const problems: string[] = [];
    const now = this.now();

    // ⭐ 命脉:有人在听却什么都没听到
    if (facts.subscribers > 0 && facts.capturesInWindow === 0) {
      const silentFor = facts.lastCaptureAt !== undefined
        ? `${Math.round((now - facts.lastCaptureAt) / 1000)}s`
        : '从未捕获过';
      problems.push(
        `通道疑似哑了:有 ${facts.subscribers} 个订阅者,但近 ` +
        `${Math.round(this.silentWindowMs / 1000)}s 零捕获(距上次捕获 ${silentFor})`,
      );
    }

    if (facts.channelFailures !== undefined && facts.channelFailures > 0) {
      problems.push(
        `通道故障 ${facts.channelFailures} 次` +
        (facts.lastChannelFailure ? `,最近一次:${facts.lastChannelFailure}` : ''),
      );
    }

    return {
      layer: 'web.net',
      alive: problems.length === 0,
      since: this.since,
      metrics: {
        sessions: facts.sessions,
        subscribers: facts.subscribers,
        capturesInWindow: facts.capturesInWindow,
        channelFailures: facts.channelFailures ?? 0,
      },
      problems,
    };
  }

  /** `web.page`:租约泄漏(只增不减)= 不健康 */
  page(facts: PageFacts): HealthReport {
    const problems: string[] = [];
    if (facts.leasesTrend === 'growing') {
      problems.push(`租约疑似泄漏:当前 ${facts.activeLeases} 个且只增不减`);
    }
    if (facts.activePages === 0 && facts.activeLeases > 0) {
      problems.push(`零页面却有 ${facts.activeLeases} 个租约 —— 孤儿租约`);
    }
    return {
      layer: 'web.page',
      alive: problems.length === 0,
      since: this.since,
      metrics: { activePages: facts.activePages, activeLeases: facts.activeLeases },
      problems,
    };
  }

  /** `web.dom` / `web.input`:成功率骤降 = 站点改版(`05` §4.1)*/
  private rate(layer: CapabilityLayer, facts: RateFacts, label: string): HealthReport {
    const problems: string[] = [];
    // ⚠️ 零尝试时不判断成功率 —— 没试过就不算失败,否则启动后立刻误报
    const successRate = facts.attempts > 0 ? facts.successes / facts.attempts : 1;
    if (facts.attempts > 0 && successRate < this.minSuccessRate) {
      problems.push(
        `${label}成功率骤降至 ${(successRate * 100).toFixed(0)}%` +
        `(${facts.successes}/${facts.attempts})—— 站点可能改版了`,
      );
    }
    return {
      layer,
      alive: problems.length === 0,
      since: this.since,
      metrics: { attempts: facts.attempts, successes: facts.successes, successRate },
      problems,
    };
  }

  dom(facts: RateFacts): HealthReport {
    return this.rate('web.dom', facts, '注入');
  }

  input(facts: RateFacts): HealthReport {
    return this.rate('web.input', facts, '落地确认');
  }

  /** `web.trace` 自己的健康:写盘失败 / 触配额 */
  trace(facts: TraceFacts): HealthReport {
    const problems: string[] = [];
    if (facts.writeFailures !== undefined && facts.writeFailures > 0) {
      problems.push(`trace 写盘失败 ${facts.writeFailures} 次`);
    }
    if (facts.quotaHit) {
      // 触配额不是「坏了」,但要说出来 —— 否则记录被淘汰这件事是静默的
      problems.push('已触配额上限,最旧的记录正在被淘汰');
    }
    return {
      layer: 'web.trace',
      alive: problems.length === 0,
      since: this.since,
      metrics: { bytesWritten: facts.bytesWritten, writeFailures: facts.writeFailures ?? 0 },
      problems,
    };
  }
}
