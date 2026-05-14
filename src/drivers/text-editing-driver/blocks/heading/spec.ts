/**
 * heading — 章节标题 (level 1-6, CommonMark 标准)
 *
 * 见 BLOCK-SPEC.md v0.1.1 § 4.1 + Decision 005 (D2)。
 *
 * 决议 D2: heading.level 范围扩到 1-6 (CommonMark 标准),不只 V1 当前的 1-3。
 *          UI 渲染层即便暂时只样式化 1-3,schema 支持 1-6 留出扩展余地。
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const headingNodeSpec: NodeSpec = {
  content: 'inline*',
  group: 'block',
  attrs: {
    /**
     * 标题级别 1-6 (CommonMark 标准)
     * 默认: 1
     *
     * UI 渲染: capability.text-editing 当前可选择只样式化 1-3,
     *         schema 不限制(留扩展余地)
     */
    level: { default: 1 },
    // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
    bookAnchor: { default: null },
  },
  defining: true,
  parseDOM: [
    { tag: 'h1', attrs: { level: 1 } },
    { tag: 'h2', attrs: { level: 2 } },
    { tag: 'h3', attrs: { level: 3 } },
    { tag: 'h4', attrs: { level: 4 } },
    { tag: 'h5', attrs: { level: 5 } },
    { tag: 'h6', attrs: { level: 6 } },
  ],
  toDOM(node) {
    const level = node.attrs.level as number;
    return [`h${level}`, 0];
  },
};

export const headingSpec: BlockSpec = {
  id: 'heading',
  displayName: 'Heading',
  spec: headingNodeSpec,
  containerRule: 'inline-only',
  cascadeBoundary: false,
};
