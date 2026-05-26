/**
 * EBookHost — ebook-rendering capability 主组件(L5-C2)
 *
 * forwardRef + 命令式 API:view 通过 ref 调用 openBookId / goToPage / setScale 等。
 * 内部封装 pdfjs-dist(C2)+ foliate-js(C3 起);view 不直 import 任何 npm。
 *
 * 数据通路(订阅模式):
 *   ebook-library.onBookOpened(推送)
 *     ↓ Host 内 useEffect 订阅
 *   library.getData() 拿 Uint8Array
 *     ↓
 *   PDFRenderer.load(buffer)
 *     ↓
 *   FixedPageContent 渲染(by IFixedPageRenderer)
 *
 * view 端只感知 props/callbacks/ref,不感知 pdfjs-dist 的存在。
 *
 * 见 v0.3 § 3.2 + capabilities/web-rendering/Host.tsx 模板。
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { EBookLibraryApi, EBookLoadedInfo } from '@capabilities/ebook-library/types';
import {
  type IBookRenderer,
  type IFixedPageRenderer,
  type EBookFileType,
  type BookPosition,
  type TOCItem,
  isFixedPage,
  isReflowable,
  detectFileType,
} from './types';
import { PDFRenderer } from './pdf';
import { EPUBRenderer } from './epub';
import { ReflowableContent } from './reflowable-content';
import { PdfScrollContent } from './pdf-scroll-content';
import {
  FullscreenPageView,
  type FullscreenPageViewHandle,
  type FullscreenPagedLayout,
} from './fullscreen/FullscreenPageView';

/** view 通过 ref 调用的命令式 API(EBookHostHandle)*/
export interface EBookHostHandle {
  /** 由外部 onBookOpened 推送驱动加载 — view 端常用 */
  loadFromInfo(info: EBookLoadedInfo): Promise<void>;
  /** 滚动到指定页(PDF / fixed-page)*/
  goToPage(page: number): void;
  /** 跳到 CFI(EPUB,reflowable)*/
  goToCFI(cfi: string): void;
  /** 设置 scale(PDF)*/
  setScale(scale: number): void;
  /** 适应宽度切换(PDF)— Host 内部计算 scale */
  setFitWidth(on: boolean): void;
  /** 当前 renderer 是否 fixed-page(toolbar 用来选择导航形态)*/
  getRenderMode(): 'fixed-page' | 'reflowable' | null;
  /** 当前总页数(fixed-page);EPUB 返 null */
  getTotalPages(): number | null;

  // ── EPUB 专用 ──
  /** EPUB 上一章 */
  prevChapter(): void;
  /** EPUB 下一章 */
  nextChapter(): void;
  /** EPUB 字号(默认 100;V1 60~200 范围)*/
  setFontSize(size: number): void;
  getFontSize(): number;
  /** EPUB 最大列数(1=单页 / 2=双页);foliate-js 按容器宽度自适应 */
  setEpubMaxColumnCount(count: 1 | 2, maxInlineSizePx?: number): void;
  /** EPUB 阅读色调主题(6 个风格之一) */
  setEpubTheme(theme: import('./types').EpubTheme): void;
  /** EPUB 明暗模式(light/dark/auto) — 与 theme 正交 */
  setEpubAppearance(appearance: import('./types').EpubAppearance): void;

  // ── TOC + Search(C3 给 outline / search bar 用)──
  /** 取 renderer 提供的 TOC 树(异步:EPUB 等 readyPromise) */
  getTOC(): Promise<TOCItem[]>;
  /** 全文搜索(PDF + EPUB 通用) */
  searchText(query: string): Promise<SearchResult[]>;
  /** 跳转到搜索结果(fixed-page 走 page;reflowable 走 CFI)*/
  goToSearchResult(result: SearchResult): void;
  /** 清搜索结果 */
  clearSearch(): void;

