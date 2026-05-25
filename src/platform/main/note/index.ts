/**
 * note capability barrel (main 进程)
 *
 * 由 platform/main/ipc/ipc-bus.ts 调 registerNoteHandlers() 一次性接进 ipc 路由。
 * extraction 等 main 端模块可直接 import capability-impl 函数 (同进程内调用)。
 */

export { registerNoteHandlers } from './handlers';
export * from './capability-impl';
export { deriveTitle } from './derive-title';
export { broadcastNoteListChanged, broadcastNoteDocContentChanged } from './broadcast';
export { assemblePmDoc } from './assemble-pm-doc';
