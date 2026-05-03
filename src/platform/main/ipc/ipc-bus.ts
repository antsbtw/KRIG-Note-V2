/**
 * IPC 总线
 *
 * L0 阶段最小实现:仅触发健康检查 handlers 注册。
 * 后期可扩展为统一的 IPC 路由 + 消息记录等。
 */

import { registerHealthCheckHandlers } from './health-check';

export function initIpcBus(): void {
  registerHealthCheckHandlers();
}
