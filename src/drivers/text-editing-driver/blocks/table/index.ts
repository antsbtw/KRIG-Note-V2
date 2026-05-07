/**
 * table 系列 — 公开导出(L5-B3.7)
 *
 * 4 个 BlockSpec + 业务命令 + 库 re-export。
 *
 * 后续 sub-stage(L5-B3.7.1)接 V2 floating-toolbar / context-menu registry 时,
 * 从这里拿 commands;NoteEditor 注册 schema 时拿 4 个 BlockSpec。
 */

export {
  tableSpec,
  tableRowSpec,
  tableCellSpec,
  tableHeaderSpec,
  type CellAlign,
} from './spec';

export {
  // V2 自定义命令
  insertTable,
  duplicateRow,
  duplicateColumn,
  duplicateSelectedCells,
  setCellAlign,
  // re-export 自 prosemirror-tables(库内置)
  addColumnBefore,
  addColumnAfter,
  deleteColumn,
  addRowBefore,
  addRowAfter,
  deleteRow,
  mergeCells,
  splitCell,
  deleteTable,
  goToNextCell,
} from './commands';
