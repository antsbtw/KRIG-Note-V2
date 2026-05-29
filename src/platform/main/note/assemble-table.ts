/**
 * assemble-table — 由扁平 cells 重建 table.content = [tableRow, ...] (5B Stage 4)
 *
 * 决议依据:
 * - 5A 拍板: table 是 atom; tableRow 不是 atom; row 信息走 cell.attrs.rowIndex/colIndex
 * - 5A §5.1 wrapTableCells 算法 (v1 简化版替换)
 * - 5B Q2 选项 B: rowIndex/colIndex 由 dissect 期注入 (字面消费方就是本算法)
 * - 5B Q4 选项 A: 单一 rowIndex namespace, header/cell 共享 (assemble 按 rowIndex 升序排序, 不分类)
 *
 * 算法 (字面 5A §5.1):
 *  1. 按 cell.attrs.rowIndex 分桶 (Map<rowIdx, cells[]>)
 *  2. 每桶按 cell.attrs.colIndex 升序排序
 *  3. 按 rowIdx 升序输出 tableRow 包装
 *
 * 容错:
 *  - rowIndex/colIndex 缺失 (老数据 / migration 前): 字面 fallback rowIndex=0, colIndex=已见过的同 row cell 数
 *  - rowIndex/colIndex 同位置重复: 字面保留先到, 后到 console.warn (5A §5.3 提示)
 *  - 整 table 无 cell: 返回 [] (空 table content, assemble 主流程上层 schema 校验)
 */

import type { PmPayload } from '@semantic/types';
import { stripAssemblyHints } from './assemble-pm-doc-helpers';

interface CellAttrs {
  rowIndex?: number;
  colIndex?: number;
  [key: string]: unknown;
}

export function assembleTable(cells: PmPayload[]): PmPayload[] {
  if (cells.length === 0) return [];

  // 按 rowIndex 分桶
  const byRow = new Map<number, Array<{ cell: PmPayload; colIndex: number }>>();
  for (const cell of cells) {
    const attrs = (cell.attrs ?? {}) as CellAttrs;
    const rowIdx = typeof attrs.rowIndex === 'number' ? attrs.rowIndex : 0;
    const colIdx = typeof attrs.colIndex === 'number' ? attrs.colIndex : 0;
    if (!byRow.has(rowIdx)) byRow.set(rowIdx, []);
    byRow.get(rowIdx)!.push({ cell: stripAssemblyHints(cell), colIndex: colIdx });
  }

  // 行号升序 + 行内 colIndex 升序
  const sortedRowIdxs = [...byRow.keys()].sort((a, b) => a - b);
  const rows: PmPayload[] = [];
  for (const rowIdx of sortedRowIdxs) {
    const bucket = byRow.get(rowIdx)!;
    bucket.sort((a, b) => a.colIndex - b.colIndex);

    // 字面检测同位置 (rowIdx, colIdx) 重复 (后到一个 console.warn 提示)
    const seenColIdx = new Set<number>();
    const cellsInRow: PmPayload[] = [];
    for (const entry of bucket) {
      if (seenColIdx.has(entry.colIndex)) {
        console.warn(
          `[assemble-table] duplicate cell at row=${rowIdx} col=${entry.colIndex}; ` +
            `keeping first, dropping subsequent (5B §节 4 Stage 4 fallback)`,
        );
        continue;
      }
      seenColIdx.add(entry.colIndex);
      cellsInRow.push(entry.cell);
    }

    rows.push({
      type: 'tableRow',
      content: cellsInRow,
    });
  }

  return rows;
}
