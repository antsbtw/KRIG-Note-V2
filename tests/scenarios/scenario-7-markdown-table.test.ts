/**
 * Scenario 7: markdown → markdownToAtoms → createNotesBatch → 验 storage 写入
 *
 * 5A §6.3 场景 7 字面自动化:含 GFM 表格的 markdown 端到端走通.
 */
import { describe, it, expect } from 'vitest';
import { markdownToAtoms } from '@capabilities/content-ingest/internal/markdown-to-atoms';
import { createNotesBatch } from '@platform/main/note/capability-impl';
import { mockStorage } from '../mocks/storage-mock';

describe('Scenario 7 — markdown 含 GFM 表格 → atoms → createNote', () => {
  it('heading + paragraph + table → atoms → storage 字面写入', async () => {
    const md = [
      '# Test Note',
      '',
      'intro paragraph',
      '',
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      '| 3 | 4 |',
    ].join('\n');

    const { atoms, warnings } = await markdownToAtoms(md, { titleHint: 'Test Note' });
    expect(warnings).toEqual([]);
    expect(atoms.length).toBeGreaterThan(0);

    const types = atoms.map((a) => a.payload.payload.type);
    expect(types).toContain('table');
    expect(types).toContain('tableCell');

    const result = await createNotesBatch({
      items: [{ atoms, folderId: null, titleHint: 'Test Note' }],
    });
    expect(result.failures).toEqual([]);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].title).toBe('Test Note');

    // table 的 childOf 边 = cell 数
    const tableDrafts = atoms.filter((a) => a.payload.payload.type === 'table');
    expect(tableDrafts).toHaveLength(1);
    const cellDrafts = atoms.filter(
      (a) =>
        a.payload.payload.type === 'tableCell' ||
        a.payload.payload.type === 'tableHeader',
    );
    expect(cellDrafts.length).toBe(6); // 2 header + 4 cell

    const childOf = [...mockStorage._edges.values()].filter(
      (e) => e.predicate === 'user:krig:childOf',
    );
    expect(childOf.length).toBe(cellDrafts.length);

    // 字面 belongsToNote 每 draft 1 条
    const belongs = [...mockStorage._edges.values()].filter(
      (e) => e.predicate === 'user:krig:belongsToNote',
    );
    expect(belongs.length).toBe(atoms.length);
  });
});
