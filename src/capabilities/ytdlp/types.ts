/**
 * ytdlp capability — 对外类型(L5-B3.17)
 *
 * view 通过 requireCapabilityApi<YtdlpApi>('ytdlp') 取 api;
 * driver/slot 内部消费可直 import 单例 export(对齐 W5 严格态 A 边界)。
 */

export interface YtdlpStatus {
  installed: boolean;
  version?: string;
  path?: string;
}

export interface YtdlpInstallProgress {
  /** 0-100,二进制下载进度(install 期间多次 emit;完成 promise 自带最终结果)*/
  percent: number;
  /** 完成切 true,过程中 false */
  installed: boolean;
  version?: string;
  error?: string;
}

export interface YtdlpDownloadProgress {
  url: string;
  status: 'downloading' | 'complete' | 'error';
  /** 0-100,视频下载进度 */
  percent: number;
  /** 完成时的本地文件路径 */
  filename?: string;
  /** YouTube 字幕 .en.srt 路径(自动抓 — 失败静默跳过)*/
  subtitleFile?: string;
  /** [MM:SS] 格式纯文本字幕(供 view 直接展示 / 编辑)*/
  subtitleText?: string;
  error?: string;
}

/** view 业务路径 API */
export interface YtdlpApi {
  /** 检查 yt-dlp 是否已安装 + 版本 */
  checkStatus(): Promise<YtdlpStatus>;
  /** 下载并安装 yt-dlp 二进制(从 GitHub release latest)
   *  防重入:并发调用复用同 promise(避免文件竞争破坏二进制)*/
  install(): Promise<YtdlpStatus>;
  /** 订阅 install 进度 — 返回取消订阅函数 */
  onInstallProgress(callback: (progress: YtdlpInstallProgress) => void): () => void;
  /** 下载视频(自动抓 YouTube 字幕保存为 .en.srt)
   *  outputPath 可选,默认 ~/Downloads/<title>.<ext> */
  download(url: string, outputPath?: string): Promise<YtdlpDownloadProgress>;
  /** 订阅 download 进度 — 返回取消订阅函数 */
  onDownloadProgress(callback: (progress: YtdlpDownloadProgress) => void): () => void;
  /** 获取视频元数据(--dump-json,不下载;失败返回 null)*/
  getInfo(url: string): Promise<Record<string, unknown> | null>;
  /** 保存翻译字幕为 .srt(对齐视频文件目录,文件名 <video-base>.<langCode>.srt)
   *  失败 / 路径不合规返回 null */
  saveSubtitle(videoFilePath: string, langCode: string, timestampText: string): Promise<string | null>;
}
