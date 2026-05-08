/**
 * @deprecated W4.2 C1 起 SyncDriver 已迁到 src/drivers/web-sync-driver/
 *
 * 本文件保留 re-export 兜底。新代码请直接 import from '@drivers/web-sync-driver'。
 *
 * 注:driver 层 SyncDriver 加了 bus 接口注入(charter § 1.1 单向调用),
 * 实例化时必须传 bus 参数:`new SyncDriver(side, bus, onInputEnter?, isBusy?)`。
 */

export { SyncDriver } from '@drivers/web-sync-driver';
export type { Side, SlotMessage, SyncBus, SyncEvent, WebviewElement } from '@drivers/web-sync-driver';
