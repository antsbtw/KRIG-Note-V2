import type { Atom } from './types';

/**
 * 从 Atom 数组中提取纯文本（递归收集所有 text 字段）。
 *
 * 用途：
 *   - SVG 几何渲染失败时的 fallback（显示纯文本占位）
 *   - 搜索索引
 *   - hover tooltip 摘要
 */
export function extractPlainText(atoms: Atom[] | undefined | null): string {
  if (!atoms || !Array.isArray(atoms)) return '';
  const out: string[] = [];
  function walk(node: unknown): void {
    if (!node) return;
    if (typeof node === 'string') { out.push(node); return; }
    if (typeof node !== 'object') return;
    const obj = node as { text?: unknown; content?: unknown };
    if (typeof obj.text === 'string') out.push(obj.text);
    if (Array.isArray(obj.content)) obj.content.forEach(walk);
  }
  atoms.forEach(walk);
  return out.join('');
}

/** 把任意输入归一化为合法 atom 数组。string → textBlock atom；其他原样。 */
export function ensureAtomLabel(value: unknown): Atom[] {
  if (Array.isArray(value)) return value as Atom[];
  if (typeof value === 'string') return makeTextLabel(value);
  return [];
}

/** 用纯文字构造一个 textBlock atom。
 *
 * 结构对应 SVG 序列化器期待的格式：
 *   textBlock 直接含 inline children（text / 等）
 *   见 svg/blocks/textBlock.ts renderTextBlock 实现
 */
export function makeTextLabel(text: string): Atom[] {
  return [{
    type: 'textBlock',
    content: [{ type: 'text', text }],
  }];
}
