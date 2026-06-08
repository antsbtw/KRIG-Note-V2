/**
 * toggleList — 折叠列表(ContainerBlock 同款,首行 = 折叠标题,子内容可折叠/展开)
 *
 * 对齐 V1:content: 'block+',attrs.open 默认 true,折叠箭头切换
 *
 * id 驼峰避免短横线问题。
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';
import { toggleListNodeView } from './node-view';

const toggleListNodeSpec: NodeSpec = {
  content: 'block+',
  group: 'block',
  defining: true,
  attrs: {
    // L7 block atomization (decision 026 §3.1.1 / §4): block atom 稳定 ULID,与 atom.id 同步
    id: { default: null },
    open: { default: true },
    // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
    bookAnchor: { default: null },
  },
  parseDOM: [
    {
      tag: 'div.krig-toggle-list',
      getAttrs(node) {
        const el = node as HTMLElement;
        return { open: el.getAttribute('data-open') !== 'false' };
      },
    },
  ],
  toDOM(node) {
    const open = node.attrs.open !== false;
    return [
      'div',
      {
        class: open ? 'krig-toggle-list' : 'krig-toggle-list closed',
        'data-open': String(open),
      },
      0,
    ];
  },
};

export const toggleListSpec: BlockSpec = {
  id: 'toggleList',
  displayName: 'Toggle List',
  spec: toggleListNodeSpec,
  containerRule: 'block+',
  cascadeBoundary: false,
  nodeView: toggleListNodeView,
};
