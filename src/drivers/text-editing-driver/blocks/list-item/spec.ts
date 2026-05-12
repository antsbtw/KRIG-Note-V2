/**
 * listItem — bullet-list / ordered-list 内部的列表项
 *
 * id 用驼峰(`listItem`)— PM content 表达式不支持节点 name 含短横线。
 * content: 'block+' — 用 group 'block' 引用(允许 paragraph / heading / list 等任意 block 嵌套)。
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const listItemNodeSpec: NodeSpec = {
  content: 'block+',
  defining: true,
  parseDOM: [{ tag: 'li' }],
  toDOM() {
    return ['li', 0];
  },
};

export const listItemSpec: BlockSpec = {
  id: 'listItem',
  displayName: 'List Item',
  spec: listItemNodeSpec,
  containerRule: 'block+',
  cascadeBoundary: false,
};
