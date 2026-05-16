/**
 * table commands — 表格业务命令(L5-B3.7)
 *
 * V1 → V2 直迁:src/plugins/note/blocks/table/commands.ts
 *
 * V2 改造:
 * - V1 `schema.nodes.textBlock` → V2 `schema.nodes.paragraph`(PM 标准命名,L6 拆分后)
 * - 其他不动
 *
 * 命令清单(全 export — 后续 sub-stage L5-B3.7.1 接 V2 floating-toolbar / context-menu
 * registry 暴露这些命令):
 * - insertTable(rows, cols)
 * - duplicateRow / duplicateColumn / duplicateSelectedCells
 * - setCellAlign
 *
 * 库内置命令(从 prosemirror-tables export 不重复定义,直接 re-export 给上层用):
 * - addColumnBefore / addColumnAfter / deleteColumn
 * - addRowBefore / addRowAfter / deleteRow
 * - mergeCells / splitCell
 * - deleteTable / goToNextCell
 */

import { TextSelection, type Command, type Transaction } from 'prosemirror-state';
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model';
import { selectedRect, CellSelection } from 'prosemirror-tables';
import type { CellAlign } from './spec';

// re-export 库内置命令(集中入口给 view / api / 后续 sub-stage 用)
export {
  deleteColumn,
  addRowBefore,
  addRowAfter,
  deleteRow,
  mergeCells,
  splitCell,
  deleteTable,
  goToNextCell,
} from 'prosemirror-tables';

import {
  addColumnBefore as libAddColumnBefore,
  addColumnAfter as libAddColumnAfter,
} from 'prosemirror-tables';

const DEFAULT_COL_WIDTH = 120;

/**
 * 包装 addColumnBefore / addColumnAfter:库创建新 cell 时 colwidth=null,
 * 会让 prosemirror-tables fixedWidth=false → table 总宽不扩展、邻列被挤压。
 * 包装在库调用后扫描新增列 cell 给它们补默认 colwidth,保 fixedWidth=true。
 *
 * 实现:加列前快照 table 列数 → 调库命令 → 加列后比对找到新加列 idx →
 * setNodeMarkup 给新列每个 cell 写 colwidth=[120]。
 */
function wrapAddColumn(libFn: typeof libAddColumnBefore): Command {
  return (state, dispatch) => {
    if (!libFn(state)) return false; // dry-run 库判定能否执行
    if (!dispatch) return true;

    // 拍快照:操作前 table 的 firstRow childCount = 旧列数
    let oldColCount = -1;
    let tablePos = -1;
    {
      const $from = state.selection.$from;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'table') {
          tablePos = $from.before(d);
          oldColCount = $from.node(d).firstChild?.childCount ?? -1;
          break;
        }
      }
    }
    if (oldColCount < 0 || tablePos < 0) {
      // 找不到 table → 直接调库不补 colwidth(降级)
      libFn(state, dispatch);
      return true;
    }

    // 调库命令(自带 dispatch)— 此处用 wrapper 截获 dispatch 拿到 tr
    const captured: { tr: Transaction | null } = { tr: null };
    libFn(state, (tr: Transaction) => { captured.tr = tr; });
    if (!captured.tr) return true;
    const tr = captured.tr;

    // 比对新 table 找新加列(找哪一列的 cell colwidth=null + 不在旧 idx)
    const newTable = tr.doc.nodeAt(tablePos);
    if (!newTable || newTable.type.name !== 'table') {
      dispatch(tr);
      return true;
    }

    // 给所有 colwidth=null 的列 cell 补 [DEFAULT_COL_WIDTH]
    // (老列已有 colwidth,只补新加的)
    newTable.forEach((row: PMNode, rowOffset: number) => {
      let cellPos = tablePos + 1 + rowOffset + 1; // +1 进 table,+rowOffset,+1 进 row
      row.forEach((cell: PMNode) => {
        if (cell.attrs.colwidth == null) {
          tr.setNodeMarkup(cellPos, undefined, {
            ...cell.attrs,
            colwidth: [DEFAULT_COL_WIDTH],
          });
        }
        cellPos += cell.nodeSize;
      });
    });
    dispatch(tr);
    return true;
  };
}

export const addColumnBefore: Command = wrapAddColumn(libAddColumnBefore);
export const addColumnAfter: Command = wrapAddColumn(libAddColumnAfter);

// ─── 工具:找最近的 block 节点(给 insertTable 替换当前空段落用)──

function findNearestBlock($pos: ResolvedPos): { pos: number; node: PMNode } {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.spec.group === 'block' || d === 1) {
      return { pos: $pos.before(d), node };
    }
  }
  return { pos: $pos.before(1), node: $pos.node(1) };
}

