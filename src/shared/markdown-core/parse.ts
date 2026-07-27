/**
 * markdownCore —— 完整 markdown → PMNode[] 解析入口（阶段 B4b 收官）。
 *
 * B1–B4a 逐类把 block 的 canonical 构造器收进核，但**入口循环**一直只解析 B1 块
 * （heading/paragraph/hr/code/math），其余产 uncovered 哨兵交 caller。B4b 把 table/callout/
 * blockquote/list/task/image/video/audio/html/file **全部接进入口**，让核成为唯一真源：
 * ① AI 提取从此是「核的一个薄 caller」（预处理 → markdownCore → PMNode[]），不再自建
 * ExtractedBlock 中间态。
 *
 * **铁律**：
 *  - 纯 sync、无副作用、无媒体 I/O。**src 原样**（base64/远程URL/`image:pageN` 原样出，
 *    不本地化）—— 本地化是各自外壳的事（② 的 resolvePMImageSrc；① 无本地化，raw src 即可）。
 *  - blockquote / list item 的**内容递归调本入口（sync）**，不引入 async。
 *
 * **与 ② 的关系**：本入口是 ② markdownToProseMirror 解析语法的 sync 版（去掉 async 媒体
 * 本地化）。② 暂保留自己的 async 外壳 loop（B4b 只让 ① 收敛）；未来 ② 也可薄化到调本入口
 * + 外壳后处理本地化，但不在 B4b 范围。
 */

import type { PMNode } from './types';
import { uncoveredNode } from './types';
import {
  buildHeadingNode,
  buildParagraphNode,
  buildHorizontalRuleNode,
  buildMathBlockNode,
  tryParseCodeBlock,
} from './blocks';
import { parseInline } from './inline';
import { buildTableNode, buildCalloutNode, calloutEmojiFor } from './table-callout';
import {
  parseImageSrc,
  buildImageNode,
  buildHtmlBlockNode,
  buildFileBlockNode,
  buildExternalRefNode,
  tryParseMediaTag,
  tryParseObsidianVideoEmbed,
} from './media-blocks';
import {
  stripBlockquotePrefix,
  buildBlockquoteNode,
  classifyListLine,
  buildListItemNode,
  buildBulletListNode,
  buildOrderedListNode,
  buildTaskItemNode,
  buildTaskListNode,
} from './blockquote-list';

/** 一行是否像表格行（2+ 管道；容忍裸管道 `cell | cell`，与 ① looksLikeTableRow 对齐）。 */
function looksLikeTableRow(line: string): boolean {
  if (!line) return false;
  const pipeCount = (line.match(/\|/g) || []).length;
  if (pipeCount < 2) return false;
  // 分隔行 `| --- | --- |` / `--- | --- | ---`
  if (/^[\s|:-]+$/.test(line) && line.includes('---')) return true;
  return line.replace(/\|/g, '').trim().length > 0;
}

/** 分隔行判定（`| --- |` 等）。 */
function isTableSeparator(line: string): boolean {
  const t = line.trim();
  return /^[\s|:-]+$/.test(t) && t.includes('---');
}

/** 切一行表格 cell（容忍标准 `| a | b |` 与裸 `a | b | c`，与 ① collectTable 对齐）。 */
function splitTableCells(rowLine: string): string[] {
  const t = rowLine.trim();
  if (t.startsWith('|') && t.endsWith('|')) {
    return t.split('|').slice(1, -1).map((c) => c.trim());
  }
  return t.split('|').map((c) => c.trim());
}

/**
 * markdown → 完整 canonical PMNode[]。src 原样、纯 sync、内容递归调本入口。
 *
 * 识别顺序与 ② markdownToProseMirror 对齐（先具体块后 paragraph 兜底）：
 * code → math → 链接图/图 → attach/file → html/obsidian/媒体标签 → heading → hr →
 * blockquote(含 GFM alert) → list(bullet/ordered/task) → table → paragraph。
 * createdAt（taskItem）由 caller 无法传时用空串占位（① 不产时间；本入口不引入 Date.now
 * 保持纯度 —— caller 若需精确 createdAt 走自己外壳补，或用 markdownCoreWithOpts）。
 */
