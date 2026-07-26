/**
 * 行内解析（canonical）—— B1 基础 inline mark 的唯一真源。
 *
 * 采用 ② markdownToProseMirror.parseInline 的**递归嵌套**实现（设计文档差异矩阵
 * 判定 ② 的 inline 是超集：支持 mark 递归嵌套 + 删除线 strike，① 是 flat 正则）。
 *
 * 支持：bold(**) / italic(*) / strike(~~) / code(`) / link([](())) / inline math($$…$)。
 * mark 可任意层嵌套（如 `[**X**](url)` / `**[X](url)**`），算法：匹配到一个 mark
 * 分隔符后**递归**解析其内部文本，再把当前 mark 叠加到每个子 node 上。
 * code（字面）与 mathInline（inline node，非 mark）为叶子，不再递归。
 *
 * 纯 sync、无副作用。
 */

import type { PMNode, PMMark } from './types';

/**
 * 给一组 inline node 叠加一个外层 mark（递归 mark 嵌套用）。
 *
 * - text 节点：把 mark 加进 marks（同 type 已存在则不重复；link 以外层为准不覆盖内层）。
 * - 非 text（如 mathInline）：mark 不适用，原样返回。
 */
export function applyMark(nodes: PMNode[], mark: PMMark): PMNode[] {
  return nodes.map((n) => {
    if (n.type !== 'text') return n;
    const existing = n.marks ?? [];
    if (existing.some((m) => m.type === mark.type)) return n; // 同类型不重复叠
    return { ...n, marks: [...existing, mark] };
  });
}

/**
 * 解析 inline：bold / italic / strike / code / link / inline math。
 *
 * V2 已实现 marks：bold / italic / code / link / underline / strike / highlight
 * mathInline → inline node `{ type: 'mathInline', attrs: { latex } }`
 */
export function parseInline(text: string): PMNode[] {
  if (!text || !text.trim()) return [];

  const nodes: PMNode[] = [];
  const regex =
    /(\*\*([\s\S]+?)\*\*|~~([\s\S]+?)~~|\*([^\*\n]+?)\*|`([^`\n]+?)`|\[([^\]]+)\]\(([^)]+)\)|\$([^\s$][^$\n]*?[^\s$]|[^\s$])\$)/g;

  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }

    if (match[2] !== undefined) {
      // **bold** — 递归解析内部（可含 link / italic / …），叠 bold
      nodes.push(...applyMark(parseInline(match[2]), { type: 'bold' }));
    } else if (match[3] !== undefined) {
      // ~~strike~~
      nodes.push(...applyMark(parseInline(match[3]), { type: 'strike' }));
    } else if (match[4] !== undefined) {
      // *italic*
      nodes.push(...applyMark(parseInline(match[4]), { type: 'italic' }));
    } else if (match[5] !== undefined) {
      // `code` — 内容字面，叶子（不递归）
      nodes.push({ type: 'text', text: match[5], marks: [{ type: 'code' }] });
    } else if (match[6] && match[7]) {
      // [text](url) — 递归解析链接文字（可含 **bold** / *italic*），叠 link
      nodes.push(
        ...applyMark(parseInline(match[6]), {
          type: 'link',
          attrs: { href: match[7] },
        }),
      );
    } else if (match[8] !== undefined) {
      // mathInline → 目标节点名（inline node）
      nodes.push({ type: 'mathInline', attrs: { latex: match[8] } });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push({ type: 'text', text: text.slice(lastIndex) });
  }

  return nodes.length > 0 ? nodes : [{ type: 'text', text }];
}