// ─── insertTable ───────────────────────────────────────────

/**
 * 在光标当前 block 位置插入表格(替换该 block)
 *
 * V2 schema:第一行 tableHeader,后续 tableCell;每个 cell 含一个 paragraph
 */
export function insertTable(rows = 3, cols = 3): Command {
  return (state, dispatch) => {
    const schema = state.schema;
    const tableType = schema.nodes.table;
    const rowType = schema.nodes.tableRow;
    const cellType = schema.nodes.tableCell;
    const headerType = schema.nodes.tableHeader;
    const paragraphType = schema.nodes.paragraph;
    if (!tableType || !rowType || !cellType || !headerType || !paragraphType) return false;

    if (dispatch) {
      const { pos: blockStart, node: blockNode } = findNearestBlock(state.selection.$from);
      const blockEnd = blockStart + blockNode.nodeSize;

      // 给每个 cell 设默认 colwidth=[120],让 prosemirror-tables fixedWidth=true,
      // 拖动某列时 table 总宽 = sum(colwidth) 自动扩展,不挤压邻列
      // (用户拍板:table 是富文本,该跟内容撑开,不该挤压)
      const DEFAULT_COL_WIDTH = 120;
      const defaultAttrs = { colwidth: [DEFAULT_COL_WIDTH] };

      // 第一行 header
      const headerCells = Array.from({ length: cols }, () =>
        headerType.create(defaultAttrs, [paragraphType.create()]),
      );
      const headerRow = rowType.create(null, headerCells);

      // body 行
      const bodyRows = Array.from({ length: rows - 1 }, () => {
        const cells = Array.from({ length: cols }, () =>
          cellType.create(defaultAttrs, [paragraphType.create()]),
        );
        return rowType.create(null, cells);
      });

      const table = tableType.create(null, [headerRow, ...bodyRows]);
      const tr = state.tr.replaceWith(blockStart, blockEnd, table);

      // 光标进第一个 header cell 内的 paragraph
      // blockStart 是 table 起点,+1 进 table,+1 进 row,+1 进 header,+1 进 paragraph,= +4
      try {
        tr.setSelection(TextSelection.create(tr.doc, blockStart + 4));
      } catch {
        /* ignore — pos 计算可能边界场景出问题 */
      }
      dispatch(tr);
    }
    return true;
  };
}

// ─── duplicateRow ───────────────────────────────────────────

/** 复制当前 selection 所在行,插入到下方 */
export const duplicateRow: Command = (state, dispatch) => {
  const rect = (() => {
    try {
      return selectedRect(state);
    } catch {
      return null;
    }
  })();
  if (!rect) return false;

  const schema = state.schema;
  const rowType = schema.nodes.tableRow;
  const cellType = schema.nodes.tableCell;
  const headerType = schema.nodes.tableHeader;
  const { table, tableStart, map } = rect;

  // 找当前行 idx
  const sel = state.selection;
  let rowIdx = -1;
  if (sel instanceof CellSelection) {
    const cellRect = map.findCell(sel.$anchorCell.pos - tableStart);
    rowIdx = cellRect.top;
  } else {
    const $from = sel.$from;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'tableRow') {
        rowIdx = $from.index(d - 1);
        break;
      }
    }
    if (rowIdx < 0) return false;
  }

  if (dispatch) {
    const row = table.child(rowIdx);
    const copiedCells: PMNode[] = [];
    row.forEach((cell) => {
      const targetType = cell.type.name === 'tableHeader' ? headerType : cellType;
      copiedCells.push(targetType.create(cell.attrs, cell.content, cell.marks));
    });
    const newRow = rowType.create(null, copiedCells);

    // 计算插入位置(当前行之后)
    let insertPos = tableStart;
    for (let r = 0; r <= rowIdx; r++) {
      insertPos += table.child(r).nodeSize;
    }
    dispatch(state.tr.insert(insertPos, newRow));
  }
  return true;
};

// ─── duplicateColumn ────────────────────────────────────────

