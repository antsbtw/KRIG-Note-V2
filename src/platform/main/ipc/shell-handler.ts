/**
 * shell IPC handlers — L5-B3.4
 *
 * 给 link-click plugin 用:打开外部 URL / 文件路径。
 *
 * 安全:
 * - openExternal 仅接受 http/https/mailto schemes(防 javascript: / file: 等危险协议)
 * - openPath 仅接受绝对路径(基本防呆)
 */

import { ipcMain, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';

const ALLOWED_EXTERNAL_SCHEMES = ['http:', 'https:', 'mailto:'];

export function registerShellHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, async (_event, url: unknown) => {
    if (typeof url !== 'string' || !url) return { ok: false, reason: 'invalid-url' };
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, reason: 'parse-failed' };
    }
    if (!ALLOWED_EXTERNAL_SCHEMES.includes(parsed.protocol)) {
      return { ok: false, reason: `disallowed-scheme:${parsed.protocol}` };
    }
    try {
      await shell.openExternal(url);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_PATH, async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath) return { ok: false, reason: 'invalid-path' };
    try {
      const result = await shell.openPath(filePath);
      // shell.openPath 返回空字符串=成功;非空=错误信息
      return { ok: result === '', reason: result || undefined };
    } catch (err) {
      return { ok: false, reason: String(err) };
    }
  });

  // L5-B3.14:在 Finder 高亮显示文件(file-block / file-link / external-ref 用)
  ipcMain.handle(IPC_CHANNELS.SHELL_SHOW_ITEM_IN_FOLDER, async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath) return { ok: false, reason: 'invalid-path' };
    if (!path.isAbsolute(filePath)) return { ok: false, reason: 'not-absolute' };
    // 文件存在性检测(shell.showItemInFolder 是 fire-and-forget,文件不存在时
    // 不抛错也不返失败 — 显式检测让上层能 reset 到 idle 状态)
    if (!fs.existsSync(filePath)) {
      return { ok: false, reason: 'file-not-found' };
    }
    try {
      shell.showItemInFolder(filePath);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: String(err) };
    }
  });
}
