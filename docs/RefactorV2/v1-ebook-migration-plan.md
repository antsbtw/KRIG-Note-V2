# V1 → V2 eBook 迁移设计

> v0.2 · 2026-05-09 · 草稿(用户 v0.1 审计 P1/P2 修正)
>
> 配套文档:
> - 业务设计:[../10-business-design/ebook/EBookView-设计.md](../10-business-design/ebook/EBookView-设计.md)(权威业务规格,1107 行)
> - V2 总纲:[../00-architecture/charter.md](../00-architecture/charter.md) v0.4
> - V2 视图层级:[./view-hierarchy-v2.md](./view-hierarchy-v2.md) v1.1
> - 严格态边界:[./audit/2026-05-08-closure-report.md](./audit/2026-05-08-closure-report.md)
> - 当前进度:[./v2-state-snapshot.md](./v2-state-snapshot.md)
>
> 同位参考:
> - [./v1-note-migration-audit.md](./v1-note-migration-audit.md)(NoteView 迁移审计)
> - [./v1-block-migration-checklist.md](./v1-block-migration-checklist.md)
>
> **本文件用途**:把 V1 ebook 模块(`src/plugins/ebook/` + `src/main/ebook/`,合计 ~5300 行)按 V2 三大原则拆解、重组、分阶段落地。**不是规格文档**——业务规格以 EBookView-设计.md 为准;本文件给的是**拆分映射 + 阶段切片 + 决策清单**。

---

## 0. 一句话定位

把 V1 单体 plugin(view + render-engine + main store + ipc + navside panel 全在 `src/plugins/ebook/` 下)拆成 V2 的「**视图声明 + 能力封装 + 平台 IPC**」三层归属,沿用 V1 已稳定的业务实现,改外层契约,内部逻辑零改动 — 对齐 charter § 6.5 的「业务代码搬迁原则」。

---

## 1. V1 实现盘点

### 1.1 V1 文件清单与 LOC

| 区段 | 路径 | LOC | 性质 |
|---|---|---:|---|
| **plugin renderer** | `src/plugins/ebook/renderer.tsx` | 15 | view 入口 |
| | `src/plugins/ebook/types.ts` | 215 | 渲染引擎接口体系 |
| | `src/plugins/ebook/view-api.d.ts` | 41 | preload 类型声明 |
| | `src/plugins/ebook/ebook.css` | 590 | 样式 |
| **renderers**(投影实现) | `renderers/index.ts` + `renderers/pdf/index.ts` + `renderers/epub/{index,foliate-js.d}.ts` | 28+298+365+20 | pdfjs-dist + foliate-js 封装 |
| **components**(view 组件) | `EBookView.tsx` | 476 | view 主组件(被动加载 + 锚定同步) |
| | `EBookToolbar.tsx` | 305 | toolbar 内容 |
| | `FixedPageContent.tsx` | 317 | PDF 虚拟滚动 + 标注层 |
| | `ReflowableContent.tsx` | 50 | EPUB iframe 注入 |
| | `OutlinePanel.tsx` | 99 | 侧栏 TOC |
| | `SearchBar.tsx` | 72 | 搜索栏 |
| | `AnnotationLayer.tsx` | 203 | PDF 空间标注覆盖层 |
| **hooks** | `useBookmarks.ts / useSearch.ts / useEpubAnnotation.ts` | 61+87+95 | 业务 hooks |
| **navside panel** | `EBookPanel.tsx / useEBookOperations.ts / useEBookSync.ts / ImportModal.tsx / register.ts` | 127+381+66+136+9 | NavSide 书架 |
| **plugin main 注册** | `main/register.ts / main/ipc-handlers.ts` | 93+162 | WorkMode + NavSide + Protocol + Menu + 全部 IPC |
| **main store** | `src/main/ebook/{bookshelf-store, bookshelf-surreal-store, annotation-store, annotation-surreal-store, file-loader}.ts` | 321+389+98+103+44 | 书架 + 标注 + 文件加载 |
| **合计** | | **~5300 行** | |

### 1.2 V1 的"一锅端"问题(charter § 1.4 视角)

| V1 实际形态 | charter 期望形态 |
|---|---|
| `EBookView.tsx` 476 行,直接 `import 'pdfjs-dist'` 经 `renderers/pdf/index.ts` 链路 | view 应 ≤100 行,**不直 import** 业务 npm |
| 渲染引擎、Toolbar、AnnotationLayer、OutlinePanel、SearchBar 全在 view 目录 | 渲染引擎归 capability;Toolbar / AnnotationLayer 等能力 UI 归 capability;view 仅做组合声明 |
| navside panel 定义 + 框架 register 同 plugin 内 | navside 内容由 view 通过 `navSideRegistry.register` 注册 |
| `main/ipc-handlers.ts` 同时管 plugin 注册 + IPC + 文件加载 | 平台 IPC 入口归 `src/platform/main/`,view-side API 通过 `requireCapabilityApi` 间接拿 |
| Annotation / Bookmark 直接走 SurrealDB store | 持久化能力封装,view 不直触 storage(audit § R5)|

V2 需要把这一锅端的 5300 行**拆到三个归属**:

