/**
 * bulletList — 无序列表
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const bulletListNodeSpec: NodeSpec = {
  content: 'listItem+',
  group: 'block',
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
