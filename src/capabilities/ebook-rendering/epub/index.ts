/**
 * EPUBRenderer — EPUB 渲染引擎(L5-C3 + C4)
 *
 * V1 → V2 改写:src/plugins/ebook/renderers/epub/index.ts(366 行)。
 * C3 范围:基础渲染 + 章节 + 字号 + relocate + TOC + search。
 * C4 补回:onTextSelected / onSelectionDismiss / onAnnotationClick /
 *         addHighlight / removeHighlight / setupSelectionListener +
 *         show-annotation / draw-annotation foliate 事件 + getCurrentCFI。
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
  EpubTheme,
  EpubAppearance,
} from '../types';

interface ThemeColorSet {
  bg: string;
  fg: string;
  link: string;
  rule: string; // 双页中缝分隔线
}

/** 主题配色表(对齐 Apple Books Reading Styles)— 6 主题 × 2 变体(light/dark)
 *  + weight 字重(主题维度,不随明暗变);
 *  Quiet 特殊:light/dark 都用暗底灰字(设计意图是沉静低对比,不受模式影响) */
const THEME_DEFINITIONS: Record<
  EpubTheme,
  { weight: number; light: ThemeColorSet; dark: ThemeColorSet }
> = {
  original: {
    weight: 400,
    light: { bg: '#ffffff', fg: '#1a1a1a', link: '#0066cc', rule: 'rgba(0,0,0,0.12)' },
    dark:  { bg: '#1e1e1e', fg: '#e8e8eb', link: '#6baaff', rule: 'rgba(255,255,255,0.12)' },
  },
  quiet: {
    weight: 300,
    // Quiet 永远暗底灰字(Books 设计意图,light/dark 两面同配色)
    light: { bg: '#262626', fg: '#9a9a9d', link: '#6baaff', rule: 'rgba(255,255,255,0.08)' },
    dark:  { bg: '#1e1e1e', fg: '#9a9a9d', link: '#6baaff', rule: 'rgba(255,255,255,0.08)' },
  },
  paper: {
    weight: 400,
    light: { bg: '#f5efe0', fg: '#3a3128', link: '#8b5a2b', rule: 'rgba(58,49,40,0.14)' },
    dark:  { bg: '#2a2620', fg: '#e8dcc4', link: '#d4b074', rule: 'rgba(232,220,196,0.12)' },
  },
  bold: {
    weight: 700,
    light: { bg: '#ffffff', fg: '#000000', link: '#0044aa', rule: 'rgba(0,0,0,0.18)' },
    dark:  { bg: '#1e1e1e', fg: '#ffffff', link: '#7bb5ff', rule: 'rgba(255,255,255,0.20)' },
  },
  calm: {
    weight: 400,
    light: { bg: '#e8dfc8', fg: '#4a3a2a', link: '#8b5a2b', rule: 'rgba(74,58,42,0.14)' },
    dark:  { bg: '#3a342c', fg: '#e8dcc4', link: '#d4b074', rule: 'rgba(232,220,196,0.14)' },
  },
  focus: {
    weight: 400,
    light: { bg: '#f0ead5', fg: '#3a3528', link: '#6b5530', rule: 'rgba(58,53,40,0.14)' },
    dark:  { bg: '#2a2520', fg: '#d4c8a8', link: '#c4a070', rule: 'rgba(212,200,168,0.12)' },
  },
};

