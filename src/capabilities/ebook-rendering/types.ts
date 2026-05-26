/**
 * ebook-rendering capability — 对外类型(L5-C2)
 *
 * 渲染引擎接口体系 + view 业务 API。
 * V1 → V2 直迁:src/plugins/ebook/types.ts(215 行)直接搬,改 capability 内部。
 *
 * 两种渲染模式:
 * - fixed-page(PDF / DjVu / CBZ):Canvas 逐页渲染,空间坐标
 * - reflowable(EPUB):iframe + HTML 重排,CFI 锚点
 *
 * C2 仅实现 PDF(IFixedPageRenderer);C3 加 EPUB(IReflowableRenderer)。
 *
 * view 端 import:
 *   import type { EBookRenderingApi, EBookHostHandle } from '@capabilities/ebook-rendering/types';
 */

import type { ComponentType, Ref } from 'react';

// ── 基础类型 ──

/** 支持的电子书格式 */
export type EBookFileType = 'pdf' | 'epub' | 'djvu' | 'cbz';

/** 渲染模式:决定使用哪种 Content 组件 */
export type RenderMode = 'fixed-page' | 'reflowable';

/** 页面尺寸(scale=1 时)*/
export interface PageDimension {
  width: number;
  height: number;
}

// ── 位置系统 ──

/** 固定页面的位置 */
export interface PagePosition {
  type: 'page';
  page: number;
  scrollOffset?: number;
}

/** 可重排内容的位置(EPUB CFI)*/
export interface CFIPosition {
  type: 'cfi';
  cfi: string;
  /** 人类可读描述("第 3 章 · 42%")*/
  display?: string;
}

/** 统一的位置类型 */
export type BookPosition = PagePosition | CFIPosition;

// ── 标注锚点(C5 真消费,C2 占位类型)──

export interface SpatialAnchor {
  type: 'spatial';
  pageNum: number;
  rect: { x: number; y: number; w: number; h: number };
}

export interface CFIAnchor {
  type: 'cfi';
  cfiRange: string;
  textContent?: string;
}

export type AnnotationAnchor = SpatialAnchor | CFIAnchor;

// ── Toolbar 配置(由 renderer 提供,view 端 EBookToolbar 消费)──

export interface ToolbarConfig {
  navigation: 'page' | 'chapter';
  zoom: 'scale' | 'fontSize';
  totalPages: number | null;
  /** 章节列表(EPUB 用,C3 起)*/
  chapters?: { label: string; href: string }[];
}

// ── TOC ──

export interface TOCItem {
  label: string;
  position: BookPosition;
  children?: TOCItem[];
}

// ── 渲染引擎接口 ──

export interface IBookRenderer {
  readonly fileType: EBookFileType;
  readonly renderMode: RenderMode;

  load(data: ArrayBuffer): Promise<void>;
  destroy(): void;

  getToolbarConfig(): ToolbarConfig;

  getPosition(): BookPosition;
  goTo(position: BookPosition): void;

  getTOC(): Promise<TOCItem[]>;
}

/** 固定页面渲染引擎(PDF / DjVu / CBZ)*/
export interface IFixedPageRenderer extends IBookRenderer {
  readonly renderMode: 'fixed-page';

  getPageDimensions(): PageDimension[];
  getTotalPages(): number;

  setScale(scale: number): void;
  getScale(): number;

  /** Canvas 渲染(由 FixedPageContent 调用)*/
  renderPage(pageNum: number, canvas: HTMLCanvasElement, scale: number): Promise<void>;
  /** 清缓存(scale 变化时重渲)*/
  invalidateAll(): void;

  /** Text Layer(文本选择 + 复制)*/
  renderTextLayer(pageNum: number, container: HTMLElement, scale: number): Promise<void>;
  clearTextLayer(pageNum: number): void;
  /** PR-α-3b followup:检测某页是否含 text content(扫描件返 false;✎ 文字标注启用前判断用)*/
  hasTextContent(pageNum: number): Promise<boolean>;

  /** 文本搜索(C3 真消费)*/
  searchText(query: string): Promise<Array<{ pageNum: number; index: number; text: string }>>;

  /**
   * 截 PDF 指定页 rect 区域为 JPEG dataUrl(独立离屏 render,2x DPR)。
   * rect 坐标基于 scale=1 的页面尺寸(与 PageAnnotation.rect 同坐标系)。
   * 2026-05-24 拍板:抽象通用截图能力,thumbnail anchor 创建 / 未来其他 view 复用。
   */
  capturePageRect(
    pageNum: number,
    rect: { x: number; y: number; w: number; h: number },
  ): Promise<string>;
}

