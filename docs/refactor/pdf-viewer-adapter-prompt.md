# PDF View 全量重构 — 任务交接提示词

> **用途**:新会话从干净 context 接手此任务时,**直接喂这份提示词**,不需要再读前序对话历史。
>
> **创建时间**:2026-05-25,前序探路完成,POC 已验证 pdfjs-dist 4.x 官方 PDFViewer 可缓解 trackpad pinch 闪烁问题。
>
> **使用方式**:在新会话开头说"读 docs/refactor/pdf-viewer-adapter-prompt.md 执行",会话会自包含。

---

你正在 KRIG-Note V2 工作目录(`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`)做一个 PDF View 模块的全量重构。这是从前一个会话延续的任务,但前面的上下文太长了,所以我们重启会话。请严格按下面的范围执行,不要扩散。

## 背景一句话

V2 现有 PDF view 实现是手写的 viewer(基于 pdfjs-dist 4.x 的底层 API 自己拼装),存在 trackpad pinch 缩放闪烁、RenderTask 没正确 cancel、TextLayer 每次 scale 重建、cMap/字体/安全配置全 0、Worker 实例化方式过时等多个问题。要**全量重构**,直接继承 pdfjs-dist 4.x 提供的高层组件(PDFViewer/PDFPageView/EventBus 等),在 KRIG 内做语义化 adapter 封装,不重复造轮子。

## 必读 — 关键决策(用户已拍板,不要再问)

1. **走全量重构,不走补丁**。不要去修 `src/capabilities/ebook-rendering/pdf/index.ts` 那 412 行的局部 bug。
2. **新 capability 名 `pdf-viewer`**,目录 `src/capabilities/pdf-viewer/`,与现有 `ebook-rendering` 平级。
3. **adapter 模式**:对 view 暴露语义化 API + React 组件,不暴露 PDFDocumentProxy / PageViewport / RenderTask 等 pdfjs 类型。理由:pdfjs 4.x 早晚要升 5.x,届时只改 adapter 内部。
4. **AnnotationMode: LINKS_ONLY** — PDF 内超链接保留(学术 PDF reference 可点),其他不渲染。KRIG 不用 PDF 自带的标注编辑器(AnnotationEditorLayer),那跟 KRIG block 注释体系冲突。
5. **本次重构不改 Paged 全屏模式**(`src/capabilities/ebook-rendering/fullscreen/FullscreenPageView.tsx` 644 行)。Stage 4 临时保留 `pdf/index.ts` 的 `renderPage` 给 paged 用,源码加注释 `// TODO Phase D — paged 走 PDFViewer ScrollMode.PAGE 重写`。
6. **不引入新 npm 依赖**。pdfjs-dist 锁在 `^4.9.155`,见 memory `feedback_sdk_version_binding_policy`。
7. **PDFFindController 暂不切**。adapter 内保留 `searchText(query) → Result[]` 走 getTextContent 路径(同现有实现)。本 PR 不动 view 端 search-bar。
8. **每个 stage 单独 commit**。不合 main,直到全部 stage 完成 + 用户逐项验证 + 用户显式说"merge"。
9. **不要 push 到 origin**。

## 分支策略

- 当前应在 main 分支(干净工作树),如果不在请先 checkout main
- 新开 `feature/pdf-viewer-adapter` from main
- 探路分支 `explore/pdfjs-viewer-spike` 已存在(commit `a006e19b`),**不要动它也不要参考它的代码**(那是早期验证,有偏离),只作为"已验证 PDFViewer 能跑通"的存在证明
- 历史另有 `feature/pdf-zoom-anchor` 分支(2 commit),**也不要动**,是手写补丁路线被废弃

## 工作目录(关键 — 不要漂)

- 工作目录:`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
- **V1 目录 `/Users/wenwu/Documents/VPN-Server/KRIG-Note` 不要碰**。V1 仅作代码参考,任何 cwd 敏感命令(git/npm/find/rm)每次 Bash 调用必须 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`。Read 工具一律传绝对路径。这是项目级硬约束,已 7 次漂移事故,见 memory `feedback_v2_cwd_drift_again`。

## 必读文件(按顺序)

