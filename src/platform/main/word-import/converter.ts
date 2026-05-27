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
 * 从 mammoth HTML 抠 Title 样式段落作 coverTitle
 *
 * 策略:
 * 1. 找第一个 `<p class="krig-cover-title">...</p>` 取文本
 * 2. 删除该段落(避免它出现在 markdown 正文里造成重复)
 * 3. 不处理 Subtitle(按用户决议:不拼,不单独抽,留在正文中)
 * 4. 找不到 → coverTitle=null,renderer 端 fallback 文件名 / heading
 *
 * 注:正则解析 HTML 通常脆弱,但 mammoth 输出的 HTML 是规整的(<p>...</p>),
 * 不嵌套、不带怪异属性,正则足够,引 cheerio 是过度工程。
 */
function extractCoverTitle(html: string): { coverTitle: string | null; cleanedHtml: string } {
  const titleRegex = new RegExp(
    `<p\\s+class="${KRIG_TITLE_CLASS}"[^>]*>([\\s\\S]*?)<\\/p>`,
    'i',
  );
  const match = titleRegex.exec(html);
  if (!match) {
    return { coverTitle: null, cleanedHtml: html };
  }

  // 抠 inner text(去 <strong>/<em>/<br> 等标签 + decode &amp; / &lt; 等)
  const innerHtml = match[1];
  const text = innerHtml
    .replace(/<[^>]+>/g, '')        // 剥所有 HTML 标签
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

  if (!text) {
    // Title 标记但内容为空 — 当作没有
    return { coverTitle: null, cleanedHtml: html.replace(match[0], '') };
  }

  // 从 HTML 删掉这一段(避免 markdown 里重复)
  const cleanedHtml = html.replace(match[0], '');
  return { coverTitle: text, cleanedHtml };
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
