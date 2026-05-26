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

import { useCallback, useEffect, useRef } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { EBookLibraryApi } from '@capabilities/ebook-library/types';
import { setReadingState } from './data-model';

// 500ms 太长 — 用户改 scale 后立即 Cmd+Q 关 app,timer 不触发数据丢。
// 100ms 平衡:连续操作仍合并写,常规改完手离开就足够触发。
// 配合 beforeunload flush(下方)双保险。
const SAVE_PROGRESS_DEBOUNCE_MS = 100;

type PendingPayload =
  | { kind: 'pdf'; bookId: string; page: number; scale: number; fitWidth: boolean }
  | { kind: 'epub'; bookId: string; cfi: string };

export function useEBookProgress(workspaceId: string) {
  const activeBookIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const libraryRef = useRef<EBookLibraryApi | null>(null);
  // 待 flush 的 payload — debounce 内 Cmd+Q 时 beforeunload 同步写
  const pendingRef = useRef<PendingPayload | null>(null);

  if (!libraryRef.current) {
    libraryRef.current = requireCapabilityApi<EBookLibraryApi>('ebook-library');
  }

  const persistPdfProgress = useCallback(
    (page: number, scale: number, fitWidth: boolean) => {
      const bookId = activeBookIdRef.current;
      if (!bookId) return;
      pendingRef.current = { kind: 'pdf', bookId, page, scale, fitWidth };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void libraryRef.current?.saveProgress(bookId, { page, scale, fitWidth });
        setReadingState(workspaceId, {
          position: { page },
          scale,
          fitWidth,
        });
        pendingRef.current = null;
      }, SAVE_PROGRESS_DEBOUNCE_MS);
    },
    [workspaceId],
  );

  const persistEpubProgress = useCallback(
    (cfi: string) => {
      const bookId = activeBookIdRef.current;
      if (!bookId) return;
      pendingRef.current = { kind: 'epub', bookId, cfi };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void libraryRef.current?.saveProgress(bookId, { cfi });
        setReadingState(workspaceId, {
          position: { cfi },
        });
        pendingRef.current = null;
      }, SAVE_PROGRESS_DEBOUNCE_MS);
    },
    [workspaceId],
  );

  // beforeunload flush:Cmd+Q 关 app 时 debounce timer 没触发 → 强制同步写
  useEffect(() => {
    const flush = (): void => {
      const pending = pendingRef.current;
      if (!pending) return;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      // libraryRef.saveProgress 走 IPC,在 beforeunload 内调 ipcRenderer.send
      // 是同步派发(send 不等返回),main 进程 ipcMain.on handler 仍会执行写盘。
      if (pending.kind === 'pdf') {
        void libraryRef.current?.saveProgress(pending.bookId, {
          page: pending.page,
          scale: pending.scale,
          fitWidth: pending.fitWidth,
        });
      } else {
        void libraryRef.current?.saveProgress(pending.bookId, { cfi: pending.cfi });
      }
      pendingRef.current = null;
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  return {
    activeBookIdRef,
    persistPdfProgress,
    persistEpubProgress,
  };
}
