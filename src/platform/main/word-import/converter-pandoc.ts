/**
 * Pandoc 高质量 docx → markdown 转换器
 *
 * 链路:docx → spawn(pandoc -f docx -t gfm --extract-media=DIR) → markdown 字符串
 *       → 后处理(GFM math 语法 / coverTitle / 图片 base64 内联)
 *
 * 跟 converter.ts(mammoth)对比:
 * - ✅ OMML 公式正确转 LaTeX(GFM 用 ```math 块和 `$\`...\`$` 行内)
 * - ✅ Word 自动编号保留("1.2 数据治理" 章节号不丢)
 * - ✅ 表格合并单元格处理显著更好(rowspan/colspan)
 * - ❌ 依赖用户系统装 pandoc(detector 不可用时上层降级到 mammoth)
 *
 * Pandoc GFM 输出方言关键点(2026-05-27 实测 pandoc 3.9.0.2):
 * - block math:  ```math\nLATEX\n```   → 后处理转 $$\nLATEX\n$$(V2 md-to-pm 认 $$)
 * - inline math: $`LATEX`$              → 后处理转 $LATEX$
 * - 图片:        ![](DIR/media/imageN.png) → 后处理读文件转 data:base64
 *
 * 这些转换在 markdown 字符串层面做 — renderer 端 markdownToProseMirror 链路零改动。
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

import { scanDocxPaths, replaceDocxExtWithMd, type ScanFailure } from './scanner';
import { splitImageWithTrailingText } from './md-postprocess';

/** EMF/WMF 扩展名判定 — JS 生态没有库能正确画 EMF 文字,直接走 placeholder */
function isMetafileExt(p: string): boolean {
  const lower = p.toLowerCase();
  return lower.endsWith('.emf') || lower.endsWith('.wmf');
}

/** placeholder SVG(EMF/WMF 不可渲染时用)— 与 mammoth 路径保持一致 */
function buildMetafilePlaceholderSvg(label: string, mime: string): string {
  const labelEsc = label.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const mimeShort = mime.replace('image/x-', '').replace('image/', '').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="160" viewBox="0 0 480 160">
  <rect x="1" y="1" width="478" height="158" rx="6" fill="#f5f5f5" stroke="#999" stroke-width="1" stroke-dasharray="6 4"/>
  <text x="240" y="56" font-family="system-ui,sans-serif" font-size="16" font-weight="600" fill="#444" text-anchor="middle">⚠ ${mimeShort} 矢量图无法在浏览器中渲染</text>
  <text x="240" y="86" font-family="system-ui,sans-serif" font-size="13" fill="#666" text-anchor="middle">原文件:${labelEsc}</text>
  <text x="240" y="110" font-family="system-ui,sans-serif" font-size="11" fill="#888" text-anchor="middle">可在 import-cache/&lt;此次导入&gt;/05-emf-raw/ 找到原图</text>
  <text x="240" y="130" font-family="system-ui,sans-serif" font-size="11" fill="#888" text-anchor="middle">用 PowerPoint / Word / Inkscape 打开查看</text>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;
}

const execFileAsync = promisify(execFile);

const PANDOC_TIMEOUT_MS = 120_000; // 单文件 2 分钟硬上限(大文档 + 复杂公式可能慢)

export interface PandocConvertResult {
  absPath: string;
  /** GFM 后处理过的 markdown(math 转 $..$ / $$..$$,图片 base64 内联)*/
  markdown: string;
  /** Pandoc 直出的 raw markdown(三步后处理之前 — 诊断 cache 落 01-raw)*/
  rawMarkdown?: string;
  /** 从 markdown 首段抽出的封面标题(优先 H1 → 首段 italic / 普通段) */
  coverTitle: string | null;
  /** Pandoc stderr 收集到的警告(不识别样式 / OOXML quirks 等) */
  warnings: string[];
  /** EMF/WMF 原始二进制透传给 upstream 落 import-cache/05-emf-raw */
  metafiles?: Array<{ mime: string; label: string; data: Buffer }>;
}

export interface PandocBatchResult {
  absPath: string;
  relPath: string;
  markdown: string;
  rawMarkdown?: string;
  coverTitle: string | null;
  warnings: string[];
  metafiles?: Array<{ mime: string; label: string; data: Buffer }>;
}

