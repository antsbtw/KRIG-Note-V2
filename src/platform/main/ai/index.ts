/**
 * ai-extraction 主进程模块出口
 *
 * 注册入口:
 *   - src/platform/main/ipc/ipc-bus.ts 调 registerAIHandlers()
 *   - src/platform/main/index.ts createMainWindow 后调 registerAIWebviewHook(mainWindow)
 */

export { registerAIHandlers } from './handlers';
export { registerAIWebviewHook } from './webview-hook';
