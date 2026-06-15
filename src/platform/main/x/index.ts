/**
 * X(Twitter)集成主进程模块出口(阶段 0/1)
 *
 * 注册入口:
 *   - src/platform/main/ipc/ipc-bus.ts 调 registerXHandlers()
 *   - src/platform/main/index.ts createMainWindow 后调 registerXWebviewHook(mainWindow)
 */

export { registerXHandlers } from './handlers';
export { registerXWebviewHook } from './webview-hook';
export { registerXTestHandlers } from './test-drivers'; // 逐块底层测试(dev-only,ipc-bus 按需注册)
