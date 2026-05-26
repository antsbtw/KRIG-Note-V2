# PDF Viewer Adapter — 全量重构计划

> v0.1 · 2026-05-25
> 配套提示词:`docs/refactor/pdf-viewer-adapter-prompt.md`
> 分支:`feature/pdf-viewer-adapter`(from main)

---

## 1. 重构动机

V2 现 PDF view 走 `src/capabilities/ebook-rendering/pdf/index.ts`(412 行手写 renderer
+ `fixed-page-content/index.tsx` 376 行虚拟滚动)。基于 pdfjs-dist 4.x **底层 API** 自拼:

| 现有手写问题 | 现状 | 后果 |
|---|---|---|
| trackpad pinch 缩放闪烁 | scale 变 → invalidateAll → 异步重 render | 视觉闪一下,大 PDF 更明显 |
| RenderTask 没正确 cancel | 单 activeTask 引用,新 task 来覆盖旧的 | 旧 task 完成回写到错的 canvas |
| TextLayer 每次 scale 重建 | renderTextLayer 接 scale → 改 → DOM 全删重建 | 选区中断、复制乱码 |
| cMap / 字体 / 安全配置全 0 | `getDocument({ data })` 单参数 | 中日韩字符乱码、`eval` 启用安全降级 |
| Worker 配 `workerSrc=string` | pdfjs 4.x 推 `workerPort=Worker instance` | 旧版兼容路径,fake worker fallback 警告 |
| 无 PDFViewer / EventBus | 自己写 onScroll + 算 visibleRange + 派发 | 重复造轮子,与官方 layer 生命周期不一致 |

走 **全量重构** + 直接继承 pdfjs-dist 4.x 高层组件
(`PDFViewer` / `PDFPageView` / `EventBus` / `PDFLinkService` / `PDFRenderingQueue` /
`GenericL10n` / `TextLayerBuilder` / `AnnotationLayer`),在 KRIG 内做语义化 adapter
封装,不再修补底层 renderer。

---

## 2. 分层与边界

```
┌── view 层 (src/views/ebook/) ───────────────────────────────┐
│ EBookView.tsx 只调 adapter 暴露的 React 组件 + Host 命令     │
│ 不感知 pdfjs                                                │
└────────────────────────────────────────────────────────────┘
                  ↓ 走 capability-registry(W5 边界 A 强制)
┌── adapter 层 (src/capabilities/pdf-viewer/) ─新 capability ─┐
│ React 组件 PDFViewerCanvas                                  │
│ 命令式 API loadDocument / getOutline / searchText / capture │
│ 中性类型 DocumentHandle / TOCItem / SearchResult            │
└────────────────────────────────────────────────────────────┘
                  ↓ 唯一 import pdfjs-dist
┌── pdfjs-dist 4.x ────────────────────────────────────────┐
│ PDFViewer + PDFPageView + EventBus + PDFLinkService +    │
│ PDFRenderingQueue + GenericL10n + TextLayer + Annotation │
└──────────────────────────────────────────────────────────┘
```

**新 capability id**:`pdf-viewer`,与 `ebook-rendering` 平级。
**唯一 import pdfjs-dist 的位置**:`src/capabilities/pdf-viewer/**`。
现有 `ebook-rendering/pdf/index.ts` 重构后只为 paged 全屏临时双轨保留(见 Phase D)。

---

## 3. Adapter 对外 API(完整 TypeScript 草签)

### 3.1 中性类型(`src/capabilities/pdf-viewer/types.ts`)

