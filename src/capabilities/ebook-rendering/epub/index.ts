/**
 * EPUBRenderer — EPUB 渲染引擎(L5-C3)
 *
 * V1 → V2 改写:src/plugins/ebook/renderers/epub/index.ts(366 行)。
 * 砍掉(留 C4):标注相关 — onTextSelected / onSelectionDismiss / onAnnotationClick /
 * addHighlight / removeHighlight / setupSelectionListener / draw-annotation / show-annotation。
 * 保留:基础渲染 + 章节导航 + 字号 + relocate + TOC + search + clearSearch。
 *
 * **本文件是 ebook-rendering capability 内部唯一 import foliate-js 的地方**(npm 屏障)。
 *
 * 使用 foliate-js 的 View Web Component(自定义元素 `<foliate-view>`)渲染 EPUB。
 * 作为 foliate-js 的适配层,隔离 API 变更风险。
 */

import type {
  IReflowableRenderer,
  BookPosition,
  ToolbarConfig,
  TOCItem,
} from '../types';

export class EPUBRenderer implements IReflowableRenderer {
  readonly fileType = 'epub' as const;
  readonly renderMode = 'reflowable' as const;

  // foliate-js View(custom element)— 类型由 foliate-js.d.ts 提供
  private view: any = null;
  private container: HTMLElement | null = null;
  private fileData: ArrayBuffer | null = null;
  private fontSize = 100;
  private currentProgress = { chapter: '', percentage: 0 };
  private lastCFI: string | null = null;
  private lastLocationToRestore: string | null = null;
  private tocItems: TOCItem[] = [];
  private relocateCallbacks: Array<
    (progress: { chapter: string; percentage: number }) => void
  > = [];
  private readyResolve: (() => void) | null = null;
  private readyPromise: Promise<void> = new Promise((r) => {
    this.readyResolve = r;
  });

  async load(data: ArrayBuffer): Promise<void> {
    this.fileData = data;
  }

  renderTo(container: HTMLElement): void {
    this.container = container;
    void this.initView();
  }

