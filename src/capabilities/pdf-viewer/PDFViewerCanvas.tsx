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
  // 方案对齐 mozilla pdf.js 社区解(larsneo gist + issue #18076):
  // **pinch 期间只动 CSS transform,松手才调 updateScale 一次**。
  //
  // 历史:多轮 cooldown / rAF / origin / 自管 scroll 全部挂死 — 因为大 PDF
  // (1200 页)单次 updateScale ~12ms,任何高频调用都会堵主线程。
  // 正确做法:pinch 期间 0 次 updateScale,松手(150ms 静止)才一次性应用。
  //
  // 视觉:pinch 期间 viewer 整体 CSS scale(瞬时,GPU 加速无成本),松手时
  // currentScale 更新,pdfjs 真重渲到目标 scale。
  useEffect(() => {
    const container = containerRef.current;
    const viewerDiv = viewerRef.current;
    if (!container || !viewerDiv) return;

    const QUIESCE_MS = 150;     // 静止判定 — 超过此 ms 无新 wheel = 手势结束
    const WHEEL_DELTA_FACTOR = 0.01; // deltaY → scale 增量比例(pinch 1 像素 = 1% scale 变化)

    let pinchScale = 1;                         // pinch 期间累积的 scale 比例(1 = 无变化)
    // pinch 起始锚点 — container 局部坐标(鼠标相对 container 左上),决定缩放中心
    let pinchAnchorContainer: { x: number; y: number } = { x: 0, y: 0 };
    let quiesceTimerId = 0;

    const commit = (): void => {
      quiesceTimerId = 0;
      const viewer = viewerInstanceRef.current;
      if (!viewer || pinchScale === 1) {
        pinchScale = 1;
        viewerDiv.style.transform = '';
        viewerDiv.style.transformOrigin = '';
        return;
      }

      const finalScaleFactor = pinchScale;
      pinchScale = 1;
      const { x: ax, y: ay } = pinchAnchorContainer;

      // 锚点处内容像素(scale 前)— 在清 transform / updateScale 前先记下
      const scrollLeftBefore = container.scrollLeft;
      const scrollTopBefore = container.scrollTop;
      const contentX = scrollLeftBefore + ax;
      const contentY = scrollTopBefore + ay;

      // 清 CSS transform — 真渲染开始
      viewerDiv.style.transform = '';
      viewerDiv.style.transformOrigin = '';

      // 不传 origin,自管 scroll(pdfjs origin 公式在嵌套容器里不准)
      viewer.updateScale({
        drawingDelay: -1,
        scaleFactor: finalScaleFactor,
      });

      // 关键:updateScale 设 --scale-factor CSS var,1212 个 .page 元素 width/height
      // 都用 round(down, var(--scale-factor) * pageW, 1px) 撑大,**reflow 异步完成**。
      // 此刻 container.scrollHeight 仍是旧值,直接设 scrollLeft/Top 会被 clamp 到旧 max。
      // 等 rAF 让浏览器完成 layout 再设 scroll。
      requestAnimationFrame(() => {
        container.scrollLeft = contentX * finalScaleFactor - ax;
        container.scrollTop = contentY * finalScaleFactor - ay;
      });
    };

    const handler = (e: WheelEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();

      // pinch 开始(quiesce timer 未跑)— 记锚点(container 局部) + 设 transformOrigin
      if (quiesceTimerId === 0) {
        const bcr = container.getBoundingClientRect();
        pinchAnchorContainer = {
          x: e.clientX - bcr.left,
          y: e.clientY - bcr.top,
        };
        // transformOrigin 必须与 commit 时的锚点一致(viewerDiv 局部坐标 = container 局部 + scroll)
        const viewerOriginX = pinchAnchorContainer.x + container.scrollLeft;
        const viewerOriginY = pinchAnchorContainer.y + container.scrollTop;
        viewerDiv.style.transformOrigin = `${viewerOriginX}px ${viewerOriginY}px`;
      }

      // 累积 pinch scale — deltaY 负 = 放大(pinch open),正 = 缩小
      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= 16; // line → 像素粗折
      else if (e.deltaMode === 2) delta *= 100;
      pinchScale *= 1 - delta * WHEEL_DELTA_FACTOR;
      pinchScale = Math.max(0.1, Math.min(10, pinchScale));

      // 实时 CSS transform(GPU,几乎零成本)
      viewerDiv.style.transform = `scale(${pinchScale})`;

      // 重置静止 timer
      if (quiesceTimerId !== 0) clearTimeout(quiesceTimerId);
      quiesceTimerId = window.setTimeout(commit, QUIESCE_MS);
    };

    container.addEventListener('wheel', handler, { passive: false });
    return () => {
      container.removeEventListener('wheel', handler);
      if (quiesceTimerId !== 0) {
        clearTimeout(quiesceTimerId);
        viewerDiv.style.transform = '';
        viewerDiv.style.transformOrigin = '';
      }
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
