/**
 * block-indent keymap — 顶层 block 视觉缩进 + 首行缩进快捷键
 *
 * - Tab / Shift-Tab(在非列表 / 非 codeBlock / 非 table 场景下):
 *     调整顶层 block 的 indent attr(0-8)
 *     paragraph 内光标不在行首时 Tab 改为插两个全角空格(对齐 V1 中文段内缩进习惯)
 * - Shift-Mod-i:切换顶层 block 的 textIndent attr(仅 paragraph/heading)
 *
 * 与列表 keymap 的协作:本 keymap 装载顺序在 buildListKeymap 之后,
 * list-keymap 命中 Tab/Shift-Tab 时返回 true 抢断,本 keymap 不会触发。
 * codeBlock 自己有 Tab 处理,table 也有自己的 Tab keymap,优先级同理。
 *
 * 边界处理:
 * - 在 tableCell / tableHeader 内 → 不接管(返回 false 让 table-keymap 走)
 * - 在 codeBlock 内 → 不接管
 * - parent.indent === undefined → 不接管(理论上不会,schema 已注入)
 */

import { keymap } from 'prosemirror-keymap';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

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

/** 取顶层 block(depth=1)pos + node */
function getTopLevelBlock(state: EditorState): { pos: number; node: ReturnType<EditorState['doc']['nodeAt']> } | null {
  const { $from } = state.selection;
  if ($from.depth < 1) return null;
  const pos = $from.before(1);
  const node = state.doc.nodeAt(pos);
  if (!node) return null;
  return { pos, node };
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

function indentCmd(delta: 1 | -1): Command {
  return (state, dispatch) => {
    if (shouldSkip(state)) return false;
    const target = getTopLevelBlock(state);
    if (!target || !target.node) return false;
    const current = (target.node.attrs.indent as number | undefined) ?? 0;
    const next = Math.max(0, Math.min(MAX_INDENT, current + delta));
    if (next === current) {
      // outdent 在 0 时返 false 让上游处理;indent 到 8 返 true 吃掉键(防误插字符)
      return delta === 1;
    }
    if (dispatch) {
      dispatch(
        state.tr.setNodeMarkup(target.pos, null, { ...target.node.attrs, indent: next }),
      );
    }
    return true;
  };
}

const tabCmd: Command = (state, dispatch, view) => {
  if (shouldSkip(state)) return false;
  const { $from } = state.selection;
  // paragraph 内、光标不在行首 → 插两个全角空格(对齐 V1)
  if ($from.parent.type.name === 'paragraph' && $from.parentOffset > 0) {
    if (dispatch) {
      dispatch(state.tr.insertText('　　'));
    }
    return true;
  }
  return indentCmd(1)(state, dispatch, view);
};

const shiftTabCmd: Command = indentCmd(-1);

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
