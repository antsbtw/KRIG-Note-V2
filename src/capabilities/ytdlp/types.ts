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

/** L5-B3.19.b:不下载视频抓 YouTube 字幕的结果 */
export interface FetchTranscriptResult {
  /** 成功:`[MM:SS] text` 格式纯文本(对齐 download 内部 subtitleText 生成方式)*/
  transcriptText: string | null;
  /** 失败原因(用户可读 — "字幕不可用" / "网络错误" 等);成功时 null */
  error: string | null;
}

/** L5-B3.19.e:检 webview YouTube 登录 cookies 的结果 */
export interface YoutubeCookiesStatus {
  hasLogin: boolean;
  count: number;
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
  /** L5-B3.19.b:不下载视频抓 YouTube 字幕(供 video-block 📝 import 按钮)*/
  fetchTranscript(url: string): Promise<FetchTranscriptResult>;
  /** L5-B3.19.e:检 webview YouTube 登录 cookies(供 download-button 提示用户登录)*/
  checkYoutubeCookies(): Promise<YoutubeCookiesStatus>;
}
