/**
 * EBookFullscreenPanel — L2 全屏阅读 overlay 主组件
 *
 * 设计契约(详见 src/shell/fullscreen-overlay/README.md):
 * - Component 接 { onClose }; Esc / 顶部 × 按钮均调用 onClose
 * - 内部独立 EBookHost 实例(不复用 EBookView 的 host) — 避免 iframe/canvas
 *   DOM 搬移导致重挂抖动([[iframe-in-hidden-container-zero-height]])
 * - 进度实时回写:翻页 / 缩放 / EPUB relocate 即刻调 library.saveProgress
 *   (debounce 由内部 hook 兜底) — Esc 退出时 EBookView 重新打开此书会读到最新位置
 * - v1 范围(2026-05-22): 翻页 / 缩放 / 字号 / 目录 sidebar / 搜索 / 书签
 * - v1.5 推迟: PDF 空间标注 + EPUB 选区高亮(涉及 host props 透传 + picker 位置计算)
 *
 * 加载流程:
 *   Panel mount → getEBookFullscreenContext() 拿 ctx
 *     → useEffect 调 hostRef.loadFromInfo(ctx.bookInfo) (字面直接喂)
 *     → host 内部走 library.getData() + renderer.load
 *     → onLoadComplete / onPageChange / onScaleChange / onEpubProgressChange 推送
 *     → panel 内部 state + 每次变化 library.saveProgress
 *   Panel unmount → clearEBookFullscreenContext()
 */

import {
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
} from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { EBookLibraryApi } from '@capabilities/ebook-library/types';
import { EBookHost } from '../Host';
import type { EBookHostHandle, EBookFileType } from '../types';
import { OutlinePanel } from '../outline-panel';
import { SearchBar } from '../search-bar';
import { useSearch } from '../hooks/use-search';
import { useBookmarks } from '../hooks/use-bookmarks';
import {
  getEBookFullscreenContext,
  clearEBookFullscreenContext,
} from './fullscreen-context';
import './fullscreen-panel.css';

interface EBookFullscreenPanelProps {
  onClose: () => void;
}

type RenderMode = 'fixed-page' | 'reflowable' | null;
type PagedLayout = 'single' | 'double';

// 全屏阅读体验决议(2026-05-22):fixed-page 走翻页式(不滚动),自适应 viewport
// 单页/双页可切换;EPUB 沿用 ReflowableContent(foliate-js 自身分页)
const FONT_STEP = 10;
const FONT_MIN = 60;
const FONT_MAX = 200;
const SAVE_PROGRESS_DEBOUNCE_MS = 500;

// Toolbar auto-hide:鼠标进入顶部此高度内触发显示;离开 hover 区立即隐藏
// (forceShowToolbar 守门:sidebar / 搜索 / hover toolbar 时强制保留)
const TOOLBAR_HOVER_ZONE_PX = 60;
const TOOLBAR_INITIAL_SHOW_MS = 500;

// 翻页指示器(Preview 同款)— 翻页时顶部居中胶囊显示 "Page X of N",
// 停留 1s 后淡出 300ms;连续翻页 stay-extends(重新启动 timer 不闪烁)
const PAGE_INDICATOR_STAY_MS = 1000;

/** 书签丝带图标(对齐 Apple Books / Kindle 设计)— active=填充,inactive=描边 */
function BookmarkIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="14"
      height="16"
      viewBox="0 0 14 16"
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 1.5h10v13L7 11l-5 3.5V1.5z" />
    </svg>
  );
}

