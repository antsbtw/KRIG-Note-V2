/**
 * horizontalRule — 水平分隔线(id 驼峰)
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const horizontalRuleNodeSpec: NodeSpec = {
  group: 'block',
  atom: true, // 叶子节点 — 光标不能陷进去(对齐 V1 / PM schema-basic 标准)
  selectable: true,
  attrs: {
    // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
    bookAnchor: { default: null },
  },
  parseDOM: [{ tag: 'hr' }],
  toDOM() {
    return ['hr', { class: 'krig-horizontal-rule' }];
  },
};

export const horizontalRuleSpec: BlockSpec = {
  id: 'horizontalRule',
  displayName: 'Divider',
  spec: horizontalRuleNodeSpec,
  containerRule: 'leaf',
  cascadeBoundary: false,
};
