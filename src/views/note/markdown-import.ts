/**
 * markdown-import — ScannedFile 批 → folder 树 + 多 Note 落地
 *
 * 输入:main 通过 MARKDOWN_IMPORT_RUN 推送的 MarkdownImportRunPayload
 *   {
 *     files: [{ absPath, relPath, content }, ...],
 *     hasDirectory: boolean,
 *   }
 *
 * relPath 形态:
 *   - 单文件:basename(eg "README.md")
 *   - 目录扫描:rootSegment + 子路径(eg "docs/refactor/00-总纲.md")
 *
 * 流程:
 * 1. 预扫描:统计每个 .md 的 heading 数,识别 oversized 文件(≥ H1_SPLIT_THRESHOLD)
 * 2. 如有 oversized → 调用方触发决策弹窗,得到 splitMode('all' | 'none')
 * 3. 解析 relPath,按 folder 路径分组,递归 createFolder 重建 folder 树
 *    - 同名 folder 自动加 (2) 后缀
 * 4. 每个文件 → markdownToProseMirror → DriverSerialized → createNote
 *    - oversized + splitMode='all' → 拆成 N+1 note(序言 + N section)
 *    - 同名 note 自动加 (2) 后缀
 * 5. 失败跳过,console.warn 记录
 *
 * 跟 extraction-import 的区别:
 * - extraction 单一 root folder(bookName);本模块是 N 层 folder 树
 * - extraction 用 atomsToProseMirror;本模块用 markdownToProseMirror
 * - extraction 同名直接 skip;本模块同名加 (2) 后缀
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { NoteCapabilityApi } from '@capabilities/note/types';
import type { FolderCapabilityApi, FolderInfo } from '@capabilities/folder/types';
import type {
  DriverSerialized,
  TextEditingApi,
  PMDocNode,
} from '@capabilities/text-editing/types';

function noteCap(): NoteCapabilityApi {
  return requireCapabilityApi<NoteCapabilityApi>('note');
}
function folderCap(): FolderCapabilityApi {
  return requireCapabilityApi<FolderCapabilityApi>('folder');
}
function textEditing(): TextEditingApi {
  return requireCapabilityApi<TextEditingApi>('text-editing');
}

export interface ScannedFile {
  absPath: string;
  relPath: string;
  content: string;
}

export interface MarkdownImportPayload {
  files: ScannedFile[];
  hasDirectory: boolean;
}

export interface ImportResult {
  createdNoteIds: string[];
  createdFolderIds: string[];
  skipped: Array<{ relPath: string; reason: string }>;
  /** 用户选了取消 oversized split → 'none';选了全切 → 'all';无 oversized → 'na' */
  splitMode: 'all' | 'none' | 'na';
  /** oversized 文件数量(splitMode 决策依据) */
  oversizedCount: number;
}

/**
 * Oversized 判定双阈值(必须同时满足才切):
 * - 字符数 > OVERSIZED_CHAR_THRESHOLD
 * - 顶级章节数(level === maxLevel)>= OVERSIZED_TOP_SECTIONS_MIN
 *
 * 设计理由(2026-05-27 反馈):
 * 早期只按"heading 数量 >= 10"判定 → 普通 README/技术文档(几千字 + 10+ H2/H3)
 * 全部误触发。真实"该切"的标志是"长文档 + 多个独立顶级章节"(典型:cheatsheet、
 * 日记合集、合并文档),不是 heading 多。
 */
const OVERSIZED_CHAR_THRESHOLD = 50000;
const OVERSIZED_TOP_SECTIONS_MIN = 5;

/**
 * 占位标题黑名单 — V1 / 其他工具产生的"未命名" heading,inferTitle 跳过它们
 * 避免 NavSide 显示一堆"Untitled" / "未命名"。
 */
const PLACEHOLDER_TITLES = new Set([
  'untitled',
  'untitled note',
  'untitled document',
  'note',
  'document',
  'new note',
  '未命名',
  '无标题',
  '新建笔记',
  '新笔记',
]);

function isPlaceholderTitle(text: string): boolean {
  return PLACEHOLDER_TITLES.has(text.trim().toLowerCase());
}

/**
 * splitDecisionResolver:由 hook 注入。
 * 若 oversizedCount > 0, importMarkdownBatch 会调用该函数取用户决策。
 * 返 'all' 全切,'none' 不切。返 'none' 时所有 oversized 文件原样导入。
 */
export type SplitDecisionResolver = (count: number) => Promise<'all' | 'none'>;

interface ParsedFile {
  scanned: ScannedFile;
  /** 该 .md 内全部 heading(顺序) */
  headings: Array<{ level: number; text: string; lineStart: number }>;
  /** 文件最大 heading level(level 越小越大;1 比 2 大) */
  maxLevel: number;
  /** 是否触发 split */
  oversized: boolean;
}

