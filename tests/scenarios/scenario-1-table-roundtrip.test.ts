/**
 * Scenario 1: 新建 note → 插入 GFM 表格 → dissect → mock storage → assemble → round-trip
 *
 * 5A §6.3 场景 1 字面自动化:验 table 内 cell 顺序保留 + rowIndex/colIndex 重建.
 */
import { describe, it, expect } from 'vitest';
import { dissectPmDoc } from '@platform/main/note/dissect-pm-doc';
import { assemblePmDoc } from '@platform/main/note/assemble-pm-doc';
import { mockStorage } from '../mocks/storage-mock';
import type { PmPayload, Atom } from '@semantic/types';

describe('Scenario 1 — GFM 表格 round-trip (5A §6.3)', () => {
  it('3x3 table 字面 dissect → 写 storage → assemble → 与原 doc cells 顺序一致', async () => {
    // 1. 构造 PM doc 含 3x3 表格 + 顶层 heading
    const cellNode = (id: string, text: string): PmPayload => ({
      type: 'tableCell',
      attrs: { id },
      content: [
        {
          type: 'paragraph',
          attrs: { id: `${id}-p` },
          content: [{ type: 'text', text }],
        },
      ],
    });
    const row = (ids: string[][]): PmPayload => ({
      type: 'tableRow',
      content: ids.map(([id, t]) => cellNode(id, t)),
    });
    const table: PmPayload = {
      type: 'table',
      attrs: { id: 't1' },
      content: [
        row([
          ['c00', 'A1'],
          ['c01', 'B1'],
          ['c02', 'C1'],
        ]),
        row([
          ['c10', 'A2'],
          ['c11', 'B2'],
          ['c12', 'C2'],
        ]),
        row([
          ['c20', 'A3'],
          ['c21', 'B3'],
          ['c22', 'C3'],
        ]),
      ],
    };
    const heading: PmPayload = {
      type: 'heading',
      attrs: { id: 'h1', level: 1 },
      content: [{ type: 'text', text: 'Title' }],
    };
    const doc: PmPayload = { type: 'doc', content: [heading, table] };

    // 2. dissect
    const containerId = 'container-1';
    const result = dissectPmDoc(containerId, doc);

    // 3. 写 mock storage (container + blocks + 边)
    await mockStorage.putAtom<'pm'>({
      id: containerId,
      payload: { domain: 'pm', payload: { type: 'doc', content: [] } } as Atom<'pm'>,
    });
    for (const b of result.blocks) {
      await mockStorage.putAtom<'pm'>({
        id: b.id,
        payload: { domain: 'pm', payload: b.payload },
      });
    }
    for (const e of result.belongsEdges) {
      await mockStorage.putEdge({
        predicate: 'user:krig:belongsToNote',
        subject: { kind: 'atom', atomId: e.subjectId },
        object: { kind: 'atom', atomId: e.objectId },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });
    }
    for (const e of result.nextSiblingEdges) {
      await mockStorage.putEdge({
        predicate: 'user:krig:nextSibling',
        subject: { kind: 'atom', atomId: e.subjectId },
        object: { kind: 'atom', atomId: e.objectId },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });
    }
    for (const e of result.childOfEdges) {
      await mockStorage.putEdge({
        predicate: 'user:krig:childOf',
        subject: { kind: 'atom', atomId: e.subjectId },
        object: { kind: 'atom', atomId: e.objectId },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });
    }

    // 4. assemble
    const assembled = await assemblePmDoc(containerId);
    expect(assembled).toBeTruthy();
    expect(assembled!.type).toBe('doc');

    // 5. 验顶层: heading + table 各 1
    expect(assembled!.content).toHaveLength(2);
    expect(assembled!.content![0].type).toBe('heading');
    expect(assembled!.content![1].type).toBe('table');

    // 6. table 行/列字面顺序与原 doc 一致
    const reTable = assembled!.content![1];
    expect(reTable.content).toHaveLength(3);
    for (let r = 0; r < 3; r++) {
      expect(reTable.content![r].type).toBe('tableRow');
      const rowCells = reTable.content![r].content!;
      expect(rowCells).toHaveLength(3);
      const texts = rowCells.map((cell) => cell.content![0].content![0].text);
      const expected = [
        ['A1', 'B1', 'C1'],
        ['A2', 'B2', 'C2'],
        ['A3', 'B3', 'C3'],
      ][r];
      expect(texts).toEqual(expected);
    }
  });
});
