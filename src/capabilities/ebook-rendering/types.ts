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

  /** 文本搜索(C3 真消费)*/
  searchText(query: string): Promise<Array<{ pageNum: number; index: number; text: string }>>;
}

/** 可重排渲染引擎(EPUB,C3 起实现;C4 加标注 API)*/
export interface IReflowableRenderer extends IBookRenderer {
  readonly renderMode: 'reflowable';

  renderTo(container: HTMLElement): void;

  setFontSize(size: number): void;
  getFontSize(): number;

  getProgress(): { chapter: string; percentage: number };
  nextChapter(): void;
  prevChapter(): void;

  setDisplayMode(mode: 'paginated' | 'scrolled'): void;
  onResize(): void;

  getLastCFI(): string | null;
  setRestoreLocation(cfi: string): void;
  onRelocate(callback: (progress: { chapter: string; percentage: number }) => void): void;

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
  /** 添加 CFI 高亮(自定义颜色)*/
  addHighlight(cfi: string, color: string): Promise<void>;
  /** 移除 CFI 高亮 */
  removeHighlight(cfi: string): void;

  // ── C4 fix:双指水平 swipe 翻页(macOS Books 同款 UX)──
  /** 注册 swipe 翻页回调(由 reflowable-content 消费,触发 prev/nextChapter)*/
  onHorizontalSwipe(callback: (direction: 'next' | 'prev') => void): void;
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
import type { EpubAnnotationPicker } from './epub-annotation-picker';
import type { useSearch } from './hooks/use-search';
import type { useBookmarks } from './hooks/use-bookmarks';
import type { useEpubAnnotation } from './hooks/use-epub-annotation';

export type { EBookHostProps, EBookHostHandle, SearchResult } from './Host';
export type {
  PageAnnotation,
  AnnotationDraft,
} from './fixed-page-content/annotation-layer';

export interface EBookRenderingApi {
  /** Host 主组件(forwardRef EBookHostHandle)— view 通过 ref 命令式驱动 */
  Host: ComponentType<EBookHostProps & { ref?: Ref<EBookHostHandle> }>;
  /** 侧栏 TOC 树(view 通过 host 驱动 — host.getTOC / host.goToPage / host.goToCFI)*/
  OutlinePanel: typeof OutlinePanel;
  /** 搜索栏 UI(配 useSearch hook 用)*/
  SearchBar: typeof SearchBar;
  /** EPUB 选区颜色 picker(配 useEpubAnnotation hook 用)*/
  EpubAnnotationPicker: typeof EpubAnnotationPicker;
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
  openFullscreenReader(payload: {
    workspaceId: string;
    bookInfo: import('@shared/ipc/ebook-types').EBookLoadedInfo;
  }): void;
}
