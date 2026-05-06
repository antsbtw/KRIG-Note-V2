/**
 * blockquote — 引用块(单字 id,无短横线)
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const blockquoteNodeSpec: NodeSpec = {
  content: 'block+',
  group: 'block',
  defining: true,
  parseDOM: [{ tag: 'blockquote' }],
  toDOM() {
    return ['blockquote', { class: 'krig-blockquote' }, 0];
  },
};

export const blockquoteSpec: BlockSpec = {
  id: 'blockquote',
  displayName: 'Quote',
  spec: blockquoteNodeSpec,
  containerRule: 'block+',
  cascadeBoundary: false,
};
