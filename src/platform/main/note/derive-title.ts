/**
 * 从裸 PmPayload (PM doc root) 派生 title (decision 012 §3.2 + 路径 Y)
 *
 * 自包含 10 行,不复用 driver 层 extractFirstParagraphText
 * (按设计师批复:capability 内部已 unwrap 信封,处理的是裸 PmPayload)。
 *
 * 规则:取 doc.content[0] (通常是 isTitle paragraph) 的首段 text 节点 .text。
 */

import type { PmPayload } from '@semantic/types';

export function deriveTitle(pmDoc: PmPayload): string {
  const firstBlock = pmDoc?.content?.[0];
  if (!firstBlock) return '未命名';
  const text = extractInlineText(firstBlock).trim();
  return text || '未命名';
}

function extractInlineText(node: PmPayload): string {
  if (node.type === 'text') return node.text ?? '';
  if (!node.content) return '';
  return node.content.map(extractInlineText).join('');
}