/** 可重排渲染引擎(EPUB,C3 起实现;C4 加标注 API)*/
/** EPUB 阅读色调主题(对齐 Apple Books Reading Styles)— 风格维度
 *  6 个固定风格,每个有 light/dark 两套变体(由 EpubAppearance 决定)
 *  - original: 高对比中性,默认
 *  - quiet:    低对比沉静(注:Quiet 在 light/dark 下都用暗底灰字,不随模式变)
 *  - paper:    类纸张暖色
 *  - bold:     加粗字重
 *  - calm:     暖灰柔和
 *  - focus:    棕调专注
 */
export type EpubTheme = 'original' | 'quiet' | 'paper' | 'bold' | 'calm' | 'focus';

/** EPUB 明暗模式 — 与 EpubTheme 正交的第二维
 *  - light: 强制亮色变体(各主题白/米白底深字)
 *  - dark:  强制暗色变体(各主题暗底亮字)
 *  - auto:  跟随系统 prefers-color-scheme(V2 整体 dark 时 auto = dark)
 */
export type EpubAppearance = 'light' | 'dark' | 'auto';

export interface IReflowableRenderer extends IBookRenderer {
  readonly renderMode: 'reflowable';

  renderTo(container: HTMLElement): void;

  setFontSize(size: number): void;
  getFontSize(): number;

  getProgress(): { chapter: string; percentage: number; page: number; pages: number };
  /** 翻到下一页(EPUB view.next 是 async,resolve 时翻页完成) */
  nextChapter(): Promise<void>;
  /** 翻到上一页(同 nextChapter,async) */
  prevChapter(): Promise<void>;
  /** 按页号跳转 — EPUB 内部按 fraction 近似定位(page 数随字号变,不是稳定语义)*/
  goToPage(page: number): Promise<void>;

  setDisplayMode(mode: 'paginated' | 'scrolled'): void;
  /** 设置最大列数(1=单页 / 2=双页);foliate-js 会按容器宽度自适应 */
  setMaxColumnCount(count: 1 | 2): void;
  /** 设置阅读色调主题 — 改背景+文字色,通过 foliate-js setStyles 注入到 iframe 文档 */
  setTheme(theme: EpubTheme): void;
  /** 设置明暗模式 — light/dark/auto;auto 跟随 prefers-color-scheme 动态切换 */
  setAppearance(appearance: EpubAppearance): void;
  onResize(): void;

  getLastCFI(): string | null;
  setRestoreLocation(cfi: string): void;
  onRelocate(callback: (progress: { chapter: string; percentage: number; page: number; pages: number }) => void): void;

  searchText(query: string): Promise<Array<{ pageNum: number; index: number; text: string }>>;
  clearSearch(): void;

  // ── C4:标注 ──
  /** 文本选择(mouseup 后)→ 弹 picker */
  onTextSelected(
    callback: (info: { cfi: string; text: string; x: number; y: number }) => void,
  ): void;
  /** mousedown / 显式 dismiss → 关 picker */
  onSelectionDismiss(callback: () => void): void;
  /** 点击已有标注(show-annotation 事件)→ 触发删除 */
  onAnnotationClick(callback: (cfi: string) => void): void;
  /** PR-α-3b followup:EPUB iframe 内右键 → 触发 L4 右键菜单(view 端调 controller.show) */
  onContextMenu(
    callback: (info: {
      x: number;
      y: number;
      text: string;
      cfi: string | null;
      annotationCfi: string | null;
    }) => void,
  ): void;
  /** PR-α-3b followup:标注双击 → activate 关联 thought */
  onDoubleClick(callback: (annotationCfi: string) => void): void;
  /** 添加 CFI 高亮(自定义颜色)*/
  addHighlight(cfi: string, color: string): Promise<void>;
  /** 移除 CFI 高亮 */
  removeHighlight(cfi: string): void;
  /**
   * PR-α-3b followup fix:推已知标注 cfi 列表给 renderer,
   * iframe contextmenu/dblclick 时 renderer 内做"点击点是否落在标注 range 内"几何命中。
   *
   * 根因:foliate Overlayer 的 svg 整体 `pointerEvents: 'none'`,
   * iframe 内事件穿透到下层文字,target.closest('[data-foliate-annotation]') 永远 null。
   * 改走:用 caretPositionFromPoint 拿点击点 textNode+offset → 与 resolveCFI(cfi).anchor(doc) 的 Range 做 isPointInRange。
   */
  setKnownAnnotationCfis(cfis: string[]): void;

  // ── C4 fix:双指水平 swipe 翻页(macOS Books 同款 UX)──
  /** 注册 swipe 翻页回调(由 reflowable-content 消费,触发 prev/nextChapter)*/
  onHorizontalSwipe(callback: (direction: 'next' | 'prev') => void): void;

