/**
 * EditorView 装配
 *
 * 见 DESIGN.md v0.2.1 § 4 + L5B2 设计 § 3.3。
 *
 * L5-A:最小集 — keymap(baseKeymap) only。
 * L5-B2:加 history / input-rules / mark-keymap / heading-keymap。
 */

import { EditorState, type Plugin, type Transaction } from 'prosemirror-state';
import { EditorView, type NodeViewConstructor } from 'prosemirror-view';
import type { Schema, Node as PMNode } from 'prosemirror-model';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import type { BlockSpec } from './types';
import { buildHistoryPlugins } from './plugins/build-history-plugin';
import { buildInputRules } from './plugins/build-input-rules';
import { buildMarkKeymap } from './plugins/build-mark-keymap';
import { buildHeadingKeymap } from './plugins/build-heading-keymap';
import { buildSlashPlugin } from './plugins/build-slash-plugin';
import { buildBlockHandlePlugin } from './plugins/build-block-handle-plugin';
import { buildListKeymap } from './plugins/build-list-keymap';
import { buildCodeBlockKeymap } from './plugins/build-code-block-keymap';
import { buildHardBreakKeymap } from './plugins/build-hard-break-keymap';
import { buildLinkClickPlugin } from './plugins/build-link-click-plugin';

/**
 * 装配 EditorView
 *
 * @param container DOM 挂载容器
 * @param schema 已拼装的 PM Schema
 * @param blocks BlockSpec 列表(收集 plugin / nodeView)
 * @param doc 初始 PM doc
 * @param onTransaction 每次 transaction 回调(给 Host 用)
 */
export function buildEditorView(
  container: HTMLElement,
  schema: Schema,
  blocks: BlockSpec[],
  doc: PMNode,
  onTransaction: (tr: Transaction, view: EditorView) => void,
  viewId: string,
  instanceId: string,
): EditorView {
  // 收集 nodeViews
  const nodeViews: Record<string, NodeViewConstructor> = {};
  for (const block of blocks) {
    if (block.nodeView) {
      nodeViews[block.id] = block.nodeView as NodeViewConstructor;
    }
  }

  // 收集 block 自带 plugins
  const blockPlugins: Plugin[] = [];
  for (const block of blocks) {
    const result = block.plugin?.();
    if (Array.isArray(result)) blockPlugins.push(...result);
    else if (result) blockPlugins.push(result);
  }

  // L5-B3.1 装配清单 — history 最前(覆盖所有后续动作);keymap 顺序:
  // mark/heading(view 级)→ baseKeymap(PM 标准兜底)
  // slash / block-handle 是 L5-B3.1 加的交互 plugin
  const plugins: Plugin[] = [
    ...buildHistoryPlugins(),    // history() + Mod-z/Mod-Shift-z/Mod-y
    ...blockPlugins,
    buildInputRules(schema),     // headings + 4 mark markdown
    buildSlashPlugin(viewId),    // / 触发 slashMenuController(L5-B3.1)
    buildBlockHandlePlugin(viewId, instanceId), // ⋮⋮ 手柄 + drag source(L5-B3.1)
    dropCursor({ color: '#4a90e2', width: 2 }), // L5-B3.1 拖拽时显蓝线指示插入位置
    buildListKeymap(schema),     // L5-B3.2 list 内 Tab/Shift-Tab/Enter
    buildCodeBlockKeymap(schema), // L5-B3.2 codeBlock Enter 换行 / 双 Enter 跳出 / Tab 缩进
    buildHardBreakKeymap(schema), // L5-B3.3 Shift-Enter 插入 hardBreak 软换行
    buildLinkClickPlugin(),       // L5-B3.4 link 点击分发(5 协议路由)
    buildMarkKeymap(schema),     // Mod-b / Mod-i / Mod-Shift-x / Mod-e
    buildHeadingKeymap(schema),  // Mod-Alt-0/1/2/3
    keymap(baseKeymap),          // PM 标准键盘(Enter / Backspace / 光标)兜底
  ];

  const state = EditorState.create({ doc, plugins });

  const view: EditorView = new EditorView(container, {
    state,
    nodeViews,
    dispatchTransaction(tr) {
      if (view.isDestroyed) return;
      const newState = view.state.apply(tr);
      view.updateState(newState);
      onTransaction(tr, view);
    },
  });

  return view;
}