```
                                      V2 三层归属
                                      
src/views/ebook/                      ← view(声明 + 注册,目标 ≤100 行)
   index.ts                           registerView + 注册 navside / toolbar / context-menu / commands
   EBookView.tsx                      薄主组件:订阅 per-ws state + 调能力 Host + Toolbar 编排
   data-model.ts                      pluginStates 形状 / getter / setter
   nav-side-content.tsx               书架面板组件(可独立成 ebook/bookshelf-panel/)
   bookshelf-commands.ts              ebook.* / bookshelf.* commands
   ebook.css                          薄壳样式(大头去 capability)
   
src/capabilities/                     ← 能力(封装 npm + 状态 + UI)
   ebook-rendering/                   PDF + EPUB 渲染主能力(IBookRenderer 体系迁入)
      Host.tsx                        forwardRef 主组件,view 通过 ref 命令式调用
      pdf/                            pdfjs-dist 封装(原 renderers/pdf/)
      epub/                           foliate-js 封装(原 renderers/epub/)
      fixed-page-content/             虚拟滚动 + Canvas 渲染
      reflowable-content/             iframe 注入 + ResizeObserver
      annotation-layer/               PDF 空间标注 UI
      outline-panel/                  侧栏 TOC
      search-bar/                     Cmd+F 搜索栏
      types.ts                        IBookRenderer 体系 + 类型守卫
      index.ts                        capabilityRegistry.register({ id: 'ebook-rendering', api })
   ebook-library/                     书架 + 文件夹 + 进度 + 书签 + 标注的统一对外 API
      index.ts                        capabilityRegistry.register({ id: 'ebook-library', api })
      types.ts                        EBookEntry / EBookFolder / Annotation / ReadingPosition
      bookshelf-client.ts             调 IPC 拿数据,缓存,onChanged 推流
   
src/platform/main/ebook/              ← 平台(主进程实现)
   bookshelf-store.ts                 V1 直迁(JSON / SurrealDB 双实现选 SurrealDB,见决策点 D-3)
   annotation-store.ts                V1 直迁
   file-loader.ts                     V1 直迁
   library-handlers.ts                IPC handler 集中(原 plugin/main/ipc-handlers.ts)
   index.ts                           initEBookPlatform()
```

---

## 2. V2 现状(L5B3.19.e 收尾后,2026-05-09)

### 2.1 已就位的 V2 基础设施(本迁移可直接消费)

| 设施 | 形态 | 用途 |
|---|---|---|
| `capabilityRegistry` | `src/slot/capability-registry/` | 注册 ebook-rendering / ebook-library |
| `requireCapabilityApi(id)` | `src/slot/capability-registry/get-capability-api.ts` | view 间接路由,W5 严格态强制 |
| `viewTypeRegistry / registerView` | `src/slot/view-type-registry/` | 声明 view 'ebook' + install 列表 |
| `navSideRegistry` | `src/slot/nav-side-registry/` | view 通过 `navSideRegistry.register({ view: 'ebook', title:'书架', actions, contentRenderer })` 注入 |
| `toolbarRegistry / contextMenuRegistry / floatingToolbarRegistry / handleRegistry` | `src/slot/interaction-registries/` | toolbar 与右键菜单内容注册 |
| `commandRegistry` | `src/slot/command-registry/` | ebook.* 命令字符串引用 |
| `keymapRegistry` | `src/slot/keymap-registry/` | Cmd+F / Cmd+D / Cmd+O / 翻页等 |
| `WorkspaceState.pluginStates: Record<string,unknown>` | `src/workspace/workspace-state/` | activeBookId / 阅读位置 / 展开文件夹 等业务字段挂这里(见决策 D-2)|
| `slotBinding.left/right` + `bus.slot.openRight()`(已在 web 翻译落地)| `src/workspace/` + `src/slot/workspace-bus/` | EBook ↔ Note 双栏锚定 / EBook ↔ Web 提取面板 |
| `mediaPutBase64 / mediaDownload` IPC | `src/shared/ipc/channel-names.ts` | 标注截图(thumbnail)如果走 media://(决策 D-7)|
| `shell.openExternal / openPath / showItemInFolder` IPC | 同上 | 重新定位 / 转为托管 等文件操作 |

### 2.2 V2 缺失、本迁移期间需要补建的前置

| 前置 | 性质 | 第一波切片 | 备注 |
|---|---|---|---|
| **electron `dialog.showOpenDialog` IPC**(选文件) | 平台 IPC 新增 | C1 前置 | V1 直接在 `ipc-handlers.ts` 内调,V2 应封装为 `platform.shell-dialog` 通用 IPC(可被 NoteView LinkPanel 文件 Tab、PDF 提取等复用) |
| **userData 文件读写工具**(`fs.readFile` Buffer → ArrayBuffer 给 renderer)| 平台辅助 | C1 前置 | 类似 V1 `file-loader.ts` 的 `loadEBook / getEBookData` 路径,V2 改为标准 IPC `ebook.get-data` |
| **WorkspaceState pluginStates['ebook'] 形状定义** | 框架 | C1 前置 | charter § "L3 业务字段全走 pluginStates",新建 `views/ebook/data-model.ts` 定义 + `default-state.ts` 默认值 |
| **eBook 持久化:JSON 还是 SurrealDB** | 决策点 D-3 | C1 前置 | V1 两套并存(`bookshelf-store.ts` JSON + `bookshelf-surreal-store.ts` SurrealDB),实际生效是后者;V2 选哪个见 § 4 |
| **NoteView ↔ EBookView 锚定同步协议** | 跨 view 通信 | C5 / 不阻塞 C1~C4 | V1 走 `sendToOtherSlot / onMessage` 自定义协议,V2 应走 `slot/workspace-bus/` 现有事件总线(L3.5 已落地) |
| **Annotation / Bookmark 是否进 Atom 体系** | 决策点 D-6 | 暂不阻塞 | EBookView 设计 v2 § 1.3 说"标注按 bookId 索引,JSON 文件";V2 charter 把 Atom 看作语义层最小单元,**EBook annotation 是否升格为 Atom** 尚未定 |
| **PDF 全书提取(WebView 变种 'extraction')** | 独立 epic | **不在本迁移范围** | PDFExtraction-设计.md 已规格,但需要 KRIG Knowledge Platform 后端就绪;留 ebook 主功能就绪后单独立项 |

---

## 3. 新归属切片 — 详细映射

### 3.1 view 层(`src/views/ebook/`)— LOC 约束(主组件薄壳,引擎留 capability)

view 必须遵守 charter § 1.4「能力组合声明 + 注册菜单 / 命令」,**0 处 import 业务 npm**(`pdfjs-dist` / `foliate-js` 通过 capability 间接消费)。

**LOC 约束**(charter § 1.4 软指标 + W5 audit closure § 5.4 基线对齐):

