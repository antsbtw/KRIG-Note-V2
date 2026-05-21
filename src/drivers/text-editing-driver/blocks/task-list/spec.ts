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
  attrs: {
    // L7 block atomization (decision 026 §3.1.1 / §4): block atom 稳定 ULID,与 atom.id 同步
    id: { default: null },
    checked: { default: false },
    // V1 兼容:创建/完成/截止时间(ISO 字符串 | null)
    createdAt: { default: null },
    completedAt: { default: null },
    deadline: { default: null },
    // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
    // task-list 目录 2 NodeSpec 字面仅 taskItem receiver bookAnchor (字面标注落到 item,
    // 不在容器 taskList 上); 字面登记 §10.D 偏离同 table 模式
    bookAnchor: { default: null },
  },
  parseDOM: [
    {
      tag: 'li[data-type="task-item"]',
      getAttrs(node) {
        const el = node as HTMLElement;
        return {
          checked: el.getAttribute('data-checked') === 'true',
          createdAt: el.getAttribute('data-created-at') || null,
          completedAt: el.getAttribute('data-completed-at') || null,
          deadline: el.getAttribute('data-deadline') || null,
        };
      },
    },
  ],
  toDOM(node) {
    const checked = node.attrs.checked as boolean;
    const overdue =
      !checked && node.attrs.deadline && new Date(node.attrs.deadline as string) < new Date();
    const cls = ['krig-task-item'];
    if (checked) cls.push('checked');
    if (overdue) cls.push('overdue');
    const attrs: Record<string, string> = {
      'data-type': 'task-item',
      'data-checked': String(checked),
      class: cls.join(' '),
    };
    if (node.attrs.createdAt) attrs['data-created-at'] = node.attrs.createdAt as string;
    if (node.attrs.completedAt) attrs['data-completed-at'] = node.attrs.completedAt as string;
    if (node.attrs.deadline) attrs['data-deadline'] = node.attrs.deadline as string;
    return ['li', attrs, 0];
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
