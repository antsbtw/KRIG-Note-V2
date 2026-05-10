/**
 * EBookView — view 主组件(L5-C3 扩展)
 *
 * **本段(C3)** 在 C2 基础上加:
 * - EPUB 渲染分支(renderMode='reflowable',章节翻页 + 字号 + 进度)
 * - OutlinePanel 侧栏(toolbar ☰ 切换)
 * - SearchBar 搜索栏(toolbar 🔍 + Cmd+F 触发)
 * - keymap:Cmd+F 开搜索;EPUB 模式 ←/→ 翻章节
 * - 持久化逻辑拆到 use-ebook-progress.ts(应对 LOC 红线)
 *
 * 见 docs/RefactorV2/v1-ebook-migration-plan.md v0.3 § 5 C3。
 *
 * LOC 红线(v0.3 § 3.1):≤150~200 行。本组件 ~190 行(略超 12 行,接受;
 * 进一步瘦身要继续拆 hook 但本段就此打住)。
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
import type { EBookLibraryApi } from '@capabilities/ebook-library/types';
import type {
  EBookRenderingApi,
  EBookHostHandle,
} from '@capabilities/ebook-rendering/types';
import { getEBookWsState } from './data-model';
import { useEBookProgress } from './use-ebook-progress';
import { EBookToolbar, type EBookToolbarRenderMode } from './EBookToolbar';
import './ebook.css';

interface EBookViewProps {
  workspaceId: string;
  payload?: unknown;
}

export function EBookView({ workspaceId }: EBookViewProps) {
  const library = useMemo(
    () => requireCapabilityApi<EBookLibraryApi>('ebook-library'),
    [],
  );
  const rendering = useMemo(
    () => requireCapabilityApi<EBookRenderingApi>('ebook-rendering'),
    [],
  );
  const { Host, OutlinePanel, SearchBar, useSearch } = rendering;

  const hostRef = useRef<EBookHostHandle | null>(null);
  const { activeBookIdRef, persistPdfProgress, persistEpubProgress } =
    useEBookProgress(workspaceId);

  const wsState = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => {
      const ws = workspaceManager.get(workspaceId);
      return ws ? getEBookWsState(ws) : null;
    },
  );
  const activeBookId = wsState?.activeBookId ?? null;

  // toolbar 显示状态
  const [fileName, setFileName] = useState('');
  const [renderMode, setRenderMode] = useState<EBookToolbarRenderMode>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [fitWidth, setFitWidth] = useState(true);
  const [epubChapter, setEpubChapter] = useState('');
  const [epubPercentage, setEpubPercentage] = useState(0);
  const [fontSize, setFontSize] = useState(100);

  // sidebar 开关 + 搜索
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const search = useSearch(hostRef);

  // 订阅 onBookOpened 推流 → 命令式驱动 Host
  useEffect(() => {
    return library.onBookOpened((info) => {
      setFileName(info.fileName);
      activeBookIdRef.current = info.bookId;
      void hostRef.current?.loadFromInfo(info);
    });
  }, [library, activeBookIdRef]);

  // 启动 + 切书:有 activeBookId 时主动调 library.open() 触发 EBOOK_LOADED
  useEffect(() => {
    if (!activeBookId || activeBookIdRef.current === activeBookId) return;
    void library.open(activeBookId).catch((err) => {
      console.warn('[ebook-view] open failed:', err);
    });
  }, [library, activeBookId, activeBookIdRef]);

  // Host onLoadComplete:同步 totalPages + renderMode + 字号(EPUB)
  const handleLoadComplete = useCallback(
    (info: {
      totalPages: number;
      fileType: string;
      renderMode: 'fixed-page' | 'reflowable';
    }) => {
      setRenderMode(info.renderMode);
      setTotalPages(info.totalPages);
      setCurrentPage(1);
      if (info.renderMode === 'reflowable') {
        setFontSize(hostRef.current?.getFontSize() ?? 100);
      }
    },
    [],
  );

  const handlePageChangeFromHost = useCallback(
    (page: number) => {
      setCurrentPage(page);
      persistPdfProgress(page, scale, fitWidth);
    },
    [persistPdfProgress, scale, fitWidth],
  );

  const handleScaleChangeFromHost = useCallback(
    (s: number) => {
      setScale(s);
      setFitWidth(false);
      persistPdfProgress(currentPage, s, false);
    },
    [persistPdfProgress, currentPage],
  );

  const handleEpubProgressChange = useCallback(
    (progress: { chapter: string; percentage: number }) => {
      setEpubChapter(progress.chapter);
      setEpubPercentage(progress.percentage);
      // 拿当前 CFI 持久化(getPosition 返回最新 CFI)
      // 注:Host 没暴露 getPosition,直接走 renderer.getPosition 不合适;
      // EPUB lastCFI 在 renderer 内部更新,relocate 推流后下次重启 setRestoreLocation
      // 用 entry.lastPosition.cfi(library.saveProgress 写)恢复
      // 这里 view 拿不到 cfi,改成订阅 onRelocate 时直接把 cfi 走 library.saveProgress
      // 由 ReflowableContent 内部 onRelocate 推 progress(无 cfi);要拿 cfi,
      // 需 host 暴露 getCurrentCFI。本段简化:lastCFI 持久化由 Host 内部 relocate
      // 时直接写 — 但这违反"data 写在 view"原则。**现状**:本段先只 persist 进度
      // 显示用的 chapter/percentage 不写文件,等 C5 收尾时加 host.getCurrentCFI()
      // 一并补;EPUB 重启恢复阅读位置作 已知短板登记,留 C5
      void progress; // 静默使用,避免 linter
    },
    [],
  );

  // ── Toolbar callbacks ──

  const onPageChange = useCallback((page: number) => {
    hostRef.current?.goToPage(page);
    setCurrentPage(page);
  }, []);

  const onScaleChange = useCallback(
    (s: number) => {
      hostRef.current?.setScale(s);
      setScale(s);
      setFitWidth(false);
      persistPdfProgress(currentPage, s, false);
    },
    [persistPdfProgress, currentPage],
  );

  const onFitWidthToggle = useCallback(() => {
    const next = !fitWidth;
    hostRef.current?.setFitWidth(next);
    setFitWidth(next);
    if (next) persistPdfProgress(currentPage, scale, true);
  }, [fitWidth, scale, currentPage, persistPdfProgress]);

  const onPrevChapter = useCallback(() => hostRef.current?.prevChapter(), []);
  const onNextChapter = useCallback(() => hostRef.current?.nextChapter(), []);
  const onFontSizeChange = useCallback((size: number) => {
    hostRef.current?.setFontSize(size);
    setFontSize(size);
  }, []);

  const onSidebarToggle = useCallback(() => setSidebarOpen((p) => !p), []);

  // keymap:Cmd+F 开搜索;EPUB ←/→ 翻章节
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        search.openSearch();
      } else if (renderMode === 'reflowable') {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          onPrevChapter();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          onNextChapter();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [search, renderMode, onPrevChapter, onNextChapter]);

  // 抑制未消费 lint 警告(persistEpubProgress 未来 C5 用)
  void persistEpubProgress;
  void handleEpubProgressChange;

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
        renderMode={renderMode}
        sidebarOpen={sidebarOpen}
        onSidebarToggle={onSidebarToggle}
        onSearchOpen={search.openSearch}
        currentPage={currentPage}
        pageCount={totalPages}
        scale={scale}
        fitWidth={fitWidth}
        onPageChange={onPageChange}
        onScaleChange={onScaleChange}
        onFitWidthToggle={onFitWidthToggle}
        epubChapter={epubChapter}
        epubPercentage={epubPercentage}
        fontSize={fontSize}
        onPrevChapter={onPrevChapter}
        onNextChapter={onNextChapter}
        onFontSizeChange={onFontSizeChange}
      />
      <SearchBar
        visible={search.visible}
        results={search.results}
        currentIndex={search.currentIndex}
        onSearch={search.handleSearch}
        onNext={search.handleNext}
        onPrev={search.handlePrev}
        onClose={search.handleClose}
      />
      <div className="krig-ebook-view__body">
        {sidebarOpen && (
          <OutlinePanel
            host={{
              getTOC: () => hostRef.current?.getTOC() ?? Promise.resolve([]),
              goToPage: (p) => hostRef.current?.goToPage(p),
              goToCFI: (c) => hostRef.current?.goToCFI(c),
            }}
            currentChapter={epubChapter}
            currentPage={currentPage}
            reloadToken={activeBookId}
            onClose={() => setSidebarOpen(false)}
          />
        )}
        <div className="krig-ebook-view__main">
          <Host
            ref={hostRef}
            workspaceId={workspaceId}
            onPageChange={handlePageChangeFromHost}
            onLoadComplete={handleLoadComplete}
            onScaleChange={handleScaleChangeFromHost}
            onEpubProgressChange={handleEpubProgressChange}
          />
        </div>
      </div>
    </div>
  );
}
