/**
 * Unit test: dissectPmDoc (5B Stage 2 / decision 026 §3 §6)
 *
 * 用例:
 *  1. 空 doc → 0 blocks / 0 edges
 *  2. 顶层 3 paragraph 无嵌套 → 3 blocks + 3 belongsToNote + 2 nextSibling + 0 childOf
 *  3. 嵌套 bulletList > listItem > paragraph → listItem 顶层 (childOf 跳层) + paragraph.childOf → listItem
 *  4. table → table atom + tableRow 跳层 + cells (attrs.rowIndex/colIndex 字面注入) + cell.childOf → table
 *  5. 缺 attrs.id 字面 throw
 */
import { describe, it, expect } from 'vitest';
import { dissectPmDoc } from '@platform/main/note/dissect-pm-doc';
import type { PmPayload } from '@semantic/types';

const C = 'container-id';

function para(id: string | null, text: string): PmPayload {
  return {
    type: 'paragraph',
    attrs: { id },
    content: text ? [{ type: 'text', text }] : [],
  };
}

describe('dissectPmDoc', () => {
  it('空 doc → 0 blocks / 0 edges', () => {
    const doc: PmPayload = { type: 'doc', content: [] };
    const r = dissectPmDoc(C, doc);
    expect(r.blocks).toHaveLength(0);
    expect(r.belongsEdges).toHaveLength(0);
    expect(r.nextSiblingEdges).toHaveLength(0);
    expect(r.childOfEdges).toHaveLength(0);
  });

  it('顶层 3 paragraph → 3 blocks + 3 belongs + 2 nextSibling + 0 childOf', () => {
    const doc: PmPayload = {
      type: 'doc',
      content: [para('p1', 'A'), para('p2', 'B'), para('p3', 'C')],
    };
    const r = dissectPmDoc(C, doc);
    expect(r.blocks.map((b) => b.id)).toEqual(['p1', 'p2', 'p3']);
    expect(r.belongsEdges).toHaveLength(3);
    expect(r.belongsEdges.every((e) => e.objectId === C)).toBe(true);
    expect(r.nextSiblingEdges).toEqual([
      { subjectId: 'p1', objectId: 'p2' },
      { subjectId: 'p2', objectId: 'p3' },
    ]);
    expect(r.childOfEdges).toHaveLength(0);
  });

  it('bulletList > listItem > paragraph 嵌套 → listItem 顶层 (无 childOf) + paragraph.childOf → listItem', () => {
    const innerPara: PmPayload = {
      type: 'paragraph',
      attrs: { id: 'inner' },
      content: [{ type: 'text', text: 'X' }],
    };
    const listItem: PmPayload = {
      type: 'listItem',
      attrs: { id: 'li1' },
      content: [innerPara],
    };
    const bulletList: PmPayload = {
      type: 'bulletList',
      content: [listItem],
    };
    const doc: PmPayload = { type: 'doc', content: [bulletList] };
    const r = dissectPmDoc(C, doc);

    // bulletList 字面跳层 — listItem 上提到顶层
    const ids = r.blocks.map((b) => b.id).sort();
    expect(ids).toEqual(['inner', 'li1']);
    // listItem 顶层 — 无 childOf
    const liChildOf = r.childOfEdges.find((e) => e.subjectId === 'li1');
    expect(liChildOf).toBeUndefined();
    // inner paragraph.childOf → li1
    const innerChildOf = r.childOfEdges.find((e) => e.subjectId === 'inner');
    expect(innerChildOf).toEqual({ subjectId: 'inner', objectId: 'li1' });
    // belongsToNote 字面每 atom 1 条 → container
    expect(r.belongsEdges).toHaveLength(2);
    expect(r.belongsEdges.every((e) => e.objectId === C)).toBe(true);
  });

  it('table → table atom + tableRow 跳层 + cells 注入 rowIndex/colIndex + cell.childOf → table', () => {
    // 2x2 table
    const cell = (id: string): PmPayload => ({
      type: 'tableCell',
      attrs: { id },
      content: [{ type: 'paragraph', attrs: { id: `${id}-p` }, content: [{ type: 'text', text: id }] }],
    });
    const row1: PmPayload = { type: 'tableRow', content: [cell('c00'), cell('c01')] };
    const row2: PmPayload = { type: 'tableRow', content: [cell('c10'), cell('c11')] };
    const table: PmPayload = {
      type: 'table',
      attrs: { id: 't1' },
      content: [row1, row2],
    };
    const doc: PmPayload = { type: 'doc', content: [table] };
    const r = dissectPmDoc(C, doc);

    // table 自身 1 atom + 4 cells + (cells 内 paragraph 各 1 atom = 4)
    const ids = new Set(r.blocks.map((b) => b.id));
    expect(ids.has('t1')).toBe(true);
    expect(ids.has('c00')).toBe(true);
    expect(ids.has('c11')).toBe(true);

    // cells childOf → table (跳 tableRow)
    const c00ChildOf = r.childOfEdges.find((e) => e.subjectId === 'c00');
    expect(c00ChildOf).toEqual({ subjectId: 'c00', objectId: 't1' });
    const c11ChildOf = r.childOfEdges.find((e) => e.subjectId === 'c11');
    expect(c11ChildOf).toEqual({ subjectId: 'c11', objectId: 't1' });

    // rowIndex / colIndex 字面注入
    const c00 = r.blocks.find((b) => b.id === 'c00')!;
    expect(c00.payload.attrs?.rowIndex).toBe(0);
    expect(c00.payload.attrs?.colIndex).toBe(0);
    const c01 = r.blocks.find((b) => b.id === 'c01')!;
    expect(c01.payload.attrs?.rowIndex).toBe(0);
    expect(c01.payload.attrs?.colIndex).toBe(1);
    const c10 = r.blocks.find((b) => b.id === 'c10')!;
    expect(c10.payload.attrs?.rowIndex).toBe(1);
    expect(c10.payload.attrs?.colIndex).toBe(0);
    const c11 = r.blocks.find((b) => b.id === 'c11')!;
    expect(c11.payload.attrs?.rowIndex).toBe(1);
    expect(c11.payload.attrs?.colIndex).toBe(1);
  });

  it('缺 attrs.id 字面 throw', () => {
    const bad: PmPayload = {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { id: null }, content: [{ type: 'text', text: 'X' }] }],
    };
    expect(() => dissectPmDoc(C, bad)).toThrow(/no attrs\.id/);
  });

  it('root 非 doc 字面 throw', () => {
    expect(() => dissectPmDoc(C, { type: 'paragraph' } as PmPayload)).toThrow(/root must be type='doc'/);
  });

  // ── Decision 028 Phase 0:结构属性双写(noteId / parentId / order)──
  describe('Decision 028 结构属性双写', () => {
    it('顶层 block:noteId=containerId, parentId=null, order 严格升序', () => {
      const doc: PmPayload = {
        type: 'doc',
        content: [para('p1', 'A'), para('p2', 'B'), para('p3', 'C')],
      };
      const r = dissectPmDoc(C, doc);
      const byId = new Map(r.blocks.map((b) => [b.id, b.payload]));
      for (const id of ['p1', 'p2', 'p3']) {
        expect(byId.get(id)!.attrs?.noteId).toBe(C);
        expect(byId.get(id)!.attrs?.parentId).toBe(null);
        expect(typeof byId.get(id)!.attrs?.order).toBe('string');
      }
      // order 顺序 == 文档顺序(与 nextSibling 链一致)
      const o1 = byId.get('p1')!.attrs!.order as string;
      const o2 = byId.get('p2')!.attrs!.order as string;
      const o3 = byId.get('p3')!.attrs!.order as string;
      expect(o1 < o2).toBe(true);
      expect(o2 < o3).toBe(true);
    });

    it('嵌套 block:parentId == childOf 目标(跳层语义一致)', () => {
      const innerPara: PmPayload = {
        type: 'paragraph',
        attrs: { id: 'inner' },
        content: [{ type: 'text', text: 'X' }],
      };
      const listItem: PmPayload = { type: 'listItem', attrs: { id: 'li1' }, content: [innerPara] };
      const bulletList: PmPayload = { type: 'bulletList', content: [listItem] };
      const doc: PmPayload = { type: 'doc', content: [bulletList] };
      const r = dissectPmDoc(C, doc);
      const byId = new Map(r.blocks.map((b) => [b.id, b.payload]));
      // li1 顶层(childOf 跳过 bulletList → 顶层)→ parentId=null
      expect(byId.get('li1')!.attrs?.parentId).toBe(null);
      // inner.childOf → li1 → parentId='li1'
      expect(byId.get('inner')!.attrs?.parentId).toBe('li1');
      // 两者 noteId 都是 container
      expect(byId.get('li1')!.attrs?.noteId).toBe(C);
      expect(byId.get('inner')!.attrs?.noteId).toBe(C);
    });

    it('attrs.parentId 与 childOfEdges 完全等价(双写一致性)', () => {
      // 含 table + cells + list,验证所有 parentId == 对应 childOf 边
      const cell = (id: string): PmPayload => ({
        type: 'tableCell',
        attrs: { id },
        content: [{ type: 'paragraph', attrs: { id: `${id}-p` }, content: [{ type: 'text', text: id }] }],
      });
      const table: PmPayload = {
        type: 'table',
        attrs: { id: 't1' },
        content: [{ type: 'tableRow', content: [cell('c00'), cell('c01')] }],
      };
      const doc: PmPayload = { type: 'doc', content: [para('p0', 'top'), table] };
      const r = dissectPmDoc(C, doc);
      const childOfByChild = new Map(r.childOfEdges.map((e) => [e.subjectId, e.objectId]));
      for (const b of r.blocks) {
        const expectedParent = childOfByChild.get(b.id) ?? null;
        expect(b.payload.attrs?.parentId).toBe(expectedParent);
      }
    });

    it('不污染输入 doc(attrs 浅拷贝)', () => {
      const p = para('p1', 'A');
      const doc: PmPayload = { type: 'doc', content: [p] };
      dissectPmDoc(C, doc);
      // 输入 paragraph 的 attrs 不应被写入 noteId/order/parentId
      expect('noteId' in (p.attrs ?? {})).toBe(false);
      expect('order' in (p.attrs ?? {})).toBe(false);
    });
  });
});