| 单位 | 红线 | 理由 |
|---|---|---|
| `EBookView.tsx`(view 主组件) | **≤ 150~200 行**(对齐 W4.2 后 WebView 192 / NoteView 111 / TranslateWebView 142) | 主组件是「订阅 + 命令路由 + Host 编排」薄壳;PDF/EPUB 引擎、AnnotationLayer、Outline、Search 全部留在 capability — 凡是涉及业务 npm / 渲染算法 / iframe 注入的代码超线 = 违反 § 1.4 |
| `views/ebook/` 目录总和 | **不设硬上限**——业务声明性代码(NavSide 书架 JSX、ImportModal、命令注册等)按需要展开,但**0 处业务 npm import**(eslint 拦)、**0 处 capability 运行时直 import** | NoteView 已是先例:`views/note/` 目录 25 个文件,但单文件如 `NoteView.tsx` 仍 ≤200 行 — 总和大不违规,主组件膨胀才违规 |

| V2 文件 | 来源 | 性质 |
|---|---|---|
| `index.ts` | new(对齐 `views/web/index.ts` 25 行模板) | `registerView({ id: 'ebook', install: ['ebook-rendering', 'ebook-library'], component: EBookView, navSideTab })` + 注册 commands / context-menu / toolbar / keymap |
| `EBookView.tsx` | V1 `EBookView.tsx` 476 行瘦身 → ~150 行(**主组件薄壳红线**) | 订阅 pluginStates(activeBookId / readingPosition / sidebarOpen / annotationMode / slotLocked)+ 命令式调 `EBookHost`(从 `ebook-rendering` capability 拿)+ 编排 toolbar handlers |
| `data-model.ts` | new | `EBookWsState` 形状 + `getEBookWsState(ws) / setActiveBookId / setReadingPosition / setExpandedFolders / setSidebarOpen / setSlotLock / setAnnotationMode` 等 setter |
| `nav-side-content.tsx` | V1 `EBookPanel.tsx + useEBookOperations.ts + useEBookSync.ts + ImportModal.tsx` 共 710 行迁入 → ~600 行(JSX/hooks 直迁) | 书架面板 + 文件夹树 + 拖拽 + 右键 + ImportModal;通过 `requireCapabilityApi('ebook-library')` 拿 client。**不计入主组件薄壳红线** —— 业务声明性 UI(参考 `views/note/nav-side-content.tsx`)|
| `bookshelf-commands.ts` | new | `ebook.import / ebook.create-folder / ebook.open / ebook.rename / ebook.remove / ebook.move-to-folder / ebook.relocate / ebook.transfer-to-managed` 等命令注册 |
| `ebook.css` | V1 `ebook.css` 590 行**只留 view 壳**(toolbar bar / NavSide panel / ImportModal),其余 PDF / EPUB / annotation / outline 样式迁到 capability | 拆分 |

view 主体核心模式(对齐 `WebView.tsx`):

```ts
// EBookView.tsx 主结构(伪代码,~150 行目标)
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { EBookRenderingApi, EBookHostHandle } from '@capabilities/ebook-rendering/types';
import type { EBookLibraryApi } from '@capabilities/ebook-library/types';

export function EBookView({ workspaceId }: ViewComponentProps) {
  const Host = useMemo(() => requireCapabilityApi<EBookRenderingApi>('ebook-rendering').Host, []);
  const library = useMemo(() => requireCapabilityApi<EBookLibraryApi>('ebook-library'), []);
  const hostRef = useRef<EBookHostHandle | null>(null);

  const wsState = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => getEBookWsState(workspaceManager.get(workspaceId)),
  );

  // 启动恢复 + 监听 onBookOpened 推流
  useEffect(() => {
    if (wsState?.activeBookId) hostRef.current?.openBookId(wsState.activeBookId);
    return library.onBookOpened((info) => hostRef.current?.openBookEntry(info));
  }, [workspaceId]);

  // toolbar / cmd 路由经 hostRef + library API
  // ... handlers ...

  return (
    <div className="krig-ebook-view">
      <EBookToolbar {...toolbarProps} />        {/* toolbar 仍在 view 内,charter § 1.4 toolbar 内容来自 view */}
      <Host
        ref={hostRef}
        workspaceId={workspaceId}
        onPositionChange={...}     /* 推流到 wsState */
        onAnnotationCreate={...}   /* 走 library.createAnnotation */
      />
    </div>
  );
}
```

### 3.2 ebook-rendering capability(`src/capabilities/ebook-rendering/`)— 业务 npm 屏障核心

**职责**:封装 `pdfjs-dist` + `foliate-js` 的整个生命周期,以 `<Host ref={hostRef} />` 单一面孔暴露给 view。view 只通过 ref 命令式 + props 回调通信。

**对外 API 形状**(`capabilities/ebook-rendering/index.ts` 注册):

```ts
capabilityRegistry.register({
  id: 'ebook-rendering',
  api: {
    Host,                          // forwardRef<EBookHostHandle, EBookHostProps>
    isFixedPage, isReflowable,     // 类型守卫(view 不消费,留作内部 + capability 内复用)
    detectFileType, getRenderMode, // 工具函数
  },
});

export type EBookHostHandle = {
  openBookEntry(info: EBookLoadedInfo): Promise<void>;
  openBookId(id: string): Promise<void>;     // 走 library 拿 entry → 走 main 拿 ArrayBuffer
  goToPage(page: number): void;
  goToCFI(cfi: string): void;
  setScale(scale: number): void;
  setFitWidth(on: boolean): void;
  setAnnotationMode(mode: 'off' | 'rect' | 'underline'): void;
  toggleSidebar(): void;
  openSearch(): void;
  getCurrentPosition(): BookPosition;
};

export type EBookHostProps = {
  workspaceId: string;
  // 状态推送
  onPositionChange?: (pos: BookPosition) => void;
  onTotalPagesChange?: (n: number) => void;
  onScaleChange?: (s: number) => void;
  onAnnotationCreate?: (ann: Annotation) => void;
  onTextSelected?: (info: TextSelectionInfo) => void;
  onTOCReady?: (toc: TOCItem[]) => void;
};
```

