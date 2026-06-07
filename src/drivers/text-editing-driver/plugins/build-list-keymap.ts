/**
 * list keymap — Tab / Shift-Tab / Enter 处理
 *
 * - Tab:当前列表项视觉右移一级(indent attr +1)
 * - Shift-Tab:当前列表项视觉左移一级(indent attr -1)
 * - Enter(空 listItem):跳出列表(splitListItem 内置 liftEmptyBlock)
 *
 * 缩进语义说明(2026-06-07 用户拍板):列表项 Tab = **整项右移**(margin 视觉缩进),
 * **不是** sink 列表嵌套。理由:
 *  - 用户要的效果是「所有项(含列表首项)整体右移一级」,sink 做不到首项右移,
 *    且 PM sinkListItem 对列表首项整段失败(startIndex==0)。
 *  - 旧 sink 路径还埋了「视觉缩进了但 diff 漏存」的错觉(实为光标在首项 sink 失败、
 *    fall through 到 block-indent-keymap 插全角空格,且全角空格落 listItem 内 paragraph
 *    触发存盘问题)。
 * listItem / taskItem spec 已加 indent attr(toDOM 出 margin-left),attrs 随 dissect/
 * assemble 原样持久化,故重启保留。
 *
 * 多块选区(MultipleNodeSelection)的整体缩进由 block-indent-keymap 的 indentMultiBlock
 * 处理(本 keymap 只管单光标落在某列表项内的场景)。
 */

import { keymap } from 'prosemirror-keymap';
import { splitListItem } from 'prosemirror-schema-list';
import type { Plugin, Command, EditorState, Transaction } from 'prosemirror-state';
import type { Schema } from 'prosemirror-model';

const MAX_INDENT = 8;

/**
 * 取光标所在「最近的列表项(listItem / taskItem)」的 pos + node。
 * 从 $from.depth 向上找第一个 type.name ∈ {listItem, taskItem} 的祖先。
 */
function getEnclosingListItem(
  state: EditorState,
): { pos: number; node: import('prosemirror-model').Node } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 1; d--) {
    const node = $from.node(d);
    if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
      return { pos: $from.before(d), node };
    }
  }
  return null;
}

/** 列表项 indent attr ±1(单光标场景)。命中返回 true(吃掉 Tab),否则 false 放行下游。 */
function indentEnclosingListItem(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  delta: 1 | -1,
): boolean {
  const target = getEnclosingListItem(state);
  if (!target) return false;
  const current = (target.node.attrs.indent as number | undefined) ?? 0;
  const next = Math.max(0, Math.min(MAX_INDENT, current + delta));
  // 到边界(已 0 再 outdent / 已 8 再 indent):仍吃掉键(列表项内 Tab 不该回退到插空格/移焦)
  if (next === current) return true;
  if (dispatch) {
    dispatch(state.tr.setNodeMarkup(target.pos, null, { ...target.node.attrs, indent: next }));
  }
  return true;
}

export function buildListKeymap(schema: Schema): Plugin {
  const listItem = schema.nodes.listItem;
  const taskItem = schema.nodes.taskItem;

  const km: Record<string, Command> = {};

  if (listItem) {
    // Enter:在 list-item 中按 Enter,空项跳出 / 非空项分裂出新项
    // splitListItem 会处理空项跳出(liftEmptyBlock 内置)
    const splitListItemCmd = splitListItem(listItem);
    const splitTaskItemCmd = taskItem ? splitListItem(taskItem) : null;
    km['Enter'] = (state, dispatch, view) => {
      if (splitListItemCmd(state, dispatch, view)) return true;
      if (splitTaskItemCmd && splitTaskItemCmd(state, dispatch, view)) return true;
      return false;
    };

    // Tab / Shift-Tab:当前列表项视觉缩进(indent attr),非 sink 嵌套
    km['Tab'] = (state, dispatch) => indentEnclosingListItem(state, dispatch, 1);
    km['Shift-Tab'] = (state, dispatch) => indentEnclosingListItem(state, dispatch, -1);
  }

  return keymap(km);
}
