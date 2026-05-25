/**
 * pdf-viewer capability — 对外中性类型(L5)
 *
 * **本 capability 内部唯一 import pdfjs-dist 的位置**:`worker-setup.ts` / `loader.ts`
 * / `services.ts` / `PDFViewerCanvas.tsx`。
 *
 * view / 上层 capability 只接触本文件定义的中性类型,不直接看到 PDFDocumentProxy /
 * PageViewport / RenderTask 等 pdfjs 内部类型。pdfjs 5.x 升级届时只改 adapter 内部,
 * 上游 0 改动。
 *
 * 详见 docs/refactor/pdf-viewer-adapter-plan.md § 3 + § 4。
 */

import type { ComponentType, Ref } from 'react';

// ── 文档句柄(opaque)──

/**
 * PDF 文档句柄 — view / 上层 capability 持有但不解构。
 *
 * 字段说明:
 * - _brand:nominal typing 保护,防止 view 自己拼一个假 handle 喂给 adapter
 * - id:adapter 内部反查 PDFDocumentProxy 的 key
 * - totalPages:view 端 toolbar 渲染用的便利字段(总页数变化时 handle 实例换)
 */
export interface DocumentHandle {
  readonly _brand: 'pdf-viewer.DocumentHandle';
  readonly id: string;
  readonly totalPages: number;
}

// ── TOC ──

/**
 * TOC 节点 — 中性,不含 pdfjs 的 dest 数组结构。
 *
 * destRef:adapter 内部反查原始 dest;view 透传给 ref.goToDestination 即可,
 * 不用关心是 named dest / explicit dest 数组的差异。
 */
export interface TOCItem {
  label: string;
  destRef: string;
  children?: TOCItem[];
}

// ── 全文搜索 ──

export interface SearchResult {
  /** 1-based 页码 */
  pageNum: number;
  /** 命中位置在该页文字流的字符偏移 */
  index: number;
  /** 高亮上下文(命中 ±20 字符 + 命中本身)*/
  text: string;
}

// ── 视图适配模式 ──

/**
 * 对齐 pdfjs 的 currentScaleValue 字符串(adapter 内部 1:1 转译):
 * - 'auto'         pdfjs 决定(通常 page-width / page-fit 取较大)
 * - 'page-width'   适应容器宽度
 * - 'page-fit'     页面完整可见(高度优先)
 * - 'page-actual'  100%(不缩放)
 */
export type FitMode = 'auto' | 'page-width' | 'page-fit' | 'page-actual';

// ── 链接 ──

/**
 * PDF 内链接点击事件 — LinkService 拦截后转给 view。
 *
 * - 'internal':PDF 内跳页(LinkService 已自跳到目标页;此回调仅供 view 记日志 / 持久化)
 * - 'external':外链(LinkService 不会自打开,view 决定是否调 shell.openExternal)
 */
export interface LinkClickInfo {
  type: 'internal' | 'external';
  /** internal 时为 destRef(可传回 goToDestination);external 时为 URL */
  ref: string;
}

// ── React 组件 props / handle ──

export interface PDFViewerCanvasProps {
  /** 由 loadDocument 返回的句柄 — adapter 内部反查 PDFDocumentProxy 喂给 PDFViewer */
  handle: DocumentHandle;

  /** 初始页(1-based);未提供 / 越界 → 1 */
  initialPage?: number | null;

  /** 初始 fit 模式;默认 'page-width' */
  initialFitMode?: FitMode;

  /** 当前页号变化(scrollPageIntoView / 用户滚动触发)*/
  onPageChange?: (page: number) => void;

  /** scale 变化(updateScale / fit-mode 切换 / 容器 resize 重算)*/
  onScaleChange?: (scale: number) => void;

  /**
   * 单页 textLayer 渲染完成(pdfjs eventBus 'textlayerrendered' 桥接)。
   * view 用此挂选区监听 ref / vocab-highlight 扫词。textLayerDiv 即 textLayer 的根 div。
   */
  onTextLayerReady?: (pageNum: number, textLayerDiv: HTMLElement) => void;

  /**
   * 单页 DOM mount 完成(pdfjs eventBus 'pagerendered' 桥接)。
   * pageDiv 是 PDFPageView.div(canvas + textLayer + annotation 的公共 wrapper)。
   * view 用此挂 KRIG 自定义层(annotation-layer / vocab-highlight 容器)。
   */
  onPageMounted?: (pageNum: number, pageDiv: HTMLElement) => void;

  /**
   * 单页卸载(PDFPageView destroy / virtual scroll 出可视范围)。
   * view 清对应 layer 状态。
   */
  onPageUnmounted?: (pageNum: number) => void;

  /** 链接拦截 — external 时 view 决定是否 openExternal */
  onLinkClick?: (info: LinkClickInfo) => void;
}

export interface PDFViewerCanvasHandle {
  /** 跳转到指定页(1-based)— 对齐 PDFViewer.currentPageNumber setter */
  goToPage(pageNum: number): void;

  /** 跳转到 TOC 节点(透传 destRef 给 LinkService.goToDestination)*/
  goToDestination(destRef: string): void;

  /**
   * 修改 scale — 对齐 updateScale,可锚定鼠标位置避免缩放后视点漂移。
   * origin = [clientX, clientY] viewport 坐标(pdfjs 内部转 container 局部坐标)
   */
  setScale(scaleFactor: number, origin?: [number, number]): void;

  /** 切换 fit 模式(对齐 currentScaleValue setter)*/
  setFitMode(mode: FitMode): void;

  /** 当前 scale(数值)— view 持久化 PdfProgress 用 */
  getScale(): number;
}

// ── capability 对外 API ──

export interface PdfViewerApi {
  /**
   * 加载文档 — 一个 PDFViewerCanvas 实例对应一次 loadDocument 调用。
   * 同 buffer 多次调会拿到不同 handle(不去重,view 自己控)。
   */
  loadDocument(data: ArrayBuffer | Uint8Array): Promise<DocumentHandle>;

  /** 释放文档资源(unmount / 切书 / unload 时调)*/
  destroyDocument(handle: DocumentHandle): Promise<void>;

  /** 取 TOC(无 outline 时返空数组)*/
  getOutline(handle: DocumentHandle): Promise<TOCItem[]>;

  /** 取页面 label(部分 PDF 用罗马数字 i/ii/... 给前言页;无 label 时返 null)*/
  getPageLabels(handle: DocumentHandle): Promise<string[] | null>;

  /**
   * 截 PDF 指定页 rect 区域为 JPEG dataUrl(独立 render,2x DPR 高清)。
   * rect 坐标基于 scale=1 的页面尺寸。
   */
  capturePageRect(
    handle: DocumentHandle,
    pageNum: number,
    rect: { x: number; y: number; w: number; h: number },
  ): Promise<string>;

  /**
   * 全文搜索 — 走 getTextContent 路径(不引 PDFFindController,本 PR 不动 search-bar)。
   * 大 PDF 大查询的性能问题留 future(沿用旧实现行为)。
   */
  searchText(handle: DocumentHandle, query: string): Promise<SearchResult[]>;

  /** 检测某页是否含 text content(扫描件返 false;✎ 文字标注启用前判断)*/
  hasTextContent(handle: DocumentHandle, pageNum: number): Promise<boolean>;

  /** React 组件 — view 直接挂载,通过 props/ref 命令式驱动 */
  PDFViewerCanvas: ComponentType<
    PDFViewerCanvasProps & { ref?: Ref<PDFViewerCanvasHandle> }
  >;
}
