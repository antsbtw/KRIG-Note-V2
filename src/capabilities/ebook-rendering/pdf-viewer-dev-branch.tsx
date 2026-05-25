/**
 * PDF-Viewer-Dev-Branch — Stage 2 dev 验收专用,Stage 4 删除
 *
 * 目的:让 Stage 2(新 pdf-viewer adapter 已就绪 + view 接入还未到 Stage 4)
 * 能手测 pinch / Cmd+缩放 / outline 跳转。
 *
 * 启用方式:DevTools Console 内:
 *   localStorage.setItem('krig.pdfViewerV2', '1'); location.reload();
 * 关闭:
 *   localStorage.removeItem('krig.pdfViewerV2'); location.reload();
 *
 * 工作流:
 * 1. mount 时调 ebook-library.getData() 拿 buffer
 * 2. 调 pdf-viewer.loadDocument(buffer) 拿 handle
 * 3. 挂 <PDFViewerCanvas handle={...} /> 显示
 * 4. unmount 时 destroyDocument
 *
 * **本组件不接 KRIG annotation / vocab-highlight / selection picker**(Stage 3 接);
 * 仅验证 PDFViewer 核心:加载 / 滚动 / 缩放 / outline。
 */

import { useEffect, useRef, useState } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { EBookLibraryApi } from '@capabilities/ebook-library/types';
import type {
  PdfViewerApi,
  DocumentHandle,
  PDFViewerCanvasHandle,
  TOCItem,
} from '@capabilities/pdf-viewer/types';

interface Props {
  /** 当前页号变化 — 转给 Host 的 onPageChange */
  onPageChange?: (page: number) => void;
}

/**
 * 模块级 flag 判断:本组件挂载点应当条件渲染,但 mount 后再读 flag 可避免
 * SSR 风险(V2 是 renderer-only,理论上没事,稳一点)。
 */
export function isPdfViewerV2Enabled(): boolean {
  try {
    return window.localStorage.getItem('krig.pdfViewerV2') === '1';
  } catch {
    return false;
  }
}

export function PdfViewerDevBranch({ onPageChange }: Props) {
  const [handle, setHandle] = useState<DocumentHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outline, setOutline] = useState<TOCItem[]>([]);
  const canvasRef = useRef<PDFViewerCanvasHandle | null>(null);

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

        const toc = await pdfViewer.getOutline(h);
        if (!cancelled) setOutline(toc);
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
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <PDFViewerCanvas
        ref={canvasRef}
        handle={handle}
        initialFitMode="page-width"
        onPageChange={onPageChange}
      />
      {outline.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 100,
            background: 'rgba(255,255,255,0.95)',
            border: '1px solid #ddd',
            borderRadius: 4,
            padding: 6,
            maxHeight: 200,
            overflow: 'auto',
            fontSize: 11,
            maxWidth: 240,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            DevBranch Outline(点击跳转)
          </div>
          {outline.map((item, i) => (
            <DevOutlineItem
              key={i}
              item={item}
              onClick={(destRef) => canvasRef.current?.goToDestination(destRef)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DevOutlineItem({
  item,
  depth = 0,
  onClick,
}: {
  item: TOCItem;
  depth?: number;
  onClick: (destRef: string) => void;
}) {
  return (
    <div style={{ marginLeft: depth * 8 }}>
      <button
        type="button"
        onClick={() => item.destRef && onClick(item.destRef)}
        style={{
          background: 'none',
          border: 'none',
          padding: '2px 0',
          cursor: 'pointer',
          color: '#06c',
          textAlign: 'left',
          fontSize: 11,
        }}
      >
        {item.label || '(no title)'}
      </button>
      {item.children?.map((c, i) => (
        <DevOutlineItem key={i} item={c} depth={depth + 1} onClick={onClick} />
      ))}
    </div>
  );
}
