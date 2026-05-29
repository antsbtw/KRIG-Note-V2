/**
 * Unit test: assemblePmDoc + assembleTable (5B Stage 4 / decision 026 §6.1)
 *
 * 数据准备:走 mockStorage.putAtom + putEdge 直接铺,然后 assemblePmDoc(containerId).
 *
 * 用例:
 *  1. 空 container → doc.content = []
 *  2. list round-trip (listItem + paragraph + childOf → bulletList wrapper 重建)
 *  3. table round-trip (table atom + cells + childOf + rowIndex/colIndex → tableRow 按行/列排序)
 *  4. assembleTable 容错: rowIndex 缺失 fallback 0; 同 (row, col) 重复保留首条 (单元层直测)
 */
import { describe, it, expect } from 'vitest';
import { assemblePmDoc } from '@platform/main/note/assemble-pm-doc';
import { assembleTable } from '@platform/main/note/assemble-table';
import { mockStorage } from '../../../mocks/storage-mock';
import type { PmPayload, Atom } from '@semantic/types';

const BELONGS = 'user:krig:belongsToNote';
const CHILD_OF = 'user:krig:childOf';
const NEXT_SIB = 'user:krig:nextSibling';

async function putPmAtom(id: string, payload: PmPayload): Promise<string> {
  const wrapped: Atom<'pm'> = { domain: 'pm', payload };
  const e = await mockStorage.putAtom<'pm'>({ id, payload: wrapped });
  return e.id;
}

async function putBelongs(blockId: string, containerId: string): Promise<void> {
  await mockStorage.putEdge({
    predicate: BELONGS,
    subject: { kind: 'atom', atomId: blockId },
    object: { kind: 'atom', atomId: containerId },
    attrs: { createdBy: 'test', createdAt: Date.now() },
  });
}

async function putChildOf(child: string, parent: string): Promise<void> {
  await mockStorage.putEdge({
    predicate: CHILD_OF,
    subject: { kind: 'atom', atomId: child },
    object: { kind: 'atom', atomId: parent },
    attrs: { createdBy: 'test', createdAt: Date.now() },
  });
}

async function putNextSib(a: string, b: string): Promise<void> {
  await mockStorage.putEdge({
    predicate: NEXT_SIB,
    subject: { kind: 'atom', atomId: a },
    object: { kind: 'atom', atomId: b },
    attrs: { createdBy: 'test', createdAt: Date.now() },
  });
}

describe('assemblePmDoc', () => {
  it('空 container → PmPayload doc with content = []', async () => {
    await putPmAtom('container', { type: 'doc', content: [] });
    const doc = await assemblePmDoc('container');
    expect(doc).toEqual({ type: 'doc', content: [] });
  });

  it('container 不存在 → null', async () => {
    const doc = await assemblePmDoc('not-found-id');
    expect(doc).toBeNull();
  });

  it('list round-trip: listItem + paragraph → bulletList wrapper 重建', async () => {
    // container
    await putPmAtom('c', { type: 'doc', content: [] });
    // listItem (顶层, 容器 block, content=[], _assemblyHints.listType='bullet')
    await putPmAtom('li1', {
      type: 'listItem',
      attrs: { id: 'li1' },
      content: [],
      _assemblyHints: { listType: 'bullet' },
    } as PmPayload & { _assemblyHints: { listType: string } });
    // paragraph 嵌套在 listItem 内
    await putPmAtom('p1', {
      type: 'paragraph',
      attrs: { id: 'p1' },
      content: [{ type: 'text', text: 'hello' }],
    });
    await putBelongs('li1', 'c');
    await putBelongs('p1', 'c');
    await putChildOf('p1', 'li1');

    const doc = await assemblePmDoc('c');
    expect(doc).toBeTruthy();
    expect(doc!.type).toBe('doc');
    // doc.content 顶层应字面是 bulletList wrapper (5B Stage 4 STRUCTURAL_REBUILD_RULES)
    expect(doc!.content).toHaveLength(1);
    expect(doc!.content![0].type).toBe('bulletList');
    expect(doc!.content![0].content).toHaveLength(1);
    expect(doc!.content![0].content![0].type).toBe('listItem');
    expect(doc!.content![0].content![0].content![0].type).toBe('paragraph');
    expect(doc!.content![0].content![0].content![0].content![0]).toEqual({
      type: 'text',
      text: 'hello',
    });
  });

  it('table round-trip: cells with rowIndex/colIndex → assembleTable 重建 tableRow 顺序', async () => {
    await putPmAtom('c', { type: 'doc', content: [] });
    await putPmAtom('t1', {
      type: 'table',
      attrs: { id: 't1' },
      content: [],
    });
    // 2x2: 故意乱序 putAtom (rowIndex/colIndex 拍板顺序应在 assemble 端重排)
    const cellPayload = (id: string, r: number, col: number, text: string): PmPayload => ({
      type: 'tableCell',
      attrs: { id, rowIndex: r, colIndex: col },
      content: [
        {
          type: 'paragraph',
          attrs: { id: `${id}-p` },
          content: [{ type: 'text', text }],
        },
      ],
    });
    // 顺序故意打乱
    await putPmAtom('c11', cellPayload('c11', 1, 1, '11'));
    await putPmAtom('c00', cellPayload('c00', 0, 0, '00'));
    await putPmAtom('c01', cellPayload('c01', 0, 1, '01'));
    await putPmAtom('c10', cellPayload('c10', 1, 0, '10'));

    await putBelongs('t1', 'c');
    for (const id of ['c00', 'c01', 'c10', 'c11']) {
      await putBelongs(id, 'c');
      await putChildOf(id, 't1');
    }

    const doc = await assemblePmDoc('c');
    expect(doc).toBeTruthy();
    expect(doc!.content).toHaveLength(1);
    const table = doc!.content![0];
    expect(table.type).toBe('table');
    // tableRow 重建,行内 col 升序,行按 rowIndex 升序
    expect(table.content).toHaveLength(2);
    expect(table.content![0].type).toBe('tableRow');
    expect(table.content![0].content).toHaveLength(2);
    const row0Texts = table.content![0].content!.map(
      (cell) => cell.content![0].content![0].text,
    );
    expect(row0Texts).toEqual(['00', '01']);
    const row1Texts = table.content![1].content!.map(
      (cell) => cell.content![0].content![0].text,
    );
    expect(row1Texts).toEqual(['10', '11']);
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
      {
        type: 'tableCell',
        attrs: { rowIndex: 0, colIndex: 0 },
        content: [{ type: 'text', text: 'first' }],
      },
      {
        type: 'tableCell',
        attrs: { rowIndex: 0, colIndex: 0 },
        content: [{ type: 'text', text: 'dup' }],
      },
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