export function markdownCore(md: string, opts?: { taskCreatedAt?: string }): PMNode[] {
  const taskCreatedAt = opts?.taskCreatedAt ?? '';
  const lines = md.split('\n');
  const out: PMNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 空行跳过
    if (line.trim() === '') {
      i++;
      continue;
    }

    // ── codeBlock（fence 长度配对）──
    const code = tryParseCodeBlock(lines, i);
    if (code) {
      out.push(code.node);
      i = code.nextIndex;
      continue;
    }

    // ── mathBlock（$$…$$，可跨行）──
    if (line.trim().startsWith('$$')) {
      const consumed = consumeMathBlock(lines, i);
      if (consumed) {
        // 空 latex 产 uncovered 交 caller（不静默吞；② 外壳降级 unknown、① 极罕见）
        out.push(
          consumed.latex
            ? buildMathBlockNode(consumed.latex)
            : uncoveredNode(lines.slice(i, consumed.nextIndex).join('\n')),
        );
        i = consumed.nextIndex;
        continue;
      }
    }

    // ── 链接图片 [![alt](img)](url) → image（丢外层链接，图是主体；必须先于裸图）──
    const linkedImg = line.trim().match(/^\[!\[([^\]]*)\]\(([^)]+)\)\]\(([^)]+)\)\s*$/);
    if (linkedImg) {
      const { alt, caption } = splitImageAlt(linkedImg[1] || '');
      const { src } = parseImageSrc(linkedImg[2]);
      out.push(buildImageNode(src, alt, caption));
      i++;
      continue;
    }

    // ── 裸块级图片 ![alt](url)（含 ①方言 image:pageN[:bbox]）──
    const imgMatch = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (imgMatch) {
      const { alt, caption } = splitImageAlt(imgMatch[1] || '');
      const { src } = parseImageSrc(imgMatch[2]); // bbox/pageRef 解析出但 schema 无 attr → 丢弃（B3 拍板）
      out.push(buildImageNode(src, alt, caption));
      i++;
      continue;
    }

    // ── !attach[name](src) → fileBlock（src 原样，本地化留 caller 外壳）──
    const attachMatch = line.trim().match(/^!attach\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (attachMatch) {
      const filename = (attachMatch[1] || 'attachment').trim();
      out.push(
        buildFileBlockNode({ src: attachMatch[2], mediaId: '', filename, mimeType: '' }),
      );
      i++;
      continue;
    }

    // ── !file[title](path) → externalRef（href 原样；path 协议归一属 caller 语义）──
    const fileMatch = line.trim().match(/^!file\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (fileMatch) {
      out.push(
        buildExternalRefNode({ kind: 'file', href: fileMatch[2], title: fileMatch[1] || '' }),
      );
      i++;
      continue;
    }

    // ── !html[title](url) → htmlBlock（src 原样）──
    const htmlMatch = line.trim().match(/^!html\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if (htmlMatch) {
      out.push(buildHtmlBlockNode(htmlMatch[2], htmlMatch[1]));
      i++;
      continue;
    }

    // ── Obsidian ![[videoId]] → YouTube videoBlock ──
    const obsidian = tryParseObsidianVideoEmbed(line);
    if (obsidian) {
      out.push(obsidian);
      i++;
      continue;
    }

    // ── HTML 媒体标签 <iframe>/<video>/<audio> → video/audioBlock（src 原样）──
    const mediaTag = tryParseMediaTag(line.trim());
    if (mediaTag) {
      out.push(mediaTag);
      i++;
      continue;
    }

    // ── heading（# ~ ######）──
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      out.push(buildHeadingNode(headingMatch[1].length, headingMatch[2]));
      i++;
      continue;
    }

    // ── horizontalRule ──
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) {
      out.push(buildHorizontalRuleNode());
      i++;
      continue;
    }

    // ── blockquote（含 GFM alert `> [!NOTE]`）——内容递归调本入口（sync）──
    if (line.trimStart().startsWith('>')) {
      const quoteLines: string[] = [];
      // 放宽认空 `>` 行（B4a 修复：空引用行是段落分隔，不能截断）；到非 `>` 行止。
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quoteLines.push(stripBlockquotePrefix(lines[i]));
        i++;
      }
      const ghCalloutMatch = quoteLines[0]?.match(/^\[!(\w+)\]\s*$/);
      if (ghCalloutMatch) {
        const bodyText = quoteLines.slice(1).join('\n').trim();
        out.push(buildCalloutNode(calloutEmojiFor(ghCalloutMatch[1]), bodyText));
        continue;
      }
      // 递归解析引用内层（可含 code/math/heading/list…）——sync 自调本入口。
      out.push(buildBlockquoteNode(markdownCore(quoteLines.join('\n'), opts)));
      continue;
    }

    // ── lists（bullet / ordered / task）──
    const firstList = classifyListLine(line);
    if (firstList) {
      const items: PMNode[] = [];
      while (i < lines.length) {
        const info = classifyListLine(lines[i]);
        if (!info || info.kind !== firstList.kind) break; // 同类连续才归一个 list
        const para: PMNode = { type: 'paragraph', content: parseInline(info.text) };
        if (info.kind === 'task') {
          items.push(buildTaskItemNode(info.checked === true, taskCreatedAt, [para]));
        } else {
          items.push(buildListItemNode([para]));
        }
        i++;
      }
      if (firstList.kind === 'task') out.push(buildTaskListNode(items));
      else if (firstList.kind === 'ordered') out.push(buildOrderedListNode(items));
      else out.push(buildBulletListNode(items));
      continue;
    }

    // ── table（`| … |` 或裸管道 `a | b`，需连续 2 行像表格行）──
    if (looksLikeTableRow(line.trim()) && i + 1 < lines.length && looksLikeTableRow(lines[i + 1].trim())) {
      const startTable = i;
      const rows: string[][] = [];
      let hasHeader = false;
      while (i < lines.length && looksLikeTableRow(lines[i].trim())) {
        if (isTableSeparator(lines[i])) {
          hasHeader = true;
          i++;
          continue;
        }
        rows.push(splitTableCells(lines[i]));
        i++;
      }
      // ① 语义:有分隔行才判首行 header；无分隔行则无 header（buildTableNode 收零单元格行 warn）。
      const tableNode = buildTableNode(rows, hasHeader);
      if (tableNode) {
        out.push(tableNode);
      } else {
        out.push(uncoveredNode(lines.slice(startTable, i).join('\n')));
      }
      continue;
    }

    // ── paragraph（默认兜底，逐行）──
    out.push(buildParagraphNode(line));
    i++;
  }

  return out;
}

