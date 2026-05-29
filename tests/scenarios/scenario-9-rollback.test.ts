/**
 * Scenario 9: KRIG_IMPORT 5 chapter batch all-or-nothing 回滚
 *
 * 5A §6.3 场景 9 字面:第 3 章字面抛错 → 整批 rollback → storage 0 atom.
 */
import { describe, it, expect } from 'vitest';
import { createNotesBatch } from '@platform/main/note/capability-impl';
import { mockStorage } from '../mocks/storage-mock';
import type { PmAtomDraft } from '@semantic/types';

function simpleNoteDrafts(text: string): PmAtomDraft[] {
  return [
    {
      tmpId: 'tmp-0',
      payload: {
        domain: 'pm',
        payload: {
          type: 'paragraph',
          attrs: {},
          content: [{ type: 'text', text }],
        },
      },
    },
  ];
}

describe('Scenario 9 — KRIG_IMPORT 5 chapter all-or-nothing 回滚', () => {
  it('第 3 个 item 字面 putAtom 抛错 → 整批 rollback (0 atom 0 edge)', async () => {
    // 每 item 字面 putAtom 2 次 (container + 1 atom).
    // item 1: calls 1-2
    // item 2: calls 3-4
    // item 3: calls 5-6 → 第 5 次抛错 → 整批 rollback
    mockStorage._failOnPutAtomNthCall = 5;

    const items = [
      { atoms: simpleNoteDrafts('ch1'), folderId: null, titleHint: 'ch1' },
      { atoms: simpleNoteDrafts('ch2'), folderId: null, titleHint: 'ch2' },
      { atoms: simpleNoteDrafts('ch3'), folderId: null, titleHint: 'ch3' },
      { atoms: simpleNoteDrafts('ch4'), folderId: null, titleHint: 'ch4' },
      { atoms: simpleNoteDrafts('ch5'), folderId: null, titleHint: 'ch5' },
    ];

    const result = await createNotesBatch({ items });

    expect(result.notes).toEqual([]);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures[0].rolledBack).toBe(true);

    // 关键:rollback 后 storage 0 atom 0 edge (前 2 item 也字面回滚)
    expect(mockStorage._atoms.size).toBe(0);
    expect(mockStorage._edges.size).toBe(0);
  });

  it('全部 item 成功 → 5 个 container + 5 个 block atom + 完整边集合', async () => {
    const items = [
      { atoms: simpleNoteDrafts('ch1'), folderId: null, titleHint: 'ch1' },
      { atoms: simpleNoteDrafts('ch2'), folderId: null, titleHint: 'ch2' },
      { atoms: simpleNoteDrafts('ch3'), folderId: null, titleHint: 'ch3' },
      { atoms: simpleNoteDrafts('ch4'), folderId: null, titleHint: 'ch4' },
      { atoms: simpleNoteDrafts('ch5'), folderId: null, titleHint: 'ch5' },
    ];
    const result = await createNotesBatch({ items });
    expect(result.failures).toEqual([]);
    expect(result.notes).toHaveLength(5);

    // 5 container + 5 block = 10 atom
    expect(mockStorage._atoms.size).toBe(10);
    // 字面 5 hasNoteView + 5 belongsToNote (无 inFolder / childOf / nextSibling 单 atom 内)
    const edges = [...mockStorage._edges.values()];
    expect(edges.filter((e) => e.predicate === 'user:krig:hasNoteView').length).toBe(5);
    expect(edges.filter((e) => e.predicate === 'user:krig:belongsToNote').length).toBe(5);
  });
});