1. `CLAUDE.md` — 项目规范(分支策略 + 提交规范)
2. `src/capabilities/ebook-rendering/pdf/index.ts` — 现有手写 renderer (412 行),理解要替代什么
3. `src/capabilities/ebook-rendering/Host.tsx` — PDF 在 ebook capability 内的承载方式
4. `src/capabilities/ebook-rendering/fixed-page-content/index.tsx` — 现有手写 viewer (376 行),Stage 4 删除
5. `src/views/ebook/EBookView.tsx` 第 100–500 行 — view 端怎么用 Host 命令式接口
6. `node_modules/pdfjs-dist/web/pdf_viewer.mjs` — 官方 viewer 实现(看 `class PDFViewer` 构造参数 + `updateScale` 行为参考,**不要试图通读 8000 行**)
7. `node_modules/pdfjs-dist/types/web/pdf_viewer.d.ts` — 标准 API 类型签名

## 重构目标分层(必须遵守)

```
┌── view 层 (src/views/ebook/) ──────────────────────────────┐
│ EBookView.tsx 只调 adapter 暴露的 React 组件 + 命令         │
│ 不感知 pdfjs                                                │
└────────────────────────────────────────────────────────────┘
                  ↓
┌── adapter 层 (src/capabilities/pdf-viewer/) ─新 capability ─┐
│                                                            │
│ React 组件(暴露给 view):                                  │
│  <PDFViewerCanvas                                          │
│    doc, initialPage, initialScale, fitMode,                │
│    onPageChange, onScaleChange,                            │
│    onTextLayerReady(pageNum, textLayerDiv),  ← 选区/词高亮 │
│    onPageMounted(pageNum, pageDiv),          ← 标注挂载    │
│    onLinkClick(dest, type),                  ← 拦截        │
│    onTextSelected(rect, text, pageNum)                     │
│  />                                                        │
│                                                            │
│ 命令式 API:                                                │
│  loadDocument(data): Promise<DocumentHandle>               │
│  destroyDocument(handle)                                   │
│  getOutline(handle): TOCItem[]                             │
│  getPageLabels(handle): string[]                           │
│  capturePageRect(handle, page, rect): Promise<dataUrl>     │
│  searchText(handle, query): Result[]                       │
│  hasTextContent(handle, page): Promise<boolean>            │
│                                                            │
│ 对外类型全中性 — opaque DocumentHandle / 中性 TOCItem 等    │
│ 不暴露 PDFDocumentProxy / PageViewport / RenderTask         │
└────────────────────────────────────────────────────────────┘
                  ↓ 唯一 import pdfjs-dist
┌── pdfjs-dist 4.x ────────────────────────────────────────┐
│ PDFViewer + PDFPageView + EventBus +                     │
│ PDFLinkService + PDFRenderingQueue + GenericL10n +       │
│ TextLayerBuilder + AnnotationLayerBuilder (LINKS_ONLY)   │
└──────────────────────────────────────────────────────────┘
```

## 五阶段计划(每阶段一个 commit)

### Stage 1 — adapter 骨架 + getDocument 全配置 + Worker 4.x 风格

新增:
- `src/capabilities/pdf-viewer/index.ts` — capability 入口,registerPdfViewerCapability
- `src/capabilities/pdf-viewer/types.ts` — DocumentHandle / TOCItem / SearchResult 等中性类型
- `src/capabilities/pdf-viewer/loader.ts` — loadDocument / destroyDocument
- `src/capabilities/pdf-viewer/worker-setup.ts` — Worker 初始化(4.x `workerPort` 风格,**不是** `workerSrc = string`)

