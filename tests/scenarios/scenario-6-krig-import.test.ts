/**
 * Scenario 6: KRIG_IMPORT batch → krigBatchToAtoms → createNotesBatch → 验 storage
 *
 * 5A §6.3 场景 6 字面自动化:验 1 章节 + table 嵌套 → 写入 storage 字面边集合正确.
 */
import { describe, it, expect } from 'vitest';
import { krigBatchToAtoms } from '@capabilities/content-ingest/internal/krig-batch-to-atoms';
import { createNotesBatch } from '@platform/main/note/capability-impl';
import { mockStorage } from '../mocks/storage-mock';

describe('Scenario 6 — KRIG_IMPORT → atoms → createNote → storage', () => {
  it('单章节 + table → 1 container + table atom + cells + childOf 边', async () => {
    const batch = {
      type: 'KRIG_IMPORT',
      bookName: 'TestBook',
      chapters: [
        {
          title: 'Chapter 1',
          bookName: 'TestBook',
          pageStart: 1,
          pageEnd: 2,
          pages: [
            {
              pageNumber: 1,
              atoms: [
                {
                  type: 'paragraph',
                  content: { children: [{ type: 'text', text: 'hello world' }] },
                },
                {
                  type: 'table',
                  content: {
                    tiptapContent: [
                      {
                        type: 'tableRow',
                        content: [
                          {
                            type: 'tableCell',
                            attrs: {},
                            content: [
                              {
                                type: 'paragraph',
                                content: [{ type: 'text', text: 'A' }],
                              },
                            ],
                          },
                          {
                            type: 'tableCell',
                            attrs: {},
                            content: [
                              {
                                type: 'paragraph',
                                content: [{ type: 'text', text: 'B' }],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    // 1. krigBatchToAtoms
    const { chapters } = await krigBatchToAtoms(batch);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe('Chapter 1');
    expect(chapters[0].atoms.length).toBeGreaterThan(0);

    // table atom + cell drafts 字面存在
    const types = chapters[0].atoms.map((a) => a.payload.payload.type);
    expect(types).toContain('table');
    expect(types).toContain('tableCell');

    // 2. createNotesBatch
    const result = await createNotesBatch({
      items: [
        {
          atoms: chapters[0].atoms,
          folderId: null,
          titleHint: chapters[0].title,
        },
      ],
    });
    expect(result.failures).toEqual([]);
    expect(result.notes).toHaveLength(1);

    // 3. 验 storage: container (1) + atoms 数 ≥ 1
    const containerCount = [...mockStorage._atoms.values()].filter((a) => {
      const p = a.payload.payload;
      return p.type === 'doc';
    }).length;
    expect(containerCount).toBe(1);

    // Decision 028:零结构边。belongsToNote / childOf / nextSibling 不再写。
    const structuralEdges = [...mockStorage._edges.values()].filter((e) =>
      ['user:krig:belongsToNote', 'user:krig:childOf', 'user:krig:nextSibling'].includes(
        e.predicate,
      ),
    );
    expect(structuralEdges).toHaveLength(0);

    // 结构靠属性:每 block atom noteId = container;cell 的 parentId 指 table。
    const containerId = result.notes[0].id;
    const blockAtoms = [...mockStorage._atoms.values()].filter((a) => a.id !== containerId);
    expect(blockAtoms.length).toBe(chapters[0].atoms.length);
    expect(
      blockAtoms.every(
        (a) => (a.payload.payload as { attrs?: { noteId?: string } }).attrs?.noteId === containerId,
      ),
    ).toBe(true);
    const tableIds = new Set(
      blockAtoms.filter((a) => a.payload.payload.type === 'table').map((a) => a.id),
    );
    const cells = blockAtoms.filter((a) => a.payload.payload.type === 'tableCell');
    expect(cells.length).toBeGreaterThanOrEqual(2);
    expect(
      cells.every((a) =>
        tableIds.has((a.payload.payload as { attrs?: { parentId?: string } }).attrs?.parentId ?? ''),
      ),
    ).toBe(true);

    // hasNoteView marker 1 条(非结构边,保留)
    const hasView = [...mockStorage._edges.values()].filter(
      (e) => e.predicate === 'user:krig:hasNoteView',
    );
    expect(hasView).toHaveLength(1);
  });
});
