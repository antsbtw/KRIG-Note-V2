/**
 * Unit test: assemblePmDoc 属性路径 (Decision 028 Phase 1)
 *
 * 核心验收:**round-trip 等价** —— 同一逻辑文档,分别用
 *  (A) 纯属性(noteId/parentId/order,无结构边)
 *  (B) 纯边(belongsToNote/childOf/nextSibling,无属性)
 * 铺进 storage,assemblePmDoc 出的 doc 必须**完全一致**(逐块相等)。
 *
 * 这证明 Phase 1 的属性路径与旧边路径行为等价(§4 Phase 1 验收:round-trip 逐块一致),
 * 也是 Phase 3 迁移 round-trip 校验的逻辑基础。
 *
 * 数据来源:用 dissectPmDoc 把 PM doc 拆成 atom(自带 028 属性),
 * 属性路径直接铺 atom;边路径铺同样 atom + dissect 出的边。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { dissectPmDoc } from '@platform/main/note/dissect-pm-doc';
import { assemblePmDoc } from '@platform/main/note/assemble-pm-doc';
import { mockStorage } from '../../../mocks/storage-mock';
import type { PmPayload, Atom } from '@semantic/types';

const BELONGS = 'user:krig:belongsToNote';
const CHILD_OF = 'user:krig:childOf';
const NEXT_SIB = 'user:krig:nextSibling';

beforeEach(() => mockStorage._reset());

async function putPmAtom(id: string, payload: PmPayload): Promise<void> {
  const wrapped: Atom<'pm'> = { domain: 'pm', payload };
  await mockStorage.putAtom<'pm'>({ id, payload: wrapped });
}

/** 把 dissect 结果按"纯属性"铺进 storage(atom 自带 028 属性,不写结构边) */
async function seedViaAttrs(containerId: string, doc: PmPayload): Promise<void> {
  await putPmAtom(containerId, { type: 'doc', attrs: { title: '' }, content: [] });
  const dis = dissectPmDoc(containerId, doc);
  for (const b of dis.blocks) await putPmAtom(b.id, b.payload);
}

/** 把 dissect 结果按"纯边"铺进 storage(atom 剥掉 028 属性,写结构边) */
async function seedViaEdges(containerId: string, doc: PmPayload): Promise<void> {
  await putPmAtom(containerId, { type: 'doc', attrs: { title: '' }, content: [] });
  const dis = dissectPmDoc(containerId, doc);
  for (const b of dis.blocks) {
    // 剥掉 028 属性,模拟 Phase 0 之前的旧数据(只有边表达结构)
    const attrs = { ...(b.payload.attrs ?? {}) };
    delete attrs.noteId;
    delete attrs.parentId;
    delete attrs.order;
    await putPmAtom(b.id, { ...b.payload, attrs });
  }
  for (const e of dis.belongsEdges) {
    await mockStorage.putEdge({
      predicate: BELONGS,
      subject: { kind: 'atom', atomId: e.subjectId },
      object: { kind: 'atom', atomId: e.objectId },
      attrs: { createdBy: 'test', createdAt: Date.now() },
    });
  }
  for (const e of dis.childOfEdges) {
    await mockStorage.putEdge({
      predicate: CHILD_OF,
      subject: { kind: 'atom', atomId: e.subjectId },
      object: { kind: 'atom', atomId: e.objectId },
      attrs: { createdBy: 'test', createdAt: Date.now() },
    });
  }
  for (const e of dis.nextSiblingEdges) {
    await mockStorage.putEdge({
      predicate: NEXT_SIB,
      subject: { kind: 'atom', atomId: e.subjectId },
      object: { kind: 'atom', atomId: e.objectId },
      attrs: { createdBy: 'test', createdAt: Date.now() },
    });
  }
}

// 测试文档工厂
function para(id: string, text: string): PmPayload {
  return { type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] };
}

const FIXTURES: Record<string, PmPayload> = {
  '顶层多段落': {
    type: 'doc',
    content: [para('p1', 'A'), para('p2', 'B'), para('p3', 'C'), para('p4', 'D')],
  },
  '嵌套列表': {
    type: 'doc',
    content: [
      para('h', '标题'),
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', attrs: { id: 'li1' }, content: [para('lp1', '项一')] },
          {
            type: 'listItem',
            attrs: { id: 'li2' },
            content: [
              para('lp2', '项二'),
              {
                type: 'bulletList',
                content: [
                  { type: 'listItem', attrs: { id: 'li3' }, content: [para('lp3', '嵌套子项')] },
                ],
              },
            ],
          },
        ],
      },
      para('tail', '尾段'),
    ],
  },
  '表格': {
    type: 'doc',
    content: [
      para('top', '表前'),
      {
        type: 'table',
        attrs: { id: 't1' },
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', attrs: { id: 'c00' }, content: [para('c00p', '00')] },
              { type: 'tableCell', attrs: { id: 'c01' }, content: [para('c01p', '01')] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', attrs: { id: 'c10' }, content: [para('c10p', '10')] },
              { type: 'tableCell', attrs: { id: 'c11' }, content: [para('c11p', '11')] },
            ],
          },
        ],
      },
    ],
  },
};

describe('assemblePmDoc — 属性路径 round-trip 等价(Decision 028 Phase 1)', () => {
  for (const [name, doc] of Object.entries(FIXTURES)) {
    it(`「${name}」属性路径 == 边路径(逐块一致)`, async () => {
      // 属性路径
      mockStorage._reset();
      await seedViaAttrs('note-attr', doc);
      const viaAttrs = await assemblePmDoc('note-attr');

      // 边路径
      mockStorage._reset();
      await seedViaEdges('note-edge', doc);
      const viaEdges = await assemblePmDoc('note-edge');

      expect(viaAttrs).toBeTruthy();
      expect(viaEdges).toBeTruthy();
      // 两路径输出完全一致(注:属性路径的 atom 带 028 内部属性,
      // 边路径剥了 —— 故归一化后比较结构。见下方独立断言。)
      // 这里先比较结构等价(strip 028 内部属性后)。
      expect(stripInternal(viaAttrs!)).toEqual(stripInternal(viaEdges!));
    });
  }

  it('属性路径在缺 order 时 fallback 到边路径', async () => {
    // 铺 atom 不带 order,但带 belongsToNote 边 → 应走边路径不报错
    mockStorage._reset();
    const doc = FIXTURES['顶层多段落'];
    await seedViaEdges('note-x', doc); // 边路径数据,atom 无 order
    const assembled = await assemblePmDoc('note-x');
    expect(assembled).toBeTruthy();
    expect(assembled!.content!.map((p) => p.content![0].text)).toEqual(['A', 'B', 'C', 'D']);
  });
});

/** 递归剥除 028 内部属性(noteId/parentId/order),便于两路径结构比较 */
function stripInternal(node: PmPayload): PmPayload {
  const out: PmPayload = { type: node.type };
  if (node.attrs !== undefined) {
    const a = { ...node.attrs };
    delete a.noteId;
    delete a.parentId;
    delete a.order;
    out.attrs = a;
  }
  if (node.text !== undefined) out.text = node.text;
  if (node.marks !== undefined) out.marks = node.marks;
  if (Array.isArray(node.content)) out.content = node.content.map(stripInternal);
  return out;
}
