/**
 * backspace-decision — Backspace 优先级链(keyboard-system.md §4.2 = backspace-system §2.0)
 *
 * **只在「块首 / 空块」介入**;非块首一律放行(return false → baseKeymap 删字符)。
 *
 * 优先级链(每按一次只走一步,命中即停):
 *   1. isTitle 文档标题 → noop(保护)
 *   2. 媒体 caption 内、已空 → 光标移出到块上方(不删块);非空只删字符(放行)
 *   3. 当前块 indent>0 → indent−1(减缩进)
 *   4. 当前块是标题 → 降级为正文段(保留文字)
 *   5. 当前块是列表项 → 退出列表(liftListItem)
 *   6. 在容器内、已到该层顶级首块 → 退出容器(lift);tableCell → noop(硬墙)
 *   7. 否则放行 → baseKeymap joinBackward(与上一块合并)
 *
 * 「上提对齐」由 PM lift 的逐层语义自然体现:每按一次 lift 一层,到顶级再退才 joinBackward。
 *
 * 注:实现保守——只接管能明确判定的脱壳步骤;判不定一律放行,绝不破坏「删字符」。
 */

import { TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { setBlockType, lift, joinTextblockBackward } from 'prosemirror-commands';
import { liftListItem } from 'prosemirror-schema-list';
import type { KeyboardMetaLookup } from './resolve-context';

const STRUCTURAL_LIST = new Set(['bulletList', 'orderedList', 'taskList']);

/** 找光标最近的指定 type 祖先 depth;无则 -1。 */
function ancestorDepthOfType(state: EditorState, typeName: string): number {
  const { $from } = state.selection;
  for (let d = $from.depth; d >= 1; d--) {
    if ($from.node(d).type.name === typeName) return d;
  }
  return -1;
}

export function buildBackspaceCommand(metaLookup: KeyboardMetaLookup): Command {
  return (state, dispatch, _view) => {
    const sel = state.selection;
    if (!sel.empty) return false; // 有选区 → 放行(deleteSelection / 删原子块)

    const { $from } = sel;
    // **只在块首介入**:光标不在当前 textblock 行首 → 放行删字符
    if ($from.parentOffset !== 0) return false;

    const block = $from.parent;
    const blockType = block.type.name;

    // —— 1. isTitle 文档标题:保护,不删不合并 ——
    if (blockType === 'paragraph' && block.attrs.isTitle === true) {
      return true; // 吃掉键,什么都不做
    }

    // —— 2. 媒体 caption(image/video/...):**光标在 caption 行首退格 → 退到媒体块上方**
    //        (不分 caption 空/非空,统一;媒体块本身不删)。(2026-06-08 用户拍板)——
    if ($from.depth >= 2) {
      const parent = $from.node(-1);
      if (metaLookup(parent.type.name)?.isCaption) {
        if (dispatch) {
          const mediaBefore = $from.before(-1); // 媒体块的 before pos
          const $mediaBefore = state.doc.resolve(mediaBefore);
          // 光标落到媒体块**之前**最近的文本位(= 上方块末尾)
          const target = TextSelection.near($mediaBefore, -1);
          dispatch(state.tr.setSelection(target).scrollIntoView());
        }
        return true;
      }
    }

    // —— 3. 当前块 indent>0 → 减一级缩进 ——
    const curIndent = (block.attrs.indent as number | undefined) ?? 0;
    if (curIndent > 0) {
      if (dispatch) {
        const pos = $from.before($from.depth);
        dispatch(state.tr.setNodeMarkup(pos, null, { ...block.attrs, indent: curIndent - 1 }));
      }
      return true;
    }

    // —— 4. 标题 → 降级为正文段(保留文字)——
    if (blockType === 'heading') {
      const para = state.schema.nodes.paragraph;
      if (para) return setBlockType(para)(state, dispatch);
    }

    // —— 5. 列表项 → 退出列表(liftListItem)——
    const listItem = state.schema.nodes.listItem;
    const taskItem = state.schema.nodes.taskItem;
    if (listItem && ancestorDepthOfType(state, 'listItem') >= 0) {
      if (liftListItem(listItem)(state, dispatch)) return true;
    }
    if (taskItem && ancestorDepthOfType(state, 'taskItem') >= 0) {
      if (liftListItem(taskItem)(state, dispatch)) return true;
    }

    // —— 6. 容器内、该层首块 → 退出容器(lift);tableCell → 硬墙 noop ——
    // 最近的「真容器」祖先(跳过结构性 list 外壳;cell 单独判)。
    for (let d = $from.depth - 1; d >= 1; d--) {
      const node = $from.node(d);
      const name = node.type.name;
      if (STRUCTURAL_LIST.has(name)) continue; // list 外壳已由 step 5 处理
      const nodeMeta = metaLookup(name);
      if (nodeMeta?.isCellLike) {
        // tableCell:硬墙,不退出、不跨 cell、不删表格
        return true;
      }
      if (nodeMeta?.isContainer) {
        // column / columnList:Backspace 暂由现有 column-list keymap 处理(删空列 / 解散),
        // 本链不接管,放行(Phase 2 不动 column 退格,避免与 column-collapse 冲突;后续统一)。
        if (name === 'column' || name === 'columnList') break;
        // 必须是该容器的首个直接子块(光标块沿路径在该层 index 0)才退出
        const indexInContainer = $from.index(d);
        if (indexInContainer === 0) {
          // lift:把当前块提出容器一层(PM lift 命令逐层上提,符合「逐块退/到顶级再合并」)
          if (lift(state, dispatch)) return true;
        }
        break; // 命中最近容器层即停(不再向外找)
      }
      // 非容器、非 cell 的中间层(理论少见)→ 继续向外
    }

    // —— 7. 与上一块合并 ——
    // 仅对「普通 paragraph」主动接管合并;codeBlock / math-block / 其它特殊块放行,
    // 由各自 keymap(如 code-block 空块→段落)+ baseKeymap 处理,避免抢掉它们的退格。
    if (blockType === 'paragraph') {
      // **只用 joinTextblockBackward**:它把当前段文字并入上方最近 textblock 的末尾
      // (普通段直接合并;上方是列表 → 并入列表最后一项段落末尾),段落消失、不产生新列表项。
      //
      // **不能用 joinBackward**:它对「段落 + 上方列表」的默认行为是把段落**裹进列表变成
      // 新列表项**(出现列表符号),与「退出列表」打架 → 反复出现/消失列表符号(2026-06-08 bug)。
      if (joinTextblockBackward(state, dispatch)) return true;
    }
    // 其它情形(特殊块 / 已是文档首块无可合并)→ 放行
    return false;
  };
}
