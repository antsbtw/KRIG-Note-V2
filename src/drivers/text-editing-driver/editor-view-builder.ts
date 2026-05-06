/**
 * EditorView 装配
 *
 * 见 DESIGN.md v0.2.1 § 4。
 *
 * L5-A:最小集 — keymap(baseKeymap) only。L5-B+ 加 history / inputRules / etc.
 */

import { EditorState, type Plugin, type Transaction } from 'prosemirror-state';
import { EditorView, type NodeViewConstructor } from 'prosemirror-view';
import type { Schema, Node as PMNode } from 'prosemirror-model';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import type { BlockSpec } from './types';

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

  // L5-A 装配清单(最小集)
  const plugins: Plugin[] = [
    ...blockPlugins,
    keymap(baseKeymap), // PM 标准键盘(Enter / Backspace / 光标)
    // L5-B+ 加:history / dropCursor / gapCursor / markKeymap / etc.
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
