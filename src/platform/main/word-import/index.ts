/**
 * word-import 模块入口(主进程)
 *
 * 两个独立菜单入口(2026-05-27 反馈):**分开诊断**
 *   - `Import Word...`                    → 走 mammoth(基础,零依赖)
 *   - `Import Word (High Quality)...`     → 走 pandoc(高保真,需用户装 pandoc)
 *
 * 设计权衡(回归原任务文档方案):
 * - 早期"单菜单透明降级"方便用户但**遮蔽了 bug 归属**:
 *   表格/图丢失时无法知道是 mammoth 没踩到的 case 还是 pandoc 引入的回归
 * - 两个独立入口:用户主动选 → 出问题立刻知道是哪条路径责任,
 *   两路径可对照测试同一份 docx
 * - 没装 pandoc → 走 pandoc 入口直接弹安装引导后退出(不再悄悄 fallback)
 *
 * 共用 renderer 链路(MARKDOWN_IMPORT_RUN)— renderer 不知道 docx 来自哪条转换器
 */

import { dialog, BrowserWindow, shell } from 'electron';
import { menuRegistry } from '@slot/menu-registry/menu-registry';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { convertDocxBatch, convertDocxToMarkdown } from './converter';
import { convertDocxBatchPandoc, convertDocxToMarkdownPandoc } from './converter-pandoc';
import { detectPandoc, resetPandocDetectionCache } from './pandoc-detector';
import { scanDocxPaths } from './scanner';

const CONFIRM_THRESHOLD = 500;
const PANDOC_INSTALL_URL = 'https://pandoc.org/installing.html';

type ConverterKind = 'pandoc' | 'mammoth';

interface UnifiedResult {
  absPath: string;
  relPath: string;
  markdown: string;
  coverTitle: string | null;
  warnings: string[];
  converter: ConverterKind;
}

// ── 共享:选文件 dialog ────────────────────────────────────────
async function pickDocxFiles(titleSuffix: string): Promise<string[] | null> {
  const dialogResult = await dialog.showOpenDialog({
    title: `Import Word${titleSuffix}`,
    buttonLabel: 'Import',
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [{ name: 'Word Document', extensions: ['docx'] }],
  });
  if (dialogResult.canceled || dialogResult.filePaths.length === 0) return null;
  return dialogResult.filePaths;
}

