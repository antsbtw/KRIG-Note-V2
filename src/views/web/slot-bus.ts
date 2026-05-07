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

class SlotBus {
  /** 按目标 side 订阅:listeners.get('right') = 监听"发往右侧"的消息 */
  private listeners: Map<Side, Set<Listener>> = new Map([
    ['left', new Set()],
    ['right', new Set()],
  ]);

  /**
   * fromSide 发消息给对面(toSide = fromSide 反面)
   *
   * 实现注:用 setTimeout 0 延迟分发,避免 sync 调用栈嵌套(模拟 IPC 异步语义,
   * 跟 V1 行为一致 — V1 是真异步 IPC,V2 模拟同步避免 listener 抛错把 sender 也搞挂)
   */
  sendFromSide(fromSide: Side, message: SlotMessage): void {
    const toSide: Side = fromSide === 'left' ? 'right' : 'left';
    const set = this.listeners.get(toSide);
    if (!set || set.size === 0) return;
    // 异步分发(模拟 V1 IPC)
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
   * 订阅"发往本 side 的消息"(典型场景:右栏 view subscribe('right', handler) 收来自左侧的消息)
   *
   * 返回 unsubscribe 函数。
   */
  subscribe(toSide: Side, listener: Listener): () => void {
    const set = this.listeners.get(toSide);
    if (!set) return () => {};
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }
}

export const slotBus = new SlotBus();
