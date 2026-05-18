/**
 * thought capability barrel(main 进程)
 *
 * 由 platform/main/ipc/ipc-bus.ts 调 registerThoughtHandlers() 一次性接进 ipc 路由。
 * 同进程模块可直接 import capability-impl 函数。
 */

export { registerThoughtHandlers } from './handlers';
export * from './capability-impl';
export { wrapThoughtDoc, unwrapThoughtDoc, emptyThoughtDoc } from './envelope';
export { broadcastThoughtListChanged } from './broadcast';