  // ── C4:EPUB 当前位置 + 高亮 + 选区 ──
  /** EPUB 最新 CFI(view 持久化 saveProgress 用,关闭 C3 已知短板);
   *  PDF 返 null */
  getCurrentCFI(): string | null;
  /** EPUB 添加 CFI 高亮;PDF noop */
  addHighlight(cfi: string, color: string): Promise<void>;
  /** EPUB 移除 CFI 高亮;PDF noop */
  removeHighlight(cfi: string): void;
  /**
   * PR-α-3b followup fix:推送已知 EPUB 标注 cfi 列表给 renderer。
   * renderer 在 iframe contextmenu/dblclick 内做几何命中(foliate svg pointer-events:none
   * 致 closest 路径失效,改用 caretPositionFromPoint + resolveCFI range 包含检测)。
   * PDF noop。
   */
  setKnownEpubAnnotationCfis(cfis: string[]): void;

  /**
   * 截 PDF 指定页面 rect 区域为 JPEG dataUrl(独立离屏 render 2x DPR)。
   * EPUB / 未加载 PDF 字面拒绝(reject)。
   * rect 坐标基于 scale=1 的页面尺寸(与 PageAnnotation.rect 同坐标系)。
   * 2026-05-24 拍板:抽象为 host 级 API,后续 EPUB / 其他 view 截图同模式复用。
   */
  capturePageRect(
    pageNum: number,
    rect: { x: number; y: number; w: number; h: number },
  ): Promise<string>;

  /**
   * PR-α-3b followup:检测当前 PDF 某页是否含 text content。
   * EPUB / 未加载 → false。扫描件 PDF 返 false(用于 ✎ 文字标注启用前判断,
   * 避免用户在扫描页拖选无效)。
   */
  hasTextContent(pageNum: number): Promise<boolean>;
}

/** 搜索结果(PDF / EPUB 通用结构)*/
export interface SearchResult {
  /** PDF: 页码;EPUB: section index */
  pageNum: number;
  index: number;
  text: string;
  /** EPUB 用:跳转 CFI(searchText 内部计算后由 goToSearchResult 消费)*/
  cfi?: string;
}

export interface EBookHostProps {
  workspaceId: string;
  /** 当前页号变化(toolbar 用作 currentPage 显示)*/
  onPageChange?: (page: number) => void;
  /** 加载完成后回调(view 用来同步 totalPages 等)*/
  onLoadComplete?: (info: {
    totalPages: number;
    fileType: EBookFileType;
    renderMode: 'fixed-page' | 'reflowable';
  }) => void;
  /** scale 变化(view 用来同步 toolbar)*/
  onScaleChange?: (scale: number) => void;
  /** 加载/未加载 状态变化(view 决定显示空状态)*/
  onReadyChange?: (ready: boolean) => void;
  /** EPUB 进度变化(章节标题 + 比例)— view 持久化 + toolbar 显示 */
  onEpubProgressChange?: (progress: { chapter: string; percentage: number; page: number; pages: number }) => void;

  // ── C4:EPUB 文本选择 + 标注事件 ──
  /** 文本选择(mouseup 后)— view 端弹 picker(view 计算位置)*/
  onEpubTextSelected?: (info: {
    cfi: string;
    text: string;
    x: number;
    y: number;
  }) => void;
  /** mousedown / 显式 dismiss → view 关 picker */
  onEpubSelectionDismiss?: () => void;
  /** 点击已有标注(show-annotation 事件)→ view 触发删除 */
  onEpubAnnotationClick?: (cfi: string) => void;
  /**
   * PR-α-3b followup:EPUB iframe 内右键 → view 端调 contextMenuController.show
   * 走 L4 右键菜单。x/y 已转 viewport 坐标(fixed position 用)。
   * annotationCfi 非 null = 右键 target 命中已有标注(走 has-epub-annotation predicate)。
   */
  onEpubContextMenu?: (info: {
    x: number;
    y: number;
    text: string;
    cfi: string | null;
    annotationCfi: string | null;
  }) => void;
  /** PR-α-3b followup:标注双击 → activate 关联 thought */
  onEpubAnnotationDoubleClick?: (annotationCfi: string) => void;

