/**
 * textBlock — 段落 + 三级标题 + 文档标题
 *
 * 见 BLOCK-SPEC.md v0.1.1 § 4.1。
 *
 * attrs:
 *   level    null=paragraph, 1/2/3=heading 级别
 *   isTitle  L5-B3.11:true=文档标题(doc 第一块)— 走 title-guard 保护:
 *            - doc 必须以 isTitle 开头(若被删 / 改类型 → appendTransaction 自动补回)
 *            - 不允许换行(粘贴时取第一行;Enter 跳到下一段)
 *            - CSS 渲染大字号(对齐 V1 ~32px)
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const textBlockNodeSpec: NodeSpec = {
  content: 'inline*',
  group: 'block',
  attrs: {
    /** null=paragraph, 1/2/3=heading 级别 */
    level: { default: null },
    /** L5-B3.11:true 表示这是文档标题(doc 首块);由 title-guard plugin 维护 */
    isTitle: { default: false },
  },
  defining: true,
  parseDOM: [
    {
      tag: 'p',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          level: null,
          isTitle: el.getAttribute('data-is-title') === 'true',
        };
      },
    },
    { tag: 'h1', attrs: { level: 1, isTitle: false } },
    { tag: 'h2', attrs: { level: 2, isTitle: false } },
    { tag: 'h3', attrs: { level: 3, isTitle: false } },
  ],
  toDOM(node) {
    const level = node.attrs.level as number | null;
    const isTitle = node.attrs.isTitle as boolean;
    // isTitle 用 <p data-is-title="true">,CSS 选择器加大字号
    // (用普通 p 而非 h1 — 区别于 markdown 的 # 标题)
    if (isTitle) return ['p', { 'data-is-title': 'true', class: 'krig-note-title' }, 0];
    if (level === 1) return ['h1', 0];
    if (level === 2) return ['h2', 0];
    if (level === 3) return ['h3', 0];
    return ['p', 0];
  },
};

export const textBlockSpec: BlockSpec = {
  id: 'text-block',
  displayName: 'Paragraph',
  spec: textBlockNodeSpec,
  containerRule: 'inline-only',
  cascadeBoundary: false,
};
