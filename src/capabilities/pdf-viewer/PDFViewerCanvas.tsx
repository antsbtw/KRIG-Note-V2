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
      // 关键:不能直接设 fit mode — pagesinit 触发时 container layout 可能还没就绪,
      // pdfjs page-width 算法用错误的 clientWidth 算出过大 scale → page 超出 container 贴左。
      // rAF 等浏览器完成 layout 再设。
      requestAnimationFrame(() => {
        viewer.currentScaleValue = initialFitMode;
      });
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
      // 缩放后 page 比 container 宽时强制水平居中。
      // pdfjs 内部 _setScaleUpdatePages 先 scrollPageIntoView(以页左上为锚)再 origin
      // 偏移微修 → page 向 container 左下角伸展,视觉"放大向左偏"。
      // 双 rAF 等 pdfjs 内部异步 scroll 完成再覆盖,避免被 pdfjs scrollPageIntoView 后写覆盖。
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (container.scrollWidth > container.clientWidth) {
            const targetScrollLeft =
              (container.scrollWidth - container.clientWidth) / 2;
            if (Math.abs(container.scrollLeft - targetScrollLeft) > 1) {
              container.scrollLeft = targetScrollLeft;
            }
          }
        });
      });
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

      // 非 pinch 且非 Cmd/Ctrl + wheel:不处理(让浏览器/容器正常滚动)
      if (!isPinchToZoom && !e.ctrlKey && !e.metaKey) return;

      e.preventDefault();
      const origin: [number, number] = [e.clientX, e.clientY];

      if (isPinchToZoom) {
        // pinch — 用 factor 累积器
        const factor = accumulateFactor(viewer.currentScale, scaleFactor);
        viewer.updateScale({
          drawingDelay: 400,
          scaleFactor: factor,
          origin,
        });
      } else {
        // Cmd+wheel(传统鼠标滚轮缩放)— 用 ticks 累积器
        let delta = e.deltaY;
        if (deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16;
        else if (deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= 100;
        const PIXELS_PER_LINE_SCALE = 30;
        const ticks = accumulateTicks(delta / PIXELS_PER_LINE_SCALE);
        if (ticks === 0) return;
        viewer.updateScale({
          drawingDelay: 400,
          // ticks 是 mouse wheel "格数",mozilla 用负号:向下滚 → 缩小
          steps: -ticks,
          origin,
        });
      }
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
