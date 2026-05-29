/**
 * Unit test: storage filter extensions (P0)
 *
 * 验证 2026-05-29 data-layer-audit P0 新增的 3 个 filter 字段:
 *  - P0-1: EdgeFilter.subjectAtomIds + EdgeFilter.objectAtomIds (SQL IN)
 *  - P0-2: AtomFilter.atomIds (SQL IN — 替代 Promise.all getAtom 雪崩)
 *  - P0-3: EdgeFilter.objectLiteral (folder listFolders 走 SQL filter)
 *
 * 走 mock storage（不要 SurrealDB sidecar）；mock 行为与 SurrealStorage 字面对齐。
 *
 * 互斥 sanity check（单 id vs 批量 id 同时传 throw）由本测覆盖。
 * 空 array 短路（不降级为全扫）由本测覆盖。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMockStorage } from '../mocks/storage-mock';

describe('Storage filter extensions (P0)', () => {
  // 用单独的 mock 实例 (不复用 setup.ts 的 mockStorage 单例)
  let storage = createMockStorage();

  beforeEach(() => {
    storage = createMockStorage();
  });

  describe('P0-1: EdgeFilter.subjectAtomIds', () => {
    it('命中返回对应 edges', async () => {
      // setup: 3 个 atom + 3 条不同 subject 的 edges
      const a1 = await storage.putAtom({ payload: { domain: 'pm', payload: {} } });
      const a2 = await storage.putAtom({ payload: { domain: 'pm', payload: {} } });
      const a3 = await storage.putAtom({ payload: { domain: 'pm', payload: {} } });
      const target = await storage.putAtom({ payload: { domain: 'pm', payload: {} } });

      await storage.putEdge({
        predicate: 'user:krig:nextSibling',
        subject: { kind: 'atom', atomId: a1.id },
        object: { kind: 'atom', atomId: target.id },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });
      await storage.putEdge({
        predicate: 'user:krig:nextSibling',
        subject: { kind: 'atom', atomId: a2.id },
        object: { kind: 'atom', atomId: target.id },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });
      await storage.putEdge({
        predicate: 'user:krig:nextSibling',
        subject: { kind: 'atom', atomId: a3.id },
        object: { kind: 'atom', atomId: target.id },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });

      const out = await storage.listEdges({
        predicate: 'user:krig:nextSibling',
        subjectAtomIds: [a1.id, a2.id],
      });
      expect(out).toHaveLength(2);
      const got = new Set(out.map((e) => e.subject.atomId));
      expect(got.has(a1.id)).toBe(true);
      expect(got.has(a2.id)).toBe(true);
      expect(got.has(a3.id)).toBe(false);
    });

    it('空 array 短路返回 []（不降级为全扫）', async () => {
      // setup: 写一条 edge 进库，确保 "全扫返回非空" 与 "短路返回 []" 可区分
      const a = await storage.putAtom({ payload: { domain: 'pm', payload: {} } });
      const b = await storage.putAtom({ payload: { domain: 'pm', payload: {} } });
      await storage.putEdge({
        predicate: 'user:krig:nextSibling',
        subject: { kind: 'atom', atomId: a.id },
        object: { kind: 'atom', atomId: b.id },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });

      const out = await storage.listEdges({
        predicate: 'user:krig:nextSibling',
        subjectAtomIds: [],
      });
      expect(out).toEqual([]);
    });

    it('单 id + 批量 id 同时传 throw', async () => {
      await expect(
        storage.listEdges({
          predicate: 'user:krig:nextSibling',
          subjectAtomId: 'a',
          subjectAtomIds: ['a', 'b'],
        }),
      ).rejects.toThrow(/mutually exclusive/i);
    });
  });

  describe('P0-1: EdgeFilter.objectAtomIds', () => {
    it('命中返回对应 edges', async () => {
      const subj = await storage.putAtom({ payload: { domain: 'pm', payload: {} } });
      const o1 = await storage.putAtom({ payload: { domain: 'pm', payload: {} } });
      const o2 = await storage.putAtom({ payload: { domain: 'pm', payload: {} } });
      const o3 = await storage.putAtom({ payload: { domain: 'pm', payload: {} } });

      await storage.putEdge({
        predicate: 'user:krig:childOf',
        subject: { kind: 'atom', atomId: subj.id },
        object: { kind: 'atom', atomId: o1.id },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });
      await storage.putEdge({
        predicate: 'user:krig:childOf',
        subject: { kind: 'atom', atomId: subj.id },
        object: { kind: 'atom', atomId: o2.id },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });
      await storage.putEdge({
        predicate: 'user:krig:childOf',
        subject: { kind: 'atom', atomId: subj.id },
        object: { kind: 'atom', atomId: o3.id },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });

      const out = await storage.listEdges({
        predicate: 'user:krig:childOf',
        objectAtomIds: [o1.id, o3.id],
      });
      expect(out).toHaveLength(2);
      const got = new Set(out.map((e) => (e.object.kind === 'atom' ? e.object.atomId : '')));
      expect(got.has(o1.id)).toBe(true);
      expect(got.has(o3.id)).toBe(true);
      expect(got.has(o2.id)).toBe(false);
    });

    it('空 array 短路返回 []（不降级为全扫）', async () => {
      const out = await storage.listEdges({ objectAtomIds: [] });
      expect(out).toEqual([]);
    });
  });

  describe('P0-2: AtomFilter.atomIds', () => {
    it('命中返回对应 atoms', async () => {
      const a1 = await storage.putAtom({ payload: { domain: 'pm', payload: { tag: 'a1' } } });
      const a2 = await storage.putAtom({ payload: { domain: 'pm', payload: { tag: 'a2' } } });
      const a3 = await storage.putAtom({ payload: { domain: 'pm', payload: { tag: 'a3' } } });

      const out = await storage.listAtoms({ atomIds: [a1.id, a3.id] });
      expect(out).toHaveLength(2);
      const ids = new Set(out.map((a) => a.id));
      expect(ids.has(a1.id)).toBe(true);
      expect(ids.has(a3.id)).toBe(true);
      expect(ids.has(a2.id)).toBe(false);
    });

    it('空 array 短路返回 []（不降级为全扫）', async () => {
      // setup: 写一些 atom 进库
      await storage.putAtom({ payload: { domain: 'pm', payload: {} } });
      await storage.putAtom({ payload: { domain: 'pm', payload: {} } });

      const out = await storage.listAtoms({ atomIds: [] });
      expect(out).toEqual([]);
    });

    it('atomIds + domain 组合过滤生效', async () => {
      const pmA = await storage.putAtom({ payload: { domain: 'pm', payload: {} } });
      const folderA = await storage.putAtom({ payload: { domain: 'folder', payload: {} } });

      // 传两个 id 但 domain=pm 时,folder 那个被滤掉
      const out = await storage.listAtoms({
        domain: 'pm',
        atomIds: [pmA.id, folderA.id],
      });
      expect(out).toHaveLength(1);
      expect(out[0].id).toBe(pmA.id);
    });
  });

  describe('P1-1: storage.listMarkerAtoms', () => {
    it('基本命中 — atom + marker edge 都满足', async () => {
      // setup: 3 个 pm atom (note container) + 2 个 block atom (无 marker)
      const note1 = await storage.putAtom({ payload: { domain: 'pm', payload: { kind: 'container' } } });
      const note2 = await storage.putAtom({ payload: { domain: 'pm', payload: { kind: 'container' } } });
      const note3 = await storage.putAtom({ payload: { domain: 'pm', payload: { kind: 'container' } } });
      const block1 = await storage.putAtom({ payload: { domain: 'pm', payload: { kind: 'block' } } });
      await storage.putAtom({ payload: { domain: 'pm', payload: { kind: 'block' } } });

      // note1 / note2 有 hasNoteView marker (object 是 literal true);note3 无
      await storage.putEdge({
        predicate: 'user:krig:hasNoteView',
        subject: { kind: 'atom', atomId: note1.id },
        object: { kind: 'literal', type: 'boolean', value: true },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });
      await storage.putEdge({
        predicate: 'user:krig:hasNoteView',
        subject: { kind: 'atom', atomId: note2.id },
        object: { kind: 'literal', type: 'boolean', value: true },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });
      // 干扰 edge: block1 不是 note(无 marker)— 不应被返回
      void block1;

      const out = await storage.listMarkerAtoms({
        domain: 'pm',
        markerPredicate: 'user:krig:hasNoteView',
        markerObjectMatch: { kind: 'literal', type: 'boolean', value: true },
      });
      expect(out).toHaveLength(2);
      const ids = new Set(out.map((a) => a.id));
      expect(ids.has(note1.id)).toBe(true);
      expect(ids.has(note2.id)).toBe(true);
      expect(ids.has(note3.id)).toBe(false);
      expect(ids.has(block1.id)).toBe(false);
    });

    it('不带 markerObjectMatch — 只要 marker 边存在就算命中', async () => {
      const a1 = await storage.putAtom({ payload: { domain: 'folder', payload: { title: 'A' } } });
      const a2 = await storage.putAtom({ payload: { domain: 'folder', payload: { title: 'B' } } });
      const a3 = await storage.putAtom({ payload: { domain: 'folder', payload: { title: 'C' } } });

      // a1 / a2 有 folderForView 边(object 各异),a3 无
      await storage.putEdge({
        predicate: 'user:krig:folderForView',
        subject: { kind: 'atom', atomId: a1.id },
        object: { kind: 'literal', type: 'string', value: '__view__/note' },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });
      await storage.putEdge({
        predicate: 'user:krig:folderForView',
        subject: { kind: 'atom', atomId: a2.id },
        object: { kind: 'literal', type: 'string', value: '__view__/ebook' },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });

      // 不传 markerObjectMatch — a1 / a2 都应返
      const out = await storage.listMarkerAtoms({
        domain: 'folder',
        markerPredicate: 'user:krig:folderForView',
      });
      expect(out).toHaveLength(2);
      const ids = new Set(out.map((a) => a.id));
      expect(ids.has(a1.id)).toBe(true);
      expect(ids.has(a2.id)).toBe(true);
      expect(ids.has(a3.id)).toBe(false);
    });

    it('markerObjectMatch literal — 按 view marker 字符串过滤', async () => {
      const note1 = await storage.putAtom({ payload: { domain: 'folder', payload: { title: 'note-A' } } });
      const note2 = await storage.putAtom({ payload: { domain: 'folder', payload: { title: 'note-B' } } });
      const ebook1 = await storage.putAtom({ payload: { domain: 'folder', payload: { title: 'ebook-A' } } });

      await storage.putEdge({
        predicate: 'user:krig:folderForView',
        subject: { kind: 'atom', atomId: note1.id },
        object: { kind: 'literal', type: 'string', value: '__view__/note' },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });
      await storage.putEdge({
        predicate: 'user:krig:folderForView',
        subject: { kind: 'atom', atomId: note2.id },
        object: { kind: 'literal', type: 'string', value: '__view__/note' },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });
      await storage.putEdge({
        predicate: 'user:krig:folderForView',
        subject: { kind: 'atom', atomId: ebook1.id },
        object: { kind: 'literal', type: 'string', value: '__view__/ebook' },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });

      const out = await storage.listMarkerAtoms({
        domain: 'folder',
        markerPredicate: 'user:krig:folderForView',
        markerObjectMatch: { kind: 'literal', type: 'string', value: '__view__/note' },
      });
      expect(out).toHaveLength(2);
      const ids = new Set(out.map((a) => a.id));
      expect(ids.has(note1.id)).toBe(true);
      expect(ids.has(note2.id)).toBe(true);
      expect(ids.has(ebook1.id)).toBe(false);
    });

    it('markerObjectMatch atom — 按指向特定 atom 的 marker 过滤', async () => {
      const target = await storage.putAtom({ payload: { domain: 'pm', payload: {} } });
      const other = await storage.putAtom({ payload: { domain: 'pm', payload: {} } });
      const subj1 = await storage.putAtom({ payload: { domain: 'pm', payload: { kind: 'container' } } });
      const subj2 = await storage.putAtom({ payload: { domain: 'pm', payload: { kind: 'container' } } });

      // subj1 -> target, subj2 -> other
      await storage.putEdge({
        predicate: 'user:krig:hasNoteView',
        subject: { kind: 'atom', atomId: subj1.id },
        object: { kind: 'atom', atomId: target.id },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });
      await storage.putEdge({
        predicate: 'user:krig:hasNoteView',
        subject: { kind: 'atom', atomId: subj2.id },
        object: { kind: 'atom', atomId: other.id },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });

      const out = await storage.listMarkerAtoms({
        domain: 'pm',
        markerPredicate: 'user:krig:hasNoteView',
        markerObjectMatch: { kind: 'atom', atomId: target.id },
      });
      expect(out).toHaveLength(1);
      expect(out[0].id).toBe(subj1.id);
    });
  });

  describe('P0-3: EdgeFilter.objectLiteral', () => {
    it('命中返回 literal edges', async () => {
      const subj1 = await storage.putAtom({ payload: { domain: 'folder', payload: {} } });
      const subj2 = await storage.putAtom({ payload: { domain: 'folder', payload: {} } });
      const subj3 = await storage.putAtom({ payload: { domain: 'folder', payload: {} } });

      // subj1 -> "note", subj2 -> "ebook", subj3 -> "note"
      await storage.putEdge({
        predicate: 'user:krig:folderForView',
        subject: { kind: 'atom', atomId: subj1.id },
        object: { kind: 'literal', type: 'string', value: 'note' },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });
      await storage.putEdge({
        predicate: 'user:krig:folderForView',
        subject: { kind: 'atom', atomId: subj2.id },
        object: { kind: 'literal', type: 'string', value: 'ebook' },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });
      await storage.putEdge({
        predicate: 'user:krig:folderForView',
        subject: { kind: 'atom', atomId: subj3.id },
        object: { kind: 'literal', type: 'string', value: 'note' },
        attrs: { createdBy: 'test', createdAt: Date.now() },
      });

      const out = await storage.listEdges({
        predicate: 'user:krig:folderForView',
        objectLiteral: { type: 'string', value: 'note' },
      });
      expect(out).toHaveLength(2);
      const subjects = new Set(out.map((e) => e.subject.atomId));
      expect(subjects.has(subj1.id)).toBe(true);
      expect(subjects.has(subj3.id)).toBe(true);
      expect(subjects.has(subj2.id)).toBe(false);
    });
  });
});
