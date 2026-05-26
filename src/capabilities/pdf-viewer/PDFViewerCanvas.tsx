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
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import {
  AnnotationEditorType,
  AnnotationMode,
} from 'pdfjs-dist';
import { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import type {
  FitMode,
  PDFViewerCanvasHandle,
  PDFViewerCanvasProps,
} from './types';
import { createServices } from './services';
import { getProxy, resolveDestRef } from './loader';

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

export const PDFViewerCanvas = forwardRef<
  PDFViewerCanvasHandle,
  PDFViewerCanvasProps
>(function PDFViewerCanvasImpl(props, ref) {
  const {
    handle,
    initialPage,
    initialFitMode = 'page-width',
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

    // ── 事件桥接 ──
    const onPagesInit = (): void => {
      viewer.currentScaleValue = initialFitMode;
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
      services.eventBus.off('pagesinit', onPagesInit);
      services.eventBus.off('pagesloaded', onPagesLoaded);
      services.eventBus.off('pagechanging', onPageChanging);
      services.eventBus.off('scalechanging', onScaleChanging);
      services.eventBus.off('pagerendered', onPageRendered);
      services.eventBus.off('textlayerrendered', onTextLayerRendered);

      viewer.cleanup();
      viewerInstanceRef.current = null;
    };
    // initialPage / initialFitMode 只在 mount 期生效,不进 deps(变化不重建 viewer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle]);

  // ── Cmd/Ctrl+wheel 缩放(含 trackpad pinch)──
  //
  // 性能约束(实测):单次 updateScale ~12ms(1200 页 PDF)。
  // trackpad pinch ~125Hz × 12ms = 1500ms/s 同步工作 → 主线程死。
  // rAF 节流 60Hz × 12ms = 720ms/s 仍超 100%。
  // 必须用更狠的 cooldown:每次 updateScale 后等 80ms 才允许下次。
  //   12 次/秒 × 12ms = 144ms/s ≈ 14% 主线程占用,稳。
  // 每 cooldown 间隔合并所有累积 ticks 为综合 scaleFactor。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const COOLDOWN_MS = 80;
    let lastScaleTime = 0;
    let pendingTicks = 0;
    let lastOrigin: [number, number] = [0, 0];
    let pendingFlushId = 0;
    let accumulatedDelta = 0;

    let wheelCount = 0;
    const flush = (): void => {
      pendingFlushId = 0;
      if (pendingTicks === 0) return;
      const viewer = viewerInstanceRef.current;
      if (!viewer) {
        pendingTicks = 0;
        return;
      }
      const scaleFactor = WHEEL_SCALE_FACTOR ** pendingTicks;
      const ticksUsed = pendingTicks;
      pendingTicks = 0;
      const t0 = performance.now();
      lastScaleTime = t0;
      viewer.updateScale({
        drawingDelay: WHEEL_DRAWING_DELAY,
        scaleFactor,
        origin: lastOrigin,
      });
      const t1 = performance.now();
      console.log(`[diag-flush] ticks=${ticksUsed} took ${(t1 - t0).toFixed(1)}ms scale=${viewer.currentScale.toFixed(3)} wheelCountSinceStart=${wheelCount}`);
    };

    const handler = (e: WheelEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      wheelCount += 1;
      if (wheelCount % 20 === 0) console.log(`[diag-wheel] cumulative=${wheelCount} pendingTicks=${pendingTicks} pendingFlushId=${pendingFlushId} elapsedSinceLast=${(performance.now() - lastScaleTime).toFixed(0)}ms`);
      lastOrigin = [e.clientX, e.clientY];

      // 累积 tick — 不每个 wheel 都触发,小 delta 累成一档
      // pinch deltaY 0.x~5,累 PIXELS_PER_LINE=60 出一 tick
      // 用模块级 closure 累积(跨 wheel 事件)
      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= PIXELS_PER_LINE;
      else if (e.deltaMode === 2) delta *= PIXELS_PER_LINE * 10;

      accumulatedDelta += delta;
      while (Math.abs(accumulatedDelta) >= PIXELS_PER_LINE) {
        const direction = accumulatedDelta < 0 ? 1 : -1;
        accumulatedDelta -= direction * PIXELS_PER_LINE;
        pendingTicks += direction;
      }

      if (pendingTicks === 0) return;

      const now = performance.now();
      const elapsed = now - lastScaleTime;
      if (elapsed >= COOLDOWN_MS) {
        // cooldown 过了,立即 flush
        if (pendingFlushId !== 0) {
          clearTimeout(pendingFlushId);
          pendingFlushId = 0;
        }
        flush();
      } else if (pendingFlushId === 0) {
        // cooldown 内,排队到下一个 cooldown 边界
        pendingFlushId = window.setTimeout(flush, COOLDOWN_MS - elapsed);
      }
    };

    container.addEventListener('wheel', handler, { passive: false });
    return () => {
      container.removeEventListener('wheel', handler);
      if (pendingFlushId !== 0) clearTimeout(pendingFlushId);
    };
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
      } else if (e.key === '-') {
        e.preventDefault();
        viewer.updateScale({ drawingDelay: -1, scaleFactor: 1 / KEYBOARD_SCALE_STEP });
      } else if (e.key === '0') {
        e.preventDefault();
        viewer.currentScaleValue = 'page-width';
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── 容器尺寸变化:pdfjs PDFViewer 内部已自挂 ResizeObserver
  // (#resizeObserverCallback,更新 --viewer-container-height + containerTopLeft 缓存),
  // 我们不再额外加一层 — 双 RO 在 fit-mode 下回调内 setScaleValue 会形成嵌套
  // resize → render → resize 死循环(2026-05-25 挂死 bug 根因)。
  // 如未来发现 fit 模式跟随容器不灵,优先看 pdfjs 内部 RO 没 fire 的根因
  // (常见:容器在 display:none 树内、CSS 变量没生效),不要直接复活我们的 RO。

  // ── ref handle ──
  useImperativeHandle(
    ref,
    () => ({
      goToPage(pageNum: number): void {
        const viewer = viewerInstanceRef.current;
        if (!viewer) return;
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
      setScale(scaleFactor: number, origin?: [number, number]): void {
        const viewer = viewerInstanceRef.current;
        if (!viewer) return;
        viewer.updateScale({ drawingDelay: -1, scaleFactor, origin });
      },
      setFitMode(mode: FitMode): void {
        const viewer = viewerInstanceRef.current;
        if (!viewer) return;
        viewer.currentScaleValue = mode;
      },
      getScale(): number {
        return viewerInstanceRef.current?.currentScale ?? 1.0;
      },
    }),
    [handle],
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
