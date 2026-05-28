/**
 * word-import 模块入口(主进程)
 *
 * 职责:
 * 1. 注册菜单命令 `file.import-word`(File → Import Word...)
 * 2. 命令触发:
 *    a. dialog 选 .docx 文件 / 目录(macOS 支持混选)
 *    b. mammoth + turndown 转 .docx → markdown
 *    c. 包成 ScannedFile[],复用 markdown-import 的 MARKDOWN_IMPORT_RUN 通道
 *       推给 renderer(renderer 不知道这是 docx 来的,走完全相同流程)
 * 3. 注册 File 菜单项 + 命令
 *
 * 设计要点(2026-05-27):
 * - 复用 markdown-import 的 renderer 链路 = 零额外 renderer 代码
 * - mammoth.messages 收集到 console.warn,不弹窗(避免学术文档"几乎每篇都有 warning"打扰)
 * - 公式 / 复杂表格 broken 在 mammoth 一侧已确认无解,本期接受
 */

import { dialog, BrowserWindow } from 'electron';
import { menuRegistry } from '@slot/menu-registry/menu-registry';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { convertDocxBatch } from './converter';

const CONFIRM_THRESHOLD = 500; // docx 比 md 慢得多,阈值更保守

async function runImport(): Promise<void> {
  const focusedWin = BrowserWindow.getFocusedWindow();

  const dialogResult = await dialog.showOpenDialog({
    title: 'Import Word',
    buttonLabel: 'Import',
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [{ name: 'Word Document', extensions: ['docx'] }],
  });

  if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
    return;
  }

  const paths = dialogResult.filePaths;

  // 是否包含目录(用于 renderer 端 hasDirectory 判定 — 影响 folder 树重建语义)
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
    /* default false */
  }

  console.log(`[word-import] starting conversion, paths=${paths.length}`);

  // 转换(并行 mammoth 太吃内存,这里串行)
  const { results, failed } = await convertDocxBatch(paths);

  console.log(
    `[word-import] conversion done — converted=${results.length} failed=${failed.length}`,
  );

  // 累计所有 mammoth warnings
  let totalWarnings = 0;
  for (const r of results) {
    if (r.warnings.length > 0) {
      console.warn(
        `[word-import] ${r.relPath}: ${r.warnings.length} mammoth warning(s)`,
      );
      for (const w of r.warnings.slice(0, 5)) {
        console.warn(`  - ${w}`);
      }
      if (r.warnings.length > 5) {
        console.warn(`  ... (${r.warnings.length - 5} more)`);
      }
      totalWarnings += r.warnings.length;
    }
  }

  if (failed.length > 0) {
    console.warn(`[word-import] ${failed.length} file(s) failed:`, failed);
  }

  if (results.length === 0) {
    await dialog.showMessageBox(focusedWin ?? new BrowserWindow(), {
      type: 'info',
      title: 'Import Word',
      message: 'No .docx files were converted.',
      detail:
        failed.length > 0
          ? `${failed.length} file(s) failed. See console for details.`
          : 'Selection contained no .docx files.',
    });
    return;
  }

  // 软上限确认(docx 转换贵,500 起就要确认)
  if (results.length > CONFIRM_THRESHOLD) {
    const choice = await dialog.showMessageBox(focusedWin ?? new BrowserWindow(), {
      type: 'question',
      buttons: ['Cancel', 'Import All'],
      defaultId: 0,
      cancelId: 0,
      title: 'Confirm Large Import',
      message: `Converted ${results.length} .docx files.`,
      detail: 'This will create the same number of notes. Continue?',
    });
    if (choice.response !== 1) return;
  }

  // 复用 markdown-import 的 MARKDOWN_IMPORT_RUN 通道
  // ScannedFile schema 一致:{ absPath, relPath, content };再加 coverTitle 走 docx 专属
  // (markdown 路径下 coverTitle 永远 undefined,renderer 端 fallback 自然走 heading / 文件名)
  const payload = {
    files: results.map((r) => ({
      absPath: r.absPath,
      relPath: r.relPath,
      content: r.markdown,
      coverTitle: r.coverTitle ?? undefined,
    })),
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
    `[word-import] broadcast MARKDOWN_IMPORT_RUN → ${sent} window(s),files=${results.length},warnings=${totalWarnings}`,
  );
}

/** 注册命令 + File 菜单项(被 framework-menus 调用)*/
export function registerWordImport(): void {
  menuRegistry.registerCommand('file.import-word', () => {
    void runImport().catch((err) => {
      console.error('[word-import] runImport failed:', err);
    });
  });
}
