/**
 * IPC 总线
 *
 * 集中注册各类 IPC handler。后期可扩展为统一的 IPC 路由 + 消息记录等。
 */

import { registerHealthCheckHandlers } from './health-check';
import { registerDiagnosticsHandlers } from './diagnostics-handler';
import { registerShellHandlers } from './shell-handler';
import { registerWebTranslateHandlers } from './web-translate-handler';
import { registerAppHandlers } from './app-handler';
import { registerMediaHandlers } from '../media/media-handlers';

export function initIpcBus(): void {
  registerHealthCheckHandlers();
  registerDiagnosticsHandlers();
  registerShellHandlers();
  registerWebTranslateHandlers();
  registerAppHandlers();
  registerMediaHandlers();
}
