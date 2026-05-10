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
      if (typeof url !== 'string' || !url) {
        return { url: '', status: 'error', percent: 0, error: 'invalid url' };
      }
      const out = typeof outputPath === 'string' ? outputPath : undefined;
      const sender = event.sender;
      return downloadVideo(
        url,
        (progress) => {
          if (!sender.isDestroyed()) {
            sender.send(IPC_CHANNELS.YTDLP_DOWNLOAD_PROGRESS, progress);
          }
        },
        out,
      );
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
  //
  // 关键:仅"有 cookies"不算登录(访问过 youtube.com 都会有 PREF/VISITOR_INFO
  // 等访客 cookies)。真登录要看 Google/YouTube 特定 session cookies:
  // - SID / HSID / SSID / APISID / SAPISID(Google account session)
  // - __Secure-1PSID / __Secure-3PSID(secure session)
  // - LOGIN_INFO(YouTube login marker)
  // 任一存在就视为已登录。
  ipcMain.handle(IPC_CHANNELS.YTDLP_CHECK_YOUTUBE_COOKIES, async () => {
    try {
      const webviewSession = session.fromPartition(WEBVIEW_PARTITION);
      const yt = await webviewSession.cookies.get({ domain: '.youtube.com' });
      const google = await webviewSession.cookies.get({ domain: '.google.com' });
      const all = [...yt, ...google];
      const LOGIN_NAMES = new Set([
        'SID', 'HSID', 'SSID', 'APISID', 'SAPISID',
        '__Secure-1PSID', '__Secure-3PSID',
        '__Secure-1PAPISID', '__Secure-3PAPISID',
        'LOGIN_INFO',
      ]);
      const loginCookies = all.filter((c) => LOGIN_NAMES.has(c.name));
      return {
        hasLogin: loginCookies.length > 0,
        count: all.length,
        loginCount: loginCookies.length,
      };
    } catch (e) {
      return { hasLogin: false, count: 0, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