/** 扫描 markdown 内 heading,返回最大 level + 总数(给 oversize 判定 + split 用)*/
function parseHeadings(md: string): {
  headings: ParsedFile['headings'];
  maxLevel: number;
} {
  const lines = md.split('\n');
  const headings: ParsedFile['headings'] = [];
  let maxLevel = 6;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (m) {
      const level = m[1].length;
      headings.push({ level, text: m[2], lineStart: i });
      if (level < maxLevel) maxLevel = level;
    }
  }

  return { headings, maxLevel };
}

/** 按"文件最大 heading level"切分 markdown 为 N+1 块:序言 + N section */
function splitByMaxLevel(
  md: string,
  parsed: ParsedFile,
): Array<{ titleHint: string | null; body: string }> {
  const lines = md.split('\n');
  const cutPoints: number[] = [];

  for (const h of parsed.headings) {
    if (h.level === parsed.maxLevel) {
      cutPoints.push(h.lineStart);
    }
  }

  if (cutPoints.length === 0) {
    return [{ titleHint: null, body: md }];
  }

  const chunks: Array<{ titleHint: string | null; body: string }> = [];

  // 序言:0 .. cutPoints[0]-1
  if (cutPoints[0] > 0) {
    const preamble = lines.slice(0, cutPoints[0]).join('\n').trim();
    if (preamble) {
      chunks.push({ titleHint: null, body: preamble });
    }
  }

  // 每个 section:cutPoints[i] .. cutPoints[i+1]-1
  for (let i = 0; i < cutPoints.length; i++) {
    const start = cutPoints[i];
    const end = i + 1 < cutPoints.length ? cutPoints[i + 1] : lines.length;
    const sectionLines = lines.slice(start, end);
    const headingLine = sectionLines[0];
    const titleMatch = /^#{1,6}\s+(.+?)\s*$/.exec(headingLine);
    const titleHint = titleMatch ? titleMatch[1] : null;
    chunks.push({ titleHint, body: sectionLines.join('\n') });
  }

  return chunks;
}

/**
 * 找第一个"非占位"heading 文本 — 跳过 'Untitled' / '未命名' 等占位 title。
 *
 * V1 / 其他工具可能产出 `# Untitled\n# 真标题` 的内容,naive 取 first heading
 * 会让 NavSide 一片 'Untitled'(2026-05-27 反馈)。
 */
function firstMeaningfulHeading(parsed: ParsedFile): string | null {
  for (const h of parsed.headings) {
    const text = h.text.trim();
    if (text && !isPlaceholderTitle(text)) return text;
  }
  return null;
}

/** 文件名(去 .md / .markdown 后缀)*/
function filenameTitle(relPath: string): string {
  const base = relPath.split('/').pop() ?? relPath;
  return base.replace(/\.(md|markdown)$/i, '');
}

/** 推 title:优先第一个非占位 heading,fallback 文件名 */
function inferTitle(parsed: ParsedFile, relPath: string): string {
  return firstMeaningfulHeading(parsed) ?? filenameTitle(relPath);
}

/** 同名冲突:在 takenNames 集合上加 (2) / (3) / ... 直到不冲突;返回最终名 + 更新集合 */
function uniqueName(base: string, takenNames: Set<string>): string {
  if (!takenNames.has(base)) {
    takenNames.add(base);
    return base;
  }
  let n = 2;
  while (takenNames.has(`${base} (${n})`)) {
    n++;
  }
  const final = `${base} (${n})`;
  takenNames.add(final);
  return final;
}

interface FolderTreeCache {
  /** relDir(eg "docs/refactor")→ folderId */
  pathToId: Map<string, string>;
  /** 每个 folderId 下已用 child folder 名(包括已存在的 + 本批新建的)*/
  childFolderNames: Map<string, Set<string>>;
  /** 每个 folderId 下已用 note title */
  childNoteTitles: Map<string, Set<string>>;
  /** root 级已用 folder 名 */
  rootFolderNames: Set<string>;
  /** root 级已用 note title */
  rootNoteTitles: Set<string>;
}

async function buildFolderTreeCache(): Promise<FolderTreeCache> {
  const [folders, notes] = await Promise.all([
    folderCap().listFolders('note'),
    noteCap().listNotes(),
  ]);

  const cache: FolderTreeCache = {
    pathToId: new Map(),
    childFolderNames: new Map(),
    childNoteTitles: new Map(),
    rootFolderNames: new Set(),
    rootNoteTitles: new Set(),
  };

  // 收集已有 folder 名:同 parent 下的 title 集合
  for (const f of folders) {
    if (f.parentId === null) {
      cache.rootFolderNames.add(f.title);
    } else {
      let set = cache.childFolderNames.get(f.parentId);
      if (!set) {
        set = new Set();
        cache.childFolderNames.set(f.parentId, set);
      }
      set.add(f.title);
    }
  }

  // 收集已有 note title
  for (const n of notes) {
    if (n.folderId === null) {
      cache.rootNoteTitles.add(n.title);
    } else {
      let set = cache.childNoteTitles.get(n.folderId);
      if (!set) {
        set = new Set();
        cache.childNoteTitles.set(n.folderId, set);
      }
      set.add(n.title);
    }
  }

  return cache;
}

