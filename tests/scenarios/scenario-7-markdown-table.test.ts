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

    const tableDrafts = atoms.filter((a) => a.payload.payload.type === 'table');
    expect(tableDrafts).toHaveLength(1);
    const cellDrafts = atoms.filter(
      (a) =>
        a.payload.payload.type === 'tableCell' ||
        a.payload.payload.type === 'tableHeader',
    );
    expect(cellDrafts.length).toBe(6); // 2 header + 4 cell

    // Decision 028:零结构边。childOf / belongsToNote 边不再写。
    const structuralEdges = [...mockStorage._edges.values()].filter((e) =>
      ['user:krig:childOf', 'user:krig:belongsToNote', 'user:krig:nextSibling'].includes(
        e.predicate,
      ),
    );
    expect(structuralEdges).toHaveLength(0);

    // 结构靠属性:每个 block atom 带 noteId(= container id);cell 的 parentId 指 table。
    const containerId = result.notes[0].id;
    const blockAtoms = [...mockStorage._atoms.values()].filter((a) => a.id !== containerId);
    expect(blockAtoms.length).toBe(atoms.length);
    expect(
      blockAtoms.every(
        (a) => (a.payload.payload as { attrs?: { noteId?: string } }).attrs?.noteId === containerId,
      ),
    ).toBe(true);
    // 每个 cell 的 parentId 指向某个 table atom
    const tableIds = new Set(
      blockAtoms
        .filter((a) => a.payload.payload.type === 'table')
        .map((a) => a.id),
    );
    const cells = blockAtoms.filter(
      (a) => a.payload.payload.type === 'tableCell' || a.payload.payload.type === 'tableHeader',
    );
    expect(
      cells.every((a) =>
        tableIds.has((a.payload.payload as { attrs?: { parentId?: string } }).attrs?.parentId ?? ''),
      ),
    ).toBe(true);
  });
});
