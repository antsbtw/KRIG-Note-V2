/**
 * block-indent keymap — 顶层 block 视觉缩进 + 首行缩进快捷键
 *
 * - Tab / Shift-Tab(在非列表 / 非 codeBlock / 非 table 场景下):
 *     调整顶层 block 的 indent attr(0-8)
 *     paragraph 内光标不在行首时 Tab 改为插两个全角空格(对齐 V1 中文段内缩进习惯)
 * - Shift-Mod-i:切换顶层 block 的 textIndent attr(仅 paragraph/heading)
 *
 * 与列表 keymap 的协作:本 keymap 装载顺序在 buildListKeymap 之后,
 * list-keymap 命中 Tab/Shift-Tab(单光标落在列表项内 → 改该项 indent attr)时返回 true
 * 抢断,本 keymap 不会触发。codeBlock 自己有 Tab 处理,table 也有自己的 Tab keymap,
 * 优先级同理。
 *
 * 多块选区(MultipleNodeSelection,Esc 选块 + Shift+Arrow 扩选产生):list-keymap 只处理
 * 单光标,对多块选区不命中 → 放行到本 keymap。本 keymap 在 tabCmd/shiftTabCmd 最前面拦截
 * MNS(见 indentMultiBlock):对所有选中块(含列表项)统一 indent attr ±1 —— 列表项
 * 与普通块同构(listItem/taskItem spec 已加 indent attr),整组「所有项整体右移一级」。
 *
 * 边界处理:
 * - 在 tableCell / tableHeader 内 → 不接管(返回 false 让 table-keymap 走)
 * - 在 codeBlock 内 → 不接管
 * - parent.indent === undefined → 不接管(理论上不会,schema 已注入)
 */

import { keymap } from 'prosemirror-keymap';
import { NodeSelection, type Command, type EditorState, type Transaction } from 'prosemirror-state';
import { MultipleNodeSelection } from './_shared/multiple-node-selection';

const MAX_INDENT = 8;

/** 跳过本 keymap 的场景:在 table cell / code block 内,let 上游/下游 keymap 处理 */
function shouldSkip(state: EditorState): boolean {
  const { $from } = state.selection;
  if ($from.parent.type.spec.code) return true; // codeBlock
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === 'tableCell' || name === 'tableHeader') return true;
    if (name === 'table') break;
  }
  return false;
}

/**
 * 取光标所在「带 textIndent attr 的最近祖先块」(paragraph/heading)。
 *
 * 不固定 depth=1:首行缩进作用的是光标所在的那个 paragraph/heading,它可能嵌在
 * toggleList / 列表 / callout 内(toggleList content='block+',内部 paragraph 是
 * 嵌套块)。从 $from.depth 向上找第一个 attrs 含 textIndent 的节点 —— 顶层段落
 * depth=1 命中,toggle 内段落在更深 depth 命中。
 */
function getTextIndentBlock(state: EditorState): { pos: number; node: ReturnType<EditorState['doc']['nodeAt']> } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d);
    if (node.attrs && node.attrs.textIndent !== undefined) {
      return { pos: $from.before(d), node };
    }
  }
  return null;
}

/**
 * 多块选区(MultipleNodeSelection)整体缩进 —— 对每个选中块统一 indent attr ±1。
 *
 * 关键修复历史:此前多块选中按 Tab,事件穿过 list-keymap(sinkListItem 不命中多块选区)
 * 落到本 keymap 的 tabCmd → 命中「paragraph 内插全角空格」分支 → insertText 把整个跨块
 * 选区**替换**成两个全角空格 → 表现为「Tab 后所有选中块被删除」。
 *
 * 缩进语义(用户拍板「所有项整体右移一级」,含列表首项):统一走 indent attr margin,
 * **不**走 sink 列表嵌套 —— sink 做不到首项右移,且 PM sink 含首项时整段失败。
 * listItem / taskItem 已在各自 spec 加 indent attr(toDOM 出 margin-left),与普通块同构,
 * 故这里对所有选中块一视同仁:setNodeMarkup 改 indent。attrs 随 dissect/assemble 持久化。
 *
 * setNodeMarkup 不改节点尺寸,故各块 pos 在同一 tr 内累积时无需重映射。
 */