**内部目录**(子能力打平,对照 V1 components/hooks):

```
src/capabilities/ebook-rendering/
├── index.ts                       注册 + api 导出
├── types.ts                       IBookRenderer / IFixedPageRenderer / IReflowableRenderer / 守卫(V1 types.ts 直迁)
├── Host.tsx                       forwardRef 主组件,被动加载 + renderMode 分发(V1 EBookView.tsx 渲染部分迁入)
├── pdf/
│   └── index.ts                   pdfjs-dist 封装(V1 renderers/pdf/index.ts 直迁,依赖锁 4.9.155)
├── epub/
│   ├── index.ts                   foliate-js 封装(V1 renderers/epub/index.ts 直迁)
│   └── foliate-js.d.ts
├── fixed-page-content/
│   └── index.tsx                  虚拟滚动 + Canvas 渲染 + 标注覆盖层(V1 FixedPageContent + AnnotationLayer 合并)
├── reflowable-content/
│   └── index.tsx                  iframe 注入 + ResizeObserver(V1 ReflowableContent)
├── outline-panel/
│   └── index.tsx                  TOC 侧栏(V1 OutlinePanel)
├── search-bar/
│   └── index.tsx                  Cmd+F UI(V1 SearchBar)
├── hooks/
│   ├── use-search.ts              V1 hooks/useSearch.ts 直迁
│   ├── use-bookmarks.ts           V1 hooks/useBookmarks.ts 直迁(改 IPC 走 library API)
│   └── use-epub-annotation.ts     V1 hooks/useEpubAnnotation.ts 直迁
├── styles.css                     原 V1 ebook.css 中渲染相关样式迁入
└── DESIGN.md                      capability 设计文档(必备,对齐 web-rendering / ytdlp)
```

**npm 依赖屏障落地**:
- `pdfjs-dist@4.9.155` 仅 `pdf/index.ts` import
- `foliate-js` 仅 `epub/index.ts` import
- view / driver / slot / shell / workspace **0 处** 见到这两个 npm 包(eslint 已锁,见 charter § 2.3)

### 3.3 ebook-library capability(`src/capabilities/ebook-library/`)— 数据 + IPC 中介

**职责**:把 main 进程的书架/文件夹/标注/书签的 IPC 操作封装成 renderer 端 API。view + capability 都通过它读写,**不直触 storage**(audit § R5)。

```
src/capabilities/ebook-library/
├── index.ts                       注册 + api 导出
├── types.ts                       EBookEntry / EBookFolder / Annotation / ReadingPosition / EBookLoadedInfo(V1 main/ebook/bookshelf-store.ts 类型迁入)
├── client.ts                      IPC 调用封装 + onChanged 订阅 + 内存缓存
└── DESIGN.md
```

**对外 API**:

```ts
export type EBookLibraryApi = {
  // 书架
  list(): Promise<EBookEntry[]>;
  get(id: string): Promise<EBookEntry | null>;
  pickFile(): Promise<{ filePath: string; fileName: string; fileType: EBookFileType } | null>;
  add(filePath: string, fileType: EBookFileType, storage: 'managed' | 'link'): Promise<EBookEntry>;
  open(id: string): Promise<{ success: boolean; error?: string }>;
  rename(id: string, displayName: string): Promise<void>;
  remove(id: string): Promise<void>;
  moveToFolder(id: string, folderId: string | null): Promise<void>;
  relocate(id: string): Promise<void>;
  transferToManaged(id: string): Promise<void>;
  // 文件夹
  folderList(): Promise<EBookFolder[]>;
  folderCreate(title: string, parentId?: string | null): Promise<EBookFolder>;
  folderRename(id: string, title: string): Promise<void>;
  folderDelete(id: string): Promise<void>;
  folderMove(id: string, parentId: string | null): Promise<void>;
  // 数据传输
  getData(): Promise<{ filePath: string; fileName: string; data: ArrayBuffer } | null>;
  // 进度
  saveProgress(bookId: string, position: ReadingPosition): Promise<void>;
  // 书签 + CFI 书签
  bookmarkToggle(bookId: string, page: number): Promise<number[]>;
  bookmarkList(bookId: string): Promise<number[]>;
  cfiBookmarkAdd(bookId: string, cfi: string, label: string): Promise<Array<{ cfi: string; label: string }>>;
  cfiBookmarkRemove(bookId: string, cfi: string): Promise<Array<{ cfi: string; label: string }>>;
  cfiBookmarkList(bookId: string): Promise<Array<{ cfi: string; label: string }>>;
  // 标注
  annotationList(bookId: string): Promise<Annotation[]>;
  annotationAdd(bookId: string, ann: Annotation): Promise<Annotation>;
  annotationRemove(bookId: string, annotationId: string): Promise<void>;
  // 推送
  onBookshelfChanged(cb: (list: EBookEntry[]) => void): () => void;
  onBookOpened(cb: (info: EBookLoadedInfo) => void): () => void;
};
```

### 3.4 platform 层(`src/platform/main/ebook/`)— 主进程实现

| V2 文件 | 来源 | 备注 |
|---|---|---|
| `bookshelf-store.ts` | V1 `src/main/ebook/bookshelf-surreal-store.ts` 直迁(389 行) | 决策点 D-3 选 SurrealDB → 直迁 |
| `annotation-store.ts` | V1 `src/main/ebook/annotation-surreal-store.ts` 直迁(103 行) | 同上 |
| `file-loader.ts` | V1 `src/main/ebook/file-loader.ts` 直迁(44 行) | `loadEBook / getEBookData / closeEBook`,广播改走 V2 channel-names |
| `library-handlers.ts` | V1 `plugins/ebook/main/ipc-handlers.ts` 直迁(162 行) | 改 IPC channel 命名(详见 § 5)+ 广播走 `getMainWindow().webContents` |
| `index.ts` | new | `initEBookPlatform({ getMainWindow })` 入口,在 `platform/main/index.ts` ipc-bus 阶段调 |

