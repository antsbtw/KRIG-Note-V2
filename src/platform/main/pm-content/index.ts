/**
 * pm-content capability barrel (main 进程)
 *
 * 由 platform/main/ipc/ipc-bus.ts 调 registerPmContentHandlers() 一次性接进 ipc 路由。
 * graph 等 main 端模块可直接 import capability-impl 函数 (同进程内调用,
 * 跟 sub-phase 2 folder / note 同模式)。
 */

export { registerPmContentHandlers } from './handlers';
export * from './capability-impl';
