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
import { buildTitleGuardPlugin } from './plugins/build-title-guard-plugin';
import { buildNoteLinkCommandPlugin } from './plugins/build-note-link-command-plugin';
import { buildPasteMediaPlugin } from './plugins/build-paste-media-plugin';
import { buildVocabHighlightPlugin } from './plugins/build-vocab-highlight-plugin';
import { buildBlockSelectionPlugin } from './plugins/build-block-selection-plugin';
import { buildBlockSelectionKeymap } from './plugins/build-block-selection-keymap';

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
  pluginToggles?: import('./types').TextEditingPluginToggles,
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
  //
  // L5-G4.5 plugin 启停:`pluginToggles?` opt-out 模式(default 全开),
  // NoteView 不传 → 行为零回归;canvas-text-node 关 5 项专属能力.
  // 不暴露的(始终开):history / inputRules / 所有 keymap / linkClick / block plugins.
  //
  // title-guard 守门(C8 D-D):从硬编码 viewId === 'note-view' 改 toggle,
  // view 显式声明 plugins.titleGuard=true。兼容期保留 viewId === 'note-view'
  // fallback(NoteView 暂未显式传该 toggle 即可零回归);未来所有 view 显式声明
  // 后可删 fallback。详见 plugins/build-title-guard-plugin.ts。
  const requiresTitleGuard = pluginToggles?.titleGuard ?? (viewId === 'note-view');
  // opt-out 默认值 — 未传开关时 = true(NoteView 零回归契约)
  const optIn = (v: boolean | undefined): boolean => v !== false;
  const enableBlockHandle = optIn(pluginToggles?.blockHandle);
  const enableVocabHighlight = optIn(pluginToggles?.vocabHighlight);
  const enableNoteLinkCommand = optIn(pluginToggles?.noteLinkCommand);
  const enablePasteMedia = optIn(pluginToggles?.pasteMedia);
  const enableDropCursor = optIn(pluginToggles?.dropCursor);
  const enableSlash = optIn(pluginToggles?.slash);

  const plugins: Plugin[] = [
    ...buildHistoryPlugins(),    // history() + Mod-z/Mod-Shift-z/Mod-y(始终开)
    buildBlockSelectionPlugin(), // MultipleNodeSelection 视觉增强(Step 1 骨架)
    ...blockPlugins,
    ...(requiresTitleGuard ? [buildTitleGuardPlugin()] : []),
    buildInputRules(schema),     // headings + 4 mark markdown(始终开)
    ...(enableSlash ? [buildSlashPlugin(viewId)] : []),
    ...(enableBlockHandle ? [buildBlockHandlePlugin(viewId, instanceId)] : []),
    ...(enableDropCursor ? [dropCursor({ color: '#4a90e2', width: 2 })] : []),
    buildListKeymap(schema),
    buildCodeBlockKeymap(schema),
    buildHardBreakKeymap(schema),
    buildLinkClickPlugin(),
    ...(enableNoteLinkCommand ? [buildNoteLinkCommandPlugin()] : []),
    ...(enablePasteMedia ? [buildPasteMediaPlugin()] : []),
    ...(enableVocabHighlight ? [buildVocabHighlightPlugin()] : []),
    buildMarkKeymap(schema),
    buildHeadingKeymap(schema),
    buildBlockSelectionKeymap(),  // Esc/Shift+Arrow:抢在 baseKeymap 之前
    keymap(baseKeymap),
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
