/**
 * WorkspaceBus 通用类型 — Result + Channel/Request 形态
 *
 * 见 PROTOCOL.md § 4(类型契约)+ DESIGN.md § 2(数据结构)。
 */

/** Result / ok / fail(Wave 3.3 起单一来源在 @shared/event-bus/result)*/
export { ok, fail } from '@shared/event-bus/result';
export type { Result } from '@shared/event-bus/result';

/** Channel listener 形态(Wave 3.3 起单一来源在 @shared/event-bus/channel)*/
export type { ChannelListener } from '@shared/event-bus/channel';

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
