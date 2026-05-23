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
import { EpubAaPopup } from './EpubAaPopup';
import {
  loadEpubReadingSettings,
  saveEpubFontSize,
  saveEpubTheme,
  saveEpubAppearance,
} from './epub-reading-settings';
import type { EpubTheme, EpubAppearance } from '../types';
import './fullscreen-panel.css';

interface EBookFullscreenPanelProps {
  onClose: () => void;
}

type RenderMode = 'fixed-page' | 'reflowable' | null;
type PagedLayout = 'single' | 'double';

// 全屏阅读体验决议(2026-05-22):fixed-page 走翻页式(不滚动),自适应 viewport
// 单页/双页可切换;EPUB 沿用 ReflowableContent(foliate-js 自身分页)
// 字号常量(FONT_STEP/MIN/MAX)搬到 EpubAaPopup 内部,panel 不再直接调 +/-
const SAVE_PROGRESS_DEBOUNCE_MS = 500;

// Toolbar auto-hide 阈值 — 必须等于 toolbar 实际高度,否则会出现"死区互踩":
// hover zone > toolbar 时,鼠标在中间一带:mousemove 持续唤起 + onMouseLeave 持续隐藏,二者打架
// (forceShowToolbar 守门:sidebar / 搜索 / hover toolbar 时强制保留)
const TOOLBAR_HOVER_ZONE_PX = 40;
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

/**
 * 把 range CFI 折成单 anchor CFI(取 range end)。
 *
 * EPUB CFI 格式说明:
 * - 单 anchor:`epubcfi(/6/8!/4/38/1:99)` — 一段 path
 * - range:    `epubcfi(/6/8!/4,/30,/38/1:99)` — 用 `,` 分三段:base, start, end
 *
 * 全屏 spread 模式下,paginator relocate 给的是 range CFI(覆盖整个 spread 可见内容)。
 * EBookView 单页模式 reopen 用 view.goTo(rangeCFI) 会跳到 range start(左页起点);
 * 用户期望"打开后回到刚才阅读到的位置(右页)",所以 save 前折成 range end anchor。
 *
 * 不 import foliate-js epubcfi 模块(panel 不该直 import npm)— 字符串拆解足够:
 * 去掉 epubcfi(...) 外壳,split 一级 comma(注意 base 内含 `!` 不含 `,`),
 * 拼 base + end,包回 epubcfi(...).
 */