function namesAt(cache: FolderTreeCache, parentId: string | null): Set<string> {
  if (parentId === null) return cache.rootFolderNames;
  let set = cache.childFolderNames.get(parentId);
  if (!set) {
    set = new Set();
    cache.childFolderNames.set(parentId, set);
  }
  return set;
}

function noteNamesAt(cache: FolderTreeCache, folderId: string | null): Set<string> {
  if (folderId === null) return cache.rootNoteTitles;
  let set = cache.childNoteTitles.get(folderId);
  if (!set) {
    set = new Set();
    cache.childNoteTitles.set(folderId, set);
  }
  return set;
}

/** 拆 relPath 成 segment 数组 + 文件名:["docs","refactor","00-总纲.md"] → (["docs","refactor"], "00-总纲.md") */
function splitRelPath(relPath: string): { dirSegments: string[]; fileName: string } {
  const parts = relPath.split('/').filter(Boolean);
  if (parts.length === 0) {
    return { dirSegments: [], fileName: relPath };
  }
  const fileName = parts[parts.length - 1];
  return { dirSegments: parts.slice(0, -1), fileName };
}

/** 确保给定 segment path 的 folder 链路存在,返回最深层 folderId(null = 根级)*/
async function ensureFolderPath(
  dirSegments: string[],
  cache: FolderTreeCache,
  createdFolderIds: string[],
): Promise<string | null> {
  if (dirSegments.length === 0) return null;

  let parentId: string | null = null;
  const pathBuf: string[] = [];

  for (const segment of dirSegments) {
    pathBuf.push(segment);
    const pathKey = pathBuf.join('/');

    const existingId = cache.pathToId.get(pathKey);
    if (existingId) {
      parentId = existingId;
      continue;
    }

    // 该层 segment 名字在 parentId 下是否已存在
    const taken = namesAt(cache, parentId);
    const finalName = uniqueName(segment, taken);

    const folder: FolderInfo | null = await folderCap().createFolder(
      finalName,
      parentId,
      'note',
    );
    if (!folder) {
      console.warn(`[markdown-import] createFolder failed: ${pathKey}`);
      return parentId;
    }

    createdFolderIds.push(folder.id);
    cache.pathToId.set(pathKey, folder.id);
    // 新建 folder 自己也有可能成为 parent,先备好空 child set
    cache.childFolderNames.set(folder.id, new Set());
    cache.childNoteTitles.set(folder.id, new Set());

    parentId = folder.id;
  }

  return parentId;
}

/**
 * 确保 doc 首块是 V2 schema 强制的"isTitle paragraph"
 * (driver title-guard plugin appendTransaction 会自动补,而 buildNoteInfo
 *  里的 deriveTitle 取 content[0] inline text — 必须自己产出合规结构)
 *
 * 策略(2026-05-27 反馈 — 修正"NavSide 显示未命名 + PM 顶部多余 Untitled"问题):
 * 1. 首块 = `{ type: 'paragraph', attrs: { isTitle: true }, content: [{ type:'text', text: title }] }`
 * 2. 原文剥掉头部 placeholder heading(`# Untitled` / `# 未命名` 等)
 * 3. 原文若首块是真 heading 且 text === title → 删掉(避免双重标题视觉)
 * 4. 其他原文内容原样保留
 */
function ensureLeadingTitle(content: PMDocNode[], title: string): PMDocNode[] {
  let working = content.slice();

  // 剥头部 placeholder / 空 heading
  while (working.length > 0) {
    const first = working[0];
    if (first.type === 'heading') {
      const text = extractInlineText(first).trim();
      if (!text || isPlaceholderTitle(text)) {
        working = working.slice(1);
        continue;
      }
    }
    break;
  }

  // 若首块是真 heading 且文本 === title — 删它(已经被 title paragraph 表达)
  if (working.length > 0) {
    const first = working[0];
    if (first.type === 'heading') {
      const text = extractInlineText(first).trim();
      if (text === title) {
        working = working.slice(1);
      }
    }
  }

  // 强制首块 = isTitle paragraph(V2 driver 强约束)
  const titleNode: PMDocNode = {
    type: 'paragraph',
    attrs: { isTitle: true },
    content: [{ type: 'text', text: title }],
  };

  return [titleNode, ...working];
}

/** 递归抠节点 inline text(text 节点 + 嵌套 content)*/
function extractInlineText(node: PMDocNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (!node.content) return '';
  return node.content.map(extractInlineText).join('');
}

