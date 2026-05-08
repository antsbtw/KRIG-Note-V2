/**
 * mediaStore IPC handlers — L5-B4.3.1
 *
 * Renderer 通过 window.electronAPI.mediaPutBase64 / mediaDownload 调用,本文件
 * 注册对应的 ipcMain.handle。实际逻辑在 media-store-impl.ts。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { mediaStore, resolveMediaPath } from './media-store-impl';

export function registerMediaHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.MEDIA_PUT_BASE64,
    async (
      _event,
      input: unknown,
      explicitMime: unknown,
      hintedFilename: unknown,
    ) => {
      if (typeof input !== 'string' || !input) {
        return { success: false, error: 'invalid input' };
      }
      const mime = typeof explicitMime === 'string' ? explicitMime : undefined;
      const hint = typeof hintedFilename === 'string' ? hintedFilename : undefined;
      return mediaStore.putBase64(input, mime, hint);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.MEDIA_DOWNLOAD,
    async (_event, url: unknown, type: unknown) => {
      if (typeof url !== 'string' || !url) {
        return { success: false, error: 'invalid url' };
      }
      if (type !== 'audio' && type !== 'image' && type !== 'video') {
        return { success: false, error: `invalid type: ${String(type)}` };
      }
      return mediaStore.download(url, type);
    },
  );

  // L5-B3.14:media:// URL → 本地文件系统绝对路径(file-block / file-link / external-ref 用)
  ipcMain.handle(
    IPC_CHANNELS.MEDIA_RESOLVE_PATH,
    async (_event, mediaUrl: unknown) => {
      if (typeof mediaUrl !== 'string' || !mediaUrl) {
        return { success: false };
      }
      const resolved = resolveMediaPath(mediaUrl);
      return resolved ? { success: true, path: resolved } : { success: false };
    },
  );
}