function collapseRangeCfiToEnd(cfi: string): string {
  const m = /^epubcfi\((.*)\)$/.exec(cfi);
  if (!m) return cfi;
  const inner = m[1];
  // range cfi 在外层有两个 `,`(base,start,end)。如果不是 range,直接原样返回
  const parts = inner.split(',');
  if (parts.length !== 3) return cfi;
  const [base, , end] = parts;
  return `epubcfi(${base}${end})`;
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
  const [epubPage, setEpubPage] = useState(0);
  const [epubPages, setEpubPages] = useState(0);
  // 字号 + 主题从 localStorage 加载(跨 session 持久);默认 100% / original
  const initialSettings = useMemo(() => loadEpubReadingSettings(), []);
  const [fontSize, setFontSize] = useState(initialSettings.fontSize);
  const [epubTheme, setEpubTheme] = useState<EpubTheme>(initialSettings.theme);
  const [epubAppearance, setEpubAppearance] = useState<EpubAppearance>(initialSettings.appearance);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Aa popup 自管 visible(workspace 在 panel active 时 display:none,
  // popup-registry 不可用 — 直接用 React state)
  const [aaPopupOpen, setAaPopupOpen] = useState(false);
  const aaButtonRef = useRef<HTMLButtonElement | null>(null);
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
  // 最新位置缓存(unmount flush 用 — debounce 未到时退出全屏,直接 flush 最新值)
  const lastPdfPageRef = useRef<number | null>(null);
  const lastEpubCfiRef = useRef<string | null>(null);
  const persistPdfProgress = useCallback(
    (page: number) => {
      const bookId = bookIdRef.current;
      if (!bookId) return;
      lastPdfPageRef.current = page;
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
  // 最新右页全书 page + total — 用于 panel 翻页 / unmount 时 save right page
  // (cfi 字段保留兼容旧 view,新 epubPage 字段优先用)
  const lastEpubPageRef = useRef<number>(0);
  const lastEpubPagesRef = useRef<number>(0);
  const persistEpubProgress = useCallback(
    (cfi: string, leftPage: number, totalPages: number) => {
      const bookId = bookIdRef.current;
      if (!bookId) return;
      // panel.progress.page 是 spread 左页全书 page(loc.current+1);双页模式下
      // 用户阅读位置 = 右页 = 左页+1。立即 save 右页 page + 折叠 cfi 作兜底
      const rightPage = leftPage + 1;
      const collapsed = collapseRangeCfiToEnd(cfi);
      lastEpubCfiRef.current = collapsed;
      lastEpubPageRef.current = rightPage;
      lastEpubPagesRef.current = totalPages;
      void library.saveProgress(bookId, {
        cfi: collapsed,
        epubPage: rightPage,
        epubPages: totalPages,
      });
    },
    [library],
  );

  // mount: load book + bookmarks;unmount 时 flush 最新位置(避免 debounce 未触发就退出)
  useEffect(() => {
    if (!ctx) {
      console.warn('[ebook-fullscreen] mount without ctx — closing');
      onClose();
      return;
    }
    console.log('[ebook-fullscreen] panel mount; bookInfo.lastPosition=', ctx.bookInfo.lastPosition);
    void hostRef.current?.loadFromInfo(ctx.bookInfo);
    bookmarks.loadOnBookOpen(ctx.bookInfo.bookId);
    return () => {
      // EPUB 已在 persistEpubProgress 每次翻页立即 save(无 debounce),lastEpubCfiRef
      // 是最新右页 cfi;PDF 仍走 debounce,unmount 时兜底 flush 最新位置
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const bookId = bookIdRef.current;
      if (bookId && lastPdfPageRef.current != null && !lastEpubCfiRef.current) {
        void library.saveProgress(bookId, {
          page: lastPdfPageRef.current,
          scale: lastScaleRef.current,
          fitWidth: FULLSCREEN_FIT_WIDTH,
        });
      }
      console.log(
        '[ebook-fullscreen] panel unmount; lastEpubCfi=', lastEpubCfiRef.current?.slice(0, 80),
      );
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
        // 推 localStorage 加载的字号 + 主题 + 明暗模式给 renderer(覆盖 host 内部默认值)
        // 注:setMaxColumnCount 由 [renderMode, pagedLayout] effect 兜底推
        hostRef.current?.setFontSize(fontSize);
        hostRef.current?.setEpubTheme(epubTheme);
        hostRef.current?.setEpubAppearance(epubAppearance);
      }
    },
    [fontSize, epubTheme, epubAppearance],
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
    (progress: { chapter: string; percentage: number; page: number; pages: number }) => {
      const cfi = hostRef.current?.getCurrentCFI();
      console.log('[ebook-fullscreen] progress; page=', progress.page, 'pages=', progress.pages, 'cfi=', cfi?.slice(0, 80));
      setEpubChapter(progress.chapter);
      setEpubPercentage(progress.percentage);
      setEpubPage(progress.page);
      setEpubPages(progress.pages);
      if (cfi) persistEpubProgress(cfi, progress.page, progress.pages);
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
  // PDF/EPUB 通用:focus 取当前页(PDF=currentPage, EPUB=epubPage),
  // blur 调 host.goToPage(host 内部按 renderMode 分发到正确 renderer)
  const inputCurrentPage = renderMode === 'reflowable' ? epubPage : currentPage;
  const inputTotalPages = renderMode === 'reflowable' ? epubPages : totalPages;
  const handlePageInputFocus = useCallback(() => {
    setPageInput(String(inputCurrentPage));
    setEditingPage(true);
  }, [inputCurrentPage]);
  const handlePageInputBlur = useCallback(() => {
    setEditingPage(false);
    const page = parseInt(pageInput, 10);
    if (!isNaN(page) && page >= 1 && page <= inputTotalPages) {
      // PDF: host.goToPage 内部 spreadStart 对齐
      // EPUB: host.goToPage 走 renderer.goToPage 按 fraction 跳
      hostRef.current?.goToPage(page);
    }
  }, [pageInput, inputTotalPages]);
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
  // 字号 setter 统一封装 — 写 host + 写本地 state + 写 localStorage + bump indicator
  // popup 内部直接传目标值(EpubAaPopup 自管 +/- 步长计算),panel toolbar 不再直接调字号
  const applyFontSize = useCallback((next: number) => {
    hostRef.current?.setFontSize(next);
    setFontSize(next);
    saveEpubFontSize(next);
    lastTriggerWasFontSizeRef.current = true;
    setIndicatorVersion((v) => v + 1); // 字号调整时浮现胶囊(显示当前字号)
  }, []);
  // 主题 setter — 写 host + 本地 state + localStorage(不触发 indicator,主题变化是显式视觉反馈)
  const onThemeChange = useCallback((t: EpubTheme) => {
    hostRef.current?.setEpubTheme(t);
    setEpubTheme(t);
    saveEpubTheme(t);
  }, []);
  const onAppearanceChange = useCallback((a: EpubAppearance) => {
    hostRef.current?.setEpubAppearance(a);
    setEpubAppearance(a);
    saveEpubAppearance(a);
  }, []);

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
    if (toolbarHideTimerRef.current) clearTimeout(toolbarHideTimerRef.current);
    toolbarHideTimerRef.current = setTimeout(() => {
      if (!forceShowToolbar) setToolbarVisible(false);
    }, TOOLBAR_INITIAL_SHOW_MS);
    return () => {
      if (toolbarHideTimerRef.current) clearTimeout(toolbarHideTimerRef.current);
    };
  }, []);

  // 唤起:鼠标进入顶部 hover zone(toolbar 高度之内)即显示;
  // 隐藏由 toolbar 节点的 onMouseLeave 处理(立即收),不再在 mousemove 里做
  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (e.clientY <= TOOLBAR_HOVER_ZONE_PX) {
        setToolbarVisible(true);
        if (toolbarHideTimerRef.current) clearTimeout(toolbarHideTimerRef.current);
      }
    };
    window.addEventListener('mousemove', handler);
    return () => {
      window.removeEventListener('mousemove', handler);
    };
  }, []);

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

  // EPUB 进度变化(翻章/page/percentage 变化)— bump indicator version 让胶囊出现
  // 注:相同 page+chapter 不重复触发(避免连续 relocate 推流闪烁)
  useEffect(() => {
    if (renderMode !== 'reflowable') return;
    if (!epubChapter && epubPercentage === 0 && epubPage === 0) return;
    lastTriggerWasFontSizeRef.current = false; // 翻章 → 恢复 progress 显示
    setIndicatorVersion((v) => v + 1);
  }, [epubChapter, epubPercentage, epubPage, renderMode]);

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
          if (!sidebarOpen && !search.visible && !aaPopupOpen) {
            setToolbarVisible(false);
          }
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

        {/* 中: 导航胶囊(fixed-page 页码可输入 / reflowable 章节进度)— 圆角胶囊包 ‹ 信息 ›*/}
        {showFixedNav && (
          <div className="krig-ebook-fullscreen__toolbar-section krig-ebook-fullscreen__toolbar-section--center">
            <div className="krig-ebook-fullscreen__nav-pill">
              <button
                className="krig-ebook-fullscreen__nav-pill-btn"
                onClick={onPrevPage}
                disabled={currentPage <= 1}
                title="上一页"
                aria-label="上一页"
              >
                ‹
              </button>
              <span className="krig-ebook-fullscreen__nav-pill-info">
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
                <span className="krig-ebook-fullscreen__page-total"> of {totalPages}</span>
              </span>
              <button
                className="krig-ebook-fullscreen__nav-pill-btn"
                onClick={onNextPage}
                disabled={currentPage >= totalPages}
                title="下一页"
                aria-label="下一页"
              >
                ›
              </button>
            </div>
          </div>
        )}
        {showReflowNav && (
          <div className="krig-ebook-fullscreen__toolbar-section krig-ebook-fullscreen__toolbar-section--center">
            <div className="krig-ebook-fullscreen__nav-pill">
              <button
                className="krig-ebook-fullscreen__nav-pill-btn"
                onClick={onPrevChapter}
                title="上一页 (←)"
                aria-label="上一页"
              >
                ‹
              </button>
              <span className="krig-ebook-fullscreen__nav-pill-info">
                {epubPages > 0 ? (
                  <>
                    <input
                      className="krig-ebook-fullscreen__page-input"
                      value={editingPage ? pageInput : String(epubPage)}
                      onChange={(e) => setPageInput(e.target.value)}
                      onFocus={handlePageInputFocus}
                      onBlur={handlePageInputBlur}
                      onKeyDown={handlePageInputKey}
                      title="点击输入页号跳转"
                    />
                    <span className="krig-ebook-fullscreen__page-total"> of {epubPages}</span>
                  </>
                ) : (
                  // EPUB 还没分页就绪时降级显示百分比(很短暂,relocate 后立即变页码)
                  `${Math.round((epubPercentage ?? 0) * 100)}%`
                )}
              </span>
              <button
                className="krig-ebook-fullscreen__nav-pill-btn"
                onClick={onNextChapter}
                title="下一页 (→)"
                aria-label="下一页"
              >
                ›
              </button>
            </div>
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
                ref={aaButtonRef}
                className={`krig-ebook-fullscreen__btn ${aaPopupOpen ? 'krig-ebook-fullscreen__btn--active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setAaPopupOpen((p) => !p)}
                title="字号 / 主题"
                aria-label="字号 / 主题"
                aria-expanded={aaPopupOpen}
              >
                <span className="krig-ebook-fullscreen__aa-small">A</span>
                <span className="krig-ebook-fullscreen__aa-large">A</span>
              </button>
              <button
                className={`krig-ebook-fullscreen__btn ${bookmarks.isBookmarked(currentPage) ? 'krig-ebook-fullscreen__btn--bookmark-active' : ''}`}
                onClick={onBookmarkToggle}
                title={bookmarks.isBookmarked(currentPage) ? '移除书签 (⌘D)' : '添加书签 (⌘D)'}
              >
                <BookmarkIcon active={bookmarks.isBookmarked(currentPage)} />
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
              : epubPages > 0
                ? `Page ${epubPage} of ${epubPages}`
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

      {/* Aa popup(字号 + 主题)— EPUB 路径 Aa 按钮触发,点外关闭 */}
      {aaPopupOpen && showReflowNav && (
        <div
          className="krig-ebook-fullscreen__aa-popup-anchor"
          onMouseDown={(e) => {
            // popup 内部点击不冒泡到 overlay,popup 外部点击(此 wrap 自身)关闭
            if (e.target === e.currentTarget) {
              setAaPopupOpen(false);
              // 点 popup 外关闭时,鼠标必然不在 toolbar 上(toolbar 在 anchor 之上的 0-40px),
              // 主动让 toolbar 立刻收(否则要等下一次 mousemove 才触发判断)
              if (!sidebarOpen && !search.visible && !toolbarHoverRef.current) {
                setToolbarVisible(false);
              }
            }
          }}
        >
          <div className="krig-ebook-fullscreen__aa-popup-position">
            <EpubAaPopup
              fontSize={fontSize}
              theme={epubTheme}
              appearance={epubAppearance}
              onFontSizeChange={applyFontSize}
              onThemeChange={onThemeChange}
              onAppearanceChange={onAppearanceChange}
            />
          </div>
        </div>
      )}

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
            epubLayout="paged"
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