  // ── C5:PDF 空间标注 ──
  /** 标注模式(off / rect)— PDF 路径,EPUB 不消费;2026-05-24 删 underline */
  pdfAnnotationMode?: 'off' | 'rect';
  /** 已有 PDF 空间标注(view 从 library 加载后传入) */
  pdfAnnotations?: import('./annotation-layer').PageAnnotation[];
  /**
   * scroll-to-source 跳转后短暂高亮的标注 id(view 端 useState 持,~1.5s 后自动清空)。
   * AnnotationLayer 对 id 匹配的标注加 .krig-ebook-annotation--flashing CSS class。
   */
  pdfFlashAnnotationId?: string | null;
  /**
   * 用户拖拽创建标注 → view 端调 ebook capability 新 thought block API
   * (sub-phase 022 Step 5.6: lib.addReadingThoughtBlock 替代 lib.annotationAdd)
   */
  onPdfAnnotationCreate?: (
    pageNum: number,
    annotation: import('./annotation-layer').AnnotationDraft,
  ) => void;
  /**
   * PR-α-3:PDF textLayer 选区命中回调(scroll + paged 两种模式都触发)。
   * view 端拿到 event → 弹 picker(5 色 + Underline / Strikethrough 切换)。
   */
  onPdfTextSelected?: (
    ev: import('./hooks/use-pdf-text-selection').PdfTextSelectionEvent,
  ) => void;
  /**
   * PDF textLayer 异步渲染完成回调(vocab-highlight 2026-05-25 加)。
   * 主区 + 全屏两种模式都触发;view 端用于扫 textLayer span 给 vocab 命中词画高亮。
   */
  onPdfTextLayerRendered?: (pageNum: number, textLayer: HTMLElement) => void;
  // ── PDF 全屏翻页式渲染(2026-05-24)──
  /**
   * PDF 渲染模式:
   * - 'scroll'(默认):FixedPageContent 连续滚动 + 虚拟化(view 主区,非全屏)
   * - 'paged':FullscreenPageView 翻页式 + 不滚动(全屏 navSideCollapsed=true)
   *
   * EPUB 不受此 prop 影响 — foliate-js 自身分页,沿用 ReflowableContent。
   */
  pdfLayout?: 'scroll' | 'paged';
  /** paged 布局下的分页样式 — 'single' 单页 / 'double' 双页并排(view 按容器宽高比自适应)*/
  pagedLayout?: FullscreenPagedLayout;
}

const FIT_WIDTH_PADDING = 40;

