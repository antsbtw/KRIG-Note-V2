/**
 * image keymap — caption 内特殊键处理
 *
 * V2 image content='block'(单 caption,不能 split),用户在 caption 内按 Enter 时:
 * - PM 默认 splitBlock 会创建第二个 caption block → 违反 image content 约束 → PM 拒绝
 * - 行为上像没反应,用户再按 Backspace 把 image 删了
 *
 * 修复:在 image caption 内按 Enter,光标移到 image 之后,**插入新空段落 + 光标进入**。
 */

import { keymap } from 'prosemirror-keymap';
import { Plugin, TextSelection } from 'prosemirror-state';

export function buildImageKeymap(): Plugin {
  return keymap({
    Enter: (state, dispatch) => {
      const { $from } = state.selection;
      // image > text-block(caption)> inline content
      // 期望 $from.depth >= 2,$from.node(-1) 是 image
      if ($from.depth < 2) return false;
      const parent = $from.node(-1);
      if (parent.type.name !== 'image') return false;

      const textBlockType = state.schema.nodes['text-block'];
      if (!textBlockType) return false;
      const newPara = textBlockType.create();
      const insertPos = $from.after(-1);
      if (dispatch) {
        let tr = state.tr.insert(insertPos, newPara);
        const sel = TextSelection.create(tr.doc, insertPos + 1);
        tr = tr.setSelection(sel).scrollIntoView();
        dispatch(tr);
      }
      return true;
    },
  });
}
