/**
 * word-import 模块入口(主进程)
 *
 * 单菜单入口 `Import Word...` → 自动选择转换器:
 *   1. 探测 pandoc 二进制
 *      ✓ 有 → 走高质量路径(公式 / 自动编号 / 复杂表格保留)
 *      ✗ 没 → 询问用户:用 mammoth 基础版,还是去装 pandoc
 *   2. 转换 + 复用 MARKDOWN_IMPORT_RUN 通道推给 renderer
 *
 * Pandoc 优先 + mammoth 兜底设计(2026-05-27 用户拍板):
 * - 装好 pandoc 的用户透明享受高质量(无需在菜单里选两次)
 * - 没装的用户能立即用兜底,同时知道有更高质量选项可装
 * - 失败逐文件降级:某 docx 用 pandoc 转崩 → 单文件 fallback 到 mammoth(不让一份坏文档拖死整批)
 */

import { dialog, BrowserWindow, shell } from 'electron';
import { menuRegistry } from '@slot/menu-registry/menu-registry';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import { convertDocxBatch, convertDocxToMarkdown } from './converter';
import { convertDocxBatchPandoc, convertDocxToMarkdownPandoc } from './converter-pandoc';
import { detectPandoc, resetPandocDetectionCache } from './pandoc-detector';
import { scanDocxPaths, replaceDocxExtWithMd } from './scanner';

const CONFIRM_THRESHOLD = 500;
const PANDOC_INSTALL_URL = 'https://pandoc.org/installing.html';