/**
 * image alt 拆 caption：`图 1-1 | 描述` → { caption:'图 1-1', alt:'描述' }（① buildImageBlock 语义）。
 * 无 `|` → 整串为 alt、caption 空。caption 落 image 节点 title（与 ① 一致）。
 */
function splitImageAlt(rawAlt: string): { alt: string; caption?: string } {
  const m = rawAlt.match(/^(.+?)\s*\|\s*(.+)$/);
  if (m) return { caption: m[1].trim(), alt: m[2].trim() };
  return { alt: rawAlt };
}

/**
 * 消费 `$$…$$` 数学块（多行；对齐 ②）。返回 { latex, nextIndex }，latex 已 trim（可能空）。
 */
function consumeMathBlock(
  lines: string[],
  startIdx: number,
): { latex: string; nextIndex: number } | null {
  const first = lines[startIdx].trim().slice(2);
  const closeIdx = first.indexOf('$$');
  if (closeIdx >= 0) {
    return { latex: first.slice(0, closeIdx).trim(), nextIndex: startIdx + 1 };
  }
  const buf: string[] = [];
  if (first) buf.push(first);
  let i = startIdx + 1;
  while (i < lines.length) {
    const curr = lines[i];
    const end = curr.indexOf('$$');
    if (end >= 0) {
      const head = curr.slice(0, end).trimEnd();
      if (head) buf.push(head);
      i++;
      break;
    }
    buf.push(curr);
    i++;
  }
  return { latex: buf.join('\n').trim(), nextIndex: i };
}
