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
  attrs: {
    // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
    // 字面注: hard-break 是 inline node, bookAnchor 字面预留 (用户 §2.4 第 8 项拍板"所有
    // 24 种 block 可选带 bookAnchor"包括 inline 字面); 实务字面 bookAnchor 永远 null
    bookAnchor: { default: null },
  },
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
