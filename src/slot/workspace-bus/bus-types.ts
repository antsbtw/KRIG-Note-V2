/**
 * WorkspaceBus 通用类型 — Result + Channel/Request 形态
 *
 * 见 PROTOCOL.md § 4(类型契约)+ DESIGN.md § 2(数据结构)。
 */

/** 统一错误处理类型 — 所有 bus 操作返回 Result,不抛错 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; detail?: unknown };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const fail = (reason: string, detail?: unknown): Result<never> => ({
  ok: false,
  reason,
  detail,
});

/** Channel listener 形态 */
export type ChannelListener<T = unknown> = (payload: T) => void;

/** Request handler 形态(同步或异步)*/
export type RequestHandler<I = unknown, O = unknown> = (
  input: I,
) => O | Promise<O>;

/**
 * slotBinding 更新来源标记(铁律 9 用)
 *
 * - 'navside':NavSide ViewSwitcher 点击触发 → bus 自动 closeRight
 * - 'bus':bus.slot.* API 调用触发 → 不联动
 * - 'frame':其他 frame(如关闭按钮)触发 → 不联动
 */
export type SlotUpdateSource = 'navside' | 'bus' | 'frame';
