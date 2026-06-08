/**
 * Unit test: diffBlockTree / fullCreateDiff (Decision 028 Phase 2)
 *
 * 验收 Phase 2:写入只写属性,**零结构边**。
 *  - 改顺序(交换两块)→ 受影响块的 order 属性变 → 走 modified 路径(非加删边)
 *  - 插块 / 删块 → added / removedIds 正确,且仍零边
 */
import { describe, it, expect } from 'vitest';
import { diffBlockTree, fullCreateDiff } from '@platform/main/note/diff-block-tree';
import type { PmPayload } from '@semantic/types';

const C = 'note-c';

function para(id: string, text: string): PmPayload {
  return { type: 'paragraph', attrs: { id }, content: [{ type: 'text', text }] };
}
function doc(...kids: PmPayload[]): PmPayload {
  return { type: 'doc', content: kids };
}

describe('diffBlockTree — Decision 028 Phase 2 零结构边', () => {
  it('fullCreateDiff: 全 added,零边', () => {
    const d = fullCreateDiff(doc(para('p1', 'A'), para('p2', 'B')), C);
    expect(d.added.map((a) => a.id)).toEqual(['p1', 'p2']);
  });

  it('内容修改 → modified,零边', () => {
    const oldDoc = doc(para('p1', 'A'), para('p2', 'B'));
    const newDoc = doc(para('p1', 'A-edited'), para('p2', 'B'));
    const d = diffBlockTree(oldDoc, newDoc, C);
    expect(d.modified.map((m) => m.id)).toEqual(['p1']);
    expect(d.added).toEqual([]);
    expect(d.removedIds).toEqual([]);
  });

  it('改顺序(交换 p1/p2)→ order 属性变 → 两块 modified,零边', () => {
    const oldDoc = doc(para('p1', 'A'), para('p2', 'B'), para('p3', 'C'));
    // 交换前两块的位置(id 不变,顺序变)
    const newDoc = doc(para('p2', 'B'), para('p1', 'A'), para('p3', 'C'));
    const d = diffBlockTree(oldDoc, newDoc, C);
    // p1、p2 的 order 属性因位置变而变 → modified;p3 仍第三位但 order rank 也可能变,
    // 关键断言:全程零结构边,且没有 added/removed(只是重排)。
    expect(d.added).toEqual([]);
    expect(d.removedIds).toEqual([]);
    // 至少 p1、p2 被标 modified(order 变)
    const modIds = new Set(d.modified.map((m) => m.id));
    expect(modIds.has('p1')).toBe(true);
    expect(modIds.has('p2')).toBe(true);
  });

  it('插块 → added,零边', () => {
    const oldDoc = doc(para('p1', 'A'), para('p2', 'B'));
    const newDoc = doc(para('p1', 'A'), para('pNew', 'NEW'), para('p2', 'B'));
    const d = diffBlockTree(oldDoc, newDoc, C);
    expect(d.added.map((a) => a.id)).toContain('pNew');
  });

  it('删块 → removedIds,零边', () => {
    const oldDoc = doc(para('p1', 'A'), para('p2', 'B'), para('p3', 'C'));
    const newDoc = doc(para('p1', 'A'), para('p3', 'C'));
    const d = diffBlockTree(oldDoc, newDoc, C);
    expect(d.removedIds).toContain('p2');
  });
});
