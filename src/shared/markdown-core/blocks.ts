/**
 * B1 block 的 canonical 构造器 —— heading / paragraph / horizontalRule /
 * codeBlock / mathBlock。每个函数纯 sync、无副作用，产出 canonical PMNode。
 *
 * 这些是 ①② 都要调的「唯一真源」构造器：给定已定位好的原始 markdown 片段，
 * 产出与 ② markdownToProseMirror 一致的规范节点形态（B1 拍板：① 也吃规范形）。
 */

import type { PMNode } from './types';
import { parseInline } from './inline';
import { tryParseFencedCode } from './fence';

/** heading：level 取 markdown `#` 数（1-6，CommonMark），content 走 canonical inline */
export function buildHeadingNode(level: number, headingText: string): PMNode {
  return {
    type: 'heading',
    attrs: { level },
    content: parseInline(headingText),
  };
}

/** paragraph：content 走 canonical inline */
export function buildParagraphNode(text: string): PMNode {
  return {
    type: 'paragraph',
    content: parseInline(text),
  };
}

/** horizontalRule */
export function buildHorizontalRuleNode(): PMNode {
  return { type: 'horizontalRule' };
}

/**
 * codeBlock（canonical，对齐 ②）：
 * - attrs：有 language 时 `{ language }`，无则 attrs 省略（undefined）。
 * - content：非空时 `[{ type:'text', text }]`，空时省略（PM codeBlock content 是 text*，
 *   空内容不放 content 避免装载报错）。
 */
export function buildCodeBlockNode(language: string, textContent: string): PMNode {
  return {
    type: 'codeBlock',
    attrs: language ? { language } : undefined,
    content: textContent ? [{ type: 'text', text: textContent }] : undefined,
  };
}

/**
 * mathBlock（canonical，对齐 ②）：latex 作为唯一 text 子节点。
 * 空 latex 由 caller 决定是否降级（② 空时产 unknown 占位，非 B1 核职责）。
 */
export function buildMathBlockNode(latex: string): PMNode {
  return {
    type: 'mathBlock',
    content: [{ type: 'text', text: latex }],
  };
}

/**
 * 尝试把 `lines[i]` 当代码块开栏解析（fence 长度配对）。
 * 命中返回 { node, nextIndex }，否则 null。
 */
export function tryParseCodeBlock(
  lines: string[],
  i: number,
): { node: PMNode; nextIndex: number } | null {
  const fenced = tryParseFencedCode(lines, i);
  if (!fenced) return null;
  return {
    node: buildCodeBlockNode(fenced.language, fenced.textContent),
    nextIndex: fenced.nextIndex,
  };
}