/**
 * 单文件 Pandoc 转换
 *
 * 步骤:
 * 1. 创建临时 media 目录(pandoc --extract-media 输出图)
 * 2. spawn pandoc -f docx -t gfm --extract-media=DIR -o OUT.md INPUT.docx
 * 3. 读 OUT.md
 * 4. 后处理:GFM math 语法转换 + 图片 base64 内联 + coverTitle 抽取
 * 5. 清理临时目录
 */
export async function convertDocxToMarkdownPandoc(
  absPath: string,
  pandocPath: string,
): Promise<PandocConvertResult> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'krig-pandoc-'));
  const mediaDir = path.join(tempDir, 'media');
  const outFile = path.join(tempDir, `${randomUUID()}.md`);

  const warnings: string[] = [];

  try {
    const { stderr } = await execFileAsync(
      pandocPath,
      [
        '-f', 'docx',
        '-t', 'gfm',
        `--extract-media=${mediaDir}`,
        '-o', outFile,
        absPath,
      ],
      {
        timeout: PANDOC_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024, // 32MB stderr 上限(pandoc warnings 一般极少)
      },
    );

    if (stderr) {
      for (const line of stderr.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) warnings.push(trimmed);
      }
    }

    const rawMarkdown = await fs.readFile(outFile, 'utf-8');

    let markdown = normalizeGfmMathSyntax(rawMarkdown);
    // 关键:pandoc 对带 style/caption 的图输出 HTML <img>/<figure>(跨行),
    // V2 md-to-pm 只认 markdown ![](src),不解析 HTML 标签
    // → 先把 HTML 图形态拍扁成 ![](src),再走 inlineExtractedImages 读 base64
    markdown = flattenHtmlImagesToMarkdown(markdown);
    const metafiles: NonNullable<PandocConvertResult['metafiles']> = [];
    markdown = await inlineExtractedImages(markdown, mediaDir, metafiles);
    // pandoc 对带 caption/colgroup/cell 多段的复杂表 → 退化输出 raw HTML
    //   (GFM 表格语法不支持这些) V2 md-to-pm 不解析 HTML → 整段被当字面文字
    // 拍扁成 GFM markdown 表(2026-05-28 反馈):
    //   - cell 内多 <p> → <br> 分隔(跟 mammoth 路径一致,md-to-pm splitCellOnBr 已能拆)
    //   - caption/colgroup 丢
    //   - inline <strong>/<em>/<code> → **/*/`
    markdown = flattenHtmlTablesToMarkdown(markdown);
    // 防御:图后紧贴 caption 同行(pandoc 通常不会但 figcaption 拍平后可能产生)
    markdown = splitImageWithTrailingText(markdown);

    const { coverTitle, cleanedMarkdown } = extractCoverTitle(markdown);

    return {
      absPath,
      markdown: cleanedMarkdown,
      rawMarkdown,
      coverTitle,
      warnings,
      metafiles: metafiles.length > 0 ? metafiles : undefined,
    };
  } finally {
    // 清理临时目录(出错也要清,避免长期占盘)
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {
      /* 已尽力 */
    });
  }
}

/**
 * GFM math 语法转换:
 * - ``` math\nLATEX\n```  → $$\nLATEX\n$$
 * - $`LATEX`$            → $LATEX$
 *
 * Pandoc 3.x 对 docx OMML 公式默认走 GFM 数学方言,V2 md-to-pm 只认 $/$$,必须翻译。
 * 不动其他代码块(```python 等)只动 math 围栏。
 *
 * Pandoc 实测输出格式(2026-05-27 pandoc 3.9.0.2):
 *   ``` math       ← 注意:三反引号 + 空格 + math(不是 ```math 紧贴)
 *   LATEX
 *   ```
 */
