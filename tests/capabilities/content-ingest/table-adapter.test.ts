/**
 * Unit test: tableAdapter (5B Stage 7 重做)
 *
 * 用例:
 *  1. 3x3 table → 1 tableDraft + 9 cellDrafts + rowIndex/colIndex 顺序
 *  2. tableHeader 混合 (首行 header + 后续 cell) → header 也有 rowIndex/colIndex (单一 namespace)
 *  3. 空 table → 仅 tableDraft, cellDrafts = []
 *  4. tableTmpId 透传 (caller 传 tmpId 字面就是 tableDraft.tmpId)
 */
import { describe, it, expect } from 'vitest';
import { tableAdapter } from '@capabilities/content-ingest/internal/table-adapter';
import type { PmPayload } from '@semantic/types';

let counter = 0;
const allocTmpId = () => `tmp-${counter++}`;

function cell(text: string): PmPayload {
  return {
    type: 'tableCell',
    attrs: {},
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

function header(text: string): PmPayload {
  return {
    type: 'tableHeader',
    attrs: {},
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

describe('tableAdapter', () => {
  it('3x3 table → 1 tableDraft + 9 cellDrafts + rowIndex/colIndex 顺序', () => {
    counter = 0;
    const row = (a: string, b: string, c: string): PmPayload => ({
      type: 'tableRow',
      content: [cell(a), cell(b), cell(c)],
    });
    const table: PmPayload = {
      type: 'table',
      attrs: { id: 't1' },
      content: [row('00', '01', '02'), row('10', '11', '12'), row('20', '21', '22')],
    };
    const { tableDraft, cellDrafts } = tableAdapter({
      tablePmNode: table,
      tableTmpId: 'table-tmp',
      allocTmpId,
    });
    expect(tableDraft.tmpId).toBe('table-tmp');
    expect(tableDraft.payload.payload.type).toBe('table');
    expect(tableDraft.payload.payload.content).toEqual([]);
    expect(cellDrafts).toHaveLength(9);

    for (const cd of cellDrafts) {
      expect(cd.parentTmpId).toBe('table-tmp');
      expect(cd.payload.domain).toBe('pm');
      expect(cd.payload.payload.type).toBe('tableCell');
      const attrs = cd.payload.payload.attrs as Record<string, unknown>;
      expect(typeof attrs.rowIndex).toBe('number');
      expect(typeof attrs.colIndex).toBe('number');
    }

    // 顺序检查 (字面遍历 row-major)
    const indexes = cellDrafts.map((cd) => {
      const a = cd.payload.payload.attrs as Record<string, number>;
      return [a.rowIndex, a.colIndex];
    });
    expect(indexes).toEqual([
      [0, 0], [0, 1], [0, 2],
      [1, 0], [1, 1], [1, 2],
      [2, 0], [2, 1], [2, 2],
    ]);
  });

  it('tableHeader 混合 (首行 header + 后续 cell) → header 也有 rowIndex/colIndex (Q4 单一 namespace)', () => {
    counter = 0;
    const table: PmPayload = {
      type: 'table',
      attrs: { id: 't' },
      content: [
        { type: 'tableRow', content: [header('H1'), header('H2')] },
        { type: 'tableRow', content: [cell('a'), cell('b')] },
      ],
    };
    const { cellDrafts } = tableAdapter({
      tablePmNode: table,
      tableTmpId: 't-tmp',
      allocTmpId,
    });
    expect(cellDrafts).toHaveLength(4);
    // 首两个 header
    expect(cellDrafts[0].payload.payload.type).toBe('tableHeader');
    expect(cellDrafts[1].payload.payload.type).toBe('tableHeader');
    // 后两个 cell
    expect(cellDrafts[2].payload.payload.type).toBe('tableCell');
    expect(cellDrafts[3].payload.payload.type).toBe('tableCell');
    // header rowIndex=0, cell rowIndex=1 (单一 namespace)
    const a0 = cellDrafts[0].payload.payload.attrs as Record<string, number>;
    const a3 = cellDrafts[3].payload.payload.attrs as Record<string, number>;
    expect(a0.rowIndex).toBe(0);
    expect(a3.rowIndex).toBe(1);
    expect(a3.colIndex).toBe(1);
  });

  it('空 table → 仅 tableDraft, cellDrafts = []', () => {
    counter = 0;
    const table: PmPayload = { type: 'table', attrs: { id: 't' }, content: [] };
    const { tableDraft, cellDrafts } = tableAdapter({
      tablePmNode: table,
      tableTmpId: 't0',
      allocTmpId,
    });
    expect(tableDraft.tmpId).toBe('t0');
    expect(cellDrafts).toEqual([]);
  });

  it('tableTmpId 透传 (caller 传的 tmpId 字面就是 tableDraft.tmpId)', () => {
    counter = 0;
    const table: PmPayload = {
      type: 'table',
      attrs: {},
      content: [{ type: 'tableRow', content: [cell('a')] }],
    };
    const { tableDraft, cellDrafts } = tableAdapter({
      tablePmNode: table,
      tableTmpId: 'custom-tmp-id',
      allocTmpId,
    });
    expect(tableDraft.tmpId).toBe('custom-tmp-id');
    expect(cellDrafts[0].parentTmpId).toBe('custom-tmp-id');
  });
});
