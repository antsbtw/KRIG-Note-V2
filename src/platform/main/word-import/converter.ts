/**
 * word-import converter — .docx 文件 → markdown 字符串
 *
 * 链路:docx → mammoth.convertToHtml → turndown HTML→MD → markdown 字符串
 *
 * 设计:
 * - mammoth 用 dataUri converter 把嵌入图直接转 base64 data: URL
 *   (renderer 端 markdownToProseMirror 已经支持 data: URL → mediaStore,完美对接)
 * - turndown 用 GFM 兼容设置(表格 + 删除线 + 任务列表 + 围栏代码块)
 * - mammoth.messages 收集为 warning 列表(主进程 console.warn,不弹窗)
 *
 * 已知不支持(本期接受):
 * - 公式(OMML)— mammoth 跳过,产物里不会有
 * - 引文 / EndNote / Zotero 域 — 退化为纯文本
 * - 复杂表格合并单元格 — mammoth rowspan/colspan 输出可能不完整
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import mammoth from 'mammoth';
import TurndownService from 'turndown';

export interface ConvertResult {
  /** docx 文件原始路径(诊断用)*/
  absPath: string;
  /** 转出来的 markdown 字符串(可直接喂 renderer 端 markdownToProseMirror)*/
  markdown: string;
  /** 从 Word Title 样式提取的封面标题(优先用作 note title / split folder name)*/
  coverTitle: string | null;
  /** mammoth 报的 warning 信息(公式跳过 / 不识别样式等)*/
  warnings: string[];
}

/**
 * mammoth styleMap 把 Title/Subtitle(中英文)映射到带 class 的 p 元素
 * 后处理时用 class 抠出来作 coverTitle。
 *
 * 注意:**不映射到 h1/h2**,避免被当作正文 heading 干扰章节切分判定。
 */
const KRIG_TITLE_CLASS = 'krig-cover-title';
const KRIG_SUBTITLE_CLASS = 'krig-cover-subtitle';

const CUSTOM_STYLE_MAP = [
  // 英文 Word
  `p[style-name='Title'] => p.${KRIG_TITLE_CLASS}:fresh`,
  `p[style-name='Subtitle'] => p.${KRIG_SUBTITLE_CLASS}:fresh`,
  // 中文 Word(Office365 / WPS 中文版常见)
  `p[style-name='标题'] => p.${KRIG_TITLE_CLASS}:fresh`,
  `p[style-name='副标题'] => p.${KRIG_SUBTITLE_CLASS}:fresh`,
  // 国产内部模板常用 'w' 前缀(如普元等)
  `p[style-name='w标题'] => p.${KRIG_TITLE_CLASS}:fresh`,
  `p[style-name='w副标题'] => p.${KRIG_SUBTITLE_CLASS}:fresh`,
  `p[style-name='封面标题'] => p.${KRIG_TITLE_CLASS}:fresh`,
  `p[style-name='文档标题'] => p.${KRIG_TITLE_CLASS}:fresh`,
];

/** 单文件转换:.docx → { markdown, coverTitle } */
export async function convertDocxToMarkdown(absPath: string): Promise<ConvertResult> {
  const buffer = await fs.readFile(absPath);

  const mammothResult = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: CUSTOM_STYLE_MAP,
      convertImage: mammoth.images.imgElement(async (image) => {
        const base64 = await image.readAsBase64String();
        return { src: `data:${image.contentType};base64,${base64}` };
      }),
    },
  );

  const rawHtml = mammothResult.value;
  const warnings = mammothResult.messages
    .filter((m) => Boolean(m))
    .map((m) => `${m.type}: ${m.message}`);

  // 抠封面标题 + 从 HTML 删除该段落(避免 markdown 里重复出现)
  const { coverTitle, cleanedHtml } = extractCoverTitle(rawHtml);

  // HTML → Markdown
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  registerTablePlugin(turndown);

  turndown.addRule('strikethrough', {
    filter: ['del', 's', 'strike' as keyof HTMLElementTagNameMap],
    replacement: (content) => `~~${content}~~`,
  });

  const markdown = turndown.turndown(cleanedHtml);

  return {
    absPath,
    markdown,
    coverTitle,
    warnings,
  };
}

