/**
 * Unit test: createNotesBatch (5B Stage 7 重做)
 *
 * 用例:
 *  1. 单 item 单 atom → 1 container + 1 block + 2 边 (hasNoteView + belongsToNote)
 *  2. 多 item all-or-nothing: 第 2 个抛错 → tx rollback → notes=0 + failures 字面登记
 *  3. tmpId → realId 映射: 含 parentTmpId 链 → childOf 边 subject/object 字面 realId
 *  4. dangling parentTmpId → throw "dangling parentTmpId"
 *  5. nextSibling 链: 顶层 3 atoms → 2 条 nextSibling 边 (A→B / B→C)
 *  6. broadcast 'final' 模式: 默认 final, 全部完成后字面 1 次 broadcastNoteListChanged
 */
import { describe, it, expect } from 'vitest';
import { createNotesBatch } from '@platform/main/note/capability-impl';
import { mockStorage, mockBroadcastNoteListChanged } from '../../mocks/storage-mock';
import type { PmAtomDraft } from '@semantic/types';

function paraDraft(tmpId: string, text: string, parentTmpId?: string): PmAtomDraft {
  const d: PmAtomDraft = {
    tmpId,
    payload: {
      domain: 'pm',
      payload: {
        type: 'paragraph',
        attrs: {},
        content: [{ type: 'text', text }],
      },
    },
  };
  if (parentTmpId) d.parentTmpId = parentTmpId;
  return d;
}

describe('createNotesBatch', () => {
  it('单 item 单 atom → 1 container + 1 block + 边集合', async () => {
    const result = await createNotesBatch({
      items: [
        {
          atoms: [paraDraft('tmp-0', 'hello')],
          folderId: null,
          titleHint: 'Title',
        },
      ],
    });
    expect(result.failures).toEqual([]);
    expect(result.notes).toHaveLength(1);

    // 1 container + 1 block = 2 atoms
    expect(mockStorage._atoms.size).toBe(2);
    // hasNoteView (container → boolean) + belongsToNote (block → container)
    const edges = [...mockStorage._edges.values()];
    const hasView = edges.filter((e) => e.predicate === 'user:krig:hasNoteView');
    const belongs = edges.filter((e) => e.predicate === 'user:krig:belongsToNote');
    expect(hasView).toHaveLength(1);
    expect(belongs).toHaveLength(1);
  });

  it('多 item all-or-nothing: 第 2 item 内 putAtom 抛错 → tx rollback', async () => {
    // 先看第 1 item 字面会 putAtom 几次:
    //   container 1 + 1 atom = 2 puts.
    // 第 2 item: container 1 + 1 atom = 2 puts (3rd 触发 throw 让第 2 item 失败)
    mockStorage._failOnPutAtomNthCall = 3;

    const result = await createNotesBatch({
      items: [
        { atoms: [paraDraft('tmp-0', 'A')], folderId: null },
        { atoms: [paraDraft('tmp-0', 'B')], folderId: null },
        { atoms: [paraDraft('tmp-0', 'C')], folderId: null },
      ],
    });

    // 单事务整体 rollback
    expect(result.notes).toEqual([]);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures[0].rolledBack).toBe(true);

    // 关键:rollback 后字面 0 atom 写入
    expect(mockStorage._atoms.size).toBe(0);
    expect(mockStorage._edges.size).toBe(0);
  });

  it('tmpId → realId 映射: 含 parentTmpId 链 → childOf 边 subject/object 字面 realId', async () => {
    const drafts: PmAtomDraft[] = [
      paraDraft('parent-tmp', 'outer'),
      paraDraft('child-tmp', 'inner', 'parent-tmp'),
    ];
    const result = await createNotesBatch({
      items: [{ atoms: drafts, folderId: null }],
    });
    expect(result.failures).toEqual([]);

    const edges = [...mockStorage._edges.values()];
    const childOfEdges = edges.filter((e) => e.predicate === 'user:krig:childOf');
    expect(childOfEdges).toHaveLength(1);

    // 字面 subject/object 都不应是 'parent-tmp'/'child-tmp' (tmpId)
    const e = childOfEdges[0];
    expect(e.subject.atomId).not.toBe('child-tmp');
    expect(e.object.kind).toBe('atom');
    if (e.object.kind === 'atom') {
      expect(e.object.atomId).not.toBe('parent-tmp');
    }
    // realIds 字面存在于 storage
    expect(mockStorage._atoms.has(e.subject.atomId)).toBe(true);
    if (e.object.kind === 'atom') {
      expect(mockStorage._atoms.has(e.object.atomId)).toBe(true);
    }
  });

  it('dangling parentTmpId → throw + rollback', async () => {
    const drafts: PmAtomDraft[] = [
      paraDraft('tmp-0', 'X'),
      paraDraft('tmp-1', 'Y', 'no-such-parent'),
    ];
    const result = await createNotesBatch({
      items: [{ atoms: drafts, folderId: null }],
    });
    expect(result.notes).toEqual([]);
    expect(result.failures.length).toBeGreaterThan(0);
    // 字面 rollback — storage 内 0 atom
    expect(mockStorage._atoms.size).toBe(0);
    // error message 字面含 'dangling parentTmpId'
    expect(result.failures[0].error).toMatch(/dangling parentTmpId/);
  });

  it('nextSibling 链: 顶层 3 atoms → 2 条 nextSibling 边', async () => {
    const drafts: PmAtomDraft[] = [
      paraDraft('a', 'A'),
      paraDraft('b', 'B'),
      paraDraft('c', 'C'),
    ];
    const result = await createNotesBatch({
      items: [{ atoms: drafts, folderId: null }],
    });
    expect(result.failures).toEqual([]);

    const edges = [...mockStorage._edges.values()];
    const ns = edges.filter((e) => e.predicate === 'user:krig:nextSibling');
    expect(ns).toHaveLength(2);
  });

  it('broadcast final 模式: 默认全部完成后 1 次 broadcastNoteListChanged', async () => {
    await createNotesBatch({
      items: [
        { atoms: [paraDraft('tmp-0', 'A')], folderId: null },
        { atoms: [paraDraft('tmp-0', 'B')], folderId: null },
      ],
    });
    expect(mockBroadcastNoteListChanged).toHaveBeenCalledTimes(1);
  });

  it('空 items → notes=[] failures=[] 不 broadcast', async () => {
    const r = await createNotesBatch({ items: [] });
    expect(r.notes).toEqual([]);
    expect(r.failures).toEqual([]);
    expect(mockBroadcastNoteListChanged).not.toHaveBeenCalled();
  });
});
