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
  // title-guard 守门:仅 'note-view' 启用强制首块 isTitle(架构决议 — 不开放给
  // pluginToggles,因为 noteTitle 是 NoteView 专属概念,泄漏给其他 view 反而错乱).
  // 详见 plugins/build-title-guard-plugin.ts 注释 § "L5-B3.11 接入策略".
  const requiresTitleGuard = viewId === 'note-view';
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
