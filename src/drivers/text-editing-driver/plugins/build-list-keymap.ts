/**
 * list keymap — Tab / Shift-Tab / Enter 处理
 *
 * - Tab:嵌套(sinkListItem)
 * - Shift-Tab:反嵌套(liftListItem)
 * - Enter(空 listItem):跳出列表(liftListItem)
 *
 * 用 prosemirror-schema-list 提供的 commands(参数接受我们自定义的 list-item NodeType)。
 */

import { keymap } from 'prosemirror-keymap';
import { splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';
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

    km['Tab'] = (state, dispatch, view) => {
      if (sinkListItem(listItem)(state, dispatch, view)) return true;
      if (taskItem && sinkListItem(taskItem)(state, dispatch, view)) return true;
      return false;
    };
    km['Shift-Tab'] = (state, dispatch, view) => {
      if (liftListItem(listItem)(state, dispatch, view)) return true;
      if (taskItem && liftListItem(taskItem)(state, dispatch, view)) return true;
      return false;
    };
  }

  return keymap(km);
}
