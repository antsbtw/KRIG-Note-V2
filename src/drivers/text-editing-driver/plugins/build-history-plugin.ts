/**
 * history plugin — undo/redo 真实现
 *
 * Q4=A:driver 内 prosemirror-history;capability undo-redo scope 注册保留(协议形态完整)。
 */

import { history, undo, redo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Plugin } from 'prosemirror-state';

export function buildHistoryPlugins(): Plugin[] {
  return [
    history(),
    keymap({
      'Mod-z': undo,
      'Mod-Shift-z': redo,
      'Mod-y': redo, // Windows 习惯
    }),
  ];
}