  private async initView(): Promise<void> {
    if (!this.container || !this.fileData) return;

    try {
      const { View } = await import('foliate-js/view.js');

      if (!customElements.get('foliate-view')) {
        customElements.define('foliate-view', View);
      }

      this.view = document.createElement('foliate-view');
      this.view.style.display = 'block';
      this.view.style.width = '100%';
      this.view.style.height = '100%';
      this.container.appendChild(this.view);

      // 等待 DOM 布局完成
      await new Promise((r) => requestAnimationFrame(r));

      const file = new File([this.fileData], 'book.epub', {
        type: 'application/epub+zip',
      });

      // 打开 EPUB
      await this.view.open(file);

      // 单栏布局
      if (this.view.renderer) {
        this.view.renderer.setAttribute('max-column-count', '1');
      }

      // 显示内容(恢复上次位置或从头)
      await this.view.init({
        lastLocation: this.lastLocationToRestore ?? null,
        showTextStart: !this.lastLocationToRestore,
      });

      // 应用字号缩放
      this.applyZoom();

      // 暗色模式:注入样式到 EPUB iframe 内容(对齐 V2 整体暗色风格)
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        this.view.renderer?.setStyles?.(`
          html, body {
            background: #1e1e1e !important;
            color: #e0e0e0 !important;
          }
          a { color: #6baaff !important; }
        `);
      }

      // 监听位置变化 — chapter title + 进度比例 + 最新 CFI
      this.view.addEventListener('relocate', (e: any) => {
        const detail = e.detail;
        if (detail) {
          this.currentProgress = {
            chapter: detail.tocItem?.label ?? '',
            percentage: detail.fraction ?? 0,
          };
          if (detail.cfi) this.lastCFI = detail.cfi;
          this.relocateCallbacks.forEach((cb) => cb(this.currentProgress));
        }
      });

      // 提取 TOC
      if (this.view.book?.toc) {
        this.tocItems = this.convertTOC(this.view.book.toc);
      }

      this.readyResolve?.();
    } catch (err) {
      console.error('[EPUBRenderer] initView failed:', err);
      this.readyResolve?.(); // 即使失败也 resolve,避免永远挂起
    }
  }

  private convertTOC(items: any[]): TOCItem[] {
    if (!items) return [];
    return items.map((item) => ({
      label: item.label || item.title || '',
      position: { type: 'cfi' as const, cfi: item.href || '', display: item.label },
      children: item.subitems?.length ? this.convertTOC(item.subitems) : undefined,
    }));
  }

  destroy(): void {
    if (this.view && this.container) {
      try {
        this.container.removeChild(this.view);
      } catch {
        // ignore
      }
    }
    this.view = null;
    this.container = null;
    this.fileData = null;
    this.tocItems = [];
    this.relocateCallbacks = [];
  }

  getToolbarConfig(): ToolbarConfig {
    return {
      navigation: 'chapter',
      zoom: 'fontSize',
      totalPages: null,
    };
  }

  getPosition(): BookPosition {
    return {
      type: 'cfi',
      cfi: this.lastCFI ?? '',
      display: `${this.currentProgress.chapter} · ${Math.round(
        this.currentProgress.percentage * 100,
      )}%`,
    };
  }

  async goTo(position: BookPosition): Promise<void> {
    await this.readyPromise;
    if (!this.view) return;
    if (position.type === 'cfi' && position.cfi) {
      await this.view.goTo(position.cfi);
    }
  }

  async getTOC(): Promise<TOCItem[]> {
    await this.readyPromise;
    return this.tocItems;
  }

  // ── IReflowableRenderer 字号 / 章节 / 进度 ──

  setFontSize(size: number): void {
    this.fontSize = size;
    this.applyZoom();
  }

  private applyZoom(): void {
    if (!this.view) return;
    // CSS zoom 整体缩放(文本+图片都会放大/缩小)— V1 同款
    this.view.style.zoom = `${this.fontSize}%`;
  }

  getFontSize(): number {
    return this.fontSize;
  }

  getProgress(): { chapter: string; percentage: number } {
    return this.currentProgress;
  }

  nextChapter(): void {
    this.view?.next?.();
  }

  prevChapter(): void {
    this.view?.prev?.();
  }

  setDisplayMode(mode: 'paginated' | 'scrolled'): void {
    if (this.view?.renderer) {
      this.view.renderer.setAttribute?.(
        'flow',
        mode === 'scrolled' ? 'scrolled' : 'paginated',
      );
    }
  }

  onResize(): void {
    // foliate-js 的 View 通过 ResizeObserver 自动处理
  }

  // ── 进度保存 / 恢复 ──

  getLastCFI(): string | null {
    return this.lastCFI;
  }

  setRestoreLocation(cfi: string): void {
    this.lastLocationToRestore = cfi;
  }

  onRelocate(
    callback: (progress: { chapter: string; percentage: number }) => void,
  ): void {
    this.relocateCallbacks.push(callback);
  }

  // ── 搜索 ──

  async searchText(
    query: string,
  ): Promise<Array<{ pageNum: number; index: number; text: string }>> {
    await this.readyPromise;
    if (!this.view || !query) return [];

    const results: Array<{ pageNum: number; index: number; text: string }> = [];
    try {
      for await (const result of this.view.search({ query })) {
        if (result === 'done') break;
        if (result.subitems) {
          for (const sub of result.subitems) {
            results.push({
              pageNum: sub.index ?? 0,
              index: results.length,
              text: sub.excerpt ?? query,
            });
          }
        } else if (result.excerpt) {
          results.push({
            pageNum: result.index ?? 0,
            index: results.length,
            text: result.excerpt,
          });
        }
      }
    } catch {
      // 搜索可能被中断
    }
    return results;
  }

  clearSearch(): void {
    this.view?.clearSearch?.();
  }
}
