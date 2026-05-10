/**
 * yt-dlp IPC handlers — L5-B3.17
 *
 * 5 个 invoke + 2 个 progress 推送(install / download):
 * - YTDLP_CHECK_STATUS:checkStatus 透传
 * - YTDLP_INSTALL:install 触发,期间 webContents.send YTDLP_INSTALL_PROGRESS
 * - YTDLP_DOWNLOAD:downloadVideo 触发,期间 webContents.send YTDLP_DOWNLOAD_PROGRESS
 * - YTDLP_GET_INFO:getVideoInfo 透传
 * - YTDLP_SAVE_SUBTITLE:saveTranslationSubtitle 透传(加路径安全校验 — 决策 Q4)
 *
 * 跟 src/platform/main/ipc/ 下其他 handler 同风格(集中导出 register* 函数,
 * 不用 index.ts 聚合 — V2 main 模块平铺约定)。
 */

import { ipcMain, session } from 'electron';
import * as path from 'path';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { checkStatus, install } from './binary-manager';
import { downloadVideo, getVideoInfo, saveTranslationSubtitle } from './downloader';
import { fetchYouTubeTranscript } from './fetch-transcript';

const WEBVIEW_PARTITION = 'persist:webview';

export function registerYtdlpHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.YTDLP_CHECK_STATUS, async () => {
    return checkStatus();
  });

  ipcMain.handle(IPC_CHANNELS.YTDLP_INSTALL, async (event) => {
    const sender = event.sender;
    return install((percent) => {
      // 进度推送(每个 chunk 触发);完成后由 invoke 的 return 自带最终结果
      if (!sender.isDestroyed()) {
        sender.send(IPC_CHANNELS.YTDLP_INSTALL_PROGRESS, { percent, installed: false });
      }
    });
  });

  ipcMain.handle(
    IPC_CHANNELS.YTDLP_DOWNLOAD,
    async (event, url: unknown, outputPath: unknown) => {
      console.log('[ytdlp download] handler called, url=', url);
      if (typeof url !== 'string' || !url) {
        console.warn('[ytdlp download] invalid url, abort');
        return { url: '', status: 'error', percent: 0, error: 'invalid url' };
      }
      const out = typeof outputPath === 'string' ? outputPath : undefined;
      const sender = event.sender;
      let lastLogPct = -10;
      const result = await downloadVideo(
        url,
        (progress) => {
          if (!sender.isDestroyed()) {
            sender.send(IPC_CHANNELS.YTDLP_DOWNLOAD_PROGRESS, progress);
          }
          // main 侧每 10% log,看 yt-dlp stdout 是否在推进
          const p = progress.percent || 0;
          if (p - lastLogPct >= 10) {
            console.log(`[ytdlp download] progress ${Math.round(p)}% status=${progress.status}`);
            lastLogPct = p;
          }
        },
        out,
      );
      console.log('[ytdlp download] handler returning, status=', result.status, 'filename=', result.filename, 'error=', result.error);
      return result;
    },
  );

  ipcMain.handle(IPC_CHANNELS.YTDLP_GET_INFO, async (_event, url: unknown) => {
    if (typeof url !== 'string' || !url) return null;
    return getVideoInfo(url);
  });

  ipcMain.handle(
    IPC_CHANNELS.YTDLP_SAVE_SUBTITLE,
    async (
      _event,
      videoFilePath: unknown,
      langCode: unknown,
      timestampText: unknown,
    ): Promise<string | null> => {
      if (
        typeof videoFilePath !== 'string' ||
        typeof langCode !== 'string' ||
        typeof timestampText !== 'string'
      ) {
        return null;
      }
      // 安全(决策 Q4):必须绝对路径 + 不含 .. 防呆
      // 实际生产路径只由 video block 调,不暴露用户输入,风险低
      if (!path.isAbsolute(videoFilePath) || videoFilePath.includes('..')) {
        return null;
      }
      // langCode 防呆:只允许 [a-z]{2,5}(-[A-Za-z]{2,4})?,避免 ../ 注入到 .srt 文件名
      if (!/^[a-z]{2,5}(-[A-Za-z]{2,4})?$/.test(langCode)) {
        return null;
      }
      try {
        return saveTranslationSubtitle(videoFilePath, langCode, timestampText);
      } catch (err) {
        console.warn('[ytdlp] saveTranslationSubtitle failed:', err);
        return null;
      }
    },
  );

  // L5-B3.19.b:不下载视频抓 YouTube 字幕
  ipcMain.handle(IPC_CHANNELS.YTDLP_FETCH_TRANSCRIPT, async (_event, url: unknown) => {
    if (typeof url !== 'string' || !url) {
      return { transcriptText: null, error: 'invalid url' };
    }
    return fetchYouTubeTranscript(url);
  });

  // L5-B3.19.e UX:检 webview partition 是否有 YouTube 登录 cookies
  // (download-button 在 install 后 / download 前调,无 cookies 时弹提示让
  // 用户先在 web view 登录 — 不读用户系统 Chrome,隐私友好)
  ipcMain.handle(IPC_CHANNELS.YTDLP_CHECK_YOUTUBE_COOKIES, async () => {
    try {
      const webviewSession = session.fromPartition(WEBVIEW_PARTITION);
      const yt = await webviewSession.cookies.get({ domain: '.youtube.com' });
      const google = await webviewSession.cookies.get({ domain: '.google.com' });
      return { hasLogin: yt.length > 0 || google.length > 0, count: yt.length + google.length };
    } catch (e) {
      return { hasLogin: false, count: 0, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
