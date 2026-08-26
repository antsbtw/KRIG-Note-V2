/**
 * PDFViewerCanvas — pdf-viewer capability 的 React 组件实现(L5)
 *
 * Stage 2 接入 pdfjs-dist 4.x 高层组件:
 * - new PDFViewer({ container, viewer, eventBus, linkService, ... })
 * - linkService.setDocument(pdfDoc) + linkService.setViewer(viewer)
 * - viewer.setDocument(pdfDoc) → eventBus 触发 pagesinit / pagesloaded
 * - 事件桥接 pagechanging / scalechanging / pagerendered / textlayerrendered
 *   → React props 回调
 *
 * 缩放:
 * - Cmd/Ctrl+wheel → preventDefault + viewer.updateScale({ scaleFactor, origin })
 *   trackpad pinch 也会派发 wheel + ctrlKey=true(macOS 浏览器约定),自然命中
 * - Cmd+= / Cmd+- / Cmd+0 键盘走 updateScale / currentScaleValue='page-width'
 * - origin 取鼠标 viewport 坐标,pdfjs 内转 container 局部,缩放后视点不漂
 *
 * 生命周期:
 * - mount 时 createServices + new PDFViewer + setDocument
 * - unmount 时 viewer.cleanup() + eventBus.off(all) + 不调 pdfDoc.destroy(handle
 *   生命周期由调用方通过 destroyDocument 管理)
 *
 * 详见 docs/refactor/pdf-viewer-adapter-plan.md § 5 Stage 2。
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import {
  AnnotationEditorType,
  AnnotationMode,
} from 'pdfjs-dist';
import {
  PDFViewer,
  ScrollMode,
  SpreadMode,
  type EventBus,
} from 'pdfjs-dist/web/pdf_viewer.mjs';
import type {
  FitMode,
  PDFViewerCanvasHandle,
  PDFViewerCanvasProps,
} from './types';
import { createServices } from './services';
import { getProxy, resolveDestRef } from './loader';
import { createFitController, type PdfFitController } from './fit-controller';

// TextLayerMode.ENABLE = 1(不出 pdf_viewer.mjs 顶层 export,用字面量)
const TEXT_LAYER_MODE_ENABLE = 1;

// 键盘 Cmd+= / Cmd+- 单次缩放倍率
const KEYBOARD_SCALE_STEP = 1.25;

/**
 * Wheel/pinch 缩放节流参数 — 对齐 mozilla pdfjs viewer.js 的 _accumulateTicks 模式。
 *
 * trackpad pinch 在 macOS 派 wheel + ctrlKey=true,每秒 60+ 次,deltaY 小数(0.x~几)。
 * 单次 wheel 直接乘 1.1 会一秒放大 60 倍 → 抖动 + 视觉飞页。
 *
 * 改:把 wheel ticks 当作"deltaY 像素累积器",超过 PIXELS_PER_LINE 才触发一次
 * scaleFactor=1.1 的 updateScale,且 drawingDelay=400 让真渲染 postpone 到静止。
 *
 * 数值参考 mozilla pdfjs:_wheelUnit = 100(pixel/line);LINE_SCALE_FACTOR = 1.1。
 */
// pinch 累积阈值 + 单 tick 倍率 — 调参依据:
// - PIXELS_PER_LINE 60:trackpad pinch deltaY 通常 0.5~5,累积 ~15 次出 tick
// - 单 tick 1.05(5%)比 1.1(10%)柔和一倍 — 减少视觉"跳一格"感
// - 整体灵敏度 ≈ 原 1.1×(40 阈值) 的 1/2
const PIXELS_PER_LINE = 60;
const WHEEL_SCALE_FACTOR = 1.05;
const WHEEL_DRAWING_DELAY = 400;  // 真渲染 postpone(<1000 才生效,期间走 CSS transform)

// 同一 pinch 手势内多次 wheel 共用 origin — 否则手指微动鼠标位置变 → updateScale 内部
// `scrollPageIntoView + origin 偏移修正` 每 tick 锚点不同 → 视觉跳页感的真凶之一
const GESTURE_TIMEOUT_MS = 100;

/**
 * paged 模式翻页手势参数(Phase D 全屏翻页重写,承旧 FullscreenPageView 手感):
 * - 同一手势(连续 wheel 事件,gap < PAGED_GESTURE_GAP_MS)内只翻一屏
 * - 累积 |delta| 过阈值才翻,过滤 trackpad 微动
 * - GAP 只需覆盖 trackpad 惯性末尾(~150ms)
 */
const PAGED_SWIPE_THRESHOLD = 30;
const PAGED_GESTURE_GAP_MS = 150;

/**
 * paged 翻页滑动动画(承旧 FullscreenPageView 的 Books 手感):
 * - easeOutQuint 近似曲线:开头快速启动 + 末尾长尾衰减,"手推书页"物理直觉
 * - 先渲染再动画:换页瞬间用快照保持旧视觉,新页 pagerendered 后才启动滑动
 *   (完全消灭旧实现曾经的"白纸"问题,机制同 52ecc290)
 * - PAGED_RENDER_WAIT_MS:新页渲染事件兜底 — 超时也启动动画,防快照卡死盖屏
 */
