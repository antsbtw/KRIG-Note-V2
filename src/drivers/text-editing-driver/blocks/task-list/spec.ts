/**
 * taskList / taskItem — 任务列表
 *
 * id 驼峰(避免 PM content 表达式短横线非法)
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';
import { taskItemNodeView } from './node-view';

const taskListNodeSpec: NodeSpec = {
  content: 'taskItem+',
  group: 'block',
  parseDOM: [{ tag: 'ul[data-type="task-list"]' }],
  toDOM() {
    return ['ul', { 'data-type': 'task-list', class: 'krig-task-list' }, 0];
  },
};

const taskItemNodeSpec: NodeSpec = {
  content: 'block+',
  defining: true,
  attrs: { checked: { default: false } },
  parseDOM: [
    {
      tag: 'li[data-type="task-item"]',
      getAttrs(node) {
        const checked = (node as HTMLElement).getAttribute('data-checked') === 'true';
        return { checked };
      },
    },
  ],
  toDOM(node) {
    const checked = node.attrs.checked as boolean;
    return [
      'li',
      {
        'data-type': 'task-item',
        'data-checked': String(checked),
        class: `krig-task-item${checked ? ' checked' : ''}`,
      },
      0,
    ];
  },
};

export const taskListSpec: BlockSpec = {
  id: 'taskList',
  displayName: 'Task List',
  spec: taskListNodeSpec,
  containerRule: 'block+',
  cascadeBoundary: false,
};

export const taskItemSpec: BlockSpec = {
  id: 'taskItem',
  displayName: 'Task Item',
  spec: taskItemNodeSpec,
  containerRule: 'block+',
  cascadeBoundary: false,
  nodeView: taskItemNodeView,
};