```ts
/** Opaque PDF 文档句柄 — view / 上层 capability 持有但不解构 */
export interface DocumentHandle {
  readonly _brand: 'pdf-viewer.DocumentHandle';
  /** 仅供 adapter 内部读取,view 不 access */
  readonly id: string;
  readonly totalPages: number;
}

/** TOC 节点(中性,不含 pdfjs 的 dest 结构)*/
export interface TOCItem {
  label: string;
  /** 跳转用 — adapter 内部反查原始 dest;view 透传给 goToDestination */
  destRef: string;
  children?: TOCItem[];
}

/** 全文搜索结果 */
export interface SearchResult {
  pageNum: number;
  /** 命中位置在该页文字流的字符偏移 */
  index: number;
  /** 高亮上下文(命中 ±20 字符)*/
  text: string;
}

/** 视图适配模式(对应 PDFViewer 的 fit/auto/page-width)*/
export type FitMode = 'auto' | 'page-width' | 'page-fit' | 'page-actual';

/** 链接点击事件 — adapter 拦截后转给 view */
export interface LinkClickInfo {
  /** dest 类型:'internal' = PDF 内部跳页;'external' = 外链(view 决定是否调 shell.openExternal)*/
  type: 'internal' | 'external';
  /** internal 时为 destRef(可传回 goToDestination);external 时为 URL */
  ref: string;
}
```

### 3.2 命令式 API(`src/capabilities/pdf-viewer/loader.ts` + capability 入口)

```ts
export interface PdfViewerApi {
  /** 加载文档(buffer 由 view / library 提供)— 一个 PDFViewerCanvas mount 时调一次 */
  loadDocument(data: ArrayBuffer | Uint8Array): Promise<DocumentHandle>;

  /** 释放文档资源(unmount / 切书 / unload 时调)*/
  destroyDocument(handle: DocumentHandle): Promise<void>;

  /** 取 TOC(无 outline 时返空数组)*/
  getOutline(handle: DocumentHandle): Promise<TOCItem[]>;

  /** 取页面 label(部分 PDF 用罗马数字 i/ii/... 给前言页)*/
  getPageLabels(handle: DocumentHandle): Promise<string[] | null>;

  /** 截 PDF 指定页 rect 区域为 JPEG dataUrl(独立 render,2x DPR 高清)*/
  capturePageRect(
    handle: DocumentHandle,
    pageNum: number,
    rect: { x: number; y: number; w: number; h: number },
  ): Promise<string>;

  /** 全文搜索 — 保留 getTextContent 路径,不引 PDFFindController(本 PR 不动 search-bar)*/
  searchText(handle: DocumentHandle, query: string): Promise<SearchResult[]>;

  /** 检测某页是否含 text content(扫描件返 false;✎ 文字标注启用前判断)*/
  hasTextContent(handle: DocumentHandle, pageNum: number): Promise<boolean>;

  /** React 组件 — view 直接挂载,通过 props 命令式驱动 */
  PDFViewerCanvas: ComponentType<PDFViewerCanvasProps & { ref?: Ref<PDFViewerCanvasHandle> }>;
}
```

### 3.3 React 组件(`src/capabilities/pdf-viewer/PDFViewerCanvas.tsx`)

```ts
export interface PDFViewerCanvasProps {
  /** 必传 — 调 loadDocument 后拿到的句柄 */
  handle: DocumentHandle;

  /** 初始页(1-based);未提供 = 1 */
  initialPage?: number | null;

  /** 初始 fit 模式;默认 'page-width' */
  initialFitMode?: FitMode;

  /** 当前页号变化(scrolling / scrollPageIntoView 触发)*/
  onPageChange?: (page: number) => void;

  /** 缩放变化(updateScale / fit-mode 触发)*/
  onScaleChange?: (scale: number) => void;

  /** 单页 textLayer 渲染完成 — view 用此挂选区监听 / vocab-highlight 扫词 */
  onTextLayerReady?: (pageNum: number, textLayerDiv: HTMLElement) => void;

  /** 单页 DOM mount 完成(canvas + wrapper 可访问)— view 用此挂 annotation layer */
  onPageMounted?: (pageNum: number, pageDiv: HTMLElement) => void;

  /** 单页卸载(virtual scroll 出可视范围后被 PDFViewer 销毁)— view 清理对应 layer 状态 */
  onPageUnmounted?: (pageNum: number) => void;

  /** 链接拦截 — view 决定外链是否 openExternal;internal 不需拦截(LinkService 已自跳)*/
  onLinkClick?: (info: LinkClickInfo) => void;
}

export interface PDFViewerCanvasHandle {
  /** 跳转到指定页(对齐 PDFViewer.currentPageNumber setter,scroll-to-source 用)*/
  goToPage(pageNum: number): void;

  /** 跳转到 TOC 节点(透传 destRef 给 LinkService.goToDestination)*/
  goToDestination(destRef: string): void;

  /** 修改 scale(对齐 updateScale,带 origin 锚定鼠标位置)*/
  setScale(scaleFactor: number, origin?: [number, number]): void;

  /** 切换 fit 模式(对齐 currentScaleValue = 'page-width' / 'page-fit' / 'auto')*/
  setFitMode(mode: FitMode): void;

  /** 当前 scale(读取用,view 持久化 PdfProgress 用)*/
  getScale(): number;
}
```

