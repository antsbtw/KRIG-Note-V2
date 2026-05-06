/**
 * listItem — bullet-list / ordered-list 内部的列表项
 *
 * content: 'text-block block*' — 一个 listItem 必须以 text-block 起头(可见文字行),
 * 后续可装嵌套 list / blockquote 等 block。
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const listItemNodeSpec: NodeSpec = {
  content: 'text-block block*',
  defining: true,
  parseDOM: [{ tag: 'li' }],
  toDOM() {
    return ['li', 0];
  },
};

export const listItemSpec: BlockSpec = {
  id: 'list-item',
  displayName: 'List Item',
  spec: listItemNodeSpec,
  containerRule: 'block+',
  cascadeBoundary: false,
};
