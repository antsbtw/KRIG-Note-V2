/**
 * block-selection keymap — Esc 选块 + Shift+Arrow 同级扩选
 *
 * 行为(对齐用户三条规则):
 *  1. 块 = handle 视觉单元(由 resolveHandleBlock 决定)
 *  2. Esc:光标所在块 → MultipleNodeSelection(单块);再按 Esc 解除
 *  3. Shift+↑/↓:同级 sibling 内扩缩;撞到 parent 边界 → 停下,不跨出
 *
 * 选区类型: MultipleNodeSelection(Selection 子类),tr.setSelection 携带,
 *   PM clipboard/drag/history 走默认 pipeline。
 *
 * 实现细节:
 *  - MultipleNodeSelection 构造器要求 $pos.depth = block 的深度(不是 parent 深度),
 *    即用 doc.resolve(blockStart + 1) 进入 block 内部一个位置。
 *  - 单块选中 = anchor === head 在同一块内,nodes 返回 1 个节点。
 *  - 扩选时找 head 在 parent 内的 child index,±1,然后构造新 $pos。
 */

import { keymap } from 'prosemirror-keymap';
import { NodeSelection, Selection, TextSelection, type Command, type Plugin } from 'prosemirror-state';
import type { ResolvedPos } from 'prosemirror-model';
import { MultipleNodeSelection } from './_shared/multiple-node-selection';
import { resolveHandleBlock } from './_shared/handle-block';

/**
 * 语法容器:这些节点本身**不是块**(没有自己的 handle),只是 list-item / task-item
 * 的语法外壳。扩选撞它的边界时应**冒泡上提**到它所在 parent 的同级。
 */
const SYNTAX_CONTAINERS = new Set(['bulletList', 'orderedList', 'taskList']);

/**
 * 从 $head 算出下一个/上一个"视觉同级 handle 块"的位置。
 *
 * 算法:
 *  1. 取 $head 所在 parent (depth - 1)
 *  2. 若 newIdx 在 parent.childCount 内 → 直接返回该位置
 *  3. 若越界且 parent 是语法容器(bulletList 等)→ 冒泡到外层 parent,把
 *     **整个语法容器**视为外层的 1 个 sibling,然后在外层 parent 内找 newIdx
 *  4. 若越界且 parent 不是语法容器 → 返回 null(撞真正容器边界,停下)
 */
interface SiblingPosResult {
  $newHead: ResolvedPos;
  bubbled: boolean;
  /** target child 是不是 atom node(hr 等)— 调用方需用 NodeSelection 而非 MNS */
  childIsAtom: boolean;
  /** target child 的 before pos in doc(atom 走 NodeSelection 时直接用此 pos) */
  childStartPos: number;
}

function findSiblingPos(
  doc: import('prosemirror-model').Node,
  $head: ResolvedPos,
  direction: -1 | 1,
): SiblingPosResult | null {
  let currentDepth = $head.depth;
  let currentIdx = $head.index(currentDepth - 1);

  // 一直向外冒泡,直到找到一个非语法容器 parent 且 newIdx 在边界内
  while (currentDepth >= 1) {
    const parentDepth = currentDepth - 1;
    const parent = $head.node(parentDepth);
    const newIdx = currentIdx + direction;

    if (newIdx >= 0 && newIdx < parent.childCount) {
      // 算 newIdx 对应 child 在 doc 内的 before pos
      const parentStart = parentDepth === 0 ? -1 : $head.before(parentDepth);
      let offset = parentStart === -1 ? 0 : parentStart + 1;
      for (let i = 0; i < newIdx; i++) offset += parent.child(i).nodeSize;
      const newChildStart = offset;
      const childNode = parent.child(newIdx);
      const childIsAtom = childNode.isAtom;
      // 非 atom child:resolve(start + 1) 进入 child 内部 → $pos.depth = child 深度
      // atom child:无 inside,resolve(start) 落在 parent 层 → $pos.depth = parent 深度
      //   两种情形下调用方都需要根据 isAtom 决定后续 selection 类型(NS vs MNS)。
      const resolvePos = childIsAtom ? newChildStart : newChildStart + 1;
      const $newHead = doc.resolve(resolvePos);
      const bubbled = currentDepth !== $head.depth;
      return { $newHead, bubbled, childIsAtom, childStartPos: newChildStart };
    }

    // 越界:看 parent 是不是语法容器
    if (!SYNTAX_CONTAINERS.has(parent.type.name)) return null;
    // 冒泡一层:current 变成 parent 在它的 parent 内的位置
    currentDepth = parentDepth;
    if (currentDepth < 1) return null;
    currentIdx = $head.index(currentDepth - 1);
  }
  return null;
}

