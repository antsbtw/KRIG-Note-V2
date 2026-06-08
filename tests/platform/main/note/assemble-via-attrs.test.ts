/**
 * Unit test: assemblePmDoc 属性路径 round-trip (Decision 028)
 *
 * 核心验收:**round-trip 等价** —— 同一文档 doc → dissectPmDoc(写属性)→ putAtom 铺库
 *  → assemblePmDoc(属性路径)→ 输出与原 doc **逐块一致**(剥 028 内部属性后)。
 *
 * 这证明属性路径(parentId 建树 + order 排序 + 中间容器壳重建)忠实还原文档结构,
 * 覆盖嵌套列表 / 表格 / 顶层多块。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { dissectPmDoc } from '@platform/main/note/dissect-pm-doc';
import { assemblePmDoc } from '@platform/main/note/assemble-pm-doc';
import { mockStorage } from '../../../mocks/storage-mock';
import type { PmPayload, Atom } from '@semantic/types';

beforeEach(() => mockStorage._reset());

async function putPmAtom(id: string, payload: PmPayload): Promise<void> {
  const wrapped: Atom<'pm'> = { domain: 'pm', payload };
  await mockStorage.putAtom<'pm'>({ id, payload: wrapped });
}

/** doc → dissect(写属性)→ 铺 block atom(零边) */
async function seedViaAttrs(containerId: string, doc: PmPayload): Promise<void> {
  await putPmAtom(containerId, { type: 'doc', attrs: { title: '' }, content: [] });
  const dis = dissectPmDoc(containerId, doc);
  for (const b of dis.blocks) await putPmAtom(b.id, b.payload);
}

function para(id: string, text: string): PmPayload {
  return { type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] };
}

const FIXTURES: Record<string, PmPayload> = {
  顶层多段落: {
    type: 'doc',
    content: [para('p1', 'A'), para('p2', 'B'), para('p3', 'C'), para('p4', 'D')],
  },
  嵌套列表: {
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
  表格: {
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

/**
 * 递归剥除 dissect 注入的结构元数据,便于与原 doc 比较:
 *  - 028 结构属性 noteId/parentId/order
 *  - 026 §6.1 表格 cell 的 rowIndex/colIndex(dissect 注入,assemble 用它重建 tableRow)
 */
function stripInternal(node: PmPayload): PmPayload {
  const out: PmPayload = { type: node.type };
  if (node.attrs !== undefined) {
    const a = { ...node.attrs };
    delete a.noteId;
    delete a.parentId;
    delete a.order;
    delete a.rowIndex;
    delete a.colIndex;
    out.attrs = a;
  }
  if (node.text !== undefined) out.text = node.text;
  if (node.marks !== undefined) out.marks = node.marks;
  if (Array.isArray(node.content)) out.content = node.content.map(stripInternal);
  return out;
}

describe('assemblePmDoc — 属性路径 round-trip(Decision 028)', () => {
  for (const [name, doc] of Object.entries(FIXTURES)) {
    it(`「${name}」dissect→store→assemble 与原 doc 逐块一致`, async () => {
      await seedViaAttrs('note', doc);
      const assembled = await assemblePmDoc('note');
      expect(assembled).toBeTruthy();
      expect(stripInternal(assembled!)).toEqual(stripInternal(doc));
    });
  }
});
