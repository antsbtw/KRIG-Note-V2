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
    // L7 block atomization (decision 026 §3.1.1 / §4): block atom 稳定 ULID,与 atom.id 同步
    id: { default: null },
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
    // 排版(对齐 V1 textBlock — heading 同 paragraph 都有 align/textIndent)
    align: { default: 'left' },          // 'left' | 'center' | 'right'
    textIndent: { default: false },      // 首行缩进 2em
  },
  defining: true,
  parseDOM: ([1, 2, 3, 4, 5, 6] as const).map((lv) => ({
    tag: `h${lv}`,
    getAttrs(dom: HTMLElement | string) {
      const el = dom as HTMLElement;
      const align = el.style.textAlign as 'left' | 'center' | 'right' | '';
      const textIndent = el.style.textIndent === '2em';
      return { level: lv, align: align || 'left', textIndent };
    },
  })),
  toDOM(node) {
    const { level, align, textIndent } = node.attrs;
    const styles: string[] = [];
    if (align && align !== 'left') styles.push(`text-align: ${align}`);
    if (textIndent) styles.push('text-indent: 2em');
    const attrs: Record<string, string> = {};
    if (styles.length > 0) attrs.style = styles.join('; ');
    return [`h${level}`, attrs, 0];
  },
};

export const headingSpec: BlockSpec = {
  id: 'heading',
  displayName: 'Heading',
  spec: headingNodeSpec,
  containerRule: 'inline-only',
  cascadeBoundary: false,
};
