/**
 * ytdlp capability — renderer 侧 yt-dlp 能力封装(L5-B3.17)
 *
 * 职责:把 yt-dlp 二进制能力(checkStatus / install / 视频下载 / metadata / 字幕保存)
 * 暴露给 view / driver 层。下游消费者:
 * - L5-B3.18 tweet-block:推文视频下载
 * - L5-B3.19 video 字幕系统:saveSubtitle 写翻译字幕
 * - Phase E 通用媒体下载:任意 yt-dlp 支持站点(YouTube / Vimeo / Bilibili / etc.)
 *
 * 实现位置:src/platform/main/ytdlp/ — binary-manager / downloader / handlers。
 * 本文件是 renderer 侧 IPC 调用封装 + Registry 注册门面。
 *
 * ── W5 严格态边界(audit § 5.2 定义 A)──
 *
 * View 侧(强制):走 requireCapabilityApi('ytdlp').download(url) 间接路由
 * Driver/slot 侧(允许):可直 import @capabilities/ytdlp 单例兜底
 *   ↑ 临时允许项,非全局严格态(B/C)达成态;后续 charter v0.5 升级时统一改造
 *
 * 模块级 export 同时挂(双导出),对齐 media-storage / text-editing / web-rendering 现有写法。
 *
 * ── 平台限制 ──
 *
 * 本阶段沿用 V1,yt-dlp 二进制 macOS-only(下载 yt-dlp_macos)。Windows / Linux
 * 留 Phase E 跨平台支持。
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import type {
  YtdlpApi,
  YtdlpStatus,
  YtdlpInstallProgress,
  YtdlpDownloadProgress,
  FetchTranscriptResult,
  YoutubeCookiesStatus,
} from './types';

export type {
  YtdlpApi,
  YtdlpStatus,
  YtdlpInstallProgress,
  YtdlpDownloadProgress,
  FetchTranscriptResult,
  YoutubeCookiesStatus,
} from './types';

/** 检查 yt-dlp 是否已安装 + 版本号 */
export async function checkStatus(): Promise<YtdlpStatus> {
  if (!window.electronAPI?.ytdlpCheckStatus) {
    return { installed: false };
  }
  return window.electronAPI.ytdlpCheckStatus();
}

/**
 * 下载并安装 yt-dlp 二进制(从 GitHub release latest)
 *
 * 防重入:main 侧维护 installPromise 单例,并发调用复用同 promise。
 * 失败时 promise reject(网络问题 / GitHub 不可达等)— 调用方建议 try/catch。
 */
export async function install(): Promise<YtdlpStatus> {
  if (!window.electronAPI?.ytdlpInstall) {
    return { installed: false };
  }
  return window.electronAPI.ytdlpInstall();
}

/**
 * 订阅 yt-dlp install 进度(install 期间多次 emit;完成后由 install promise 自带最终结果)
 *
 * 多订阅模式:多个订阅者并存,每个订阅返回独立 unsubscribe 函数。
 * 对齐 V2 onFullscreenChanged 模式。
 */
export function onInstallProgress(
  callback: (progress: YtdlpInstallProgress) => void,
): () => void {
  if (!window.electronAPI?.onYtdlpInstallProgress) return () => {};
  return window.electronAPI.onYtdlpInstallProgress(callback);
}

/**
 * 下载视频(spawn yt-dlp,自动抓 YouTube 字幕保存为 .en.srt)
 *
 * @param outputPath 可选,默认 ~/Downloads/<title>.<ext>
 */
export async function download(
  url: string,
  outputPath?: string,
  partition?: string,
): Promise<YtdlpDownloadProgress> {
  if (!window.electronAPI?.ytdlpDownload) {
    return { url, status: 'error', percent: 0, error: 'electronAPI.ytdlpDownload not available' };
  }
  return window.electronAPI.ytdlpDownload(url, outputPath, partition);
}

/**
 * 订阅 yt-dlp download 进度(每次 percent 变化 emit)
 *
 * 多订阅模式;返回 unsubscribe 函数。
 */
export function onDownloadProgress(
  callback: (progress: YtdlpDownloadProgress) => void,
): () => void {
  if (!window.electronAPI?.onYtdlpDownloadProgress) return () => {};
  return window.electronAPI.onYtdlpDownloadProgress(callback);
}

/** 获取视频元数据(--dump-json,不下载;失败返 null)*/
export async function getInfo(url: string): Promise<Record<string, unknown> | null> {
  if (!window.electronAPI?.ytdlpGetInfo) return null;
  return window.electronAPI.ytdlpGetInfo(url);
}

/**
 * 保存翻译字幕为 .srt(对齐视频文件目录,文件名 <video-base>.<langCode>.srt)
 *
 * 路径安全:main 侧已校验 isAbsolute + 不含 ..,langCode 限正则 [a-z]{2,5}(-[A-Za-z]{2,4})?。
 * 失败(路径不合规 / 写入失败)返回 null。
 */
export async function saveSubtitle(
  videoFilePath: string,
  langCode: string,
  timestampText: string,
): Promise<string | null> {
  if (!window.electronAPI?.ytdlpSaveSubtitle) return null;
  return window.electronAPI.ytdlpSaveSubtitle(videoFilePath, langCode, timestampText);
}

/**
 * L5-B3.19.b:不下载视频抓 YouTube 字幕(供 📝 import 按钮)
 *
 * 失败时不抛 — 返回 `{transcriptText: null, error: 详情}` 让调用方决定 UI 反馈。
 * 分层方向:capability 自己 narrowing electron-api inline shape 到 FetchTranscriptResult
 * (两侧结构等价,P1 修正后无 cross-import)。
 */
export async function fetchTranscript(url: string): Promise<FetchTranscriptResult> {
  if (!window.electronAPI?.ytdlpFetchTranscript) {
    return { transcriptText: null, error: 'electronAPI.ytdlpFetchTranscript not available' };
  }
  return window.electronAPI.ytdlpFetchTranscript(url) as Promise<FetchTranscriptResult>;
}

/**
 * L5-B3.19.e:检查 webview partition 是否有 YouTube 登录 cookies
 *
 * download-button 在 install yt-dlp 完成后 / 实际 download 前调:
 * - hasLogin: true  → 直接 download(yt-dlp 用 webview 导出的 cookies 过反爬)
 * - hasLogin: false → 显 modal 提示用户先在 web view 登录 YouTube
 */
export async function checkYoutubeCookies(partition?: string): Promise<YoutubeCookiesStatus> {
  if (!window.electronAPI?.ytdlpCheckYoutubeCookies) {
    return { hasLogin: false, count: 0, error: 'electronAPI.ytdlpCheckYoutubeCookies not available' };
  }
  return window.electronAPI.ytdlpCheckYoutubeCookies(partition) as Promise<YoutubeCookiesStatus>;
}

// W5 严格态:Registry 注册 + api 字段(view 通过 requireCapabilityApi 间接路由)
// W5 边界 A 临时允许项:同时保留模块级 export(driver/slot 内部消费可直 import)
capabilityRegistry.register({
  id: 'ytdlp',
  api: {
    checkStatus,
    install,
    onInstallProgress,
    download,
    onDownloadProgress,
    getInfo,
    saveSubtitle,
    fetchTranscript,
    checkYoutubeCookies,
  } satisfies YtdlpApi,
});
