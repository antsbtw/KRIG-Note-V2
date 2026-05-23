/**
 * EBookView — view 主组件(L5-C4 扩展)
 *
 * **本段(C4)** 在 C3 基础上加:
 * - useBookmarks hook 接入 + 书签按钮(toolbar 高亮态)+ Cmd+D 切换书签
 * - useEpubAnnotation hook 接入 + EpubAnnotationPicker(EPUB 选区颜色 picker)
 * - EPUB CFI 持久化补回(C3 已知短板修复)— host.getCurrentCFI() + onEpubProgressChange
 * - 主区点击外部关 picker(对齐 V1 全屏 mousedown 监听)
 *
 * 见 docs/RefactorV2/v1-ebook-migration-plan.md v0.3 § 5 C4。
 *
 * LOC 红线(v0.3 § 3.1):≤150~200 行。本组件 ~245 行(超 45 行,沿用 C3
 * 的"机会主义瘦身"取舍 — 持久化已拆 use-ebook-progress;keymap+toolbar
 * handlers 跟 view state 关联紧密,继续拆引入 hook 间通信反而更乱)。
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
import { commandRegistry } from '@slot/command-registry/command-registry';
import { fullscreenOverlayController } from '@slot/triggers/fullscreen-overlay-controller';
import type { EBookLibraryApi } from '@capabilities/ebook-library/types';
import type { EBookLoadedInfo } from '@shared/ipc/ebook-types';
import type {
  EBookRenderingApi,
  EBookHostHandle,
} from '@capabilities/ebook-rendering/types';
/**
 * EBOOK_FULLSCREEN_OVERLAY_ID 与 capability id 一同绑定的"协议常量"
 * 字面字符串避开 W5 边界(view 不直 import capability 运行时值)
 */
