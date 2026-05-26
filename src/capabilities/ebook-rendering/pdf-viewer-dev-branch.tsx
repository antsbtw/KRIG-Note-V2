/**
 * PDF-Viewer-Dev-Branch — Stage 2/3 dev 验收专用,Stage 4 删除
 *
 * 启用方式:DevTools Console 内:
 *   localStorage.setItem('krig.pdfViewerV2', '1'); location.reload();
 * 关闭:
 *   localStorage.removeItem('krig.pdfViewerV2'); location.reload();
 *
 * Stage 3 接入 KRIG 自定义层(由 PDFViewerCanvas 的 onPageMounted /
 * onTextLayerReady 桥接驱动):
 *   - AnnotationLayer  React portal 到 pdfjs PDFPageView.div(C5 矩形标注)
 *   - vocab-highlight  通过 onTextLayerReady 回调每页扫词
 *   - text selection   通过 usePdfTextSelection hook 监听 window mouseup
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { EBookLibraryApi } from '@capabilities/ebook-library/types';
import type {
  PdfViewerApi,
  DocumentHandle,
} from '@capabilities/pdf-viewer/types';
import {
  AnnotationLayer,
  type PageAnnotation,
  type AnnotationDraft,
} from './fixed-page-content/annotation-layer';
import {
  usePdfTextSelection,
  type PdfTextSelectionEvent,
} from './hooks/use-pdf-text-selection';

interface Props {
  /** 当前页号变化 — 转给 Host 的 onPageChange */
  onPageChange?: (page: number) => void;
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

export function isPdfViewerV2Enabled(): boolean {
  try {
    return window.localStorage.getItem('krig.pdfViewerV2') === '1';
  } catch {
    return false;
  }
}

export function PdfViewerDevBranch({
  onPageChange,
  annotationMode = 'off',
  annotations = [],
  flashAnnotationId = null,
  onAnnotationCreate,
  onTextSelected,
  onTextLayerRendered,
}: Props) {
  const [handle, setHandle] = useState<DocumentHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 每页 wrapper div 引用(pdfjs PDFPageView.div),给 AnnotationLayer 做 portal target
  const [mountedPages, setMountedPages] = useState<Map<number, HTMLElement>>(
    () => new Map(),
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

  // 加载 PDF
  useEffect(() => {
    let cancelled = false;
    let localHandle: DocumentHandle | null = null;
    const library = requireCapabilityApi<EBookLibraryApi>('ebook-library');
    const pdfViewer = requireCapabilityApi<PdfViewerApi>('pdf-viewer');

    void (async () => {
      try {
        const result = await library.getData();
        if (!result || cancelled) return;
        const bytes =
          result.data instanceof Uint8Array
            ? result.data
            : new Uint8Array(result.data as ArrayBuffer);
        const h = await pdfViewer.loadDocument(bytes);
        if (cancelled) {
          void pdfViewer.destroyDocument(h);
          return;
        }
        localHandle = h;
        setHandle(h);
      } catch (err) {
        console.error('[PdfViewerDevBranch] load failed:', err);
        if (!cancelled) setError(String(err));
      }
    })();

    return () => {
      cancelled = true;
      if (localHandle) {
        const pdfViewer = requireCapabilityApi<PdfViewerApi>('pdf-viewer');
        void pdfViewer.destroyDocument(localHandle);
      }
    };
  }, []);

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

  const handleScaleChange = useCallback((newScale: number) => {
    setScale(newScale);
  }, []);

  if (error) {
    return (
      <div className="krig-ebook-empty">
        <div>PDF-Viewer-Dev-Branch load failed</div>
        <pre style={{ fontSize: 11 }}>{error}</pre>
      </div>
    );
  }
  if (!handle) {
    return <div className="krig-ebook-loading">PDF-Viewer-Dev-Branch loading...</div>;
  }

  const pdfViewer = requireCapabilityApi<PdfViewerApi>('pdf-viewer');
  const PDFViewerCanvas = pdfViewer.PDFViewerCanvas;

  return (
    <>
      <PDFViewerCanvas
        handle={handle}
        initialFitMode="page-width"
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
      {Array.from(mountedPages.entries()).map(([pageNum, pageDiv]) => {
        const dim = pageDims.get(pageNum);
        if (!dim) return null;
        return createPortal(
          <AnnotationLayer
            pageNum={pageNum}
            scale={cssScaleFactor}
            pageWidth={dim.w}
            pageHeight={dim.h}
            mode={annotationMode}
            annotations={annotations.filter((a) => a.pageNum === pageNum)}
            flashAnnotationId={flashAnnotationId}
            onAnnotationCreate={onAnnotationCreate ?? (() => {})}
          />,
          pageDiv,
          `pdf-anno-layer-${pageNum}`,
        );
      })}
    </>
  );
}
