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

const execFileAsync = promisify(execFile);

const PANDOC_TIMEOUT_MS = 120_000; // 单文件 2 分钟硬上限(大文档 + 复杂公式可能慢)

export interface PandocConvertResult {
  absPath: string;
  /** GFM 后处理过的 markdown(math 转 $..$ / $$..$$,图片 base64 内联)*/
  markdown: string;
  /** 从 markdown 首段抽出的封面标题(优先 H1 → 首段 italic / 普通段) */
  coverTitle: string | null;
  /** Pandoc stderr 收集到的警告(不识别样式 / OOXML quirks 等) */
  warnings: string[];
}

export interface PandocBatchResult {
  absPath: string;
  relPath: string;
  markdown: string;
  coverTitle: string | null;
  warnings: string[];
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

    let markdown = await fs.readFile(outFile, 'utf-8');

    markdown = normalizeGfmMathSyntax(markdown);
    markdown = await inlineExtractedImages(markdown, mediaDir);

    const { coverTitle, cleanedMarkdown } = extractCoverTitle(markdown);

    return {
      absPath,
      markdown: cleanedMarkdown,
      coverTitle,
      warnings,
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
 * 把 pandoc --extract-media 输出的图片路径替换为 data:base64 内联。
 *
 * pandoc 输出格式:`![](TEMPDIR/media/imageN.png)` 或 `<img src="TEMPDIR/media/imageN.png">`
 * V2 renderer markdownToProseMirror 支持 data:base64,**不支持文件路径**,
 * 临时目录又会在转换完清理,所以必须当场把每张图读成 base64 内联。
 */
export async function inlineExtractedImages(
  markdown: string,
  mediaDir: string,
): Promise<string> {
  const mediaDirNorm = path.resolve(mediaDir);
  if (!mediaDirNorm) return markdown;

  // 匹配 markdown 图(![alt](src))和 HTML 图(<img src="...">),只处理指向 mediaDir 的
  const mdImgRegex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const htmlImgRegex = /<img\b[^>]*\bsrc="([^"]+)"[^>]*>/g;

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
  for (const r of replacements) {
    if (!r.abs) continue; // 外部 url / 解析失败 — 不动
    try {
      const buf = await fs.readFile(r.abs);
      const mime = guessMimeFromExt(r.abs);
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      const replacement = r.kind === 'md'
        ? `![${r.alt}](${dataUrl})`
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
        coverTitle: r.coverTitle,
        warnings: r.warnings,
      });
    } catch (err) {
      failed.push({ path: f.absPath, reason: String(err) });
    }
  }

  return { results, failed };
}
