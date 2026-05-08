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
      /** L5-B4.3.1:base64 / data URL → media:// URL(SHA256 去重) */
      mediaPutBase64(
        input: string,
        explicitMime?: string,
        hintedFilename?: string,
      ): Promise<{ success: boolean; mediaUrl?: string; mediaId?: string; error?: string }>;
      /** L5-B4.3.1:从远程 URL 下载到 media store,返回 media:// URL */
      mediaDownload(
        url: string,
        type: 'audio' | 'image' | 'video',
      ): Promise<{ success: boolean; mediaUrl?: string; mediaId?: string; error?: string }>;
      /** L5-B3.14:media:// URL → 本地文件系统绝对路径(file-block / file-link / external-ref 用)*/
      mediaResolvePath(mediaUrl: string): Promise<{ success: boolean; path?: string }>;
      /** L5-B3.14:在 Finder 高亮显示文件 */
      showItemInFolder(filePath: string): Promise<{ ok: boolean; reason?: string }>;
      /** L5-B3.14:File → 绝对路径(同步;Electron 32+ webUtils.getPathForFile 包装)*/
      getFilePath(file: File): string;
    };
  }
}

export {};
