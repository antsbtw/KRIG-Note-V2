/**
 * 主窗口 preload 脚本
 *
 * L2 阶段引入:让 renderer 通过 window.electronAPI 调用 IPC。
 * 当前仅暴露:
 * - reportAlive(payload):诊断上报
 * - health(layer):健康检查查询
 *
 * 后续阶段按需扩展。
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type {
  DiagnosticsReportPayload,
  HealthCheckResponse,
} from '@shared/ipc/message-types';

contextBridge.exposeInMainWorld('electronAPI', {
  /** 诊断上报(renderer → main) */
  reportAlive(payload: DiagnosticsReportPayload): void {
    ipcRenderer.send(IPC_CHANNELS.DIAGNOSTICS_REPORT_ALIVE, payload);
  },

  /** 健康检查查询(renderer → main → 同步返回) */
  async health(layer: 'L0' | 'L1' | 'L2' | 'platform'): Promise<HealthCheckResponse> {
    const channel = {
      L0: IPC_CHANNELS.HEALTH_L0,
      L1: IPC_CHANNELS.HEALTH_L1,
      L2: IPC_CHANNELS.HEALTH_L2,
      platform: IPC_CHANNELS.HEALTH_PLATFORM,
    }[layer];
    return ipcRenderer.invoke(channel);
  },
});
