/**
 * split-indent keymap — Enter 拆块时让新块继承源块的视觉缩进(indent attr)
 *
 * 背景(2026-06-07 用户拍板原则):只要 Tab 改的是「整个块的缩进」(indent attr),
 * 那么在该缩进块里**回车延续**新建的下一个同级块,就应继承这个缩进、与之对齐。
 *
 * 为什么需要本 keymap:PM 默认 splitBlock 在「光标在块尾按 Enter」(最常见的延续场景)
 * 时,用 defaultBlockAt 产出一个**全新默认类型**的 paragraph(`{ type: deflt }`),
 * **不带任何 attrs** → 新段 indent 归 0,跳回最左。而光标在块中间 split 时 PM 又会
 * copy attrs(indent 保留)→ 行为不一致。本 keymap 统一成「延续 = 继承 indent」。
 *
 * 适用范围(只管「回车延续同级块」,对齐用户勾选口径):
 * - 顶层 textblock(paragraph / heading)indent>0,光标在其内,按 Enter。
 * - 列表项 / toggle 等有各自 Enter keymap(list-keymap / toggle keymap),装载更早会先
 *   拦截,本 keymap 不触发 —— 它们已各自继承(splitListItem copy attrs / toggle 显式继承)。
 * - caption 跳出、slash 插入/转换等**不是延续**,不在本 keymap 范围(它们没有 indent>0
 *   的源块走 Enter,或走专属 keymap)。
 *
 * 实现:跑默认 splitBlock 捕获其 tr,再在同一 tr 内把「split 后光标所在的新块」的 indent
 * 设为源块 indent(若不同)。一个 tr,单次 undo。
 */

import { keymap } from 'prosemirror-keymap';
import { splitBlock } from 'prosemirror-commands';
import type { Command, Plugin, Transaction } from 'prosemirror-state';

/**
 * 取光标所在 textblock 的 indent(>0 才返回,否则 null)。
 * **不固定 depth=1** —— 容器(callout/blockquote/toggle/column)内缩进过的段落回车,
 * 新段也要继承该段的 indent(对齐「容器内 Tab 缩进内部块」的语义)。$from.depth 即光标
 * 所在 textblock 的深度。
 */
function cursorTextblockIndent(
  state: import('prosemirror-state').EditorState,
): number | null {
  const { $from, empty } = state.selection;
  if (!empty) return null;
  if ($from.depth < 1) return null;
  const node = $from.node($from.depth);
  if (!node.isTextblock) return null;
  const indent = (node.attrs.indent as number | undefined) ?? 0;
  return indent > 0 ? indent : null;
}

const splitInheritIndent: Command = (state, dispatch, view) => {
  const sourceIndent = cursorTextblockIndent(state);
  if (sourceIndent === null) return false; // 无缩进 textblock → 放行默认 splitBlock

  if (!dispatch) return splitBlock(state, undefined, view);

  const srcDepth = state.selection.$from.depth;

  let captured: Transaction | null = null;
  const ok = splitBlock(state, (t) => { captured = t; }, view);
  if (!ok || !captured) return false;

  const tr = captured as Transaction;
  // split 后选区落在新块内。取新块(光标所在 textblock,与源同深度)若 indent 与源不同则补齐。
  const $pos = tr.selection.$from;
  const depth = Math.min(srcDepth, $pos.depth);
  if (depth >= 1) {
    const newBlock = $pos.node(depth);
    const cur = (newBlock.attrs.indent as number | undefined) ?? 0;
    if (newBlock.attrs.indent !== undefined && cur !== sourceIndent) {
      tr.setNodeMarkup($pos.before(depth), null, { ...newBlock.attrs, indent: sourceIndent });
    }
  }
  dispatch(tr.scrollIntoView());
  return true;
};

export function buildSplitIndentKeymap(): Plugin {
  return keymap({ Enter: splitInheritIndent });
}
