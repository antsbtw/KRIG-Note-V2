/**
 * window.electronAPI 类型声明(renderer 全局)
 *
 * 与 src/platform/main/preload/main-window-preload.ts 暴露的 API 对应。
 */

import type {
  DiagnosticsReportPayload,
  HealthCheckResponse,
} from './message-types';

declare global {
  interface Window {
    electronAPI: {
      reportAlive(payload: DiagnosticsReportPayload): void;
      health(layer: 'L0' | 'L1' | 'L2' | 'L3' | 'platform'): Promise<HealthCheckResponse>;
      /** 订阅窗口全屏状态变化,返回取消订阅函数 */
      onFullscreenChanged(callback: (isFullscreen: boolean) => void): () => void;
    };
  }
}

export {};
