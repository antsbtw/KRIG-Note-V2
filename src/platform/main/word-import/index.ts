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
import * as path from 'node:path';
import {
  progressStart,
  progressUpdate,
  progressDone,
} from '../window/progress-bridge';
import {
  beginImport,
  registerFile,
  dumpStageContent,
  dumpRawMetafile,
  endImport,
  getCacheRoot,
} from './import-cache';

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
  /** import-cache 中的文件 idx(renderer 端用此 idx 透传给 dumpChunk/dumpPmDoc IPC)*/
  cacheFileIdx?: number;
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
/**
 * 广播转换结果给 renderer。返回是否真的发出了 MARKDOWN_IMPORT_RUN:
 *  - 'sent'      已广播 → renderer overlay 会接手(main 端**不要** fire done)
 *  - 'empty'     无可导入文件 → 调用方 fire done 收掉 main overlay
 *  - 'cancelled' 大批确认被用户取消 → 同上
 */
async function broadcastResults(
  unified: UnifiedResult[],
  failed: Array<{ path: string; reason: string }>,
  paths: string[],
  converterTag: string,
): Promise<'sent' | 'empty' | 'cancelled'> {
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
    return 'empty';
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
    if (choice.response !== 1) return 'cancelled';
  }

  const payload = {
    files: unified.map((r) => ({
      absPath: r.absPath,
      relPath: r.relPath,
      content: r.markdown,
      coverTitle: r.coverTitle ?? undefined,
      // 2026-05-27 诊断:让 renderer 知道这份文件在 import-cache 的 idx,
      // 用于落 03-chunks / 04-pm-docs 时透传给 IPC
      cacheFileIdx: r.cacheFileIdx,
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
  return 'sent';
}

/** 跨进程交接用的 taskId 生成(main 端;只 fire start/update,done 由 renderer 接管或失败路径)*/
function genWordTaskId(): string {
  return `word-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── handler 1:mammoth(基础)────────────────────────────────────
async function runImportMammoth(): Promise<void> {
  const paths = await pickDocxFiles('');
  if (!paths) return;

  console.log(`[word-import:mammoth] starting, paths=${paths.length}`);
  await beginImport('word-mammoth');

  // 2026-05-29 import UX:docx 解析(main,慢)阶段显示 overlay。只 fire start/update,
  // **不 fire done** — renderer 收到 MARKDOWN_IMPORT_RUN 后用新 taskId 接手覆盖,无间隙。
  // 仅在"没东西可导入 / 用户取消大批确认"时由本函数 fire done 收掉 overlay。
  const taskId = genWordTaskId();
  progressStart({ taskId, title: '正在转换 Word 文档…', indeterminate: true });

  let results: Awaited<ReturnType<typeof convertDocxBatch>>['results'];
  let failed: Awaited<ReturnType<typeof convertDocxBatch>>['failed'];
  try {
    ({ results, failed } = await convertDocxBatch(paths));
  } catch (err) {
    // 解析阶段抛错:main 端收掉 overlay(renderer 永远不会接手)
    progressDone({ taskId, success: false, message: `转换失败:${(err as Error)?.message ?? String(err)}` });
    throw err;
  }
  progressUpdate({ taskId, message: `已转换 ${results.length} 个文档,正在整理…` });

  // 落盘 01-raw / 02-postprocessed,同时记 idx 透传 renderer(dump 03/04 时用)
  const unified: UnifiedResult[] = [];
  for (const r of results) {
    const baseName = path.basename(r.absPath, path.extname(r.absPath));
    const { idx } = await registerFile(baseName, r.absPath, 'mammoth');
    if (r.rawMarkdown) {
      await dumpStageContent(idx, '01-raw', r.rawMarkdown, undefined, {
        note: 'mammoth turndown(rawHtml) — before coverTitle extraction',
      });
    }
    await dumpStageContent(idx, '02-postprocessed', r.markdown, undefined, {
      coverTitle: r.coverTitle,
      warnings: r.warnings.length,
    });

    // EMF/WMF 原文件落 05-emf-raw/(浏览器渲不了,placeholder 已在 markdown 里指向这里)
    if (r.metafiles && r.metafiles.length > 0) {
      for (const mf of r.metafiles) {
        await dumpRawMetafile(idx, mf.label, mf.data);
      }
      console.log(
        `[word-import:mammoth] ${baseName}: ${r.metafiles.length} EMF/WMF saved to 05-emf-raw/`,
      );
    }

    unified.push({
      absPath: r.absPath,
      relPath: r.relPath,
      markdown: r.markdown,
      coverTitle: r.coverTitle,
      warnings: r.warnings,
      converter: 'mammoth',
      cacheFileIdx: idx,
    });
  }

  const outcome = await broadcastResults(unified, failed, paths, 'mammoth');
  // 没广播给 renderer(空 / 取消)→ main 端自己收掉 overlay,否则会一直转圈。
  if (outcome !== 'sent') {
    progressDone({
      taskId,
      success: outcome === 'cancelled' ? false : true,
      message: outcome === 'cancelled' ? '已取消导入' : '没有可导入的文档',
    });
  }
  await endImport({
    files: results.length + failed.length,
    converted: results.length,
    failed: failed.length,
  });

  const cacheRoot = getCacheRoot();
  if (cacheRoot) {
    console.log(`[word-import:mammoth] cache dump root: ${cacheRoot}`);
  }
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
  await beginImport('word-pandoc');

  // 见 runImportMammoth 注释:只 fire start/update,done 由 renderer 接管或失败路径。
  const taskId = genWordTaskId();
  progressStart({ taskId, title: '正在转换 Word 文档(高保真)…', indeterminate: true });

  let results: Awaited<ReturnType<typeof convertDocxBatchPandoc>>['results'];
  let failed: Awaited<ReturnType<typeof convertDocxBatchPandoc>>['failed'];
  try {
    ({ results, failed } = await convertDocxBatchPandoc(paths, pandocStatus.path!));
  } catch (err) {
    progressDone({ taskId, success: false, message: `转换失败:${(err as Error)?.message ?? String(err)}` });
    throw err;
  }
  progressUpdate({ taskId, message: `已转换 ${results.length} 个文档,正在整理…` });

  // 落盘 01-raw(pandoc 直出)/ 02-postprocessed(math + html-img flatten + base64 内联后)
  const unified: UnifiedResult[] = [];
  for (const r of results) {
    const baseName = path.basename(r.absPath, path.extname(r.absPath));
    const { idx } = await registerFile(baseName, r.absPath, 'pandoc');
    if (r.rawMarkdown) {
      await dumpStageContent(idx, '01-raw', r.rawMarkdown, undefined, {
        note: 'pandoc direct output — before math/html/base64 postprocess',
      });
    }
    await dumpStageContent(idx, '02-postprocessed', r.markdown, undefined, {
      coverTitle: r.coverTitle,
      warnings: r.warnings.length,
    });

    if (r.metafiles && r.metafiles.length > 0) {
      for (const mf of r.metafiles) {
        await dumpRawMetafile(idx, mf.label, mf.data);
      }
      console.log(
        `[word-import:pandoc] ${baseName}: ${r.metafiles.length} EMF/WMF saved to 05-emf-raw/`,
      );
    }

    unified.push({
      absPath: r.absPath,
      relPath: r.relPath,
      markdown: r.markdown,
      coverTitle: r.coverTitle,
      warnings: r.warnings,
      converter: 'pandoc',
      cacheFileIdx: idx,
    });
  }

  const outcome = await broadcastResults(unified, failed, paths, 'pandoc');
  if (outcome !== 'sent') {
    progressDone({
      taskId,
      success: outcome === 'cancelled' ? false : true,
      message: outcome === 'cancelled' ? '已取消导入' : '没有可导入的文档',
    });
  }
  await endImport({
    files: results.length + failed.length,
    converted: results.length,
    failed: failed.length,
  });

  const cacheRoot = getCacheRoot();
  if (cacheRoot) {
    console.log(`[word-import:pandoc] cache dump root: ${cacheRoot}`);
  }
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
