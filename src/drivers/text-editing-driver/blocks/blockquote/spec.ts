/**
 * blockquote — 引用块(单字 id,无短横线)
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const blockquoteNodeSpec: NodeSpec = {
  content: 'block+',
  group: 'block',
  defining: true,
  attrs: {
    // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
    // EPUB highlight 标注转换字面 receiver (decision 022 §7.3): type='highlight' →
    // blockquote + bookAnchor + content=[paragraph(textContent)]
    bookAnchor: { default: null },
  },
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
