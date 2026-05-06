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
  async health(
    layer: 'L0' | 'L1' | 'L2' | 'L3' | 'L3.5' | 'L4' | 'L5' | 'platform',
  ): Promise<HealthCheckResponse> {
    const channel = {
      L0: IPC_CHANNELS.HEALTH_L0,
      L1: IPC_CHANNELS.HEALTH_L1,
      L2: IPC_CHANNELS.HEALTH_L2,
      L3: IPC_CHANNELS.HEALTH_L3,
      'L3.5': IPC_CHANNELS.HEALTH_L3_5,
      L4: IPC_CHANNELS.HEALTH_L4,
      L5: IPC_CHANNELS.HEALTH_L5,
      platform: IPC_CHANNELS.HEALTH_PLATFORM,
    }[layer];
    return ipcRenderer.invoke(channel);
  },

  /** 订阅窗口全屏状态变化 — 返回取消订阅函数 */
  onFullscreenChanged(callback: (isFullscreen: boolean) => void): () => void {
    const handler = (_event: unknown, isFullscreen: boolean) => callback(isFullscreen);
    ipcRenderer.on(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGED, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.WINDOW_FULLSCREEN_CHANGED, handler);
  },

  /** L5-B3.4:打开外部 URL(http/https/mailto)— 走 Electron shell.openExternal */
  async openExternal(url: string): Promise<{ ok: boolean; reason?: string }> {
    return ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, url);
  },

  /** L5-B3.4:打开文件路径(系统默认应用)— 走 Electron shell.openPath */
  async openPath(filePath: string): Promise<{ ok: boolean; reason?: string }> {
    return ipcRenderer.invoke(IPC_CHANNELS.SHELL_OPEN_PATH, filePath);
  },
});
