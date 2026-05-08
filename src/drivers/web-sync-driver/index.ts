/**
 * web-sync-driver — driver 层入口(W4.2 C1)
 *
 * 双 webview 事件同步引擎(SyncDriver)+ 协议常量。
 * driver 协议铁律:不依赖 view/capability 模块,bus 通过构造函数接口注入。
 */

export { SyncDriver } from './sync-driver';
export type { Side, SlotMessage, SyncBus, SyncEvent, WebviewElement } from './sync-driver';
export { SYNC_ACTION, WEB_TRANSLATE_PROTOCOL } from './sync-protocol';
