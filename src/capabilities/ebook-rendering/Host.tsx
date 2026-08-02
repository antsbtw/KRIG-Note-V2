/**
 * EBookHost — ebook-rendering capability 主组件(L5-C2)
 *
 * forwardRef + 命令式 API:view 通过 ref 调用 openBookId / goToPage / setScale 等。
 * 内部封装 pdfjs-dist(C2)+ foliate-js(C3 起);view 不直 import 任何 npm。
 *
 * 数据通路(订阅模式):
 *   ebook-library.onBookOpened(推送)→ view ref 调 loadFromInfo
 *     ↓
 *   library.getData() 拿 Uint8Array
 *     ↓
 *   PDF:pdf-viewer.loadDocument → DocumentHandle → PdfScrollContent
 *        (scroll / paged 两模式同一条 pdfjs PDFViewer 管线;Phase D 2026-08-02
 *        旧 PDFRenderer + FullscreenPageView 命令式渲染已删,元数据 API
 *        getTOC / searchText / capturePageRect / hasTextContent 走 pdf-viewer)
 *   EPUB:EPUBRenderer.load(buffer) → ReflowableContent
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
import type {
  PdfViewerApi,
  DocumentHandle,
  TOCItem as PdfTOCItem,
} from '@capabilities/pdf-viewer/types';
import {
  type IBookRenderer,
  type EBookFileType,
  type BookPosition,
  type TOCItem,
  isReflowable,
  detectFileType,
} from './types';
import { EPUBRenderer } from './epub';
import { ReflowableContent } from './reflowable-content';
import { PdfScrollContent } from './pdf-scroll-content';

/** paged 全屏的分页样式(原 FullscreenPageView 的 FullscreenPagedLayout,Phase D 迁入)*/
export type FullscreenPagedLayout = 'single' | 'double';

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
  /**
   * 2026-05-26:EPUB section(spine item)load 完成回调 —
   * 对齐 onPdfTextLayerRendered;view 端订阅做生词高亮等 iframe 内扫文字业务。
   * doc 是 iframe contentDocument,可直接 querySelectorAll 注入 span / 挂 listener。
   */
  onEpubSectionLoad?: (doc: Document, index: number) => void;

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
   * - 'paged':翻页式(全屏 navSideCollapsed=true)— Phase D 后与 scroll 同走
   *   PdfScrollContent/pdfjs 管线(ScrollMode.PAGE),仅组织模式不同
   *
   * EPUB 不受此 prop 影响 — foliate-js 自身分页,沿用 ReflowableContent。
   */
  pdfLayout?: 'scroll' | 'paged';
  /** paged 布局下的分页样式 — 'single' 单页 / 'double' 双页并排(view 按容器宽高比自适应)*/
  pagedLayout?: FullscreenPagedLayout;
}

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
    onEpubSectionLoad,
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
  const pdfViewer = useMemo(
    () => requireCapabilityApi<PdfViewerApi>('pdf-viewer'),
    [],
  );

  // EPUB renderer(PDF 不再走 renderer — Phase D 后走 pdf-viewer handle)
  const rendererRef = useRef<IBookRenderer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [rendererReady, setRendererReady] = useState(false);
  const [renderer, setRenderer] = useState<IBookRenderer | null>(null);
  // PDF 文档句柄 — Host 单点加载/销毁,PdfScrollContent 只消费
  const pdfHandleRef = useRef<DocumentHandle | null>(null);
  const [pdfHandle, setPdfHandle] = useState<DocumentHandle | null>(null);
  const [scale, setScale] = useState(1.0);
  const [fitWidth, setFitWidth] = useState(true);
  const [restorePage, setRestorePage] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // PdfScrollContent 注册的 gotoPage 回调(toolbar 跳页 / TOC / 跳源共用)
  const gotoPageRef = useRef<((page: number) => void) | null>(null);
  // PdfScrollContent 注册的完整命令式 API(toolbar 缩放百分比 / fit-width 走此通道)
  const scrollApiRef = useRef<{
    setScale: (s: number) => void;
    setFitMode: (mode: 'page-width' | 'page-fit' | 'page-actual' | 'auto') => void;
  } | null>(null);
  const registerScrollApi = useCallback(
    (api: {
      goToPage: (page: number) => void;
      setScale: (s: number) => void;
      setFitMode: (mode: 'page-width' | 'page-fit' | 'page-actual' | 'auto') => void;
      getScale: () => number;
    }) => {
      gotoPageRef.current = api.goToPage;
      scrollApiRef.current = { setScale: api.setScale, setFitMode: api.setFitMode };
    },
    [],
  );

  // 当前 PDF 页号 — Phase D 后 scroll ↔ paged 切换不再重挂组件(pdfjs 自持
  // currentPageNumber),此值只用于**同一本书重新打开 / handle 重建**时作
  // initialPage 喂回,保持页面连续。
  const lastPdfPageRef = useRef<number | null>(null);
  const handlePdfPageChange = useCallback(
    (page: number) => {
      lastPdfPageRef.current = page;
      onPageChange?.(page);
    },
    [onPageChange],
  );

  // ── 核心加载逻辑 ──

  const loadFromInfo = useCallback(
    async (info: EBookLoadedInfo) => {
      try {
        setLoading(true);
        setRendererReady(false);
        setRenderer(null);
        setPdfHandle(null);

        // 销毁旧 renderer / 旧 PDF handle
        rendererRef.current?.destroy();
        rendererRef.current = null;
        if (pdfHandleRef.current) {
          void pdfViewer.destroyDocument(pdfHandleRef.current);
          pdfHandleRef.current = null;
        }

        // 拿 buffer
        const result = await library.getData();
        if (!result) {
          setLoading(false);
          return;
        }

        const fileType = info.fileType ?? detectFileType(result.fileName);
        const pos = info.lastPosition;

        // 缩放模式:打开一律回默认整页适配(用户拍板 2026-07-06)——
        // 不再恢复上次的绝对 scale(残留 150% 会截掉一大页)。PDF 走 page-fit
        // 由 PdfScrollContent 消费;fitWidth=true 保持「适配模式(非绝对 scale)」语义,
        // scale 状态保持 1.0(仅当用户手动缩放后经 onScaleChange 更新)。
        setFitWidth(true);

        // ── PDF:pdf-viewer 单点加载(Phase D:不再有 PDFRenderer 二次 parse)──
        if (fileType === 'pdf') {
          const bytes =
            result.data instanceof Uint8Array
              ? result.data
              : new Uint8Array(result.data as ArrayBuffer);
          const handle = await pdfViewer.loadDocument(bytes);
          pdfHandleRef.current = handle;
          setPdfHandle(handle);

          // 不消费 pos.scale:初始渲染统一 page-fit,避免首屏被截。
          onLoadComplete?.({
            totalPages: handle.totalPages,
            fileType,
            renderMode: 'fixed-page',
          });

          setRestorePage(pos?.page && pos.page > 1 ? pos.page : null);
          setRendererReady(true);
          setLoading(false);
          onReadyChange?.(true);
          return;
        }

        // ── EPUB(reflowable)──
        const r = createRendererFor(fileType);
        if (!r) {
          console.warn(`[ebook-rendering] renderer for ${fileType} not yet implemented`);
          setLoading(false);
          return;
        }

        // result.data 在 IPC 序列化后是 Uint8Array;renderer.load 接 ArrayBuffer
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

        if (isReflowable(r)) {
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
          if (onEpubSectionLoad) r.onSectionLoad(onEpubSectionLoad);

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
      } catch (err) {
        console.error('[ebook-rendering/Host] Failed to load:', err);
        setLoading(false);
      }
    },
    [
      library,
      pdfViewer,
      onLoadComplete,
      onReadyChange,
      onEpubTextSelected,
      onEpubSelectionDismiss,
      onEpubAnnotationClick,
      onEpubContextMenu,
      onEpubAnnotationDoubleClick,
      onEpubSectionLoad,
    ],
  );

  // **订阅模式**:Host 不订阅 onBookOpened — 由 view 端订阅,通过 ref 命令式
  // 调 hostRef.current.loadFromInfo(info)。这样数据流单向 view → Host,
  // 避免 Host 和 view 双订阅导致的重复加载。
  //
  // 重启恢复:view 端通过 activeBookId 主动调 library.open(),触发 main 推
  // EBOOK_LOADED → view 收到 → ref 调 loadFromInfo。本 Host 不在 mount 时
  // 自动 open,完全由 view 协调。

  // 销毁时清 renderer + PDF handle
  useEffect(() => {
    return () => {
      rendererRef.current?.destroy();
      rendererRef.current = null;
      if (pdfHandleRef.current) {
        void pdfViewer.destroyDocument(pdfHandleRef.current);
        pdfHandleRef.current = null;
      }
    };
    // pdfViewer 是 memo 常量
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── view 命令式 API ──

  const handleScaleChange = useCallback(
    (newScale: number) => {
      // 这是 **onScaleChange 回调**:pdfjs 已经把 scale 变了(用户手势 / fit 重算都会发),
      // 本函数只**同步 React state + toolbar 百分比**,绝不能再调 scrollApiRef.setScale
      // 把 scale **回推 pdfjs** —— 那既是冗余回声,又会经 canvas setScale 误清 fitModeRef,
      // 导致 fit 模式在首屏重算/换屏时被清成 null、后续 resize 全部失效(2026-07-06 诊断实锤)。
      // Phase D 后 paged 也走同一条 pdfjs 管线,不再区分模式屏蔽。
      setScale(newScale);
      onScaleChange?.(newScale);
    },
    [onScaleChange],
  );

  const handleSetFitWidth = useCallback(
    (on: boolean) => {
      setFitWidth(on);
      if (on) {
        // 走 PdfScrollContent 注册的 setFitMode(pdfjs PDFViewer 内部 page-width
        // 算法 + 真渲染)。paged 模式同样有效:页占满宽、纵向边缘继续滑翻页。
        scrollApiRef.current?.setFitMode('page-width');
      }
    },
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      loadFromInfo,
      goToPage(page: number): void {
        // PDF: 走 PdfScrollContent 注册的 gotoPage 回调(scroll / paged 同一通道)
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
        if (pdfHandleRef.current) return 'fixed-page';
        return rendererRef.current?.renderMode ?? null;
      },
      getTotalPages(): number | null {
        return pdfHandleRef.current?.totalPages ?? null;
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
        const handle = pdfHandleRef.current;
        if (handle) {
          // pdf-viewer getOutline 已解析目标页号;映射为 ebook TOCItem(按页跳转)。
          // pageNum 解析失败的节点降级 page 1(沿旧 PDFRenderer.getTOC 行为)。
          const outline = await pdfViewer.getOutline(handle);
          const mapItem = (item: PdfTOCItem): TOCItem => ({
            label: item.label,
            position: { type: 'page', page: item.pageNum ?? 1 },
            children: item.children?.map(mapItem),
          });
          return outline.map(mapItem);
        }
        const r = rendererRef.current;
        if (!r) return [];
        return r.getTOC();
      },
      async searchText(query: string): Promise<SearchResult[]> {
        const handle = pdfHandleRef.current;
        if (handle) return pdfViewer.searchText(handle, query);
        const r = rendererRef.current;
        if (r && isReflowable(r)) return r.searchText(query);
        return [];
      },
      goToSearchResult(result: SearchResult): void {
        if (pdfHandleRef.current) {
          gotoPageRef.current?.(result.pageNum);
          return;
        }
        const r = rendererRef.current;
        if (r && isReflowable(r) && result.cfi) {
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
        const handle = pdfHandleRef.current;
        if (!handle) {
          throw new Error('capturePageRect requires a loaded PDF document');
        }
        return pdfViewer.capturePageRect(handle, pageNum, rect);
      },
      async hasTextContent(pageNum: number): Promise<boolean> {
        const handle = pdfHandleRef.current;
        if (!handle) return false; // EPUB / 未加载 → false
        return pdfViewer.hasTextContent(handle, pageNum);
      },
    }),
    [loadFromInfo, handleScaleChange, handleSetFitWidth, pdfViewer],
  );

  // ── 渲染 ──

  // 注:Host 不处理"未选择书"空状态 — view 端在 activeBookId == null 时
  // 就 early return,不挂 Host;Host 进 mount 时一定有 activeBookId,只
  // 区分 loading / ready / 不支持的 renderMode。

  return (
    <div className="krig-ebook-host" ref={containerRef}>
      {loading && <div className="krig-ebook-loading">Loading...</div>}

      {/*
       * PDF 分支 — pdfjs PDFViewer adapter(2026-05-25 全量重构;Phase D 2026-08-02
       * 全屏 paged 并入同一组件)。scroll / paged 由 pageMode 切换,组件不重挂:
       * pdfjs 自己保持 currentPageNumber,进/出全屏页面天然连续。
       * 链接跳转(TOC 内链)在两种模式下都由 PDFLinkService 原生处理。
       */}
      {!loading && rendererReady && pdfHandle && (
        <PdfScrollContent
          key={pdfHandle.id}
          handle={pdfHandle}
          pageMode={pdfLayout}
          pagedSpread={pagedLayout}
          // 打开一律用默认整页适配(用户拍板 2026-07-06):
          //   'page-fit' 让 pdfjs 按 container 宽高算,一整页刚好放进可视区、不截。
          //   **忽略上次残留的绝对 scale**(如 150% → 之前会截掉一大块);view 尺寸
          //   变化(含进/出全屏)由 PDFViewerCanvas 内 page-fit 重算逻辑自动跟随。
          //   用户之后手动缩放走命令式 API,不改这里的初始值。
          initialFitMode="page-fit"
          initialPage={lastPdfPageRef.current ?? restorePage}
          onPageChange={handlePdfPageChange}
          onScaleChange={handleScaleChange}
          onRegisterApi={registerScrollApi}
          annotationMode={pdfAnnotationMode}
          annotations={pdfAnnotations}
          flashAnnotationId={pdfFlashAnnotationId}
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

      {!loading && rendererReady && !pdfHandle && renderer && !isReflowable(renderer) && (
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

// ── Renderer 工厂(EPUB;PDF Phase D 起走 pdf-viewer handle,不再有 renderer;
//    DjVu/CBZ 留作未来)──

function createRendererFor(fileType: EBookFileType): IBookRenderer | null {
  switch (fileType) {
    case 'epub':
      return new EPUBRenderer();
    case 'pdf': // 不可达 — loadFromInfo 在此之前已走 pdf-viewer 分支
    case 'djvu':
    case 'cbz':
      // 留作未来:console.warn 已在调用方
      return null;
    default:
      return null;
  }
}
