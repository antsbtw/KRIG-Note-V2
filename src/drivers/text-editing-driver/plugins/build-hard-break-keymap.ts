/**
 * hardBreak keymap — Shift-Enter 插入 `<br>` 软换行
 *
 * 对齐 V1 NoteEditor.tsx Shift-Enter 行为(简化版 — V1 还有"双 Shift-Enter 跳出
 * 容器"逻辑挂在 container-keyboard 上,V2 没有 container 概念,暂不需要)。
 */

import { keymap } from 'prosemirror-keymap';
import type { Plugin } from 'prosemirror-state';
import type { Schema } from 'prosemirror-model';

export function buildHardBreakKeymap(schema: Schema): Plugin {
  const hardBreak = schema.nodes.hardBreak;
  if (!hardBreak) return keymap({});
  return keymap({
    'Shift-Enter': (state, dispatch) => {
      if (dispatch) {
        dispatch(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView());
      }
      return true;
    },
  });
}
