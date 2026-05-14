/**
 * mathBlock — 块级数学公式 LaTeX block(L5-B3.6)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/math-block.ts
 *
 * 两态:
 * - rendered:KaTeX 渲染 displayMode(默认显示)
 * - edit:LaTeX 源码 + 实时预览(双击 / 单击空块进入)
 *
 * NodeSpec:content='text*' + code:true,文本节点装 LaTeX 源码;NodeView 渲染
 *
 * attrs:
 *   color    rendered KaTeX 文本色(覆盖 default)
 *   bgColor  整块背景色
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';
import { mathBlockNodeView } from './node-view';

const mathBlockNodeSpec: NodeSpec = {
  content: 'text*',
  group: 'block',
  code: true,
  defining: true,
  // 不含 inline marks(纯 LaTeX 源码,bold/italic 等没意义)
  marks: '',
  attrs: {
    color: { default: null },
    bgColor: { default: null },
    // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
    bookAnchor: { default: null },
  },
  parseDOM: [
    {
      tag: 'div.krig-math-block',
      preserveWhitespace: 'full',
      getAttrs(node) {
        const el = node as HTMLElement;
        return {
          color: el.getAttribute('data-color') || null,
          bgColor: el.getAttribute('data-bg-color') || null,
        };
      },
    },
  ],
  toDOM(node) {
    const attrs: Record<string, string> = { class: 'krig-math-block' };
    if (node.attrs.color) attrs['data-color'] = node.attrs.color as string;
    if (node.attrs.bgColor) attrs['data-bg-color'] = node.attrs.bgColor as string;
    return ['div', attrs, ['pre', { class: 'krig-math-block__code' }, 0]];
  },
};

export const mathBlockSpec: BlockSpec = {
  id: 'mathBlock',
  displayName: 'Math Block',
  spec: mathBlockNodeSpec,
  nodeView: mathBlockNodeView,
  containerRule: 'inline-only',
  cascadeBoundary: false,
};
