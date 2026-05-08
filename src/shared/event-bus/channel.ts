/**
 * ChannelHub — 通用内存 pub/sub 原语
 *
 * 见 slot/workspace-bus/PROTOCOL.md(Channel 管道)+ DESIGN.md § 2 + § 4.3(emit 链)。
 *
 * 关键:
 * - lastValue 仅内存(铁律 — 不持久化)
 * - emit 错误隔离(一个 listener 抛错不影响其他)
 * - notifyDepth 检测同步循环 dev warn(禁区 3)
 *
 * 历史:Wave 3.3 之前位于 src/slot/workspace-bus/channel.ts,因 5 个
 * capability 反向 import 形成"能力层 → L4 基础设施"的纵向逆流(audit
 * P2-6)。本质上是纯内存 pub/sub,不含 workspace/slot 语义,故下沉到
 * shared/。slot/workspace-bus/channel.ts 保留 re-export 兜底。
 */

/** Channel listener 形态 */
export type ChannelListener<T = unknown> = (payload: T) => void;

const MAX_DEPTH_WARN = 5;

export class ChannelHub {
  private listeners = new Map<string, Set<ChannelListener>>();
  private lastValues = new Map<string, unknown>();
  private notifyDepth = 0;

  emit(channel: string, payload: unknown): void {
    this.lastValues.set(channel, payload);

    this.notifyDepth++;
    if (
      this.notifyDepth > MAX_DEPTH_WARN &&
      typeof process !== 'undefined' &&
      process.env?.NODE_ENV === 'development'
    ) {
      console.warn(
        `[bus] emit chain depth ${this.notifyDepth} on '${channel}', possible loop`,
      );
    }

    const set = this.listeners.get(channel);
    if (set) {
      // 复制一份避免 listener 内 unsubscribe 改 set
      const copy = Array.from(set);
      copy.forEach((l) => {
        try {
          l(payload);
        } catch (e) {
          console.error(`[bus] listener error on '${channel}':`, e);
        }
      });
    }
    this.notifyDepth--;
  }

  subscribe(channel: string, listener: ChannelListener): () => void {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(channel);
    };
  }

  /** 获取 channel 最近一次 emit 的值(无则 undefined)*/
  getLastValue(channel: string): unknown | undefined {
    return this.lastValues.get(channel);
  }

  /** 已注册 channel 数(诊断用)*/
  get channelCount(): number {
    return this.listeners.size;
  }

  /** 清空(Workspace 销毁时调)*/
  dispose(): void {
    this.listeners.clear();
    this.lastValues.clear();
  }
}
