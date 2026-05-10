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

      // ── L5-B3.17:yt-dlp capability ──
      /** 检查 yt-dlp 是否已安装 + 版本 */
      ytdlpCheckStatus(): Promise<{ installed: boolean; version?: string; path?: string }>;
      /** 下载并安装 yt-dlp 二进制(从 yt-dlp GitHub release latest)*/
      ytdlpInstall(): Promise<{ installed: boolean; version?: string; path?: string }>;
      /** 订阅 yt-dlp install 进度 — 返回取消订阅函数 */
      onYtdlpInstallProgress(
        callback: (progress: { percent: number; installed: boolean; version?: string; error?: string }) => void,
      ): () => void;
      /** 下载视频(走 spawn yt-dlp,自动抓 YouTube 字幕保存为 .en.srt)*/
      ytdlpDownload(
        url: string,
        outputPath?: string,
      ): Promise<{
        url: string;
        status: 'downloading' | 'complete' | 'error';
        percent: number;
        filename?: string;
        subtitleFile?: string;
        subtitleText?: string;
        error?: string;
      }>;
      /** 订阅 yt-dlp download 进度 — 返回取消订阅函数 */
      onYtdlpDownloadProgress(
        callback: (progress: {
          url: string;
          status: 'downloading' | 'complete' | 'error';
          percent: number;
          filename?: string;
          error?: string;
        }) => void,
      ): () => void;
      /** 获取视频元数据(--dump-json,不下载)*/
      ytdlpGetInfo(url: string): Promise<Record<string, unknown> | null>;
      /** 保存翻译字幕为 .srt(对齐视频文件,用于字幕系统翻译导出)*/
      ytdlpSaveSubtitle(
        videoFilePath: string,
        langCode: string,
        timestampText: string,
      ): Promise<string | null>;
      /** L5-B3.19.b:不下载视频抓 YouTube 字幕([MM:SS] timestamp text 格式;失败时 transcriptText=null + error 详情)*/
      ytdlpFetchTranscript(url: string): Promise<{
        transcriptText: string | null;
        error: string | null;
      }>;
      /** L5-B3.19.e UX:检 webview partition 是否有 YouTube 登录 cookies */
      ytdlpCheckYoutubeCookies(): Promise<{
        hasLogin: boolean;
        count: number;
        error?: string;
      }>;

      // ── L5-B3.18:tweet-fetcher 临时 capability(Phase D 被吸收)──
      /** 抓取推文元数据(BrowserWindow + DOM scraping)
       *  仅接受 https://twitter.com / https://x.com 域 */
      fetchTweetData(tweetUrl: string): Promise<{
        success: boolean;
        data?: {
          authorName?: string;
          authorHandle?: string;
          authorAvatar?: string;
          text?: string;
          createdAt?: string;
          lang?: string;
          media?: Array<{ type: 'image' | 'video'; url: string; thumbUrl?: string }>;
          metrics?: { replies?: number; retweets?: number; likes?: number; views?: number };
          quotedTweet?: string;
          inReplyTo?: string;
        };
        error?: string;
      }>;

      // ── L5-B3.20a:learning capability(vocab + dictionary + translate + TTS)──
      /** 添加生词;失败返 null */
      learningVocabAdd(
        word: string,
        definition: string,
        context?: string,
        phonetic?: string,
      ): Promise<{
        id: string;
        word: string;
        definition: string;
        context?: string;
        phonetic?: string;
        createdAt: number;
      } | null>;
      /** 删除生词(by id)*/
      learningVocabRemove(id: string): Promise<void>;
      /** 全量列表(按 createdAt 倒序)*/
      learningVocabList(): Promise<Array<{
        id: string;
        word: string;
        definition: string;
        context?: string;
        phonetic?: string;
        createdAt: number;
      }>>;
      /** 检查 word 是否已在生词本(case-insensitive)*/
      learningVocabHas(word: string): Promise<boolean>;
      /** 订阅 vocab 变化 — 返回 unsubscribe */
      onLearningVocabChanged(
        callback: (entries: Array<{
          id: string;
          word: string;
          definition: string;
          context?: string;
          phonetic?: string;
          createdAt: number;
        }>) => void,
      ): () => void;
      /** 词典查询(macOS 优先 / Google fallback)*/
      learningDictionaryLookup(word: string): Promise<{
        word: string;
        definition: string;
        phonetic?: string;
        source: string;
      } | null>;
      /** Google 翻译(targetLang 默认 'zh-CN')*/
      learningTranslate(
        text: string,
        targetLang?: string,
      ): Promise<{ text: string; sourceLang: string; targetLang: string } | null>;
      /** Google TTS — 返 MP3 ArrayBuffer,view 用 Blob 创建 audio URL */
      learningTts(text: string, lang: string): Promise<ArrayBuffer | null>;
    };
  }
}

export {};