/**
 * 从 mammoth HTML 抠封面标题
 *
 * 两层策略(2026-05-27 反馈 — 国产模板自定义样式 mammoth 不识别):
 *
 * 1. 优先:找 `<p class="krig-cover-title">...</p>`(styleMap 命中的样式)
 *    覆盖率:Word 原生 Title / 中文标题 / w标题 等已知模板
 *
 * 2. Fallback:取**第一个 `<h*>` 之前的第一个非空 `<p>`** 作 coverTitle
 *    适用场景:docx 用自定义/不识别的样式 — 但封面段落本来就该在正文(H1)之前
 *    跳过 placeholder("Untitled" / "未命名" / "Confidential" 等)
 *
 * 命中后:删除该段落(避免 markdown 里重复出现);两层都不命中 → null。
 */
function extractCoverTitle(html: string): { coverTitle: string | null; cleanedHtml: string } {
  // ── 第一层:styleMap 命中的 krig-cover-title class ──
  const titleRegex = new RegExp(
    `<p\\s+class="${KRIG_TITLE_CLASS}"[^>]*>([\\s\\S]*?)<\\/p>`,
    'i',
  );
  const classMatch = titleRegex.exec(html);
  if (classMatch) {
    const text = decodeHtmlInline(classMatch[1]);
    if (text) {
      return { coverTitle: text, cleanedHtml: html.replace(classMatch[0], '') };
    }
  }

  // ── 第二层 fallback:第一个 <h*> 之前的第一个非空 <p> ──
  return extractFirstPreHeadingParagraph(html);
}

/**
 * 找 HTML 里第一个 `<h*>` 之前的第一个 `<p>` 段落作 coverTitle
 * (封面标题语义 — 文档正文 heading 开始之前的非空段落)
 *
 * 跳过 placeholder 文本(Untitled / 未命名 / Confidential 等)。
 * 命中 → 删除该 <p> 并返回;否则返回 (null, 原 HTML)。
 */
function extractFirstPreHeadingParagraph(
  html: string,
): { coverTitle: string | null; cleanedHtml: string } {
  // 先找到第一个 heading 的位置(没 heading 就是整篇都是 <p>,取首段也行)
  const firstHeadingMatch = /<h[1-6]\b/i.exec(html);
  const cutoff = firstHeadingMatch ? firstHeadingMatch.index : html.length;
  const preHeadingZone = html.slice(0, cutoff);

  const pRegex = /<p(?:\s+[^>]*)?>([\s\S]*?)<\/p>/gi;
  let m: RegExpExecArray | null;
  while ((m = pRegex.exec(preHeadingZone)) !== null) {
    const text = decodeHtmlInline(m[1]);
    if (!text) continue;
    if (isLikelyCoverPlaceholder(text)) continue;
    if (text.length > 200) continue; // 太长不像标题(可能是摘要)
    // 命中
    return {
      coverTitle: text,
      cleanedHtml: html.slice(0, m.index) + html.slice(m.index + m[0].length),
    };
  }

  return { coverTitle: null, cleanedHtml: html };
}

/** 黑名单:封面常见的非标题段落(免责声明 / 占位 / 涉密标记 等) */
const COVER_PLACEHOLDER_KEYWORDS = [
  'untitled',
  'confidential',
  '机密',
  '内部使用',
  '草稿',
  'draft',
  '免责声明',
  'disclaimer',
  'copyright',
  '©',
  '版权所有',
];

function isLikelyCoverPlaceholder(text: string): boolean {
  const lower = text.toLowerCase();
  return COVER_PLACEHOLDER_KEYWORDS.some((kw) => lower.includes(kw));
}