### 3.4 文字选区(沿用 view 层 hook 路径)

`src/capabilities/ebook-rendering/hooks/use-pdf-text-selection.ts` 当前监听 window
mouseup → window.getSelection,与 textLayer DOM 解耦,**保持不变**。
适配器仅通过 `onTextLayerReady(pageNum, div)` 把 textLayer DOM 暴露给 view,
view 用 ref Map 自己维护,hook 接同样的 ref Map。

---

## 4. 类型映射:pdfjs 内部 → KRIG 中性

| pdfjs 内部 | KRIG 中性 | 隔离原因 |
|---|---|---|
| `PDFDocumentProxy` | `DocumentHandle`(opaque)| view 切 5.x 时不需要改 |
| `PageViewport` | 不暴露(adapter 内部用)| 仅渲染过程需要 |
| `RenderTask` | 不暴露(PDFRenderingQueue 自管)| 不再让 view 关心 cancel |
| `OutlineItem` 数组 | `TOCItem[]`(destRef 字符串化)| TOC 树结构通用 |
| `dest` (array / string) | `destRef: string`(adapter 内 hash 化)| 跳转语义化 |
| `AnnotationMode.ENABLE` | 不暴露(adapter 内置 LINKS_ONLY 等价配置)| KRIG 不用 PDF 自带 annotation editor |
| `AnnotationEditorType.NONE` | 不暴露(adapter 内置)| 同上 |
| `TextLayer` instance | 不暴露,通过 `onTextLayerReady` 拿 DOM | view 操作 DOM 不操作类实例 |
| `EventBus` | 不暴露(adapter 内部桥接)| view 拿到的是 React props 回调 |

---

## 5. 五阶段计划

### Stage 1 — adapter 骨架 + getDocument 全配置 + Worker 4.x

**新增文件**:
- `src/capabilities/pdf-viewer/index.ts` — capability 注册
- `src/capabilities/pdf-viewer/types.ts` — 中性类型
- `src/capabilities/pdf-viewer/worker-setup.ts` — Worker 初始化
- `src/capabilities/pdf-viewer/loader.ts` — loadDocument / destroyDocument /
  getOutline / getPageLabels / hasTextContent / searchText / capturePageRect

**getDocument 配置**(全部本地,无 CDN):
- `cMapUrl` + `cMapPacked: true` → `new URL('pdfjs-dist/cmaps/', import.meta.url).href`
- `standardFontDataUrl` → `new URL('pdfjs-dist/standard_fonts/', import.meta.url).href`
- `isEvalSupported: false`
- `enableHWA: true`
- `maxCanvasPixels: -1`

**Worker 配置**(改 4.x `workerPort` 风格):
```ts
// 首选 Vite ?worker 后缀(运行时拿 Worker 构造函数)
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
GlobalWorkerOptions.workerPort = new PdfWorker();
```
若 Vite 在 Electron renderer 下 `?worker` 行为异常,fallback:
```ts
const url = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url);
GlobalWorkerOptions.workerPort = new Worker(url, { type: 'module' });
```
**关键**:不写 `workerSrc = string`(4.x 已 deprecate)。

