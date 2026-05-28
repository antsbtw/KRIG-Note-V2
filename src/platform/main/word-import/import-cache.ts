/**
 * import-cache — Word/Markdown 导入 pipeline 的阶段产物诊断落盘
 *
 * 设计动机(2026-05-27 反馈"文档太长后乱码"):
 * - mammoth/pandoc 转出来的 markdown 是黑盒,中间走了 4 步,
 *   任何一步出 quirk(超长 base64 撑爆 cell / HTML 表退化 / md-to-pm parser 状态机
 *   被某长行带偏)用户都只能看到最终 NoteView 里乱码
 * - 解法:每阶段产物落盘,出问题用户去 cache 目录看哪一步开始错
 *
 * 落盘布局(单次导入,新一次导入前清空):
 *   <userData>/import-cache/
 *   ├── manifest.json        — 全局清单(converter / 时间戳 / 每文件成败汇总)
 *   └── files/
 *       └── <NNNN>-<basename>/
 *           ├── 01-raw.md            — converter 直出
 *           ├── 02-postprocessed.md  — 后处理后(flatten HTML / math 翻译 / coverTitle 抽)
 *           ├── 03-chunks/           — split 路径每 chunk 一份(renderer 端落盘)
 *           │   └── NN-{title}.md
 *           └── 04-pm-docs/          — markdownToProseMirror 产出(renderer 端落盘)
 *               └── NN.json
 *
 * 注:source.docx 不拷(占空间;manifest 留原路径可追溯)
 *
 * renderer 端通过 IMPORT_CACHE_DUMP_* IPC 把 chunk/PM 产物送回 main 落盘。
 */

import { app, ipcMain } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { IPC_CHANNELS } from '@shared/ipc/channel-names';

const CACHE_DIR_NAME = 'import-cache';
const FILES_DIR_NAME = 'files';
const MANIFEST_NAME = 'manifest.json';

export interface ImportCacheFileEntry {
  /** 4 位序号(0001 ... 9999),决定文件夹排序 */
  idx: number;
  /** 不含扩展名的 basename */
  basename: string;
  /** 原 docx/md 绝对路径(追溯用)*/
  sourceAbsPath: string;
  /** 哪条 converter:'mammoth' / 'pandoc' / 'markdown'(markdown 直接导入路径)*/
  converter: 'mammoth' | 'pandoc' | 'markdown';
  /** 转换阶段记录 */
  stages: ImportCacheStageEntry[];
}

export interface ImportCacheStageEntry {
  /** 阶段编号:'01-raw' / '02-postprocessed' / '03-chunks' / '04-pm-docs' */
  id: string;
  /** 该阶段产物字节数(总和)*/
  bytes: number;
  /** 该阶段耗时(ms)— 可选 */
  elapsedMs?: number;
  /** 该阶段额外信息(chunk 数 / warning 数 等)*/
  meta?: Record<string, unknown>;
}

export interface ImportCacheManifest {
  /** 本次导入时间戳(ms epoch)*/
  startedAt: number;
  /** 本次导入结束时间戳(成功 + 失败都算)*/
  finishedAt?: number;
  /** 本次导入入口 converter / 路径标识 */
  source: 'word-mammoth' | 'word-pandoc' | 'markdown';
  /** 总成功 / 失败计数(main 端聚合) */
  summary?: {
    files: number;
    converted: number;
    failed: number;
  };
  /** 每文件详情 */
  files: ImportCacheFileEntry[];
}

// ── 内部状态 ────────────────────────────────────────────────
let currentRoot: string | null = null;
let manifest: ImportCacheManifest | null = null;

function getCacheRootSync(): string {
  return path.join(app.getPath('userData'), CACHE_DIR_NAME);
}

/**
 * 起跑一次新导入:**清空** cache 目录 + 写初始 manifest。
 * 必须在 mammoth/pandoc 第一行执行,在 broadcast 前调用。
 */
export async function beginImport(source: ImportCacheManifest['source']): Promise<void> {
  currentRoot = getCacheRootSync();
  // 清空老内容(新一次导入前清,用户拍板的策略 — 不做轮转)
  await fs.rm(currentRoot, { recursive: true, force: true }).catch(() => { /* ok */ });
  await fs.mkdir(path.join(currentRoot, FILES_DIR_NAME), { recursive: true });

  manifest = {
    startedAt: Date.now(),
    source,
    files: [],
  };
  await writeManifest();

  console.log(`[import-cache] begin source=${source} root=${currentRoot}`);
}

