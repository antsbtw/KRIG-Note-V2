/**
 * list keymap — Enter 处理(Tab/Shift-Tab 不在此)
 *
 * - Enter(空 listItem):跳出列表;非空项:分裂出新项(splitListItem 内置 liftEmptyBlock)
 *
 * Tab / Shift-Tab **不归本 keymap**(2026-06-07 用户拍板:块缩进以「选中块」为硬前提,
 * 不选不动块)。单光标停在列表项里 Tab = 纯文本光标 → 落到 block-indent-keymap 的行为 3
 * (从光标处插两个全角空格)。要缩进整项必须先 Esc/拖选选中该项,由 block-indent-keymap
 * 的 indentBlockSelection 处理。详见 [[project-tab-indent-three-behaviors]]。
 */

import { keymap } from 'prosemirror-keymap';
import { splitListItem } from 'prosemirror-schema-list';
import type { Plugin, Command } from 'prosemirror-state';
import type { Schema } from 'prosemirror-model';

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
  }

  return keymap(km);
}
