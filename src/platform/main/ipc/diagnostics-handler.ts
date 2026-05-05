/**
 * 诊断上报 IPC handler
 *
 * 接收 renderer 通过 `diagnostics.report-alive` channel 上报的诊断信号,
 * 转发到主进程 diagnostics-bus 统一处理。
 *
 * L2 阶段引入(让 renderer L2 / Renderer 能输出统一格式诊断行)。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type { DiagnosticsReportPayload } from '@shared/ipc/message-types';
import { markAlive } from '../diagnostics/diagnostics-bus';

export function registerDiagnosticsHandlers(): void {
  ipcMain.on(IPC_CHANNELS.DIAGNOSTICS_REPORT_ALIVE, (_event, payload: DiagnosticsReportPayload) => {
    markAlive(payload.layer, payload.details);
  });
}
