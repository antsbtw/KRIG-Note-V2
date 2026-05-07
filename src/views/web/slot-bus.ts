/**
 * Web slot bus(L5-B4.2)
 *
 * V2 架构红利:左右 webview 都在同一 React tree 内的 renderer,
 * 跨 slot 通信不需要走 IPC,直接 module-level event emitter 即可。
 *
 * 跟 V1 main 进程转发的对比:
 * - V1:left renderer → ipcRenderer.send → main → webContents.send → right renderer
 * - V2:left module → emitter.emit → right module
 *
 * 用途:
 * - sync driver 跨 slot 发送 SYNC_EVENTS / NAVIGATE / TAKE_CONTROL
 * - 未来其他跨 slot 协议复用同一 bus(走 protocol 字段区分)
 */

export interface SlotMessage {
  /** 协议名(如 'web-translate')*/
  protocol: string;
  /** 动作(协议内部定义)*/
  action: string;
  payload: unknown;
}

export type Side = 'left' | 'right';

type Listener = (message: SlotMessage, fromSide: Side) => void;

/**
 * 待送达消息缓冲(来自 fromSide,toSide 还无订阅者时暂存)
 *
 * 解决时序竞态:用户点翻译 → React 同帧内左/右 view useEffect 都会跑,
 * 但顺序不保证。右栏 setupWebview 立刻发 REQUEST_URL 时左栏 listener 可能还没注册,
 * 消息会被丢弃。
 *
 * 缓冲策略:
 * - 发消息时若 toSide 无订阅者 → push 到 pending[toSide]
 * - 新订阅 toSide 时 → flush 全部 pending 给新 listener(单次性,清空)
 * - 不用 TTL 过滤(实测 webview 初始化耗时不可预测,TTL 经常误杀)
 */
interface PendingMessage {
  message: SlotMessage;
  fromSide: Side;
  ts: number;
}

class SlotBus {
  /** 按目标 side 订阅:listeners.get('right') = 监听"发往右侧"的消息 */
  private listeners: Map<Side, Set<Listener>> = new Map([
    ['left', new Set()],
    ['right', new Set()],
  ]);

  /** 待 flush 的消息缓冲(toSide → 消息列表)*/
  private pending: Map<Side, PendingMessage[]> = new Map([
    ['left', []],
    ['right', []],
  ]);

  /**
   * fromSide 发消息给对面(toSide = fromSide 反面)
   */
  sendFromSide(fromSide: Side, message: SlotMessage): void {
    const toSide: Side = fromSide === 'left' ? 'right' : 'left';
    const set = this.listeners.get(toSide);
    const now = Date.now();

    // 若 toSide 暂无订阅者 → 缓冲(等订阅时 flush 全部,无 TTL)
    if (!set || set.size === 0) {
      const buf = this.pending.get(toSide);
      if (buf) {
        buf.push({ message, fromSide, ts: now });
      }
      return;
    }

    // 有订阅者 → 异步分发(模拟 V1 IPC)
    queueMicrotask(() => {
      set.forEach((listener) => {
        try {
          listener(message, fromSide);
        } catch (err) {
          console.error('[slot-bus] listener error:', err);
        }
      });
    });
  }

  /**
   * 订阅"发往本 side 的消息"
   *
   * 订阅时 flush pending(toSide) 中未过期消息给新 listener — 解决"消息抢先 listener"竞态。
   */
  subscribe(toSide: Side, listener: Listener): () => void {
    const set = this.listeners.get(toSide);
    if (!set) return () => {};
    set.add(listener);

    // flush 缓冲消息(给新 listener)— 不过滤 TTL,所有 pending 一律 flush
    // (subscribe 时如果还有 pending,说明就是为这次 subscribe 攒的消息)
    const buf = this.pending.get(toSide);
    if (buf && buf.length > 0) {
      const allMsgs = buf.slice();
      this.pending.set(toSide, []);
      queueMicrotask(() => {
        for (const pm of allMsgs) {
          try {
            listener(pm.message, pm.fromSide);
          } catch (err) {
            console.error('[slot-bus] listener error (flush):', err);
          }
        }
      });
    }

    return () => {
      set.delete(listener);
    };
  }
}

export const slotBus = new SlotBus();