/**
 * 注册一个待处理文件,返回该文件落盘子目录的绝对路径(供后续 stage dump 用)。
 * 同时在 manifest 登记 entry。
 */
export async function registerFile(
  basename: string,
  sourceAbsPath: string,
  converter: ImportCacheFileEntry['converter'],
): Promise<{ idx: number; dir: string }> {
  if (!manifest || !currentRoot) {
    throw new Error('[import-cache] registerFile called before beginImport');
  }
  const idx = manifest.files.length + 1;
  const safeBase = sanitizeFsName(basename);
  const dirName = `${String(idx).padStart(4, '0')}-${safeBase}`;
  const dir = path.join(currentRoot, FILES_DIR_NAME, dirName);
  await fs.mkdir(dir, { recursive: true });

  manifest.files.push({
    idx,
    basename: safeBase,
    sourceAbsPath,
    converter,
    stages: [],
  });
  await writeManifest();

  return { idx, dir };
}

/** 落某文件某阶段单文件产物(01-raw / 02-postprocessed)*/
export async function dumpStageContent(
  fileIdx: number,
  stageId: '01-raw' | '02-postprocessed',
  content: string,
  elapsedMs?: number,
  meta?: Record<string, unknown>,
): Promise<void> {
  if (!manifest || !currentRoot) return;
  const entry = manifest.files.find((f) => f.idx === fileIdx);
  if (!entry) return;

  const dirName = `${String(fileIdx).padStart(4, '0')}-${entry.basename}`;
  const filePath = path.join(currentRoot, FILES_DIR_NAME, dirName, `${stageId}.md`);
  try {
    await fs.writeFile(filePath, content, 'utf-8');
    entry.stages.push({
      id: stageId,
      bytes: Buffer.byteLength(content, 'utf-8'),
      elapsedMs,
      meta,
    });
    await writeManifest();
  } catch (err) {
    console.warn(`[import-cache] dumpStageContent failed for ${stageId} of file ${fileIdx}:`, err);
  }
}

/**
 * 落 split 后的单 chunk markdown(03-chunks/)
 * @param chunkIdx     chunk 顺序(0..)
 * @param chunkTitle   用作文件名前缀(会被 sanitize)
 */
export async function dumpChunk(
  fileIdx: number,
  chunkIdx: number,
  chunkTitle: string,
  content: string,
): Promise<void> {
  if (!manifest || !currentRoot) return;
  const entry = manifest.files.find((f) => f.idx === fileIdx);
  if (!entry) return;

  const dirName = `${String(fileIdx).padStart(4, '0')}-${entry.basename}`;
  const chunksDir = path.join(currentRoot, FILES_DIR_NAME, dirName, '03-chunks');
  await fs.mkdir(chunksDir, { recursive: true });

  const safeTitle = sanitizeFsName(chunkTitle).slice(0, 80);
  const filename = `${String(chunkIdx).padStart(2, '0')}-${safeTitle}.md`;
  try {
    await fs.writeFile(path.join(chunksDir, filename), content, 'utf-8');
  } catch (err) {
    console.warn(`[import-cache] dumpChunk failed for file ${fileIdx} chunk ${chunkIdx}:`, err);
  }
}

/** 落 markdownToProseMirror 产物(04-pm-docs/NN.json)*/
export async function dumpPmDoc(
  fileIdx: number,
  chunkIdx: number,
  pmDoc: unknown,
): Promise<void> {
  if (!manifest || !currentRoot) return;
  const entry = manifest.files.find((f) => f.idx === fileIdx);
  if (!entry) return;

  const dirName = `${String(fileIdx).padStart(4, '0')}-${entry.basename}`;
  const pmDir = path.join(currentRoot, FILES_DIR_NAME, dirName, '04-pm-docs');
  await fs.mkdir(pmDir, { recursive: true });

  const filename = `${String(chunkIdx).padStart(2, '0')}.json`;
  try {
    await fs.writeFile(
      path.join(pmDir, filename),
      JSON.stringify(pmDoc, null, 2),
      'utf-8',
    );
  } catch (err) {
    console.warn(`[import-cache] dumpPmDoc failed for file ${fileIdx} chunk ${chunkIdx}:`, err);
  }
}

