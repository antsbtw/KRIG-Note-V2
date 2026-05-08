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

import { contextBridge, ipcRenderer, webUtils } from 'electron';
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

  /** L5-B4.2:fetch Google Translate element.js(main 进程取,避 CSP)*/
  async translateFetchElementJs(): Promise<string | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.WEB_TRANSLATE_FETCH_ELEMENT_JS);
  },

  /** L5-B4.2.2:重启 app(切翻译语言后让 widget 用新 lang 重新初始化)*/
  restartApp(): void {
    ipcRenderer.send(IPC_CHANNELS.APP_RESTART);
  },

  /** L5-B4.3.1:base64 → media:// URL */
  async mediaPutBase64(
    input: string,
    explicitMime?: string,
    hintedFilename?: string,
  ): Promise<{ success: boolean; mediaUrl?: string; mediaId?: string; error?: string }> {
    return ipcRenderer.invoke(
      IPC_CHANNELS.MEDIA_PUT_BASE64,
      input,
      explicitMime,
      hintedFilename,
    );
  },

  /** L5-B4.3.1:远程 URL → media:// URL */
  async mediaDownload(
    url: string,
    type: 'audio' | 'image' | 'video',
  ): Promise<{ success: boolean; mediaUrl?: string; mediaId?: string; error?: string }> {
    return ipcRenderer.invoke(IPC_CHANNELS.MEDIA_DOWNLOAD, url, type);
  },

  /** L5-B3.14:media:// URL → 本地文件系统绝对路径 */
  async mediaResolvePath(mediaUrl: string): Promise<{ success: boolean; path?: string }> {
    return ipcRenderer.invoke(IPC_CHANNELS.MEDIA_RESOLVE_PATH, mediaUrl);
  },

  /** L5-B3.14:在 Finder 高亮显示文件 */
  async showItemInFolder(filePath: string): Promise<{ ok: boolean; reason?: string }> {
    return ipcRenderer.invoke(IPC_CHANNELS.SHELL_SHOW_ITEM_IN_FOLDER, filePath);
  },

  /**
   * L5-B3.14:File 对象 → 绝对路径(同步)
   *
   * Electron 32+ 不再暴露 File.path,必须经 webUtils.getPathForFile 取。
   * 仅 disk 来源 File 有路径(从浏览器 / Blob URL 拖入会返回空)。
   */
  getFilePath(file: File): string {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },

  // ── L5-B3.17:yt-dlp capability ──
  ytdlpCheckStatus(): Promise<{ installed: boolean; version?: string; path?: string }> {
    return ipcRenderer.invoke(IPC_CHANNELS.YTDLP_CHECK_STATUS);
  },
  ytdlpInstall(): Promise<{ installed: boolean; version?: string; path?: string }> {
    return ipcRenderer.invoke(IPC_CHANNELS.YTDLP_INSTALL);
  },
  /** 订阅 install progress — 返回取消订阅函数(对齐 onFullscreenChanged 模式)*/
  onYtdlpInstallProgress(callback: (progress: unknown) => void): () => void {
    const handler = (_event: unknown, progress: unknown): void => callback(progress);
    ipcRenderer.on(IPC_CHANNELS.YTDLP_INSTALL_PROGRESS, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.YTDLP_INSTALL_PROGRESS, handler);
  },
  ytdlpDownload(url: string, outputPath?: string): Promise<unknown> {
    return ipcRenderer.invoke(IPC_CHANNELS.YTDLP_DOWNLOAD, url, outputPath);
  },
  onYtdlpDownloadProgress(callback: (progress: unknown) => void): () => void {
    const handler = (_event: unknown, progress: unknown): void => callback(progress);
    ipcRenderer.on(IPC_CHANNELS.YTDLP_DOWNLOAD_PROGRESS, handler);
    return () => ipcRenderer.off(IPC_CHANNELS.YTDLP_DOWNLOAD_PROGRESS, handler);
  },
  ytdlpGetInfo(url: string): Promise<Record<string, unknown> | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.YTDLP_GET_INFO, url);
  },
  ytdlpSaveSubtitle(
    videoFilePath: string,
    langCode: string,
    timestampText: string,
  ): Promise<string | null> {
    return ipcRenderer.invoke(IPC_CHANNELS.YTDLP_SAVE_SUBTITLE, videoFilePath, langCode, timestampText);
  },
});
