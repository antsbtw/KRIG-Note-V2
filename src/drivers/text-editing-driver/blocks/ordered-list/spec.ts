/**
 * orderedList — 有序列表
 *
 * content: 'list-item+'
 * attrs: { start: 1 } — 起始序号
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const orderedListNodeSpec: NodeSpec = {
  content: 'list-item+',
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
  id: 'ordered-list',
  displayName: 'Numbered List',
  spec: orderedListNodeSpec,
  containerRule: 'block+',
  cascadeBoundary: false,
};
