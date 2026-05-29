/**
 * Scenario 11: markdown → markdownToAtoms → createNotesBatch → assemblePmDoc 整链 round-trip
 *
 * 5B Stage 7 redo 整链端到端验证 — markdown 真路径走 storage,从 storage 反向重建 PM doc.
 *
 * 注:assemble 端字面会包 bulletList wrapper 等结构 (decision 026 §13.8);
 * markdown-to-pm 端字面已经表达这些结构.故 round-trip 类型应一致 (结构性容器
 * 重建后字面与原 markdown 解析出的形态字面一致).
 */
import { describe, it, expect } from 'vitest';
import { markdownToAtoms } from '@capabilities/content-ingest/internal/markdown-to-atoms';
import { createNotesBatch } from '@platform/main/note/capability-impl';
import { assemblePmDoc } from '@platform/main/note/assemble-pm-doc';

describe('Scenario 11 — markdown → atoms → storage → assemble 整链 round-trip', () => {
  it('简单 markdown (heading + paragraph) 字面 round-trip', async () => {
    const md = '# Hello\n\nworld';
    const { atoms } = await markdownToAtoms(md);
    const r = await createNotesBatch({
      items: [{ atoms, folderId: null }],
    });
    expect(r.failures).toEqual([]);
    expect(r.notes).toHaveLength(1);

    const noteId = r.notes[0].id;
    const assembled = await assemblePmDoc(noteId);
    expect(assembled).toBeTruthy();
    expect(assembled!.type).toBe('doc');
    // 顶层至少 heading + paragraph 各 1
    const topTypes = assembled!.content!.map((n) => n.type);
    expect(topTypes).toContain('heading');
    expect(topTypes).toContain('paragraph');
  });

  it('markdown 含 GFM 表格 round-trip → assemble 端字面重建 tableRow + cell 顺序', async () => {
    const md = [
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
    ].join('\n');
    const { atoms } = await markdownToAtoms(md);
    const r = await createNotesBatch({
      items: [{ atoms, folderId: null }],
    });
    expect(r.failures).toEqual([]);

    const noteId = r.notes[0].id;
    const assembled = await assemblePmDoc(noteId);
    expect(assembled).toBeTruthy();

    // 顶层至少含 table
    const tableNode = assembled!.content!.find((n) => n.type === 'table');
    expect(tableNode).toBeTruthy();
    expect(tableNode!.content).toHaveLength(2); // header row + body row
    expect(tableNode!.content![0].type).toBe('tableRow');
    expect(tableNode!.content![0].content).toHaveLength(2);
    // header 行: A / B
    const headerTexts = tableNode!.content![0].content!.map((cell) => {
      const para = cell.content![0];
      return para.content![0].text;
    });
    expect(headerTexts).toEqual(['A', 'B']);
    // body 行: 1 / 2
    const bodyTexts = tableNode!.content![1].content!.map((cell) => {
      const para = cell.content![0];
      return para.content![0].text;
    });
    expect(bodyTexts).toEqual(['1', '2']);
  });

  it('markdown 含 bulletList → assemble 字面 wrapper 重建 (decision 026 §13.8)', async () => {
    const md = '- item 1\n- item 2\n- item 3';
    const { atoms } = await markdownToAtoms(md);
    const r = await createNotesBatch({
      items: [{ atoms, folderId: null }],
    });
    expect(r.failures).toEqual([]);

    const noteId = r.notes[0].id;
    const assembled = await assemblePmDoc(noteId);
    expect(assembled).toBeTruthy();
    // 顶层字面含 bulletList wrapper (5B Stage 4 STRUCTURAL_REBUILD_RULES)
    const bulletList = assembled!.content!.find((n) => n.type === 'bulletList');
    expect(bulletList).toBeTruthy();
    // 3 listItem 在 bulletList 内
    expect(bulletList!.content).toHaveLength(3);
    for (const li of bulletList!.content!) {
      expect(li.type).toBe('listItem');
    }
  });
});
