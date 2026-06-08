/**
 * Unit test: createNotesBatch (5B Stage 7 重做)
 *
 * 用例(Decision 028 Phase 2 起:零结构边,结构靠 atom 属性 noteId/parentId/order):
 *  1. 单 item 单 atom → 1 container + 1 block;hasNoteView 边保留,belongsToNote 边=0,block 带 noteId 属性
 *  2. 多 item all-or-nothing: 第 2 个抛错 → tx rollback → notes=0 + failures 字面登记
 *  3. tmpId → realId 映射: 含 parentTmpId 链 → child.parentId 属性=父 realId(零 childOf 边)
 *  4. dangling parentTmpId → throw "dangling parentTmpId"
 *  5. 顶层 3 atoms 顺序: order 属性 A<B<C 升序(零 nextSibling 边)
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
    // Decision 028 Phase 2:hasNoteView 仍有(note marker,非结构边);
    // 结构边 belongsToNote 不再写 —— block atom 自带 noteId 属性。
    const edges = [...mockStorage._edges.values()];
    const hasView = edges.filter((e) => e.predicate === 'user:krig:hasNoteView');
    const belongs = edges.filter((e) => e.predicate === 'user:krig:belongsToNote');
    expect(hasView).toHaveLength(1);
    expect(belongs).toHaveLength(0);
    // block atom 带 noteId/parentId/order 属性
    const containerId = result.notes[0].id;
    const block = [...mockStorage._atoms.values()].find((a) => a.id !== containerId)!;
    const battrs = (block.payload.payload as { attrs?: Record<string, unknown> }).attrs!;
    expect(battrs.noteId).toBe(containerId);
    expect(battrs.parentId).toBe(null);
    expect(typeof battrs.order).toBe('string');
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

  it('tmpId → realId 映射: 含 parentTmpId 链 → child.parentId 属性字面 realId(零 childOf 边)', async () => {
    const drafts: PmAtomDraft[] = [
      paraDraft('parent-tmp', 'outer'),
      paraDraft('child-tmp', 'inner', 'parent-tmp'),
    ];
    const result = await createNotesBatch({
      items: [{ atoms: drafts, folderId: null }],
    });
    expect(result.failures).toEqual([]);

    // Decision 028 Phase 2:不再写 childOf 边,父子关系靠 child atom 的 parentId 属性
    const edges = [...mockStorage._edges.values()];
    expect(edges.filter((e) => e.predicate === 'user:krig:childOf')).toHaveLength(0);

    const containerId = result.notes[0].id;
    const blocks = [...mockStorage._atoms.values()].filter((a) => a.id !== containerId);
    const attrsOf = (a: (typeof blocks)[number]) =>
      (a.payload.payload as { attrs?: Record<string, unknown> }).attrs!;
    const parent = blocks.find((b) => {
      const c = b.payload.payload as { content?: Array<{ text?: string }> };
      return c.content?.[0]?.text === 'outer';
    })!;
    const child = blocks.find((b) => {
      const c = b.payload.payload as { content?: Array<{ text?: string }> };
      return c.content?.[0]?.text === 'inner';
    })!;
    // child.parentId 字面 == parent 的 realId(不是 tmpId);parent.parentId == null
    expect(attrsOf(parent).parentId).toBe(null);
    expect(attrsOf(child).parentId).toBe(parent.id);
    expect(attrsOf(child).parentId).not.toBe('parent-tmp');
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

  it('顶层 3 atoms 顺序: order 属性按 A<B<C 升序(零 nextSibling 边)', async () => {
    const drafts: PmAtomDraft[] = [
      paraDraft('a', 'A'),
      paraDraft('b', 'B'),
      paraDraft('c', 'C'),
    ];
    const result = await createNotesBatch({
      items: [{ atoms: drafts, folderId: null }],
    });
    expect(result.failures).toEqual([]);

    // Decision 028 Phase 2:不再写 nextSibling 边,顺序靠 order 字典序属性
    const edges = [...mockStorage._edges.values()];
    expect(edges.filter((e) => e.predicate === 'user:krig:nextSibling')).toHaveLength(0);

    const containerId = result.notes[0].id;
    const blocks = [...mockStorage._atoms.values()].filter((a) => a.id !== containerId);
    const orderOf = (text: string): string => {
      const b = blocks.find((x) => {
        const c = x.payload.payload as { content?: Array<{ text?: string }> };
        return c.content?.[0]?.text === text;
      })!;
      return (b.payload.payload as { attrs?: { order?: string } }).attrs!.order!;
    };
    expect(orderOf('A') < orderOf('B')).toBe(true);
    expect(orderOf('B') < orderOf('C')).toBe(true);
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
