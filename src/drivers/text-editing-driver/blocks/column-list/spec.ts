/**
 * columnList + column — 多列布局(Notion 风格)
 *
 * 直迁 V1 src/plugins/note/blocks/column-list.ts。
 *
 * schema:
 *   columnList   content='column{2,3}'   group='block'  isolating  attrs.columns 与 childCount 同步
 *     └── column   content='block+'                       isolating  attrs.verticalAlign + width
 *           └── paragraph / heading / ... (任意 block)
 *
 * 关键决定:
 * - column{2,3} 强约束:slash 入口默认 2 列,toolbar +/− 在 2-3 间切换
 * - column.attrs.width 默认 null = 等宽(flex:1);非 null 是用户拖过的比例
 * - 互斥嵌套防护在 view 业务层(slash-menu-content / driver/api 入口)
 * - 命名驼峰 columnList / column(避 PM content 表达式短横线 SyntaxError,
 *   见 feedback_pm_schema_naming)
 */

import type { NodeSpec } from 'prosemirror-model';
import type { BlockSpec } from '../../types';
import { columnListNodeView, columnNodeView } from './node-view';
import { columnListKeymapPlugin } from './keymap';
import { columnCollapsePlugin } from './column-collapse-plugin';

const columnListNodeSpec: NodeSpec = {
  content: 'column{2,3}',
  group: 'block',
  isolating: true,
  attrs: {
    columns: { default: 2 },
  },
  parseDOM: [{ tag: 'div.krig-column-list' }],
  toDOM() {
    return ['div', { class: 'krig-column-list' }, 0];
  },
};

const columnNodeSpec: NodeSpec = {
  content: 'block+',
  isolating: true,
  attrs: {
    verticalAlign: { default: 'top' },
    width: { default: null },
  },
  parseDOM: [{ tag: 'div.krig-column' }],
  toDOM() {
    return ['div', { class: 'krig-column' }, 0];
  },
};

export const columnListSpec: BlockSpec = {
  id: 'columnList',
  displayName: '2 Columns',
  spec: columnListNodeSpec,
  nodeView: columnListNodeView,
  // column 容器自带 plugin:
  // - columnListKeymapPlugin: Enter/Backspace 特化(复用 PM helper,不重写通用行为)
  // - columnCollapsePlugin:   appendTransaction 后处理 column 变空场景
  plugin: () => [columnListKeymapPlugin(), columnCollapsePlugin()],
  containerRule: 'block+',
  cascadeBoundary: true,
};

export const columnSpec: BlockSpec = {
  id: 'column',
  displayName: 'Column',
  spec: columnNodeSpec,
  nodeView: columnNodeView,
  containerRule: 'block+',
  cascadeBoundary: true,
};
