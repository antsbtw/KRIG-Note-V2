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
import type { EBookLibraryApi } from '@capabilities/ebook-library/types';
import type { EBookLoadedInfo } from '@shared/ipc/ebook-types';
import type {
  EBookRenderingApi,
  EBookHostHandle,
  PdfTextSelectionEvent,
} from '@capabilities/ebook-rendering/types';
import type { ThoughtType } from '@shared/ipc/thought-types';
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
    PdfTextAnnotationPicker,
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

  /**
   * 全屏(PDF 沉浸阅读)— view 内部独立 state(2026-05-24 用户拍板:与 navSideCollapsed 解耦)。
   *
   * 进入全屏(⛶ 按钮):
   *   1. 快照 prevNavSideCollapsed + prevRightSlot
   *   2. setNavSideCollapsed(true) + closeRight()
   *   3. PDF 切 paged 双页 spread + toolbar auto-hide
   *
   * 退出全屏(再点 ⛶ / ESC):
   *   1. setNavSideCollapsed(快照值) + openRight(快照 viewId)
   *   2. PDF 回 scroll + toolbar 常显
   *
   * **不再** = navSideCollapsed:用户从 WorkspaceBar 点 NavSide toggle 时,
   * 仅 navSideCollapsed 变,view 内 PDF 模式字面无感知。
   */
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenSnapshotRef = useRef<{
    navSideCollapsed: boolean;
    rightSlot: string | null;
  } | null>(null);
  const [toolbarVisible, setToolbarVisible] = useState(false);
  // 退出全屏时复位 visible,避免下次进全屏首帧仍是"显示态"
  useEffect(() => {
    if (!isFullscreen) setToolbarVisible(false);
  }, [isFullscreen]);

  // toolbar 显示状态
  const [fileName, setFileName] = useState('');
  const [renderMode, setRenderMode] = useState<EBookToolbarRenderMode>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [fitWidth, setFitWidth] = useState(true);
  const [epubChapter, setEpubChapter] = useState('');
  const [epubPercentage, setEpubPercentage] = useState(0);
  const [epubPage, setEpubPage] = useState(0);
  const [epubPages, setEpubPages] = useState(0);
  // fontSize 现仅作命令式推到 host(不参与 view 自身 render),由 Aa popup 持 state
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // PDF 全屏翻页式布局 — 按容器宽高比自动选(宽屏 double / 竖屏 single)
  const [pagedLayout, setPagedLayout] = useState<'single' | 'double'>('single');

  // hooks
  const search = useSearch(hostRef);
  const bookmarks = useBookmarks(hostRef, activeBookIdRef, epubChapter);
  const ann = useEpubAnnotation(hostRef, activeBookIdRef);
  const pdfAnn = usePdfAnnotations(activeBookIdRef, hostRef);

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

  // EPUB / PDF 全屏 单/双页布局自适应:容器宽高比 ≥ 1(宽 ≥ 高)→ 双页 spread;< 1 → 单页。
  // - EPUB(reflowable):始终自适应 — NavSide 收起后容器横向变宽,自动进双页 spread
  // - PDF(fixed-page):仅全屏 paged 模式消费 pagedLayout state — 非全屏 scroll
  //   模式不需要(单/双页只在翻页式渲染下有意义)
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const compute = (): void => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      const count: 1 | 2 = w >= h ? 2 : 1;
      if (renderMode === 'reflowable') {
        hostRef.current?.setEpubMaxColumnCount(count);
      } else if (renderMode === 'fixed-page') {
        setPagedLayout(count === 2 ? 'double' : 'single');
      }
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [renderMode]);

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
      // 翻页时强制收 toolbar 浮层(全屏期 hover 露出后用户翻页 → toolbar 让位)
      if (isFullscreen) setToolbarVisible(false);
      // PR-α-3b:翻页关 PDF 文字流 picker(选区已失效)
      setPdfTextSelection(null);
    },
    [persistPdfProgress, scale, fitWidth, isFullscreen],
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
    (progress: { chapter: string; percentage: number; page: number; pages: number }) => {
      setEpubChapter(progress.chapter);
      setEpubPercentage(progress.percentage);
      setEpubPage(progress.page);
      setEpubPages(progress.pages);
      const cfi = hostRef.current?.getCurrentCFI();
      if (cfi) persistEpubProgress(cfi);
      // 翻页时强制收 toolbar 浮层(全屏期 hover 露出后用户翻页 → toolbar 让位)
      if (isFullscreen) setToolbarVisible(false);
    },
    [persistEpubProgress, isFullscreen],
  );

  // PDF 标注创建后**仅落库**(PR-α-2 行为回退,handoff §α-2 第 1 项):
  // 用户在标注上右键 "💭 加思考" 才召唤右槽 ThoughtView,不再自动开。
  //
  // 历史:0eaafe73 前 create 后会自动 commandRegistry.execute(
  //   'thought-view.add-from-pdf-annotation', created.thoughtId
  // ),与"右键 = 显式选择动作"的右键体系不一致;本 PR 回退此自动行为。
  const handlePdfAnnotationCreate = useCallback(
    async (pageNum: number, draft: Parameters<typeof pdfAnn.create>[1]) => {
      await pdfAnn.create(pageNum, draft);
    },
    [pdfAnn],
  );

  // PR-α-3b:PDF 文字流标注模式 — toolbar ✎ 按钮 toggle
  // ✎ on 时 textLayer 拖选 → 弹 picker;off 时 hook 的 onPdfTextSelected = undefined
  // (无 mouseup listener,零开销 — Cmd+C 复制不被打扰)
  const [pdfTextMode, setPdfTextMode] = useState(false);
  const togglePdfTextMode = useCallback(
    (active: boolean) => {
      setPdfTextMode(active);
      if (active) pdfAnn.setMode('off'); // 互斥:开文字模式 → 关框选
    },
    [pdfAnn],
  );
  // 框选模式开 → 关文字模式(反向互斥)
  useEffect(() => {
    if (pdfAnn.mode === 'rect') setPdfTextMode(false);
  }, [pdfAnn.mode]);
  // 切书 → 重置(新 PDF 默认 off 更安全)
  useEffect(() => {
    setPdfTextMode(false);
  }, [activeBookId]);

  // PDF textLayer 选区 → picker 弹出
  const [pdfTextSelection, setPdfTextSelection] =
    useState<PdfTextSelectionEvent | null>(null);
  const handlePdfTextSelected = useCallback((ev: PdfTextSelectionEvent) => {
    setPdfTextSelection(ev);
  }, []);
  const dismissPdfTextPicker = useCallback(() => {
    setPdfTextSelection(null);
    // 清掉浏览器原生选区灰底(否则残留)
    window.getSelection()?.removeAllRanges();
  }, []);
  // picker confirm → 调 pdfAnn.createFromTextSelection(走 legacy,不召右槽)
  const handlePdfTextPickerConfirm = useCallback(
    (type: ThoughtType, markStyle: 'highlight' | 'strikethrough') => {
      const ev = pdfTextSelection;
      if (!ev) return;
      void pdfAnn.createFromTextSelection(ev, type, markStyle);
      dismissPdfTextPicker();
    },
    [pdfAnn, pdfTextSelection, dismissPdfTextPicker],
  );

  // picker 关闭 lifecycle:外部 mousedown / ESC 关
  useEffect(() => {
    if (!pdfTextSelection) return;
    const onMouseDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (target.closest('.krig-pdf-text-picker')) return;
      dismissPdfTextPicker();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismissPdfTextPicker();
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [pdfTextSelection, dismissPdfTextPicker]);

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

  /**
   * 全屏 toggle(2026-05-24 用户拍板:与 navSideCollapsed 解耦的独立 view state):
   *
   * 进入:快照 navSide / rightSlot 状态 → setNavSideCollapsed(true) + closeRight + setIsFullscreen(true)
   * 退出:setIsFullscreen(false) + restore navSide + restore rightSlot
   *
   * 分层原则:view 通过 workspaceManager.setNavSideCollapsed + bus.slot.openRight/closeRight
   * 这些"高层提供的明确 API"触发副作用,不直接 mutate workspace state。
   */
  const onFullscreen = useCallback(() => {
    const ws = workspaceManager.get(workspaceId);
    const bus = workspaceManager.getBus(workspaceId);
    if (!ws || !bus) return;
    if (!isFullscreen) {
      // 进入全屏 — 快照 + 强制收 NavSide + 关右槽
      fullscreenSnapshotRef.current = {
        navSideCollapsed: ws.navSideCollapsed,
        rightSlot: ws.slotBinding.right,
      };
      workspaceManager.setNavSideCollapsed(workspaceId, true);
      if (ws.slotBinding.right) bus.slot.closeRight();
      setIsFullscreen(true);
    } else {
      // 退出全屏 — 恢复快照(开右槽前 setIsFullscreen 让 view paged→scroll 先生效)
      const snap = fullscreenSnapshotRef.current;
      setIsFullscreen(false);
      if (snap) {
        workspaceManager.setNavSideCollapsed(workspaceId, snap.navSideCollapsed);
        if (snap.rightSlot) bus.slot.openRight(snap.rightSlot);
      }
      fullscreenSnapshotRef.current = null;
    }
    // 释放按钮焦点 — 避免 toolbar 全屏按钮点击后保持 :focus 视觉残留 +
    // ESC 退出后 hover 露出的 toolbar 上仍有焦点环
    (document.activeElement as HTMLElement | null)?.blur();
  }, [workspaceId, isFullscreen]);

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

  // keymap:Cmd+F 开搜索;Cmd+D 切书签;EPUB ←/→ 翻章节;ESC 退出全屏
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        search.openSearch();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        onBookmarkToggle();
      } else if (e.key === 'Escape' && isFullscreen) {
        // 焦点在输入框/contenteditable 时让位(SearchBar 输入框 ESC 关搜索)
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
        // 多 view 共存 workspace 防重入:同 ESC 被两个 EBookView handler 收到会
        // toggle 两次互相抵消。用 event 上的 marker(自定义属性)第一处理者占位。
        const ev = e as KeyboardEvent & { __krigEbookEscHandled?: boolean };
        if (ev.__krigEbookEscHandled) return;
        ev.__krigEbookEscHandled = true;
        e.preventDefault();
        onFullscreen();
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
  }, [search, onBookmarkToggle, renderMode, onPrevChapter, onNextChapter, isFullscreen, onFullscreen]);

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
      const { bookId, pageNum, cfi, thoughtId } = (payload ?? {}) as {
        bookId?: string;
        pageNum?: number;
        cfi?: string;
        thoughtId?: string;
      };
      if (!bookId) return;
      /**
       * 跳源重试策略(2026-05-24 修跳源 bug):
       *   scroll-to-source 流程内会调 ebookCap.open → EBookView 收到 onBookOpened
       *   → host.loadFromInfo → FixedPageContent 重 mount。这一过程从 channel emit
       *   到 containerRef 真正绑好可能跨多个 frame(取决于 PDF 大小)。
       *
       *   单次 goToPage 调用经常落到 containerRef = null 的窗口期。最稳的策略:
       *   定时点多次调 goToPage(幂等),让任意一次落到 ready 后的窗口就成功。
       *
       *   8 次 * 250ms = 2s 内总会有 1 次落到 ready 之后(若 2s 内仍未 ready
       *   说明 PDF 加载本身有问题,放弃)。每次调都是幂等 scrollTo(targetTop)。
       */
      const tryScroll = (attempt: number): void => {
        const host = hostRef.current;
        if (host) {
          if (cfi) {
            void host.goToCFI(cfi);
          } else if (pageNum && pageNum > 0) {
            host.goToPage(pageNum);
          }
        }
        if (attempt < 8) {
          window.setTimeout(() => tryScroll(attempt + 1), 250);
        }
      };
      tryScroll(0);
      if (thoughtId) {
        // 闪烁延后到第一波 retry 都试过(8*250=2000ms);annotations 此时大概率已就位
        window.setTimeout(() => pdfAnn.flash(thoughtId), 2200);
      }
    });
    return unsub;
  }, [workspaceId, pdfAnn]);

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

  // 全屏期 toolbar 浮层显隐:鼠标进入顶部 36px 触发区 → 显示;离开 toolbar → 隐
  // 触发区高度 = toolbar 高度(36px),避免"触发区比 toolbar 高"造成显隐抖动
  // 非全屏期 toolbarVisible 不消费(toolbar 走常态 flex 流)
  const toolbarClass = isFullscreen
    ? `krig-ebook-toolbar--floating${toolbarVisible ? ' krig-ebook-toolbar--floating-visible' : ''}`
    : '';

  return (
    <div className="krig-ebook-view" data-view-id="ebook-view">
      {isFullscreen && (
        <div
          className="krig-ebook-toolbar-trigger"
          onMouseEnter={() => setToolbarVisible(true)}
        />
      )}
      <EBookToolbar
        className={toolbarClass}
        onMouseLeave={isFullscreen ? () => setToolbarVisible(false) : undefined}
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
        pdfTextMode={pdfTextMode}
        onPdfTextModeChange={togglePdfTextMode}
        onExtract={handleExtract}
        extractDisabled={extractUploading}
        epubPercentage={epubPercentage}
        epubPage={epubPage}
        epubPages={epubPages}
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
            pdfFlashAnnotationId={pdfAnn.flashId}
            onPdfAnnotationCreate={handlePdfAnnotationCreate}
            onPdfTextSelected={pdfTextMode ? handlePdfTextSelected : undefined}
            pdfLayout={isFullscreen ? 'paged' : 'scroll'}
            pagedLayout={pagedLayout}
          />
          {ann.selection && (
            <EpubAnnotationPicker
              selection={ann.selection}
              containerWidth={bodyRef.current?.clientWidth ?? 400}
              onType={ann.createAnnotation}
              onCancel={ann.dismiss}
            />
          )}
          {pdfTextSelection && (
            <PdfTextAnnotationPicker
              anchor={pdfTextSelection.screenAnchor}
              onConfirm={handlePdfTextPickerConfirm}
              onCancel={dismissPdfTextPicker}
            />
          )}
        </div>
      </div>
    </div>
  );
}
