/**
 * horizontalRule — 水平分隔线
 *
 * 自闭合 leaf 节点,无 content
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';

const horizontalRuleNodeSpec: NodeSpec = {
  group: 'block',
  parseDOM: [{ tag: 'hr' }],
  toDOM() {
    return ['hr', { class: 'krig-horizontal-rule' }];
  },
};

export const horizontalRuleSpec: BlockSpec = {
  id: 'horizontal-rule',
  displayName: 'Divider',
  spec: horizontalRuleNodeSpec,
  containerRule: 'leaf',
  cascadeBoundary: false,
};