  /**
   * 2026-05-26:注册 EPUB section(spine item)load 完成回调 —
   * 对齐 fixed-page 的 onPdfTextLayerRendered;view 端订阅后做生词高亮等"扫文字"业务。
   *
   * 触发时机:已加载的 sections 在注册瞬间立即逐个触发(fast-path);
   * 新 section 加载在 attachListeners 完成所有内部监听后触发。
   * doc 是 iframe contentDocument;callback 可直接 querySelectorAll 注入 DOM。
   */
  onSectionLoad(callback: (doc: Document, index: number) => void): void;
}

// ── 类型守卫 ──

export function isFixedPage(renderer: IBookRenderer): renderer is IFixedPageRenderer {
  return renderer.renderMode === 'fixed-page';
}

export function isReflowable(renderer: IBookRenderer): renderer is IReflowableRenderer {
  return renderer.renderMode === 'reflowable';
}

// ── 工具函数 ──

export function detectFileType(fileName: string): EBookFileType {
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'pdf';
    case 'epub':
      return 'epub';
    case 'djvu':
      return 'djvu';
    case 'cbz':
    case 'cbr':
      return 'cbz';
    default:
      return 'pdf';
  }
}

export function getRenderMode(fileType: EBookFileType): RenderMode {
  switch (fileType) {
    case 'epub':
      return 'reflowable';
    default:
      return 'fixed-page';
  }
}

// ── view 业务路径 API ──

import type { EBookHostProps, EBookHostHandle } from './Host';
import type { OutlinePanel } from './outline-panel';
import type { SearchBar } from './search-bar';
// EpubAnnotationPicker 废除(PR-α-3b followup:EPUB 选区操作改走 L4 右键菜单)
import type { PdfTextAnnotationPicker } from './pdf-text-annotation-picker';
import type { useSearch } from './hooks/use-search';
import type { useBookmarks } from './hooks/use-bookmarks';
import type { useEpubAnnotation } from './hooks/use-epub-annotation';

export type { EBookHostProps, EBookHostHandle, SearchResult } from './Host';
export type {
  PageAnnotation,
  AnnotationDraft,
} from './annotation-layer';
export type { PdfTextSelectionEvent } from './hooks/use-pdf-text-selection';

export interface EBookRenderingApi {
  /** Host 主组件(forwardRef EBookHostHandle)— view 通过 ref 命令式驱动 */
  Host: ComponentType<EBookHostProps & { ref?: Ref<EBookHostHandle> }>;
  /** 侧栏 TOC 树(view 通过 host 驱动 — host.getTOC / host.goToPage / host.goToCFI)*/
  OutlinePanel: typeof OutlinePanel;
  /** 搜索栏 UI(配 useSearch hook 用)*/
  SearchBar: typeof SearchBar;
  /** PR-α-3b:PDF 文字流选区 picker(5 色 + H/S markStyle 切换 + ✕)*/
  PdfTextAnnotationPicker: typeof PdfTextAnnotationPicker;
  /** 搜索 hook(view 在内部 useState/useCallback 不暴露 renderer)*/
  useSearch: typeof useSearch;
  /** 书签 hook(C4) */
  useBookmarks: typeof useBookmarks;
  /** EPUB 标注 hook(C4) */
  useEpubAnnotation: typeof useEpubAnnotation;
  /** 类型守卫 — view / capability 内复用 */
  isFixedPage(renderer: IBookRenderer): renderer is IFixedPageRenderer;
  isReflowable(renderer: IBookRenderer): renderer is IReflowableRenderer;
  /** 工具函数 */
  detectFileType(fileName: string): EBookFileType;
  getRenderMode(fileType: EBookFileType): RenderMode;
  /**
   * 打开 L2 全屏沉浸阅读 overlay。
   * payload 内 bookInfo 直接喂给 panel 内独立 Host;view 端通常用最新 page/cfi
   * 覆盖 lastPosition,避免 panel 加载到 stale 位置。
   */
  /** EPUB 阅读偏好(字号 + 主题 + 明暗模式)— popup wrapper + EBookView 同步使用 */
  EpubAaPopup: ComponentType<{
    fontSize: number;
    theme: EpubTheme;
    appearance: EpubAppearance;
    onFontSizeChange: (size: number) => void;
    onThemeChange: (theme: EpubTheme) => void;
    onAppearanceChange: (appearance: EpubAppearance) => void;
  }>;
  loadEpubReadingSettings(): { fontSize: number; theme: EpubTheme; appearance: EpubAppearance };
  saveEpubFontSize(size: number): void;
  saveEpubTheme(theme: EpubTheme): void;
  saveEpubAppearance(appearance: EpubAppearance): void;
  subscribeEpubReadingSettings(
    listener: (s: { fontSize: number; theme: EpubTheme; appearance: EpubAppearance }) => void,
  ): () => void;
}
