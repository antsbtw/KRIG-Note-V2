/**
 * Unit test: parseChromeBookmarks (web 书签步骤3 Chrome 导入)
 *
 * 用例:
 *  1. 嵌套 folder + url → 顶层 root 作 folder + 子 folder + bookmark,parentTempId 正确串联
 *  2. 空 folder → folder 建,无 bookmark
 *  3. url 节点缺 name → title 用 url host 兜底
 *  4. url 节点缺 url → 跳过(无法落库)
 *  5. 缺 children → 当空,不崩
 *  6. 非 url/folder type → 跳过
 *  7. 无 roots / 非对象 → 空结果(不崩)
 *  8. bookmark_bar / other / synced 各作顶层 folder
 *  9. folder 缺 name → 兜底名
 */
import { describe, it, expect } from 'vitest';
import { parseChromeBookmarks } from '@platform/main/bookmark/chrome-import';

describe('parseChromeBookmarks', () => {
  it('嵌套 folder + url:层级串联,parentTempId 正确', () => {
    const json = {
      roots: {
        bookmark_bar: {
          type: 'folder',
          name: '书签栏',
          children: [
            { type: 'url', name: 'Example', url: 'https://example.com/' },
            {
              type: 'folder',
              name: 'Dev',
              children: [
                { type: 'url', name: 'GitHub', url: 'https://github.com/' },
              ],
            },
          ],
        },
      },
    };

    const { folders, bookmarks } = parseChromeBookmarks(json);

    // 2 folder: 书签栏(顶层) + Dev(子)
    expect(folders).toHaveLength(2);
    const bar = folders.find((f) => f.name === '书签栏');
    const dev = folders.find((f) => f.name === 'Dev');
    expect(bar).toBeDefined();
    expect(dev).toBeDefined();
    expect(bar!.parentTempId).toBeNull(); // 顶层
    expect(dev!.parentTempId).toBe(bar!.tempId); // Dev 挂书签栏

    // 2 bookmark
    expect(bookmarks).toHaveLength(2);
    const example = bookmarks.find((b) => b.title === 'Example');
    const github = bookmarks.find((b) => b.title === 'GitHub');
    expect(example!.parentTempId).toBe(bar!.tempId);
    expect(github!.parentTempId).toBe(dev!.tempId);
  });

  it('空 folder:folder 建,无 bookmark', () => {
    const json = {
      roots: {
        bookmark_bar: {
          type: 'folder',
          name: 'Bar',
          children: [{ type: 'folder', name: 'Empty', children: [] }],
        },
      },
    };
    const { folders, bookmarks } = parseChromeBookmarks(json);
    expect(folders.map((f) => f.name).sort()).toEqual(['Bar', 'Empty']);
    expect(bookmarks).toHaveLength(0);
  });

  it('url 缺 name → title 用 host 兜底', () => {
    const json = {
      roots: {
        bookmark_bar: {
          type: 'folder',
          name: 'Bar',
          children: [{ type: 'url', url: 'https://news.ycombinator.com/item?id=1' }],
        },
      },
    };
    const { bookmarks } = parseChromeBookmarks(json);
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0].title).toBe('news.ycombinator.com');
    expect(bookmarks[0].url).toBe('https://news.ycombinator.com/item?id=1');
  });

  it('url 缺 url → 跳过', () => {
    const json = {
      roots: {
        bookmark_bar: {
          type: 'folder',
          name: 'Bar',
          children: [
            { type: 'url', name: 'no-url' },
            { type: 'url', name: 'ok', url: 'https://ok.com/' },
          ],
        },
      },
    };
    const { bookmarks } = parseChromeBookmarks(json);
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0].title).toBe('ok');
  });

  it('缺 children → 当空,不崩', () => {
    const json = {
      roots: {
        bookmark_bar: { type: 'folder', name: 'Bar' }, // 无 children
      },
    };
    const { folders, bookmarks } = parseChromeBookmarks(json);
    expect(folders).toHaveLength(1);
    expect(folders[0].name).toBe('Bar');
    expect(bookmarks).toHaveLength(0);
  });

  it('非 url/folder type → 跳过', () => {
    const json = {
      roots: {
        bookmark_bar: {
          type: 'folder',
          name: 'Bar',
          children: [
            { type: 'unknown', name: 'weird' },
            null,
            'garbage',
            { type: 'url', name: 'ok', url: 'https://ok.com/' },
          ],
        },
      },
    };
    const { folders, bookmarks } = parseChromeBookmarks(json);
    expect(folders).toHaveLength(1);
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0].title).toBe('ok');
  });

  it('无 roots / 非对象 → 空结果(不崩)', () => {
    expect(parseChromeBookmarks(null)).toEqual({ folders: [], bookmarks: [] });
    expect(parseChromeBookmarks(undefined)).toEqual({ folders: [], bookmarks: [] });
    expect(parseChromeBookmarks(42)).toEqual({ folders: [], bookmarks: [] });
    expect(parseChromeBookmarks({})).toEqual({ folders: [], bookmarks: [] });
    expect(parseChromeBookmarks({ roots: {} })).toEqual({ folders: [], bookmarks: [] });
  });

  it('bookmark_bar / other / synced 各作顶层 folder', () => {
    const json = {
      roots: {
        bookmark_bar: { type: 'folder', name: '书签栏', children: [] },
        other: { type: 'folder', name: '其他书签', children: [] },
        synced: { type: 'folder', name: '已同步', children: [] },
      },
    };
    const { folders } = parseChromeBookmarks(json);
    expect(folders).toHaveLength(3);
    expect(folders.every((f) => f.parentTempId === null)).toBe(true);
    expect(folders.map((f) => f.name)).toEqual(['书签栏', '其他书签', '已同步']);
  });

  it('folder 缺 name → 兜底名', () => {
    const json = {
      roots: {
        bookmark_bar: {
          type: 'folder',
          // 顶层缺 name → 用 key 'bookmark_bar'
          children: [{ type: 'folder', children: [] }], // 子缺 name → 'Untitled folder'
        },
      },
    };
    const { folders } = parseChromeBookmarks(json);
    expect(folders.map((f) => f.name).sort()).toEqual(['Untitled folder', 'bookmark_bar']);
  });
});