export function normalizeGfmMathSyntax(markdown: string): string {
  // block: ``` math ... ```(容忍开头反引号后的可选空白,容忍 ``` 或更多反引号)
  let out = markdown.replace(
    /^([ \t]*)`{3,}[ \t]*math[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*`{3,}[ \t]*$/gm,
    (_, indent, latex) => `${indent}$$\n${latex.trim()}\n${indent}$$`,
  );

  // inline: $`...`$  (注意:`...` 内部可能有反斜杠,惰性匹配到下个 `$ 收尾)
  // 用 [^`] 防止跨多个 `$ ... $ ... $ 误吞
  out = out.replace(/\$`([^`]+?)`\$/g, (_, latex) => `$${latex}$`);

  return out;
}

/**
 * 把 pandoc 输出的 HTML 图形态拍扁成标准 markdown `![alt](src)`。
 *
 * Pandoc 3.x 对 docx 嵌图的输出形态(2026-05-27 实测):
 * - **带 caption** 的图:`<figure>\n<img src="..." style="..." />\n<figcaption>CAP</figcaption>\n</figure>`
 * - **无 caption 单图**:`<img src="..." style="..." />`(常跨行,style 在第二行)
 * - **markdown 形态**(罕见):`![alt](src)`(无 style 时偶尔走 md 语法)
 *
 * V2 md-to-pm 只识别 `![alt](src)`,完全不解析 HTML 标签 → HTML <img> 会被
 * 当成普通 raw text 渲染(截图证据:base64 一整段当文字显示)。
 *
 * 本函数职责:把所有 HTML 图形态拍扁成标准 markdown 行,**保留 src 和 caption(转 alt)**,
 * 丢弃 style/dimensions 等纯展示属性(下游不消费)。下一步 inlineExtractedImages
 * 再把 src 路径换 base64。
 */
export function flattenHtmlImagesToMarkdown(markdown: string): string {
  let out = markdown;

  // 1. <figure>...<img src="A" .../>...<figcaption>CAP</figcaption>...</figure>
  //    跨行+任意空白+多 child;非贪婪 [\s\S]*? 配 g/m 跨行匹配
  out = out.replace(
    /<figure\b[^>]*>([\s\S]*?)<\/figure>/g,
    (whole, inner: string) => {
      const imgSrc = extractImgSrc(inner);
      if (!imgSrc) return whole; // 没图的 figure 留着(罕见),不破坏
      const caption = extractFigcaption(inner);
      return `\n![${escapeMdAlt(caption)}](${imgSrc})\n`;
    },
  );

  // 2. 单 <img src="A" ... />(自闭合 / 非自闭合 / 跨行属性都吃)
  //    跨行用 [\s\S]*? 而不是 [^>]*(后者不跨行)
  out = out.replace(
    /<img\b([\s\S]*?)\/?>/g,
    (whole, attrs: string) => {
      const src = extractAttr(attrs, 'src');
      if (!src) return whole;
      const alt = extractAttr(attrs, 'alt') ?? '';
      return `![${escapeMdAlt(alt)}](${src})`;
    },
  );

  return out;
}

/**
 * 把 pandoc 退化输出的 raw HTML 表格拍扁成 GFM markdown 表(2026-05-28 反馈)。
 *
 * Pandoc 对带 caption / colgroup / cell 多段的复杂表 → GFM 语法不支持,退化输出
 * `<table>...<caption>...<colgroup>...<thead>...<tbody>...<tr><td>...</table>`。
 * V2 md-to-pm 不解析 HTML → 整段被当字面文字渲染。
 *
 * 转换策略:
 * - caption / colgroup / col / thead / tbody 标签丢(GFM 表头本来就在第一行)
 * - thead 内的 <tr> 作 header 行, tbody 内的 <tr> 作 data 行
 * - cell 内多 <p> → <br> 分隔(跟 mammoth 路径一致,md-to-pm splitCellOnBr 已能拆)
 * - inline 标签:<strong>/<b> → **, <em>/<i> → *, <code> → `, <br /> → <br>(保留)
 * - cell 内 markdown 图 `![](data:...)` 已经被前置 flattenHtmlImagesToMarkdown 处理过,
 *   走到这里时是 markdown 形态可以原样保留
 *
 * 注:本函数不处理嵌套 table(<td> 内含 <table>) — Word 几乎不会产生此结构
 */
export function flattenHtmlTablesToMarkdown(markdown: string): string {
  return markdown.replace(
    /<table\b[^>]*>([\s\S]*?)<\/table>/g,
    (_whole, inner: string) => convertOneTableToGfm(inner),
  );
}