### 3.5 IPC channel 新增清单(加入 `src/shared/ipc/channel-names.ts`)

V1 用枚举 `IPC.EBOOK_*` 共 25 个,V2 命名规范是 `<层>.<动作>`(详见 channel-names.ts 注释):

```ts
// ── ebook 书架 + 文件夹 ──
EBOOK_BOOKSHELF_LIST: 'ebook.bookshelf-list',
EBOOK_PICK_FILE: 'ebook.pick-file',
EBOOK_BOOKSHELF_ADD: 'ebook.bookshelf-add',
EBOOK_BOOKSHELF_OPEN: 'ebook.bookshelf-open',
EBOOK_BOOKSHELF_REMOVE: 'ebook.bookshelf-remove',
EBOOK_BOOKSHELF_RENAME: 'ebook.bookshelf-rename',
EBOOK_BOOKSHELF_MOVE: 'ebook.bookshelf-move',
EBOOK_BOOKSHELF_RELOCATE: 'ebook.bookshelf-relocate',         // 决策 D-5
EBOOK_BOOKSHELF_TRANSFER: 'ebook.bookshelf-transfer-managed', // link → managed
EBOOK_BOOKSHELF_CHANGED: 'ebook.bookshelf-changed',           // main → renderer 推送
EBOOK_FOLDER_LIST: 'ebook.folder-list',
EBOOK_FOLDER_CREATE: 'ebook.folder-create',
EBOOK_FOLDER_RENAME: 'ebook.folder-rename',
EBOOK_FOLDER_DELETE: 'ebook.folder-delete',
EBOOK_FOLDER_MOVE: 'ebook.folder-move',

// ── ebook 数据传输 ──
EBOOK_GET_DATA: 'ebook.get-data',
EBOOK_LOADED: 'ebook.loaded',                                 // main → renderer 推送
EBOOK_CLOSE: 'ebook.close',
EBOOK_RESTORE: 'ebook.restore',                               // 决策 D-2:启动恢复入口

// ── ebook 进度 + 书签 + 标注 ──
EBOOK_SAVE_PROGRESS: 'ebook.save-progress',
EBOOK_BOOKMARK_TOGGLE: 'ebook.bookmark-toggle',
EBOOK_BOOKMARK_LIST: 'ebook.bookmark-list',
EBOOK_CFI_BOOKMARK_ADD: 'ebook.cfi-bookmark-add',
EBOOK_CFI_BOOKMARK_REMOVE: 'ebook.cfi-bookmark-remove',
EBOOK_CFI_BOOKMARK_LIST: 'ebook.cfi-bookmark-list',
EBOOK_ANNOTATION_LIST: 'ebook.annotation-list',
EBOOK_ANNOTATION_ADD: 'ebook.annotation-add',
EBOOK_ANNOTATION_REMOVE: 'ebook.annotation-remove',
```

V1 中 `EBOOK_SET_EXPANDED_FOLDERS / EBOOK_SET_ACTIVE_BOOK` 不再需要 IPC —— 走 V2 `pluginStates['ebook']`,renderer 直接 `workspaceManager.update()`(决策 D-2)。

### 3.6 preload 暴露形态

在 `src/platform/main/preload/main-window-preload.ts` 加一组方法:

```ts
ebookBookshelfList: () => ipcRenderer.invoke(IPC_CHANNELS.EBOOK_BOOKSHELF_LIST),
ebookPickFile: () => ipcRenderer.invoke(IPC_CHANNELS.EBOOK_PICK_FILE),
ebookBookshelfAdd: (filePath, fileType, storage) => ipcRenderer.invoke(IPC_CHANNELS.EBOOK_BOOKSHELF_ADD, filePath, fileType, storage),
// ... 全部 ebook.* invoke ...
onEbookBookshelfChanged: (cb) => { /* on + return off */ },
onEbookLoaded: (cb) => { /* on + return off */ },
```

view / capability 通过 `window.electronAPI.ebook*` 调用,**不再有 plugin 专属 preload**(V1 `src/main/preload/view.ts / navside.ts`)。

---

## 4. 关键决策清单(C1 起步前请用户拍板)

格式与 V2 既有 stage design 一致(每项给两条路径,A 是默认推荐):

