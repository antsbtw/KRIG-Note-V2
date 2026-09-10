/**
 * mind 平台层入口(diglot mind v0,方案 B1)
 *
 * 由 platform/main/ipc/ipc-bus.ts 调 registerMindHandlers() 接进 ipc 路由。
 */

export { registerMindHandlers } from './handlers';
export { mindStore } from './mind-store';
export { broadcastMindListChanged } from './broadcast';
export type { MindDocRecord, MindDocListItem } from './mind-store';
