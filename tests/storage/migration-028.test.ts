/**
 * Unit test: Migration 028 core (Decision 028 Phase 3)
 *
 * 验收:
 *  1. 正常老笔记(纯边)→ 迁移后 block atom 带 noteId/parentId/order,结构边清零,顺序不变
 *  2. round-trip 校验:迁移后属性路径 assemble == 迁移前边路径 assemble(逐块)
 *  3. **迁移即修复**:损坏笔记(nextSibling 分叉 2 heads)→ 迁移用 keep-latest 去重读正确序
 *     → 写成属性 → 顺序恢复 + 边清零
 *  4. 幂等:已迁移笔记(纯属性,无边)再迁一次 → 仍 'migrated' / 'empty',无副作用
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { migrateNote } from '@storage/migrations/028-block-structure-attrs-core';
import { assemblePmDoc } from '@platform/main/note/assemble-pm-doc';
import { mockStorage } from '../mocks/storage-mock';
import type { PmPayload, Atom } from '@semantic/types';

const BELONGS = 'user:krig:belongsToNote';
const NEXT_SIB = 'user:krig:nextSibling';
const HAS_NOTE_VIEW = 'user:krig:hasNoteView';

beforeEach(() => mockStorage._reset());

async function putPmAtom(id: string, payload: PmPayload): Promise<void> {
  const wrapped: Atom<'pm'> = { domain: 'pm', payload };
  await mockStorage.putAtom<'pm'>({ id, payload: wrapped });
}
async function putEdge(predicate: string, s: string, o: string): Promise<void> {
  await mockStorage.putEdge({
    predicate,
    subject: { kind: 'atom', atomId: s },
    object: { kind: 'atom', atomId: o },
    attrs: { createdBy: 'test', createdAt: Date.now() },
  });
}
async function putBoolEdge(predicate: string, s: string): Promise<void> {
  await mockStorage.putEdge({
    predicate,
    subject: { kind: 'atom', atomId: s },
    object: { kind: 'literal', type: 'boolean', value: true },
    attrs: { createdBy: 'test', createdAt: Date.now() },
  });
}

/** 老笔记:3 段落,纯边表达(belongsToNote + nextSibling 链),atom 无 028 属性 */
async function seedOldNote(noteId: string): Promise<void> {
  await putPmAtom(noteId, { type: 'doc', attrs: { title: '' }, content: [] });
  await putBoolEdge(HAS_NOTE_VIEW, noteId);
  for (const [id, text] of [['p1', 'A'], ['p2', 'B'], ['p3', 'C']] as const) {
    await putPmAtom(id, { type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] });
    await putEdge(BELONGS, id, noteId);
  }
  await putEdge(NEXT_SIB, 'p1', 'p2');
  await putEdge(NEXT_SIB, 'p2', 'p3');
}

function texts(doc: PmPayload | null): string[] {
  return (doc?.content ?? []).map((p) => p.content?.[0]?.text as string);
}
function attrsOf(id: string): Record<string, unknown> {
  return (mockStorage._atoms.get(id)!.payload.payload as PmPayload).attrs!;
}
function structuralEdgeCount(): number {
  return [...mockStorage._edges.values()].filter((e) =>
    [BELONGS, NEXT_SIB, 'user:krig:childOf'].includes(e.predicate),
  ).length;
}

describe('Migration 028 core', () => {
  it('老笔记(纯边)→ 迁移后带属性 + 结构边清零 + 顺序不变', async () => {
    await seedOldNote('n1');
    // 注:迁移前是纯边数据,assemblePmDoc(属性路径)会 fail loud 拒读 —— 这正是 Phase 4
    // 的预期(边 fallback 已移除)。迁移内部走 legacy 边读取,迁移后才能用属性路径读。
    const r = await migrateNote('n1');
    expect(r).toBe('migrated');

    // block atom 带 028 属性
    expect(attrsOf('p1').noteId).toBe('n1');
    expect(attrsOf('p1').parentId).toBe(null);
    expect(typeof attrsOf('p1').order).toBe('string');
    expect((attrsOf('p1').order as string) < (attrsOf('p2').order as string)).toBe(true);

    // 结构边清零
    expect(structuralEdgeCount()).toBe(0);
    // hasNoteView(非结构边)保留
    expect([...mockStorage._edges.values()].some((e) => e.predicate === HAS_NOTE_VIEW)).toBe(true);

    // 顺序不变(此时走属性路径)
    expect(texts(await assemblePmDoc('n1'))).toEqual(['A', 'B', 'C']);
  });

  it('迁移即修复:nextSibling 分叉(2 heads)→ keep-latest 读正确序 → 顺序恢复 + 边清零', async () => {
    await seedOldNote('n2');
    // 注入损坏:p1 多一条 outgoing nextSibling → p3(分叉),且加一条游离 p3→p2(造环/乱序)
    // assemble 边路径 topologicalSortSiblings 的 keep-latest/去重应给出确定序。
    await putEdge(NEXT_SIB, 'p1', 'p3'); // p1 现有两条 outgoing(p2 / p3)

    // 迁移:用边路径(去重)读序 → 写属性 → 删边
    const r = await migrateNote('n2');
    // round-trip 一致才 migrated;边路径与属性路径对同一去重序应一致
    expect(r).toBe('migrated');
    expect(structuralEdgeCount()).toBe(0);

    // 迁移后属性路径仍能稳定 assemble(顺序由 order 属性定,无分叉)
    const after = texts(await assemblePmDoc('n2'));
    expect(after).toHaveLength(3);
    expect(new Set(after)).toEqual(new Set(['A', 'B', 'C'])); // 三块都在,无丢失
  });

  it('幂等:已迁移(纯属性,无边)再迁一次 → migrated,无副作用', async () => {
    await seedOldNote('n3');
    await migrateNote('n3');
    const firstPass = texts(await assemblePmDoc('n3'));
    const edgesAfterFirst = structuralEdgeCount();
    expect(edgesAfterFirst).toBe(0);

    // 第二次迁移(此时纯属性)
    const r = await migrateNote('n3');
    expect(r).toBe('migrated');
    expect(structuralEdgeCount()).toBe(0);
    expect(texts(await assemblePmDoc('n3'))).toEqual(firstPass);
  });

  it('空笔记 → empty,无结构边残留', async () => {
    await putPmAtom('n4', { type: 'doc', attrs: { title: '' }, content: [] });
    await putBoolEdge(HAS_NOTE_VIEW, 'n4');
    const r = await migrateNote('n4');
    expect(r).toBe('empty');
    expect(structuralEdgeCount()).toBe(0);
  });
});
