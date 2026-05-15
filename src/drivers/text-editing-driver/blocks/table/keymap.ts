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
      // 不在 table 内时透传 Tab(让 buildListKeymap 等后续 plugin 接管)
      // goToNextCell / addRowAfter dry-run 都返回 false → 当前光标不在 table 内
      if (goToNextCell(1)(state)) {
        return goToNextCell(1)(state, dispatch);
      }
      if (addRowAfter(state)) {
        if (dispatch) addRowAfter(state, dispatch);
        return true;
      }
      return false;
    },
    'Shift-Tab': goToNextCell(-1),
  });
}
