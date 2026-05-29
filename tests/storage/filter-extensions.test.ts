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
