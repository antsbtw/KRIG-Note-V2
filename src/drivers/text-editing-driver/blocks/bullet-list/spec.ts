/**
 * bulletList — 无序列表
 *
 * content: 'list-item+' — 至少一个 listItem
 * 视觉:CSS ::before 渲染圆点(对齐 V1)
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const bulletListNodeSpec: NodeSpec = {
  content: 'list-item+',
  group: 'block',
  parseDOM: [{ tag: 'ul' }],
  toDOM() {
    return ['ul', { class: 'krig-bullet-list' }, 0];
  },
};

export const bulletListSpec: BlockSpec = {
  id: 'bullet-list',
  displayName: 'Bullet List',
  spec: bulletListNodeSpec,
  containerRule: 'block+',
  cascadeBoundary: false,
};
