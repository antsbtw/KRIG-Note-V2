/**
 * markdown-core —— 唯一 markdown → PMNode[] 解析核（B1 地基）。
 *
 * **铁律**（对接 [[import-to-note-convergence]] 6.0）：
 *  - 纯 sync、无副作用、无媒体 I/O（base64→media:// 本地化留各自外壳做后处理）。
 *  - B1 只规范解析已一致的 block：heading / paragraph / horizontalRule /
 *    codeBlock（fence 长度配对）/ mathBlock / mathInline + 基础 inline mark。
 *  - 未覆盖的 block（list/table/callout/image/blockquote/media…）**绝不静默吞**：
 *    产 `UNCOVERED_TYPE` 哨兵节点，把原始源行带出交 caller 处理（B2–B4 逐类收编）。
 *
 * 现阶段消费方：
 *  - ② markdownToProseMirror：B1 block 改调本核，非 B1 块用 uncovered.rawLines 走旧逻辑，
 *    媒体本地化仍在 ② 外壳做 async 后处理。
 *  - ① blocks-to-pm-doc：B1 block 的 PMNode 构造改调本核的 canonical 构造器。
 */

import type { PMNode } from './types';
import {
  buildHeadingNode,
  buildParagraphNode,
  buildHorizontalRuleNode,
  buildMathBlockNode,
  tryParseCodeBlock,
} from './blocks';
import { uncoveredNode } from './types';

export type { PMNode, PMMark, UncoveredNode } from './types';
export { UNCOVERED_TYPE, isUncovered, uncoveredNode } from './types';
export { parseInline, applyMark } from './inline';
export { tryParseFencedCode } from './fence';
export type { FencedCode } from './fence';
export {
  buildHeadingNode,
  buildParagraphNode,
  buildHorizontalRuleNode,
  buildCodeBlockNode,
  buildMathBlockNode,
  tryParseCodeBlock,
} from './blocks';
// 阶段 B2：table + callout canonical 构造器（①② 都调）。
export {
  CALLOUT_EMOJI_MAP,
  calloutEmojiFor,
  buildCalloutNode,
  buildTableNode,
  splitCellOnBr,
} from './table-callout';
// 阶段 B3：媒体类 block canonical 构造器 + 纯解析（src 原样，async 本地化留外壳）。
export {
  parseImageSrc,
  buildImageNode,
  buildVideoNode,
  buildAudioNode,
  buildHtmlBlockNode,
  buildFileBlockNode,
  buildExternalRefNode,
  tryParseMediaTag,
  tryParseObsidianVideoEmbed,
} from './media-blocks';
export type { ParsedImageSrc } from './media-blocks';

/**
 * markdown → canonical PMNode[]（B1 覆盖范围内规范解析，其余产 uncovered 哨兵）。
 */
export function markdownCore(md: string): PMNode[] {
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

    // ── mathBlock（$$…$$，可跨行）——对齐 ② 的行为 ──
    if (line.trim().startsWith('$$')) {
      const consumed = consumeMathBlock(lines, i);
      if (consumed) {
        // latex 非空产 mathBlock；空则降级 uncovered（不静默吞，caller 决定）
        out.push(
          consumed.latex
            ? buildMathBlockNode(consumed.latex)
            : uncoveredNode(lines.slice(i, consumed.nextIndex).join('\n')),
        );
        i = consumed.nextIndex;
        continue;
      }
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

    // ── 非 B1 block（blockquote / list / table / image / callout / media 等）──
    // 绝不静默吞：这些块 B1 不解析，产 uncovered 哨兵把连续源行整块带出交 caller
    // （caller 用 rawLines 走各自旧逻辑）。聚合到下一个空行 / B1 块起始 / 另一种块类型止。
    if (isNonB1BlockStart(line)) {
      const startUncovered = i;
      i++;
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !isB1BlockStart(lines[i]) &&
        isNonB1BlockStart(lines[i])
      ) {
        i++;
      }
      out.push(uncoveredNode(lines.slice(startUncovered, i).join('\n')));
      continue;
    }

    // ── paragraph（B1 默认兜底，逐行，对齐 ② markdownToProseMirror）──
    out.push(buildParagraphNode(line));
    i++;
  }

  return out;
}

/**
 * 判断某行是否为 B1 可识别块的起始（heading/hr/code/math）。
 * 与主循环识别顺序保持一致。
 */
function isB1BlockStart(line: string): boolean {
  if (line.trimStart().match(/^`{3,}/)) return true; // codeBlock 开栏
  if (line.trim().startsWith('$$')) return true; // mathBlock
  if (line.match(/^(#{1,6})\s+(.+)/)) return true; // heading
  if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line.trim())) return true; // hr
  return false;
}

/**
 * 判断某行是否为**非 B1 block** 的起始（B1 不解析、需产 uncovered 交 caller）。
 *
 * 覆盖 ①② 现有的非 B1 block 起始标记：blockquote / 无序/有序/任务列表 / table /
 * image / !attach / !file / !html / <<IMAGE / <center> / <iframe|video|audio> 等。
 * 判定为「非 paragraph 且非 B1」→ uncovered；其余非空行落 paragraph。
 *
 * 只判**起始行特征**（保守）：不是则视作普通 paragraph 文本。
 */
function isNonB1BlockStart(line: string): boolean {
  const t = line.trim();
  if (t === '') return false;
  // blockquote / GFM alert
  if (line.trimStart().startsWith('> ')) return true;
  // 任务列表 / 无序列表（含 `-` `*` `+`）
  if (/^\s*[-*+]\s+/.test(line)) return true;
  // 有序列表
  if (/^\s*\d+\.\s+/.test(line)) return true;
  // table
  if (t.startsWith('|')) return true;
  // image（![...]）/ 链接图片（[![...]]）/ attach / file / html / obsidian embed
  // 注意：裸链接行 [text](url) 不是 image，属 paragraph —— 故只认 `![` 与 `[![`。
  if (t.startsWith('![') || t.startsWith('[![') || t.startsWith('![[') ||
      t.startsWith('!attach[') || t.startsWith('!file[') || t.startsWith('!html[')) {
    return true;
  }
  // ① 专属占位/媒体标记
  if (t.startsWith('<<IMAGE:')) return true;
  if (/^<(iframe|video|audio|center|blockquote)\b/i.test(t)) return true;
  return false;
}

/**
 * 消费 `$$…$$` 数学块（对齐 ② markdownToProseMirror 的多行逻辑）。
 * 返回 { latex, nextIndex }；latex 已 trim（可能空串）。
 */
function consumeMathBlock(
  lines: string[],
  startIdx: number,
): { latex: string; nextIndex: number } | null {
  const first = lines[startIdx].trim().slice(2);
  const closeIdx = first.indexOf('$$');

  // 单行 $$…$$
  if (closeIdx >= 0) {
    return { latex: first.slice(0, closeIdx).trim(), nextIndex: startIdx + 1 };
  }

  // 多行：收集到含 $$ 的行
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
