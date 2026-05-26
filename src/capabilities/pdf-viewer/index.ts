/**
 * pdf-viewer capability — 入口(L5)
 *
 * 职责:封装 pdfjs-dist 4.x 高层组件(PDFViewer / EventBus / LinkService / ...),
 * 以中性 API + React 组件单一面孔暴露给 view / 上层 capability。
 * **本 capability 子树是仓库内唯一 import pdfjs-dist 的位置**(npm 屏障)。
 *
 * 装配关系:
 * - 依赖 npm:pdfjs-dist@^4.9.155(SDK 版本绑定,5.x 与 Electron 40 不兼容)
 * - 不依赖其他 capability(独立 utility 层)
 *
 * import 副作用:
 * - `./worker-setup` 模块顶层 ensurePdfWorker() — capability 首次 import 即激活
 *   Worker(避免懒加载竞态)。
 *
 * 详见 docs/refactor/pdf-viewer-adapter-plan.md。
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import './worker-setup'; // 副作用:模块加载即初始化 pdfjs Worker
import './styles.css';   // 副作用:pdfjs 官方 pdf_viewer.css + 容器布局
import {
  loadDocument,
  destroyDocument,
  getOutline,
  getPageLabels,
  capturePageRect,
  searchText,
  hasTextContent,
} from './loader';
import { PDFViewerCanvas } from './PDFViewerCanvas';
import type { PdfViewerApi } from './types';

// 类型 export — view 端通过 `@capabilities/pdf-viewer/types` 拿
export type {
  DocumentHandle,
  TOCItem,
  SearchResult,
  FitMode,
  LinkClickInfo,
  PDFViewerCanvasProps,
  PDFViewerCanvasHandle,
  PdfViewerApi,
} from './types';

capabilityRegistry.register({
  id: 'pdf-viewer',
  api: {
    loadDocument,
    destroyDocument,
    getOutline,
    getPageLabels,
    capturePageRect,
    searchText,
    hasTextContent,
    PDFViewerCanvas,
  } satisfies PdfViewerApi,
});
