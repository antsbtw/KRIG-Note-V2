/**
 * PDFRenderer — PDF 渲染引擎(L5-C2)
 *
 * V1 → V2 直迁:src/plugins/ebook/renderers/pdf/index.ts(298 行)。
 * **本文件是 ebook-rendering capability 内部唯一 import pdfjs-dist 的地方**(npm 屏障)。
 *
 * 实现 IFixedPageRenderer 接口,封装 pdfjs-dist 的所有操作:
 * - 加载 PDF + 预计算页尺寸
 * - 单页 Canvas 渲染(渲染队列去重 + 缓存 + cancel)
 * - Text Layer 渲染(选择 + Cmd+C 复制)
 * - 全文搜索(getTextContent + indexOf)
 * - PDF Outline → TOCItem(C3 起 OutlinePanel 消费)
 *
 * pdfjs-dist 版本锁:^4.9.155(EBookView 设计 v2 § 5 #10:5.x 与 Electron 40 不兼容)
 */

import * as pdfjsLib from 'pdfjs-dist';
import { TextLayer } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { RenderTask } from 'pdfjs-dist/types/src/display/api';
import type {
  IFixedPageRenderer,
  BookPosition,
  PageDimension,
  ToolbarConfig,
  TOCItem,
} from '../types';

// ── pdf.js worker 配置 ──
// V1 同款,Vite 静态导入 worker URL(import.meta.url 路径运行时解析)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export class PDFRenderer implements IFixedPageRenderer {
  readonly fileType = 'pdf' as const;
  readonly renderMode = 'fixed-page' as const;

  private doc: PDFDocumentProxy | null = null;
  private pageCache = new Map<number, PDFPageProxy>();
  private pageDims: PageDimension[] = [];
  private scale = 1.0;

  // 渲染队列
  private rendering = false;
  private queue: Array<{
    pageNum: number;
    canvas: HTMLCanvasElement;
    scale: number;
    resolve: () => void;
  }> = [];
  private rendered = new Map<number, { scale: number; canvas: HTMLCanvasElement }>();
  private activeTask: RenderTask | null = null;

  // Text Layer 状态
  private textLayers = new Map<number, TextLayer>();
  private textLayerRendered = new Map<
    number,
    { scale: number; container: HTMLElement }
  >();

  async load(data: ArrayBuffer): Promise<void> {
    this.destroy();
    // IPC 传输后 data 可能是 Buffer-like 对象,确保转为 Uint8Array
    const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.doc = await pdfjsLib.getDocument({ data: uint8 }).promise;

    // 预计算所有页面尺寸
    this.pageDims = [];
    for (let i = 1; i <= this.doc.numPages; i++) {
      const page = await this.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      this.pageDims.push({ width: viewport.width, height: viewport.height });
    }
  }

  destroy(): void {
    this.invalidateAll();
    // 清理 text layers
    for (const tl of this.textLayers.values()) {
      try {
        tl.cancel();
      } catch {
        // ignore
      }
    }
    this.textLayers.clear();
    this.textLayerRendered.clear();
    this.pageCache.clear();
    this.pageDims = [];
    if (this.doc) {
      this.doc.destroy();
      this.doc = null;
    }
  }

  getToolbarConfig(): ToolbarConfig {
    return {
      navigation: 'page',
      zoom: 'scale',
      totalPages: this.doc?.numPages ?? null,
    };
  }

  getPageDimensions(): PageDimension[] {
    return this.pageDims;
  }

  getTotalPages(): number {
    return this.doc?.numPages ?? 0;
  }

  async getTOC(): Promise<TOCItem[]> {
    if (!this.doc) return [];
    try {
      const outline = await this.doc.getOutline();
      if (!outline) return [];
      return this.convertOutline(outline);
    } catch {
      return [];
    }
  }

  private async convertOutline(items: any[]): Promise<TOCItem[]> {
    const result: TOCItem[] = [];
    for (const item of items) {
      const page = await this.resolveDestPage(item.dest);
      result.push({
        label: item.title || '',
        position: { type: 'page' as const, page: page ?? 1 },
        children: item.items?.length ? await this.convertOutline(item.items) : undefined,
      });
    }
    return result;
  }

  private async resolveDestPage(dest: any): Promise<number | null> {
    if (!this.doc || !dest) return null;
    try {
      let explicitDest = dest;
      if (typeof dest === 'string') {
        explicitDest = await this.doc.getDestination(dest);
      }
      if (!Array.isArray(explicitDest) || explicitDest.length === 0) return null;
      const pageIndex = await this.doc.getPageIndex(explicitDest[0]);
      return pageIndex + 1;
    } catch {
      return null;
    }
  }

  getPosition(): BookPosition {
    return { type: 'page', page: 1 };
  }

  goTo(_position: BookPosition): void {
    // 由 view 端的 scrollToPage 处理(FixedPageContent 注册 gotoPage 回调)
  }

  setScale(scale: number): void {
    this.scale = scale;
  }

  getScale(): number {
    return this.scale;
  }

  async renderPage(
    pageNum: number,
    canvas: HTMLCanvasElement,
    scale: number,
  ): Promise<void> {
    if (!this.doc) return; // 已 destroy,静默忽略
    return new Promise((resolve) => {
      // 去重
      const idx = this.queue.findIndex((t) => t.pageNum === pageNum);
      if (idx >= 0) {
        this.queue[idx].resolve();
        this.queue[idx] = { pageNum, canvas, scale, resolve };
      } else {
        this.queue.push({ pageNum, canvas, scale, resolve });
      }
      this.processQueue();
    });
  }

  invalidateAll(): void {
    this.rendered.clear();
    if (this.activeTask) {
      this.activeTask.cancel();
      this.activeTask = null;
    }
    this.queue.forEach((t) => t.resolve());
    this.queue = [];
    this.rendering = false;
  }

  async renderTextLayer(
    pageNum: number,
    container: HTMLElement,
    scale: number,
  ): Promise<void> {
    if (!this.doc) return;

    // 缓存检查:相同 scale + 同一 container 不重复渲染
    const prevTL = this.textLayerRendered.get(pageNum);
    if (prevTL && prevTL.scale === scale && prevTL.container === container) return;

    this.clearTextLayer(pageNum);

    const page = await this.getPage(pageNum);
    const textContent = await page.getTextContent();

    if (!this.doc) return; // 异步期间可能被 destroy

    const viewport = page.getViewport({ scale });
    container.innerHTML = '';
    // pdfjs 4.x TextLayer 字面用 CSS round(down, var(--scale-factor) * dim * 1px, 1px)
    // 排 width/height,内嵌 span 字号字面也走 --scale-factor。**必须**显式 setProperty,
    // 否则 var(--scale-factor) 解析为 0 → round → 0 → span 按 scale=1 排在 scale<1 容器内
    // → 视觉文字位置严重偏右下(选区错位 bug 根因,2026-05-25 全屏 paged 模式诊断到)。
    container.style.setProperty('--scale-factor', String(scale));

    const textLayer = new TextLayer({
      textContentSource: textContent,
      container,
      viewport,
    });

    await textLayer.render();
    this.textLayers.set(pageNum, textLayer);
    this.textLayerRendered.set(pageNum, { scale, container });
  }

  clearTextLayer(pageNum: number): void {
    const existing = this.textLayers.get(pageNum);
    if (existing) {
      existing.cancel();
      this.textLayers.delete(pageNum);
    }
  }

  async searchText(
    query: string,
  ): Promise<Array<{ pageNum: number; index: number; text: string }>> {
    if (!this.doc || !query) return [];
    const results: Array<{ pageNum: number; index: number; text: string }> = [];
    const lowerQuery = query.toLowerCase();

    for (let i = 1; i <= this.doc.numPages; i++) {
      const page = await this.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str || '')
        .join('');
      const lowerText = pageText.toLowerCase();

      let pos = 0;
      while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
        const start = Math.max(0, pos - 20);
        const end = Math.min(pageText.length, pos + query.length + 20);
        results.push({
          pageNum: i,
          index: pos,
          text: pageText.slice(start, end),
        });
        pos += query.length;
      }
    }
    return results;
  }

  /**
   * 截 PDF 指定页 rect 区域 → JPEG dataUrl(独立 render,2x DPR 高清)。
   *
   * 实现要点:
   * - 不复用屏上已渲染 canvas(其分辨率取决于当前 scale,可能太低)
   * - 走 PDFPageProxy.render 到离屏 OffscreenCanvas 大小 = rect * 2x(对齐 retina)
   * - JPEG 质量 0.85 — 在公式/小字清晰度与体积间折中
   * - rect 坐标基于 scale=1;render 时 viewport scale=2x,对应 rect 坐标也乘 2x 取像素
   *
   * 错误处理:页号非法 / doc 已 destroy → 抛错(view 端 try/catch 容忍)
   */
  async capturePageRect(
    pageNum: number,
    rect: { x: number; y: number; w: number; h: number },
  ): Promise<string> {
    if (!this.doc) throw new Error('PDF document not loaded');
    if (pageNum < 1 || pageNum > this.doc.numPages) {
      throw new Error(`page ${pageNum} out of range`);
    }
    const captureScale = 2; // 2x DPR 高清
    const page = await this.getPage(pageNum);
    const viewport = page.getViewport({ scale: captureScale });

    // 离屏整页 canvas — render 整页再裁剪到 rect。
    // 备选(先 render 后裁剪)优于"裁剪 viewport"(后者需要 transform 矩阵推导,
    // 且 pdfjs 对 partial render 的 transform 支持依赖版本)。
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = Math.ceil(viewport.width);
    pageCanvas.height = Math.ceil(viewport.height);
    const pageCtx = pageCanvas.getContext('2d');
    if (!pageCtx) throw new Error('failed to get 2d context');

    await page.render({ canvasContext: pageCtx, viewport }).promise;

    // 裁剪 rect(rect 是 scale=1 坐标,乘 captureScale 得像素)
    const sx = Math.max(0, Math.floor(rect.x * captureScale));
    const sy = Math.max(0, Math.floor(rect.y * captureScale));
    const sw = Math.max(1, Math.ceil(rect.w * captureScale));
    const sh = Math.max(1, Math.ceil(rect.h * captureScale));

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = sw;
    cropCanvas.height = sh;
    const cropCtx = cropCanvas.getContext('2d');
    if (!cropCtx) throw new Error('failed to get 2d context');
    // 白底,避免 PDF 透明区域 JPEG 编码后泛黑
    cropCtx.fillStyle = '#ffffff';
    cropCtx.fillRect(0, 0, sw, sh);
    cropCtx.drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

    return cropCanvas.toDataURL('image/jpeg', 0.85);
  }

  // ── Private ──

  private async getPage(pageNum: number): Promise<PDFPageProxy> {
    if (!this.doc) throw new Error('No PDF document loaded');
    const cached = this.pageCache.get(pageNum);
    if (cached) return cached;
    const page = await this.doc.getPage(pageNum);
    this.pageCache.set(pageNum, page);
    return page;
  }

  private async processQueue(): Promise<void> {
    if (this.rendering || this.queue.length === 0) return;
    this.rendering = true;

    while (this.queue.length > 0) {
      if (!this.doc) {
        // 已 destroy,清空队列
        this.queue.forEach((t) => t.resolve());
        this.queue = [];
        break;
      }
      const task = this.queue.shift();
      if (!task) break;
      const { pageNum, canvas, scale, resolve } = task;

      // 已渲染过相同 scale + 同一 canvas 则跳过
      const prev = this.rendered.get(pageNum);
      if (prev && prev.scale === scale && prev.canvas === canvas) {
        resolve();
        continue;
      }

      try {
        const page = await this.getPage(pageNum);
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: scale * dpr });
        // 像素维度 floor(canvas.width/height 必须是整数);CSS 尺寸保持浮点,
        // 与 textLayer/wrap 浮点 viewport.width 严格一致(避免 sub-pixel 累积错位)。
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${viewport.width / dpr}px`;
        canvas.style.height = `${viewport.height / dpr}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve();
          continue;
        }
        const renderTask = page.render({ canvasContext: ctx, viewport });
        this.activeTask = renderTask;

        await renderTask.promise;
        this.activeTask = null;

        this.rendered.set(pageNum, { scale, canvas });
      } catch (err: any) {
        if (err?.name !== 'RenderingCancelledException') {
          console.error(`[PDFRenderer] Failed to render page ${pageNum}:`, err);
        }
      }

      resolve();
    }

    this.rendering = false;
  }
}
