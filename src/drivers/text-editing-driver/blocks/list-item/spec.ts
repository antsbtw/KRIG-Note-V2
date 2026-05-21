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
  attrs: {
    // L7 block atomization (decision 026 §3.1.1 / §4): block atom 稳定 ULID,与 atom.id 同步
    id: { default: null },
    // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
    bookAnchor: { default: null },
  },
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