/** 解析 appearance — auto 走 prefers-color-scheme 实时判断 */
function resolveAppearance(appearance: EpubAppearance): 'light' | 'dark' {
  if (appearance === 'light') return 'light';
  if (appearance === 'dark') return 'dark';
  // auto:跟随系统(V2 整体 dark 时返回 dark)
  if (typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export class EPUBRenderer implements IReflowableRenderer {
  readonly fileType = 'epub' as const;
  readonly renderMode = 'reflowable' as const;

  // foliate-js View(custom element)— 类型由 foliate-js.d.ts 提供
  private view: any = null;
  private container: HTMLElement | null = null;
  private fileData: ArrayBuffer | null = null;
  private fontSize = 100;
  /** 待应用的 max-column-count (1=单页 / 2=双页) — view 未 ready 时存这,initView 后 apply */
  private pendingMaxColumnCount: 1 | 2 = 1;
  /**
   * 全屏布局对齐用 — 调用方明确指定 paginator 的 max-inline-size(px)。
   * 默认 undefined 走 paginator 内置上限(720/1000px);全屏 panel 接 view 主区
   * 单 column 宽时传该值,确保 panel 与 view 主区 column 切分一致(用户体验:
   * 单屏 page N 内容 = spread 左页内容,N+1 = 右页内容)。
   */
  private pendingMaxInlineSizePx: number | null = null;
  /** 当前主题(色调)— 6 种 Reading Style 之一;默认 Original */
  private theme: EpubTheme = 'original';
  /** 当前明暗模式 — light/dark/auto;默认 auto 跟随系统(V2 整体 dark 时 = dark)*/
  private appearance: EpubAppearance = 'auto';
  /** auto 模式 matchMedia listener — 系统外观切换时重新 apply 样式 */
  private appearanceMql: MediaQueryList | null = null;
  private appearanceMqlHandler: ((e: MediaQueryListEvent) => void) | null = null;
  private currentProgress = { chapter: '', percentage: 0, page: 0, pages: 0 };
  private lastCFI: string | null = null;
  private lastLocationToRestore: string | null = null;
  private tocItems: TOCItem[] = [];
  private relocateCallbacks: Array<
    (progress: { chapter: string; percentage: number; page: number; pages: number }) => void
  > = [];
  private readyResolve: (() => void) | null = null;
  private readyPromise: Promise<void> = new Promise((r) => {
    this.readyResolve = r;
  });

  async load(data: ArrayBuffer): Promise<void> {
    this.fileData = data;
  }

  /** 暴露原始 ArrayBuffer — 双实例翻页动画用,避免重新 IPC 拉数据 */
  getFileData(): ArrayBuffer | null {
    return this.fileData;
  }

  /** 等待 view + foliate 初始化完成(双实例场景显式等 B 就绪) */
  waitReady(): Promise<void> {
    return this.readyPromise;
  }

  /** view DOM(动画驱动需要直接挂 wrapper)— null 表示还没 initView */
  getView(): any {
    return this.view;
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

      // 应用 max-column-count + max-inline-size(view ready 前可能被
      // setMaxColumnCount 设过 pending 值)— 全屏布局对齐场景下
      // pendingMaxInlineSizePx 有显式值,确保单 column 渲染宽精确匹配 view 主区
      if (this.view.renderer) {
        const count = this.pendingMaxColumnCount;
        const inlineSize = this.pendingMaxInlineSizePx
          ?? (count === 2 ? 1000 : 720);
        this.view.renderer.setAttribute('max-column-count', String(count));
        this.view.renderer.setAttribute('max-inline-size', `${inlineSize}px`);
      }

      // 显示内容(恢复上次位置或从头)
      await this.view.init({
        lastLocation: this.lastLocationToRestore ?? null,
        showTextStart: !this.lastLocationToRestore,
      });

      // 应用字号 + 暗色样式(合并注入 — setStyles 是覆盖式,不能分两次调否则后调的会清掉前面的)
      this.applyContentStyles();

      // 监听位置变化 — chapter title + 进度比例 + 全书页码 + 最新 CFI + 底部 footer 页码
      // 关键:page/pages 用 detail.location.current/total(foliate sectionProgress 按全书
      // 字符/byte 算出的虚拟位置数,跨字号稳定) — 不用 paginator.page/pages(那是当前
      // section 内的页码,翻章后会归零)
      this.view.addEventListener('relocate', (e: any) => {
        const detail = e.detail;
        if (detail) {
          const loc = detail.location;
          // location.current 是 0-based,+1 转成 1-based;total 直接取
          const page = typeof loc?.current === 'number' ? loc.current + 1 : 0;
          const pages = typeof loc?.total === 'number' ? loc.total : 0;
          this.currentProgress = {
            chapter: detail.tocItem?.label ?? '',
            percentage: detail.fraction ?? 0,
            page,
            pages,
          };
          if (detail.cfi) this.lastCFI = detail.cfi;
          this.relocateCallbacks.forEach((cb) => cb(this.currentProgress));
        }
        this.updateFooterPageNumbers();
      });

      // ── C4:文本选择 + 已有标注点击 + 高亮自定义颜色 ──

      // 文本选择监听(标注入口)
      this.setupSelectionListener();

      // 点击已有标注 → 触发回调(用于删除)
      this.view.addEventListener('show-annotation', (e: any) => {
        const cfi = e.detail?.value;
        if (cfi && this.annotationClickCallback) {
          this.annotationClickCallback(cfi);
        }
      });

      // 高亮绘制:根据 annotation.color 自定义颜色
      this.view.addEventListener('draw-annotation', (e: any) => {
        const { draw, annotation } = e.detail;
        const color = annotation?.color || '#ffd43b';
        draw((range: any, options: any) => {
          // 优先用 foliate-js Overlayer.highlight(更准的多行高亮)
          const Overlayer = (self as any).__foliateOverlayer?.Overlayer;
          if (Overlayer) return Overlayer.highlight(range, { ...options, color });
          // fallback:简单矩形(覆盖几乎所有 foliate-js 版本)
          const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          g.setAttribute('fill', color);
          g.style.opacity = '0.3';
          for (const { left, top, height, width } of range) {
            const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            el.setAttribute('x', String(left));
            el.setAttribute('y', String(top));
            el.setAttribute('height', String(height));
            el.setAttribute('width', String(width));
            g.append(el);
          }
          return g;
        }, { color });
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
    this.detachAppearanceListener();
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

  /** 按全书页号跳转 — page/total 来自 foliate sectionProgress 的 location.current/total,
   *  按全书字符/byte 算出的虚拟位置数(跨字号稳定)。fraction 公式 (page-1)/(total-1)。*/
  async goToPage(page: number): Promise<void> {
    await this.readyPromise;
    if (!this.view?.goToFraction) return;
    const total = this.currentProgress.pages;
    if (total <= 0) return;
    const clamped = Math.max(1, Math.min(page, total));
    const fraction = total > 1 ? (clamped - 1) / (total - 1) : 0;
    await this.view.goToFraction(fraction);
  }

  async getTOC(): Promise<TOCItem[]> {
    await this.readyPromise;
    return this.tocItems;
  }

  // ── IReflowableRenderer 字号 / 章节 / 进度 ──

  setFontSize(size: number): void {
    this.fontSize = size;
    this.applyContentStyles();
  }

  setTheme(theme: EpubTheme): void {
    this.theme = theme;
    // view 未 ready 时 applyContentStyles 内 setStyles 为 noop;initView 完成后会自动 apply
    this.applyContentStyles();
  }

  setAppearance(appearance: EpubAppearance): void {
    this.appearance = appearance;
    // 重挂 matchMedia listener:auto 模式才需要监听,light/dark 不需要
    this.detachAppearanceListener();
    if (appearance === 'auto' && typeof window !== 'undefined' && window.matchMedia) {
      this.appearanceMql = window.matchMedia('(prefers-color-scheme: dark)');
      this.appearanceMqlHandler = (): void => this.applyContentStyles();
      this.appearanceMql.addEventListener('change', this.appearanceMqlHandler);
    }
    this.applyContentStyles();
  }

  private detachAppearanceListener(): void {
    if (this.appearanceMql && this.appearanceMqlHandler) {
      this.appearanceMql.removeEventListener('change', this.appearanceMqlHandler);
    }
    this.appearanceMql = null;
    this.appearanceMqlHandler = null;
  }

  /**
   * 填充 foliate-paginator 的 footer 页码(Books 风:每页底部居中显示页码)。
   *
   * foliate-paginator 提供 page/pages getter(当前页 / 总页数),feet 数组是每列
   * 一个 div(双页时 length=2,单页时 length=1)。我们直接往 div 写 textContent。
   *
   * 注:pages 在 EPUB 内是"虚拟页"(按 column 宽度切分文本),不是物理印刷页;
   * 跟随字号 / 双页切换会变。
   */
  private updateFooterPageNumbers(): void {
    const paginator = this.view?.renderer;
    if (!paginator?.feet || !Array.isArray(paginator.feet)) return;
    const currentPage = paginator.page as number | undefined;
    const totalPages = paginator.pages as number | undefined;
    if (!currentPage || !totalPages) return;
    const feet = paginator.feet as HTMLElement[];
    feet.forEach((foot, idx) => {
      const pageNum = currentPage + idx;
      if (pageNum > 0 && pageNum <= totalPages) {
        foot.textContent = String(pageNum);
      } else {
        foot.textContent = '';
      }
    });
  }

  /**
   * 注入 EPUB iframe 文档样式 — 字号 + 主题色调一起注入。
   * setStyles 是覆盖式,字号 / 主题任一变化都要重新整体注入。
   *
   * 字号语义:html { font-size: X% } 让 foliate-js 按字号重新分页(不是 zoom 拉伸)。
   * 主题:背景 + 文字 + 链接配色,白底/米黄/暗色三档,见 THEME_COLORS。
   */
  private applyContentStyles(): void {
    if (!this.view?.renderer?.setStyles) return;
    const def = THEME_DEFINITIONS[this.theme];
    const mode = resolveAppearance(this.appearance);
    const c = { ...def[mode], weight: def.weight };
    // 1) 注入到 iframe 文档内 — 文字 / 背景 / 链接 + 双页中缝细线
    // 注:column-rule 设在 html 元素(foliate-paginator 把 column-* 都挂这里),
    // 实际只在 column-count > 1 时显示;rule 颜色低透明度跟主题文字色融合
    const css = `
      html {
        font-size: ${this.fontSize}% !important;
        background: ${c.bg} !important;
        color: ${c.fg} !important;
        column-rule: 1px solid ${c.rule} !important;
      }
      body {
        background: ${c.bg} !important;
        color: ${c.fg} !important;
      }
      /* 主题字重(Bold=700 / Quiet=300 / 其他=400)— 强制覆盖 EPUB 内容默认 */
      body, body p, body div, body span, body li {
        font-weight: ${c.weight} !important;
      }
      a { color: ${c.link} !important; }
    `;
    this.view.renderer.setStyles(css);
    // 2) foliate-view 自身容器背景(spread 边缘的 padding 区也要染色,否则违和)
    if (this.view) {
      this.view.style.background = c.bg;
    }
  }

  getFontSize(): number {
    return this.fontSize;
  }

  /** 当前主题(双实例同步用) */
  getTheme(): EpubTheme {
    return this.theme;
  }

  /** 当前明暗模式(双实例同步用) */
  getAppearance(): EpubAppearance {
    return this.appearance;
  }

  /** 当前最大列数(双实例同步用) */
  getMaxColumnCount(): 1 | 2 {
    return this.pendingMaxColumnCount;
  }

  /**
   * 当前 EPUB 单 column 的实际渲染宽度(像素)。
   *
   * 用于全屏切换时让 panel 的 spread 容器宽度 = 2 × view 主区单 column 宽,
   * 这样两个 view 的 paginator 切分文字位置一致,翻页内容精确对齐
   * (避免 EPUB reflowable 跨 layout 漂移)。
   *
   * 从 foliate paginator 实时算:paginator.size = 当前容器宽,
   * paginator.columnCount = 当前列数;单 column 宽 ≈ size / columnCount。
   * view 未 ready 返 null。
   */
  getColumnWidth(): number | null {
    const r = this.view?.renderer as any;
    if (!r) return null;
    const size = r.size;
    const cc = r.columnCount;
    if (typeof size !== 'number' || size <= 0 || typeof cc !== 'number' || cc <= 0) return null;
    return size / cc;
  }

  getProgress(): { chapter: string; percentage: number; page: number; pages: number } {
    return this.currentProgress;
  }

  async nextChapter(): Promise<void> {
    await this.view?.next?.();
  }

  async prevChapter(): Promise<void> {
    await this.view?.prev?.();
  }

  setDisplayMode(mode: 'paginated' | 'scrolled'): void {
    if (this.view?.renderer) {
      this.view.renderer.setAttribute?.(
        'flow',
        mode === 'scrolled' ? 'scrolled' : 'paginated',
      );
    }
  }

  /**
   * 设置最大列数(1=单页,2=双页);foliate-js 会按容器宽度自适应实际列数。
   *
   * 实际列数 = min(max-column-count, ceil(容器宽 / max-inline-size))。
   * foliate-js 默认 max-inline-size=720px,意味着 spread 最大宽 = 1440px(双页时),
   * 超出部分留黑边 — 全屏阅读会显得文字稀疏挤在中间。
   *
   * 全屏双页时同步调大 max-inline-size 让 spread 撑满容器(每页~1000px 阅读舒适)。
   * 单页时恢复 720px(标准阅读宽度,避免行太长伤眼)。
   */
  /**
   * 设置最大列数(1=单页,2=双页);foliate-js 会按容器宽度自适应。
   *
   * 关键时序:Panel 在 renderMode='reflowable' 推送时就 setMaxColumnCount,
   * 但此刻 EPUBRenderer.view 可能还未创建(view 在 ReflowableContent mount
   * 调 renderTo 时才异步创建)。故总是存 pendingMaxColumnCount,
   * view ready 时(initView 内)从 pending 读取应用。
   *
   * 实际列数 = min(count, ceil(容器宽 / max-inline-size))。
   * 双页时同步调大 max-inline-size 让 spread 撑满容器;单页时恢复 720px。
   */
  setMaxColumnCount(count: 1 | 2, maxInlineSizePx?: number): void {
    this.pendingMaxColumnCount = count;
    if (typeof maxInlineSizePx === 'number' && maxInlineSizePx > 0) {
      this.pendingMaxInlineSizePx = maxInlineSizePx;
    }
    const r = this.view?.renderer;
    if (!r) return; // view 还未 ready,initView 完成时会读 pending 应用
    r.setAttribute?.('max-column-count', String(count));
    // 优先用调用方传入的精确像素值(全屏布局对齐用);未传则走默认上限
    // (1000px 双页 / 720px 单页)
    const inlineSize = this.pendingMaxInlineSizePx
      ?? (count === 2 ? 1000 : 720);
    r.setAttribute?.('max-inline-size', `${inlineSize}px`);
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
    callback: (progress: { chapter: string; percentage: number; page: number; pages: number }) => void,
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

  // ── C4:标注 + 文本选择 + 双指水平 swipe 翻页 ──

  private annotationCallback:
    | ((info: { cfi: string; text: string; x: number; y: number }) => void)
    | null = null;
  private selectionDismissCallback: (() => void) | null = null;
  private annotationClickCallback: ((cfi: string) => void) | null = null;
  /** L5-C4 fix:水平 swipe 推送(macOS Books 同款 UX);direction 为 'next' / 'prev' */
  private horizontalSwipeCallback: ((direction: 'next' | 'prev') => void) | null = null;

  onTextSelected(
    callback: (info: { cfi: string; text: string; x: number; y: number }) => void,
  ): void {
    this.annotationCallback = callback;
  }

  onSelectionDismiss(callback: () => void): void {
    this.selectionDismissCallback = callback;
  }

  onAnnotationClick(callback: (cfi: string) => void): void {
    this.annotationClickCallback = callback;
  }

  /** L5-C4 fix:注册水平 swipe 翻页回调(reflowable-content 消费) */
  onHorizontalSwipe(callback: (direction: 'next' | 'prev') => void): void {
    this.horizontalSwipeCallback = callback;
  }

  /**
   * 给 EPUB iframe 内的 doc 绑 mousedown / mouseup(选区)+ wheel(swipe 翻页)。
   * 必须在 iframe doc 上绑而不是外层 container — iframe wheel 不冒泡。
   */
  private setupSelectionListener(): void {
    if (!this.view) return;

    // 单源 swipe 状态(跨多个 doc 共享):一次手势只翻一页。
    // 累计 deltaX 跨阈值触发后,gestureActive=true 屏蔽后续 wheel 事件;
    // 直到 wheel 静默 GESTURE_END_MS 后才解锁(认定手势结束)。
    let accumulatedX = 0;
    let gestureActive = false;
    let gestureEndTimer: ReturnType<typeof setTimeout> | null = null;
    const SWIPE_THRESHOLD = 50;
    const GESTURE_END_MS = 200; // wheel 静默此时长后认为手势结束

    const attachListeners = (doc: any, index: number): void => {
      if (!doc || doc.__ebookListenersAttached) return;
      doc.__ebookListenersAttached = true;

      // mousedown → 关闭 picker(若产生新选区,mouseup 会重新弹)
      doc.addEventListener('mousedown', () => {
        this.selectionDismissCallback?.();
      });

      doc.addEventListener('mouseup', () => {
        const sel = doc.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount) return;

        const range = sel.getRangeAt(0);
        const text = sel.toString().trim();
        if (!text) return;

        const cfi = this.view.getCFI(index, range);
        if (cfi && this.annotationCallback) {
          // range 的 getBoundingClientRect 返 iframe 内坐标;转到 view 容器坐标系
          const rect = range.getBoundingClientRect();
          const iframeEl = doc.defaultView?.frameElement as HTMLElement | null;
          const iframeRect =
            iframeEl?.getBoundingClientRect() ?? { left: 0, top: 0 };
          const viewRect =
            this.container?.getBoundingClientRect() ?? { left: 0, top: 0 };
          const x = rect.left + rect.width / 2 + iframeRect.left - viewRect.left;
          const y = rect.bottom + iframeRect.top - viewRect.top;
          this.annotationCallback({ cfi, text, x, y });
        }
      });

      // L5-C4 fix:双指水平 swipe → 翻页(macOS Books)
      // 一次手势 = 一次翻页。手势期间:
      //   - 触发翻页前累计 deltaX 跨 SWIPE_THRESHOLD
      //   - 触发后 gestureActive=true 屏蔽后续 wheel 事件
      //   - wheel 静默 GESTURE_END_MS 后解锁,等待下一次手势
      doc.addEventListener(
        'wheel',
        (e: WheelEvent) => {
          // Cmd/Ctrl + wheel 留给字号缩放等
          if (e.metaKey || e.ctrlKey) return;
          // 仅水平方向(垂直 wheel 不接管 — paginated 模式不需垂直滚动)
          if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;

          // 每次水平 wheel 都重启 "手势结束" 计时器
          if (gestureEndTimer) clearTimeout(gestureEndTimer);
          gestureEndTimer = setTimeout(() => {
            accumulatedX = 0;
            gestureActive = false;
          }, GESTURE_END_MS);

          // 已触发过本次手势 → 屏蔽
          if (gestureActive) {
            e.preventDefault();
            return;
          }

          accumulatedX += e.deltaX;
          if (Math.abs(accumulatedX) < SWIPE_THRESHOLD) return;

          // 触发翻页:deltaX > 0(内容左推)= 下一页;< 0 = 上一页
          const direction: 'next' | 'prev' = accumulatedX > 0 ? 'next' : 'prev';
          this.horizontalSwipeCallback?.(direction);

          gestureActive = true;
          e.preventDefault();
        },
        { passive: false },
      );
    };

    // 已加载的 sections
    const contents = this.view.renderer?.getContents?.();
    if (contents) {
      for (const { doc, index } of contents) {
        attachListeners(doc, index);
      }
    }

    // 后续加载的 section
    this.view.addEventListener('load', (e: any) => {
      const { doc, index } = e.detail;
      attachListeners(doc, index);
    });
  }

  async addHighlight(cfi: string, color: string): Promise<void> {
    await this.readyPromise;
    if (!this.view) return;
    try {
      await this.view.addAnnotation({ value: cfi, color });
    } catch {
      // ignore — 可能 cfi 无效或 view 已 destroy
    }
  }

  removeHighlight(cfi: string): void {
    this.view?.deleteAnnotation?.({ value: cfi });
  }
}
