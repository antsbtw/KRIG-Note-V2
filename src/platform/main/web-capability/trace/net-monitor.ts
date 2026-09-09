/**
 * `web.net` 观测器 —— 步 2 的总线与本步探针之间的**接缝**
 *
 * 它只做一件事:**订阅总线,把事实攒起来**,供 `HealthProbe.net()` 取用。
 *
 * ⭐ 为什么要有这个中间层:
 * 探针是**拉取式**的(调 `health()` 时现算),但「近 5 分钟捕获了几条」
 * 这个事实必须**持续观测**才拿得到。这个类就是那个持续观测的地方。
 *
 * ⚠️ 它**只订阅,不 attach** —— 与所有业务方一样。
 * 步 2 的接口上就没有 attach/detach,所以这里也不可能关错灯。
 *
 * ⚠️ **不用常驻 timer**(记忆 `project-graceful-shutdown`)。
 * 窗口内计数靠「记下每次捕获的时刻,取数时现算」实现,
 * 不需要定时清理。代价是捕获时刻数组要封顶 —— 已封。
 */

import type { PageId } from '../page/types';
import type { NetworkEvent } from '../net/types';
import type { NetFacts } from './health';
import type { TraceRecorder } from './recorder';

/** 捕获时刻的保留上限 —— 只用于算窗口内计数,不需要留全 */
const MAX_CAPTURE_MARKS = 2000;

export type NetMonitorOptions = {
  readonly now?: () => number;
  readonly windowMs?: number;
  /** 给了就把通道故障顺手记进 degradation(留痕) */
  readonly recorder?: TraceRecorder;
};

export class NetMonitor {
  private readonly now: () => number;
  private readonly windowMs: number;
  private readonly recorder?: TraceRecorder;

  /** 每次成功捕获载荷的时刻 */
  private captureMarks: number[] = [];
  private channelFailures = 0;
  private lastChannelFailure?: string;
  private lastCaptureAt?: number;

  constructor(options: NetMonitorOptions = {}) {
    this.now = options.now ?? Date.now;
    this.windowMs = options.windowMs ?? 5 * 60 * 1000;
    this.recorder = options.recorder;
  }

  /**
   * 消费一个总线事件。
   *
   * ⭐ `channel-failed` / `channel-lost` 在步 2 是**不受 kinds 过滤**广播的,
   * 所以这里一定收得到 —— 这是步 2 那个设计决定在本步兑现的地方。
   */
  observe(event: NetworkEvent): void {
    if (event.kind === 'response-complete') {
      // 只有真的拿到 body 才算「捕获」—— 有响应但没载荷不算,
      // 否则通道哑了(能看到请求、拿不到 body)会被误判成健康
      if (event.bodyRef !== undefined) {
        this.lastCaptureAt = event.at ? Date.parse(event.at) : this.now();
        this.captureMarks.push(this.lastCaptureAt);
        if (this.captureMarks.length > MAX_CAPTURE_MARKS) {
          this.captureMarks.splice(0, this.captureMarks.length - MAX_CAPTURE_MARKS);
        }
      }
      return;
    }

    if (event.kind === 'channel-failed') {
      this.channelFailures += 1;
      this.lastChannelFailure = event.reason;
      // ⚠️ 通道故障是**系统级**(可靠性纲领 §2 分类学;`05` §3.3 的映射表)
      this.recorder?.degradation({
        layer: 'web.net',
        operation: 'channel-attach',
        category: 'systemic',
        reason: event.reason,
        inputRef: String(event.pageId),
      });
      return;
    }

    if (event.kind === 'channel-lost') {
      this.channelFailures += 1;
      this.lastChannelFailure = event.reason;
      this.recorder?.degradation({
        layer: 'web.net',
        operation: 'channel-lost',
        category: 'systemic',
        reason: event.reason,
        inputRef: String(event.pageId),
      });
      return;
    }
  }

  /** 组装探针要的事实。`subscribers` / `sessions` 由调用方给(它们来自总线与接线层) */
  facts(input: { sessions: number; subscribers: number }): NetFacts {
    const cutoff = this.now() - this.windowMs;
    const capturesInWindow = this.captureMarks.filter((t) => t >= cutoff).length;
    return {
      sessions: input.sessions,
      subscribers: input.subscribers,
      capturesInWindow,
      lastCaptureAt: this.lastCaptureAt,
      channelFailures: this.channelFailures,
      lastChannelFailure: this.lastChannelFailure,
    };
  }

  /** 通道恢复后清故障计数 —— ⚠️ 调用方要顺手记一条 recovery,否则就是静默自愈 */
  resetChannelFailures(): void {
    this.channelFailures = 0;
    this.lastChannelFailure = undefined;
  }

  /** 绑定到一个页面的订阅(便捷方法)。返回取消订阅函数 */
  bind(
    subscribe: (pageId: PageId, matcher: object, listener: (e: NetworkEvent) => void) => () => void,
    pageId: PageId,
  ): () => void {
    return subscribe(pageId, {}, (event) => { this.observe(event); });
  }
}