/**
 * Esc 命令:
 *  - 当前是 MultipleNodeSelection → 解除(变 TextSelection 落在选区起点)
 *  - 当前是 NodeSelection 框住一个 atom block(如 horizontalRule)
 *    → 转成 MultipleNodeSelection(统一 block 选中视觉/语义,避免 PM 默认虚线框
 *    与 krig-block-selected 蓝底两套样式并存)
 *  - 否则 → 选光标所在 handle block
 */
const escapeBlockSelection: Command = (state, dispatch) => {
  const sel = state.selection;

  // 解除
  if (sel instanceof MultipleNodeSelection) {
    if (dispatch) {
      const $pos = state.doc.resolve(sel.from);
      dispatch(state.tr.setSelection(TextSelection.near($pos, 1)));
    }
    return true;
  }

  // NodeSelection on atom block:PM 把光标无法陷入的 atom 节点(hr 等)做 NodeSelection,
  // 这里转成 MultipleNodeSelection 统一选块语义。
  if (sel instanceof NodeSelection && sel.node.isBlock && sel.node.isAtom) {
    if (dispatch) {
      try {
        // atom 端 $pos 用 sel.from(atom 的 before pos,落在 parent 层)
        const $atParent = state.doc.resolve(sel.from);
        const newSel = MultipleNodeSelection.create($atParent, $atParent);
        dispatch(state.tr.setSelection(newSel).scrollIntoView());
      } catch {
        /* atom 在不合法位置 — 保留 NodeSelection */
      }
    }
    return true;
  }

  // 选块:光标 → handle block
  const head = state.selection.head;
  const block = resolveHandleBlock(state.doc, head);
  if (!block) return false;

  if (dispatch) {
    try {
      const $inside = state.doc.resolve(block.start + 1);
      const newSel = MultipleNodeSelection.create($inside, $inside);
      dispatch(state.tr.setSelection(newSel).scrollIntoView());
    } catch {
      /* 构造失败 — 不接管 */
    }
  }
  return true;
};

/**
 * Arrow(无 Shift)移动:
 *  - 已是 MultipleNodeSelection → 折叠到上/下一同级 sibling 单块(保持块选中态)
 *  - 否则 → return false 让 PM 默认走(光标移动)
 *
 * 边界:走到 parent 首/尾后再按 → 返回 false 让 PM 接管(光标移到下一行/退出选区)
 */
function moveBlockSelection(direction: -1 | 1): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    // 当前是 MNS 或 NodeSelection-on-atom 时,Arrow 折叠到上/下同级 sibling 单块
    const isAtomNS = sel instanceof NodeSelection && sel.node.isBlock && sel.node.isAtom;
    if (!(sel instanceof MultipleNodeSelection) && !isAtomNS) return false;

    // 起点 $head:MNS 取 head/anchor 中朝 direction 一端;atom NS 取 sel.$from
    let startFrom: ResolvedPos;
    if (sel instanceof MultipleNodeSelection) {
      startFrom = direction === 1
        ? (sel.headIdx >= sel.anchorIdx ? sel.$headPos : sel.$anchorPos)
        : (sel.headIdx <= sel.anchorIdx ? sel.$headPos : sel.$anchorPos);
    } else {
      // atom NS:sel.$from 落在 parent 层,index() 指向 atom — findSiblingPos
      // 用 $head.depth 拿 parent + currentIdx,可直接传入。
      startFrom = (sel as NodeSelection).$from;
    }

    const result = findSiblingPos(state.doc, startFrom, direction);
    if (!result) return true;  // 撞真正容器边界 → 吃事件保护选区
    const { $newHead, childIsAtom, childStartPos } = result;

    if (dispatch) {
      try {
        // atom 目标 → NodeSelection;非 atom → MultipleNodeSelection 折叠成单块
        const newSel = childIsAtom
          ? NodeSelection.create(state.doc, childStartPos)
          : MultipleNodeSelection.create($newHead, $newHead);
        dispatch(state.tr.setSelection(newSel).scrollIntoView());
      } catch {
        return true;
      }
    }
    return true;
  };
}