// ── 共享:hasDirectory 探测 + broadcast + 大批确认 ─────────────
async function broadcastResults(
  unified: UnifiedResult[],
  failed: Array<{ path: string; reason: string }>,
  paths: string[],
  converterTag: string,
): Promise<void> {
  const focusedWin = BrowserWindow.getFocusedWindow();

  let hasDirectory = false;
  try {
    const fs = await import('node:fs');
    hasDirectory = paths.some((p) => {
      try { return fs.statSync(p).isDirectory(); } catch { return false; }
    });
  } catch {
    /* default false */
  }

  // warnings 汇总
  let totalWarnings = 0;
  for (const r of unified) {
    if (r.warnings.length > 0) {
      console.warn(
        `[word-import:${converterTag}] ${r.relPath}: ${r.warnings.length} warning(s)`,
      );
      for (const w of r.warnings.slice(0, 5)) console.warn(`  - ${w}`);
      if (r.warnings.length > 5) console.warn(`  ... (${r.warnings.length - 5} more)`);
      totalWarnings += r.warnings.length;
    }
  }

  console.log(
    `[word-import:${converterTag}] conversion done — converted=${unified.length} failed=${failed.length}`,
  );

  if (failed.length > 0) {
    console.warn(`[word-import:${converterTag}] ${failed.length} file(s) failed:`, failed);
  }

  if (unified.length === 0) {
    await dialog.showMessageBox(focusedWin ?? new BrowserWindow(), {
      type: 'info',
      title: `Import Word (${converterTag})`,
      message: 'No .docx files were converted.',
      detail:
        failed.length > 0
          ? `${failed.length} file(s) failed. See console for details.`
          : 'Selection contained no .docx files.',
    });
    return;
  }

  if (unified.length > CONFIRM_THRESHOLD) {
    const choice = await dialog.showMessageBox(focusedWin ?? new BrowserWindow(), {
      type: 'question',
      buttons: ['Cancel', 'Import All'],
      defaultId: 0,
      cancelId: 0,
      title: 'Confirm Large Import',
      message: `Converted ${unified.length} .docx files via ${converterTag}.`,
      detail: 'This will create the same number of notes. Continue?',
    });
    if (choice.response !== 1) return;
  }

  const payload = {
    files: unified.map((r) => ({
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
    `[word-import:${converterTag}] broadcast MARKDOWN_IMPORT_RUN → ${sent} window(s),files=${unified.length},warnings=${totalWarnings}`,
  );
}

// ── handler 1:mammoth(基础)────────────────────────────────────
async function runImportMammoth(): Promise<void> {
  const paths = await pickDocxFiles('');
  if (!paths) return;

  console.log(`[word-import:mammoth] starting, paths=${paths.length}`);
  const { results, failed } = await convertDocxBatch(paths);

  const unified: UnifiedResult[] = results.map((r) => ({
    absPath: r.absPath,
    relPath: r.relPath,
    markdown: r.markdown,
    coverTitle: r.coverTitle,
    warnings: r.warnings,
    converter: 'mammoth',
  }));

  await broadcastResults(unified, failed, paths, 'mammoth');
}

// ── handler 2:pandoc(高保真)──────────────────────────────────
async function runImportPandoc(): Promise<void> {
  const focusedWin = BrowserWindow.getFocusedWindow();

  // 探测 pandoc — 每次菜单点击重新探测(用户可能中途装上)
  resetPandocDetectionCache();
  const pandocStatus = await detectPandoc();
  console.log(
    `[word-import:pandoc] detect: available=${pandocStatus.available} path=${pandocStatus.path ?? 'n/a'} version=${pandocStatus.version ?? 'n/a'}`,
  );

  if (!pandocStatus.available) {
    const choice = await dialog.showMessageBox(focusedWin ?? new BrowserWindow(), {
      type: 'info',
      title: 'Pandoc Not Installed',
      message: 'This menu requires Pandoc.',
      detail:
        'For basic (zero-dependency) Word import, use "Import Word..." instead.\n\n' +
        'For high-quality import (math formulas, auto-numbering, complex tables),' +
        ' install Pandoc:\n' +
        '  • macOS:   brew install pandoc\n' +
        '  • Windows: download from pandoc.org/installing\n' +
        '  • Linux:   apt install pandoc / yum install pandoc\n\n' +
        'After installing, restart KRIG Note and try again.',
      buttons: ['Open Pandoc Website', 'OK'],
      defaultId: 1,
      cancelId: 1,
    });
    if (choice.response === 0) {
      await shell.openExternal(PANDOC_INSTALL_URL);
    }
    return;
  }

  const paths = await pickDocxFiles(' (High Quality)');
  if (!paths) return;

  console.log(`[word-import:pandoc] starting, paths=${paths.length}, binary=${pandocStatus.path}`);
  const { results, failed } = await convertDocxBatchPandoc(paths, pandocStatus.path!);

  const unified: UnifiedResult[] = results.map((r) => ({
    absPath: r.absPath,
    relPath: r.relPath,
    markdown: r.markdown,
    coverTitle: r.coverTitle,
    warnings: r.warnings,
    converter: 'pandoc',
  }));

  await broadcastResults(unified, failed, paths, 'pandoc');
}

/** 注册命令 + File 菜单项(被 framework-menus 调用)*/
export function registerWordImport(): void {
  menuRegistry.registerCommand('file.import-word', () => {
    void runImportMammoth().catch((err) => {
      console.error('[word-import:mammoth] runImport failed:', err);
    });
  });
  menuRegistry.registerCommand('file.import-word-pandoc', () => {
    void runImportPandoc().catch((err) => {
      console.error('[word-import:pandoc] runImport failed:', err);
    });
  });
}

// 单文件辅助导出(给未来其他模块按需使用,如拖拽导入)
export { convertDocxToMarkdownPandoc, convertDocxToMarkdown, scanDocxPaths };