**验收**:
- `loadDocument` 成功返 `DocumentHandle`,DevTools Console 无 "fake worker" 警告
- 中日韩 PDF 加载不爆错(cMap 路径正确)
- `npm run typecheck && npm run lint` 全清
- 暂无 UI(无 PDFViewerCanvas;adapter 仅命令式 API 可用)

**Phase D 留洞**:打包后 cmaps / standard_fonts 是否随 app.asar 进发布包未验证,
Stage 5 验收时需手动 `npm run make` 打 dmg 跑一次中日韩 PDF。

### Stage 2 — PDFViewer 集成 + 标准 services + pinch 缩放

**新增文件**:
- `src/capabilities/pdf-viewer/services.ts` — EventBus / PDFLinkService /
  PDFRenderingQueue / GenericL10n 工厂
- `src/capabilities/pdf-viewer/PDFViewerCanvas.tsx` — React 组件
- `src/capabilities/pdf-viewer/styles.css` — 选择性引入 `pdfjs-dist/web/pdf_viewer.css`

**DOM 严格按官方**:
```tsx
<div ref={containerRef} className="pdfViewerContainer" tabIndex={0}>
  <div ref={viewerRef} className="pdfViewer" />
</div>
```

**PDFViewer 配置**:
- `annotationMode: AnnotationMode.ENABLE`(让 link 渲染)
- `annotationEditorMode: AnnotationEditorType.NONE`(禁 editor)
- `textLayerMode: TextLayerMode.ENABLE`
- `removePageBorders: false`
- `maxCanvasPixels: -1`
- `enableHWA: true`

**事件桥接**(eventBus.on):
- `pagesinit` → 设 initialScale(initialFitMode)
- `pagesloaded` → 设 initialPage
- `pagechanging` → props.onPageChange
- `scalechanging` → props.onScaleChange
- `textlayerrendered` → props.onTextLayerReady(取 viewer.getPageView(idx-1).textLayer.div)
- `pagerendered` → props.onPageMounted(取 viewer.getPageView(idx-1).div)

**缩放走官方 `updateScale({ drawingDelay: 2000, scaleFactor, origin: [x,y] })`**。
自管 wheel handler:Cmd+wheel → preventDefault + 调 updateScale(以鼠标位置为 origin)。
非 Cmd 滚动让 PDFViewer 默认 scroll 走。

**键盘缩放**:Cmd+= / Cmd+- → updateScale(±0.1 factor);Cmd+0 → setFitMode('page-width')。

**LinkService**:订阅其 dispatch link click → props.onLinkClick(分 internal/external)。

**验收**:
- PDF 加载后能滚动浏览
- trackpad pinch 缩放鼠标位置锚定 + **不闪**(目标核心)
- Cmd+= / Cmd+- / Cmd+0 工作
- outline 跳转工作(通过 ref.goToDestination)
- 控制台无报错

### Stage 3 — Layer 适配(KRIG 自定义层接入)

**改文件**(不改路径,改入口接 PDFViewer events):
- `src/capabilities/ebook-rendering/fixed-page-content/annotation-layer.tsx`
  — 保留组件,接受外部 pageDiv 作 ref 挂载点(不再自创 wrapper)
- `src/capabilities/ebook-rendering/hooks/use-pdf-text-selection.ts`
  — 不动(已经监听 window mouseup,只是 textLayer ref Map 喂入来源换成 PDFViewer)
- `src/views/ebook/pdf-vocab-highlight/index.ts`
  — 入口改成 `onTextLayerReady` 回调驱动,内部扫描逻辑不动

**Host 内**:在 PDF scroll 分支挂 PDFViewerCanvas,通过:
- `onPageMounted(pageNum, pageDiv)` → 创建 `<AnnotationLayer>` portal 到 pageDiv
- `onTextLayerReady(pageNum, textLayerDiv)` → 喂给 view 的 textLayer ref Map +
  转 `onPdfTextLayerRendered` 给 view(vocab-highlight 入口)
- `onPageUnmounted(pageNum)` → 清 ref + 撤销 portal

