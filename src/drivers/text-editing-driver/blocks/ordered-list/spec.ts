/**
 * orderedList — 有序列表
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const orderedListNodeSpec: NodeSpec = {
  content: 'listItem+',
  group: 'block',
  attrs: {
    start: { default: 1 },
    // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
    bookAnchor: { default: null },
  },
  parseDOM: [
    {
      tag: 'ol',
      getAttrs(node) {
        const start = (node as HTMLElement).getAttribute('start');
        return { start: start ? parseInt(start, 10) : 1 };
      },
    },
  ],
  toDOM(node) {
    const start = node.attrs.start as number;
    if (start === 1) {
      return ['ol', { class: 'krig-ordered-list' }, 0];
    }
    // counter-reset 注入 inline style:CSS counter 默认从 0 起,
    // 设为 start-1 让首项 counter-increment 后正好等于 start。
    // HTML start 属性同时保留(parseDOM 反解 + a11y)。
    return [
      'ol',
      {
        class: 'krig-ordered-list',
        start: String(start),
        style: `counter-reset: ordered-item ${start - 1}`,
      },
      0,
    ];
  },
};

export const orderedListSpec: BlockSpec = {
  id: 'orderedList',
  displayName: 'Numbered List',
  spec: orderedListNodeSpec,
  containerRule: 'block+',
  cascadeBoundary: false,
};
