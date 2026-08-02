/**
 * PdfScrollContent — PDF 内容渲染组件(L5,scroll + paged 两模式共用)
 *
 * Host 内 PDF 分支挂此组件。职责:
 * 1. 挂 PDFViewerCanvas(pdfjs PDFViewer 真渲染;handle 由 Host loadDocument
 *    单次加载后注入 — Phase D 后 Host/内容组件不再各自 parse 一遍文档)
 * 2. KRIG 自定义层接入(由 PDFViewerCanvas 桥接驱动):
 *    - AnnotationLayer  React portal 到 pdfjs PDFPageView.div(C5 矩形标注)
 *    - vocab-highlight  通过 onTextLayerReady 回调每页扫词
 *    - text selection   通过 usePdfTextSelection hook 监听 window mouseup
 *
 * Phase D(2026-08-02):全屏 paged 模式并入本组件 — pageMode='paged' 时
 * PDFViewerCanvas 走 ScrollMode.PAGE(+双页 SpreadMode.ODD),链接/标注/选区/
 * 生词高亮与 scroll 同一套管线。旧 FullscreenPageView(命令式 PDFRenderer
 * spread 渲染)已删。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type {
  PdfViewerApi,
  DocumentHandle,
  PDFViewerCanvasHandle,
} from '@capabilities/pdf-viewer/types';
import {
  AnnotationLayer,
  type PageAnnotation,
  type AnnotationDraft,
} from './annotation-layer';
import {
  usePdfTextSelection,
  type PdfTextSelectionEvent,
} from './hooks/use-pdf-text-selection';

interface Props {
  /** 文档句柄 — Host loadDocument 后注入;生命周期(destroyDocument)由 Host 管 */
  handle: DocumentHandle;
  /** 页面组织模式:'scroll' 连续滚动(默认)/ 'paged' 全屏翻页 */
  pageMode?: 'scroll' | 'paged';
  /** paged 模式分页样式:'single' 单页 / 'double' 双页并排 */
  pagedSpread?: 'single' | 'double';
  /** 初始 scale 模式或数值(恢复上次阅读 scale 用)
   *  - 'page-width' / 'page-fit' / 'auto' / 'page-actual' fit 关键字
   *  - 数字字符串(如 '1.5')绝对 scale
   *  默认 'page-width'。
   */
  initialFitMode?: string;
  /** 初始页(1-based);未提供 = 1 */
  initialPage?: number | null;
  /** 当前页号变化 — 转给 Host 的 onPageChange */
  onPageChange?: (page: number) => void;
  /** scale 变化(view 同步 toolbar)*/
  onScaleChange?: (scale: number) => void;
  /**
   * 注册命令式 API 给 Host — toolbar 页号输入、缩放百分比、跳转都走这里。
   * Host 通过此回调拿到 PDFViewerCanvas 的命令式接口。
   */
  onRegisterApi?: (api: {
    goToPage: (page: number) => void;
    setScale: (scale: number) => void;
    setFitMode: (mode: 'page-width' | 'page-fit' | 'page-actual' | 'auto') => void;
    getScale: () => number;
  }) => void;
  /** 标注模式(C5):'off' / 'rect' */
  annotationMode?: 'off' | 'rect';
  /** 已有标注 */
  annotations?: PageAnnotation[];
  /** scroll-to-source 跳转后短暂高亮的标注 id */
  flashAnnotationId?: string | null;
  /** 创建标注 */
  onAnnotationCreate?: (pageNum: number, annotation: AnnotationDraft) => void;
  /** PR-α-3:textLayer 选区触发 — view 端弹 picker */
  onTextSelected?: (ev: PdfTextSelectionEvent) => void;
  /** textLayer 渲染完成回调(view 端用于扫描 vocab 命中词) */
  onTextLayerRendered?: (pageNum: number, textLayer: HTMLElement) => void;
}