| # | 决策点 | A(默认) | B(替代) | 影响范围 |
|---|---|---|---|---|
| **D-1** | view 命名 | `ebook`(对齐 EBookView 设计 v2 § 6.7 ViewType `'ebook'`)| `ebook-pdf`(charter § 1.4 命名表的"反映能力组合") | 文件路径 + registerView id + slotBinding 字面值 |
| **D-2** | activeBookId / readingPosition / sidebarOpen 等业务字段位置 | **走 `pluginStates['ebook']`**(charter 强制 + V2 已实施模板) — main 进程不再持有 | 沿用 V1 `WorkspaceState.activeBookId` 模式(main 持) | 需要新增 IPC vs 不需要;V2 已经在 web 视图证明走 pluginStates 行得通,选 A |
| **D-3** | bookshelf / annotation 持久化后端 | **SurrealDB**(V1 实际生效的实现 `bookshelf-surreal-store.ts` 直迁) | JSON 文件(V1 兜底实现,EBookView 设计 v2 § 1.3 写 "Phase 1 用 JSON,Phase 2 迁 SurrealDB") | V2 storage 层目前仅 README,选 A 等同把 SurrealDB 作为 storage 落地的第一个真用例(顺带补 storage 层框架,可单独切片) |
| **D-4** | 选 SurrealDB 后,storage 归位 | 直接放 `src/storage/ebook/`(对齐 charter directory-structure § 1) | **过渡态:先放 `src/platform/main/ebook/`,后续单独阶段迁 `src/storage/ebook/`**(跟 V1 同位,storage 层后置)| A 是字面合规;B 是 V1 同位、迁移阻力小,后续再剥离。**推荐 B,理由**:audit closure § 6.1 说"storage 反向依赖清零"刚刚 W5.3 收尾,storage 层目前是 README-only,把 SurrealDB 客户端单独立项更合规 — 故 ebook 阶段先放 platform,storage 改造另立 epic。**钉死的过渡约束**(回应 v0.1 审计 P1):<br>① **过渡性质**:`src/platform/main/ebook/` 内的 SurrealDB store 是**显式临时位置**,不是终态<br>② **退出条件**:本迁移 C5 段验收通过、ebook 主功能稳定运行 ≥ 2 周后,以独立 epic 启动迁移<br>③ **目标落点**:`src/storage/ebook/{bookshelf-store, annotation-store}.ts`,后续阶段编号待 charter v0.5 修订时分配(候选 **L5-C6 storage-relocate** 或 **W6 storage 层落地**),**届时同步 storage 层 SurrealDB 客户端基础设施**(目前 storage 仅 README) |
| **D-5** | 文件不存在时的"重新定位"流程 | **EBookView 设计 v2 § 1.5 路径**:打开时检测,失败 → 错误对话框 → 用户选重新定位 / 转托管 / 移除 | 不实现,文件丢失直接报错,用户手动从书架移除 | A 与 V1 现状一致(已实现);全量迁建议 A |
| **D-6** | Annotation 是否升格为语义层 Atom | **不升格**,annotation 仍是 ebook-library 内部模型,JSON-blob 持久化(对齐 EBookView 设计 v2 § 2.3 数据模型) | 升格:annotation → AtomType `'ebookAnnotation'`,进 `src/semantic/atom-types.ts`,可被 NoteView 引用 | A 不阻塞;B 是 KRIG 知识图谱方向(charter § 4.4 主轴关系),建议放 ebook 主功能后另立 epic |
| **D-7** | 标注 thumbnail 截图存哪 | **`base64 inline 在 annotation 记录里**(V1 现状),适合 ≤200KB 小区域 | 走 `mediaPutBase64` → `media://` URL,annotation 仅存 mediaId | V1 是 A;B 与 V2 既有 file-block / image-block 一致。建议 A — annotation 区域通常 <100KB,base64 无需引入 media-storage 依赖,且 annotation 删除时不需联动 media GC |
| **D-8** | Toolbar 「提取」按钮 | **不在本迁移**——按钮 + handleExtract 暂置灰 / 不渲染,等 PDFExtraction 后端 + WebView 'extraction' 变种就绪后单独阶段 | 放占位 button,点击 console.warn | 按 A 不引入半成品 |
| **D-9** | Slot 锚定同步(Note ↔ EBook 页码联动 + Slot 位置锁) | **本迁移内做**:用 `slot/workspace-bus/` 事件总线,不复用 V1 自定义 `sendToOtherSlot` 协议;锁 + role(primary/companion) 走 pluginStates | 留待 ebook 主功能稳定后单独阶段 | V1 锚定是 ebook 体验的核心(打开 PDF 双栏读 + Note 记笔记),A 让 ebook 一次到位;但 V2 NoteView 还没有发送端,可能需要 NoteView 侧补一段。**推荐 B**:本迁移先做单 view ebook,锚定单独阶段(对齐 v2-state-snapshot § 3.1 「ai-note-bridge / browser-capability 留后续」) |
| **D-10** | EPUB 渲染引擎 | **foliate-js**(V1 实际选择 + EBookView 设计 v2 § 10.1 推荐) | epub.js | A,V1 已实战 |
| **D-11** | 切片是否包含 全文搜索(Cmd+F)| **包含**,V1 useSearch 直迁开销低 | 砍出留后续 | A;V1 已稳定 |
| **D-12** | 切片是否包含 PDF 空间标注(矩形 / 横线 + OCR + 缩略图)| **保留 UI 框架,砍 OCR**(线框 / 横线创建 + 持久化 + 颜色,但 OCR 用占位 text:'',thumbnail 用空白)| 完整迁(含 OCR)| OCR 是平台耦合(macOS Vision / WinRT / Tesseract.js — EBookView 设计 v2 § 3.5),与本迁移正交。推荐 A:UI + 数据模型先到位,OCR 单独阶段(类似 ytdlp 单独 capability 化) |

---

## 5. 阶段切片(对齐 V2 命名规则 L5-C 段)

按 v2-state-snapshot § 3.1 把 ebook view 列在 "整 view(从无到有)" 大 epic,优先级 "中"。本节给出**5 个连续切片**,对齐 V2 的 stage 节奏(B3.19 的 5 段子切片是参考)。

工作流约定**沿用 B3.19 的"段间不单独验收,末段统一验收清单"**(v2-state-snapshot § 修订记录 2026-05-09 条)。

### C1 — 平台基座 + library capability + view 骨架(~600 行)

**目标**:打开 V2 切到 ebook view,能从 NavSide 导入 PDF / EPUB,书架显示。

| 项 | 内容 |
|---|---|
| platform/main/ebook/(全套) | bookshelf-store / annotation-store / file-loader / library-handlers / index.ts(直迁 V1 SurrealDB 实现 + 改 channel 名)|
| shared/ipc/channel-names | 加 `EBOOK_*` 25 条 |
| platform/main/preload | 加 ebook* invoke + on* 订阅 |
| capabilities/ebook-library/ | client.ts + types.ts + index.ts + DESIGN.md |
| views/ebook/ | index.ts + EBookView.tsx(空 view,挂"加载中" + "空状态")+ data-model.ts + nav-side-content.tsx(完整书架 UI 直迁,但点击书项暂不渲染内容)+ bookshelf-commands.ts |
| 验收 | npm start → 切 ebook view → NavSide 显「书架」+「+ 文件夹 / + 导入」→ 导入 PDF 见书架更新 → 点击书项左 slot 显「Loading」(C2 才填) |

### C2 — ebook-rendering capability + Host(PDF only)(~1200 行)

**目标**:打开 PDF,看到 Canvas 渲染,可翻页 / 缩放 / 适应宽度。