const EBOOK_FULLSCREEN_OVERLAY_ID = 'ebook-rendering.fullscreen.reader';
import { getEBookWsState } from './data-model';
import { useEBookProgress } from './use-ebook-progress';
import { usePdfAnnotations } from './use-pdf-annotations';
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
  const {
    Host,
    OutlinePanel,
    SearchBar,
    EpubAnnotationPicker,
    useSearch,
    useBookmarks,
    useEpubAnnotation,
  } = rendering;

  const hostRef = useRef<EBookHostHandle | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  /** 最近一次 onBookOpened 推流 — 全屏触发时复用,补最新位置喂给 panel */
  const lastBookInfoRef = useRef<EBookLoadedInfo | null>(null);
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
  // fontSize 现仅作命令式推到 host(不参与 view 自身 render),由 Aa popup 持 state
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // hooks
  const search = useSearch(hostRef);
  const bookmarks = useBookmarks(hostRef, activeBookIdRef, epubChapter);
  const ann = useEpubAnnotation(hostRef, activeBookIdRef);
  const pdfAnn = usePdfAnnotations(activeBookIdRef);

  // C6:PDF 提取 — 上传当前书到 Platform → 切右栏 web-view 装 Platform UI
  // (atom batch JSON 落 noteCapability 由 NoteView 内的 useExtractionImport 处理)
  const [extractUploading, setExtractUploading] = useState(false);
  const handleExtract = useCallback(async () => {
    if (extractUploading) return;
    setExtractUploading(true);
    try {
      const result = (await window.electronAPI.extractionUpload()) as {
        uploaded: boolean;
        platformUrl?: string;
        reason?: string;
      };
      if (!result.uploaded || !result.platformUrl) {
        console.warn('[ebook-view] extraction upload failed:', result.reason);
        return;
      }
      // 通过命令把 Platform URL 装到右栏 web-view(view 间不直 import @views/web)
      commandRegistry.execute('web-view.open-url', result.platformUrl);
    } catch (err) {
      console.error('[ebook-view] extraction error:', err);
    } finally {
      setExtractUploading(false);
    }
  }, [extractUploading]);

  // 订阅 onBookOpened → 命令式驱动 Host + 加载书签 / 标注
  useEffect(() => {
    return library.onBookOpened((info) => {
      setFileName(info.fileName);
      activeBookIdRef.current = info.bookId;
      lastBookInfoRef.current = info;
      void hostRef.current?.loadFromInfo(info);
      bookmarks.loadOnBookOpen(info.bookId);
      // EPUB:加载已有 annotation 并重绘高亮(loadOnBookOpen 内 await getTOC 等就绪)
      void ann.loadOnBookOpen(info.bookId);
      // C5:PDF 空间标注加载(EPUB 路径会过滤掉,无副作用)
      void pdfAnn.loadOnBookOpen(info.bookId);
    });
  }, [library, activeBookIdRef, bookmarks, ann, pdfAnn]);

  // EPUB 字号 / 主题:popup wrapper 改 localStorage 后 notify → 这里推给 host
  // (popup-registry 的 Component 不能接 view 端 props,只能模块级 event bus 通信)
  useEffect(() => {
    return rendering.subscribeEpubReadingSettings((s) => {
      hostRef.current?.setFontSize(s.fontSize);
      hostRef.current?.setEpubTheme(s.theme);
      hostRef.current?.setEpubAppearance(s.appearance);
    });
  }, [rendering]);

  // 启动 + 切书:有 activeBookId → 主动 open
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
        // EPUB 加载完成 — 把 localStorage 偏好推给 host(字号 + 主题),
        // 确保非全屏 view 内也呈现用户偏好的字号/主题
        const s = rendering.loadEpubReadingSettings();
        hostRef.current?.setFontSize(s.fontSize);
        hostRef.current?.setEpubTheme(s.theme);
        hostRef.current?.setEpubAppearance(s.appearance);
      }
    },
    [rendering],
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

  // C4:EPUB CFI 持久化(C3 已知短板修复)— relocate 时拿 host.getCurrentCFI
  const handleEpubProgressChange = useCallback(
    (progress: { chapter: string; percentage: number }) => {
      setEpubChapter(progress.chapter);
      setEpubPercentage(progress.percentage);
      const cfi = hostRef.current?.getCurrentCFI();
      if (cfi) persistEpubProgress(cfi);
    },
    [persistEpubProgress],
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
  // 字号 +/- 不在 toolbar,迁到 Aa popup;变更通过 subscribeEpubReadingSettings 同步推 host

  const onSidebarToggle = useCallback(() => setSidebarOpen((p) => !p), []);

  // 全屏 overlay 关闭时,view 重新 open 当前书 —— panel 已 saveProgress,
  // 此时 library.open 推流的 lastPosition 即最新位置,view host 同步跳过去
  useEffect(() => {
    const unsub = fullscreenOverlayController.subscribe(() => {
      const s = fullscreenOverlayController.getState();
      // 仅当从 active 状态切到 inactive 时刷新(忽略首次 + 切其他 overlay)
      if (!s.visible && s.lastActiveId === EBOOK_FULLSCREEN_OVERLAY_ID) {
        const bookId = activeBookIdRef.current;
        if (bookId) {
          void library.open(bookId).catch((err) => {
            console.warn('[ebook-view] reopen after fullscreen failed:', err);
          });
        }
      }
    });
    return unsub;
  }, [library, activeBookIdRef]);

  // 全屏沉浸阅读:走 capability api(W5 边界 — view 不直 import capability 运行时值)
  // 进度回写在 panel 内独立持久化,Esc 退出时 view 重新 open 此书会读到最新位置
  const onFullscreen = useCallback(() => {
    const info = lastBookInfoRef.current;
    if (!info) return;
    // 用当前 view 内的最新位置覆盖 info.lastPosition(避免 panel 加载到 stale 位置)
    // PDF 路径强制 fitWidth=true(全屏 Preview 风格,scale 由 host 按 viewport 算)
    const lastPosition = renderMode === 'reflowable'
      ? { cfi: hostRef.current?.getCurrentCFI() ?? info.lastPosition?.cfi }
      : { page: currentPage, fitWidth: true };
    rendering.openFullscreenReader({
      workspaceId,
      bookInfo: { ...info, lastPosition },
    });
  }, [rendering, workspaceId, renderMode, currentPage]);

  // × 关闭当前 ebook view:根据所在槽位调 closeLeft / closeRight
  // (最后一个 view 时 closeLeft 自身拒绝,见 slot-control.ts 铁律 8)
  const onClose = useCallback(() => {
    const ws = workspaceManager.get(workspaceId);
    const bus = workspaceManager.getBus(workspaceId);
    if (!ws || !bus) return;
    if (ws.slotBinding.right === 'ebook-view') {
      bus.slot.closeRight();
    } else {
      bus.slot.closeLeft();
    }
  }, [workspaceId]);

  const onBookmarkToggle = useCallback(
    () => void bookmarks.toggle(currentPage),
    [bookmarks, currentPage],
  );

  // keymap:Cmd+F 开搜索;Cmd+D 切书签;EPUB ←/→ 翻章节
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        search.openSearch();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        onBookmarkToggle();
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
  }, [search, onBookmarkToggle, renderMode, onPrevChapter, onNextChapter]);

  // 主区 mousedown 关 EPUB picker(点击 picker 外部时,picker 内部冒泡阻断)
  useEffect(() => {
    if (!ann.selection) return;
    const handler = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (target.closest('.krig-ebook-annotation-picker')) return;
      ann.dismiss();
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [ann.selection, ann]);

  // thought-view Phase 4:订阅 'thought.scroll-to-book-source' channel
  // → ThoughtView 点 anchor 跳转到 ebook 当前 active book 的页/CFI(host.goToPage/goToCFI)
  useEffect(() => {
    const bus = workspaceManager.getBus(workspaceId);
    if (!bus) return;
    const unsub = bus.channels.subscribe('thought.scroll-to-book-source', (payload: unknown) => {
      const { bookId, pageNum, cfi } = (payload ?? {}) as {
        bookId?: string;
        pageNum?: number;
        cfi?: string;
      };
      if (!bookId) return;
      // 等 EBookView 加载完该书(scroll-to-source 流程内已调 ebookCap.open,
      // 此时 onBookOpened 推流可能还没来 — 200ms 重试一次兜底)
      const tryScroll = (attempt: number): void => {
        const host = hostRef.current;
        if (!host) {
          if (attempt < 8) window.setTimeout(() => tryScroll(attempt + 1), 200);
          return;
        }
        if (cfi) {
          void host.goToCFI(cfi);
        } else if (pageNum && pageNum > 0) {
          host.goToPage(pageNum);
        }
      };
      tryScroll(0);
    });
    return unsub;
  }, [workspaceId]);

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
        isBookmarked={bookmarks.isBookmarked(currentPage)}
        onBookmarkToggle={onBookmarkToggle}
        currentPage={currentPage}
        pageCount={totalPages}
        scale={scale}
        fitWidth={fitWidth}
        onPageChange={onPageChange}
        onScaleChange={onScaleChange}
        onFitWidthToggle={onFitWidthToggle}
        pdfAnnotationMode={pdfAnn.mode}
        onPdfAnnotationModeChange={pdfAnn.setMode}
        onExtract={handleExtract}
        extractDisabled={extractUploading}
        epubChapter={epubChapter}
        epubPercentage={epubPercentage}
        onPrevChapter={onPrevChapter}
        onNextChapter={onNextChapter}
        onFullscreen={onFullscreen}
        onClose={onClose}
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
      <div className="krig-ebook-view__body" ref={bodyRef}>
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
            onEpubTextSelected={ann.setSelection}
            onEpubSelectionDismiss={ann.dismiss}
            onEpubAnnotationClick={ann.handleAnnotationClick}
            pdfAnnotationMode={pdfAnn.mode}
            pdfAnnotations={pdfAnn.annotations}
            onPdfAnnotationCreate={pdfAnn.create}
            onPdfAnnotationDelete={pdfAnn.remove}
          />
          {ann.selection && (
            <EpubAnnotationPicker
              selection={ann.selection}
              containerWidth={bodyRef.current?.clientWidth ?? 400}
              onColor={ann.createAnnotation}
              onCancel={ann.dismiss}
            />
          )}
        </div>
      </div>
    </div>
  );
}
