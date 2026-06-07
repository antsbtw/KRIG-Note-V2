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
import { type Schema, type Node as PMNode, Slice } from 'prosemirror-model';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap } from 'prosemirror-commands';
import { buildThrottledDropCursorPlugin } from './plugins/build-throttled-dropcursor-plugin';
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
import { buildThoughtAnchorPlugin } from './plugins/build-thought-anchor-plugin';
import { buildTitleGuardPlugin } from './plugins/build-title-guard-plugin';
import { buildNoteLinkCommandPlugin } from './plugins/build-note-link-command-plugin';
import { buildPasteMediaPlugin } from './plugins/build-paste-media-plugin';
import { buildVocabHighlightPlugin } from './plugins/build-vocab-highlight-plugin';
import { buildCodeSyntaxHighlightPlugin } from './plugins/build-code-syntax-highlight-plugin';
import { buildBlockSelectionPlugin } from './plugins/build-block-selection-plugin';
import { buildBlockSelectionKeymap } from './plugins/build-block-selection-keymap';
import { buildBlockSelectionContextMenuPlugin } from './plugins/build-block-selection-context-menu-plugin';
import { buildBlockFramePlugin } from './plugins/build-block-frame-plugin';
import { buildBlockIndentPlugin } from './plugins/build-block-indent-plugin';
import { buildBlockIndentKeymap } from './plugins/build-block-indent-keymap';
import { buildHeadingCollapsePlugin } from './plugins/build-heading-collapse-plugin';
import { buildAutoBlockIdPlugin } from './plugins/build-auto-block-id-plugin';
import { buildBottomPadPlugin } from './plugins/build-bottom-pad-plugin';

/**
 * 拷贝归一化:纯 inline 选区(选区落在单个 textblock 内部、没跨块)→ 剥掉外层块壳,
 * 只留 inline fragment。
 *
 * 默认 PM 把「列表项/段落内的文字选区」序列化成带块包裹的 html(`<ul><li><p>...`),
 * 粘到富文本目标会带出列表符号 / 块结构。用户预期:拖拽选文字 = 只拷文字内容 + inline
 * 格式(code/bold/link),不带 •/1. 列表符号、不带块壳。
 *
 * 判定:slice 内容是单个顶层 block 且两端都 open(openStart>0 && openEnd>0 = 选区在
 * 该 block 内部,没含完整块边界)。是 textblock(段落/heading)→ 直接用其 inline 内容;
 * 是容器(listItem 等单子)→ 递归往里剥到 textblock。跨块 / 选整块 → 原样(保留结构)。
 *
 * 在 transformCopied 里调:改 slice 本身,PM 后续序列化 plain+html 都不带块壳。
 */