| 项 | 内容 |
|---|---|
| capabilities/ebook-rendering/ | types.ts(IBookRenderer 体系)+ pdf/index.ts(pdfjs-dist 4.9.155)+ fixed-page-content/(虚拟滚动)+ Host.tsx(被动加载 + dispatch render mode)+ index.ts 注册 + DESIGN.md + styles.css |
| views/ebook/EBookView.tsx | 接 Host ref,实现 toolbar 翻页 / 缩放 / 适应宽度 handlers + 启动恢复 |
| views/ebook/EBookToolbar.tsx | V1 `EBookToolbar.tsx` 305 行 → ~250 行(砍掉 sidebar / annotation 控件,留导航 + 缩放 + 文件名)|
| 验收 | 导入 PDF → 显内容 → 上一页 / 下一页 / 输入页码 / Cmd+= / Cmd+- 全 OK + 适应宽度切换 + 重启恢复上次页码 |

### C3 — EPUB 引擎 + Outline + Search(~900 行)

**目标**:支持 EPUB,左侧 Outline 面板,Cmd+F 搜索。

| 项 | 内容 |
|---|---|
| capabilities/ebook-rendering/epub/ | foliate-js 封装(V1 直迁 365 行)|
| capabilities/ebook-rendering/reflowable-content/ | iframe 注入 + onResize + onRelocate(V1 50 行)|
| capabilities/ebook-rendering/outline-panel/ | TOC 树(V1 99 行)|
| capabilities/ebook-rendering/search-bar/ | 搜索 UI(V1 72 行)+ hooks/use-search.ts(V1 87 行)|
| views/ebook/EBookToolbar.tsx | 加 sidebar toggle + 章节导航(EPUB)+ 字号控件(EPUB)|
| 验收 | 导入 EPUB → iframe 渲染 → 章节翻页 → 字号 +/-;PDF 侧栏 TOC 可展开跳转;Cmd+F 在 PDF / EPUB 都能搜索 + 高亮 |

### C4 — 书签 + EPUB 标注(基础)(~500 行)

**目标**:Cmd+D 加书签;EPUB 文本选择高亮。

| 项 | 内容 |
|---|---|
| capabilities/ebook-rendering/hooks/use-bookmarks.ts | V1 直迁(61 行),IPC 改走 library client |
| capabilities/ebook-rendering/hooks/use-epub-annotation.ts | V1 直迁(95 行)|
| capabilities/ebook-rendering/Host.tsx | 接两 hook + 颜色 picker UI |
| views/ebook/EBookToolbar.tsx | 加书签按钮(高亮态)|
| views/ebook/EBookView.tsx | 接管 mousedown 关 picker |
| 验收 | EPUB 选文字 → 5 色 picker → 创建高亮 → 重启保留;PDF Cmd+D 加书签,toolbar 显高亮态 |

### C5 — PDF 空间标注(无 OCR)+ 收尾验收(~700 行)

**目标**:PDF 矩形 / 横线标注,持久化,thumbnail = base64 截图。OCR 留空字符串(决策 D-12)。

| 项 | 内容 |
|---|---|
| capabilities/ebook-rendering/fixed-page-content/ | 增 AnnotationLayer.tsx(V1 203 行)+ rect/underline mode 鼠标交互 |
| capabilities/ebook-rendering/Host.tsx | 暴露 setAnnotationMode + onAnnotationCreate |
| views/ebook/EBookToolbar.tsx | 加标注模式 toggle(off/rect/underline)|
| views/ebook/EBookView.tsx | annotationMode 接 toolbar + 走 pluginStates |
| ebook 段落收尾验收清单 | 类似 B3.19 § 3 整体清单,涵盖 C1~C5 全部行为 |

### 段落总量预估

| 段 | 增量 LOC(估)| V1 来源占比 |
|---|---|---|
| C1 | ~600 (driver) + ~150 (CSS) | 直迁约 70%(SurrealDB store + ipc handlers + EBookPanel 全套)|
| C2 | ~1200 (driver) + ~300 (CSS) | 直迁约 80%(pdf renderer + FixedPageContent + Toolbar)|
| C3 | ~900 + 150 | 直迁约 85% |
| C4 | ~500 + 50 | 直迁约 80% |
| C5 | ~700 + 100 | 直迁约 75% |
| **合计** | **~3900 driver + ~750 CSS** | V1 ~5300 → V2 ~4650(view 极简 + capability 内部模块化代价 + CSS 拆分)|

---

## 6. 与 charter 三大原则的对照自检

### 6.1 注册原则

| 自检项 | 落地 |
|---|---|
| view 通过 `install` 列表声明依赖 | `install: ['ebook-rendering', 'ebook-library']` |
| 0 处 view 直 import capability 运行时值 | 类型 import 用 `import type ... from '@capabilities/ebook-rendering/types'`,运行时 Host 走 `requireCapabilityApi('ebook-rendering').Host`(对齐 W5 严格态)|
| 0 处 view 直 import driver | ebook 不引入 driver 层(本身没有 PM 文档,不像 NoteView 需要 driver)|
| 命令实现走 commandRegistry,菜单引字符串 | toolbar / context-menu / keymap items `command: 'ebook.next-page'` 等 |
| capabilityRegistry 自注册 | `capabilities/ebook-rendering/index.ts` 与 `capabilities/ebook-library/index.ts` 各 `capabilityRegistry.register({ id, api })` |
| install-coverage 自检 | 启动时 console 显示 `ebook view × ['ebook-rendering','ebook-library']`,无 missing |

### 6.2 分层原则(纵向 + 横向)