function indentMultiBlock(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, delta: 1 | -1): boolean {
  const sel = state.selection;
  if (!(sel instanceof MultipleNodeSelection)) return false;

  const minIdx = Math.min(sel.anchorIdx, sel.headIdx);
  const maxIdx = Math.max(sel.anchorIdx, sel.headIdx);

  const tr = state.tr;
  let pos = sel.from;
  let changed = false;
  for (let i = minIdx; i <= maxIdx; i++) {
    const node = sel.parent.child(i);
    // indent attr:普通块由 schema-builder 框架注入;listItem/taskItem 在各自 spec 显式加。
    // 防御:个别无该 attr 的块跳过(不阻断其余块缩进)。
    if (node.attrs.indent !== undefined) {
      const current = (node.attrs.indent as number | undefined) ?? 0;
      const next = Math.max(0, Math.min(MAX_INDENT, current + delta));
      if (next !== current) {
        tr.setNodeMarkup(pos, null, { ...node.attrs, indent: next });
        changed = true;
      }
    }
    pos += node.nodeSize;
  }

  if (changed && dispatch) dispatch(tr);
  // 即使本次无变化(全到 0 / 全到 8)也吃掉键 —— 多块选区下 Tab 不应回退到插字符/移焦
  return true;
}

/**
 * 块缩进的单块 NodeSelection 分支:选中单个块节点(如 NodeSelection 框住一个 block /
 * atom)时,对该块 indent ±1。MNS 由 indentMultiBlock 处理;二者合起来覆盖「块选区」。
 */
function indentNodeSelection(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  delta: 1 | -1,
): boolean {
  const sel = state.selection;
  if (!(sel instanceof NodeSelection)) return false;
  if (!sel.node.isBlock) return false;
  if (sel.node.attrs.indent === undefined) return true; // 该块无 indent 语义 → 吃掉键不动
  const current = (sel.node.attrs.indent as number | undefined) ?? 0;
  const next = Math.max(0, Math.min(MAX_INDENT, current + delta));
  if (next !== current && dispatch) {
    dispatch(state.tr.setNodeMarkup(sel.from, null, { ...sel.node.attrs, indent: next }));
  }
  return true; // 块选区下 Tab/Shift-Tab 始终吃掉键(不回退到插字符)
}

/**
 * 块缩进总入口:**仅当存在块选区**(MultipleNodeSelection 或 NodeSelection-on-block)
 * 时才缩进。纯文本光标返回 false —— 行为 1(块缩进)以「选中块」为硬前提,不选不动块。
 */
function indentBlockSelection(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  delta: 1 | -1,
): boolean {
  if (indentMultiBlock(state, dispatch, delta)) return true;
  if (indentNodeSelection(state, dispatch, delta)) return true;
  return false;
}

const tabCmd: Command = (state, dispatch) => {
  // 行为 1:块选区(MNS / NodeSelection-on-block)→ 缩进选中块。**以选中为硬前提**。
  if (indentBlockSelection(state, dispatch, 1)) return true;
  if (shouldSkip(state)) return false;
  // 行为 3:纯文本光标 → 从光标处插两个全角空格(任意 offset,含行首)。
  // 注:行为 2(块内文字首行缩进)走 cmd+shift+i(toggleTextIndentCmd),不归 Tab。
  const { $from } = state.selection;
  if (state.selection.empty && $from.parent.isTextblock) {
    if (dispatch) dispatch(state.tr.insertText('　　'));
    return true;
  }
  return false;
};

// Shift-Tab:只对块选区做 outdent;纯文本光标无对应行为 → 放行(return false)。
const shiftTabCmd: Command = (state, dispatch) => indentBlockSelection(state, dispatch, -1);

const toggleTextIndentCmd: Command = (state, dispatch) => {
  if (shouldSkip(state)) return false;
  // 用「最近的带 textIndent 块」而非固定顶层 block —— toggle/列表/callout 内嵌套的
  // paragraph/heading 也能命中(顶层 toggleList 没有 textIndent attr,旧 getTopLevelBlock
  // 取到它 → return false → toggle 内 cmd+shift+i 不生效,本修复点)。
  const target = getTextIndentBlock(state);
  if (!target || !target.node) return false;
  if (dispatch) {
    dispatch(
      state.tr.setNodeMarkup(target.pos, null, {
        ...target.node.attrs,
        textIndent: !target.node.attrs.textIndent,
      }),
    );
  }
  return true;
};

export function buildBlockIndentKeymap() {
  return keymap({
    Tab: tabCmd,
    'Shift-Tab': shiftTabCmd,
    'Shift-Mod-i': toggleTextIndentCmd,
  });
}
