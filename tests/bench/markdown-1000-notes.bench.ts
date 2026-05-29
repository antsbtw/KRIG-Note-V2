/**
 * Stage 9 性能压测 — markdown 1000 篇批量 import + listNotes cold-start
 *
 * 5A §6.3 场景 8 字面.字面跑 1 次 iteration,字面打印总时长 + ops/sec.
 *
 * 三个 bench:
 *  1. markdownToAtoms 1000 次 — 字面只测 md → atoms 时长
 *  2. createNotesBatch 1000 items 单事务 — 字面只测 storage 写入 (不含 md 解析)
 *  3. listNotes after 1000 — 1000 篇写好后调 listNotes (含 assemblePmDoc 全文重建)
 *
 * 注:bench 字面不能并行 (storage mock 单例,串行更准).
 */
import { bench, describe, beforeAll } from 'vitest';
import { markdownToAtoms } from '@capabilities/content-ingest/internal/markdown-to-atoms';
import { createNotesBatch, listNotes } from '@platform/main/note/capability-impl';
import { mockStorage } from '../mocks/storage-mock';
import type { PmAtomDraft } from '@semantic/types';

const SAMPLE_MD = '# Test\n\nparagraph 1\n\nparagraph 2';

describe('Stage 9 bench — markdown 1000 batch + listNotes', () => {
  bench(
    'markdownToAtoms 1000 (纯 md → atoms 解析)',
    async () => {
      for (let i = 0; i < 1000; i++) {
        await markdownToAtoms(`${SAMPLE_MD} #${i}`, { titleHint: `Note ${i}` });
      }
    },
    { iterations: 1 },
  );

  bench(
    'createNotesBatch 1000 items in single tx (纯 storage 写入)',
    async () => {
      mockStorage._reset();
      const items = [];
      for (let i = 0; i < 1000; i++) {
        const { atoms } = await markdownToAtoms(`${SAMPLE_MD} #${i}`, {
          titleHint: `Note ${i}`,
        });
        items.push({ atoms: atoms as PmAtomDraft[], folderId: null, titleHint: `Note ${i}` });
      }
      await createNotesBatch({ items, broadcastMode: 'final' });
    },
    { iterations: 1 },
  );

  describe('listNotes after 1000 notes (cold-start)', () => {
    beforeAll(async () => {
      mockStorage._reset();
      const items = [];
      for (let i = 0; i < 1000; i++) {
        const { atoms } = await markdownToAtoms(`${SAMPLE_MD} #${i}`, {
          titleHint: `Note ${i}`,
        });
        items.push({ atoms: atoms as PmAtomDraft[], folderId: null, titleHint: `Note ${i}` });
      }
      await createNotesBatch({ items, broadcastMode: 'final' });
    });

    bench(
      'listNotes after 1000 (含 assemblePmDoc 全文重建)',
      async () => {
        await listNotes();
      },
      { iterations: 1 },
    );
  });
});