export const EBookHost = forwardRef<EBookHostHandle, EBookHostProps>(function EBookHost(
  {
    workspaceId: _workspaceId,
    onPageChange,
    onLoadComplete,
    onScaleChange,
    onReadyChange,
    onEpubProgressChange,
    onEpubTextSelected,
    onEpubSelectionDismiss,
    onEpubAnnotationClick,
    onEpubContextMenu,
    onEpubAnnotationDoubleClick,
    pdfAnnotationMode,
    pdfAnnotations,
    pdfFlashAnnotationId,
    onPdfAnnotationCreate,
    onPdfTextSelected,
    onPdfTextLayerRendered,
    pdfLayout = 'scroll',
    pagedLayout = 'single',
  },
  ref,
) {
  const library = useMemo(
    () => requireCapabilityApi<EBookLibraryApi>('ebook-library'),
    [],
  );

  const rendererRef = useRef<IBookRenderer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fitWidthRef = useRef(true);
  const scaleRef = useRef(1.0);

  const [rendererReady, setRendererReady] = useState(false);
  const [renderer, setRenderer] = useState<IBookRenderer | null>(null);
  const [scale, setScale] = useState(1.0);
  const [fitWidth, setFitWidth] = useState(true);
  const [restorePage, setRestorePage] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // FixedPageContent / FullscreenPageView 注册的 gotoPage 回调
  const gotoPageRef = useRef<((page: number) => void) | null>(null);
  const registerGotoPage = useCallback((fn: (page: number) => void) => {
    gotoPageRef.current = fn;
  }, []);

  // 当前 PDF 页号 — paged ↔ scroll 切换时,FixedPageContent / FullscreenPageView
  // 重 mount,把这个值作为 initialPage 喂回去,保持页面连续(用户在 paged 翻到
  // 100 页 → ESC 退全屏 → scroll 模式打开后停在 100 页附近)
  const lastPdfPageRef = useRef<number | null>(null);
  const handlePdfPageChange = useCallback(
    (page: number) => {
      lastPdfPageRef.current = page;
      onPageChange?.(page);
    },
    [onPageChange],
  );

  // 同步 ref(供 useEffect 闭包内拿最新值)
  useEffect(() => {
    fitWidthRef.current = fitWidth;
  }, [fitWidth]);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  // ── 核心加载逻辑 ──

  const loadFromInfo = useCallback(
    async (info: EBookLoadedInfo) => {
      try {
        setLoading(true);
        setRendererReady(false);
        setRenderer(null);

        // 销毁旧 renderer
        rendererRef.current?.destroy();
        rendererRef.current = null;

        // 拿 buffer
        const result = await library.getData();
        if (!result) {
          setLoading(false);
          return;
        }

        const fileType = info.fileType ?? detectFileType(result.fileName);
        const r = createRendererFor(fileType);
        if (!r) {
          console.warn(`[ebook-rendering] renderer for ${fileType} not yet implemented`);
          setLoading(false);
          return;
        }

        // result.data 在 IPC 序列化后是 Uint8Array;PDFRenderer.load 接 ArrayBuffer
        // 直接传 Uint8Array,内部判类型转换
        const data = result.data;
        const buffer =
          data instanceof Uint8Array
            ? (data.buffer.slice(
                data.byteOffset,
                data.byteOffset + data.byteLength,
              ) as ArrayBuffer)
            : (data as ArrayBuffer);

        await r.load(buffer);
        rendererRef.current = r;

        const pos = info.lastPosition;

        // 恢复缩放模式
        const shouldFitWidth = pos?.fitWidth !== undefined ? pos.fitWidth : true;
        setFitWidth(shouldFitWidth);

        if (isFixedPage(r)) {
          if (!shouldFitWidth && pos?.scale) {
            setScale(pos.scale);
            r.setScale(pos.scale);
          }
          onLoadComplete?.({
            totalPages: r.getTotalPages(),
            fileType,
            renderMode: 'fixed-page',
          });
        } else if (isReflowable(r)) {
          // EPUB 恢复 — 走 cfi(用户视觉位置精确锚点):
          //   全屏布局对齐设计(2026-05-23):panel spread 单 column 宽 = view 主区
          //   单 column 宽,paginator 切分文字位置一致 → cfi.goTo 在两 view 落到
          //   相同的"视觉第一行" → 不再需要 anchor 落点校正 / range cfi 折叠
          //   等任何变通逻辑。完整设计见 docs/tasks/epub-fullscreen-flip-handoff.md
          if (pos?.cfi) r.setRestoreLocation(pos.cfi);

          // C4:转推 EPUB 选区 / 选区取消 / 标注点击事件给 view
          if (onEpubTextSelected) r.onTextSelected(onEpubTextSelected);
          if (onEpubSelectionDismiss) r.onSelectionDismiss(onEpubSelectionDismiss);
          if (onEpubAnnotationClick) r.onAnnotationClick(onEpubAnnotationClick);
          // PR-α-3b followup:EPUB iframe 内右键 / 双击 → 转推给 view
          if (onEpubContextMenu) r.onContextMenu(onEpubContextMenu);
          if (onEpubAnnotationDoubleClick) r.onDoubleClick(onEpubAnnotationDoubleClick);

          onLoadComplete?.({
            totalPages: 0,
            fileType,
            renderMode: 'reflowable',
          });
        }

        setRestorePage(pos?.page && pos.page > 1 ? pos.page : null);
        setRenderer(r);
        setRendererReady(true);
        setLoading(false);
        onReadyChange?.(true);

        // 适应宽度:等 DOM 更新后计算
        if (shouldFitWidth && isFixedPage(r)) {
          const fr = r;
          requestAnimationFrame(() => {
            const dims = fr.getPageDimensions();
            if (dims.length > 0 && containerRef.current) {
              const cw = containerRef.current.clientWidth - FIT_WIDTH_PADDING;
              const pageW = dims[0].width;
              const rawScale = cw / pageW;
              // 防御:容器还没布局好(cw<=0)或算出异常 scale 时,fallback 1.0,
              // 后续 ResizeObserver / window resize 会再算一次
              const newScale =
                cw > 0 && Number.isFinite(rawScale) && rawScale > 0.1
                  ? rawScale
                  : 1.0;
              console.log(
                '[ebook-rendering/Host] fit-width init: cw=',
                cw,
                'pageW=',
                pageW,
                'rawScale=',
                rawScale,
                'finalScale=',
                newScale,
              );
              setScale(newScale);
              fr.setScale(newScale);
              onScaleChange?.(newScale);
            }
          });
        }
      } catch (err) {
        console.error('[ebook-rendering/Host] Failed to load:', err);
        setLoading(false);
      }
    },
    [
      library,
      onLoadComplete,
      onScaleChange,
      onReadyChange,
      onEpubTextSelected,
      onEpubSelectionDismiss,
      onEpubAnnotationClick,
      onEpubContextMenu,
      onEpubAnnotationDoubleClick,
    ],
  );

  // **订阅模式**:Host 不订阅 onBookOpened — 由 view 端订阅,通过 ref 命令式
  // 调 hostRef.current.loadFromInfo(info)。这样数据流单向 view → Host,
  // 避免 Host 和 view 双订阅导致的重复加载。
  //
  // 重启恢复:view 端通过 activeBookId 主动调 library.open(),触发 main 推
  // EBOOK_LOADED → view 收到 → ref 调 loadFromInfo。本 Host 不在 mount 时
  // 自动 open,完全由 view 协调。

  // 销毁时清 renderer
  useEffect(() => {
    return () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  // fit-width 跟随容器宽度变化(window resize + ResizeObserver — 后者覆盖
  // slot binding 切换 / 双栏布局变化 / Flex 异步 layout 等不触发 window resize 的场景)
  useEffect(() => {
    if (!fitWidth || !rendererReady) return;
    const handle = (): void => {
      const r = rendererRef.current;
      if (!r || !isFixedPage(r) || !containerRef.current) return;
      const dims = r.getPageDimensions();
      if (dims.length === 0) return;
      const cw = containerRef.current.clientWidth - FIT_WIDTH_PADDING;
      if (cw <= 0) return;
      const newScale = cw / dims[0].width;
      if (!Number.isFinite(newScale) || newScale <= 0.1) return;
      setScale(newScale);
      r.setScale(newScale);
      onScaleChange?.(newScale);
    };
    window.addEventListener('resize', handle);

    let observer: ResizeObserver | null = null;
    if (containerRef.current && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(handle);
      observer.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handle);
      observer?.disconnect();
    };
  }, [fitWidth, rendererReady, onScaleChange]);

  // ── view 命令式 API ──

  const pdfLayoutRef = useRef(pdfLayout);
  useEffect(() => {
    pdfLayoutRef.current = pdfLayout;
  }, [pdfLayout]);

  const handleScaleChange = useCallback(
    (newScale: number) => {
      // paged 模式 scale 完全自动(viewport fit)— toolbar 调 scale 在全屏期 noop
      if (pdfLayoutRef.current === 'paged') return;
      setFitWidth(false);
      setScale(newScale);
      const r = rendererRef.current;
      if (r && isFixedPage(r)) r.setScale(newScale);
      onScaleChange?.(newScale);
    },
    [onScaleChange],
  );

  const handleSetFitWidth = useCallback(
    (on: boolean) => {
      // paged 模式不消费 fitWidth(scale 自动)
      if (pdfLayoutRef.current === 'paged') return;
      setFitWidth(on);
      if (on) {
        requestAnimationFrame(() => {
          const r = rendererRef.current;
          if (!r || !isFixedPage(r) || !containerRef.current) return;
          const dims = r.getPageDimensions();
          if (dims.length === 0) return;
          const cw = containerRef.current.clientWidth - FIT_WIDTH_PADDING;
          const newScale = cw / dims[0].width;
          setScale(newScale);
          r.setScale(newScale);
          onScaleChange?.(newScale);
        });
      }
    },
    [onScaleChange],
  );

  useImperativeHandle(
    ref,
    () => ({
      loadFromInfo,
      goToPage(page: number): void {
        // PDF: 走 FixedPageContent / FullscreenPageView 注册的 gotoPage 回调
        // EPUB: renderer.goToPage 按 fraction 近似定位
        if (gotoPageRef.current) {
          gotoPageRef.current(page);
          return;
        }
        const r = rendererRef.current;
        if (r && isReflowable(r)) {
          void r.goToPage(page);
        }
      },
      goToCFI(cfi: string): void {
        const r = rendererRef.current;
        if (!r) return;
        const pos: BookPosition = { type: 'cfi', cfi };
        r.goTo(pos);
      },
      setScale: handleScaleChange,
      setFitWidth: handleSetFitWidth,
      getRenderMode(): 'fixed-page' | 'reflowable' | null {
        return rendererRef.current?.renderMode ?? null;
      },
      getTotalPages(): number | null {
        const r = rendererRef.current;
        if (r && isFixedPage(r)) return r.getTotalPages();
        return null;
      },
      // ── EPUB 专用 ──
      prevChapter(): void {
        const r = rendererRef.current;
        if (r && isReflowable(r)) r.prevChapter();
      },
      nextChapter(): void {
        const r = rendererRef.current;
        if (r && isReflowable(r)) r.nextChapter();
      },
      setFontSize(size: number): void {
        const r = rendererRef.current;
        if (r && isReflowable(r)) r.setFontSize(size);
      },
      getFontSize(): number {
        const r = rendererRef.current;
        if (r && isReflowable(r)) return r.getFontSize();
        return 100;
      },
      setEpubMaxColumnCount(count: 1 | 2): void {
        const r = rendererRef.current;
        if (r && isReflowable(r)) r.setMaxColumnCount(count);
      },
      setEpubTheme(theme): void {
        const r = rendererRef.current;
        if (r && isReflowable(r)) r.setTheme(theme);
      },
      setEpubAppearance(appearance): void {
        const r = rendererRef.current;
        if (r && isReflowable(r)) r.setAppearance(appearance);
      },
      // ── TOC + Search ──
      async getTOC(): Promise<TOCItem[]> {
        const r = rendererRef.current;
        if (!r) return [];
        return r.getTOC();
      },
      async searchText(query: string): Promise<SearchResult[]> {
        const r = rendererRef.current;
        if (!r) return [];
        if (isFixedPage(r)) return r.searchText(query);
        if (isReflowable(r)) return r.searchText(query);
        return [];
      },
      goToSearchResult(result: SearchResult): void {
        const r = rendererRef.current;
        if (!r) return;
        if (isFixedPage(r)) {
          gotoPageRef.current?.(result.pageNum);
        } else if (isReflowable(r) && result.cfi) {
          r.goTo({ type: 'cfi', cfi: result.cfi });
        }
      },
      clearSearch(): void {
        const r = rendererRef.current;
        if (r && isReflowable(r)) r.clearSearch();
      },
      // ── C4:EPUB 当前位置 + 高亮 ──
      getCurrentCFI(): string | null {
        const r = rendererRef.current;
        if (r && isReflowable(r)) return r.getLastCFI();
        return null;
      },
      async addHighlight(cfi: string, color: string): Promise<void> {
        const r = rendererRef.current;
        if (r && isReflowable(r)) await r.addHighlight(cfi, color);
      },
      removeHighlight(cfi: string): void {
        const r = rendererRef.current;
        if (r && isReflowable(r)) r.removeHighlight(cfi);
      },
      setKnownEpubAnnotationCfis(cfis: string[]): void {
        const r = rendererRef.current;
        if (r && isReflowable(r)) r.setKnownAnnotationCfis(cfis);
      },
      async capturePageRect(
        pageNum: number,
        rect: { x: number; y: number; w: number; h: number },
      ): Promise<string> {
        const r = rendererRef.current;
        if (!r || !isFixedPage(r)) {
          throw new Error('capturePageRect requires a loaded fixed-page (PDF) renderer');
        }
        return r.capturePageRect(pageNum, rect);
      },
      async hasTextContent(pageNum: number): Promise<boolean> {
        const r = rendererRef.current;
        if (!r || !isFixedPage(r)) return false; // EPUB / 未加载 → false
        return r.hasTextContent(pageNum);
      },
    }),
    [loadFromInfo, handleScaleChange, handleSetFitWidth],
  );

  // ── 渲染 ──

  // 注:Host 不处理"未选择书"空状态 — view 端在 activeBookId == null 时
  // 就 early return,不挂 Host;Host 进 mount 时一定有 activeBookId,只
  // 区分 loading / ready / 不支持的 renderMode。

  return (
    <div className="krig-ebook-host" ref={containerRef}>
      {loading && <div className="krig-ebook-loading">Loading...</div>}

      {/*
       * PDF scroll 主分支 — pdfjs PDFViewer adapter(2026-05-25 全量重构)。
       * 旧 FixedPageContent + 自管 canvas/textLayer 渲染已删,改走 pdf-viewer capability。
       * 参数 scale / initialPage / scroll 由 pdfjs PDFViewer 内部管理,Host 不再透传。
       */}
      {!loading && rendererReady && renderer && isFixedPage(renderer) && pdfLayout === 'scroll' && (
        <PdfScrollContent
          onPageChange={handlePdfPageChange}
          annotationMode={pdfAnnotationMode}
          annotations={pdfAnnotations}
          flashAnnotationId={pdfFlashAnnotationId}
          onAnnotationCreate={onPdfAnnotationCreate}
          onTextSelected={onPdfTextSelected}
          onTextLayerRendered={onPdfTextLayerRendered}
        />
      )}

      {!loading && rendererReady && renderer && isFixedPage(renderer) && pdfLayout === 'paged' && (
        <PagedHostBranch
          renderer={renderer}
          layout={pagedLayout}
          initialPage={lastPdfPageRef.current ?? restorePage}
          onPageChange={handlePdfPageChange}
          onRegisterGotoPage={registerGotoPage}
          annotationMode={pdfAnnotationMode}
          annotations={pdfAnnotations}
          onAnnotationCreate={onPdfAnnotationCreate}
          onTextSelected={onPdfTextSelected}
          onTextLayerRendered={onPdfTextLayerRendered}
        />
      )}

      {!loading && rendererReady && renderer && isReflowable(renderer) && (
        <ReflowableContent
          renderer={renderer}
          onProgressChange={onEpubProgressChange}
        />
      )}

      {!loading && rendererReady && renderer && !isFixedPage(renderer) && !isReflowable(renderer) && (
        <div className="krig-ebook-empty">
          <div className="krig-ebook-empty-icon">📕</div>
          <div className="krig-ebook-empty-text">
            DjVu / CBZ 渲染留作未来(C3+)
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * paged 路径分支 — FullscreenPageView 持 ref 的小组件,把 ref.goToPage 注册到
 * Host 的 gotoPageRef,让 host.goToPage()(toolbar 跳页 / TOC / thought source 跳转)
 * 在两种模式下都能 work。
 */
function PagedHostBranch({
  renderer,
  layout,
  initialPage,
  onPageChange,
  onRegisterGotoPage,
  annotationMode,
  annotations,
  onAnnotationCreate,
  onTextSelected,
  onTextLayerRendered,
}: {
  renderer: IFixedPageRenderer;
  layout: FullscreenPagedLayout;
  initialPage: number | null;
  onPageChange: (page: number) => void;
  onRegisterGotoPage: (fn: (page: number) => void) => void;
  annotationMode?: 'off' | 'rect';
  annotations?: import('./annotation-layer').PageAnnotation[];
  onAnnotationCreate?: (
    pageNum: number,
    annotation: import('./annotation-layer').AnnotationDraft,
  ) => void;
  onTextSelected?: (
    ev: import('./hooks/use-pdf-text-selection').PdfTextSelectionEvent,
  ) => void;
  onTextLayerRendered?: (pageNum: number, textLayer: HTMLElement) => void;
}) {
  const viewRef = useRef<FullscreenPageViewHandle | null>(null);
  useEffect(() => {
    onRegisterGotoPage((page) => viewRef.current?.goToPage(page));
  }, [onRegisterGotoPage]);
  return (
    <FullscreenPageView
      ref={viewRef}
      renderer={renderer}
      layout={layout}
      initialPage={initialPage}
      onPageChange={onPageChange}
      annotationMode={annotationMode}
      annotations={annotations}
      onAnnotationCreate={onAnnotationCreate}
      onTextSelected={onTextSelected}
      onTextLayerRendered={onTextLayerRendered}
    />
  );
}

// ── Renderer 工厂(C2 仅 PDF;C3 加 EPUBRenderer;DjVu/CBZ 留作未来)──

function createRendererFor(fileType: EBookFileType): IBookRenderer | null {
  switch (fileType) {
    case 'pdf':
      return new PDFRenderer();
    case 'epub':
      return new EPUBRenderer();
    case 'djvu':
    case 'cbz':
      // 留作未来:console.warn 已在调用方
      return null;
    default:
      return null;
  }
}
