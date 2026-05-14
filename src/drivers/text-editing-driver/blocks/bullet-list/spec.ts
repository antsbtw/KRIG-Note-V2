/**
 * bulletList — 无序列表
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const bulletListNodeSpec: NodeSpec = {
  content: 'listItem+',
  group: 'block',
  attrs: {
    // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
    bookAnchor: { default: null },
  },
  parseDOM: [{ tag: 'ul' }],
  toDOM() {
    return ['ul', { class: 'krig-bullet-list' }, 0];
  },
};

export const bulletListSpec: BlockSpec = {
  id: 'bulletList',
  displayName: 'Bullet List',
  spec: bulletListNodeSpec,
  containerRule: 'block+',
  cascadeBoundary: false,
};