export function PdfScrollContent({
  handle,
  pageMode = 'scroll',
  pagedSpread = 'single',
  initialFitMode = 'page-width',
  initialPage = null,
  onPageChange,
  onScaleChange,
  onRegisterApi,
  annotationMode = 'off',
  annotations = [],
  flashAnnotationId = null,
  onAnnotationCreate,
  onTextSelected,
  onTextLayerRendered,
}: Props) {
  // PDFViewerCanvas ref — 给 Host 注册的命令式 API 用
  const canvasRef = useRef<PDFViewerCanvasHandle | null>(null);
  // 每页 wrapper div 引用(pdfjs PDFPageView.div),AnnotationLayer 自管 root 挂在内
  const [mountedPages, setMountedPages] = useState<Map<number, HTMLElement>>(
    () => new Map(),
  );
  // 每页一个 React root + 挂载用的 wrapper div(我们创建,直接 append 到 pageDiv)
  // pdfjs 销毁 pageDiv 时 wrapper 跟着死,我们手动 root.unmount() 容错。
  const rootsRef = useRef<Map<number, { root: Root; wrapper: HTMLDivElement }>>(
    new Map(),
  );
  // textLayer ref Map(用于 use-pdf-text-selection hook)
  const textLayerRefsRef = useRef<Map<number, HTMLElement>>(new Map());
  // pdfjs scale(0.x ~ 几)— scale 状态。CSS scale-factor 由其 × 1.333 反推
  const [scale, setScale] = useState(1);
  // CSS scale-factor(= pdfjs scale × 96/72,PixelsPerInch.PDF_TO_CSS_UNITS)
  // — AnnotationLayer 内坐标 ×scale-factor 才与 pdfjs page div 像素对齐
  // textLayer DOM px ÷ scale-factor 才是 PDF point 单位选区坐标
  const cssScaleFactor = scale * (96 / 72);
  // 每个 .page 元素的 scale=1 自然尺寸,给 AnnotationLayer 用
  const [pageDims, setPageDims] = useState<Map<number, { w: number; h: number }>>(
    () => new Map(),
  );

  // 监听 mouseup 选区 — 用 cssScaleFactor(DOM px ↔ PDF point 转换),不是 pdfjs scale
  usePdfTextSelection(textLayerRefsRef, cssScaleFactor, onTextSelected);

  // PDFViewerCanvas 回调:页 DOM mount 完成 → 记录 div + 反推 scale=1 尺寸
  const handlePageMounted = useCallback(
    (pageNum: number, pageDiv: HTMLElement) => {
      setMountedPages((prev) => {
        if (prev.get(pageNum) === pageDiv) return prev;
        const next = new Map(prev);
        next.set(pageNum, pageDiv);
        return next;
      });
      // 反推 scale=1 尺寸 — PDFPageView.div BCR 是当前 scale 下的尺寸
      // pdfjs CSS:width = round(--scale-factor * pageW)
      // 我们要 pageW(scale=1)→ BCR.width / scale-factor。
      // 但 PDFViewerCanvas.currentScale 是 pdfjs 内的 scale 数值(已含 PDF_TO_CSS_UNITS=1.333 因子)。
      // 简化:从 pageDiv 的 style 读 --scale-factor 的逆解 — 走 BCR / scaleFactor 公式。
      // 反推 PDF point 单位的页面尺寸:BCR 已是当前 scale 后 px,÷ scale-factor 得 PDF point
      const bcr = pageDiv.getBoundingClientRect();
      const sf =
        parseFloat(
          getComputedStyle(pageDiv).getPropertyValue('--scale-factor'),
        ) || 1;
      const w = bcr.width / sf;
      const h = bcr.height / sf;
      setPageDims((prev) => {
        const exist = prev.get(pageNum);
        if (exist && Math.abs(exist.w - w) < 0.5 && Math.abs(exist.h - h) < 0.5)
          return prev;
        const next = new Map(prev);
        next.set(pageNum, { w, h });
        return next;
      });
    },
    [],
  );

  // PDFViewerCanvas 回调:textLayer 渲染完成 → 喂入 ref Map + 转发给 view
  const handleTextLayerReady = useCallback(
    (pageNum: number, textLayerDiv: HTMLElement) => {
      textLayerRefsRef.current.set(pageNum, textLayerDiv);
      onTextLayerRendered?.(pageNum, textLayerDiv);
    },
    [onTextLayerRendered],
  );

  const handleScaleChange = useCallback(
    (newScale: number) => {
      setScale(newScale);
      onScaleChange?.(newScale);
    },
    [onScaleChange],
  );

  // 注册命令式 API 给 Host(toolbar 跳页 / 缩放走此通道)
  useEffect(() => {
    if (!onRegisterApi) return;
    onRegisterApi({
      goToPage: (page) => canvasRef.current?.goToPage(page),
      setScale: (s) => canvasRef.current?.setScale(s),
      setFitMode: (mode) => canvasRef.current?.setFitMode(mode),
      getScale: () => canvasRef.current?.getScale() ?? 1.0,
    });
  }, [onRegisterApi]);

  // 命令式 React root 同步 — 不用 createPortal(unmount 时 pdfjs 已销毁 pageDiv,
  // portal removeChild 找不到 child 崩)。每页一个 root + 自管 wrapper div。
  // mountedPages / annotations / scale / 等变化时 root.render 重新渲染。
  // pageDiv 脱离 DOM(virtual scroll 出可视)时 root.unmount() 清理。
  const annotationsForRender = useMemo(
    () => ({ annotations, annotationMode, flashAnnotationId, cssScaleFactor, onAnnotationCreate }),
    [annotations, annotationMode, flashAnnotationId, cssScaleFactor, onAnnotationCreate],
  );
  useEffect(() => {
    const roots = rootsRef.current;
    // 1) 同步 mountedPages — 新页加 root + wrapper,旧页(已不在 mountedPages)卸载
    const activePageNums = new Set(mountedPages.keys());
    // 卸载已不在的 page
    for (const [pageNum, entry] of roots) {
      if (!activePageNums.has(pageNum)) {
        try {
          entry.root.unmount();
        } catch {
          /* pdfjs 已销毁,忽略 */
        }
        if (entry.wrapper.parentNode) entry.wrapper.parentNode.removeChild(entry.wrapper);
        roots.delete(pageNum);
      }
    }
    // 创建新页 root
    for (const [pageNum, pageDiv] of mountedPages) {
      if (roots.has(pageNum)) continue;
      if (!pageDiv.isConnected) continue;
      const wrapper = document.createElement('div');
      wrapper.className = 'krig-pdf-annotation-portal';
      // wrapper 默认 pointer-events:none — 让 textLayer 选区透过(✎T 模式选文字)
      // AnnotationLayer 内层按 mode 切 'auto'(✎ 框选)/'none'(默认 textLayer 透过)
      // CSS 规范:子 pointer-events:auto 可覆盖父 none
      wrapper.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
      pageDiv.appendChild(wrapper);
      const root = createRoot(wrapper);
      roots.set(pageNum, { root, wrapper });
    }
    // 2) 同步内容(render 现有 root)
    const { annotations: anns, annotationMode: mode, flashAnnotationId: flashId, cssScaleFactor: sf, onAnnotationCreate: onCreate } = annotationsForRender;
    for (const [pageNum, entry] of roots) {
      const dim = pageDims.get(pageNum);
      if (!dim) continue;
      const pageAnns = anns.filter((a) => a.pageNum === pageNum);
      entry.root.render(
        <AnnotationLayer
          pageNum={pageNum}
          scale={sf}
          pageWidth={dim.w}
          pageHeight={dim.h}
          mode={mode}
          annotations={pageAnns}
          flashAnnotationId={flashId}
          onAnnotationCreate={onCreate ?? (() => {})}
        />,
      );
    }
  }, [mountedPages, pageDims, annotationsForRender]);

  // 组件 unmount 时全清
  useEffect(() => {
    const roots = rootsRef.current;
    return () => {
      for (const entry of roots.values()) {
        try {
          entry.root.unmount();
        } catch {
          /* ignore */
        }
        if (entry.wrapper.parentNode) entry.wrapper.parentNode.removeChild(entry.wrapper);
      }
      roots.clear();
    };
  }, []);

  const pdfViewer = requireCapabilityApi<PdfViewerApi>('pdf-viewer');
  const PDFViewerCanvas = pdfViewer.PDFViewerCanvas;

  return (
    <>
      <PDFViewerCanvas
        ref={canvasRef}
        handle={handle}
        pageMode={pageMode}
        pagedSpread={pagedSpread}
        initialFitMode={initialFitMode}
        initialPage={initialPage}
        onPageChange={onPageChange}
        onScaleChange={handleScaleChange}
        onPageMounted={handlePageMounted}
        onTextLayerReady={handleTextLayerReady}
      />
      {/*
       * 每页一个 AnnotationLayer,portal 到 pdfjs PDFPageView.div。
       * pdfjs 的 PDFPageView.div 是 position:relative,我们的 AnnotationLayer
       * absolute + inset:0 铺满,与 canvas / textLayer 同层叠加。
       */}
      {/*
       * AnnotationLayer 走命令式 React root mount(见 useEffect 内 rootsRef),
       * 不用 createPortal — portal 在 pdfjs 销毁 pageDiv 时会触发 React removeChild
       * 找不到 child 崩(scroll/paged 切换 / virtual scroll 出可视场景)。
       * 自管 root 在 pageDiv unmount 时手动 root.unmount(),容错处理 isConnected。
       */}
    </>
  );
}