async function createNoteInFolder(
  title: string,
  content: PMDocNode[],
  folderId: string | null,
  cache: FolderTreeCache,
  createdNoteIds: string[],
): Promise<void> {
  const taken = noteNamesAt(cache, folderId);
  const finalTitle = uniqueName(title, taken);
  const contentWithTitle = ensureLeadingTitle(content, finalTitle);

  const doc: DriverSerialized = {
    format: 'pm-doc-json',
    version: '0.1',
    payload: { type: 'doc', content: contentWithTitle },
  };

  const note = await noteCap().createNote(doc, folderId);
  createdNoteIds.push(note.id);
}

/**
 * 单批导入入口。
 *
 * @param payload  main 推送的 ScannedFile[]
 * @param resolveSplit  若有 oversized 文件,调此函数取 'all' / 'none' 决策。
 *                     resolveSplit 不传 → 默认 'none'(保守)。
 */
export async function importMarkdownBatch(
  payload: MarkdownImportPayload,
  resolveSplit?: SplitDecisionResolver,
): Promise<ImportResult> {
  const files = Array.isArray(payload?.files) ? payload.files : [];
  if (files.length === 0) {
    return {
      createdNoteIds: [],
      createdFolderIds: [],
      skipped: [],
      splitMode: 'na',
      oversizedCount: 0,
    };
  }

  // 1. 预解析 heading,标 oversized(双阈值:字符数 + 顶级章节数)
  const parsedAll: ParsedFile[] = files.map((f) => {
    const { headings, maxLevel } = parseHeadings(f.content);
    const topSections = headings.filter((h) => h.level === maxLevel).length;
    const oversized =
      f.content.length > OVERSIZED_CHAR_THRESHOLD &&
      topSections >= OVERSIZED_TOP_SECTIONS_MIN;
    return {
      scanned: f,
      headings,
      maxLevel,
      oversized,
    };
  });

  const oversizedCount = parsedAll.filter((p) => p.oversized).length;

  let splitMode: 'all' | 'none' | 'na' = 'na';
  if (oversizedCount > 0) {
    if (resolveSplit) {
      splitMode = await resolveSplit(oversizedCount);
    } else {
      splitMode = 'none';
    }
  }

  // 2. 拉一次 folder/note list 建缓存
  const cache = await buildFolderTreeCache();
  const createdNoteIds: string[] = [];
  const createdFolderIds: string[] = [];
  const skipped: Array<{ relPath: string; reason: string }> = [];

  const tea = textEditing();

  // 3. 逐文件:建 folder 链 → 转 PM → 落 note
  for (const parsed of parsedAll) {
    const { scanned } = parsed;
    const { dirSegments } = splitRelPath(scanned.relPath);

    let folderId: string | null;
    try {
      folderId = await ensureFolderPath(dirSegments, cache, createdFolderIds);
    } catch (err) {
      console.warn(
        `[markdown-import] ensureFolderPath failed for ${scanned.relPath}: ${String(err)}, falling back to root`,
      );
      folderId = null;
    }

    const shouldSplit = parsed.oversized && splitMode === 'all';

    if (shouldSplit) {
      const chunks = splitByMaxLevel(scanned.content, parsed);
      let chunkIdx = 0;
      for (const chunk of chunks) {
        let chunkTitle: string;
        if (chunk.titleHint) {
          chunkTitle = chunk.titleHint;
        } else if (chunkIdx === 0) {
          // 序言:用文件名
          chunkTitle = filenameTitle(scanned.relPath);
        } else {
          chunkTitle = `${filenameTitle(scanned.relPath)} (${chunkIdx + 1})`;
        }
        try {
          const content = await tea.markdownToProseMirror(chunk.body);
          await createNoteInFolder(
            chunkTitle,
            content,
            folderId,
            cache,
            createdNoteIds,
          );
        } catch (err) {
          console.warn(
            `[markdown-import] split chunk failed (${scanned.relPath} chunk ${chunkIdx}):`,
            err,
          );
          skipped.push({
            relPath: `${scanned.relPath}::chunk-${chunkIdx}`,
            reason: String(err),
          });
        }
        chunkIdx++;
      }
      continue;
    }

    // 普通文件:1:1 → note
    try {
      const content = await tea.markdownToProseMirror(scanned.content);
      const title = inferTitle(parsed, scanned.relPath);
      await createNoteInFolder(title, content, folderId, cache, createdNoteIds);
    } catch (err) {
      console.warn(`[markdown-import] failed: ${scanned.relPath}`, err);
      skipped.push({ relPath: scanned.relPath, reason: String(err) });
    }
  }

  return {
    createdNoteIds,
    createdFolderIds,
    skipped,
    splitMode,
    oversizedCount,
  };
}