/** 复制当前 selection 所在列,插入到右侧 */
export const duplicateColumn: Command = (state, dispatch) => {
  const rect = (() => {
    try {
      return selectedRect(state);
    } catch {
      return null;
    }
  })();
  if (!rect) return false;

  const schema = state.schema;
  const cellType = schema.nodes.tableCell;
  const headerType = schema.nodes.tableHeader;
  const { table, tableStart, map } = rect;

  const sel = state.selection;
  let colIdx = -1;
  if (sel instanceof CellSelection) {
    const cellRect = map.findCell(sel.$anchorCell.pos - tableStart);
    colIdx = cellRect.left;
  } else {
    const $from = sel.$from;
    for (let d = $from.depth; d > 0; d--) {
      const nodeName = $from.node(d).type.name;
      if (nodeName === 'tableCell' || nodeName === 'tableHeader') {
        colIdx = $from.index(d - 1);
        break;
      }
    }
    if (colIdx < 0) return false;
  }

  if (dispatch) {
    let tr = state.tr;
    // 自下往上处理避免位置失效
    for (let r = table.childCount - 1; r >= 0; r--) {
      const row = table.child(r);
      if (colIdx >= row.childCount) continue;

      const cell = row.child(colIdx);
      const targetType = cell.type.name === 'tableHeader' ? headerType : cellType;
      // 新列继承原列 colwidth(保留 fixedWidth=true → table 总宽自动扩展)
      const newCell = targetType.create(
        { ...cell.attrs },
        cell.content,
        cell.marks,
      );

      // 计算 cell 在文档中的位置
      let rowStart = tableStart;
      for (let ri = 0; ri < r; ri++) rowStart += table.child(ri).nodeSize;
      let cellPos = rowStart + 1; // +1 进 row
      for (let ci = 0; ci <= colIdx; ci++) cellPos += row.child(ci).nodeSize;

      tr = tr.insert(tr.mapping.map(cellPos), newCell);
    }
    dispatch(tr);
  }
  return true;
};

// ─── duplicateSelectedCells ─────────────────────────────────

/** CellSelection 时复制选中矩形,插入为下方新行 */
export const duplicateSelectedCells: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!(sel instanceof CellSelection)) return false;

  const rect = (() => {
    try {
      return selectedRect(state);
    } catch {
      return null;
    }
  })();
  if (!rect) return false;

  const schema = state.schema;
  const rowType = schema.nodes.tableRow;
  const cellType = schema.nodes.tableCell;
  const paragraphType = schema.nodes.paragraph;
  const { table, tableStart, map } = rect;

  const selRect = map.rectBetween(
    sel.$anchorCell.pos - tableStart,
    sel.$headCell.pos - tableStart,
  );

  if (dispatch) {
    const newRows: PMNode[] = [];
    const totalCols = map.width;

    for (let r = selRect.top; r < selRect.bottom; r++) {
      const cells: PMNode[] = [];
      for (let c = 0; c < totalCols; c++) {
        if (c >= selRect.left && c < selRect.right) {
          const cellPos = map.map[r * map.width + c];
          const cell = table.nodeAt(cellPos);
          if (cell) {
            cells.push(
              cellType.create(
                {
                  colspan: cell.attrs.colspan,
                  rowspan: cell.attrs.rowspan,
                  // 继承原 cell colwidth(保留列宽对齐 + fixedWidth=true)
                  colwidth: cell.attrs.colwidth,
                },
                cell.content,
                cell.marks,
              ),
            );
          }
        } else {
          // 占位 cell:colwidth 从第一行同列 cell 取(保对齐)
          const firstRowCell = table.firstChild?.maybeChild(c);
          const colwidth = (firstRowCell?.attrs.colwidth as number[] | null) ?? null;
          cells.push(cellType.create({ colwidth }, [paragraphType.create()]));
        }
      }
      newRows.push(rowType.create(null, cells));
    }

    let insertPos = tableStart;
    for (let r = 0; r < selRect.bottom; r++) {
      insertPos += table.child(r).nodeSize;
    }
    dispatch(state.tr.insert(insertPos, newRows));
  }
  return true;
};

// ─── setCellAlign ───────────────────────────────────────────

/**
 * 设置 cell.attrs.align(left/center/right/justify/null 清除)
 *
 * 作用范围:
 * - CellSelection 时:选中的所有 cells
 * - 普通光标在 cell 内:仅该 cell
 */
export function setCellAlign(align: CellAlign | null): Command {
  return (state, dispatch) => {
    const sel = state.selection;
    const targets: { pos: number; node: PMNode }[] = [];

    if (sel instanceof CellSelection) {
      sel.forEachCell((cell, pos) => {
        targets.push({ pos, node: cell });
      });
    } else {
      const $from = sel.$from;
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
          targets.push({ pos: $from.before(d), node });
          break;
        }
      }
    }

    if (targets.length === 0) return false;

    // 全部已经是这个 align 不做操作
    const allSame = targets.every(
      (t) => ((t.node.attrs.align as string | null) ?? null) === align,
    );
    if (allSame) return true;

    if (dispatch) {
      const tr = state.tr;
      for (const { pos, node } of targets) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, align });
      }
      dispatch(tr);
    }
    return true;
  };
}
