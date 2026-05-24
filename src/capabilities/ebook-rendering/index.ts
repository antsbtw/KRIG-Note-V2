/**
 * ebook-rendering capability — 入口(L5-C2)
 *
 * 职责:封装 pdfjs-dist(C2)+ foliate-js(C3 起)的整个生命周期,以
 * <EBookHost ref={hostRef} /> 单一面孔暴露给 view。view 通过 ref 命令式 +
 * props 回调通信,**0 处** import npm 业务包(pdfjs-dist / foliate-js)。
 *
 * 装配关系(charter § 1.3 表格):
 * - capability.ebook-rendering 内部依赖:
 *   - pdfjs-dist@^4.9.155(EBookView 设计 v2 § 5 #10:5.x 与 Electron 40 不兼容)
 *   - foliate-js(C3 起,EPUB)
 *   - capability.ebook-library(view 端订阅 onBookOpened → 通过 ref 调 loadFromInfo)
 *
 * view install 路径:`install: ['ebook-library', 'ebook-rendering']`
 *
 * W5 严格态 A 边界(audit § 5.2):
 * - View 侧(强制):走 requireCapabilityApi('ebook-rendering').Host 间接路由
 * - Driver/slot 侧:本 capability 无 driver 消费场景
 * - 模块级 export 同时挂(双导出),对齐 web-rendering / ebook-library 风格
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import { fullscreenOverlayRegistry } from '@slot/interaction-registries/fullscreen-overlay-registry/registry';
import { fullscreenOverlayController } from '@slot/triggers/fullscreen-overlay-controller';
import { EBookHost } from './Host';
import { OutlinePanel } from './outline-panel';
import { SearchBar } from './search-bar';
import { EpubAnnotationPicker } from './epub-annotation-picker';
import { useSearch } from './hooks/use-search';
import { useBookmarks } from './hooks/use-bookmarks';
import { useEpubAnnotation } from './hooks/use-epub-annotation';
import { EBookFullscreenPanel } from './fullscreen/EBookFullscreenPanel';
import { EpubAaPopup } from './fullscreen/EpubAaPopup';
import {
  loadEpubReadingSettings,
  saveEpubFontSize,
  saveEpubTheme,
  saveEpubAppearance,
  subscribeEpubReadingSettings,
} from './fullscreen/epub-reading-settings';
import {
  EBOOK_FULLSCREEN_OVERLAY_ID,
  setEBookFullscreenContext,
} from './fullscreen/fullscreen-context';
import type { EBookLoadedInfo } from '@shared/ipc/ebook-types';
import {
  isFixedPage,
  isReflowable,
  detectFileType,
  getRenderMode,
  type EBookRenderingApi,
} from './types';
import './styles.css';

// 类型 export(view 端通过 @capabilities/ebook-rendering/types 拿)
export type {
  EBookRenderingApi,
  EBookHostHandle,
  EBookHostProps,
  SearchResult,
  IBookRenderer,
  IFixedPageRenderer,
  IReflowableRenderer,
  EBookFileType,
  RenderMode,
  PageDimension,
  PagePosition,
  CFIPosition,
  BookPosition,
  SpatialAnchor,
  CFIAnchor,
  AnnotationAnchor,
  ToolbarConfig,
  TOCItem,
} from './types';
export type { EpubSelection } from './hooks/use-epub-annotation';
export type { PageAnnotation } from './fixed-page-content/annotation-layer';

// 模块级 export(driver/slot 兜底用,W5 边界 A 临时允许项)
export {
  EBookHost,
  OutlinePanel,
  SearchBar,
  EpubAnnotationPicker,
  useSearch,
  useBookmarks,
  useEpubAnnotation,
  isFixedPage,
  isReflowable,
  detectFileType,
  getRenderMode,
};

/** view 侧通过 capability api 调起 L2 全屏阅读 overlay(W5 边界:view 不直 import 此函数)*/
function openFullscreenReader(payload: {
  workspaceId: string;
  bookInfo: EBookLoadedInfo;
  /** EPUB 单 column 宽度,全屏 panel 用 2× 居中布局实现 spread 与 view 主区文字对齐 */
  epubViewColumnWidth?: number;
}): void {
  setEBookFullscreenContext(payload);
  fullscreenOverlayController.show(EBOOK_FULLSCREEN_OVERLAY_ID);
}

capabilityRegistry.register({
  id: 'ebook-rendering',
  api: {
    Host: EBookHost,
    OutlinePanel,
    SearchBar,
    EpubAnnotationPicker,
    useSearch,
    useBookmarks,
    useEpubAnnotation,
    isFixedPage,
    isReflowable,
    detectFileType,
    getRenderMode,
    EpubAaPopup,
    loadEpubReadingSettings,
    saveEpubFontSize,
    saveEpubTheme,
    saveEpubAppearance,
    subscribeEpubReadingSettings,
    openFullscreenReader,
  } satisfies EBookRenderingApi,
});

// L2 fullscreen overlay 注册(对齐 text-editing fullscreen-overlays.ts 模式)
fullscreenOverlayRegistry.register({
  id: EBOOK_FULLSCREEN_OVERLAY_ID,
  Component: EBookFullscreenPanel,
});
