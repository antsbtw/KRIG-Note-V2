/**
 * markdown-import 模块入口(主进程)
 *
 * 职责:
 * 1. 注册菜单命令 `file.import-markdown`(File → Import Markdown...)
 * 2. 命令触发:
 *    a. dialog.showOpenDialog 选文件/目录(macOS 支持混选;Windows 仅文件)
 *    b. scanPaths 扁平为 ScannedFile[]
 *    c. 阈值 2000 → 弹窗确认
 *    d. webContents.send MARKDOWN_IMPORT_RUN 广播给所有 renderer
 * 3. 注册 File 菜单项(被 framework-menus 调用)
 *
 * Renderer 端(use-markdown-import + markdown-import):
 *   - markdownToProseMirror 转 PM
 *   - folder 树重建 + note 落盘(参考 extraction-import)
 */

import { dialog, BrowserWindow } from 'electron';
import { menuRegistry } from '@slot/menu-registry/menu-registry';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { scanPaths } from './scanner';
import type { ScannedFile } from './scanner';

const CONFIRM_THRESHOLD = 2000;

/** main → renderer broadcast payload */
export interface MarkdownImportRunPayload {
  files: ScannedFile[];
  /** 用户选目录时, paths 含 ≥1 个 directory;只选文件时为 false */
  hasDirectory: boolean;
}

async function runImport(): Promise<void> {
  const focusedWin = BrowserWindow.getFocusedWindow();

  const dialogResult = await dialog.showOpenDialog({
    title: 'Import Markdown',
    buttonLabel: 'Import',
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  });

  if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
    return;
  }

  const paths = dialogResult.filePaths;

  // 判断是否含目录(影响 renderer 是否走 folder 树重建)
  let hasDirectory = false;
  try {
    const fs = await import('node:fs');
    hasDirectory = paths.some((p) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    /* 默认 false */
  }

  // 扫描
  const report = scanPaths(paths);

  if (report.skipped.length > 0) {
    console.log(
      `[markdown-import] skipped ${report.skipped.length} entries (blacklist / non-md)`,
    );
  }
  if (report.failed.length > 0) {
    console.warn(`[markdown-import] failed ${report.failed.length} entries:`, report.failed);
  }

  if (report.files.length === 0) {
    await dialog.showMessageBox(focusedWin ?? new BrowserWindow(), {
      type: 'info',
      title: 'Import Markdown',
      message: 'No markdown files found in the selection.',
      detail:
        report.failed.length > 0
          ? `${report.failed.length} entries failed to read.`
          : undefined,
    });
    return;
  }

  // 软上限确认
  if (report.files.length > CONFIRM_THRESHOLD) {
    const choice = await dialog.showMessageBox(focusedWin ?? new BrowserWindow(), {
      type: 'question',
      buttons: ['Cancel', 'Import All'],
      defaultId: 0,
      cancelId: 0,
      title: 'Confirm Large Import',
      message: `Found ${report.files.length} markdown files.`,
      detail: 'This looks like a very large import. Continue?',
    });
    if (choice.response !== 1) return;
  }

  // 广播给所有 renderer 窗口(handler 自身幂等去重,跟 extraction-import 同模式)
  const payload: MarkdownImportRunPayload = {
    files: report.files,
    hasDirectory,
  };

  const windows = BrowserWindow.getAllWindows();
  let sent = 0;
  for (const win of windows) {
    if (win.webContents.isDestroyed()) continue;
    win.webContents.send(IPC_CHANNELS.MARKDOWN_IMPORT_RUN, payload);
    sent++;
  }
  console.log(
    `[markdown-import] broadcast MARKDOWN_IMPORT_RUN → ${sent} window(s),files=${report.files.length}`,
  );
}

/** 注册命令 + File 菜单项 */
export function registerMarkdownImport(): void {
  menuRegistry.registerCommand('file.import-markdown', () => {
    void runImport().catch((err) => {
      console.error('[markdown-import] runImport failed:', err);
    });
  });
}
