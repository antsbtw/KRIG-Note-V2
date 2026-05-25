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
      maxCanvasPixels: -1, // 不限制(大 PDF 高清页避免 CSS 缩放模糊)
      enableHWA: true,
    });

    services.linkService.setDocument(pdfDoc);
    services.linkService.setViewer(viewer);

    viewerInstanceRef.current = viewer;

    // ── 事件桥接 ──
    const onPagesInit = (): void => {
      // initialFitMode — pdfjs currentScaleValue 'page-width' / 'page-fit' / 'auto'
      viewer.currentScaleValue = initialFitMode;
    };
    const onPagesLoaded = (): void => {
      if (initialPage && initialPage >= 1 && initialPage <= pdfDoc.numPages) {
        viewer.currentPageNumber = initialPage;
      }
    };
    const onPageChanging = (evt: { pageNumber: number }): void => {
      console.log(`[pdf-zoom][pagechanging] → page ${evt.pageNumber} scrollTop=${container.scrollTop.toFixed(0)}`);
      callbacksRef.current.onPageChange?.(evt.pageNumber);
    };
    const onScaleChanging = (evt: { scale: number }): void => {
      console.log(`[pdf-zoom][scalechanging] scale=${evt.scale.toFixed(3)} scrollTop=${container.scrollTop.toFixed(0)} pageNum=${viewer.currentPageNumber}`);
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

  // ── Cmd/Ctrl+wheel 缩放(含 trackpad pinch — macOS 派 wheel + ctrlKey=true)──
  //
  // 关键设计:**自管 scrollLeft/scrollTop 守恒**,不传 origin 给 pdfjs。
  //
  // pdfjs updateScale 内部 origin 处理路径(7568-7585)是:
  //   1. scrollPageIntoView(当前页号)   ← 用 _location 把"当前页"重定位到顶
  //   2. scrollLeft/Top += (origin - containerTopLeft) * scaleDiff
  //
  // 第一步会**覆盖**当前 scroll 位置,第二步只是相对小修。在嵌套容器(NavSide /
  // WorkspaceBar 之下)offsetTop 不为 0 时,origin 与 containerTopLeft 单位不匹配
  // (origin 是 viewport client,containerTopLeft 是 document offset),修正方向
  // 错乱 → "跳到页顶 + 偏一点" 的视觉,鼠标点不锚定。
  //
  // 自管守恒:
  //   1. wheel 时记 (mx, my) = 鼠标在 container BCR 局部坐标
  //   2. 记 contentX = scrollLeft + mx, contentY = scrollTop + my(scale 前像素)
  //   3. updateScale(scaleFactor) 不传 origin
  //   4. 等下一 frame,scaleDiff = newScale / oldScale 已知,新 contentX/Y = 旧 ×
  //      scaleDiff;设 scrollLeft = newContentX - mx,scrollTop 同理
  //
  // 这样**鼠标位置那个内容点像素**严格不动 — 真正的"focus zoom"。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let accumulatedDelta = 0;
    let lastWheelTime = 0;
    let gestureAnchor: { mx: number; my: number } | null = null;
    // DIAG: 每手势 wheel 计数 + 起止时间(算速度)
    let gestureWheelCount = 0;
    let gestureStartTime = 0;
    let gestureTickCount = 0;

    const handler = (e: WheelEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const viewer = viewerInstanceRef.current;
      if (!viewer) return;
      e.preventDefault();

      const now = performance.now();
      const isNewGesture = now - lastWheelTime > GESTURE_TIMEOUT_MS;
      if (isNewGesture) {
        // DIAG: 上一手势结束摘要
        if (gestureWheelCount > 0) {
          const dur = lastWheelTime - gestureStartTime;
          console.log(
            `[pdf-zoom][gesture-end] wheels=${gestureWheelCount} ticks=${gestureTickCount} duration=${dur.toFixed(0)}ms rate=${(gestureWheelCount / (dur / 1000)).toFixed(0)}wheels/s`,
          );
        }
        accumulatedDelta = 0;
        const bcr = container.getBoundingClientRect();
        gestureAnchor = {
          mx: e.clientX - bcr.left,
          my: e.clientY - bcr.top,
        };
        gestureWheelCount = 0;
        gestureTickCount = 0;
        gestureStartTime = now;
        console.log(
          `[pdf-zoom][gesture-start] anchor mx=${gestureAnchor.mx.toFixed(0)} my=${gestureAnchor.my.toFixed(0)} containerBCR top=${bcr.top.toFixed(0)} scrollTop=${container.scrollTop.toFixed(0)} scale=${viewer.currentScale.toFixed(3)}`,
        );
      }
      lastWheelTime = now;
      gestureWheelCount += 1;

      let delta = e.deltaY;
      if (e.deltaMode === 1) delta *= PIXELS_PER_LINE;
      else if (e.deltaMode === 2) delta *= PIXELS_PER_LINE * 10;

      accumulatedDelta += delta;

      while (Math.abs(accumulatedDelta) >= PIXELS_PER_LINE) {
        const direction = accumulatedDelta < 0 ? 1 : -1;
        accumulatedDelta -= direction * PIXELS_PER_LINE;
        const scaleFactor =
          direction > 0 ? WHEEL_SCALE_FACTOR : 1 / WHEEL_SCALE_FACTOR;

        if (!gestureAnchor) continue;
        gestureTickCount += 1;

        const oldScale = viewer.currentScale;
        const { mx, my } = gestureAnchor;
        const scrollBefore = { left: container.scrollLeft, top: container.scrollTop };
        const contentX = scrollBefore.left + mx;
        const contentY = scrollBefore.top + my;

        viewer.updateScale({
          drawingDelay: WHEEL_DRAWING_DELAY,
          scaleFactor,
        });

        const newScale = viewer.currentScale;
        const scrollAfterPdfjs = { left: container.scrollLeft, top: container.scrollTop };

        if (newScale !== oldScale && oldScale > 0) {
          const ratio = newScale / oldScale;
          const targetLeft = contentX * ratio - mx;
          const targetTop = contentY * ratio - my;
          container.scrollLeft = targetLeft;
          container.scrollTop = targetTop;
          const scrollAfterOurs = { left: container.scrollLeft, top: container.scrollTop };

          console.log(
            `[pdf-zoom][tick] dir=${direction > 0 ? '+' : '-'} scale ${oldScale.toFixed(3)}→${newScale.toFixed(3)} mxmy=(${mx.toFixed(0)},${my.toFixed(0)}) content=(${contentX.toFixed(0)},${contentY.toFixed(0)}) scroll: before=(${scrollBefore.left.toFixed(0)},${scrollBefore.top.toFixed(0)}) pdfjsAfter=(${scrollAfterPdfjs.left.toFixed(0)},${scrollAfterPdfjs.top.toFixed(0)}) target=(${targetLeft.toFixed(0)},${targetTop.toFixed(0)}) oursSet=(${scrollAfterOurs.left.toFixed(0)},${scrollAfterOurs.top.toFixed(0)})`,
          );

          // 下一帧再读一次 scrollTop,看是否被 pdfjs 异步逻辑覆盖
          const expectedTop = scrollAfterOurs.top;
          const expectedLeft = scrollAfterOurs.left;
          requestAnimationFrame(() => {
            const final = { left: container.scrollLeft, top: container.scrollTop };
            if (
              Math.abs(final.top - expectedTop) > 1 ||
              Math.abs(final.left - expectedLeft) > 1
            ) {
              console.warn(
                `[pdf-zoom][raf] scroll DRIFTED after our set: oursSet=(${expectedLeft.toFixed(0)},${expectedTop.toFixed(0)}) → rafFinal=(${final.left.toFixed(0)},${final.top.toFixed(0)}) drift=(${(final.left - expectedLeft).toFixed(0)},${(final.top - expectedTop).toFixed(0)})`,
              );
            }
          });
        }
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
