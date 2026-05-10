/**
 * EBookView — view 主组件(L5-C2 接 Host)
 *
 * **本段(C2)接入 ebook-rendering capability 的 Host**:订阅 onBookOpened 推流
 * → 通过 hostRef 命令式驱动 Host 加载 → 显示 PDF 内容。EBookToolbar 显文件名 +
 * 导航 + 缩放,通过 callbacks 驱动 hostRef。
 *
 * 见 docs/RefactorV2/v1-ebook-migration-plan.md v0.3 § 5 C2。
 *
 * LOC 红线(v0.3 § 3.1):≤150~200 行。本组件 ~150 行。
 *
 * 数据流:
 *   ws state(activeBookId)
 *      ↓ 切书 useEffect
 *   library.open(id)
 *      ↓ main 加载 buffer + 推 EBOOK_LOADED
 *   onBookOpened 推流(view 订阅)
 *      ↓
 *   hostRef.loadFromInfo(info) → Host 内部 PDFRenderer.load + 渲染
 *      ↓ Host 推 onPageChange / onScaleChange / onLoadComplete
 *   view 用 Toolbar 显示 currentPage / totalPages / scale
 *      ↓ saveProgress(debounce 500ms)
 *   main 写 bookshelf.json + ws state
 */

import {
  useSyncExternalStore,
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
} from 'react';
import { workspaceManager } from '@workspace/workspace-state/workspace-manager';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  EBookLibraryApi,
  EBookFileType,
} from '@capabilities/ebook-library/types';
import type {
  EBookRenderingApi,
  EBookHostHandle,
} from '@capabilities/ebook-rendering/types';
import { getEBookWsState, setReadingState } from './data-model';
import { EBookToolbar } from './EBookToolbar';
import './ebook.css';

interface EBookViewProps {
  workspaceId: string;
  payload?: unknown;
}

const SAVE_PROGRESS_DEBOUNCE_MS = 500;

export function EBookView({ workspaceId }: EBookViewProps) {
  const library = useMemo(
    () => requireCapabilityApi<EBookLibraryApi>('ebook-library'),
    [],
  );
  const Host = useMemo(
    () => requireCapabilityApi<EBookRenderingApi>('ebook-rendering').Host,
    [],
  );

  const hostRef = useRef<EBookHostHandle | null>(null);
  const activeBookIdRef = useRef<string | null>(null);

  // 订阅当前 ws 的 activeBookId(per-workspace)
  const wsState = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws ? getEBookWsState(ws) : null;
    },
  );

  const activeBookId = wsState?.activeBookId ?? null;

  // toolbar 显示状态(由 Host 推送)
  const [fileName, setFileName] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [fitWidth, setFitWidth] = useState(true);

  // 订阅 onBookOpened 推流 → 命令式驱动 Host
  useEffect(() => {
    return library.onBookOpened((info) => {
      setFileName(info.fileName);
      activeBookIdRef.current = info.bookId;
      void hostRef.current?.loadFromInfo(info);
    });
  }, [library]);

  // 启动 + 切书:有 activeBookId 时主动调 library.open()(触发 main 推 EBOOK_LOADED)
  useEffect(() => {
    if (!activeBookId) return;
    if (activeBookIdRef.current === activeBookId) return; // 已经是当前书,不重复 open
    void library.open(activeBookId).catch((err) => {
      console.warn('[ebook-view] open failed:', err);
    });
  }, [library, activeBookId]);

  // Host 加载完成 → 同步 totalPages
  const handleLoadComplete = useCallback(
    (info: { totalPages: number; fileType: EBookFileType }) => {
      setTotalPages(info.totalPages);
      setCurrentPage(1);
    },
    [],
  );

  // ── 持久化阅读位置(debounce 500ms)──

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistProgress = useCallback(
    (page: number, s: number, fw: boolean) => {
      const bookId = activeBookIdRef.current;
      if (!bookId) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void library.saveProgress(bookId, { page, scale: s, fitWidth: fw });
        setReadingState(workspaceId, {
          position: { page },
          scale: s,
          fitWidth: fw,
        });
      }, SAVE_PROGRESS_DEBOUNCE_MS);
    },
    [library, workspaceId],
  );

  const handlePageChangeFromHost = useCallback(
    (page: number) => {
      setCurrentPage(page);
      persistProgress(page, scale, fitWidth);
    },
    [persistProgress, scale, fitWidth],
  );

  const handleScaleChangeFromHost = useCallback(
    (s: number) => {
      setScale(s);
      // Host 内 setScale 调用都会让 fitWidth=false(用户主动调缩放即解除适应宽度)
      // 适应宽度的 scale 推送通过 toolbar select 切回"适应宽度"重新触发
      setFitWidth(false);
      persistProgress(currentPage, s, false);
    },
    [persistProgress, currentPage],
  );

  // ── Toolbar callbacks ──

  const handlePageChangeFromToolbar = useCallback((page: number) => {
    hostRef.current?.goToPage(page);
    setCurrentPage(page);
  }, []);

  const handleScaleChangeFromToolbar = useCallback(
    (s: number) => {
      hostRef.current?.setScale(s);
      setScale(s);
      setFitWidth(false);
      persistProgress(currentPage, s, false);
    },
    [persistProgress, currentPage],
  );

  const handleFitWidthToggleFromToolbar = useCallback(() => {
    const next = !fitWidth;
    hostRef.current?.setFitWidth(next);
    setFitWidth(next);
    if (next) persistProgress(currentPage, scale, true);
  }, [fitWidth, scale, currentPage, persistProgress]);

  if (!wsState) {
    return <div className="krig-ebook-empty">Workspace 未就绪</div>;
  }

  if (!activeBookId) {
    return (
      <div className="krig-ebook-empty">
        <div className="krig-ebook-empty-icon">📕</div>
        <div className="krig-ebook-empty-text">在左侧书架中选择电子书</div>
        <div className="krig-ebook-empty-hint">或点击 NavSide 顶部 + 导入</div>
      </div>
    );
  }

  return (
    <div className="krig-ebook-view" data-view-id="ebook-view">
      <EBookToolbar
        fileName={fileName}
        currentPage={currentPage}
        pageCount={totalPages}
        scale={scale}
        fitWidth={fitWidth}
        onPageChange={handlePageChangeFromToolbar}
        onScaleChange={handleScaleChangeFromToolbar}
        onFitWidthToggle={handleFitWidthToggleFromToolbar}
      />
      <div className="krig-ebook-view__body">
        <Host
          ref={hostRef}
          workspaceId={workspaceId}
          onPageChange={handlePageChangeFromHost}
          onLoadComplete={handleLoadComplete}
          onScaleChange={handleScaleChangeFromHost}
        />
      </div>
    </div>
  );
}
