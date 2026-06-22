/**
 * Migration 1.6.0 — graph text doc 边→属性内联(L5-G6c 阶段 A,M2)
 *
 * 验收(总指挥 M2/R9):
 *  1. 旧 graph 画板:graph-instance --hasContent--> pm atom → 迁移后 doc 内联 payload.doc
 *     (DriverSerialized 信封),hasContent 边删,孤儿 pm atom 删。
 *  2. graph-scoped:非 graph-instance 主体的 hasContent 边不动(本刀只迁画板 doc)。
 *  3. 幂等:再迁一次 → 无 graph-instance hasContent 边可处理,无副作用。
 *  4. R8:user:krig:hasContent predicate 本身不删(仅删 graph 那批边实例)。
 *
 * 用 in-memory mockStorage 替换 surrealStorage facade(真 surreal 引擎不在单测范围;
 * 迁移核心是 facade 调用编排,mock 足以验证逻辑正确)。db.query 仅写 schema_version 标记,
 * stub 掉即可。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockStorage } from '../mocks/storage-mock';

// 把 schema.ts 内的 surrealStorage 重定向到 in-memory mock
vi.mock('@storage/surreal/storage', () => ({ surrealStorage: mockStorage }));

import { migration_1_6_0 } from '@storage/surreal/schema';
import type { Atom } from '@semantic/types';

const HAS_CONTENT = 'user:krig:hasContent';

/** 假 Surreal db:迁移只用 db.query 写 schema_version 标记 */
const fakeDb = { query: vi.fn(async () => []) } as unknown as Parameters<typeof migration_1_6_0>[0];

beforeEach(() => {
  mockStorage._reset();
  fakeDb.query = vi.fn(async () => []);
});

async function putInstanceAtom(id: string, payload: Record<string, unknown>): Promise<void> {
  const wrapped = { domain: 'graph-instance', payload } as unknown as Atom<'graph-instance'>;
  await mockStorage.putAtom<'graph-instance'>({ id, payload: wrapped });
}
async function putPmAtom(id: string, payload: unknown): Promise<void> {
  const wrapped = { domain: 'pm', payload } as unknown as Atom<'pm'>;
  await mockStorage.putAtom<'pm'>({ id, payload: wrapped });
}
async function putHasContent(instId: string, pmId: string): Promise<void> {
  await mockStorage.putEdge({
    predicate: HAS_CONTENT,
    subject: { kind: 'atom', atomId: instId },
    object: { kind: 'atom', atomId: pmId },
    attrs: { createdBy: 'test', createdAt: Date.now() },
  });
}
function hasContentEdgeCount(): number {
  return [...mockStorage._edges.values()].filter((e) => e.predicate === HAS_CONTENT).length;
}
function instanceDoc(id: string): unknown {
  const a = mockStorage._atoms.get(id)!;
  return (a.payload.payload as Record<string, unknown>).doc;
}

describe('Migration 1.6.0 — graph doc 边→属性内联', () => {
  it('旧画板 text doc(hasContent 边 + pm atom)→ 内联 payload.doc + 边删 + 孤儿 pm 删', async () => {
    await putInstanceAtom('inst1', { type: 'shape', ref: 'krig.text.label' });
    await putPmAtom('pm1', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] });
    await putHasContent('inst1', 'pm1');

    await migration_1_6_0(fakeDb);

    // doc 内联成 DriverSerialized 信封
    const doc = instanceDoc('inst1') as { format?: string; payload?: { content?: unknown[] } };
    expect(doc?.format).toBe('pm-doc-json');
    expect(doc?.payload?.content).toHaveLength(1);
    // hasContent 边删净
    expect(hasContentEdgeCount()).toBe(0);
    // 孤儿 pm atom 删
    expect(mockStorage._atoms.has('pm1')).toBe(false);
    // 写了 schema_version 标记
    expect(fakeDb.query).toHaveBeenCalled();
  });

  it('已内联(payload.doc 已有)的 instance:不覆盖 doc,但仍清边 + 删孤儿 pm', async () => {
    const existing = { format: 'pm-doc-json', version: '0.1', payload: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inline-already' }] }] } };
    await putInstanceAtom('inst2', { type: 'shape', ref: 'krig.text.label', doc: existing });
    await putPmAtom('pm2', { type: 'doc', content: [] });
    await putHasContent('inst2', 'pm2');

    await migration_1_6_0(fakeDb);

    // 不覆盖已内联 doc
    const doc = instanceDoc('inst2') as { payload?: { content?: { content?: { text?: string }[] }[] } };
    expect(doc?.payload?.content?.[0]?.content?.[0]?.text).toBe('inline-already');
    expect(hasContentEdgeCount()).toBe(0);
    expect(mockStorage._atoms.has('pm2')).toBe(false);
  });

  it('graph-scoped:非 graph-instance 主体的 hasContent 边不动(本刀只迁画板)', async () => {
    // 造一个 note 形态:pm(domain≠graph-instance)主体的 hasContent 边
    await putPmAtom('note1', { type: 'doc', content: [] });
    await putPmAtom('pm-note', { type: 'doc', content: [] });
    await putHasContent('note1', 'pm-note');

    await migration_1_6_0(fakeDb);

    // 非 graph-instance 主体 → 不处理,边保留
    expect(hasContentEdgeCount()).toBe(1);
    expect(mockStorage._atoms.has('pm-note')).toBe(true);
  });

  it('幂等:再迁一次 → 无 graph-instance hasContent 边,无副作用', async () => {
    await putInstanceAtom('inst3', { type: 'shape', ref: 'krig.text.label' });
    await putPmAtom('pm3', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] });
    await putHasContent('inst3', 'pm3');

    await migration_1_6_0(fakeDb);
    const docAfterFirst = instanceDoc('inst3');
    expect(hasContentEdgeCount()).toBe(0);

    // 第二次:无 graph-instance hasContent 边可处理
    await migration_1_6_0(fakeDb);
    expect(hasContentEdgeCount()).toBe(0);
    expect(instanceDoc('inst3')).toEqual(docAfterFirst);
  });
});
