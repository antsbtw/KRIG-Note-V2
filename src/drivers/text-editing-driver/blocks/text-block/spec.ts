/**
 * textBlock — L5-A 唯一 block(段落 + 三级标题)
 *
 * 见 BLOCK-SPEC.md v0.1.1 § 4.1。
 *
 * L5-A 不实施 V1 字段(isTitle / textIndent / align / open) — 留 L5-B+。
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const textBlockNodeSpec: NodeSpec = {
  content: 'inline*',
  group: 'block',
  attrs: {
    /** null=paragraph, 1/2/3=heading 级别 */
    level: { default: null },
  },
  defining: true,
  parseDOM: [
    { tag: 'p' },
    { tag: 'h1', attrs: { level: 1 } },
    { tag: 'h2', attrs: { level: 2 } },
    { tag: 'h3', attrs: { level: 3 } },
  ],
  toDOM(node) {
    const level = node.attrs.level as number | null;
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