function convertOneTableToGfm(tableInner: string): string {
  // 抽 header 行:thead 内的 <tr>
  const headerRows: string[][] = [];
  const theadMatch = /<thead\b[^>]*>([\s\S]*?)<\/thead>/i.exec(tableInner);
  if (theadMatch) {
    headerRows.push(...extractRows(theadMatch[1]));
  }
  // 抽 body 行:tbody 内的 <tr>,或没 tbody 时直接 table 下的 <tr>(skip thead 部分)
  const bodyRows: string[][] = [];
  const tbodyMatch = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(tableInner);
  if (tbodyMatch) {
    bodyRows.push(...extractRows(tbodyMatch[1]));
  } else if (!theadMatch) {
    // 既无 thead 也无 tbody — 直接抽全部 <tr>(简单表)
    bodyRows.push(...extractRows(tableInner));
  }

  // 没 header 时,把 body 第一行升级为 header(GFM 必须有 header 行)
  let headers: string[];
  let body: string[][];
  if (headerRows.length > 0) {
    headers = headerRows[0]; // 多 header 行只取第一行,其余并入 body
    body = [...headerRows.slice(1), ...bodyRows];
  } else if (bodyRows.length > 0) {
    headers = bodyRows[0];
    body = bodyRows.slice(1);
  } else {
    return ''; // 空表
  }

  // 列数对齐(取最大列数填补)
  const colCount = Math.max(headers.length, ...body.map((r) => r.length));
  const pad = (row: string[]): string[] => {
    const out = [...row];
    while (out.length < colCount) out.push('');
    return out;
  };

  const lines: string[] = [];
  lines.push('');
  lines.push(`| ${pad(headers).join(' | ')} |`);
  lines.push(`|${' --- |'.repeat(colCount)}`);
  for (const row of body) {
    lines.push(`| ${pad(row).join(' | ')} |`);
  }
  lines.push('');
  return lines.join('\n');
}

/** 抽 <tr>...</tr> 列表 → 每行 cell 字串数组 */
function extractRows(html: string): string[][] {
  const rows: string[][] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html)) !== null) {
    rows.push(extractCells(m[1]));
  }
  return rows;
}

/** 抽 <th>/<td>...</> 列表 → cell 内容字串(已 pipe escape,多段 <br> 连)*/
function extractCells(rowInner: string): string[] {
  const cells: string[] = [];
  const cellRe = /<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(rowInner)) !== null) {
    cells.push(cellInnerToMarkdown(m[2]));
  }
  return cells;
}

/** cell HTML 内容 → markdown 字符串(多段 <br> 连 + inline 标签转换 + pipe escape)*/
function cellInnerToMarkdown(html: string): string {
  // pandoc cell 实测两种形态(2026-05-28):
  // A. 含 <p>:  <td><p>段1</p><p>段2</p></td>   ← 复杂表
  // B. 无 <p> + 多 <br />:  <td>段1<br />段2<br />段3</td>   ← 简单"软换行"段
  // 两种都要规整成 segments 数组,用 <br> 单一分隔符 join,
  // 同时把真换行符(GFM 表格 cell 不能含真换行)全部消除

  let segments: string[] = [];
  const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = pRe.exec(html)) !== null) {
    const before = html.slice(lastEnd, m.index).trim();
    if (before) segments.push(before);
    segments.push(m[1]);
    lastEnd = m.index + m[0].length;
  }
  const tail = html.slice(lastEnd).trim();
  if (tail) segments.push(tail);
  // 形态 B(没 <p>) → 整段当一个 segment
  if (segments.length === 0) segments.push(html);

  // 每段:剥 inline 标签 + <br /> 转字面 `<br>` 占位,再按 `<br>` 二次拆段
  // 这样形态 A 跨 <p> 段 + 形态 B 段内 <br /> 都能拍成单层 segments
  const expanded: string[] = [];
  for (const seg of segments) {
    const md = stripInlineToMd(seg); // <br /> 已被转成 <br>
    // 按 <br> 拆 + 真换行也算分段(消除真换行 → 关键修复)
    const parts = md.split(/<br>|\r?\n/);
    for (const p of parts) expanded.push(p);
  }

  const joined = expanded
    .map((s) => s.trim())
    .filter(Boolean)
    .join('<br>');

  return escapeCellPipe(joined);
}

/** inline HTML 标签 → markdown marks;裸 text 原样,剥不认识的标签 */
function stripInlineToMd(html: string): string {
  return html
    // <strong>/<b> → **
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, inner) => `**${inner}**`)
    // <em>/<i> → *
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, inner) => `*${inner}*`)
    // <code> → `
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, inner) => `\`${inner}\``)
    // <br /> → 保留 <br>(我们就是用 <br> 作 cell 内段间分隔的)
    .replace(/<br\s*\/?\s*>/gi, '<br>')
    // 其他 HTML 标签 剥(保留内容):<sub>1</sub> → 1 这种
    .replace(/<[^>]+>/g, '')
    // HTML entity 解
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** cell 内 | 必须 escape,否则破坏 GFM 表格列分隔 */
function escapeCellPipe(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function extractImgSrc(html: string): string | null {
  const m = /<img\b[\s\S]*?\bsrc\s*=\s*["']([^"']+)["']/.exec(html);
  return m ? m[1] : null;
}

function extractFigcaption(html: string): string {
  const m = /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/.exec(html);
  if (!m) return '';
  // 剥 figcaption 内嵌的 tag 取纯文本
  return m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function extractAttr(attrsBlob: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i');
  const m = re.exec(attrsBlob);
  return m ? m[1] : null;
}

/** alt 文本可能含 ] / 反斜杠等会破 markdown 语法的字符,做最小转义 */
function escapeMdAlt(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\]/g, '\\]').replace(/\n/g, ' ');
}

