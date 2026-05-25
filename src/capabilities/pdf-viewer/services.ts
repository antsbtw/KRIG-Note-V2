/**
 * pdf-viewer capability — pdfjs 标准 services 装配(L5)
 *
 * PDFViewer 需要的协作组件:
 * - EventBus           核心事件总线(必传)
 * - PDFLinkService     处理 PDF 内链接(可选,但缺它 outline / 内链不跳)
 * - PDFRenderingQueue  渲染调度(可选,不传 PDFViewer 自创 default,这里就不传)
 * - GenericL10n        i18n(可选,不传 PDFViewer 自创 default,这里就不传)
 *
 * 此模块只工厂化必传 + 链接服务两类;Queue / L10n 走 PDFViewer 内置默认。
 */

import { EventBus, PDFLinkService } from 'pdfjs-dist/web/pdf_viewer.mjs';

export interface PdfViewerServices {
  eventBus: EventBus;
  linkService: PDFLinkService;
}

/**
 * 为单个 PDFViewerCanvas 实例创建一套 services。
 * 实例间不共享 — 每个 Canvas 持自己的 EventBus,事件回调互不污染。
 */
export function createServices(): PdfViewerServices {
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({
    eventBus,
    // 外部链接不让 LinkService 自打开 — adapter 拦截通过 onLinkClick 转 view 决策
    externalLinkTarget: 0, // LinkTarget.NONE
    ignoreDestinationZoom: true, // 内链跳转保留当前 scale,避免 outline 跳一次 scale 被改
  });
  return { eventBus, linkService };
}
