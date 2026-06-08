/**
 * Unit test: assemblePmDoc + assembleTable (Decision 028 Phase 4:纯属性路径)
 *
 * 数据准备:putAtom 直接铺带 noteId/parentId/order 属性的 block atom(零结构边),
 * 然后 assemblePmDoc(containerId)。
 *
 * 用例:
 *  1. 空 container → doc.content = []
 *  2. container 不存在 → null
 *  3. 未迁移(有 belongsToNote 边但无属性块)→ fail loud throw
 *  4. list:listItem + paragraph(parentId)→ bulletList wrapper 重建
 *  5. table:cells(rowIndex/colIndex)→ assembleTable 重建 tableRow 顺序
 *  6. assembleTable 容错(单元层直测)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { assemblePmDoc } from '@platform/main/note/assemble-pm-doc';
import { assembleTable } from '@platform/main/note/assemble-table';
import { mockStorage } from '../../../mocks/storage-mock';
import type { PmPayload, Atom } from '@semantic/types';

const C = 'container';

beforeEach(() => mockStorage._reset());

async function putPmAtom(id: string, payload: PmPayload): Promise<void> {
  const wrapped: Atom<'pm'> = { domain: 'pm', payload };
  await mockStorage.putAtom<'pm'>({ id, payload: wrapped });
}

/** 铺一个带 028 结构属性的 block atom */
async function putBlock(
  id: string,
  payload: PmPayload,
  opts: { parentId: string | null; order: string },
): Promise<void> {
  await putPmAtom(id, {
    ...payload,
    attrs: { ...(payload.attrs ?? {}), id, noteId: C, parentId: opts.parentId, order: opts.order },
  });
}

describe('assemblePmDoc (属性路径)', () => {
  it('空 container → doc.content = []', async () => {
    await putPmAtom('container', { type: 'doc', attrs: { title: '' }, content: [] });
    const doc = await assemblePmDoc('container');
    expect(doc).toEqual({ type: 'doc', content: [] });
  });

  it('container 不存在 → null', async () => {
    const doc = await assemblePmDoc('not-found-id');
    expect(doc).toBeNull();
  });

  it('未迁移(belongsToNote 边 + 无属性块)→ fail loud throw', async () => {
    await putPmAtom('container', { type: 'doc', attrs: { title: '' }, content: [] });
    // 铺一个旧形态:block atom 无 noteId 属性,只有 belongsToNote 边
    await putPmAtom('oldp', { type: 'paragraph', attrs: { id: 'oldp' }, content: [{ type: 'text', text: 'x' }] });
    await mockStorage.putEdge({
      predicate: 'user:krig:belongsToNote',
      subject: { kind: 'atom', atomId: 'oldp' },
      object: { kind: 'atom', atomId: 'container' },
      attrs: { createdBy: 'test', createdAt: Date.now() },
    });
    await expect(assemblePmDoc('container')).rejects.toThrow(/migration 028 未完成/);
  });

  it('list:listItem + paragraph(parentId)→ bulletList wrapper 重建', async () => {
    await putPmAtom('container', { type: 'doc', attrs: { title: '' }, content: [] });
    await putBlock(
      'li1',
      { type: 'listItem', content: [], _assemblyHints: { listType: 'bullet' } } as PmPayload,
      { parentId: null, order: 'a0' },
    );
    await putBlock(
      'p1',
      { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
      { parentId: 'li1', order: 'a0' },
    );

    const doc = await assemblePmDoc('container');
    expect(doc!.content).toHaveLength(1);
    expect(doc!.content![0].type).toBe('bulletList');
    expect(doc!.content![0].content![0].type).toBe('listItem');
    expect(doc!.content![0].content![0].content![0].type).toBe('paragraph');
    expect(doc!.content![0].content![0].content![0].content![0]).toEqual({
      type: 'text',
      text: 'hello',
    });
  });

  it('table:cells(rowIndex/colIndex)→ assembleTable 重建 tableRow 顺序', async () => {
    await putPmAtom('container', { type: 'doc', attrs: { title: '' }, content: [] });
    await putBlock('t1', { type: 'table', content: [] }, { parentId: null, order: 'a0' });
    const cellPayload = (id: string, r: number, col: number, text: string): PmPayload => ({
      type: 'tableCell',
      attrs: { rowIndex: r, colIndex: col },
      content: [{ type: 'paragraph', attrs: { id: `${id}-p` }, content: [{ type: 'text', text }] }],
    });
    // 顺序故意打乱(assemble 按 rowIndex/colIndex 重排)
    await putBlock('c11', cellPayload('c11', 1, 1, '11'), { parentId: 't1', order: 'a3' });
    await putBlock('c00', cellPayload('c00', 0, 0, '00'), { parentId: 't1', order: 'a0' });
    await putBlock('c01', cellPayload('c01', 0, 1, '01'), { parentId: 't1', order: 'a1' });
    await putBlock('c10', cellPayload('c10', 1, 0, '10'), { parentId: 't1', order: 'a2' });

    const doc = await assemblePmDoc('container');
    const table = doc!.content![0];
    expect(table.type).toBe('table');
    expect(table.content).toHaveLength(2);
    const row0 = table.content![0].content!.map((cell) => cell.content![0].content![0].text);
    expect(row0).toEqual(['00', '01']);
    const row1 = table.content![1].content!.map((cell) => cell.content![0].content![0].text);
    expect(row1).toEqual(['10', '11']);
  });
});

describe('assembleTable (单元层)', () => {
  it('rowIndex 缺失 fallback 0 (同行)', () => {
    const cells: PmPayload[] = [
      { type: 'tableCell', attrs: { colIndex: 0 }, content: [] },
      { type: 'tableCell', attrs: { colIndex: 1 }, content: [] },
    ];
    const rows = assembleTable(cells);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('tableRow');
    expect(rows[0].content).toHaveLength(2);
  });

  it('同 (row, col) 重复保留首条', () => {
    const cells: PmPayload[] = [
      { type: 'tableCell', attrs: { rowIndex: 0, colIndex: 0 }, content: [{ type: 'text', text: 'first' }] },
      { type: 'tableCell', attrs: { rowIndex: 0, colIndex: 0 }, content: [{ type: 'text', text: 'dup' }] },
    ];
    const rows = assembleTable(cells);
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toHaveLength(1);
    expect(rows[0].content![0].content![0].text).toBe('first');
  });

  it('空 cells → []', () => {
    expect(assembleTable([])).toEqual([]);
  });
});
