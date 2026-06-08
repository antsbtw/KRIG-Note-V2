/**
 * semantic-actions — 键盘语义原子动作(keyboard-system.md §三)
 *
 * Enter / Backspace 决策链最终都归结为这组原子动作。集中模块只实现这些动作 + 两条决策链。
 *
 * Phase 1:Enter 侧动作已实现(忠实复刻现状各 keymap 行为 + 统一)。Backspace 侧 Phase 2 填。
 */

import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { splitBlock as pmSplitBlock } from 'prosemirror-commands';
import type { Node as PMNode } from 'prosemirror-model';

/** PM Command 形参签名(dispatch 缺省 = dry-run)。 */
export type ActionFn = (
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
) => boolean;

// ── 工具 ──

/** 取 paragraph 节点类型;缺失返回 null。 */
function paragraphType(state: EditorState) {
  return state.schema.nodes.paragraph ?? null;
}

// ── Enter 侧 ──

/**
 * splitBlock + 继承格式(formatAttrs)。
 *
 * 复刻 build-split-indent-keymap:跑默认 splitBlock,捕获其 tr,把新块的 formatAttrs
 * 补成源块的值(PM 默认 splitBlock 在块尾用 defaultBlockAt 产新块、不带 attrs)。
 * 标题块尾 split → 新块自然是 paragraph(defaultBlockAt),只继承 formatAttrs(不继承 level)。
 *
 * @param formatAttrs 要继承的 attr 名(如 ['indent','textIndent','align']);空则等价裸 splitBlock
 */
/** 中文段首缩进:Tab(行为3)插的两个全角空格。 */
const FULLWIDTH_INDENT = '　　';

export function splitBlockInheritFormat(formatAttrs: readonly string[]): ActionFn {
  return (state, dispatch) => {
    const { $from } = state.selection;
    const srcDepth = $from.depth;
    const srcBlock = $from.node(srcDepth);
    // 源段是否以两个全角空格开头(Tab 段首缩进)→ 新段也补上(中文段落习惯)
    const inheritFullwidth =
      srcBlock.isTextblock && srcBlock.textContent.startsWith(FULLWIDTH_INDENT);

    if (!dispatch) return pmSplitBlock(state, undefined);

    let captured: Transaction | null = null;
    const ok = pmSplitBlock(state, (t) => { captured = t; });
    if (!ok || !captured) return false;
    let tr = captured as Transaction;

    if (formatAttrs.length > 0) {
      const $pos = tr.selection.$from;
      const depth = Math.min(srcDepth, $pos.depth);
      if (depth >= 1) {
        const newBlock = $pos.node(depth);
        const patch: Record<string, unknown> = {};
        let changed = false;
        for (const a of formatAttrs) {
          if (a in newBlock.attrs && a in srcBlock.attrs && newBlock.attrs[a] !== srcBlock.attrs[a]) {
            patch[a] = srcBlock.attrs[a];
            changed = true;
          }
        }
        if (changed) {
          tr.setNodeMarkup($pos.before(depth), null, { ...newBlock.attrs, ...patch });
        }
      }
    }

    // 段首全角空格继承:在新段(split 后光标处)插两个全角空格,光标落在其后
    if (inheritFullwidth) {
      tr = tr.insertText(FULLWIDTH_INDENT, tr.selection.from);
    }

    dispatch(tr.scrollIntoView());
    return true;
  };
}

/**
 * 在「指定祖先块」之后插入一个新段落,光标进入。
 *
 * 复刻 image/html/math-visual caption keymap + column 退出:caption/容器单段不可拆 →
 * 在该块后插正文段跳出。
 *
 * @param ancestorDepthFromLeaf 目标祖先相对 $from 的 depth(如 caption 块 = $from.depth-1)
 */
export function exitToParagraphAfter(getAncestorBefore: (state: EditorState) => { afterPos: number } | null): ActionFn {
  return (state, dispatch) => {
    const target = getAncestorBefore(state);
    if (!target) return false;
    const para = paragraphType(state);
    if (!para) return false;
    if (dispatch) {
      let tr = state.tr.insert(target.afterPos, para.create());
      tr = tr.setSelection(TextSelection.create(tr.doc, target.afterPos + 1)).scrollIntoView();
      dispatch(tr);
    }
    return true;
  };
}

/**
 * 在容器后插入新的同类型容器(收起 toggle Enter):新容器 { open:true, indent: 继承 } + 空段。
 *
 * 复刻 toggle-list keymap exitClosedToggleOnEnter。
 */
export function insertSiblingToggleAfter(
  toggleDepth: number,
): ActionFn {
  return (state, dispatch) => {
    const { $from } = state.selection;
    const toggleList = $from.node(toggleDepth);
    const toggleListType = state.schema.nodes.toggleList;
    const para = paragraphType(state);
    if (!toggleListType || !para) return false;
    if (dispatch) {
      const toggleListEnd = $from.after(toggleDepth);
      const inheritedIndent = (toggleList.attrs.indent as number | undefined) ?? 0;
      const newToggle = toggleListType.create({ open: true, indent: inheritedIndent }, para.create());
      const tr = state.tr.insert(toggleListEnd, newToggle);
      tr.setSelection(TextSelection.create(tr.doc, toggleListEnd + 2));
      tr.scrollIntoView();
      dispatch(tr);
    }
    return true;
  };
}

/** 块内插换行 `\n`(代码块 Enter)。 */
export function insertNewline(): ActionFn {
  return (state, dispatch) => {
    if (dispatch) dispatch(state.tr.replaceSelectionWith(state.schema.text('\n')));
    return true;
  };
}

/**
 * 代码块「双回车跳出」:光标在末尾 + 末字符是 \n → 删 \n + codeBlock 后插段;若 codeBlock 空则删之。
 * 复刻 build-code-block-keymap。
 */
export function codeBlockExitOnDoubleEnter(codeBlock: PMNode, blockDepth: number): ActionFn {
  return (state, dispatch) => {
    const { $from } = state.selection;
    const para = paragraphType(state);
    if (!para) return false;
    const blockPos = $from.before(blockDepth);
    const blockEnd = $from.after(blockDepth);
    if (dispatch) {
      let tr = state.tr.delete($from.pos - 1, $from.pos); // 删末尾 \n
      const mappedEnd = tr.mapping.map(blockEnd);
      tr = tr.insert(mappedEnd, para.create());
      tr = tr.setSelection(TextSelection.create(tr.doc, mappedEnd + 1));
      const mappedBlockPos = tr.mapping.map(blockPos);
      const updated = tr.doc.nodeAt(mappedBlockPos);
      if (updated && updated.textContent === '') {
        tr = tr.delete(mappedBlockPos, mappedBlockPos + updated.nodeSize);
      }
      dispatch(tr);
    }
    void codeBlock;
    return true;
  };
}
