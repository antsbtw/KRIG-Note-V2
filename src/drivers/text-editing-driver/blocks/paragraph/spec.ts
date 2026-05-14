/**
 * paragraph — 普通段落 + 文档标题 (isTitle)
 *
 * 见 BLOCK-SPEC.md v0.1.1 § 4.1 + Decision 005 (D1)。
 *
 * 决议 D1: noteTitle 是 paragraph 特殊形态 (isTitle=true),不是 heading level=1,
 *         不是独立节点。V2 设计哲学: noteTitle ≠ heading
 *         (noteTitle 是"加大字号的段落",不是章节标题)。
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const paragraphNodeSpec: NodeSpec = {
  content: 'inline*',
  group: 'block',
  attrs: {
    /**
     * 文档标题标识。
     * - true: 该 paragraph 是文档标题(doc 首块)
     *   - 由 title-guard plugin 维护(doc 必须以 isTitle=true paragraph 开头)
     *   - 渲染加大字号(对齐 V1 ~32px),用 <p data-is-title="true">,不用 h1
     *   - 不允许换行(粘贴时取第一行;Enter 跳到下一段)
     * - false: 普通段落(默认)
     */
    isTitle: { default: false },
    // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
    bookAnchor: { default: null },
  },
  defining: true,
  parseDOM: [
    {
      tag: 'p',
      getAttrs(dom) {
        const el = dom as HTMLElement;
        return {
          isTitle: el.getAttribute('data-is-title') === 'true',
        };
      },
    },
  ],
  toDOM(node) {
    const isTitle = node.attrs.isTitle as boolean;
    if (isTitle) return ['p', { 'data-is-title': 'true', class: 'krig-note-title' }, 0];
    return ['p', 0];
  },
};

export const paragraphSpec: BlockSpec = {
  id: 'paragraph',
  displayName: 'Paragraph',
  spec: paragraphNodeSpec,
  containerRule: 'inline-only',
  cascadeBoundary: false,
};
