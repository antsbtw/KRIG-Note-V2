/**
 * useBookmarks — 书签 hook(L5-C4)
 *
 * V1 → V2 改写:src/plugins/ebook/hooks/useBookmarks.ts(61 行)。
 * 改动:接 host 命令式 API + ebook-library API,**不直接消费 renderer**
 * (decoupling 让 view 不感知 renderer 细节)。
 *
 * - PDF:页码书签(bookmarks: number[])
 * - EPUB:CFI 书签(cfiBookmarks: { cfi, label }[])
 * - toggleBookmark(currentPage):
 *   - fixed-page → ebookBookmarkToggle(bookId, page)
 *   - reflowable → 取 host.getCurrentCFI(),已有→remove / 没有→add
 * - isBookmarked(currentPage):
 *   - fixed-page → bookmarks.includes(page)
 *   - reflowable → cfiBookmarks 有当前 cfi
 *
 * 用法(view 端):
 *   const bookmarks = useBookmarks(hostRef, bookId, epubChapter);
 *   bookmarks.loadOnBookOpen(bookId)  // onBookOpened 时调
 *   <ToolbarBtn onClick={() => bookmarks.toggle(currentPage)}
 *               active={bookmarks.isBookmarked(currentPage)} />
 */

import { useState, useCallback } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { EBookLibraryApi } from '@capabilities/ebook-library/types';
import type { EBookHostHandle } from '../Host';

export function useBookmarks(
  hostRef: React.RefObject<EBookHostHandle | null>,
  /** 当前活跃 bookId(由 view 通过 onBookOpened 更新)*/
  bookIdRef: React.RefObject<string | null>,
  /** EPUB 当前章节(用作 CFI 书签的 label)*/
  currentChapter: string,
) {
  const [bookmarks, setBookmarks] = useState<number[]>([]);
  const [cfiBookmarks, setCfiBookmarks] = useState<
    Array<{ cfi: string; label: string }>
  >([]);

  /** 当书加载后调,从 IPC 拿当前书的全部书签 */
  const loadOnBookOpen = useCallback((bookId: string) => {
    const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
    void lib.bookmarkList(bookId).then(setBookmarks);
    void lib.cfiBookmarkList(bookId).then(setCfiBookmarks);
  }, []);

  /** PDF 切页 / EPUB 切章节 时调:Cmd+D 触发 */
  const toggle = useCallback(
    async (currentPage: number) => {
      const bookId = bookIdRef.current;
      const host = hostRef.current;
      if (!bookId || !host) return;

      const lib = requireCapabilityApi<EBookLibraryApi>('ebook-library');
      const mode = host.getRenderMode();

      if (mode === 'fixed-page') {
        const next = await lib.bookmarkToggle(bookId, currentPage);
        setBookmarks(next);
        return;
      }
      if (mode === 'reflowable') {
        const cfi = host.getCurrentCFI();
        if (!cfi) return;
        const existing = cfiBookmarks.find((b) => b.cfi === cfi);
        if (existing) {
          const next = await lib.cfiBookmarkRemove(bookId, cfi);
          setCfiBookmarks(next);
        } else {
          const next = await lib.cfiBookmarkAdd(bookId, cfi, currentChapter);
          setCfiBookmarks(next);
        }
      }
    },
    [bookIdRef, hostRef, cfiBookmarks, currentChapter],
  );

  const isBookmarked = useCallback(
    (currentPage: number): boolean => {
      const host = hostRef.current;
      if (!host) return false;
      const mode = host.getRenderMode();
      if (mode === 'fixed-page') {
        return bookmarks.includes(currentPage);
      }
      if (mode === 'reflowable') {
        const cfi = host.getCurrentCFI();
        return cfi !== null && cfiBookmarks.some((b) => b.cfi === cfi);
      }
      return false;
    },
    [hostRef, bookmarks, cfiBookmarks],
  );

  return {
    bookmarks,
    cfiBookmarks,
    loadOnBookOpen,
    toggle,
    isBookmarked,
  };
}
