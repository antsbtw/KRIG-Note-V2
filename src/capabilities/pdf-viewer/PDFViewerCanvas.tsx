/**
 * PDFViewerCanvas — pdf-viewer capability 的 React 组件壳(L5)
 *
 * Stage 1 占位:仅渲染 placeholder div,把 Stage 2 真实集成留给后续 commit。
 * 真实实现接 pdfjs-dist PDFViewer + EventBus + LinkService + RenderingQueue + L10n,
 * 详见 plan § 5 Stage 2。
 *
 * 暴露完整 props + handle 类型签名(对齐 PdfViewerApi),让 view / capability 上游
 * 字面零改动从 Stage 1 → Stage 2 平移。
 */

import { forwardRef, useImperativeHandle } from 'react';
import type {
  PDFViewerCanvasHandle,
  PDFViewerCanvasProps,
} from './types';

export const PDFViewerCanvas = forwardRef<
  PDFViewerCanvasHandle,
  PDFViewerCanvasProps
>(function PDFViewerCanvasStage1(_props, ref) {
  // Stage 1 — 命令全 noop;getScale 返 1.0
  useImperativeHandle(
    ref,
    () => ({
      goToPage: () => {
        /* Stage 2 实现:viewer.currentPageNumber = pageNum */
      },
      goToDestination: () => {
        /* Stage 2 实现:linkService.goToDestination(rawDest) */
      },
      setScale: () => {
        /* Stage 2 实现:viewer.updateScale({ scaleFactor, origin, drawingDelay }) */
      },
      setFitMode: () => {
        /* Stage 2 实现:viewer.currentScaleValue = mode */
      },
      getScale: () => 1.0,
    }),
    [],
  );

  return (
    <div
      className="pdf-viewer-canvas-stage1-placeholder"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--krig-text-muted, #888)',
        fontFamily: 'monospace',
        fontSize: 12,
      }}
    >
      PDFViewerCanvas — Stage 1 placeholder(Stage 2 接入 pdfjs PDFViewer)
    </div>
  );
});
