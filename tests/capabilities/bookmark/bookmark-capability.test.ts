/**
 * Unit test: bookmark capability (web view 书签树, 书签步骤1 数据层)
 *
 * 数据层背书(走 storage-mock,vi.mock('@storage/index') 在 tests/setup.ts):
 *  1. add 无 folder → 1 bookmark atom,0 inFolder 边,folderId=null
 *  2. add 带 folder → 1 atom + 1 inFolder 边(subject=bookmark, object=folder)
 *  3. add title 空 → 兜底用 url
 *  4. list → 扁平,按 createdAt 倒序;folderId 派生自 inFolder 边
 *  5. rename → payload.title 改;title 空兜底 url
 *  6. moveToFolder null→folder→另一 folder→null:edge 增删切换
 *  7. remove → atom 删 + inFolder 边级联删(storage.deleteAtom 级联)
 */
import { describe, it, expect } from 'vitest';
import {
  add,
  list,
  rename,
  remove,
  moveToFolder,
} from '@platform/main/bookmark/capability-impl';
import { mockStorage } from '../../mocks/storage-mock';

const IN_FOLDER = 'user:krig:inFolder';

function bookmarkAtoms(): unknown[] {
  return [...mockStorage._atoms.values()].filter(
    (a) => a.payload.domain === 'bookmark',
  );
}

function inFolderEdges() {
  return [...mockStorage._edges.values()].filter((e) => e.predicate === IN_FOLDER);
}

describe('bookmark capability', () => {
  it('add 无 folder → 1 bookmark atom, 0 inFolder 边, folderId=null', async () => {
    const info = await add('https://example.com', 'Example');
    expect(info.url).toBe('https://example.com');
    expect(info.title).toBe('Example');
    expect(info.folderId).toBeNull();
    expect(bookmarkAtoms()).toHaveLength(1);
    expect(inFolderEdges()).toHaveLength(0);
  });

  it('add 带 folder → 1 atom + 1 inFolder 边 (subject=bookmark, object=folder)', async () => {
    const info = await add('https://a.com', 'A', 'folder-1');
    expect(info.folderId).toBe('folder-1');
    const edges = inFolderEdges();
    expect(edges).toHaveLength(1);
    expect(edges[0].subject.atomId).toBe(info.id);
    expect(edges[0].object).toEqual({ kind: 'atom', atomId: 'folder-1' });
  });

  it('add title 空 → 兜底用 url', async () => {
    const info = await add('https://b.com', '');
    expect(info.title).toBe('https://b.com');
  });

  it('list → 扁平 + createdAt 倒序 + folderId 派生', async () => {
    const first = await add('https://1.com', 'one');
    // 保证 createdAt 严格递增(Date.now() 同毫秒会破坏排序断言)
    await new Promise((r) => setTimeout(r, 2));
    const second = await add('https://2.com', 'two', 'folder-x');
    const all = await list();
    expect(all).toHaveLength(2);
    // 倒序:second 先
    expect(all[0].id).toBe(second.id);
    expect(all[1].id).toBe(first.id);
    expect(all[0].folderId).toBe('folder-x');
    expect(all[1].folderId).toBeNull();
  });

  it('rename → payload.title 改;空兜底 url', async () => {
    const info = await add('https://c.com', 'C');
    await rename(info.id, 'C-renamed');
    let all = await list();
    expect(all[0].title).toBe('C-renamed');
    await rename(info.id, '');
    all = await list();
    expect(all[0].title).toBe('https://c.com');
  });

  it('moveToFolder: null→f1→f2→null edge 增删切换', async () => {
    const info = await add('https://d.com', 'D');
    expect(inFolderEdges()).toHaveLength(0);

    await moveToFolder(info.id, 'f1');
    let edges = inFolderEdges();
    expect(edges).toHaveLength(1);
    expect(edges[0].object).toEqual({ kind: 'atom', atomId: 'f1' });

    await moveToFolder(info.id, 'f2');
    edges = inFolderEdges();
    expect(edges).toHaveLength(1);
    expect(edges[0].object).toEqual({ kind: 'atom', atomId: 'f2' });

    await moveToFolder(info.id, null);
    expect(inFolderEdges()).toHaveLength(0);

    const all = await list();
    expect(all[0].folderId).toBeNull();
  });

  it('remove → atom 删 + inFolder 边级联删', async () => {
    const info = await add('https://e.com', 'E', 'folder-z');
    expect(bookmarkAtoms()).toHaveLength(1);
    expect(inFolderEdges()).toHaveLength(1);

    await remove(info.id);
    expect(bookmarkAtoms()).toHaveLength(0);
    expect(inFolderEdges()).toHaveLength(0);
  });

  it('remove 非 bookmark domain id → no-op (防御)', async () => {
    // 不存在的 id,getAtom 返 null → 直接 return,不抛
    await remove('nonexistent-id');
    expect(bookmarkAtoms()).toHaveLength(0);
  });
});