interface UnifiedResult {
  absPath: string;
  relPath: string;
  markdown: string;
  coverTitle: string | null;
  warnings: string[];
  /** 实际用了哪条转换器(诊断用)*/
  converter: 'pandoc' | 'mammoth';
}

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

  // 探测 pandoc — 每次菜单点击重新探测(用户可能中途装上)
  resetPandocDetectionCache();
  const pandocStatus = await detectPandoc();
  console.log(
    `[word-import] pandoc detect: available=${pandocStatus.available} path=${pandocStatus.path ?? 'n/a'} version=${pandocStatus.version ?? 'n/a'}`,
  );

  let useConverter: 'pandoc' | 'mammoth' = pandocStatus.available ? 'pandoc' : 'mammoth';

  if (!pandocStatus.available) {
    const choice = await dialog.showMessageBox(focusedWin ?? new BrowserWindow(), {
      type: 'info',
      title: 'Pandoc Not Installed',
      message: 'For best quality, install Pandoc.',
      detail:
        'Pandoc preserves math formulas, auto-numbering, citations, and complex tables — features the basic converter (mammoth) cannot handle.\n\n' +
        'Install:\n' +
        '  • macOS:   brew install pandoc\n' +
        '  • Windows: download from pandoc.org/installing\n' +
        '  • Linux:   apt install pandoc / yum install pandoc\n\n' +
        'You can import now with the basic converter, or cancel and install Pandoc first.',
      buttons: ['Import with Basic Converter', 'Open Pandoc Website', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
    });
    if (choice.response === 2) return;
    if (choice.response === 1) {
      await shell.openExternal(PANDOC_INSTALL_URL);
      return;
    }
    useConverter = 'mammoth';
  }

  // 是否包含目录(用于 renderer 端 hasDirectory 判定)
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

  console.log(`[word-import] starting conversion via ${useConverter}, paths=${paths.length}`);

  let unified: UnifiedResult[] = [];
  let failed: Array<{ path: string; reason: string }> = [];
  let pandocFallbackCount = 0;

  if (useConverter === 'pandoc' && pandocStatus.path) {
    // 走 pandoc 批量;单文件失败时降级到 mammoth(不让一份坏 docx 拖死整批)
    const { results: pandocResults, failed: pandocFailed } = await convertDocxBatchPandoc(
      paths,
      pandocStatus.path,
    );

    unified.push(
      ...pandocResults.map<UnifiedResult>((r) => ({
        absPath: r.absPath,
        relPath: r.relPath,
        markdown: r.markdown,
        coverTitle: r.coverTitle,
        warnings: r.warnings,
        converter: 'pandoc',
      })),
    );

    // 逐文件 pandoc 失败 → 单文件 mammoth fallback
    for (const f of pandocFailed) {
      try {
        const r = await convertDocxToMarkdown(f.path);
        unified.push({
          absPath: f.path,
          relPath: replaceDocxExtWithMd(deriveRelPath(paths, f.path)),
          markdown: r.markdown,
          coverTitle: r.coverTitle,
          warnings: [`[fallback to mammoth: pandoc failed — ${f.reason}]`, ...r.warnings],
          converter: 'mammoth',
        });
        pandocFallbackCount++;
      } catch (err) {
        failed.push({ path: f.path, reason: `pandoc + mammoth both failed: ${String(err)}` });
      }
    }
  } else {
    const { results: mammothResults, failed: mammothFailed } = await convertDocxBatch(paths);
    unified.push(
      ...mammothResults.map<UnifiedResult>((r) => ({
        absPath: r.absPath,
        relPath: r.relPath,
        markdown: r.markdown,
        coverTitle: r.coverTitle,
        warnings: r.warnings,
        converter: 'mammoth',
      })),
    );
    failed = mammothFailed;
  }

  // warnings 汇总打印
  let totalWarnings = 0;
  for (const r of unified) {
    if (r.warnings.length > 0) {
      console.warn(
        `[word-import] ${r.relPath} (${r.converter}): ${r.warnings.length} warning(s)`,
      );
      for (const w of r.warnings.slice(0, 5)) console.warn(`  - ${w}`);
      if (r.warnings.length > 5) console.warn(`  ... (${r.warnings.length - 5} more)`);
      totalWarnings += r.warnings.length;
    }
  }

  console.log(
    `[word-import] conversion done — converted=${unified.length} failed=${failed.length} pandoc-fallback=${pandocFallbackCount}`,
  );

  if (failed.length > 0) {
    console.warn(`[word-import] ${failed.length} file(s) failed:`, failed);
  }

  if (unified.length === 0) {
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

  if (unified.length > CONFIRM_THRESHOLD) {
    const choice = await dialog.showMessageBox(focusedWin ?? new BrowserWindow(), {
      type: 'question',
      buttons: ['Cancel', 'Import All'],
      defaultId: 0,
      cancelId: 0,
      title: 'Confirm Large Import',
      message: `Converted ${unified.length} .docx files.`,
      detail: 'This will create the same number of notes. Continue?',
    });
    if (choice.response !== 1) return;
  }

  // 复用 markdown-import 的 MARKDOWN_IMPORT_RUN 通道(renderer 链路零改动)
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
    `[word-import] broadcast MARKDOWN_IMPORT_RUN → ${sent} window(s),files=${unified.length},warnings=${totalWarnings}`,
  );
}

/** 单文件 mammoth fallback 时需要从原 paths 推一个 relPath(简化:用 basename)*/
function deriveRelPath(_originalPaths: string[], absPath: string): string {
  // 用 basename(对单文件 / 文件名唯一就够;批量目录场景 pandoc 失败概率极低)
  const lastSep = Math.max(absPath.lastIndexOf('/'), absPath.lastIndexOf('\\'));
  return lastSep >= 0 ? absPath.slice(lastSep + 1) : absPath;
}

/** 注册命令 + File 菜单项(被 framework-menus 调用)*/
export function registerWordImport(): void {
  menuRegistry.registerCommand('file.import-word', () => {
    void runImport().catch((err) => {
      console.error('[word-import] runImport failed:', err);
    });
  });
}

// 单文件辅助导出(给未来其他模块按需使用,如拖拽导入)
export { convertDocxToMarkdownPandoc, convertDocxToMarkdown, scanDocxPaths };