**验收**:
- C5 矩形标注创建 / 显示 / flash 工作
- textLayer 选区 picker 弹出工作
- PDF vocab-highlight 显示工作
- 翻页时 layer 跟随 page lifecycle 正确挂载/销毁

### Stage 4 — 替换 Host 调用方 + 删旧 renderer

**改文件**:
- `src/capabilities/ebook-rendering/Host.tsx`
  - PDF scroll 分支删 `FixedPageContent`,改 `<PDFViewerCanvas>`(从 pdf-viewer 拿)
  - 在加载 PDF 时,通过 pdf-viewer.loadDocument 拿 handle,把 handle 喂 PDFViewerCanvas
  - Host 暴露的 capturePageRect / hasTextContent / searchText / getTOC 改走
    pdf-viewer 命令式 API(EBookHostHandle 对外签名不变,view 端 0 改动)
- `src/capabilities/ebook-rendering/pdf/index.ts`
  - 删 `renderPage / renderTextLayer / processQueue / activeTask / textLayers / rendered`
  - 只保留 `load / destroy / getPageDimensions / getTotalPages` 给 paged 全屏临时复用
  - **加注释**:`// TODO Phase D — paged 全屏切 PDFViewer ScrollMode.PAGE 重写后,本文件整体删除`
- `src/capabilities/ebook-rendering/fixed-page-content/index.tsx`
  - **删除整文件**(376 行)

**不动**:
- `src/capabilities/ebook-rendering/fullscreen/FullscreenPageView.tsx`(paged 全屏,Phase D)
- `src/views/ebook/EBookView.tsx`(命令式接口语义不变)

**验收**:
- PDF 滚动模式完整工作(加载/翻页/缩放/标注/搜索/outline)
- PDF paged 全屏模式仍工作(走临时双轨)
- typecheck + lint 全清

### Stage 5 — 全局验收 + 测试清单

写 `docs/refactor/pdf-viewer-adapter-test-checklist.md`(逐项"操作 → 期望"格式):
- 加载 / 翻页 / 滚动
- trackpad pinch 缩放体验
- Cmd+= / Cmd+- / Cmd+0
- outline 跳转
- 文字选区 + picker 弹出
- vocab-highlight 显示
- 矩形标注创建 / 显示 / flash
- PDF 内超链接点击(LinkService 拦截)
- 中日韩 PDF 字符显示(cMap 验证;dev + 打包 dmg)
- DevTools Console 无错 + 无 fake worker 警告
- 大 PDF (50MB+) 加载不卡死主线程
- paged 全屏模式翻页(双轨)

---

## 6. Phase D 留洞 — paged 全屏后续

`FullscreenPageView.tsx` 644 行当前依赖 `PDFRenderer.renderPage / renderTextLayer`。
未来 Phase D 改造方向:

- 切 PDFViewer 实例 + `scrollMode = ScrollMode.PAGE` + `spreadMode = SpreadMode.ODD`
  (双页 spread)
- 全屏期翻页用 `viewer.nextPage() / previousPage()` 替代 react state-driven 翻页
- 翻页动画用 PDFViewer 内部 `_resetView` 配合 CSS transition,而非现在的 capturePage
  ghost 路径
- 待 Phase D 真正立项,本 PR 不动它

---

## 7. 操作纪律

- 每个 stage **一个 commit**,提交信息 `feat(pdf-viewer): Stage N — XXX`
- 每 commit 后跑 `npm run typecheck && npx eslint <changed files>`
- Stage 完成后给用户简短报告(改的文件 + 验收期望),**用户确认 OK 才进下一 stage**
- 5 stage 全完 + 测试清单跑完 + 用户说"merge" 才合 main
- 不 push 到 origin
- 不引入新 npm 依赖

## 8. Stage 完成标记

- [x] Stage 1 — commit hash: `819fea5e`
- [x] Stage 2 — commit hash: `a50ae5fb`
- [x] Stage 3 — commit hash: `0ba01a92`
- [ ] Stage 4 — commit hash: ___
- [ ] Stage 5 — commit hash: ___
