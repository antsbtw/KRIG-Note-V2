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
  /** mammoth 报的 warning 信息(公式跳过 / 不识别样式等)*/
  warnings: string[];
}

/** 单文件转换:.docx → markdown 字符串 */
export async function convertDocxToMarkdown(absPath: string): Promise<ConvertResult> {
  const buffer = await fs.readFile(absPath);

  // mammoth 1.12+ 接 NodeJsInput;path 模式会自动读文件,但我们已读了 buffer
  // (统一走 buffer 避免 mammoth 内部再次读盘 + 方便错误处理)
  const mammothResult = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        // 把图直接转 base64 data: URL(renderer 端 md-to-pm 会再走 mediaPutBase64)
        const base64 = await image.readAsBase64String();
        return { src: `data:${image.contentType};base64,${base64}` };
      }),
    },
  );

  const html = mammothResult.value;
  const warnings = mammothResult.messages
    .filter((m) => Boolean(m))
    .map((m) => `${m.type}: ${m.message}`);

  // HTML → Markdown
  const turndown = new TurndownService({
    headingStyle: 'atx',     // # / ## 风格(不用 setext)
    codeBlockStyle: 'fenced', // ``` 包代码块
    bulletListMarker: '-',    // 跟我们 md-to-pm 偏好对齐
  });

  // GFM 表格支持(turndown 默认不开表格,需 plugin)
  // turndown-plugin-gfm 没装,简单做法:手写一个 table 规则
  registerTablePlugin(turndown);

  // 删除线(GFM ~~)
  turndown.addRule('strikethrough', {
    filter: ['del', 's', 'strike' as keyof HTMLElementTagNameMap],
    replacement: (content) => `~~${content}~~`,
  });

  const markdown = turndown.turndown(html);

  return {
    absPath,
    markdown,
    warnings,
  };
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

/** 接收路径数组(可能含目录),递归找出所有 .docx,转成 markdown */
export async function convertDocxBatch(
  paths: string[],
): Promise<{
  results: Array<{ absPath: string; relPath: string; markdown: string; warnings: string[] }>;
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

  // 转换
  const results: Array<{
    absPath: string;
    relPath: string;
    markdown: string;
    warnings: string[];
  }> = [];

  for (const f of docxFiles) {
    try {
      const r = await convertDocxToMarkdown(f.absPath);
      results.push({
        absPath: f.absPath,
        relPath: replaceDocxExtWithMd(f.relPath),
        markdown: r.markdown,
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
