/**
 * codeBlock keymap — 代码块专用键盘处理(Tab / Shift-Tab / Backspace)
 *
 * 行为(对齐 V1):
 * - Tab             → 插 2 空格(代码缩进)
 * - Shift-Tab       → 删行首 2 空格(反缩进)
 * - Backspace(空 codeBlock)→ 替换为 paragraph
 *
 * **Enter 已并入集中 keyboard 模块**(keyboard/enter-decision §4.1 step 1,isCodeArea):
 * 插 \n / 末尾双回车跳出。本文件 Phase 3 起不再处理 Enter。
 *
 * 注:V2 paragraph 节点 id 是 'paragraph'(PM 标准命名)。
 */

import { Plugin, TextSelection } from 'prosemirror-state';
import type { Schema } from 'prosemirror-model';

const INDENT = '  '; // 2 spaces

export function buildCodeBlockKeymap(schema: Schema): Plugin {
  const codeBlock = schema.nodes.codeBlock;
  const paragraph = schema.nodes.paragraph;
  if (!codeBlock || !paragraph) {
    return new Plugin({}); // 缺节点 — 退化为空 plugin(向前兼容)
  }

  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        const { state } = view;
        const { $from } = state.selection;

        // 仅光标在 codeBlock 内时介入
        const blockNode = $from.node($from.depth);
        if (!blockNode || blockNode.type.name !== 'codeBlock') return false;

        // Enter 已由集中 keyboard 模块接管(isCodeArea),本文件不再处理。

        // ── Tab → 缩进 ──
        if (event.key === 'Tab' && !event.shiftKey) {
          event.preventDefault();
          view.dispatch(state.tr.replaceSelectionWith(state.schema.text(INDENT)));
          return true;
        }

        // ── Shift-Tab → 反缩进 ──
        if (event.key === 'Tab' && event.shiftKey) {
          event.preventDefault();
          const textContent = blockNode.textContent;
          const cursorOffset = $from.parentOffset;
          const textBefore = textContent.slice(0, cursorOffset);
          const lineStart = textBefore.lastIndexOf('\n') + 1;
          const lineText = textContent.slice(lineStart);
          let spacesToRemove = 0;
          if (lineText.startsWith(INDENT)) spacesToRemove = INDENT.length;
          else if (lineText.startsWith(' ')) spacesToRemove = 1;

          if (spacesToRemove > 0) {
            const blockStart = $from.start($from.depth);
            const deleteFrom = blockStart + lineStart;
            view.dispatch(state.tr.delete(deleteFrom, deleteFrom + spacesToRemove));
          }
          return true;
        }

        // ── Backspace(空 codeBlock → 替换为 paragraph) ──
        if (event.key === 'Backspace' && blockNode.content.size === 0) {
          event.preventDefault();
          const blockPos = $from.before($from.depth);
          const blockEnd = $from.after($from.depth);
          const tr = state.tr.replaceWith(blockPos, blockEnd, paragraph.create());
          tr.setSelection(TextSelection.create(tr.doc, blockPos + 1));
          view.dispatch(tr);
          return true;
        }

        return false;
      },
    },
  });
}