/**
 * 把 pandoc --extract-media 输出的图片路径替换为 data:base64 内联。
 *
 * 输入约定:本函数 **在 flattenHtmlImagesToMarkdown 之后** 跑,
 * 此时 markdown 里只剩标准 `![alt](src)` 形态(HTML 已拍扁)。
 * HTML <img> 兜底分支保留作防御,不应有命中。
 *
 * V2 renderer markdownToProseMirror 支持 data:base64,**不支持文件路径**,
 * 临时目录又会在转换完清理,所以必须当场把每张图读成 base64 内联。
 */
export async function inlineExtractedImages(
  markdown: string,
  mediaDir: string,
  metafilesOut?: Array<{ mime: string; label: string; data: Buffer }>,
): Promise<string> {
  const mediaDirNorm = path.resolve(mediaDir);
  if (!mediaDirNorm) return markdown;

  // 匹配 markdown 图(![alt](src))和 HTML 图(<img src="...">),只处理指向 mediaDir 的
  // 注:pandoc 主路径已被 flattenHtmlImagesToMarkdown 转成 markdown 形态,
  // HTML 分支是防御兜底(若上游漏匹配也能救);跨行用 [\s\S] 而非 [^>]
  const mdImgRegex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const htmlImgRegex = /<img\b[\s\S]*?\bsrc=["']([^"']+)["'][\s\S]*?\/?>/g;

  // 收集所有 src 候选 → 解析 → 读文件 → 替换
  const replacements: Array<{ raw: string; abs: string; alt: string; kind: 'md' | 'html' }> = [];

  let m: RegExpExecArray | null;
  while ((m = mdImgRegex.exec(markdown)) !== null) {
    replacements.push({ raw: m[0], abs: resolveMediaPath(m[2], mediaDirNorm), alt: m[1], kind: 'md' });
  }
  while ((m = htmlImgRegex.exec(markdown)) !== null) {
    replacements.push({ raw: m[0], abs: resolveMediaPath(m[1], mediaDirNorm), alt: '', kind: 'html' });
  }

  let out = markdown;
  let metafileSeq = 0;
  for (const r of replacements) {
    if (!r.abs) continue; // 外部 url / 解析失败 — 不动
    try {
      const buf = await fs.readFile(r.abs);
      let dataUrl: string;
      let altOverride: string | null = null;

      if (isMetafileExt(r.abs)) {
        // Office 矢量图(EMF/WMF)→ Chromium 不渲染,JS 生态无库能正确画 EMF 文字
        // (2026-05-27 调研:emf-converter / emfjs / gn-rtf.js 全部跳 EXTTEXTOUTW)
        // → placeholder + 原文件推给 caller 落 import-cache/05-emf-raw
        const mime = r.abs.toLowerCase().endsWith('.wmf') ? 'image/x-wmf' : 'image/x-emf';
        metafileSeq++;
        const ext = mime.includes('wmf') ? 'wmf' : 'emf';
        const label = `image-${String(metafileSeq).padStart(3, '0')}.${ext}`;
        metafilesOut?.push({ mime, label, data: buf });
        dataUrl = buildMetafilePlaceholderSvg(label, mime);
        // alt 里不能有 [ ] — 见 converter.ts 同位置注释
        altOverride = `EMF placeholder ${label}`;
      } else {
        const mime = guessMimeFromExt(r.abs);
        dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      }

      const replacement = r.kind === 'md'
        ? `![${altOverride ?? r.alt}](${dataUrl})`
        : `<img src="${dataUrl}">`;
      out = out.split(r.raw).join(replacement);
    } catch {
      // 读不到 — 保留原引用让用户看到 broken,而不是悄悄掉图
    }
  }

  return out;
}

