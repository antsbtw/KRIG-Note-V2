/**
 * codeBlock keymap — 代码块专用键盘处理
 *
 * 行为(对齐 V1):
 * - Enter           → 插入换行(\n),不出 codeBlock
 * - Enter(末尾且最后字符是 \n)→ 删末尾 \n,在 codeBlock 之后插新 text-block(double-enter 跳出)
 * - Tab             → 插 2 空格(代码缩进)
 * - Shift-Tab       → 删行首 2 空格(反缩进)
 * - Backspace(空 codeBlock)→ 替换为 text-block
 *
 * 注:V2 text-block 节点 id 是 'text-block'(短横线,L5-A 既存)。
 */

import { Plugin, TextSelection } from 'prosemirror-state';
import type { Schema } from 'prosemirror-model';

const INDENT = '  '; // 2 spaces

export function buildCodeBlockKeymap(schema: Schema): Plugin {
  const codeBlock = schema.nodes.codeBlock;
  const textBlock = schema.nodes['text-block'];
  if (!codeBlock || !textBlock) {
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

        // ── Enter ──
        if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
          event.preventDefault();
          const textContent = blockNode.textContent;
          const cursorOffset = $from.parentOffset;

          // double-enter 跳出:光标在末尾 + 最后一字符是 \n
          if (cursorOffset === textContent.length && textContent.endsWith('\n')) {
            const blockPos = $from.before($from.depth);
            const blockEnd = $from.after($from.depth);
            let tr = state.tr;
            tr = tr.delete($from.pos - 1, $from.pos); // 删末尾 \n
            const mappedEnd = tr.mapping.map(blockEnd);
            tr = tr.insert(mappedEnd, textBlock.create());
            tr = tr.setSelection(TextSelection.create(tr.doc, mappedEnd + 1));

            // 若 codeBlock 已空,删除它
            const mappedBlockPos = tr.mapping.map(blockPos);
            const updatedBlock = tr.doc.nodeAt(mappedBlockPos);
            if (updatedBlock && updatedBlock.textContent === '') {
              tr = tr.delete(mappedBlockPos, mappedBlockPos + updatedBlock.nodeSize);
            }
            view.dispatch(tr);
            return true;
          }

          // 普通 Enter:插 \n
          view.dispatch(state.tr.replaceSelectionWith(state.schema.text('\n')));
          return true;
        }

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

        // ── Backspace(空 codeBlock → 替换为 text-block) ──
        if (event.key === 'Backspace' && blockNode.content.size === 0) {
          event.preventDefault();
          const blockPos = $from.before($from.depth);
          const blockEnd = $from.after($from.depth);
          const tr = state.tr.replaceWith(blockPos, blockEnd, textBlock.create());
          tr.setSelection(TextSelection.create(tr.doc, blockPos + 1));
          view.dispatch(tr);
          return true;
        }

        return false;
      },
    },
  });
}
