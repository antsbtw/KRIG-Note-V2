/**
 * mathInline — 行内数学公式 atom(L5-B3.6)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/math-inline.ts
 *
 * 行为:
 * - inline + atom(光标不进入,作为整体单元处理)
 * - latex 存 attrs.latex(单字符串,不含分隔符 $)
 * - render:KaTeX inline 渲染
 * - 双击 / 单击空 → 弹出绝对定位编辑弹窗(input + live preview)
 * - leafText:'$<latex>$' — textBetween / 复制成纯文本时还原源码
 *
 * 砍 V1:thoughtMark 集成(V2 暂无 thought mark 系统)
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';
import { mathInlineNodeView } from './node-view';

const mathInlineNodeSpec: NodeSpec = {
  inline: true,
  group: 'inline',
  atom: true,
  attrs: {
    latex: { default: '' },
  },
  parseDOM: [
    {
      tag: 'span.krig-math-inline',
      getAttrs(node) {
        const el = node as HTMLElement;
        return {
          latex: el.getAttribute('data-latex') || '',
        };
      },
    },
  ],
  toDOM(node) {
    return [
      'span',
      {
        class: 'krig-math-inline',
        'data-latex': (node.attrs.latex as string) || '',
      },
    ];
  },
  // atom 节点无文本子,textBetween / 复制成纯文本时跳过 — leafText 暴露源码
  leafText: (node) => `$${node.attrs.latex as string}$`,
};

export const mathInlineSpec: BlockSpec = {
  id: 'mathInline',
  displayName: 'Inline Math',
  spec: mathInlineNodeSpec,
  nodeView: mathInlineNodeView,
  containerRule: 'leaf',
  cascadeBoundary: false,
};
