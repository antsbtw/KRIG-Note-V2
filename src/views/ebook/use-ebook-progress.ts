/**
 * useEBookProgress — 阅读位置持久化 hook(L5-C3)
 *
 * 从 EBookView.tsx C2 版抽出(应对 C3 扩展导致 LOC 超红线 — 详见
 * v0.3 § 3.1 LOC 红线表 + C2 completion § 4.4)。
 *
 * 职责:
 * - debounce 500ms 双写:
 *   1) library.saveProgress(JSON 文件,全局最后位置)
 *   2) setReadingState(pluginStates['ebook-view'],per-ws 上次位置)
 * - 管理活跃 bookId(由订阅 onBookOpened 推流写入)
 * - PDF 路径:page + scale + fitWidth
 * - EPUB 路径:cfi(C3 加)
 *
 * 用法(view 端):
 *   const { activeBookIdRef, persistPdfProgress, persistEpubProgress } =
 *     useEBookProgress(workspaceId);
 *   // onBookOpened: activeBookIdRef.current = info.bookId
 *   // pdf 切页 / 缩放: persistPdfProgress(page, scale, fitWidth)
 *   // epub relocate: persistEpubProgress(cfi)
 */

import { useCallback, useRef } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { EBookLibraryApi } from '@capabilities/ebook-library/types';
import { setReadingState } from './data-model';

const SAVE_PROGRESS_DEBOUNCE_MS = 500;

export function useEBookProgress(workspaceId: string) {
  const activeBookIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const libraryRef = useRef<EBookLibraryApi | null>(null);

  if (!libraryRef.current) {
    libraryRef.current = requireCapabilityApi<EBookLibraryApi>('ebook-library');
  }

  const persistPdfProgress = useCallback(
    (page: number, scale: number, fitWidth: boolean) => {
      const bookId = activeBookIdRef.current;
      if (!bookId) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void libraryRef.current?.saveProgress(bookId, { page, scale, fitWidth });
        setReadingState(workspaceId, {
          position: { page },
          scale,
          fitWidth,
        });
      }, SAVE_PROGRESS_DEBOUNCE_MS);
    },
    [workspaceId],
  );

  const persistEpubProgress = useCallback(
    (cfi: string) => {
      const bookId = activeBookIdRef.current;
      if (!bookId) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void libraryRef.current?.saveProgress(bookId, { cfi });
        setReadingState(workspaceId, {
          position: { cfi },
        });
      }, SAVE_PROGRESS_DEBOUNCE_MS);
    },
    [workspaceId],
  );

  return {
    activeBookIdRef,
    persistPdfProgress,
    persistEpubProgress,
  };
}
