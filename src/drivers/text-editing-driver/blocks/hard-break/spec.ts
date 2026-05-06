/**
 * hardBreak — 行内软换行(Shift-Enter 触发)
 *
 * 对齐 V1:inline node + selectable: false + `<br>` 渲染
 *
 * 注:这是 inline 节点(group: 'inline'),不是 block;containerRule 标 'leaf'
 * 因为它本质上是叶子节点(无 content),BlockSpec 接口未为 inline 单独留一档。
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const hardBreakNodeSpec: NodeSpec = {
  inline: true,
  group: 'inline',
  selectable: false,
  parseDOM: [{ tag: 'br' }],
  toDOM() {
    return ['br'];
  },
};

export const hardBreakSpec: BlockSpec = {
  id: 'hardBreak',
  displayName: 'Line Break',
  spec: hardBreakNodeSpec,
  containerRule: 'leaf',
  cascadeBoundary: false,
};
