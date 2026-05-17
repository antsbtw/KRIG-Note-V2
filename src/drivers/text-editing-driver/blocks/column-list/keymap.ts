/**
 * columnList keymap — column 内 Enter / Backspace 特化
 *
 * 复用 PM 现成 helper(用户拍板):
 * - 只处理 column 内才有的两个边界场景,失败 return false 让 PM baseKeymap 接力
 * - 不重写 splitBlock / joinBackward 等通用行为
 *
 * 两个场景:
 *  1. Enter 在 column 末段且当前段为空 → 退出 columnList,在其后插入空 paragraph
 *  2. Backspace 在 column 首段段首,且该 column 只剩一个空段 → 删除该 column
 *     - 删后剩 ≥2 列:重置 width = null(等宽)
 *     - 删后剩 1 列:解散 columnList,内容平铺到原位
 *
 * 注:column-collapse-plugin 也会处理"column 变空"场景,但走 appendTransaction
 * 后处理(用户输入完之后判定);本 keymap 处理的是 Backspace 瞬时主动操作。
 */

import { keymap } from 'prosemirror-keymap';
import type { Command } from 'prosemirror-state';
import type { ResolvedPos } from 'prosemirror-model';
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';

/** 找祖先中 column / columnList 的 depth(-1 = 不在 column 内) */
function findColumnContext($from: ResolvedPos): { columnDepth: number; columnListDepth: number } | null {
  for (let d = $from.depth; d >= 1; d--) {
    if ($from.node(d).type.name === 'column') {
      const parentDepth = d - 1;
      if (parentDepth >= 0 && $from.node(parentDepth).type.name === 'columnList') {
        return { columnDepth: d, columnListDepth: parentDepth };
      }
    }
  }
  return null;
}

/**
 * Enter: column 内末段且当前段空 → 退出 columnList
 */
const exitColumnListOnEnter: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty) return false;

  const ctx = findColumnContext($from);
  if (!ctx) return false;

  const column = $from.node(ctx.columnDepth);
  const currentBlock = $from.parent;

  // 必须当前段为空,且是 column 的最后一个 child
  if (currentBlock.content.size !== 0) return false;
  const isLastChild = $from.indexAfter(ctx.columnDepth) === column.childCount;
  if (!isLastChild) return false;
  // column 只剩这一个空段时,把退出工作让给 column-collapse(它会解散 column)
  // 否则会重复操作。这里只处理"column 有多内容时末尾追空段 Enter 跳出"。
  if (column.childCount <= 1) return false;

  if (dispatch) {
    const columnList = $from.node(ctx.columnListDepth);
    const columnListEnd = $from.before(ctx.columnListDepth) + columnList.nodeSize;
    const paragraphType = state.schema.nodes.paragraph;

    const tr: Transaction = state.tr;
    // 删除 column 末尾的空段
    const blockStart = $from.before($from.depth);
    tr.delete(blockStart, blockStart + currentBlock.nodeSize);
    // 在 columnList 之后插入空 paragraph
    const insertPos = tr.mapping.map(columnListEnd);
    tr.insert(insertPos, paragraphType.create());
    tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
    dispatch(tr);
  }
  return true;
};

/**
 * Backspace: column 首段段首且该 column 只剩一个空段 → 删该 column
 *
 * - 剩 ≥2 列:删该 column,其余列 width 重置为 null
 * - 剩 1 列:解散 columnList,survival column 内容平铺(替换 columnList 节点)
 *
 * 注:childCount<=1 表示"空 column"特征(column 只能有一个空 paragraph);
 *    若 column 内有真实内容,joinBackward 会被 isolating 挡住自然走到段内 noop。
 */
const deleteEmptyColumnOnBackspace: Command = (state, dispatch) => {
  const { $from, empty } = state.selection;
  if (!empty) return false;
  // 段首才触发
  if ($from.parentOffset !== 0) return false;

  const ctx = findColumnContext($from);
  if (!ctx) return false;

  const column = $from.node(ctx.columnDepth);
  // 只在 column 是 "1 个空段" 时介入(防误删有内容的列)
  if (column.childCount !== 1) return false;
  const onlyChild = column.child(0);
  if (onlyChild.content.size !== 0) return false;
  // 必须是 column 的首段(否则上一段 join 即可,无需删 column)
  if ($from.index(ctx.columnDepth) !== 0) return false;

  if (dispatch) {
    deleteColumnAt(state, ctx.columnListDepth, ctx.columnDepth, $from)(state, dispatch);
  }
  return true;
};

/**
 * 删除 column 节点:
 * - 剩 ≥2 列:tr.delete column + 同 tr 把剩余列 width 设 null + columns attr 更新
 * - 剩 1 列:tr.replaceWith columnList → survival column 内容(content fragment)
 */
function deleteColumnAt(
  _state: EditorState,
  columnListDepth: number,
  columnDepth: number,
  $from: ResolvedPos,
): Command {
  return (state, dispatch) => {
    const columnList = $from.node(columnListDepth);
    const columnListPos = $from.before(columnListDepth);
    const targetColumnPos = $from.before(columnDepth);
    const targetColumn = state.doc.nodeAt(targetColumnPos);
    if (!columnList || !targetColumn || targetColumn.type.name !== 'column') return false;

    const columnIndex = $from.index(columnListDepth);

    if (!dispatch) return true;
    const tr = state.tr;

    // 剩 1 列:解散 columnList,survival column 内容铺到顶层
    if (columnList.childCount <= 2) {
      const survivingIndex = columnIndex === 0 ? 1 : 0;
      const survivingColumn = columnList.child(survivingIndex);
      tr.replaceWith(columnListPos, columnListPos + columnList.nodeSize, survivingColumn.content);
      try {
        tr.setSelection(TextSelection.create(tr.doc, columnListPos + 1));
      } catch {
        /* ignore */
      }
      dispatch(tr);
      return true;
    }

    // 剩 ≥2 列:删 column + 其他列 width 重置 + columns attr 同步
    // 思路:一次 replaceWith 整个 columnList 内容(过滤掉 target,其他 width=null)
    const kept: import('prosemirror-model').Node[] = [];
    for (let i = 0; i < columnList.childCount; i++) {
      if (i === columnIndex) continue;
      const col = columnList.child(i);
      kept.push(col.type.create({ ...col.attrs, width: null }, col.content));
    }
    const newColumnList = columnList.type.create(
      { ...columnList.attrs, columns: kept.length },
      Fragment.from(kept),
    );
    tr.replaceWith(columnListPos, columnListPos + columnList.nodeSize, newColumnList);
    // 光标进剩余第一列首段(columnList+1 → column+1 → para+1 = +3)
    try {
      tr.setSelection(TextSelection.create(tr.doc, columnListPos + 3));
    } catch {
      /* ignore */
    }
    dispatch(tr);
    return true;
  };
}

/** 导出 PM Plugin(driver editor-view-builder 通过 BlockSpec.plugin 收集) */
export function columnListKeymapPlugin() {
  return keymap({
    Enter: exitColumnListOnEnter,
    Backspace: deleteEmptyColumnOnBackspace,
  });
}