/**
 * Shift+Arrow 扩缩:
 *  - 无块选区 → 先把当前 handle block 选中,再扩
 *  - 有块选区:取 head 在 parent 内的 child index,±direction;
 *    边界外 return false(停下)
 */
function extendBlockSelection(direction: -1 | 1): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    const startAtomNS = sel instanceof NodeSelection && sel.node.isBlock && sel.node.isAtom;

    let $anchor;
    let $head;
    const wasMNS = sel instanceof MultipleNodeSelection;

    if (sel instanceof MultipleNodeSelection) {
      $anchor = sel.$anchorPos;
      $head = sel.$headPos;
    } else if (startAtomNS) {
      // Shift+Arrow 从 atom NS 起步:$anchor 落在 atom 的 before pos(depth=parent 层),
      // $head 同 — 走 findSiblingPos 找下一 sibling。
      $anchor = (sel as NodeSelection).$from;
      $head = $anchor;
    } else {
      const block = resolveHandleBlock(state.doc, sel.head);
      if (!block) return false;
      const $inside = state.doc.resolve(block.start + 1);
      $anchor = $inside;
      $head = $inside;
    }

    // findSiblingPos:撞语法容器(bulletList 等)边界会自动冒泡;
    // 撞真正容器(callout/blockquote)边界返回 null → 停下
    const result = findSiblingPos(state.doc, $head, direction);
    if (!result) return wasMNS || startAtomNS;
    const { $newHead, bubbled } = result;

    // 如果发生冒泡,anchor 也要上提到新 head 同 depth(否则两端不同 parent,
    // MultipleNodeSelection.create 抛 RangeError)。
    // 上提时 anchor 取"原 anchor 所在的语法容器整体" → 即 anchor 的对应祖先 $pos。
    if (bubbled) {
      const newDepth = $newHead.depth;
      if ($anchor.depth !== newDepth) {
        // 找 $anchor 在 newDepth 层的对应 ancestor pos:即 $anchor.before(newDepth)
        // 但 newDepth < $anchor.depth,所以 ancestor 就是 $anchor.before(newDepth) + 1
        try {
          // 用 $anchor 路径上对应 depth 的 before 位置 + 1 进入该节点
          const anchorAtNewDepth = $anchor.before(newDepth) + 1;
          $anchor = state.doc.resolve(anchorAtNewDepth);
        } catch {
          return wasMNS;
        }
      }
    }

    if (dispatch) {
      try {
        const newSel = MultipleNodeSelection.create($anchor, $newHead);
        dispatch(state.tr.setSelection(newSel).scrollIntoView());
      } catch {
        return wasMNS || startAtomNS;
      }
    }
    return true;
  };
}

export function buildBlockSelectionKeymap(): Plugin {
  return keymap({
    Escape: escapeBlockSelection,
    'Shift-ArrowUp': extendBlockSelection(-1),
    'Shift-ArrowDown': extendBlockSelection(1),
    ArrowUp: moveBlockSelection(-1),
    ArrowDown: moveBlockSelection(1),
  });
}

// Re-export for selection-source consumers wanting to detect block selection
export { MultipleNodeSelection };
// Help TS find Selection (avoid unused-import warning if removed later)
export type { Selection };