export function EBookFullscreenPanel({ onClose }: EBookFullscreenPanelProps) {
  const ctx = useMemo(() => getEBookFullscreenContext(), []);
  const library = useMemo(
    () => requireCapabilityApi<EBookLibraryApi>('ebook-library'),
    [],
  );
  const hostRef = useRef<EBookHostHandle | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const bookIdRef = useRef<string | null>(ctx?.bookInfo.bookId ?? null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [renderMode, setRenderMode] = useState<RenderMode>(null);
  // fileName 取自 ctx 一次性 ready,不会随后变化(panel 一次只读一本书)
  const fileName = ctx?.bookInfo.fileName ?? '';
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [epubChapter, setEpubChapter] = useState('');
  const [epubPercentage, setEpubPercentage] = useState(0);
  const [fontSize, setFontSize] = useState(100);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // PDF 翻页式布局:single / double — 按 viewport 宽高比自动选(Preview 哲学)
  // 宽屏(width >= height)→ double;竖屏 → single
  // 监听 window resize,跟随尺寸变化
  const [pagedLayout, setPagedLayout] = useState<PagedLayout>(() =>
    window.innerWidth >= window.innerHeight ? 'double' : 'single',
  );
  useEffect(() => {
    const handler = (): void => {
      setPagedLayout(window.innerWidth >= window.innerHeight ? 'double' : 'single');
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  // toolbar 沉浸式显隐:进顶部 60px / sidebar 打开 / 搜索打开时 visible
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const toolbarHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolbarHoverRef = useRef(false);
  // 翻页指示器(Preview 同款)— 翻页时顶部居中胶囊 1s 自动消失
  const [pageIndicatorVisible, setPageIndicatorVisible] = useState(false);
  const pageIndicatorHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // indicator 显示用的页号(PDF)— 翻页**开始**时(onPagedPageChangeStart)即更新,
  // 不等动画完成,避免胶囊在翻完后才出现的滞后感
  const [indicatorPage, setIndicatorPage] = useState<number>(0);
  // 触发 indicator 显现的版本计数 — 任意值变化(PDF 翻页/EPUB 翻章/字号调整)都 +1
  // 触发 effect,统一信号源
  const [indicatorVersion, setIndicatorVersion] = useState(0);
  // EPUB 字号调整时,胶囊内容切到"字号 X%"而非 chapter · progress(短暂态,1s 后自然失效)
  // — 用 ref 而非 state:不参与 render 时机判断,只在生成胶囊文字时读最近一次触发
  const lastTriggerWasFontSizeRef = useRef(false);
  // 中间页号 input 编辑态(对齐 EBookToolbar 行内 pageInput 交互)
  const [pageInput, setPageInput] = useState('');
  const [editingPage, setEditingPage] = useState(false);

  // 全屏阅读固定 fit-width(Preview 风格,无缩放 UI);scale 由 host 内部按 viewport 算
  const FULLSCREEN_FIT_WIDTH = true;

  // hooks(对齐 EBookView 用法)
  const search = useSearch(hostRef);
  const bookmarks = useBookmarks(hostRef, bookIdRef, epubChapter);

  // 进度持久化(直接调 library,不走 view 的 use-ebook-progress —
  // capability 内不该 import view 层)
  // scale 始终随 fit-width(host 内部按 viewport 算),退出全屏时 view 重新 open
  // 此书会读到 lastPosition.fitWidth=true,view 自己也走 fit-width 路径
  const lastScaleRef = useRef(1.0);
  const persistPdfProgress = useCallback(
    (page: number) => {
      const bookId = bookIdRef.current;
      if (!bookId) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void library.saveProgress(bookId, {
          page,
          scale: lastScaleRef.current,
          fitWidth: FULLSCREEN_FIT_WIDTH,
        });
      }, SAVE_PROGRESS_DEBOUNCE_MS);
    },
    [library],
  );
  const persistEpubProgress = useCallback(
    (cfi: string) => {
      const bookId = bookIdRef.current;
      if (!bookId) return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void library.saveProgress(bookId, { cfi });
      }, SAVE_PROGRESS_DEBOUNCE_MS);
    },
    [library],
  );

  // mount: load book + bookmarks
  useEffect(() => {
    if (!ctx) {
      console.warn('[ebook-fullscreen] mount without ctx — closing');
      onClose();
      return;
    }
    void hostRef.current?.loadFromInfo(ctx.bookInfo);
    bookmarks.loadOnBookOpen(ctx.bookInfo.bookId);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      clearEBookFullscreenContext();
    };
    // mount-only effect: ctx 是 useMemo 一次性快照,bookmarks/onClose 在 panel
    // 生命周期内引用稳定,无需进 deps(并且 react-hooks plugin 当前 config 未启用)
  }, []);

  // Host callbacks
  const handleLoadComplete = useCallback(
    (info: {
      totalPages: number;
      fileType: EBookFileType;
      renderMode: 'fixed-page' | 'reflowable';
    }) => {
      setRenderMode(info.renderMode);
      setTotalPages(info.totalPages);
      // 注:不在此 setCurrentPage(1) — paged 路径 FullscreenPageView 会按 initialPage(restorePage)
      // 自动初始化并通过 onPageChange 推送真实起始页,否则会先闪一次 "Page 1-2" 再跳到 "Page 21-22"
      if (info.renderMode === 'reflowable') {
        setFontSize(hostRef.current?.getFontSize() ?? 100);
      }
    },
    [],
  );

  const handlePageChangeFromHost = useCallback(
    (page: number) => {
      setCurrentPage(page);
      persistPdfProgress(page);
    },
    [persistPdfProgress],
  );

  // host 内部按 viewport 算的 scale(fit-width 路径)— 记下来,saveProgress 时一起写
  const handleScaleChangeFromHost = useCallback((s: number) => {
    lastScaleRef.current = s;
  }, []);

  const handleEpubProgressChange = useCallback(
    (progress: { chapter: string; percentage: number }) => {
      setEpubChapter(progress.chapter);
      setEpubPercentage(progress.percentage);
      const cfi = hostRef.current?.getCurrentCFI();
      if (cfi) persistEpubProgress(cfi);
    },
    [persistEpubProgress],
  );

  // Toolbar handlers
  // 注:paged 路径下,host.goToPage 内部会通过 spreadStart 对齐到 spread 起点;
  // double 模式 spread 起点为奇数 — 翻页要跳 ±2 才能到下一个 spread,
  // 否则 (currentPage + 1) 是偶数,spreadStart(偶数) = 偶数 - 1 = 回到同一 spread。
  const pageStep = pagedLayout === 'double' ? 2 : 1;
  const onPrevPage = useCallback(() => {
    if (currentPage > 1) {
      hostRef.current?.goToPage(Math.max(1, currentPage - pageStep));
    }
  }, [currentPage, pageStep]);
  const onNextPage = useCallback(() => {
    if (currentPage < totalPages) {
      hostRef.current?.goToPage(Math.min(totalPages, currentPage + pageStep));
    }
  }, [currentPage, totalPages, pageStep]);

  // 中间页号 input handlers — focus 进入编辑 → 输入 → Enter/blur 提交跳页
  const handlePageInputFocus = useCallback(() => {
    setPageInput(String(currentPage));
    setEditingPage(true);
  }, [currentPage]);
  const handlePageInputBlur = useCallback(() => {
    setEditingPage(false);
    const page = parseInt(pageInput, 10);
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
      // host.goToPage 内部 spreadStart 对齐 — 输入偶数会落到 spread 起点(N-1)
      hostRef.current?.goToPage(page);
    }
  }, [pageInput, totalPages]);
  const handlePageInputKey = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setEditingPage(false);
      setPageInput('');
      (e.target as HTMLInputElement).blur();
    }
  }, []);

  const onPrevChapter = useCallback(() => hostRef.current?.prevChapter(), []);
  const onNextChapter = useCallback(() => hostRef.current?.nextChapter(), []);
  const onFontMinus = useCallback(() => {
    const next = Math.max(FONT_MIN, fontSize - FONT_STEP);
    hostRef.current?.setFontSize(next);
    setFontSize(next);
    lastTriggerWasFontSizeRef.current = true;
    setIndicatorVersion((v) => v + 1); // 字号调整时也浮现胶囊(显示当前字号)
  }, [fontSize]);
  const onFontPlus = useCallback(() => {
    const next = Math.min(FONT_MAX, fontSize + FONT_STEP);
    hostRef.current?.setFontSize(next);
    setFontSize(next);
    lastTriggerWasFontSizeRef.current = true;
    setIndicatorVersion((v) => v + 1);
  }, [fontSize]);

  const onBookmarkToggle = useCallback(
    () => void bookmarks.toggle(currentPage),
    [bookmarks, currentPage],
  );

  // keymap: Cmd+F / Cmd+D / EPUB ←→
  // 注意: Esc 已由 FullscreenOverlayBinding 接管,这里不重复挂
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

  // toolbar auto-hide:鼠标进顶部 60px 内 → 显示;离开 1.5s → 隐藏
  // 例外:sidebar 打开 / 搜索栏可见 / 鼠标 hover 在 toolbar 上时强制保持显示
  const forceShowToolbar = sidebarOpen || search.visible || toolbarHoverRef.current;

  useEffect(() => {
    // 初始 2s 显示窗口
    if (toolbarHideTimerRef.current) clearTimeout(toolbarHideTimerRef.current);
    toolbarHideTimerRef.current = setTimeout(() => {
      if (!forceShowToolbar) setToolbarVisible(false);
    }, TOOLBAR_INITIAL_SHOW_MS);
    return () => {
      if (toolbarHideTimerRef.current) clearTimeout(toolbarHideTimerRef.current);
    };
    // 只在 mount 跑一次;forceShowToolbar 变化由下面的 effect 处理
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      const inHoverZone = e.clientY <= TOOLBAR_HOVER_ZONE_PX;
      if (inHoverZone) {
        setToolbarVisible(true);
        if (toolbarHideTimerRef.current) clearTimeout(toolbarHideTimerRef.current);
      } else if (toolbarVisible && !forceShowToolbar) {
        // 离开 hover 区立即隐藏(不延迟)— forceShowToolbar 守门:
        // sidebar 打开 / 搜索栏可见 / 鼠标 hover 在 toolbar 上时仍强制保留
        if (toolbarHideTimerRef.current) clearTimeout(toolbarHideTimerRef.current);
        setToolbarVisible(false);
      }
    };
    window.addEventListener('mousemove', handler);
    return () => {
      window.removeEventListener('mousemove', handler);
    };
  }, [toolbarVisible, forceShowToolbar]);

  // forceShowToolbar 变 true 时立即显示 + 清隐藏 timer
  useEffect(() => {
    if (forceShowToolbar) {
      setToolbarVisible(true);
      if (toolbarHideTimerRef.current) clearTimeout(toolbarHideTimerRef.current);
    }
  }, [forceShowToolbar]);

  // 翻页指示器(Preview 同款):indicatorPage 变化即显示,1s 后自动隐藏。
  // indicatorPage 在翻页**开始**时(onPagedPageChangeStart)即更新 — 不等动画完成,
  // 胶囊与动画同步呈现而非动画结束后才出。连续翻页 stay-extends 不闪烁。
  // 初次加载:onPageChange 推 currentPage 后,下面那条 effect 同步初始化 indicatorPage。
  useEffect(() => {
    if (!renderMode || indicatorVersion === 0) return;
    setPageIndicatorVisible(true);
    if (pageIndicatorHideTimerRef.current) clearTimeout(pageIndicatorHideTimerRef.current);
    pageIndicatorHideTimerRef.current = setTimeout(() => {
      setPageIndicatorVisible(false);
    }, PAGE_INDICATOR_STAY_MS);
    return () => {
      if (pageIndicatorHideTimerRef.current) clearTimeout(pageIndicatorHideTimerRef.current);
    };
  }, [indicatorVersion, renderMode]);

  // currentPage 变化时同步到 indicatorPage(初次加载 / EPUB 翻章 / 动画完成无 start 信号场景兜底)
  // 注:翻页式 PDF 路径会先经 onPagedPageChangeStart 走 setIndicatorPage(target),
  // 然后 currentPage 在动画完成时变化到同一值,这里 noop 跳过(已是同值)
  // indicatorPage 故意不入 deps:避免 setter 触发自身循环;
  // currentPage 是唯一外部信号源,只跟它走
  useEffect(() => {
    if (currentPage > 0 && currentPage !== indicatorPage) {
      setIndicatorPage(currentPage);
      setIndicatorVersion((v) => v + 1);
    }
  }, [currentPage]);

  // EPUB 进度变化(翻章/percentage 变化)— bump indicator version 让胶囊出现
  // 注:相同 chapter+percentage 不重复触发(避免连续 relocate 推流闪烁)
  useEffect(() => {
    if (renderMode !== 'reflowable') return;
    if (!epubChapter && epubPercentage === 0) return;
    lastTriggerWasFontSizeRef.current = false; // 翻章 → 恢复 progress 显示
    setIndicatorVersion((v) => v + 1);
  }, [epubChapter, epubPercentage, renderMode]);

  // EPUB 双页布局推送给 renderer:pagedLayout 跟 viewport 宽高比自动算(同 PDF),
  // 切换/load 完成时调 host.setEpubMaxColumnCount;PDF 路径下此 effect 不触发(renderMode 守门)
  useEffect(() => {
    if (renderMode !== 'reflowable') return;
    hostRef.current?.setEpubMaxColumnCount(pagedLayout === 'double' ? 2 : 1);
  }, [renderMode, pagedLayout]);

  if (!ctx) return null;

  const showFixedNav = renderMode === 'fixed-page' && totalPages > 0;
  const showReflowNav = renderMode === 'reflowable';

  return (
    <div className="krig-ebook-fullscreen">
      {/* 顶部精简 toolbar(沉浸式 auto-hide)*/}
      <div
        className={`krig-ebook-fullscreen__toolbar ${toolbarVisible ? '' : 'krig-ebook-fullscreen__toolbar--hidden'}`}
        onMouseEnter={() => {
          toolbarHoverRef.current = true;
          setToolbarVisible(true);
        }}
        onMouseLeave={() => {
          toolbarHoverRef.current = false;
        }}
      >
        <div className="krig-ebook-fullscreen__toolbar-section krig-ebook-fullscreen__toolbar-section--left">
          {renderMode && (
            <button
              className={`krig-ebook-fullscreen__btn ${sidebarOpen ? 'krig-ebook-fullscreen__btn--active' : ''}`}
              onClick={() => setSidebarOpen((p) => !p)}
              title="目录"
            >
              ☰
            </button>
          )}
          <span className="krig-ebook-fullscreen__filename" title={fileName}>
            {fileName}
          </span>
        </div>

        {/* 中: 导航(fixed-page 页码 / reflowable 章节进度)*/}
        {showFixedNav && (
          <div className="krig-ebook-fullscreen__toolbar-section krig-ebook-fullscreen__toolbar-section--center">
            <button
              className="krig-ebook-fullscreen__btn"
              onClick={onPrevPage}
              disabled={currentPage <= 1}
              title="上一页"
            >
              ‹
            </button>
            <span className="krig-ebook-fullscreen__page-info">
              <input
                className="krig-ebook-fullscreen__page-input"
                value={
                  editingPage
                    ? pageInput
                    : pagedLayout === 'double' && currentPage + 1 <= totalPages
                      ? `${currentPage}-${currentPage + 1}`
                      : String(currentPage)
                }
                onChange={(e) => setPageInput(e.target.value)}
                onFocus={handlePageInputFocus}
                onBlur={handlePageInputBlur}
                onKeyDown={handlePageInputKey}
                title="点击输入页号跳转"
              />
              <span className="krig-ebook-fullscreen__page-total"> / {totalPages}</span>
            </span>
            <button
              className="krig-ebook-fullscreen__btn"
              onClick={onNextPage}
              disabled={currentPage >= totalPages}
              title="下一页"
            >
              ›
            </button>
          </div>
        )}
        {showReflowNav && (
          <div className="krig-ebook-fullscreen__toolbar-section krig-ebook-fullscreen__toolbar-section--center">
            <button
              className="krig-ebook-fullscreen__btn"
              onClick={onPrevChapter}
              title="上一页 (←)"
            >
              ‹
            </button>
            <span className="krig-ebook-fullscreen__epub-progress">
              {epubChapter ? `${epubChapter} · ` : ''}
              {Math.round((epubPercentage ?? 0) * 100)}%
            </span>
            <button
              className="krig-ebook-fullscreen__btn"
              onClick={onNextChapter}
              title="下一页 (→)"
            >
              ›
            </button>
          </div>
        )}

        {/* 右: 缩放/字号 + 书签 + 退出全屏 */}
        <div className="krig-ebook-fullscreen__toolbar-section krig-ebook-fullscreen__toolbar-section--right">
          {showFixedNav && (
            <button
              className={`krig-ebook-fullscreen__btn ${bookmarks.isBookmarked(currentPage) ? 'krig-ebook-fullscreen__btn--bookmark-active' : ''}`}
              onClick={onBookmarkToggle}
              title={bookmarks.isBookmarked(currentPage) ? '移除书签 (⌘D)' : '添加书签 (⌘D)'}
            >
              <BookmarkIcon active={bookmarks.isBookmarked(currentPage)} />
            </button>
          )}
          {showReflowNav && (
            <>
              <button
                className={`krig-ebook-fullscreen__btn ${bookmarks.isBookmarked(currentPage) ? 'krig-ebook-fullscreen__btn--bookmark-active' : ''}`}
                onClick={onBookmarkToggle}
                title={bookmarks.isBookmarked(currentPage) ? '移除书签 (⌘D)' : '添加书签 (⌘D)'}
              >
                <BookmarkIcon active={bookmarks.isBookmarked(currentPage)} />
              </button>
              <button
                className="krig-ebook-fullscreen__btn"
                onClick={onFontMinus}
                disabled={fontSize <= FONT_MIN}
                title="缩小字号"
              >
                A−
              </button>
              <span className="krig-ebook-fullscreen__font-size">{fontSize}%</span>
              <button
                className="krig-ebook-fullscreen__btn"
                onClick={onFontPlus}
                disabled={fontSize >= FONT_MAX}
                title="放大字号"
              >
                A+
              </button>
            </>
          )}
          <button
            className="krig-ebook-fullscreen__btn krig-ebook-fullscreen__btn--exit"
            onClick={onClose}
            title="退出全屏 (Esc)"
            aria-label="退出全屏"
          >
            ⤢
          </button>
        </div>
      </div>

      {/* 翻页指示器(Preview 同款 — 顶部居中半透明胶囊,翻页/翻章/字号调整时浮现 1s 后淡出)
          注:外层条件不含 totalPages > 0(EPUB 没固定总页数,此过滤会让 EPUB 永远不出胶囊)*/}
      {renderMode && (
        <div
          className={`krig-ebook-fullscreen__page-indicator ${pageIndicatorVisible ? '' : 'krig-ebook-fullscreen__page-indicator--hidden'}`}
        >
          {renderMode === 'fixed-page'
            ? pagedLayout === 'double' && indicatorPage + 1 <= totalPages
              ? `Page ${indicatorPage}-${indicatorPage + 1} of ${totalPages}`
              : `Page ${indicatorPage} of ${totalPages}`
            : lastTriggerWasFontSizeRef.current
              ? `字号 ${fontSize}%`
              : epubChapter
                ? `${epubChapter} · ${Math.round((epubPercentage ?? 0) * 100)}%`
                : `${Math.round((epubPercentage ?? 0) * 100)}%`}
        </div>
      )}

      {/* SearchBar 浮在 toolbar 下面(toolbar 高 40 + 间距);搜索打开时 toolbar 强制 visible */}
      <div className="krig-ebook-fullscreen__search-wrap">
        <SearchBar
          visible={search.visible}
          results={search.results}
          currentIndex={search.currentIndex}
          onSearch={search.handleSearch}
          onNext={search.handleNext}
          onPrev={search.handlePrev}
          onClose={search.handleClose}
        />
      </div>

      <div className="krig-ebook-fullscreen__body" ref={bodyRef}>
        {sidebarOpen && (
          <OutlinePanel
            host={{
              getTOC: () => hostRef.current?.getTOC() ?? Promise.resolve([]),
              goToPage: (p) => hostRef.current?.goToPage(p),
              goToCFI: (c) => hostRef.current?.goToCFI(c),
            }}
            currentChapter={epubChapter}
            currentPage={currentPage}
            reloadToken={ctx.bookInfo.bookId}
            onClose={() => setSidebarOpen(false)}
          />
        )}
        <div className="krig-ebook-fullscreen__main">
          <EBookHost
            ref={hostRef}
            workspaceId={ctx.workspaceId}
            onPageChange={handlePageChangeFromHost}
            onLoadComplete={handleLoadComplete}
            onScaleChange={handleScaleChangeFromHost}
            onEpubProgressChange={handleEpubProgressChange}
            pdfLayout="paged"
            pagedLayout={pagedLayout}
            onPagedPageChangeStart={(p) => {
              setIndicatorPage(p);
              setIndicatorVersion((v) => v + 1);
            }}
            onPagedScaleChange={(s) => {
              lastScaleRef.current = s;
            }}
          />
        </div>
      </div>
    </div>
  );
}