const PAGED_SLIDE_MS = 1000;
const PAGED_SLIDE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const PAGED_RENDER_WAIT_MS = 800;

export const PDFViewerCanvas = forwardRef<
  PDFViewerCanvasHandle,
  PDFViewerCanvasProps
>(function PDFViewerCanvasImpl(props, ref) {
  const {
    handle,
    initialPage,
    initialFitMode = 'page-width',
    pageMode = 'scroll',
    pagedSpread = 'single',
    onPageChange,
    onScaleChange,
    onTextLayerReady,
    onPageMounted,
    onPageUnmounted,
    // onLinkClick — Stage 3 接入,本 stage 仅默认占位
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  // 持当前 PDFViewer 实例(unmount cleanup 用)
  const viewerInstanceRef = useRef<PDFViewer | null>(null);

  // ── fit 意图单一真源:所有「设 fit / 清 fit / 几何变更重算」收敛到本控制器 ──
  // (背景与坑详见 fit-controller.ts;不读 viewer.currentScaleValue,它会退化成数字)
  const fitRef = useRef<PdfFitController>(
    createFitController(() => viewerInstanceRef.current),
  );
  const fit = fitRef.current;

  // ── 页面组织模式(scroll 连续滚动 / paged 全屏翻页)──
  //
  // ref 同步:wheel / keydown 监听器只挂一次(空 deps),经 ref 读最新模式,
  // 避免重挂丢手势局部 state(memory: event-listener-must-use-ref-for-business-fn)。
  const pageModeRef = useRef(pageMode);
  const pagedSpreadRef = useRef(pagedSpread);
  useEffect(() => {
    pageModeRef.current = pageMode;
    pagedSpreadRef.current = pagedSpread;
  }, [pageMode, pagedSpread]);

  /** 把当前模式 props 应用到 viewer(mount / handle 重建 / props 变化三处共用)*/
  const applyPageMode = (viewer: PDFViewer): void => {
    const targetScroll =
      pageModeRef.current === 'paged' ? ScrollMode.PAGE : ScrollMode.VERTICAL;
    const targetSpread =
      pageModeRef.current === 'paged' && pagedSpreadRef.current === 'double'
        ? SpreadMode.ODD
        : SpreadMode.NONE;
    if (viewer.scrollMode !== targetScroll) viewer.scrollMode = targetScroll;
    if (viewer.spreadMode !== targetSpread) viewer.spreadMode = targetSpread;
  };

  // ── paged 翻页滑动动画 ──
  //
  // 机制(承旧 FullscreenPageView"先渲染再动画",适配 pdfjs 管线):
  // 翻页瞬间把当前视图快照(cloneNode + 逐 canvas drawImage 拷贝像素,textLayer/
  // 标注/生词高亮 DOM 随克隆保留视觉)挂进 wrapper:
  //   next:快照盖在真容器上(z 3)→ pdfjs 在其下换页渲染 → 就绪后快照滑出屏幕左侧
  //   prev:快照垫底(z 1)+ 真容器瞬移屏外左侧(z 2)→ 换页渲染 → 就绪后滑回原位
  // 新页就绪信号 = eventBus 'pagerendered';PAGED_RENDER_WAIT_MS 兜底防卡死。
  // 动画期间再次翻页:立即结束当前动画、本次直接跳(旧实现同策略,防堆积)。
  const eventBusRef = useRef<EventBus | null>(null);
  const flipCleanupRef = useRef<(() => void) | null>(null);

  const animatedPagedFlip = useCallback(
    (direction: 'next' | 'prev', doFlip: () => void): void => {
      const viewer = viewerInstanceRef.current;
      const container = containerRef.current;
      const viewerDiv = viewerRef.current;
      const wrapper = container?.parentElement;
      const eventBus = eventBusRef.current;
      if (
        !viewer ||
        !container ||
        !viewerDiv ||
        !wrapper ||
        !eventBus ||
        pageModeRef.current !== 'paged'
      ) {
        doFlip();
        return;
      }
      if (flipCleanupRef.current) {
        // 已有动画在跑:结束它,本次直接跳
        flipCleanupRef.current();
        doFlip();
        return;
      }
      const before = viewer.currentPageNumber;

      // 快照当前视图 — cloneNode 不带 canvas 像素,逐个 drawImage 拷贝
      const overlay = document.createElement('div');
      overlay.className = 'pdfViewerContainer krig-pdf-flip-snapshot';
      overlay.style.overflow = 'hidden';
      overlay.style.pointerEvents = 'none';
      const clone = viewerDiv.cloneNode(true) as HTMLElement;
      const origCanvases = viewerDiv.querySelectorAll('canvas');
      const cloneCanvases = clone.querySelectorAll('canvas');
      cloneCanvases.forEach((c, i) => {
        const o = origCanvases[i];
        if (!o || o.width === 0 || o.height === 0) return;
        c.width = o.width;
        c.height = o.height;
        c.getContext('2d')?.drawImage(o, 0, 0);
      });
      overlay.appendChild(clone);

      const offset = container.clientWidth + 100;
      let finished = false;
      let started = false;
      let fallbackTimer = 0;
      function onRendered(): void {
        startSlide();
      }
      function cleanup(): void {
        if (finished) return;
        finished = true;
        flipCleanupRef.current = null;
        eventBus!.off('pagerendered', onRendered);
        window.clearTimeout(fallbackTimer);
        overlay.remove();
        container!.style.transition = '';
        container!.style.transform = '';
        container!.style.zIndex = '';
        container!.style.willChange = '';
      }
      function startSlide(): void {
        if (started || finished) return;
        started = true;
        eventBus!.off('pagerendered', onRendered);
        window.clearTimeout(fallbackTimer);
        // 下一帧才加 transition,避免初始 transform 也参与过渡
        requestAnimationFrame(() => {
          if (finished) return;
          if (direction === 'next') {
            overlay.style.willChange = 'transform';
            overlay.style.transition = `transform ${PAGED_SLIDE_MS}ms ${PAGED_SLIDE_EASING}`;
            overlay.style.transform = `translateX(${-offset}px)`;
          } else {
            container!.style.transition = `transform ${PAGED_SLIDE_MS}ms ${PAGED_SLIDE_EASING}`;
            container!.style.transform = 'translateX(0px)';
          }
          window.setTimeout(cleanup, PAGED_SLIDE_MS + 30);
        });
      }
      flipCleanupRef.current = cleanup;

      if (direction === 'next') {
        // 旧页快照盖最上,真容器在其下换页
        overlay.style.zIndex = '3';
        wrapper.appendChild(overlay);
      } else {
        // 快照垫底;真容器先瞬移屏外左侧,渲染就绪后载着新页滑回
        overlay.style.zIndex = '1';
        wrapper.appendChild(overlay);
        container.style.zIndex = '2';
        container.style.willChange = 'transform';
        container.style.transform = `translateX(${-offset}px)`;
      }
      // 同步滚动位置,快照与原视图逐像素对齐(放大态翻页场景)
      overlay.scrollTop = container.scrollTop;
      overlay.scrollLeft = container.scrollLeft;

      doFlip();
      if (viewer.currentPageNumber === before) {
        cleanup(); // 已在首/末页边界,未翻动 — 撤销快照
        return;
      }

      eventBus.on('pagerendered', onRendered);
      fallbackTimer = window.setTimeout(startSlide, PAGED_RENDER_WAIT_MS);
      // 目标页已有现成像素(pdfjs buffer 缓存,来回翻页场景)时不会再发
      // pagerendered — 立即启动,免吃 800ms 兜底延迟。renderingState 3 = FINISHED。
      const targetView = viewer.getPageView(viewer.currentPageNumber - 1) as
        | { renderingState?: number }
        | undefined;
      if (targetView?.renderingState === 3) startSlide();
    },
    [],
  );

  // 把最新 callbacks 存 ref,避免 useEffect 重跑(callbacks 变化只更 ref,不触发 cleanup)
  const callbacksRef = useRef({
    onPageChange,
    onScaleChange,
    onTextLayerReady,
    onPageMounted,
    onPageUnmounted,
  });
  useEffect(() => {
    callbacksRef.current = {
      onPageChange,
      onScaleChange,
      onTextLayerReady,
      onPageMounted,
      onPageUnmounted,
    };
  }, [
    onPageChange,
    onScaleChange,
    onTextLayerReady,
    onPageMounted,
    onPageUnmounted,
  ]);

  // ── 主 effect:handle 变 → 重建 viewer ──
  useEffect(() => {
    const container = containerRef.current;
    const viewerDiv = viewerRef.current;
    if (!container || !viewerDiv) return;

    const pdfDoc = getProxy(handle);
    const services = createServices();
    const viewer = new PDFViewer({
      container,
      viewer: viewerDiv,
      eventBus: services.eventBus,
      linkService: services.linkService,
      // KRIG 不用 PDF 自带 annotation editor — 选区/标注走 KRIG 自己的层
      annotationMode: AnnotationMode.ENABLE, // 保留 link 渲染
      annotationEditorMode: AnnotationEditorType.NONE,
      textLayerMode: TEXT_LAYER_MODE_ENABLE,
      removePageBorders: false,
      // 32 MP 是 pdfjs 4.x 默认。pinch 大 scale 时 canvas 自动回退到 CSS 缩放,
      // 视觉略糊但不爆 OOM。-1(无限制)对 1000+ 页 PDF + scale 5+ 会瞬间吃几 G 内存
      // → Electron 卡死(2026-05-25 挂死根因)。
      maxCanvasPixels: 16777216, // 16 MP — 留余量,4K 屏 retina 单页仍清晰
      enableHWA: true,
    });

    services.linkService.setDocument(pdfDoc);
    services.linkService.setViewer(viewer);

    viewerInstanceRef.current = viewer;
    eventBusRef.current = services.eventBus;

    // 初始页面组织模式(scroll / paged)— setDocument 前设好,避免加载后再重排。
    // handle 重建(换书)也走这里;props 动态切换走下方独立 effect。
    applyPageMode(viewer);

    // ── 首屏渲染兜底守卫(2026-07-05)──
    //
    // 根因:pdfjs PDFViewer 的渲染是「按可视页触发」。setDocument 完成后 pdfjs
    // 只在初始 update()(pagesinit 内)+ 之后每次容器 scroll 时调 update()。而
    // update() 首行 `if (numVisiblePages === 0) return` —— 一页都不可见就直接
    // 返回、不排队渲染。可见页由 getVisibleElements 用 container.clientHeight/Width
    // 算出。初始 update() 在 pdfjs 异步取完页后同步派发,此时嵌套 slot/flex 容器
    // 高度常还没被布局器算出(clientHeight≈0)→ numVisiblePages=0 → 直接 return,
    // 且 pdfjs 自己不重试。于是「不滚动就不渲染」,直到第一次 wheel 的 scroll 事件
    // 再触发一次 update()。
    //
    // 修:容器一有非零尺寸就补调一次。rAF 先试(多数情况下一帧后布局已成);
    // 若仍为 0,挂 ResizeObserver 等第一次非零尺寸,处理后即断开。
    //
    // ⚠️ fit 关键字(page-fit / page-width / auto)必须**重设一次**再 update():
    //   page-fit = min(宽约束 scale, 高约束 scale)。onPagesInit 设 page-fit 时容器
    //   clientHeight≈0,pdfjs 拿错高度算出偏小 scale(真机现象:一屏平铺三页 58%),
    //   之后不会自己按真高重算。等真尺寸就绪后重设 currentScaleValue=同一关键字,
    //   逼 pdfjs 按正确宽高重算 → 一整页刚好占满高度(2026-07-06 用户拍板:一屏一页)。
    //   数值 scale(用户明确选的)不重设,只 update() 补渲染。
    const reapplyFitAndPaint = (): void => {
      // 首屏容器尺寸就绪:reflow 按真实宽高重算 fit;非 fit 则补一次渲染。
      if (fit.current()) {
        fit.reflow();
      } else {
        viewer.update();
      }
    };
    let firstPaintRaf: number | null = null;
    let firstPaintObserver: ResizeObserver | null = null;
    const disposeFirstPaintGuard = (): void => {
      if (firstPaintRaf !== null) {
        cancelAnimationFrame(firstPaintRaf);
        firstPaintRaf = null;
      }
      if (firstPaintObserver) {
        firstPaintObserver.disconnect();
        firstPaintObserver = null;
      }
    };
    const ensureFirstPaint = (): void => {
      if (viewerInstanceRef.current !== viewer) return; // 已被新 handle 替换/卸载
      if (container.clientHeight > 0 && container.clientWidth > 0) {
        reapplyFitAndPaint();
        disposeFirstPaintGuard();
        return;
      }
      // 尺寸仍为 0 → 等 ResizeObserver 首次非零尺寸(rAF 已用过,不再重排)
      if (!firstPaintObserver && typeof ResizeObserver !== 'undefined') {
        firstPaintObserver = new ResizeObserver(() => {
          if (viewerInstanceRef.current !== viewer) {
            disposeFirstPaintGuard();
            return;
          }
          if (container.clientHeight > 0 && container.clientWidth > 0) {
            reapplyFitAndPaint();
            disposeFirstPaintGuard();
          }
        });
        firstPaintObserver.observe(container);
      }
    };

    // ── 事件桥接 ──
    const onPagesInit = (): void => {
      // 初始 fit:setFit 内部记意图 + 应用关键字(数值串会被识别为非 fit,清意图)。
      fit.setFit(initialFitMode);
      // 初始 scale 定好后,下一帧检查容器是否已有尺寸 → 补渲染(见上方守卫说明)
      firstPaintRaf = requestAnimationFrame(ensureFirstPaint);
    };
    const onPagesLoaded = (): void => {
      if (initialPage && initialPage >= 1 && initialPage <= pdfDoc.numPages) {
        viewer.currentPageNumber = initialPage;
      }
    };
    const onPageChanging = (evt: { pageNumber: number }): void => {
      callbacksRef.current.onPageChange?.(evt.pageNumber);
    };
    const onScaleChanging = (evt: { scale: number }): void => {
      callbacksRef.current.onScaleChange?.(evt.scale);
    };
    const onPageRendered = (evt: { pageNumber: number }): void => {
      const pageView = viewer.getPageView(evt.pageNumber - 1);
      const pageDiv = pageView?.div as HTMLElement | undefined;
      if (pageDiv) {
        callbacksRef.current.onPageMounted?.(evt.pageNumber, pageDiv);
      }
    };
    const onTextLayerRendered = (evt: { pageNumber: number }): void => {
      const pageView = viewer.getPageView(evt.pageNumber - 1);
      const textLayerDiv = pageView?.textLayer?.div as HTMLElement | undefined;
      if (textLayerDiv) {
        callbacksRef.current.onTextLayerReady?.(evt.pageNumber, textLayerDiv);
      }
    };

    services.eventBus.on('pagesinit', onPagesInit);
    services.eventBus.on('pagesloaded', onPagesLoaded);
    services.eventBus.on('pagechanging', onPageChanging);
    services.eventBus.on('scalechanging', onScaleChanging);
    services.eventBus.on('pagerendered', onPageRendered);
    services.eventBus.on('textlayerrendered', onTextLayerRendered);

    viewer.setDocument(pdfDoc);

    return () => {
      disposeFirstPaintGuard();
      services.eventBus.off('pagesinit', onPagesInit);
      services.eventBus.off('pagesloaded', onPagesLoaded);
      services.eventBus.off('pagechanging', onPageChanging);
      services.eventBus.off('scalechanging', onScaleChanging);
      services.eventBus.off('pagerendered', onPageRendered);
      services.eventBus.off('textlayerrendered', onTextLayerRendered);

      flipCleanupRef.current?.(); // 撤销进行中的翻页动画快照
      viewer.cleanup();
      viewerInstanceRef.current = null;
      eventBusRef.current = null;
    };
    // initialPage / initialFitMode 只在 mount 期生效,不进 deps(变化不重建 viewer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  // ── pageMode / pagedSpread 动态切换(进/出全屏)──
  //
  // pdfjs scrollMode/spreadMode setter 内部保持 currentPageNumber(页面连续性
  // 由 pdfjs 自己保证,不再需要旧 lastPdfPageRef 式 remount 缝合)。
  // 切换后 fit 意图统一重置 page-fit:进全屏 = 一屏一整页;退全屏 = 打开时的
  // 默认整页适配(2026-07-06 拍板)。首次 mount 跳过 — 初始 fit 由 onPagesInit
  // 设 initialFitMode,不能在这里覆盖。
  const modeSwitchedOnceRef = useRef(false);
  useEffect(() => {
    const viewer = viewerInstanceRef.current;
    if (!viewer) return;
    if (!modeSwitchedOnceRef.current) {
      modeSwitchedOnceRef.current = true;
      return; // 初始模式已在主 effect applyPageMode 应用
    }
    flipCleanupRef.current?.(); // 模式切换前撤销进行中的翻页动画
    applyPageMode(viewer);
    fit.setFit('page-fit');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageMode, pagedSpread]);

  // ── Cmd/Ctrl+wheel 缩放(含 trackpad pinch)──
  //
  // **严格对齐 mozilla pdfjs viewer.js 真实源码 onWheel + _accumulateFactor**
  // (mozilla/pdf.js master/web/app.js,2026-05-25 查证)。
  //
  // pinch (ctrlKey + DOM_DELTA_PIXEL):
  //   scaleFactor = Math.exp(-deltaY/100)  ← 指数公式,deltaY 小数转近 1 的小因子
  //   factor = _accumulateFactor(currentScale, scaleFactor, '_wheelUnusedFactor')
  //   updateScale({ scaleFactor: factor, origin: [clientX, clientY], drawingDelay: 400 })
  //
  // wheel (mouse/Cmd+wheel,DOM_DELTA_LINE/PIXEL):
  //   ticks = _accumulateTicks(delta / 30, '_wheelUnusedTicks')
  //   updateScale({ steps: ticks, origin: [clientX, clientY], drawingDelay: 400 })
  //
  // 关键:**完全不自管 CSS transform** — drawingDelay=400 让 pdfjs 内部
  // PDFPageView.update 走 cssTransform 路径(GPU 缩放零成本)+ 静止后真重渲。
  // 节流不靠 rAF/cooldown,靠 _accumulateFactor 数学上把"小因子"乘到 #isSameScale
  // 早退(0.99/1.01 等小因子 Math.round(scale * factor * 100) / 100 不变 → 早退)。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 累积器(对应 mozilla _wheelUnusedFactor / _wheelUnusedTicks)
    let unusedFactor = 1;
    let unusedTicks = 0;

    // paged 翻页手势状态(承旧 FullscreenPageView:同手势只翻一屏)
    let pagedLastEventTime = 0;
    let pagedFiredInGesture = false;
    let pagedAccDelta = 0;

    /**
     * paged 模式的普通 wheel(双指滑动)→ 翻页。
     *
     * 页面放大溢出容器时优先让原生滚动平移,只在滚到边缘后继续滑才翻页
     * (page-fit 常态下容器不可滚,直接走翻页)。
     */
    const handlePagedWheel = (e: WheelEvent, viewer: PDFViewer): void => {
      // 动画期内 wheel 一律拒绝(锁手势),但不刷新 lastEventTime —
      // 惯性末尾不算"还在手势中"(承旧 FullscreenPageView 决议)
      if (flipCleanupRef.current) {
        e.preventDefault();
        pagedFiredInGesture = true;
        pagedAccDelta = 0;
        return;
      }
      const dx = e.deltaX;
      const dy = e.deltaY;
      const dominant = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
      if (Math.abs(dy) >= Math.abs(dx)) {
        const maxScrollTop = container.scrollHeight - container.clientHeight;
        if (maxScrollTop > 1) {
          const atTop = container.scrollTop <= 0;
          const atBottom = container.scrollTop >= maxScrollTop - 1;
          if ((dy > 0 && !atBottom) || (dy < 0 && !atTop)) return; // 原生滚动
        }
      } else {
        const maxScrollLeft = container.scrollWidth - container.clientWidth;
        if (maxScrollLeft > 1) {
          const atLeft = container.scrollLeft <= 0;
          const atRight = container.scrollLeft >= maxScrollLeft - 1;
          if ((dx > 0 && !atRight) || (dx < 0 && !atLeft)) return; // 原生滚动
        }
      }
      e.preventDefault();
      const now = Date.now();
      if (now - pagedLastEventTime > PAGED_GESTURE_GAP_MS) {
        pagedFiredInGesture = false;
        pagedAccDelta = 0;
      }
      pagedLastEventTime = now;
      if (pagedFiredInGesture) return;
      pagedAccDelta += dominant;
      if (Math.abs(pagedAccDelta) < PAGED_SWIPE_THRESHOLD) return;
      if (pagedAccDelta > 0) {
        animatedPagedFlip('next', () => viewer.nextPage());
      } else {
        animatedPagedFlip('prev', () => viewer.previousPage());
      }
      pagedFiredInGesture = true;
      pagedAccDelta = 0;
    };

    // mozilla _accumulateFactor 严格复刻
    const accumulateFactor = (previousScale: number, factor: number): number => {
      if (factor === 1) return 1;
      if ((unusedFactor > 1 && factor < 1) || (unusedFactor < 1 && factor > 1)) {
        unusedFactor = 1;
      }
      const newFactor =
        Math.floor(previousScale * factor * unusedFactor * 100) /
        (100 * previousScale);
      unusedFactor = factor / newFactor;
      return newFactor;
    };

    // mozilla _accumulateTicks 严格复刻
    const accumulateTicks = (ticks: number): number => {
      if ((unusedTicks > 0 && ticks < 0) || (unusedTicks < 0 && ticks > 0)) {
        unusedTicks = 0;
      }
      unusedTicks += ticks;
      const wholeTicks = Math.trunc(unusedTicks);
      unusedTicks -= wholeTicks;
      return wholeTicks;
    };

    // 鼠标点聚焦缩放 — 自己用 BCR 算,不用 pdfjs containerTopLeft。
    //
    // mozilla _centerAtPos 公式假定 containerTopLeft 与鼠标 clientX 同坐标系,
    // 在 mozilla viewer.html(container 直接挂 body)成立(offsetLeft = viewport left)。
    // KRIG 嵌套容器(NavSide 之下)offsetLeft 是相对 offsetParent,跟 viewport 不一致。
    //
    // 改用 container.getBoundingClientRect()(viewport 坐标),跟 clientX 同系统。
    const centerAtPos = (previousScale: number, x: number, y: number): void => {
      const v = viewerInstanceRef.current;
      if (!v) return;
      const scaleDiff = v.currentScale / previousScale - 1;
      if (scaleDiff === 0) return;
      const bcr = container.getBoundingClientRect();
      container.scrollLeft += (x - bcr.left) * scaleDiff;
      container.scrollTop += (y - bcr.top) * scaleDiff;
    };

    const handler = (e: WheelEvent): void => {
      const viewer = viewerInstanceRef.current;
      if (!viewer) return;

      const deltaMode = e.deltaMode;
      let scaleFactor = Math.exp(-e.deltaY / 100);

      // mozilla 的 isPinchToZoom 判定(macOS trackpad pinch → ctrlKey + DOM_DELTA_PIXEL)
      const isPinchToZoom =
        e.ctrlKey &&
        deltaMode === WheelEvent.DOM_DELTA_PIXEL &&
        e.deltaX === 0 &&
        Math.abs(scaleFactor - 1) < 0.05 &&
        e.deltaZ === 0;

      // 非 pinch 且非 Cmd/Ctrl + wheel:scroll 模式让容器正常滚动;
      // paged 模式接管为翻页手势(Phase D 全屏翻页重写)
      if (!isPinchToZoom && !e.ctrlKey && !e.metaKey) {
        if (pageModeRef.current === 'paged') handlePagedWheel(e, viewer);
        return;
      }

      e.preventDefault();
      fit.clearFit(); // wheel/pinch 手动缩放 → 退出 fit 意图
      const previousScale = viewer.currentScale;

      // **不传 origin 给 pdfjs** — pdfjs 内部 _setScaleUpdatePages 在传 origin 时同时调
      // scrollPageIntoView + origin 偏移累加,嵌套容器内双重写致偏移。
      // 自己在 updateScale 完成后调 centerAtPos 公式(等效 mozilla _centerAtPos)。
      if (isPinchToZoom) {
        const factor = accumulateFactor(viewer.currentScale, scaleFactor);
        viewer.updateScale({
          drawingDelay: 400,
          scaleFactor: factor,
        });
      } else {
        let delta = e.deltaY;
        if (deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16;
        else if (deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= 100;
        const PIXELS_PER_LINE_SCALE = 30;
        const ticks = accumulateTicks(delta / PIXELS_PER_LINE_SCALE);
        if (ticks === 0) return;
        viewer.updateScale({
          drawingDelay: 400,
          steps: -ticks,
        });
      }

      centerAtPos(previousScale, e.clientX, e.clientY);
    };

    container.addEventListener('wheel', handler, { passive: false });
    return () => container.removeEventListener('wheel', handler);
  }, []);

  // ── 键盘 Cmd+= / Cmd+- / Cmd+0 ──
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const viewer = viewerInstanceRef.current;
      if (!viewer) return;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        viewer.updateScale({ drawingDelay: -1, scaleFactor: KEYBOARD_SCALE_STEP });
        fit.clearFit(); // 手动缩放 → 退出 fit 意图
      } else if (e.key === '-') {
        e.preventDefault();
        viewer.updateScale({ drawingDelay: -1, scaleFactor: 1 / KEYBOARD_SCALE_STEP });
        fit.clearFit(); // 手动缩放 → 退出 fit 意图
      } else if (e.key === '0') {
        e.preventDefault();
        fit.setFit('page-width'); // Cmd+0 = fit-width,记住意图供几何变更重算
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── paged 模式键盘翻页(←/→ / PageUp/PageDown / Space)──
  // 承旧 FullscreenPageView 键位;scroll 模式不接管(容器原生滚动)。
  // EBookView 的 ←/→ 只在 EPUB(reflowable)分支消费,与此无冲突。
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (pageModeRef.current !== 'paged') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      const viewer = viewerInstanceRef.current;
      if (!viewer) return;
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        animatedPagedFlip('prev', () => viewer.previousPage());
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        animatedPagedFlip('next', () => viewer.nextPage());
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // animatedPagedFlip 是空 deps useCallback,恒定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 容器宽度变化 → 重 fit-width(slot 切换等)──
  //
  // 跳过首次 mount(initial trigger):不能覆盖 restore 的初始 scale。
  // 仅当 container width 真变化(从 W1 → W2)才重 fit。
  // 同样不动数值 scale(用户拍板的"容器变重新适应"原意是 fit 模式跟随,
  // 数值 scale 是用户明确选,resize 不该改)。
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    let lastWidth = container.clientWidth;
    let lastHeight = container.clientHeight;
    let initial = true;
    const observer = new ResizeObserver(() => {
      const viewer = viewerInstanceRef.current;
      if (!viewer) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (initial) {
        initial = false;
        lastWidth = w;
        lastHeight = h;
        return; // 首次 mount tick 跳过,保护 restore 的 initialFitMode 值
      }
      // 宽**或**高变化都要重 fit:page-fit 受高度约束(进/出全屏主要变高度),
      // 只盯宽度会漏掉全屏切换时的整页重算(2026-07-06 用户拍板:全屏也要刚好放下一页)。
      if (w === lastWidth && h === lastHeight) return;
      lastWidth = w;
      lastHeight = h;
      // 容器尺寸变 → reflow(fit 模式按新宽高重算;数值 scale 不动)。
      fit.reflow();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ── 拖到新屏幕 / 进出全屏 → 重 fit(2026-07-06 用户拍板)──
  //
  // ResizeObserver 只在 container 的 CSS 逻辑尺寸(clientWidth/Height)变化时触发。
  // 但**拖到另一块屏幕**(不同 DPR/分辨率)时逻辑像素可能不变 → observer 不响,
  // page-fit 不重算,页面停在旧屏算出的 scale(真机:一屏平铺三页)。**OS/浏览器
  // 全屏**切换有时也走窗口层不改 container clientHeight。故显式监听这几个几何变更
  // 事件,每次都重设 fit 关键字逼 pdfjs 按当前真实宽高重算。数值 scale 不动。
  useEffect(() => {
    const reapplyFit = (): void => {
      const viewer = viewerInstanceRef.current;
      if (!viewer) return;
      if (!fit.current()) return;
      // 下一帧执行:全屏/换屏后布局尺寸可能这一拍还没稳定,等一帧再 reflow。
      requestAnimationFrame(() => {
        if (viewerInstanceRef.current !== viewer) return;
        fit.reflow();
      });
    };

    const onResize = (): void => reapplyFit();
    const onFsChange = (): void => reapplyFit();
    window.addEventListener('resize', onResize);
    document.addEventListener('fullscreenchange', onFsChange);

    // DPR 变化 = 拖到不同缩放/分辨率的屏幕。matchMedia 阈值绑当前 dpr,
    // 一旦 dpr 越过就 fire;fire 后阈值已过期,重新绑一个新的(递归续订)。
    let dprMql: MediaQueryList | null = null;
    const onDprChange = (): void => {
      reapplyFit();
      subscribeDpr(); // 重新按新 dpr 绑阈值
    };
    const subscribeDpr = (): void => {
      if (dprMql) dprMql.removeEventListener('change', onDprChange);
      dprMql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      dprMql.addEventListener('change', onDprChange);
    };
    subscribeDpr();

    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('fullscreenchange', onFsChange);
      if (dprMql) dprMql.removeEventListener('change', onDprChange);
    };
  }, []);

  // ── ref handle ──
  useImperativeHandle(
    ref,
    () => ({
      /**
       * 按容器当前真实尺寸重新布局 + 补渲染。
       *
       * 与 onPagesInit 内的首屏守卫(ensureFirstPaint/reapplyFitAndPaint)同逻辑,
       * 但那个是**一次性**的:disposeFirstPaintGuard 用完即拆,只保第一次上屏。
       * 保活隐藏 → 重新显示是**反复发生**的,每次都需要同样的处理,故在此暴露成
       * 可反复调用的入口(fit.reflow 与 viewer.update 本身都幂等)。
       */
      relayout(): void {
        const viewer = viewerInstanceRef.current;
        if (!viewer) return;
        if (fit.current()) {
          fit.reflow(); // fit 模式:按真实宽高重算 scale(避免按 0 高算出的偏小值)
        } else {
          viewer.update(); // 用户手选的数值 scale:尊重之,只补渲染
        }
      },
      goToPage(pageNum: number): void {
        const viewer = viewerInstanceRef.current;
        if (!viewer) return;
        // paged 模式跳页(toolbar / TOC / 跳源)同样走滑动动画,方向按页序推断
        if (
          pageModeRef.current === 'paged' &&
          pageNum !== viewer.currentPageNumber
        ) {
          const direction = pageNum > viewer.currentPageNumber ? 'next' : 'prev';
          animatedPagedFlip(direction, () => {
            viewer.currentPageNumber = pageNum;
          });
          return;
        }
        viewer.currentPageNumber = pageNum;
      },
      goToDestination(destRef: string): void {
        const rawDest = resolveDestRef(handle, destRef);
        if (rawDest === undefined) return;
        // pdfjs LinkService.goToDestination 接 string(named) | array(explicit)
        const services = (
          viewerInstanceRef.current as unknown as {
            linkService?: { goToDestination: (d: string | unknown[]) => Promise<void> };
          }
        )?.linkService;
        void services?.goToDestination(rawDest as string | unknown[]);
      },
      setScale(absoluteScale: number, _origin?: [number, number]): void {
        const viewer = viewerInstanceRef.current;
        const containerEl = containerRef.current;
        if (!viewer || !containerEl) return;
        // 根因(2026-05-25 终端 log 数据驱动):
        // pdfjs _setScaleUpdatePages line 7568 在 scale 改时自动用 _location.left/top
        // 构造 XYZ dest 调 scrollPageIntoView,把上次大 scale 时的 scroll 偏移按
        // 比例缩放带到新 scale → page 偏离中线。
        // 修:setScale 前清掉 _location → pdfjs fallback 到不传 XYZ,scrollPageIntoView
        // 只滚到页顶,scrollLeft 不被强制改 → 配合 margin auto,page 居中。
        (viewer as unknown as { _location: unknown })._location = null;
        viewer.currentScaleValue = String(absoluteScale);
        fit.clearFit(); // 用户手选绝对 scale → 退出 fit 意图
      },
      setFitMode(mode: FitMode): void {
        // setFit 内部记意图 + 应用关键字(几何变更时据此重算)。
        fit.setFit(mode);
      },
      getScale(): number {
        return viewerInstanceRef.current?.currentScale ?? 1.0;
      },
    }),
    [handle, animatedPagedFlip],
  );

  return (
    // 外层 wrapper 提供 position: relative 让 .pdfViewerContainer absolute 锚定。
    // pdfjs PDFViewer 构造硬要求 container 必须 position: absolute(否则抛错)。
    <div className="pdf-viewer-canvas-wrapper">
      <div
        ref={containerRef}
        className="pdfViewerContainer"
        tabIndex={0}
      >
        <div ref={viewerRef} className="pdfViewer" />
      </div>
    </div>
  );
});