/** 抠 inner text:剥所有 HTML 标签 + 解 HTML entity */
function decodeHtmlInline(innerHtml: string): string {
  return innerHtml
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 简版 table 插件:把 <table> 转 GFM markdown
 *
 * 不处理合并单元格(rowspan/colspan)— 这是 mammoth 本身的局限,
 * 强行展开会让表格视觉错位,不如保持原样让用户在导入后看到再决定
 */
function registerTablePlugin(turndown: TurndownService): void {
  turndown.addRule('table-cell', {
    filter: ['th', 'td'],
    replacement: (content) => ` ${content.replace(/\n/g, ' ').trim()} |`,
  });

  turndown.addRule('table-row', {
    filter: 'tr',
    replacement: (content, node) => {
      const cellsCount = (node as HTMLElement).querySelectorAll('td, th').length;
      // 表头行后面加分隔行
      const isFirstRow = !(node as HTMLElement).previousElementSibling;
      const sep = isFirstRow
        ? '\n|' + ' --- |'.repeat(cellsCount)
        : '';
      return `|${content}${sep}\n`;
    },
  });

  turndown.addRule('table', {
    filter: 'table',
    replacement: (content) => `\n\n${content}\n\n`,
  });
}

export interface BatchResult {
  absPath: string;
  relPath: string;
  markdown: string;
  coverTitle: string | null;
  warnings: string[];
}

/** 接收路径数组(可能含目录),递归找出所有 .docx,转成 markdown */
export async function convertDocxBatch(
  paths: string[],
): Promise<{
  results: BatchResult[];
  failed: Array<{ path: string; reason: string }>;
}> {
  const docxFiles: Array<{ absPath: string; relPath: string }> = [];
  const failed: Array<{ path: string; reason: string }> = [];

  // 扫描 paths,找 .docx
  for (const p of paths) {
    try {
      const stat = await fs.stat(p);
      if (stat.isDirectory()) {
        await walkDirForDocx(p, path.basename(p), docxFiles, failed);
      } else if (stat.isFile() && isDocxFile(p)) {
        docxFiles.push({ absPath: p, relPath: path.basename(p) });
      } else if (stat.isFile()) {
        failed.push({ path: p, reason: 'not a .docx file' });
      }
    } catch (err) {
      failed.push({ path: p, reason: String(err) });
    }
  }

  const results: BatchResult[] = [];

  for (const f of docxFiles) {
    try {
      const r = await convertDocxToMarkdown(f.absPath);
      results.push({
        absPath: f.absPath,
        relPath: replaceDocxExtWithMd(f.relPath),
        markdown: r.markdown,
        coverTitle: r.coverTitle,
        warnings: r.warnings,
      });
    } catch (err) {
      failed.push({ path: f.absPath, reason: String(err) });
    }
  }

  return { results, failed };
}

function isDocxFile(name: string): boolean {
  return path.extname(name).toLowerCase() === '.docx';
}

function replaceDocxExtWithMd(relPath: string): string {
  return relPath.replace(/\.docx$/i, '.md');
}

const DIR_BLACKLIST = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.cache']);

async function walkDirForDocx(
  rootAbs: string,
  rootSegment: string,
  docxFiles: Array<{ absPath: string; relPath: string }>,
  failed: Array<{ path: string; reason: string }>,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(rootAbs, { withFileTypes: true });
  } catch (err) {
    failed.push({ path: rootAbs, reason: String(err) });
    return;
  }

  for (const entry of entries) {
    const name = entry.name;
    const childAbs = path.join(rootAbs, name);

    if (entry.isDirectory()) {
      if (DIR_BLACKLIST.has(name) || name.startsWith('.')) continue;
      await walkDirForDocx(childAbs, `${rootSegment}/${name}`, docxFiles, failed);
      continue;
    }

    if (!entry.isFile()) continue;
    if (name.startsWith('.')) continue;
    if (!isDocxFile(name)) continue;

    docxFiles.push({ absPath: childAbs, relPath: `${rootSegment}/${name}` });
  }
}
