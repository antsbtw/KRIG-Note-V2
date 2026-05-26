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
// 依赖:pdf-viewer capability 提供 PDFViewer adapter(scroll 模式 PdfScrollContent 用)
// + 副作用初始化 pdfjs Worker(workerPort 风格)。本 import 保证它先于 PDFRenderer 实例化加载。
import '@capabilities/pdf-viewer';
import { EBookHost } from './Host';
import { OutlinePanel } from './outline-panel';
import { SearchBar } from './search-bar';
// EpubAnnotationPicker 废除(PR-α-3b followup:EPUB 选区操作改走 L4 右键菜单)
import { PdfTextAnnotationPicker } from './pdf-text-annotation-picker';
import { useSearch } from './hooks/use-search';
import { useBookmarks } from './hooks/use-bookmarks';
import { useEpubAnnotation } from './hooks/use-epub-annotation';
import { EpubAaPopup } from './fullscreen/EpubAaPopup';
import {
  loadEpubReadingSettings,
  saveEpubFontSize,
  saveEpubTheme,
  saveEpubAppearance,
  subscribeEpubReadingSettings,
} from './fullscreen/epub-reading-settings';
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
// EpubSelection 废除(PR-α-3b followup:EPUB 选区操作改走 L4 右键菜单)
export type { PageAnnotation } from './annotation-layer';

// 模块级 export(driver/slot 兜底用,W5 边界 A 临时允许项)
export {
  EBookHost,
  OutlinePanel,
  SearchBar,
  PdfTextAnnotationPicker,
  useSearch,
  useBookmarks,
  useEpubAnnotation,
  isFixedPage,
  isReflowable,
  detectFileType,
  getRenderMode,
};

capabilityRegistry.register({
  id: 'ebook-rendering',
  api: {
    Host: EBookHost,
    OutlinePanel,
    SearchBar,
    PdfTextAnnotationPicker,
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
  } satisfies EBookRenderingApi,
});
