/**
 * toggleList keymap — closed 状态 Enter 特化(对齐 Notion)
 *
 * 行为:
 *  1. open=true(展开):不介入,PM 默认 splitBlock 走起 → 在标题后插入新段。
 *  2. open=false(收起):光标必在唯一可见的标题(首子)内。
 *     按 Enter → 在 toggleList **之后**插入一个新的 toggleList(open=true, 内含空 paragraph),
 *     光标进入新 toggle 的标题位置。
 *
 * Why: closed 时 CSS `:not(:first-child) { display:none }` 会隐藏 PM 默认 splitBlock
 *      产生的第二个子段,光标跑进隐藏节点表现为"回车不工作"(see pm-host.css:321).
 */

import { keymap } from 'prosemirror-keymap';
import type { Command } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';

/** 找最近的 toggleList 祖先 depth(-1 = 不在 toggleList 内) */
function findToggleListDepth($from: import('prosemirror-model').ResolvedPos): number {
  for (let d = $from.depth; d >= 1; d--) {
    if ($from.node(d).type.name === 'toggleList') return d;
  }
  return -1;
}

const exitClosedToggleOnEnter: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty) return false;

  const tlDepth = findToggleListDepth($from);
  if (tlDepth < 0) return false;

  const toggleList = $from.node(tlDepth);
  // 仅 closed 时介入;open 让 PM 默认 splitBlock 处理(行为不变)
  if (toggleList.attrs.open !== false) return false;

  const toggleListType = state.schema.nodes.toggleList;
  const paragraphType = state.schema.nodes.paragraph;
  if (!toggleListType || !paragraphType) return false;

  if (dispatch) {
    const toggleListEnd = $from.after(tlDepth);
    // 继承当前 toggle 的视觉缩进(indent attr)—— 缩进过的 toggle 回车新建下一个,
    // 应与上一个对齐,而非回到 indent=0 起点(对齐 V1 / Notion 同级延续)。
    const inheritedIndent = (toggleList.attrs.indent as number | undefined) ?? 0;
    const newToggle = toggleListType.create(
      { open: true, indent: inheritedIndent },
      paragraphType.create(),
    );
    const tr = state.tr.insert(toggleListEnd, newToggle);
    // 光标进新 toggle 内首段:toggleListEnd(进 toggleList) + 1 + (进 paragraph) + 1 = +2
    tr.setSelection(TextSelection.create(tr.doc, toggleListEnd + 2));
    tr.scrollIntoView();
    dispatch(tr);
  }
  return true;
};

export function toggleListKeymapPlugin() {
  return keymap({
    Enter: exitClosedToggleOnEnter,
  });
}