`loadDocument` 必传配置(全部本地,绝不走 CDN):
- `cMapUrl` + `cMapPacked: true` — 指向 `node_modules/pdfjs-dist/cmaps/`(Electron 用 file:// 或 app.asar 路径)
- `standardFontDataUrl` — 指向 `node_modules/pdfjs-dist/standard_fonts/`
- `isEvalSupported: false` — 安全
- `enableHWA: true` — 4.x 硬件加速
- `maxCanvasPixels: -1` 或更大值(默认 32MP 太小)

Worker 配置:
```ts
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
const workerInstance = new PdfWorker();
pdfjsLib.GlobalWorkerOptions.workerPort = workerInstance;
```
(确认 Vite `?worker` 后缀语法在 Electron renderer 工作;如果不行 fallback 到 `new URL(..., import.meta.url)` 但走 `workerPort` 而非 `workerSrc`)

**Stage 1 验收**:
- 加载 PDF 不报错
- DevTools Console 无 "fake worker" 警告
- typecheck + lint 全清
- 暂无 UI(下个 stage 接 viewer)

### Stage 2 — PDFViewer 集成 + 标准 services 套装

新增:
- `src/capabilities/pdf-viewer/services.ts` — EventBus / PDFLinkService / PDFRenderingQueue / GenericL10n 初始化工厂
- `src/capabilities/pdf-viewer/PDFViewerCanvas.tsx` — React 组件,严格按官方 DOM:
  ```tsx
  <div ref={containerRef} className="pdfViewerContainer" tabIndex={0}>
    <div ref={viewerRef} className="pdfViewer" />
  </div>
  ```
- `src/capabilities/pdf-viewer/styles.css` — 选择性引入 `pdfjs-dist/web/pdf_viewer.css` 必须部分

PDFViewer 配置:
- `annotationMode: AnnotationMode.ENABLE` 但 `annotationEditorMode: AnnotationEditorType.NONE` — 让 LinkService 接管 link,不让 editor 介入
- `removePageBorders: false` — 保留页边距
- `textLayerMode: TextLayerMode.ENABLE`

事件桥接(eventBus.on):
- `pagesinit` — 设 initialScale
- `pagesloaded` — 设 initialPage(此时所有 pdfPage 就绪)
- `pagechanging` → props.onPageChange
- `scalechanging` → props.onScaleChange
- `textlayerrendered` → props.onTextLayerReady(pageNum, textLayerDiv 从 viewer.getPageView(idx).textLayer.div 拿)
- LinkService 内 dispatch link click → props.onLinkClick

缩放走官方 `updateScale({ drawingDelay: 2000, scaleFactor, origin: [x,y] })`,不要再自己写 wheel handler 的缩放公式。但 wheel handler 仍要监听 — 因为 PDFViewer 默认不接 Cmd+wheel(它的 wheel 是 scroll),我们 preventDefault + 调 updateScale。

**Stage 2 验收**:
- PDF 加载后能滚动浏览
- trackpad pinch 缩放鼠标位置锚定 + 不闪
- Cmd+= / Cmd+- / Cmd+0 工作
- outline 跳转工作(PDFLinkService.goToDestination)
- 控制台无报错

### Stage 3 — Layer 适配(KRIG 自定义层接入)

挂载点:`PDFViewerCanvas` 内监听 `pagerender` / `annotationlayerrendered` 事件 → 通过 props 暴露:
- `onPageMounted(pageNum, pageDiv)` — 页面 div 就绪,KRIG 矩形标注层挂这里
- `onTextLayerReady(pageNum, textLayerDiv)` — textLayer 就绪,KRIG 选区 picker / vocab-highlight 入口

改:
- `src/capabilities/ebook-rendering/fixed-page-content/annotation-layer.tsx` (319 行) — **保留组件思路**,改成接受 pageDiv 作 ref 挂载点而非自己创建 wrapper
- `src/capabilities/ebook-rendering/hooks/use-pdf-text-selection.ts` (133 行) — 改写监听 PDFViewer eventBus 的 `textlayerrendered`,而非自家 ref map
- `src/views/ebook/pdf-vocab-highlight/index.ts` (460 行) — 入口改成 `onTextLayerReady` 回调,内部扫描逻辑不动

**Stage 3 验收**:
- C5 矩形标注创建 / 显示 / flash 工作
- textLayer 选区 picker 弹出工作
- PDF vocab-highlight 显示工作
- 翻页时 layer 跟随 page lifecycle 正确挂载/销毁

### Stage 4 — 替换 Host 调用方 + 删旧 renderer

改:
- `src/capabilities/ebook-rendering/Host.tsx` — PDF scroll 分支删 `FixedPageContent`,改 `<PDFViewerCanvas>` (从 pdf-viewer capability import)
- `src/capabilities/ebook-rendering/pdf/index.ts` — 删 `renderPage / renderTextLayer / processQueue / activeTask / textLayers / rendered` 等渲染逻辑,只保留:
  - `load / destroy` (供 paged 全屏临时复用)
  - `getDocument` (临时给 PDFViewerCanvas 拿 doc — 实际应该 adapter 自管,但 paged 全屏暂保留双轨)
  - `getTOC / hasTextContent / capturePageRect / searchText` — 这些元数据 API 留着,**或迁到 adapter**(看耦合度决定)
  - **加注释**:文件头加 `// TODO Phase D — paged 全屏切 PDFViewer 后,renderPage 删除`
- 删 `src/capabilities/ebook-rendering/fixed-page-content/index.tsx` (376 行)

不要动:
- `FullscreenPageView.tsx` (paged 全屏,Phase D)
- `EBookView.tsx`(view 端命令式接口语义不变)

**Stage 4 验收**:
- PDF 滚动模式完整工作(加载/翻页/缩放/标注/搜索/outline)
- PDF paged 全屏模式仍工作(走临时双轨)
- typecheck + lint 全清

### Stage 5 — 全局验收 + 测试清单

写一个 `docs/refactor/pdf-viewer-adapter-test-checklist.md` 给用户跑,含:
- 加载 / 翻页 / 滚动
- trackpad pinch 缩放体验
- Cmd+= / Cmd+- / Cmd+0
- outline 跳转
- 文字选区 + picker 弹出
- vocab-highlight 显示
- 矩形标注创建 / 显示 / flash
- PDF 内超链接点击(LinkService 拦截)
- 中日韩 PDF 字符显示(cMap 验证)
- DevTools Console 无错 + 无 fakeworker 警告
- 大 PDF (50MB+) 加载不卡死主线程
- paged 全屏模式翻页(双轨)

每一项写"操作步骤 + 期望结果",参考 memory `feedback_implementation_test_checklist`。

## 文档要求

Stage 1 开始前,写 `docs/refactor/pdf-viewer-adapter-plan.md`,内容:
- 重构动机(一段)
- 5 个 stage 的目标 + 验收(从本提示词复制)
- adapter 暴露 API 完整 TypeScript 签名
- 类型映射:pdfjs 类型 → KRIG 中性类型对照表
- Phase D 留洞:paged 全屏后续处理

每完成一个 stage,在该文档加 "Stage N 完成 — commit hash" 标记。

## 编码风格

- 不写无 WHY 的注释(WHAT 由命名表达)
- 不加 fallback / 兜底 / try-catch 掩盖未诊断根因 — 见 memory `feedback_no_fallback_bandaid_fixes`
- 不引入 feature flag / 向后兼容 shim — 直接切换
- 不写 ".md" 文档除非任务明确要求(`pdf-viewer-adapter-plan.md` 是任务要求的)
- 中文注释保留(项目惯例)

## 操作纪律

1. 开干前先写 plan 文档,跟用户确认 stage 边界
2. 每个 stage 完成做一次 commit,提交信息按项目规范 `feat(pdf-viewer): Stage N — XXX`
3. 每 commit 后跑一次 `npm run typecheck && npx eslint ...changed files...`,有错先修再下一 stage
4. Stage 完成后给用户一个简短报告:
   - 改了哪些文件(列表)
   - 验收期望(2-3 句操作 → 期望)
   - 等用户验证,**用户说 OK 才进下一 stage**
5. 5 个 stage 全做完 + 测试清单跑完 + 用户显式说"merge"才合 main

## 第一步该做什么

1. `cd` 到 V2 目录,确认在 main 分支 + 工作树干净
2. checkout 到新分支 `feature/pdf-viewer-adapter`
3. 创建 `docs/refactor/pdf-viewer-adapter-plan.md`,把上面 5 个 stage 的目标 + adapter API 签名草稿落下来
4. 跟用户确认 plan 文档,**特别确认 adapter API 形状**(可能需要调整命名/字段)
5. 用户确认 plan 后,开 Stage 1

不要一次性写完所有 stage 再来报告 — 那样 context 会再次爆炸,而且发现问题难回退。每 stage 单独完成 + 报告 + 等确认。
