/**
 * orderedList — 有序列表
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const orderedListNodeSpec: NodeSpec = {
  content: 'listItem+',
  group: 'block',
  attrs: { start: { default: 1 } },
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
    return start === 1
      ? ['ol', { class: 'krig-ordered-list' }, 0]
      : ['ol', { class: 'krig-ordered-list', start: String(start) }, 0];
  },
};

export const orderedListSpec: BlockSpec = {
  id: 'orderedList',
  displayName: 'Numbered List',
  spec: orderedListNodeSpec,
  containerRule: 'block+',
  cascadeBoundary: false,
};
