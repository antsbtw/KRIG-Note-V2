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
 * - 新订阅 toSide 时 → flush pending[toSide] 给新 listener(单次性)
 * - 仅缓存 1 秒内的消息(防止旧消息长期堆积 — 一般 mount 时序差距 < 100ms)
 */
interface PendingMessage {
  message: SlotMessage;
  fromSide: Side;
  ts: number;
}

/**
 * pending TTL:5 秒(从 1 秒放宽 — webview about:blank 加载有时慢,
 * left subscribe 可能比 right mount 晚 1+ 秒)
 *
 * 设大点的代价:跨翻译 toggle 周期残留旧消息?— 不会,subscribe flush 后 set([])
 * 立刻清空 pending,新订阅者不会重收旧消息。
 */
const PENDING_TTL_MS = 5000;

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
    console.log(
      `[slot-bus] send ${fromSide}→${toSide}: ${message.action} (listeners: ${set?.size ?? 0})`,
    );

    // 若 toSide 暂无订阅者 → 缓冲(等订阅时 flush 全部,无 TTL)
    if (!set || set.size === 0) {
      const buf = this.pending.get(toSide);
      if (buf) {
        buf.push({ message, fromSide, ts: now });
      }
      console.log(`[slot-bus v2] no listener,push pending → size ${this.pending.get(toSide)?.length}`);
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
    console.log(
      `[slot-bus] subscribe ${toSide} (total listeners: ${set.size}, pending: ${this.pending.get(toSide)?.length ?? 0})`,
    );

    // flush 缓冲消息(给新 listener)— 不再过滤 TTL,所有 pending 一律 flush
    // (L5-B4.2 验证:TTL 过滤导致 mount 慢机器丢消息;subscribe 时如果还有 pending,
    //  说明就是为这次 subscribe 攒的消息,不应过滤)
    const buf = this.pending.get(toSide);
    if (buf && buf.length > 0) {
      const allMsgs = buf.slice();
      this.pending.set(toSide, []);
      console.log(`[slot-bus v2] flush ALL ${allMsgs.length} pending → ${toSide}`);
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