| 自检项 | 落地 |
|---|---|
| 可视化层 0 业务 npm | view 0 处 `import 'pdfjs-dist' / 'foliate-js' / 'electron'`(eslint 拦)|
| 能力层是 npm 唯一出入口 | 仅 `capabilities/ebook-rendering/pdf/` 与 `capabilities/ebook-rendering/epub/` 见到这两包 |
| 语义层 0 npm | 类型在 `capabilities/ebook-*/types.ts` 不在 semantic/(annotation 不升格 — 决策 D-6)|
| 存储层 IPC 提供 | 走 `platform/main/ebook/library-handlers.ts`,renderer 不直触 store(audit § R5)|
| view → view 0 直连 | NoteView ↔ EBookView 锚定走 workspace-bus(留 D-9 选 B 后再阶段做) |
| capability → slot 0 反向 | ebook-rendering / ebook-library 不 import `@slot/workspace-bus`(对齐 W3.3 修)|

### 6.3 抽象原则(npm 屏障)

| 外部 npm | 归属 | 屏障验证 |
|---|---|---|
| `pdfjs-dist` | capability.ebook-rendering | view / driver / shell / workspace / slot 0 import |
| `foliate-js` | capability.ebook-rendering | 同上 |
| `electron`(`dialog.showOpenDialog` / `app.getPath('userData')`)| platform/main + main-process IPC handler | renderer 通过 `window.electronAPI.ebook*` 调用 |
| `surrealdb`(D-3 选 A 时)| platform/main/ebook/(D-4 选 B)→ 长期归位 storage | renderer 0 import |

---

## 7. 与 V2 既有阶段的衔接

| 阶段 | 关系 |
|---|---|
| **L4.1 Help Panel Registry** | EBookView 暂不消费 help-panel(无 LaTeX / Mermaid / Math-Visual / Bookmarks 子面板需求) — 长期可考虑把"标注列表面板"做为 help-panel sub-panel,但属 ebook 主功能后的精修阶段 |
| **L5-B3.4 link-click plugin** | NoteView 内 `krig://book/{bookId}` 协议路由到 ebook view → 需要 link-click plugin 加 `krig://book` handler(沿用 `krig://note` 方式)— 留 D-9 锚定阶段一起 |
| **L5-B4 web view** | PDF 全书提取走 WebView 'extraction' 变种(EBookView 设计 v2 § 4.1 + PDFExtraction-设计 § 4.1)— 决策 D-8 标记不在本迁移 |
| **L5-B3.13 paste-media** | 不接 ebook(annotation thumbnail 走 base64,决策 D-7) |
| **L5-B3.20 learning** | 不接 ebook(EPUB 文本选择不接生词本,留 ebook 主功能稳定后再考虑接「按选区查词」)|

---

## 8. 风险登记

| 风险 | 缓解 |
|---|---|
| pdfjs-dist 4.9.155 版本锁(EBookView 设计 v2 § 5 #10)| package.json 锁定 + 在 ebook-rendering DESIGN.md 单独章节标注;升级前必须验 Electron 40+ 兼容 |
| foliate-js 类型定义不完整(V1 自己写了 `foliate-js.d.ts` 20 行) | 直迁 V1 d.ts;遇缺失类型补 |
| Host forwardRef 命令式 API 容易膨胀(view → ref 链多了变成"小 view")| 维持当前 § 3.2 的方法集小型,新增需走 capability DESIGN.md 评审(对齐 web-rendering Host 模式) |
| EPUB iframe partition 与 webview partition 是否冲突 | foliate-js 用 srcdoc,不走 webview partition 系统,无冲突 |
| EBookView 设计 v2 中"全局书架 vs Workspace 状态" — 全局共享一份 | bookshelf-store 单实例,activeBookId 在 pluginStates['ebook'](per-ws);切 ws 时各自记忆 — V1 已稳定 |
| OCR 砍出后空字符串占位会让标注列表 UX 差 | 设计 v2 § 4 标注面板留 Batch 4,本迁移不做面板;Batch 4 实现时 OCR 必须就绪(单独阶段) |
| Slot 锚定同步若选 D-9=A 会拖长本迁移 | **强烈推荐 D-9=B**(留单独阶段),让 ebook 主体先到位 |

---

## 9. 待拍板列表(总览)

| 决策 | 推荐 | 必须在 C1 之前定 |
|---|---|---|
| D-1 view id | A `ebook` | ✅ |
| D-2 业务字段位置 | A pluginStates | ✅ |
| D-3 持久化后端 | A SurrealDB | ✅ |
| D-4 SurrealDB 归位 | B 过渡态 platform/main/ebook → 退出条件:C5 验收通过 + 稳定 ≥2 周 → 目标落点 src/storage/ebook/(单独 epic) | ✅ |
| D-5 文件不存在重新定位 | A 完整流程 | C1 后可定 |
| D-6 annotation 升格 Atom | A 不升格 | ✅ |
| D-7 thumbnail 存储 | A base64 inline | ✅ |
| D-8 「提取」按钮 | A 不在本迁移 | ✅ |
| D-9 Slot 锚定同步 | B 留后续阶段 | ✅ |
| D-10 EPUB 引擎 | A foliate-js | ✅ |
| D-11 全文搜索 | A 包含 | ✅ |
| D-12 PDF 空间标注 OCR | A 砍 OCR(留 UI + 数据模型) | ✅ |

---

## 10. 修订记录

| 日期 | 版本 | 内容 | 作者 |
|---|---|---|---|
| 2026-05-09 | v0.1 | 初稿;V1 ebook 5300 行盘点 + V2 三层归属拆分(view/capability/platform)+ 5 段切片 C1~C5 + 12 决策点 + 与三原则对照自检 | wenwu + Claude |
| 2026-05-09 | v0.2 | 用户 v0.1 审计修正:P1 — D-4 补「过渡态 + 退出条件(C5 验收 + 稳定 ≥2 周)+ 目标落点(src/storage/ebook/)」三行约束,§ 9 决策清单同步;P2 — § 3.1 标题改为「LOC 约束(主组件薄壳,引擎留 capability)」并新增 LOC 红线表(EBookView.tsx ≤150~200 行,目录总和不设硬上限,业务 npm 0 import / capability 运行时 0 直 import 是真正红线)— 解决 v0.1「view 总和 ≤200 与 nav-side-content ~600」自相矛盾 | wenwu + Claude |