/**
 * 一次完整聚合阶段元数据(避免 dumpChunk N 次都改 manifest 太碎)
 * 调用时机:某文件所有 chunk dump 完之后
 */
export async function recordStageSummary(
  fileIdx: number,
  stageId: '03-chunks' | '04-pm-docs',
  bytes: number,
  elapsedMs?: number,
  meta?: Record<string, unknown>,
): Promise<void> {
  if (!manifest) return;
  const entry = manifest.files.find((f) => f.idx === fileIdx);
  if (!entry) return;

  entry.stages.push({ id: stageId, bytes, elapsedMs, meta });
  await writeManifest();
}

/** 收尾:写最终 summary,manifest 落盘 */
export async function endImport(summary: {
  files: number;
  converted: number;
  failed: number;
}): Promise<void> {
  if (!manifest) return;
  manifest.finishedAt = Date.now();
  manifest.summary = summary;
  await writeManifest();
  console.log(
    `[import-cache] end — files=${summary.files} ok=${summary.converted} fail=${summary.failed} root=${currentRoot}`,
  );
}

async function writeManifest(): Promise<void> {
  if (!manifest || !currentRoot) return;
  const filePath = path.join(currentRoot, MANIFEST_NAME);
  try {
    await fs.writeFile(filePath, JSON.stringify(manifest, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[import-cache] writeManifest failed:', err);
  }
}

/** 把可能含 / \ : * ? " < > | 等不合法字符的 basename 转成文件系统安全形态 */
function sanitizeFsName(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 120) || 'unnamed';
}

/** 公开当前 root 给 UI / 命令行使用(若 import 已开始)*/
export function getCacheRoot(): string | null {
  return currentRoot;
}

/**
 * 落原始 EMF/WMF 二进制到 05-emf-raw/(浏览器无法渲染,placeholder 在 note 里指向这里)
 *
 * @param fileIdx     import-cache 文件 idx(同 dumpStageContent)
 * @param mediaName   形如 "image5.emf"(用 docx 内 word/media 同名)
 * @param data        二进制
 * @returns           落盘后的绝对路径(给 placeholder 链接用)
 */
export async function dumpRawMetafile(
  fileIdx: number,
  mediaName: string,
  data: Buffer,
): Promise<string | null> {
  if (!manifest || !currentRoot) return null;
  const entry = manifest.files.find((f) => f.idx === fileIdx);
  if (!entry) return null;

  const dirName = `${String(fileIdx).padStart(4, '0')}-${entry.basename}`;
  const rawDir = path.join(currentRoot, FILES_DIR_NAME, dirName, '05-emf-raw');
  await fs.mkdir(rawDir, { recursive: true });

  const safe = sanitizeFsName(mediaName);
  const absPath = path.join(rawDir, safe);
  try {
    await fs.writeFile(absPath, data);
    return absPath;
  } catch (err) {
    console.warn(`[import-cache] dumpRawMetafile failed for ${mediaName}:`, err);
    return null;
  }
}

/**
 * 注册 renderer → main 落盘 IPC handlers(应用启动期调用一次)
 *
 * 三个 channel 全部 fire-and-forget(`ipcMain.on`,无返回),renderer 不阻塞业务。
 * 落盘失败仅 console.warn,不影响导入主路径。
 */
export function registerImportCacheIpc(): void {
  ipcMain.on(
    IPC_CHANNELS.IMPORT_CACHE_DUMP_CHUNK,
    (_e, args: { fileIdx: number; chunkIdx: number; chunkTitle: string; content: string }) => {
      void dumpChunk(args.fileIdx, args.chunkIdx, args.chunkTitle, args.content);
    },
  );
  ipcMain.on(
    IPC_CHANNELS.IMPORT_CACHE_DUMP_PM_DOC,
    (_e, args: { fileIdx: number; chunkIdx: number; pmDoc: unknown }) => {
      void dumpPmDoc(args.fileIdx, args.chunkIdx, args.pmDoc);
    },
  );
  ipcMain.on(
    IPC_CHANNELS.IMPORT_CACHE_RECORD_STAGE,
    (_e, args: {
      fileIdx: number;
      stageId: '03-chunks' | '04-pm-docs';
      bytes: number;
      elapsedMs?: number;
      meta?: Record<string, unknown>;
    }) => {
      void recordStageSummary(args.fileIdx, args.stageId, args.bytes, args.elapsedMs, args.meta);
    },
  );
}
