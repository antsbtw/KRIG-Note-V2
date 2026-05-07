/**
 * table keymap — Tab / Shift-Tab(L5-B3.7)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/table.ts tableKeymapPlugin
 *
 * - Tab:跳到下一 cell;末 cell 时自动加新行(用户连续 Tab 快速建表)
 * - Shift-Tab:上一 cell
 *
 * 跟 buildListKeymap / buildHardBreakKeymap 等 V2 既有 keymap 共存,通过 plugin 顺序
 * 保证 table 内 Tab 优先(本 plugin 通过 BlockSpec.plugin 注册,会跟其他 block plugin
 * 一起插在 keymap(baseKeymap) 之前)
 */

import { keymap } from 'prosemirror-keymap';
import type { Plugin } from 'prosemirror-state';
import { goToNextCell, addRowAfter } from 'prosemirror-tables';

export function tableKeymapPlugin(): Plugin {
  return keymap({
    Tab: (state, dispatch) => {
      // goToNextCell 在末 cell 时返回 false → 加新行后再 dispatch goToNextCell
      if (goToNextCell(1)(state, dispatch)) return true;
      if (dispatch) addRowAfter(state, dispatch);
      return true;
    },
    'Shift-Tab': goToNextCell(-1),
  });
}
