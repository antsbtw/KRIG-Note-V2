/**
 * horizontalRule — 水平分隔线(id 驼峰)
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
  id: 'horizontalRule',
  displayName: 'Divider',
  spec: horizontalRuleNodeSpec,
  containerRule: 'leaf',
  cascadeBoundary: false,
};
