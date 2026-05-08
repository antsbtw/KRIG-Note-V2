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

import { ipcMain } from 'electron';
import * as path from 'path';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { checkStatus, install } from './binary-manager';
import { downloadVideo, getVideoInfo, saveTranslationSubtitle } from './downloader';

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
}