function resolveMediaPath(src: string, mediaDirNorm: string): string {
  if (/^(https?:|data:|file:)/i.test(src)) return '';

  // pandoc 输出绝对路径或相对路径 — 相对路径相对 cwd(pandoc 时是 main process cwd,
  // 用 absolute --extract-media,输出就是绝对路径)
  const absCandidate = path.isAbsolute(src) ? src : path.resolve(src);

  // 安全检查:必须在 mediaDir 内,防止 markdown 里有任意路径攻击
  const normalized = path.resolve(absCandidate);
  if (!normalized.startsWith(mediaDirNorm + path.sep)) return '';
  return normalized;
}

function guessMimeFromExt(p: string): string {
  const ext = path.extname(p).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.svg': return 'image/svg+xml';
    case '.webp': return 'image/webp';
    case '.bmp': return 'image/bmp';
    default: return 'application/octet-stream';
  }
}

/**
 * 封面标题抽取(Pandoc 路径)
 *
 * Pandoc 输出特性:
 * - Word Title 样式 → 通常输出为首段 italic(*text*),不一定是 H1
 * - 章节自动编号被保留:`# 1. Introduction`,H1 是真正的章节,不是封面
 *
 * 策略:取第一个 H1 之前的第一个非空段落(剥 markdown 标记),命中删除该段。
 * 跟 mammoth 路径的 fallback 思路一致 — 封面段语义上就在正文 heading 之前。
 *
 * 命中 placeholder(Untitled / 机密 等) → 跳过看下一个。
 */
export function extractCoverTitle(markdown: string): {
  coverTitle: string | null;
  cleanedMarkdown: string;
} {
  const lines = markdown.split('\n');

  // 找第一个 H1 位置(`# ` 开头)
  let firstHeadingIdx = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^#\s/.test(lines[i])) {
      firstHeadingIdx = i;
      break;
    }
  }

  for (let i = 0; i < firstHeadingIdx; i++) {
    const raw = lines[i];
    if (!raw || !raw.trim()) continue;
    if (raw.trim().startsWith('<')) continue; // HTML 注释 / metadata block 等跳过

    const text = stripMarkdownInline(raw).trim();
    if (!text) continue;
    if (text.length > 200) continue;
    if (isLikelyCoverPlaceholder(text)) continue;

    // 命中:删除该行
    const cleanedLines = [...lines.slice(0, i), ...lines.slice(i + 1)];
    return { coverTitle: text, cleanedMarkdown: cleanedLines.join('\n') };
  }

  return { coverTitle: null, cleanedMarkdown: markdown };
}

/** 剥 markdown inline 标记取纯文本(用于封面 text 抽取)*/
function stripMarkdownInline(line: string): string {
  return line
    .replace(/\*\*([^*]+)\*\*/g, '$1')   // bold
    .replace(/__([^_]+)__/g, '$1')        // bold alt
    .replace(/\*([^*]+)\*/g, '$1')        // italic
    .replace(/_([^_]+)_/g, '$1')          // italic alt
    .replace(/~~([^~]+)~~/g, '$1')        // strike
    .replace(/`([^`]+)`/g, '$1')          // code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // link
    .replace(/\\([\\`*_{}\[\]()#+\-.!])/g, '$1') // backslash escapes
    .replace(/\s+/g, ' ');
}

const COVER_PLACEHOLDER_KEYWORDS = [
  'untitled', 'confidential', '机密', '内部使用', '草稿', 'draft',
  '免责声明', 'disclaimer', 'copyright', '©', '版权所有',
];

function isLikelyCoverPlaceholder(text: string): boolean {
  const lower = text.toLowerCase();
  return COVER_PLACEHOLDER_KEYWORDS.some((kw) => lower.includes(kw));
}

/** 接收路径数组(可能含目录),递归找出所有 .docx,pandoc 转成 markdown */
export async function convertDocxBatchPandoc(
  paths: string[],
  pandocPath: string,
): Promise<{
  results: PandocBatchResult[];
  failed: ScanFailure[];
}> {
  const { files, failed } = await scanDocxPaths(paths);
  const results: PandocBatchResult[] = [];

  for (const f of files) {
    try {
      const r = await convertDocxToMarkdownPandoc(f.absPath, pandocPath);
      results.push({
        absPath: f.absPath,
        relPath: replaceDocxExtWithMd(f.relPath),
        markdown: r.markdown,
        rawMarkdown: r.rawMarkdown,
        coverTitle: r.coverTitle,
        warnings: r.warnings,
        metafiles: r.metafiles,
      });
    } catch (err) {
      failed.push({ path: f.absPath, reason: String(err) });
    }
  }

  return { results, failed };
}
