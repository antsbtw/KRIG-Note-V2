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

async function runImport(invokerWin: BrowserWindow | null): Promise<void> {
  // 定向投递的目标窗口 = 用户点菜单那一刻的聚焦窗口(在任何 dialog 之前抓拍)。
  // dialog 会夺焦,导入结束后 getFocusedWindow() 已不可信。
  const focusedWin = invokerWin && !invokerWin.isDestroyed() ? invokerWin : null;

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

  const payload: MarkdownImportRunPayload = {
    files: report.files,
    hasDirectory,
  };

  // 只投递给发起导入的那个窗口。
  //
  // 2026-08-23 修:原先 getAllWindows() 广播给所有窗口。renderer 侧 useMarkdownImport
  // 的守卫是 `getActiveWorkspaceIdSync() !== workspaceId`,该守卫只能在**单窗口内**的
  // 多个并存 NoteView 之间选出活跃 ws;多窗口时每个窗口各有自己的活跃 ws,于是
  // 每个窗口都认领 → 同一批文件被导入 N 次(note/folder 是跨 ws 共享资源,只有 web
  // 是 per-ws 的,所以重复导入会真的产生 N 份笔记)。
  // 导入是"对着当前窗口发起"的动作,定向投递才是正确语义。
  const target = focusedWin ?? BrowserWindow.getAllWindows().find((w) => !w.webContents.isDestroyed()) ?? null;
  if (!target || target.webContents.isDestroyed()) {
    console.warn('[markdown-import] no live window to receive MARKDOWN_IMPORT_RUN — aborted');
    return;
  }
  target.webContents.send(IPC_CHANNELS.MARKDOWN_IMPORT_RUN, payload);
  console.log(
    `[markdown-import] sent MARKDOWN_IMPORT_RUN → window ${target.id},files=${report.files.length}`,
  );
}

/** 注册命令 + File 菜单项 */
export function registerMarkdownImport(): void {
  menuRegistry.registerCommand('file.import-markdown', () => {
    // 抓拍:菜单触发时的聚焦窗口就是发起方,后续 dialog 会夺焦
    const invokerWin = BrowserWindow.getFocusedWindow();
    void runImport(invokerWin).catch((err) => {
      console.error('[markdown-import] runImport failed:', err);
    });
  });
}
