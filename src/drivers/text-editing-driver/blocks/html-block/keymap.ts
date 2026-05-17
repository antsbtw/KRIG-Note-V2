/**
 * html-block keymap — caption 内特殊键处理
 *
 * html-block content='block'(单段 caption,不能 split),用户在 caption 内按 Enter:
 * - PM 默认 splitBlock 会试图创建第二个 caption block → 违反 content 约束 →
 *   PM 通常 fall through 到删除当前 block 行为 → 整个 htmlBlock 被删
 * - 用户视角:在 caption 末尾按回车想换行,结果整块消失
 *
 * 修复:在 html-block caption 内按 Enter,光标移到 html-block 之后,
 * 插入新空段落 + 光标进入。
 *
 * 同型对照:src/drivers/text-editing-driver/blocks/image/keymap.ts
 * 5 个 single-caption block (image/audio/video/tweet/html) 同源问题,本 PR
 * 仅修 html-block(任务边界),其余另开 issue 抽 shared keymap。
 */

import { keymap } from 'prosemirror-keymap';
import { Plugin, TextSelection } from 'prosemirror-state';

export function buildHtmlBlockKeymap(): Plugin {
  return keymap({
    Enter: (state, dispatch) => {
      const { $from } = state.selection;
      // htmlBlock > paragraph(caption) > inline content
      // 期望 $from.depth >= 2,$from.node(-1) 是 htmlBlock
      if ($from.depth < 2) return false;
      const parent = $from.node(-1);
      if (parent.type.name !== 'htmlBlock') return false;

      const paragraphType = state.schema.nodes.paragraph;
      if (!paragraphType) return false;
      const newPara = paragraphType.create();
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
