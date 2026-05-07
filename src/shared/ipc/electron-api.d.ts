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
      health(layer: 'L0' | 'L1' | 'L2' | 'L3' | 'L3.5' | 'L4' | 'L5' | 'platform'): Promise<HealthCheckResponse>;
      /** 订阅窗口全屏状态变化,返回取消订阅函数 */
      onFullscreenChanged(callback: (isFullscreen: boolean) => void): () => void;
      /** L5-B3.4:打开外部 URL(http/https/mailto)— shell.openExternal */
      openExternal(url: string): Promise<{ ok: boolean; reason?: string }>;
      /** L5-B3.4:打开文件路径(系统默认应用)— shell.openPath */
      openPath(filePath: string): Promise<{ ok: boolean; reason?: string }>;
      /** L5-B4.2:fetch Google Translate element.js(main 取后注入 webview,避 CSP)*/
      translateFetchElementJs(): Promise<string | null>;
      /** L5-B4.2.2:重启 app(切翻译语言后让 widget 用新 lang 重新初始化)*/
      restartApp(): void;
    };
  }
}

export {};