function stripBlockWrapperForInlineSlice(slice: Slice): Slice {
  const content = slice.content;
  if (content.childCount === 1 && slice.openStart > 0 && slice.openEnd > 0) {
    const only = content.child(0);
    if (only.isTextblock) {
      return new Slice(only.content, slice.openStart - 1, slice.openEnd - 1);
    }
    if (only.childCount === 1) {
      return stripBlockWrapperForInlineSlice(
        new Slice(only.content, slice.openStart - 1, slice.openEnd - 1),
      );
    }
  }
  return slice;
}

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
  // bottom-pad(底部留白 + 双击空白新增段 + 失焦 Enter 新增段)—— 连续文档专属能力,
  // 仅 NoteView 装(对齐 titleGuard 守门;Thought 单段卡片不适用)。
  const requiresBottomPad = pluginToggles?.bottomPad ?? (viewId === 'note-view');
  // opt-out 默认值 — 未传开关时 = true(NoteView 零回归契约)
  const optIn = (v: boolean | undefined): boolean => v !== false;
  const enableBlockHandle = optIn(pluginToggles?.blockHandle);
  const enableVocabHighlight = optIn(pluginToggles?.vocabHighlight);
  const enableNoteLinkCommand = optIn(pluginToggles?.noteLinkCommand);
  const enablePasteMedia = optIn(pluginToggles?.pasteMedia);
  const enableDropCursor = optIn(pluginToggles?.dropCursor);
  const enableSlash = optIn(pluginToggles?.slash);
  const enableBlockSelection = optIn(pluginToggles?.blockSelection);
  const enableCodeSyntaxHighlight = optIn(pluginToggles?.codeSyntaxHighlight);
  const enableHeadingCollapse = optIn(pluginToggles?.headingCollapse);

  const plugins: Plugin[] = [
    // L7 block atomization Stage 1.5:auto-block-id-plugin 必须早于 history
    // (避免 id 注入 tr 被记入 undo 栈),early in plugin list 让 appendTransaction
    // 在 dispatch 阶段尽早跑(plugin 顺序影响 appendTransaction 队列顺序).
    buildAutoBlockIdPlugin(),
    ...buildHistoryPlugins(),    // history() + Mod-z/Mod-Shift-z/Mod-y(始终开)
    // block-selection 三件套(opt-out, NoteView 默认开):decoration + context menu + keymap
    ...(enableBlockSelection ? [
      buildBlockSelectionPlugin(),
      buildBlockSelectionContextMenuPlugin(),
    ] : []),
    ...blockPlugins,
    ...(requiresTitleGuard ? [buildTitleGuardPlugin()] : []),
    ...(requiresBottomPad ? [buildBottomPadPlugin()] : []),
    buildInputRules(schema),     // headings + 4 mark markdown(始终开)
    ...(enableSlash ? [buildSlashPlugin(viewId)] : []),
    ...(enableBlockHandle ? [buildBlockHandlePlugin(viewId, instanceId)] : []),
    ...(enableDropCursor ? [buildThrottledDropCursorPlugin({ color: '#4a90e2', width: 2 })] : []),
    // block 框定 + 视觉缩进装饰(读 node attrs 渲染,纯视觉,始终开)
    buildBlockFramePlugin(),
    buildBlockIndentPlugin(),
    buildListKeymap(schema),
    // block-indent keymap 顺序在 list-keymap 之后:列表/codeblock/table 优先抢断 Tab,
    // 落到这里都是普通顶层 block(paragraph/heading/blockquote/callout/...)的视觉缩进。
    buildBlockIndentKeymap(),
    buildCodeBlockKeymap(schema),
    buildHardBreakKeymap(schema),
    buildLinkClickPlugin(),
    buildThoughtAnchorPlugin(),
    ...(enableNoteLinkCommand ? [buildNoteLinkCommandPlugin()] : []),
    ...(enablePasteMedia ? [buildPasteMediaPlugin()] : []),
    ...(enableVocabHighlight ? [buildVocabHighlightPlugin()] : []),
    ...(enableCodeSyntaxHighlight ? [buildCodeSyntaxHighlightPlugin()] : []),
    ...(enableHeadingCollapse ? [buildHeadingCollapsePlugin()] : []),
    buildMarkKeymap(schema),
    buildHeadingKeymap(schema),
    // block-selection keymap 抢在 baseKeymap 之前(Esc/Shift+Arrow/Arrow)
    ...(enableBlockSelection ? [buildBlockSelectionKeymap()] : []),
    keymap(baseKeymap),
  ];

  const state = EditorState.create({ doc, plugins });

  const view: EditorView = new EditorView(container, {
    state,
    nodeViews,
    // 拷贝时:纯 inline 选区(单 textblock 内)剥块壳,避免列表符号/块结构带进剪贴板
    transformCopied: stripBlockWrapperForInlineSlice,
    dispatchTransaction(tr) {
      if (view.isDestroyed) return;
      const newState = view.state.apply(tr);
      view.updateState(newState);
      onTransaction(tr, view);
    },
  });

  return view;
}
