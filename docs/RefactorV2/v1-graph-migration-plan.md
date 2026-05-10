# V1 → V2 Graph 迁移设计

> v0.2 · 2026-05-10 · 用户 v0.1 审计修正(P1-1 three 屏障严格版统一 + P1-2 install 列表口径与 D13/D14 自洽)
>
> 配套文档:
> - 业务规格(权威):
>   - [../10-business-design/graph/library/Library.md](../10-business-design/graph/library/Library.md)
>   - [../10-business-design/graph/canvas/Canvas.md](../10-business-design/graph/canvas/Canvas.md)
>   - [../10-business-design/graph/canvas/Canvas-M2-Spec.md](../10-business-design/graph/canvas/Canvas-M2-Spec.md)
>   - [../10-business-design/graph/canvas/Canvas-M2.1-TextNode-Spec.md](../10-business-design/graph/canvas/Canvas-M2.1-TextNode-Spec.md)
>   - [../10-business-design/graph/canvas/Canvas-As-Note-Migration.md](../10-business-design/graph/canvas/Canvas-As-Note-Migration.md)
>   - [../10-business-design/graph/family-tree/family-tree.md](../10-business-design/graph/family-tree/family-tree.md)
> - V2 总纲:[../00-architecture/charter.md](../00-architecture/charter.md) v0.4
> - V2 视图层级:[./view-hierarchy-v2.md](./view-hierarchy-v2.md) v1.1
> - 严格态边界:[./audit/2026-05-08-closure-report.md](./audit/2026-05-08-closure-report.md)
> - 当前进度:[./v2-state-snapshot.md](./v2-state-snapshot.md)
>
> 同位参考(模板蓝本):
> - [./v1-ebook-migration-plan.md](./v1-ebook-migration-plan.md) v0.4 — 5300 行 ebook 拆三层归属的成功范例
> - [./v1-note-migration-audit.md](./v1-note-migration-audit.md)
>
> **本文件用途**:把 V1 graph 模块(`src/plugins/graph/` ~9000 行 + `src/main/storage/graph-store.ts` ~287 行)按 V2 三大原则拆解、重组、分阶段落地。**不是规格文档**——业务规格以 Library.md / Canvas.md / family-tree.md 为准;本文件给的是**拆分映射 + 阶段切片 + 决策清单**。

---

## 0. 一句话定位

把 V1 单体 plugin(view + 渲染管线 + Library 资源体系 + 交互层 + 持久化 + NavSide 全在 `src/plugins/graph/`)拆成 V2 的「**视图声明 + 能力封装 + 平台 IPC**」三层归属,沿用 V1 已稳定的 Canvas M2 业务实现(里程碑 1 全 17 项验收过的 Three.js 引擎 + 自洽 Library + Inspector + line rewire 全套),改外层契约,内部逻辑零改动 — 对齐 charter § 6.5 的「业务代码搬迁原则」。

特殊性(相对 ebook 迁移):

1. **业务规格更厚** — Library / Canvas / family-tree 三组成且互相依赖;v1 Library + Canvas 已实现,family-tree 尚未实施。本迁移**只搬已实现的部分**(Library + Canvas),family-tree 留独立 epic(里程碑 2)。
2. **存在文字节点 NoteView 同源** — Canvas M2.1 已让画板内文字节点跑同一套 PM 体系(详见 Canvas-As-Note-Migration.md「画板与 note 共享语义层」)。这一点与 ebook 完全无关,是本迁移的**关键交叉点**:画板内文字节点需要直接消费 V2 已迁完的 `text-editing` capability。
3. **唯一绝对屏障 npm = `three`** — 不是 PDF / EPUB 那种"两边各一个"的局面。屏障目标极简:`three` **只允许** `capability.canvas-rendering` import,其他任何位置(view / driver / shell / workspace / slot / 其他 capability **包括 shape-library**)0 import。
   - **shape-library 不引入 `three`**:它只输出**纯数据 / 路径表达式**(ShapeDef + 经求值后的 path commands 数组),由 `canvas-rendering` 内部把"路径表达式 → THREE.Shape → Mesh"——这一步 V1 是 `library/shapes/renderers/path-to-three.ts`(395 行),V2 迁到 `capabilities/canvas-rendering/scene/path-to-three.ts`,详见 § 3.2 / § 3.3。

---

## 1. V1 实现盘点

### 1.1 V1 文件清单与 LOC

| 区段 | 路径 | LOC | 性质 |
|---|---|---:|---|
| **plugin renderer** | `src/plugins/graph/renderer.tsx` | 13 | view 入口(挂载 CanvasView) |
| | `src/plugins/graph/graph.css` | (CSS) | 样式 |
| **canvas view 主组件** | `canvas/CanvasView.tsx` | 1147 | view 主组件 + 持久化 + 双栏路由 |
| **canvas/scene**(Three.js 渲染管线) | `canvas/scene/SceneManager.ts` | 346 | Three.js 底座(scene/camera/renderer + Retina + 视口模型) |
| | `canvas/scene/NodeRenderer.ts` | 818 | shape / substance / text 节点渲染主控 |
| | `canvas/scene/LineRenderer.ts` | 181 | line 类型(straight/elbow/curved)几何 |
| | `canvas/scene/TextRenderer.ts` | 197 | 文字 SVG 渲染(中英混排 / emoji / 换行) |
| | `canvas/scene/HandlesOverlay.ts` | 278 | 8 resize + 1 rotation handle + line endpoint handle |
| | `canvas/scene/DotGrid.ts` | 132 | F-1 点阵网格底 |
| **canvas/interaction**(交互) | `canvas/interaction/InteractionController.ts` | 1975 | 鼠标事件 / 选中 / 拖动 / 添加模式 / line 创建 / rewire / OBB hit-test / 复制粘贴 / 多选框选 |
| | `canvas/interaction/magnet-snap.ts` | 182 | line 端点吸附 magnet |
| **canvas/edit**(文字节点 PM 编辑) | `canvas/edit/GraphEditor.ts` | 167 | 文字节点 PM 编辑器(瘦身后 driver) |
| | `canvas/edit/EditOverlay.ts` | 197 | EditOverlay(进入编辑态浮层) |
| | `canvas/edit/atom-bridge.ts` | 121 | atom ↔ canvas Instance 同步桥 |
| | `canvas/edit/InlineToolbar.tsx` | 371 | 文字节点 inline toolbar |
| **canvas/ui**(view 内 UI) | `canvas/ui/Toolbar/Toolbar.tsx` | 385 | 顶部 36px 工具栏 |
| | `canvas/ui/LibraryPicker/LibraryPicker.tsx` | 442 | Freeform 风格 popover |
| | `canvas/ui/LibraryPicker/preview-svg.ts` | (~200) | 缩略图渲染 |
| | `canvas/ui/Inspector/FloatingInspector.tsx` | 521 | 浮动 Inspector(Position / Fill / Line / Arrow / SubstanceProps) |
| | `canvas/ui/ContextMenu/ContextMenu.tsx` | (~150) | 画布右键菜单 |
| | `canvas/ui/dialogs/CreateSubstanceDialog.tsx` | (~120) | 命名对话框(多选 → substance) |
| **canvas/persist** | `canvas/persist/serialize.ts` | 244 | 画布状态 ↔ JSON(schema_version=3,含 doc?:Atom[]) |
| **canvas/combine** | `canvas/combine.ts` | 181 | 多选 → substance 流程 |
| **library**(资源仓库) | `library/types.ts` | 246 | ShapeDef / SubstanceDef / Instance / RenderContext / RenderOutput 等类型 |
| | `library/index.ts` | 7 | 公开 API barrel |
| | `library/shapes/registry.ts` | 66 | ShapeRegistry(Map + register / get / list / listByCategory) |
| | `library/shapes/index.ts` | (内置 22 shape 注册 + JSON glob import) | bootstrap |
| | `library/shapes/renderers/parametric.ts` | 103 | 通用参数化 renderer |
| | `library/shapes/renderers/path-to-three.ts` | 395 | SVG path → THREE.Shape → Mesh + arc/cubic/quadratic 解构 |
| | `library/shapes/renderers/formula-eval.ts` | 203 | OOXML 17 操作符求值器 |
| | `library/shapes/renderers/index.ts` | (barrel) | |
| | `library/shapes/__smoke__/run.ts` | (smoke test) | |
| | `library/shapes/definitions/**/*.json` | 22 个 shape JSON | basic 11 / arrow 3 / flowchart 4 / line 3 / text 1 |
| | `library/substances/registry.ts` | 63 | SubstanceRegistry |
| | `library/substances/index.ts` | (bootstrap) | |
| | `library/substances/definitions/**/*.json` | 5 个内置 substance | library 2 + family 3 |
| **navside**(plugin 内 NavSide 面板) | `navside/GraphPanel.tsx` | 91 | 画板列表面板(消费 FolderTree) |
| | `navside/useGraphOperations.ts` | (~250) | 画板 CRUD ops + 拖拽 + 右键 |
| | `navside/useGraphSync.ts` | (~80) | 列表订阅 + onGraphListChanged |
| | `navside/register.ts` | (~10) | navSide panel-registry 注册 |
| **plugin main 注册** | `main/register.ts` | 42 | WorkMode + NavSide + IPC |
| | `main/ipc-handlers.ts` | 178 | GRAPH_* / GRAPH_FOLDER_* IPC + 广播 |
| **main store** | `src/main/storage/graph-store.ts` | 287 | SurrealDB 实现(graphStore + graphFolderStore) |
| **shared types** | `src/shared/types/graph-types.ts` | (在 V1 用) | GraphVariant / GraphCanvasRecord / GraphCanvasListItem 等 |
| **合计** | | **~9000 行**(代码 + 35 JSON 资源) | |

### 1.2 V1 的"一锅端"问题(charter § 1.4 视角)

| V1 实际形态 | charter 期望形态 |
|---|---|
| `CanvasView.tsx` 1147 行 view 主组件,直接 `import 'three'` 经 `scene/SceneManager.ts` 链路 | view 应 ≤150~200 行,**0 处 import 业务 npm**(`three` 必须圈在 capability) |
| Three.js 渲染管线、ResizeHandles、DotGrid、interaction、edit overlay、Toolbar、Inspector、Picker、ContextMenu **全在** view 目录 | 渲染引擎 + 交互 + handles + DotGrid + edit overlay 全归 capability;Toolbar / Inspector / Picker / ContextMenu 内容由 view 通过 Registry 注册,**式样**由 Workspace Container 管(view-hierarchy-v2 § 0)|
| **Library**(shapes + substances + parametric renderer + formula-eval + path-to-three) 现在挂在 `src/plugins/graph/library/` 内 | Library 应**升格为独立 capability**:`capability.shape-library` — 所有用 shape 的 view(canvas / family-tree / future variants)通过 install 拿到。这是 charter § 1.3 规则 C「能力颗粒度按未来可扩展原则」的标准案例 |
| navside panel 定义 + 框架 register 同 plugin 内 | navside 内容由 view 通过 `navSideRegistry.register({ view: 'graph-canvas', ... })` 注册 |
| `main/ipc-handlers.ts` 同时管 plugin 注册 + IPC + 广播 | 平台 IPC 入口归 `src/platform/main/graph/`,view-side API 通过 `requireCapabilityApi` 间接拿 |
| graphStore 直接走 SurrealDB(`src/main/storage/`)| **D-3=B**(对齐 ebook):V2 此刻无 SurrealDB 客户端,沿用 `learning/vocab-store.ts` JSON atomic write 模板 |
| 文字节点 PM 编辑(`canvas/edit/`)直接 import `prosemirror-*` + 自建 schema | 必须改走 V2 已迁完的 `capability.text-editing`,**不能在 capability.canvas-rendering 内重新封 PM**(屏障重复违规) |

V2 需要把这一锅端的 ~9000 行**拆到三个归属**:

```
                                      V2 三层归属

src/views/graph-canvas/                ← view(声明 + 注册,主组件薄壳)
   index.ts                            registerView + 注册 navside / toolbar / context-menu / commands
   GraphCanvasView.tsx                 薄主组件:订阅 per-ws state + 调能力 Host + Toolbar 编排
   data-model.ts                       pluginStates 形状 / getter / setter
   nav-side-content.tsx                画板列表面板(可独立成 graph-canvas/bookshelf-panel/)
   canvas-commands.ts                  graph-canvas.* 命令注册
   graph-canvas.css                    薄壳样式(大头去 capability)

src/capabilities/                      ← 能力(封装 npm + 状态 + UI)
   shape-library/                      Shape + Substance 资源仓库(独立通用能力,charter § 1.3 规则 C;0 import three)
      shapes/                          22 个 shape JSON + parametric renderer + formula-eval(只输出"求值后的路径表达式数据")
      substances/                      5 个内置 substance + composer + visual-rules
      types.ts                         ShapeDef / SubstanceDef / Instance / EvaluatedPath(纯数据)
      registry.ts                      ShapeRegistry + SubstanceRegistry
      index.ts                         capabilityRegistry.register({ id: 'shape-library', api })
      DESIGN.md
   canvas-rendering/                   Three.js 画板渲染主能力(★ 唯一允许 import three 的 capability)
      Host.tsx                         forwardRef 主组件,view 通过 ref 命令式调用
      scene/                           SceneManager / NodeRenderer / LineRenderer / TextRenderer / HandlesOverlay / DotGrid + path-to-three(V1 直迁;path-to-three 由 shape-library 迁入)
      interaction/                     InteractionController / magnet-snap(V1 直迁)
      types.ts                         CanvasHostHandle / CanvasHostProps / RenderEvent 等
      index.ts                         capabilityRegistry.register({ id: 'canvas-rendering', api })
      DESIGN.md
   canvas-text-node/                   ★ 文字节点桥接(连接 canvas-rendering ↔ text-editing 的薄能力,详见 § 3.5)
      atom-bridge.ts                   atom ↔ canvas Instance 同步桥
      edit-overlay-controller.ts       浮层进入编辑态的协调
      inline-toolbar/                  文字节点 inline toolbar UI
      types.ts
      index.ts
      DESIGN.md
   graph-library-store/                画板列表 + 文件夹的数据 + IPC 中介(对齐 ebook-library)
      client.ts                        IPC 调用封装 + onChanged 订阅 + 内存缓存
      types.ts                         GraphCanvasRecord / GraphCanvasListItem / GraphFolderRecord / GraphVariant
      index.ts
      DESIGN.md

src/platform/main/graph/               ← 平台(主进程实现)
   canvas-store.ts                     V1 graphStore 直迁(JSON 实现,沿用 learning/vocab-store 模板)
   folder-store.ts                     V1 graphFolderStore 直迁(JSON 实现)
   library-handlers.ts                 IPC handler 集中(原 plugins/graph/main/ipc-handlers.ts)
   index.ts                            initGraphPlatform()
```

> **canvas-text-node 是 graph 迁移特有的能力**(ebook 不需要),核心作用是把 V1 `canvas/edit/*` 的桥接逻辑独立成一个**第三 capability**,而不是塞进 canvas-rendering 内部。理由见 § 3.5。

---

## 2. V2 现状(L5-C6 收尾后,2026-05-10)

### 2.1 已就位的 V2 基础设施(本迁移可直接消费)

| 设施 | 形态 | 用途 |
|---|---|---|
| `capabilityRegistry` | `src/slot/capability-registry/` | 注册 shape-library / canvas-rendering / canvas-text-node / graph-library-store |
| `requireCapabilityApi(id)` | `src/slot/capability-registry/get-capability-api.ts` | view 间接路由,W5 严格态强制 |
| `viewTypeRegistry / registerView` | `src/slot/view-type-registry/` | 声明 view `'graph-canvas'` + install 列表 |
| `navSideRegistry` | `src/slot/nav-side-registry/` | view 通过 `navSideRegistry.register({ view: 'graph-canvas', title:'画板', actions, contentRenderer })` 注入 |
| `toolbarRegistry / contextMenuRegistry / floatingToolbarRegistry / handleRegistry` | `src/slot/interaction-registries/` | toolbar 与右键菜单内容注册 |
| `commandRegistry` | `src/slot/command-registry/` | `graph-canvas.*` 命令字符串引用 |
| `keymapRegistry` | `src/slot/keymap-registry/` | Cmd+Z / Cmd+C / Cmd+V / Delete / Esc 等 |
| `WorkspaceState.pluginStates: Record<string,unknown>` | `src/workspace/workspace-state/` | activeGraphId / 视口位置 / 选中 ID 等业务字段挂这里(决策 D-2)|
| **`text-editing` capability** | `src/capabilities/text-editing/` | **关键** — canvas-text-node 通过 `requireCapabilityApi('text-editing')` 拿 PM 实例化 + atom converters。详见 § 3.5 |
| `slotBinding.left/right` + `bus.slot.openRight()` | `src/workspace/` + `src/slot/workspace-bus/` | Canvas 调用 API 在 right-slot 打开(Canvas.md § 5)|
| `mediaPutBase64 / mediaDownload` IPC | `src/shared/ipc/channel-names.ts` | Canvas 序列化里如果有图片 substance(v1 暂无)|
| `shell.openExternal / openPath / showItemInFolder` IPC | 同上 | 不直接用,留扩展 |

### 2.2 V2 缺失、本迁移期间需要补建的前置

| 前置 | 性质 | 第一波切片 | 备注 |
|---|---|---|---|
| **`three` npm 依赖**(及 V1 锁定版本对齐) | 平台基建 | G1 前置 | V1 `package.json` `three` 版本要锁住一致;`@types/three` 同上;ESLint `no-restricted-imports` 把 `three` 加入**只允许 `capabilities/canvas-rendering/`** import 的清单(单点屏障,严格版 — 不允许 `shape-library` 例外)|
| **`prosemirror-*` 复用契约**(canvas-text-node → text-editing API) | capability 间契约 | G3 前置(文字节点段) | text-editing 的 createInstance / atomsToProseMirror / prosemirrorToAtoms 已稳;canvas-text-node **不**自己 import PM,只通过 `requireCapabilityApi('text-editing')` 调用 |
| **WorkspaceState pluginStates['graph-canvas'] 形状定义** | 框架 | G1 前置 | charter § "L3 业务字段全走 pluginStates",新建 `views/graph-canvas/data-model.ts` 定义 + 默认值 |
| **画板持久化:JSON 还是 SurrealDB** | 决策点 D-3 | G1 前置 | 沿用 ebook 决议:**JSON 文件**(D-3=B);V1 SurrealDB 实现保留作 W6 epic 起点参考 |
| **Canvas 调用 API(被其他 view 用)** | 跨 view 通信 | G6 / 不阻塞 G1~G5 | Canvas.md § 5 描述「family-tree 调 canvas 创作 substance」;**本迁移阶段尚无消费者(family-tree 还没启)**,API 设计预留 / 不实施 |
| **Substance 是否独立 note**(Canvas.md § 3.1)| 决策点 D-6 | G2 决定 | V1 现状是 substance 嵌入 canvas note 的 `user_substances` 字段;Canvas.md 建议「每个 substance 独立 note」。**推荐先沿用 V1 嵌入式**,独立 note 化留 v1.5+ |
| **family-tree variant 何时启** | 范围决策 D-7 | **不在本迁移范围** | family-tree 整段(parser + walker tidy + projection)是单独的里程碑 2,本迁移不做 |

---

## 3. 新归属切片 — 详细映射

### 3.1 view 层(`src/views/graph-canvas/`)— LOC 约束

view 必须遵守 charter § 1.4「能力组合声明 + 注册菜单 / 命令」,**0 处 import 业务 npm**(`three` 通过 capability 间接消费)。

**LOC 约束**(对齐 ebook 迁移 v0.2 修订的红线表):

| 单位 | 红线 | 理由 |
|---|---|---|
| `GraphCanvasView.tsx`(view 主组件) | **≤ 150~200 行**(对齐 EBookView 红线 + 与 NoteView 111 / WebView 192 / TranslateWebView 142 同档) | 主组件是「订阅 + 命令路由 + Host 编排」薄壳;Three.js / interaction / handle / edit overlay 全部留在 capability — 凡是涉及 `three` / 直接画 mesh 的代码超线 = 违反 § 1.4 |
| `views/graph-canvas/` 目录总和 | **不设硬上限** — 业务声明性代码(NavSide 画板列表 JSX、命令注册等)按需展开,**0 处业务 npm import**(eslint 拦)、**0 处 capability 运行时直 import**(`requireCapabilityApi` 间接拿) | 对齐 ebook 决议 |

| V2 文件 | 来源 | 性质 |
|---|---|---|
| `index.ts` | new(对齐 `views/ebook/index.ts` 40 行模板) | `registerView({ id: 'graph-canvas', install: ['shape-library', 'canvas-rendering', 'canvas-text-node', 'graph-library-store'], component: GraphCanvasView, navSideTab })` + 注册 commands / context-menu / toolbar / keymap。**install 列表口径(P1-2 v0.2 修订)**:G1~G5 范围内 graph-canvas **不依赖** V2 `undo-redo` / `clipboard` capability(画板 undo/redo 与跨 view 复制粘贴留 V1 自管,详见 D-13 / D-14 + § 6.1 自检条目);v1.5+ 抽象到 view-agnostic 后再加进 install |
| `GraphCanvasView.tsx` | V1 `CanvasView.tsx` 1147 行瘦身 → ~150~180 行 | 订阅 pluginStates(activeGraphId / viewport / selectedIds / inspector 显示 / addMode)+ 命令式调 `CanvasHost`(从 `canvas-rendering` capability 拿)+ 编排 toolbar handlers + load/save/restore 流程 |
| `data-model.ts` | new | `GraphCanvasWsState` 形状 + `getGraphCanvasWsState(ws) / setActiveGraphId / setViewport / ...` 等 setter |
| `nav-side-content.tsx` | V1 `navside/GraphPanel.tsx + useGraphOperations.ts + useGraphSync.ts + register.ts` 共 ~430 行迁入 → ~400 行 | 画板列表面板;通过 `requireCapabilityApi('graph-library-store')` 拿 client。**不计入主组件薄壳红线**(对齐 ebook nav-side-content) |
| `canvas-commands.ts` | new | `graph-canvas.create / graph-canvas.create-folder / graph-canvas.open / graph-canvas.rename / graph-canvas.delete / graph-canvas.duplicate / graph-canvas.move-to-folder / graph-canvas.add-shape / graph-canvas.combine-substance / ...` 命令注册 |
| `graph-canvas.css` | V1 `graph.css` 拆分 — 只留 view 壳(toolbar 容器 / NavSide panel 套壳) | 大头(scene / handles / inspector / picker)迁到 capability |

view 主体核心模式(对齐 `EBookView.tsx`):

```ts
// GraphCanvasView.tsx 主结构(伪代码,~180 行目标)
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { CanvasRenderingApi, CanvasHostHandle } from '@capabilities/canvas-rendering/types';
import type { ShapeLibraryApi } from '@capabilities/shape-library/types';
import type { GraphLibraryStoreApi } from '@capabilities/graph-library-store/types';
import type { CanvasTextNodeApi } from '@capabilities/canvas-text-node/types';
import { workspaceManager } from '@workspace/...';
import { getGraphCanvasWsState, setActiveGraphId, setViewport, ... } from './data-model';

export function GraphCanvasView({ workspaceId }: ViewComponentProps) {
  const Host    = useMemo(() => requireCapabilityApi<CanvasRenderingApi>('canvas-rendering').Host, []);
  const library = useMemo(() => requireCapabilityApi<ShapeLibraryApi>('shape-library'), []);
  const store   = useMemo(() => requireCapabilityApi<GraphLibraryStoreApi>('graph-library-store'), []);
  const textNode = useMemo(() => requireCapabilityApi<CanvasTextNodeApi>('canvas-text-node'), []);
  const hostRef = useRef<CanvasHostHandle | null>(null);

  const wsState = useSyncExternalStore(
    (cb) => workspaceManager.subscribe(cb),
    () => getGraphCanvasWsState(workspaceManager.get(workspaceId)),
  );

  // 启动恢复 + 监听 onGraphOpenInView 推流
  useEffect(() => {
    if (wsState?.activeGraphId) hostRef.current?.openGraphId(wsState.activeGraphId);
    return store.onGraphOpenInView((id) => hostRef.current?.openGraphId(id));
  }, [workspaceId]);

  // toolbar / cmd 路由经 hostRef + store API + library API
  // ... handlers ...

  return (
    <div className="krig-graph-canvas-view">
      <GraphCanvasToolbar {...toolbarProps} />
      <Host
        ref={hostRef}
        workspaceId={workspaceId}
        textNode={textNode}                      /* 文字节点能力注入 */
        onViewportChange={(vp) => setViewport(workspaceId, vp)}
        onSelectionChange={(ids) => setSelectedIds(workspaceId, ids)}
        onInstancesChange={(instances) => scheduleSave(instances)}  /* 1s 防抖 */
        onTitleChange={(t) => store.rename(activeId, t)}
      />
    </div>
  );
}
```

### 3.2 shape-library capability(`src/capabilities/shape-library/`) — 资源仓库

**职责**:Shape 定义 + Substance 定义 + 通用参数化 renderer + OOXML 公式求值器,**只输出纯数据 / 路径表达式**(EvaluatedPath / EvaluatedSubstance),不接触 Three.js。**所有用 shape 的 view 通过 install 拿到**(charter § 1.3 规则 C 标准案例)。

**P1-1 严格版屏障(本节 v0.2 修订核心)**:V1 `library/shapes/renderers/path-to-three.ts`(395 行,SVG path → THREE.Shape → Mesh)**不归属本 capability** — 它会带入 `three` import,违反"唯一屏障 = canvas-rendering"。这一步迁到 `capabilities/canvas-rendering/scene/path-to-three.ts`(详见 § 3.3),由 canvas-rendering 在拿到 shape-library 输出的 `EvaluatedPath` 后再做"路径表达式 → THREE.Shape"投影。

**对外 API 形状**(`capabilities/shape-library/index.ts` 注册):

```ts
capabilityRegistry.register({
  id: 'shape-library',
  api: {
    shapes: {
      register(def: ShapeDef): void;
      get(id: string): ShapeDef | null;
      list(): ShapeDef[];
      listByCategory(category: string): ShapeDef[];
      // 求值:把 ShapeDef 的 path + params + guides 求值成"路径表达式数据"
      // 输出 EvaluatedPath(数组 of {cmd:'M'|'L'|'A'|'Q'|'C'|'Z', ...numbers}),不含 THREE 类型
      evaluate(id: string, props: Record<string, unknown>, ctx: EvaluateContext): EvaluatedPath;
    },
    substances: {
      register(def: SubstanceDef): void;
      get(id: string): SubstanceDef | null;
      list(): SubstanceDef[];
      listByCategory(category: string): SubstanceDef[];
      // 求值:输出 component 数组(每项含 ref / transform / 求值后的 EvaluatedPath / style 覆盖)
      evaluate(id: string, props: Record<string, unknown>, ctx: EvaluateContext): EvaluatedSubstance;
    },
    // 第三方扩展(v1 不实现)
    registerShapePack?(pack: ShapePack): void;
    registerSubstancePack?(pack: SubstancePack): void;
  },
});
```

> **命名变化**:V1 `RenderOutput`(含 THREE.Shape / Mesh)→ V2 `EvaluatedPath` / `EvaluatedSubstance`(纯数据)。canvas-rendering 在 NodeRenderer 内消费这些数据,把 `EvaluatedPath` 喂给 path-to-three 工具拿到 `THREE.Shape`,再生成 Mesh。

**内部目录**(对照 V1 `library/`,**path-to-three 已迁出**):

```
src/capabilities/shape-library/
├── index.ts                       注册 + api 导出
├── types.ts                       ShapeDef / SubstanceDef / Instance / EvaluateContext / EvaluatedPath / EvaluatedSubstance(V1 library/types.ts 抽出 + 改纯数据形态)
├── shapes/
│   ├── registry.ts                ShapeRegistry(V1 直迁,~66 行)
│   ├── definitions/               22 个 shape JSON 直迁(basic/arrow/flowchart/line/text)
│   ├── renderers/                 ⚠️ "renderers" 是 V1 历史目录名,V2 内只剩"求值器",不含 three
│   │   ├── parametric.ts          通用参数化 renderer — 输出 EvaluatedPath 而不是 THREE.Shape(V1 103 行,改写约 30 行)
│   │   ├── formula-eval.ts        OOXML 17 操作符求值器(V1 直迁,203 行,纯数学,本来就 0 三方依赖)
│   │   └── index.ts
│   ├── bootstrap.ts               启动时 import.meta.glob 读 22 个 JSON 注册到 registry(V1 shapes/index.ts 同形)
│   └── __smoke__/run.ts           smoke test(V1 直迁,断言"输出形状是 EvaluatedPath")
├── substances/
│   ├── registry.ts                SubstanceRegistry(V1 直迁)
│   ├── definitions/               5 个内置 substance JSON 直迁(library/family/)
│   ├── composer.ts                substance 组合求值(v1 简化版,V1 暂未抽出可在 NodeRenderer 内)
│   ├── visual-rules.ts            visual_rules 求值器(v1 family-tree 才用,先建空壳)
│   └── bootstrap.ts               启动注册
├── styles.css                     无(无 UI)
└── DESIGN.md                      DESIGN 第一章必须显式声明:"本 capability 0 import three,path 投影由 canvas-rendering 接收 EvaluatedPath 后完成"(v0.2 严格版屏障落地点)
```

**npm 依赖屏障**:shape-library **0 import three**;view / driver / slot / shell / workspace 也 0 处 import three(eslint 拦)。`three` 全部圈在 `capabilities/canvas-rendering/`(详见 § 3.3)。

### 3.3 canvas-rendering capability(`src/capabilities/canvas-rendering/`)— Three.js 屏障核心

**职责**:封装 Three.js scene + 节点渲染 + 交互的整个生命周期,以 `<Host ref={hostRef} />` 单一面孔暴露给 view。view 只通过 ref 命令式 + props 回调通信。

**对外 API 形状**:

```ts
capabilityRegistry.register({
  id: 'canvas-rendering',
  api: {
    Host,                          // forwardRef<CanvasHostHandle, CanvasHostProps>
  },
});

export type CanvasHostHandle = {
  // 文档加载 / 保存
  loadDocument(doc: CanvasDocument): void;
  serialize(): CanvasDocument;
  openGraphId(id: string): Promise<void>;     // 走 graph-library-store 拿 record + load

  // 视口
  setViewport(vp: { centerX: number; centerY: number; zoom: number }): void;
  fitToContent(): void;
  zoomTo(percent: number): void;

  // 添加模式
  enterAddMode(spec: AddModeSpec): void;
  exitAddMode(): void;

  // 选区
  selectAll(): void;
  clearSelection(): void;
  deleteSelected(): void;
  duplicateSelected(): void;
  combineSelected(form: CreateSubstanceFormResult): void;

  // 单实例操作(Inspector 用)
  updateInstance(id: string, patch: Partial<Instance>): void;

  // 文字节点
  enterTextEdit(instanceId: string): void;
};

export type CanvasHostProps = {
  workspaceId: string;
  textNode: CanvasTextNodeApi;             // canvas-text-node 由 view 注入
  onViewportChange?: (vp: Viewport) => void;
  onSelectionChange?: (ids: string[]) => void;
  onInstancesChange?: (instances: Instance[]) => void;   // 任何节点新增 / 修改 / 删除推流(view 防抖保存)
  onTitleChange?: (title: string) => void;
  onAddModeChange?: (spec: AddModeSpec | null) => void;
  onContextMenu?: (event: { clientX: number; clientY: number; targetIds: string[] }) => void;
};
```

**内部目录**(对照 V1 `canvas/scene` + `canvas/interaction`):

```
src/capabilities/canvas-rendering/
├── index.ts                       注册 + api 导出
├── Host.tsx                       forwardRef 主组件(整合 scene + interaction + UI 浮层)
├── types.ts                       CanvasHostHandle / CanvasHostProps / Viewport / AddModeSpec(V1 inline 类型抽出)
├── scene/
│   ├── SceneManager.ts            V1 直迁(346 行,import three)
│   ├── NodeRenderer.ts            V1 直迁(818 行,import three)
│   ├── LineRenderer.ts            V1 直迁(181 行,import three)
│   ├── TextRenderer.ts            V1 直迁(197 行,import three)
│   ├── HandlesOverlay.ts          V1 直迁(278 行,import three)
│   ├── DotGrid.ts                 V1 直迁(132 行,import three)
│   └── path-to-three.ts           V1 library/shapes/renderers/path-to-three.ts 迁入(395 行,import three) — P1-1 严格版屏障核心:把 shape-library 输出的 EvaluatedPath 投影成 THREE.Shape
├── interaction/
│   ├── InteractionController.ts   V1 直迁(1975 行,canvas 灵魂)
│   └── magnet-snap.ts             V1 直迁(182 行)
├── ui/                            "能力级 UI"(charter § 1.4 三条之一):画板内浮层
│   ├── library-picker/            Freeform 风格 popover(V1 442 行)
│   ├── floating-inspector/        浮动 Inspector(V1 521 行)
│   └── create-substance-dialog/   命名对话框(V1 ~120 行)
├── styles.css                     V1 graph.css 大头迁入(scene / handles / picker / inspector / dialog 样式)
└── DESIGN.md
```

> ⚠️ 注意:`library-picker / floating-inspector` 是**画板内置浮层**(画布缩放浮层、Inspector 是画板专属交互工具),归 capability(charter § 1.4 第二条「能力 UI 在 Capability」)。它们**不**走 V2 应用级 ContextMenu / Slash / Handle / FloatingToolbar 这套——那些是 PM 文档的浮层,与画板无关。

> 对比 `application-level overlay`(画板**右键菜单 / Toolbar 顶部条**)— 这类才走 V2 的 Workspace Container 浮层式样,内容由 view 通过 contextMenuRegistry / toolbarRegistry 注册。详见 § 6.2 自检。

**npm 依赖屏障落地(P1-1 严格版)**:
- `three` 仅 `capabilities/canvas-rendering/scene/` 下 7 个文件 import(SceneManager / NodeRenderer / LineRenderer / TextRenderer / HandlesOverlay / DotGrid + path-to-three)
- view / driver / slot / shell / workspace / 其他 capability(**含 shape-library**)**0 处** 见到 `three`(eslint 已锁,见 charter § 2.3)
- 这是**单点屏障 = canvas-rendering**,与文档 § 0「唯一绝对屏障」表述完全一致

### 3.4 graph-library-store capability(`src/capabilities/graph-library-store/`)— 数据 + IPC 中介

**职责**:把 main 进程的画板/文件夹 IPC 操作封装成 renderer 端 API。view 通过它读写,**不直触 storage**。形态完全对齐 ebook-library。

```
src/capabilities/graph-library-store/
├── index.ts                       注册 + api 导出
├── types.ts                       GraphCanvasRecord / GraphCanvasListItem / GraphFolderRecord / GraphVariant(V1 src/shared/types/graph-types.ts 类型迁入)
├── client.ts                      IPC 调用封装 + onGraphListChanged / onGraphOpenInView / onGraphDeleted / onGraphTitleChanged 订阅 + 内存缓存
└── DESIGN.md
```

**对外 API**:

```ts
export type GraphLibraryStoreApi = {
  // 画板 CRUD
  list(): Promise<GraphCanvasListItem[]>;
  get(id: string): Promise<GraphCanvasRecord | null>;
  create(title: string, variant: GraphVariant, folderId?: string | null): Promise<GraphCanvasRecord>;
  save(id: string, docContent: unknown, title: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  delete(id: string): Promise<void>;
  moveToFolder(id: string, folderId: string | null): Promise<void>;
  duplicate(id: string, targetFolderId?: string | null): Promise<GraphCanvasRecord | null>;

  // 启动恢复
  pendingOpen(): Promise<string | null>;
  setActive(id: string | null): Promise<void>;
  getActiveId(): Promise<string | null>;

  // 文件夹 CRUD
  folderList(): Promise<GraphFolderRecord[]>;
  folderCreate(title: string, parentId?: string | null): Promise<GraphFolderRecord>;
  folderRename(id: string, title: string): Promise<void>;
  folderDelete(id: string): Promise<void>;
  folderMove(id: string, parentId: string | null): Promise<void>;

  // 推送
  onGraphListChanged(cb: (list: GraphCanvasListItem[]) => void): () => void;
  onGraphOpenInView(cb: (graphId: string) => void): () => void;
  onGraphDeleted(cb: (graphId: string) => void): () => void;
  onGraphTitleChanged(cb: (data: { graphId: string; title: string }) => void): () => void;

  // 跨 view 协议(family-tree 等 variant 调 canvas 在 right-slot 创作 substance — Canvas.md § 5)
  // v1 暂不实施(无消费者),API 形状预留 — D-7
};
```

### 3.5 ★ canvas-text-node capability(`src/capabilities/canvas-text-node/`)— 文字节点桥接(graph 迁移特有)

**职责**:把 V1 `canvas/edit/*` 的 4 个文件(GraphEditor 167 + EditOverlay 197 + atom-bridge 121 + InlineToolbar 371,共 856 行)独立成一个**第三 capability**,作为 canvas-rendering 与 text-editing 之间的薄桥接层。

**为什么独立成 capability,而不是塞进 canvas-rendering**:

1. **依赖屏障干净**:canvas-rendering 内部应该只见 `three`,不该见 `prosemirror-*`。如果 atom-bridge / InlineToolbar 直接写在 canvas-rendering 内,prosemirror import 就会出现在那里。
2. **跨 view 复用预留**:未来 family-tree variant 也可能有「画板内文字节点」需求(节点 label 可编辑)。如果文字节点能力独立,family-tree variant install 一下就能拿。
3. **对齐 charter § 1.3 规则 C**:能力颗粒度按"未来可扩展"原则——当前只一个 view 消费,但符合"有状态封装"特征,先建独立 capability 不亏。
4. **职责单一**:这层不做画板的 mesh 渲染,也不做 PM 的 schema/编辑;它只做"文字节点的 atom 数据 ↔ canvas Instance 双向同步 + 编辑态浮层协调"。

**对外 API 形状**:

```ts
capabilityRegistry.register({
  id: 'canvas-text-node',
  api: {
    // 由 canvas-rendering Host 内部调用(view 注入给 Host):
    enterEdit(opts: EnterEditOptions): EditSession;     // 在指定容器位置开浮层、PM 实例化、绑回调
    isTextNodeRef(ref: string): boolean;                // 判断 instance.ref 是否文字节点(krig.text.label 等)
    convertAtomToInstanceDoc(atoms: Atom[]): InstanceDoc;
    convertInstanceDocToAtoms(doc: InstanceDoc): Atom[];
  },
});

export type EditSession = {
  destroy(): void;
  applyExternalUpdate(doc: InstanceDoc): void;
};
export type EnterEditOptions = {
  containerEl: HTMLElement;             // 由 canvas-rendering 提供的浮层容器
  initialDoc: InstanceDoc;
  worldRect: { x: number; y: number; w: number; h: number };
  onChange: (doc: InstanceDoc, atoms: Atom[]) => void;
  onCommit: () => void;
  onCancel: () => void;
};
```

**内部依赖**:

```ts
// canvas-text-node/edit-session.ts(伪代码)
import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { TextEditingApi } from '@capabilities/text-editing/types';

export function createEditSession(opts: EnterEditOptions): EditSession {
  const textEditing = requireCapabilityApi<TextEditingApi>('text-editing');
  const pmInstance = textEditing.createInstance({ ... });   // PM 实例化全在 text-editing
  // ... 绑 onChange,自管 InlineToolbar 浮层 ...
}
```

**内部目录**:

```
src/capabilities/canvas-text-node/
├── index.ts                       注册 + api 导出
├── types.ts                       EditSession / EnterEditOptions / InstanceDoc(原 canvas/edit 内联类型)
├── atom-bridge.ts                 V1 直迁(121 行,改用 text-editing API 的 converters)
├── edit-session.ts                V1 GraphEditor.ts + EditOverlay.ts 合并瘦身(原 167+197=364 行 → ~250 行)
├── inline-toolbar/
│   └── index.tsx                  V1 InlineToolbar.tsx 直迁(371 行,UI 改对接 text-editing 命令)
├── styles.css                     V1 graph.css 内文字节点编辑相关样式
└── DESIGN.md
```

### 3.6 platform 层(`src/platform/main/graph/`)— 主进程实现

| V2 文件 | 来源 | 备注 |
|---|---|---|
| `canvas-store.ts` | V1 `src/main/storage/graph-store.ts` 直迁(287 行) | **D-3=B**:JSON 实现,沿用 `learning/vocab-store.ts` JSON atomic write 模板。文件路径:`{userData}/krig-note-v2/graph/canvases.json` 或一文件每画板 `{userData}/krig-note-v2/graph/canvases/{id}.json`(评估:列表元数据走单 index.json,内容走每画板一文件,与 ebook bookshelf-store 形态对齐) |
| `folder-store.ts` | 从 V1 同 `graph-store.ts` 内的 `graphFolderStore` 抽出 | 同上;路径:`{userData}/krig-note-v2/graph/folders.json` |
| `library-handlers.ts` | V1 `plugins/graph/main/ipc-handlers.ts` 直迁(178 行) | 改 IPC channel 命名(详见 § 3.7)+ 广播走 `getMainWindow().webContents` |
| `index.ts` | new | `initGraphPlatform({ getMainWindow })` 入口,在 `platform/main/index.ts` ipc-bus 阶段调 |

### 3.7 IPC channel 新增清单(加入 `src/shared/ipc/channel-names.ts`)

V1 用枚举 `IPC.GRAPH_*` 共 17 个,V2 命名规范是 `<层>.<动作>`:

```ts
// ── graph 画板 CRUD ──
GRAPH_LIST: 'graph.list',
GRAPH_LOAD: 'graph.load',
GRAPH_CREATE: 'graph.create',
GRAPH_SAVE: 'graph.save',
GRAPH_DELETE: 'graph.delete',
GRAPH_RENAME: 'graph.rename',
GRAPH_MOVE_TO_FOLDER: 'graph.move-to-folder',
GRAPH_DUPLICATE: 'graph.duplicate',
GRAPH_LIST_CHANGED: 'graph.list-changed',         // main → renderer 推送
GRAPH_OPEN_IN_VIEW: 'graph.open-in-view',
GRAPH_PENDING_OPEN: 'graph.pending-open',
GRAPH_DELETED: 'graph.deleted',                   // main → renderer 推送
GRAPH_TITLE_CHANGED: 'graph.title-changed',       // main → renderer 推送
GRAPH_SET_ACTIVE: 'graph.set-active',
GRAPH_GET_ACTIVE: 'graph.get-active',

// ── graph 文件夹 ──
GRAPH_FOLDER_LIST: 'graph.folder-list',
GRAPH_FOLDER_CREATE: 'graph.folder-create',
GRAPH_FOLDER_RENAME: 'graph.folder-rename',
GRAPH_FOLDER_DELETE: 'graph.folder-delete',
GRAPH_FOLDER_MOVE: 'graph.folder-move',
```

V1 中 `activeGraphId` 走 IPC 写到 `workspaceManager.activeGraphId`;V2 改走 `pluginStates['graph-canvas']`(决策 D-2),renderer 直接 `workspaceManager.update()`,不再需要 GRAPH_SET_ACTIVE / GRAPH_GET_ACTIVE 两条 IPC。**保留这两条 IPC 仅用于"main 端启动恢复 push 给 renderer"场景的 fallback**(对齐 ebook 模式)。

### 3.8 preload 暴露形态

在 `src/platform/main/preload/main-window-preload.ts` 加一组方法:

```ts
graphList: () => ipcRenderer.invoke(IPC_CHANNELS.GRAPH_LIST),
graphLoad: (id) => ipcRenderer.invoke(IPC_CHANNELS.GRAPH_LOAD, id),
graphCreate: (title, variant, folderId) => ipcRenderer.invoke(IPC_CHANNELS.GRAPH_CREATE, title, variant, folderId),
graphSave: (id, doc, title) => ipcRenderer.invoke(IPC_CHANNELS.GRAPH_SAVE, id, doc, title),
// ... 全部 graph.* invoke ...
onGraphListChanged: (cb) => { /* on + return off */ },
onGraphOpenInView: (cb) => { /* on + return off */ },
onGraphDeleted: (cb) => { /* on + return off */ },
onGraphTitleChanged: (cb) => { /* on + return off */ },
```

view / capability 通过 `window.electronAPI.graph*` 调用,**不再有 plugin 专属 preload**(V1 `src/main/preload/view.ts / navside.ts`)。

---

## 4. 关键决策清单(G1 起步前请用户拍板)

格式与 V2 既有 stage design 一致(每项给两条路径,A 是默认推荐):

| # | 决策点 | A(默认) | B(替代) | 影响范围 |
|---|---|---|---|---|
| **D-1** | view id 命名 | **`graph-canvas`**(charter § 1.4 命名表「反映能力组合」+ Canvas.md § 0.3「Canvas 是 Graph view 的 variant」语义直译 + 与未来 `family-tree` / `knowledge-graph` 等 variant 平级)| `graph`(对齐 V1 workMode id `'graph'` + variant 字段在 frontmatter 区分 — Canvas.md § 0.3) | 文件路径 + registerView id + slotBinding 字面值 |
| **D-2** | activeGraphId / viewport / selectedIds 等业务字段位置 | **走 `pluginStates['graph-canvas']`**(charter 强制 + ebook 已落地模板) | 沿用 V1 `WorkspaceState.activeGraphId` 模式(main 持) | A 路径 IPC 减 2 条;V2 已经在 ebook 证明走 pluginStates 行得通,选 A |
| **D-3** | 持久化后端 | SurrealDB(V1 实际生效的实现,直迁 `src/main/storage/graph-store.ts`)| **JSON 文件**(对齐 ebook D-3=B 决议;V2 此刻无 SurrealDB 客户端,沿用 `learning/vocab-store.ts` / `platform/main/ebook/` 模板)| **强烈推荐 B**。理由同 ebook v0.3 修订:V2 `src/storage/` 仅 README,无 SurrealDB 客户端;C1~C5 ebook 已用 JSON 跑稳;graph 沿用同模板。**B 路径退出条件**:① C5 / G5 验收通过 + 主功能稳定 ≥ 2 周;② W6 SurrealDB 客户端 epic 落地;③ 两条达成后启动 graph + ebook 一并升 SurrealDB |
| **D-4** | 持久化实现归位(随 D-3=B 升级语义) | 直接放 `src/storage/graph/`(对齐 charter directory-structure)| **过渡态:`src/platform/main/graph/`(JSON 实现),后续合并至 `src/storage/graph/`**| 与 D-3=B 配套,推荐 B。**钉死的过渡约束**:① 显式临时 ② 退出条件二合一(同 ebook D-4 v0.3)③ 目标落点 `src/storage/graph/{canvas-store, folder-store}.ts`,W6 epic 落地时 graph + ebook 一并升 |
| **D-5** | Library(shape-library)是否独立 capability | **A 独立** — `capability.shape-library`,所有用 shape 的 view 通过 install 拿到(charter § 1.3 规则 C 标准案例) | 嵌在 `capabilities/canvas-rendering/library/` 内部 | A 与 v1 业务规格 Library.md § 0 「全系统共享,任何 view 都可调用」契合,且 family-tree variant 后续 install 才能复用。选 A |
| **D-6** | 文字节点编辑(canvas/edit/*)是否独立 capability | **A 独立** — `capability.canvas-text-node`(详见 § 3.5,4 个理由)| 塞在 `capabilities/canvas-rendering/edit/` 内部 | A 让 prosemirror-* import 不污染 canvas-rendering;B 简单但违反屏障原则。**强烈推荐 A** |
| **D-7** | family-tree variant 是否在本迁移做 | **A 不做** — 本迁移只搬 V1 已实现的 Library + Canvas;family-tree 业务规格已写但 V1 未实现,留独立 epic(里程碑 2,即里程碑 G+1) | B 一并做 | A 减少作用域,先把 ~9000 行 graph 主体迁过来跑稳;family-tree ~3 天工作量(family-tree.md § 7)单独阶段。选 A |
| **D-8** | Canvas 调用 API(canvasAPI.openInRightSlotForSubstanceCreation 等) | **A 不实施,只预留 API 形状**(Canvas.md § 5)— 当前无消费者(family-tree 还没启) | B 一起实施 | A 与 D-7 配套,family-tree 启动时一并实施 API |
| **D-9** | Substance 持久化 | **A 沿用 V1 嵌入式**(canvas note 的 `user_substances` 字段) | B 升级为「每 substance 一独立 note」(Canvas.md § 7.2 推荐方向) | A 与 V1 行为一致 + 减改动;B 是 v1.5+ 方向(对齐 KRIG note 衍生关系语义)。本迁移选 A |
| **D-10** | Library Picker / Inspector / CreateSubstanceDialog 归 view 还是 capability | **A 归 capability.canvas-rendering 内部 ui/**(画板专属浮层,charter § 1.4 第二条「能力 UI 在 Capability」)| B 归 view(`views/graph-canvas/components/`) | A 让画板的"内浮层"由能力自带,view 不写 UI;B 与 V1 一致但违反 § 1.4。**推荐 A** |
| **D-11** | 画布右键菜单走 V2 contextMenuRegistry 还是 capability 内自管 | **A 走 V2 contextMenuRegistry**(画板右键 = 应用级 ContextMenu,内容由 view 注册) | B capability 内自管(V1 当前形态) | A 让画板右键菜单与 NoteView / EBookView 视觉一致(charter § 1.4 第一条「应用级 UI 一致」);B 与 V1 一致但违反 § 1.4。**推荐 A**。⚠️注:画板**内**的 Inspector / Picker 仍是 capability 内浮层(D-10),区分清楚 |
| **D-12** | Toolbar 走 V2 toolbarRegistry 还是 view 内自管 | **A 走 V2 toolbarRegistry**(toolbar 内容由 view 注册,式样由 Workspace Container 提供) | B view 内自管(V1 当前 385 行 Toolbar.tsx) | A 让 graph-canvas toolbar 与 ebook / note 视觉一致;B 与 V1 一致但违反 § 1.4。**推荐 A**。⚠️注:Toolbar 内的"添加模式"二级浮层(LibraryPicker)仍归 capability(D-10) |
| **D-13** | undo/redo 实现路径 | A 用 V2 `undo-redo` capability(对齐 NoteView 模式)— **需先扩展 capability 至 view-agnostic** | **B V1 自管 50 步全量快照(M1.x.6)** | A 让画板 undo/redo 与全 app 一致,但 V2 `undo-redo` 当前只针对 PM 文档,**画板不是 PM 文档**(画板是 Three.js mesh + JSON 状态),**A 路径阻塞于先扩展 capability**;B 直接用 V1 已稳实现。**v0.2 推荐 B**(对齐 P1-2 install 列表 — graph-canvas 不依赖 undo-redo capability);v1.5+ undo-redo capability 抽象后切换至 A |
| **D-14** | 复制粘贴实现路径 | A 走 V2 `clipboard` capability(跨 view 一致 + 含 atom 协议)— **需先验证支持画板格式** | **B view 内自管(V1 当前形态)** | 画板剪贴板格式与 PM 文档不同,V2 `clipboard` 是否兼容需先验证;A 路径阻塞于该验证 + 跨 view 复制粘贴的画板格式契约。**v0.2 推荐 B**(对齐 P1-2 install 列表 — graph-canvas 不依赖 clipboard capability);v1.5+ clipboard capability 抽象后切换至 A |
| **D-15** | Schema 版本兼容(serialize.ts SCHEMA_VERSION=3,含 v1/v2/v3 容错) | **A 完整保留**三档兼容逻辑(V1 已稳) | B 砍 v1 兼容 | A 让用户老画板能打开,选 A |

---

## 5. 阶段切片(对齐 V2 命名规则 L5-G 段)

按 v2-state-snapshot § 3.1 把 graph view 列在「整 view(从无到有)」大 epic,优先级"低-中"。本节给出**5 个连续切片**,对齐 V2 stage 节奏(C1~C5 是参考)。

工作流约定**沿用 B3.19 / C1~C5 的"段间不单独验收,末段统一验收清单"**(v2-state-snapshot § 修订记录 2026-05-09)。

⚠️ family-tree variant **不在 G1~G5 范围**(D-7=A);本迁移收尾后,family-tree 单立里程碑 H(对应业务规格里程碑 2,~3 天工作量)。

### G1 — 平台基座 + graph-library-store + view 骨架(~700 行)

**目标**:打开 V2 切到 graph-canvas view,能从 NavSide 创建画板,书架显示。

| 项 | 内容 |
|---|---|
| platform/main/graph/(全套) | canvas-store / folder-store(JSON 实现,模板 `learning/vocab-store.ts`)/ library-handlers / index.ts |
| shared/ipc/channel-names | 加 `GRAPH_*` 19 条 |
| platform/main/preload | 加 graph* invoke + on* 订阅 |
| capabilities/graph-library-store/ | client.ts + types.ts + index.ts + DESIGN.md |
| views/graph-canvas/ | index.ts + GraphCanvasView.tsx(空 view,挂"加载中" + "空状态")+ data-model.ts + nav-side-content.tsx(完整画板列表 UI 直迁,但点击画板暂不渲染内容)+ canvas-commands.ts + graph-canvas.css(壳样式) |
| 安装 npm `three`(锁版本) | package.json + ESLint `no-restricted-imports` 加 `three` 屏障(**白名单只含 `capabilities/canvas-rendering/`,严格版单点屏障,P1-1 v0.2 修订**) |
| 验收 | npm start → 切 graph-canvas view → NavSide 显「画板」+「+ 文件夹 / + 画板」→ 创建画板见列表更新 → 点击画板项左 slot 显「Loading」(G2 才填) |

### G2 — shape-library capability(~700 行 + 27 JSON,**P1-1 严格版口径修订**)

**目标**:能在 V2 启动时打 ShapeRegistry / SubstanceRegistry alive 行,Library 22 个 shape + 5 个 substance 全注册。**0 import three**。

| 项 | 内容 |
|---|---|
| capabilities/shape-library/ | types.ts(EvaluatedPath / EvaluatedSubstance 纯数据形态)+ shapes/registry.ts + shapes/renderers/(parametric 改写输出 EvaluatedPath / formula-eval 直迁)+ shapes/definitions/(22 JSON)+ shapes/bootstrap.ts + substances/registry.ts + substances/definitions/(5 JSON)+ substances/bootstrap.ts(composer / visual-rules 留空壳)+ index.ts + DESIGN.md(显式声明 0 three) |
| **path-to-three.ts** | **不在本段** — V1 library/shapes/renderers/path-to-three.ts(395 行)留到 G3 一起迁到 `capabilities/canvas-rendering/scene/` |
| 注册闭环 | `renderer/index.tsx` 加 `import '@capabilities/shape-library'`(对齐 learning 注册闭环修法) |
| smoke test | shapes/__smoke__/run.ts 直迁 + 改断言为"输出 EvaluatedPath 形状"+ npm 脚本可单跑 |
| 屏障自检 | grep 验证 `capabilities/shape-library/` 0 处 `import 'three'` / `import * from 'three'` / `import type from 'three'` |
| 验收 | npm start → console 显 `[Capability] alive | registered: [..., 'shape-library', ...]` + `Shape: 22, Substance: 5` 诊断行;G3 之前 Library 用不上,本段无 UI 验收;**屏障 grep 结果 0 命中** |

> **G2 LOC 微缩**(v0.1 ~1100 → v0.2 ~700):path-to-three 395 行迁出后剩 ~700 行;parametric.ts 内部"输出 THREE.Shape"改为"输出 EvaluatedPath"约 30 行重写。这一段总工作量基本不变,但分摊变化:G2 减少 ~400,G3 增加 ~400(详见 G3)。

### G3 — canvas-rendering capability + Host(基础渲染 + 选区 + 拖动)(~2000 行,P1-1 v0.2 +400 含 path-to-three)

**目标**:打开画板,能看到 Three.js 渲染,可视口缩放 / 平移 / 选中节点 / 拖动 / 删除。

| 项 | 内容 |
|---|---|
| capabilities/canvas-rendering/ | types.ts(CanvasHostHandle / Props)+ scene/(SceneManager 346 / NodeRenderer 818 / DotGrid 132,直迁)+ **scene/path-to-three.ts**(V1 `library/shapes/renderers/path-to-three.ts` 迁入 395 行,API 入口改为接收 shape-library 的 EvaluatedPath)+ interaction/(InteractionController 1975 砍 line/text/ui-overlay 部分,留单选/拖动/Delete/平移/缩放,~1000 行)+ Host.tsx(forwardRef 整合 scene + interaction)+ index.ts + DESIGN.md + styles.css |
| 节点渲染管线接线改造 | NodeRenderer 内部:V1 `shape-library.shapes.render(id, props)` 直拿 `THREE.Shape` → V2 `shape-library.shapes.evaluate(id, props)` 拿 `EvaluatedPath` + 内部调 `path-to-three(EvaluatedPath)` 拿 `THREE.Shape`(P1-1 严格版屏障落地) |
| views/graph-canvas/GraphCanvasView.tsx | 接 Host ref,实现 toolbar 缩放 / 适应内容 + 启动恢复(graphLoad → Host.loadDocument)+ 防抖保存(onInstancesChange → graphSave) |
| 屏障自检 | grep 验证 `capabilities/canvas-rendering/` 是**唯一** import three 的位置;view / shape-library / 其他 capability 0 处 import three |
| 验收 | 创建画板 → 渲染空画布 + 点阵网格底 → 滚轮 zoom / 拖空白 pan / Cmd+0 fitToContent → toolbar 缩放滑块同步;手测 deserialize V1 画板 JSON 能渲染(用 V1 导出的 .json 文件粘贴到 storage);**屏障 grep 结果只命中 canvas-rendering**|

### G4 — canvas-rendering 完整交互 + Library Picker / Inspector / Substance Combine + 文字节点(~3000 行)

**目标**:Canvas.md § 2.1 验收清单 17 项**除 Edit Substance API**全过(对齐 v1 里程碑 1)。

| 项 | 内容 |
|---|---|
| capabilities/canvas-rendering/scene/ | LineRenderer 181 + TextRenderer 197 + HandlesOverlay 278(直迁) |
| capabilities/canvas-rendering/interaction/ | InteractionController 剩余功能补齐(line 创建 press-drag-release / line rewire / OBB hit-test / resize 8 方向 / rotation handle / multi-select shift-click / box-select / Cmd+C/V 复制粘贴 / magnet-snap 182)|
| capabilities/canvas-rendering/ui/ | library-picker(442 行直迁)+ floating-inspector(521 行直迁)+ create-substance-dialog(~120 行直迁) |
| **capabilities/canvas-text-node/**(★ 文字节点 capability) | atom-bridge(121 直迁,改对接 text-editing converters)+ edit-session(GraphEditor + EditOverlay 合并,~250 行)+ inline-toolbar(371 直迁,UI 改对接 text-editing 命令)+ types.ts + index.ts + DESIGN.md + styles.css |
| views/graph-canvas/ | toolbarRegistry 注册 toolbar items / contextMenuRegistry 注册画板右键菜单 / canvas-commands.ts 加全部命令(graph-canvas.add-shape / .combine-substance / .duplicate / .delete / .undo / .redo / .copy / .paste / ...) |
| Host.tsx 集成 | textNode prop 注入(view 传 capability api) + Library Picker / Inspector 浮层挂载 + Inspector 改属性走 Host.updateInstance |
| 验收 | Canvas.md § 2.1 第 1~12 + 14~17 项全过(13 项 Edit Substance API 留 G6 / D-8) |

### G5 — Toolbar / 右键菜单对齐 V2 应用级框架 + 收尾验收(~600 行,P1-2 v0.2 修订标题)

**目标**:graph-canvas 的 toolbar / 右键菜单视觉与 NoteView / EBookView 一致(charter § 1.4)。**undo-redo / 剪贴板留 V1 自管,不在本段范围**(D-13=B / D-14=B)。

| 项 | 内容 |
|---|---|
| views/graph-canvas/index.ts | 把 G4 临时挂在 capability 内部的 Toolbar 内容、画板右键菜单内容,改注册到 toolbarRegistry / contextMenuRegistry |
| capabilities/canvas-rendering/ | 移除 Toolbar.tsx(385 行,内容已迁到 view registers)、ContextMenu.tsx(内容已迁到 view registers);保留 library-picker / floating-inspector / create-substance-dialog(画板内浮层) |
| **undo-redo / clipboard 留 V1 自管(P1-2 v0.2 修订)** | InteractionController 内已实现:50 步全量快照 undo/redo + view 内 Cmd+C/V 复制粘贴。**G1~G5 不接 V2 `undo-redo` / `clipboard` capability**;v1.5+ 这两个 capability 抽象到 view-agnostic(画板 mesh + JSON 状态可托管 / 剪贴板支持画板格式)后,再单独阶段把画板 install 进去 |
| graph 段落收尾验收清单 | 类似 B3.19 / C1~C5 § 3 整体清单,涵盖 G1~G5 全部行为(参考 § 9 验收清单) |

### 段落总量预估

| 段 | 增量 LOC(估)| V1 来源占比 |
|---|---|---|
| G1 | ~700 (driver) + ~100 (CSS) | 直迁约 70%(canvas-store + folder-store + ipc-handlers + GraphPanel 全套) |
| G2 | ~700 (driver) + 27 JSON 资源 | 直迁约 95%(library 整套,**P1-1 v0.2:path-to-three 395 行迁出到 G3,parametric ~30 行改写输出 EvaluatedPath**) |
| G3 | ~2000 + ~250 CSS | 直迁约 80%(SceneManager + NodeRenderer + DotGrid + path-to-three 395 + InteractionController 单选 / 拖动子集;**P1-1 v0.2:+400 含 path-to-three 迁入**) |
| G4 | ~3000 + ~400 CSS | 直迁约 75%(InteractionController 全 + Line/Text/Handles + LibraryPicker + Inspector + canvas-text-node) |
| G5 | ~600 + ~50 CSS | 重写约 60%(toolbar + 右键菜单从 capability 抽到 view registry) |
| **合计** | **~7000 driver + ~800 CSS + 27 JSON** | V1 ~9000 → V2 ~7800 driver(view 极简 + capability 颗粒化代价 + 画板内 UI 留 capability + 应用级 UI 抽到 view registry 微涨 + CSS 拆分) |

---

## 6. 与 charter 三大原则的对照自检

### 6.1 注册原则

| 自检项 | 落地 |
|---|---|
| view 通过 `install` 列表声明依赖 | `install: ['shape-library', 'canvas-rendering', 'canvas-text-node', 'graph-library-store']`(P1-2 v0.2 修订:G1~G5 范围内 4 个能力,**不含** `undo-redo` / `clipboard` — 后两者留 V1 自管,详见 D-13=B / D-14=B + § 5 G5 段) |
| **undo-redo / clipboard 在本迁移的归属** | **不通过 V2 capability 引入**(install 列表不含):画板的 undo/redo 与 view 内复制粘贴在 G3~G4 由 InteractionController 自管(V1 已实现 50 步快照 + Cmd+C/V);**注册原则闭环**判定:画板这两类交互不属于"通过 install 声明 + 由 capability 提供"路径,而是"view-scoped 内置交互",不进入 install-coverage 自检的 4 项 capability — 与 NoteView 走 V2 undo-redo / clipboard 是**不同路径**,**两路径并存合规**。等 v1.5+ 这两个 capability 抽象到 view-agnostic(画板 mesh + JSON 可托管 / 剪贴板支持画板格式)再切换到 install 路径 |
| 0 处 view 直 import capability 运行时值 | 类型 import 用 `import type ... from '@capabilities/.../types'`,运行时通过 `requireCapabilityApi(...)`(对齐 W5 严格态)|
| 0 处 view 直 import driver | graph-canvas 不引入 driver 层(本身画板渲染交给 capability,无 PM 文档 driver) |
| 命令实现走 commandRegistry,菜单引字符串 | toolbar / context-menu / keymap items `command: 'graph-canvas.add-shape'` 等 |
| capabilityRegistry 自注册 | `capabilities/shape-library/index.ts` / `capabilities/canvas-rendering/index.ts` / `capabilities/canvas-text-node/index.ts` / `capabilities/graph-library-store/index.ts` 各 `capabilityRegistry.register({ id, api })` |
| install-coverage 自检 | 启动时 console 显示 `graph-canvas × ['shape-library', 'canvas-rendering', 'canvas-text-node', 'graph-library-store']`(4 项,P1-2 v0.2),无 missing |

### 6.2 分层原则(纵向 + 横向)

| 自检项 | 落地 |
|---|---|
| 可视化层 0 业务 npm | view 0 处 `import 'three' / 'prosemirror-*' / 'electron'`(eslint 拦) |
| 能力层是 npm 唯一出入口 | 仅 `capabilities/canvas-rendering/scene/*` 7 文件见到 `three`(含 path-to-three.ts);仅 `capabilities/text-editing/` 见 `prosemirror-*`(canvas-text-node 通过 capability registry 间接消费,**0 处 import prosemirror-***);**shape-library 0 import three**(P1-1 严格版屏障 v0.2)|
| 语义层 0 npm | 类型在 `capabilities/.../types.ts`;Atom 类型继续在 `semantic/atom-types.ts`(画板 Instance 类型挂 capability,不升格 Atom) |
| 存储层 IPC 提供 | 走 `platform/main/graph/library-handlers.ts`,renderer 不直触 store |
| view → view 0 直连 | Canvas API(被 family-tree 调)走 workspace-bus(留 D-8 选 B 后再做) |
| capability → slot 0 反向 | shape-library / canvas-rendering / canvas-text-node / graph-library-store 不 import `@slot/workspace-bus`(对齐 W3.3 修)|
| **canvas-text-node 跨 capability 调 text-editing** | canvas-text-node 内部 `requireCapabilityApi('text-editing')` —— 这是允许的(同层之间通过 capabilityRegistry 间接,不破屏障);类型 import 走 `@capabilities/text-editing/types`(纯类型) |

### 6.3 抽象原则(npm 屏障)

| 外部 npm | 归属 | 屏障验证 |
|---|---|---|
| `three` | capability.canvas-rendering(scene/* 7 个文件,含 path-to-three.ts)| view / driver / shell / workspace / slot / capability(**含 shape-library**)0 import — P1-1 严格版单点屏障 |
| `prosemirror-*` | capability.text-editing(已有屏障) | canvas-text-node 0 import,通过 capabilityRegistry 间接调用 |
| `electron`(`dialog.showOpenDialog` 等) | platform/main + main-process IPC handler | renderer 通过 `window.electronAPI.graph*` 调用 |
| `surrealdb` | **不引入**(D-3=B)| 本迁移走 JSON 文件,sdk 留给 W6 epic |
| `node:fs` / `node:path` / `electron.app.getPath` | platform/main/graph(JSON 文件 atomic write) | renderer 0 import,沿用 `learning/vocab-store.ts` 模板 |

### 6.4 charter § 1.4 视图与实现归属自检

| 三层归属类型 | 在本迁移的落地 |
|---|---|
| **应用级 UI 在 Workspace Container** | graph-canvas 的 Toolbar / 画板右键菜单 → 内容由 view 注册到 toolbarRegistry / contextMenuRegistry,**式样由 Workspace Container 提供**(D-11 / D-12);view 不写式样 |
| **能力级 UI 在 Capability** | 画板**内**浮层(LibraryPicker / FloatingInspector / CreateSubstanceDialog / DotGrid / HandlesOverlay / Inline Toolbar 文字节点编辑态)归 capability(canvas-rendering / canvas-text-node 内部 ui/);view 不写 UI(D-10) |
| **View 是能力组合声明** | GraphCanvasView.tsx ≤200 行,只做「订阅 + Host 编排 + 命令路由」;0 UI 实现代码 |

---

## 7. 与 V2 既有阶段的衔接

| 阶段 | 关系 |
|---|---|
| **L4.1 Help Panel Registry** | graph-canvas v1 不消费 help-panel(画板内 LibraryPicker / Inspector 走 capability 自管浮层,不走 help-panel)— 长期可考虑「Substance 详情面板」做 help-panel sub-panel,属画板主功能后的精修阶段 |
| **L5-B3.4 link-click plugin** | NoteView 内 `krig://graph/{graphId}` 协议路由到 graph-canvas view → 需要 link-click plugin 加 `krig://graph` handler(沿用 `krig://note` / `krig://book` 方式,留 family-tree / cross-view linking 阶段一起)|
| **L5-B3.12 noteLink 双链** | Canvas note 内的文字节点 atom 中如果包含 `noteLink` inline atom,通过 canvas-text-node + text-editing 自动支持(零额外工作 — text-editing capability 已有 noteLink 实现)|
| **L5-C 系列(ebook)** | 完全无关,不交叉(graph 不依赖 ebook,反之亦然) |
| **L5-B3.20 learning** | 不接 graph(画板内文字节点不接生词本,留 graph 主功能稳定后再考虑)|
| **family-tree variant(里程碑 2)** | G5 收尾 + 验收稳定 ≥ 2 周 → 单独阶段实施(对齐 v1 里程碑 2 的 ~3 天工作量,family-tree.md § 7);依赖本迁移产出的 shape-library / canvas-rendering / canvas-text-node 三个 capability + Canvas API(D-8) |

---

## 8. 风险登记

| 风险 | 缓解 |
|---|---|
| Three.js 版本与 Electron 兼容(WebGL context loss / Retina) | 锁定 V1 实战版本 + capability DESIGN.md 单独章节标注 + 沿用 V1 内的 Retina 三参数防御(memory feedback_threejs_retina_setsize) |
| InteractionController 1975 行直迁巨块,migrate 时容易引入回归 | G3 / G4 拆两段(G3 单选 / 拖动 / 视口;G4 line / 多选 / 复制粘贴 / 文字节点)— 段间 commit 但不 merge;每段跑 Canvas.md § 2.1 子集验收;末段跑全 17 项 |
| canvas-text-node 跨 capability 调 text-editing 时 PM 实例化时序问题(白屏第 4 次教训 — feedback_external_sdk_lifecycle) | edit-session.ts 内 PM 实例化用 `useEffect + readyRef` 守门,等 capability ready 才调 createInstance;memory 已记录路径 |
| Library Picker 浮层与 V2 应用级 ContextMenu 视觉冲突 | 严格区分:Picker 是画板内浮层(D-10 归 capability,自管样式),与 ContextMenu(D-11 归 view registry,Workspace Container 管样式)不混用 |
| undo/redo 实现路径(D-13=B,**v0.2 已落定**)| V1 自管 50 步快照,**G1~G5 不接 V2 `undo-redo` capability**;v1.5+ undo-redo 抽象到 view-agnostic 后切到 install 路径 |
| 复制粘贴实现路径(D-14=B,**v0.2 已落定**)| view 内自管 Cmd+C/V,跨 view 留后续;**G1~G5 不接 V2 `clipboard` capability**;v1.5+ clipboard 兼容画板格式后切到 install 路径 |
| 画板内 Toolbar 添加模式状态(addMode)与 V2 toolbarRegistry 模型适配 | toolbarRegistry 注册 toolbar items 时,addMode 信息走 view 端 React state,toolbar item 通过 visibleWhen / activeWhen 反射(对齐 NoteView toolbar 的「has-selection」模式)|
| 画板视口 zoom + Retina 双重缩放 + ResizeObserver 三联 bug 出现概率高 | SceneManager 直迁 V1(已稳),G3 验收明确包含「Retina 屏 + 容器 resize + 内容渲染对齐」一项 |
| ESLint `no-restricted-imports` 加 `three` 屏障可能误伤(如 `@types/three` 类型 import)| 配置允许 `import type`;capability 边界外允许 `import type from 'three'`(纯类型),禁止 `import {...} from 'three'`(运行时值) |

---

## 9. 验收标准(草案,G5 收尾时正式落清单)

### 9.1 Canvas v1 业务功能(对齐 Canvas.md § 2.1 17 项)

| # | 操作 | 期望 |
|---|---|---|
| 1 | NavSide 「+ 画板」 | 创建 Canvas → 自动打开 |
| 2 | 浏览 Library Picker | 见 22 个 shape + 5 个 substance |
| 3-4 | 添加 shape / substance | 点击位置实例化 + 自动选中 |
| 5 | 单击节点 | 蓝边框 + 8 resize + rotation handle;Inspector 不自动开 |
| 6 | 双击节点 → Inspector | Inspector 浮层开 + 改 fill / line / size 视觉立刻同步 |
| 7 | 拖动节点 | 跟随鼠标 + 连接的 line 跟随 |
| 8 | 选中节点 Delete | 节点删 + 连接 line 删 |
| 9 | 滚轮 | zoom-to-cursor |
| 10 | 拖空白 | pan(zoom 不变) |
| 11 | 关画板 → 重新打开 | 内容 + 视口完整恢复 |
| 12 | Shift-click 多选 → Combine | 弹对话框 + 创建 substance + 实例替换 |
| 13 | 选中 substance 实例 → Edit Substance | **D-8=A 不在本迁移范围**(family-tree 阶段一起做)|
| 14 | line 端点跟随 magnet | shape 移动 / 旋转,line 端点跟随 |
| 15 | 创建 line | 从 magnet press-drag-release 到另一 magnet,落空取消 |
| 16 | rewire line | 拖端点 handle 改连接,落空恢复 |
| 17 | 旋转 + magnet | line 端点跟随旋转后 magnet 位置 |

### 9.2 文字节点(canvas-text-node)

- [ ] 双击文字节点 → 进入编辑态浮层
- [ ] PM 编辑(粗体 / 斜体 / etc.) — 通过 text-editing capability,不自建 schema
- [ ] inline toolbar 显示
- [ ] 编辑结束 → atom 序列化进 instance.doc + 文字 SVG 重渲染
- [ ] noteLink 双链 `[[note-title]]` 在文字节点内可用(零额外代码,text-editing 已实现)

### 9.3 三大原则物理保证

- [ ] view 文件夹 `views/graph-canvas/` 0 处 `import 'three'`(grep 验证)
- [ ] view / driver / slot / shell / workspace 0 处 `import 'three'`(grep 验证)
- [ ] view 0 处 `import 'prosemirror-*'`(grep 验证)
- [ ] 所有 capability 通过 `capabilityRegistry.register` 注册(install-coverage 自检 0 missing,4 项命中:shape-library / canvas-rendering / canvas-text-node / graph-library-store)
- [ ] graph-canvas 的 install 列表**不含** `undo-redo` / `clipboard`(P1-2 v0.2 — 留 V1 自管,符合 D-13=B / D-14=B 决议)
- [ ] graph-canvas Toolbar / 画板右键菜单与 NoteView / EBookView 视觉一致(D-11 / D-12 落地)
- [ ] capability 内部 ui/(LibraryPicker / Inspector / Dialog)Workspace Container 不接管(D-10 落地)
- [ ] typecheck 0 error / lint 0 warn

### 9.4 数据迁移

- [ ] V1 Canvas note(SurrealDB schema_version=2/3)能在 V2 (JSON) 下打开渲染(sanitize 兼容 V1 → V2)
- [ ] V2 创建的画板能正确序列化 / 反序列化(round-trip)

### 9.5 性能基线

- [ ] 100 节点画板交互流畅(≥ 60fps)
- [ ] 切换画板加载 ≤ 500ms

---

## 10. 待拍板列表(总览)

| 决策 | 推荐 | 必须在 G1 之前定 |
|---|---|---|
| D-1 view id | A `graph-canvas` | ✅ |
| D-2 业务字段位置 | A pluginStates | ✅ |
| D-3 持久化后端 | **B JSON 文件**(对齐 ebook D-3=B) | ✅ |
| D-4 持久化归位(随 D-3=B) | **B 过渡态 platform/main/graph(JSON)→ W6 epic 落地后升 src/storage/graph/(SurrealDB)** | ✅ |
| D-5 shape-library 是否独立 capability | **A 独立** | ✅ |
| D-6 canvas-text-node 是否独立 capability | **A 独立** | ✅ |
| D-7 family-tree variant 是否本迁移 | **A 不做**(留里程碑 H) | ✅ |
| D-8 Canvas 调用 API 是否本迁移 | **A 不实施,API 形状预留** | ✅ |
| D-9 Substance 持久化 | **A 沿用嵌入式**(v1 行为) | ✅ |
| D-10 画板内浮层归属 | **A 归 capability** | ✅ |
| D-11 画板右键菜单 | **A 走 V2 contextMenuRegistry** | ✅ |
| D-12 Toolbar | **A 走 V2 toolbarRegistry** | ✅ |
| D-13 undo/redo | **B V1 自管 50 步**(v0.2 已落定 — A 需先扩展 undo-redo capability) | ✅ |
| D-14 复制粘贴 | **B view 内自管**(v0.2 已落定 — A 需先验证 clipboard capability 兼容画板格式) | ✅ |
| D-15 Schema 版本兼容 | **A 完整保留**三档(v1/v2/v3) | G3 之前 |

---

## 11. 与 family-tree(里程碑 H,本迁移之后)的衔接

family-tree variant 是本迁移**之后**的独立阶段。它对本迁移产出的能力的依赖关系:

```
family-tree variant 依赖
├── capability.shape-library          ← 复用 22 shape + 5 substance(family-tree.md § 1.6)
├── capability.canvas-rendering       ← 复用 Three.js 渲染(family-tree.md § 4.1)
├── capability.canvas-text-node       ← (可选)节点 label 编辑
├── capability.graph-library-store    ← 复用画板列表 + 文件夹
└── 自身新增:
    └── capability.family-tree-projection
         (parser/parse-note + layout/walker-tidy + projection/visual-rules + spouse-line + parent-edge)
```

**family-tree 不创建独立 view** — 它走 `view: 'graph-canvas'` + `frontmatter.variant: 'family-tree'`(对齐 Canvas.md § 0.3 + family-tree.md § 0.1)。view 注册时 install 列表加 `'family-tree-projection'`,GraphCanvasView 内根据 frontmatter.variant 切换是否启用 projection 旁路(只读、自动布局、不可拖动)。

⚠️ family-tree 业务规格已写,但 V1 **未实现**;本迁移后单独立项实施(预估 ~3 天 + 验收 0.5 天,family-tree.md § 7)。

---

## 12. 修订记录

| 日期 | 版本 | 内容 | 作者 |
|---|---|---|---|
| 2026-05-10 | v0.1 | 初稿;V1 graph 9000 行盘点 + V2 三层归属拆分(view/4 capability/platform)+ 5 段切片 G1~G5 + 15 决策点 + 与三原则对照自检 + 验收清单草案 + family-tree(里程碑 H)衔接说明 | wenwu + Claude |
| 2026-05-10 | v0.2 | 用户 v0.1 审计修正(2 条阻塞级一致性问题):**P1-1 three 屏障严格版统一** — `three` 只允许 `capabilities/canvas-rendering/` import,`shape-library` 不再含 `path-to-three.ts`(v0.1 双点屏障与开篇"唯一屏障"口径冲突 → v0.2 单点屏障);path-to-three(395 行)从 shape-library 迁到 canvas-rendering/scene/;shape-library API 由"输出 THREE.Shape"改为"输出 EvaluatedPath / EvaluatedSubstance 纯数据";G2 LOC -400 / G3 LOC +400(总量不变);全文统一 7 处 three 屏障描述。**P1-2 install 列表口径与 D-13/D-14 自洽** — v0.1 install 列表含 `undo-redo` / `clipboard` 但 D-13/D-14 推荐 B(V1 自管),口径冲突 → v0.2 删除 install 列表中的 `undo-redo` / `clipboard`(只剩 4 项 capability),并在 § 6.1 自检表加"画板 undo/clipboard 走 view-scoped 内置路径,与 NoteView 走 capability 是不同路径,两路径并存合规";D-13 / D-14 推荐项标注从"初步推荐"升级为"v0.2 已落定 B"(对齐文档其他位置 G5 段措辞);决策总览 § 10 D-13 / D-14 行勾"必须 G1 之前定 = ✅";验收 § 9.3 加 install 列表 4 项命中清单。修订涉及 § 0 / § 1.2 / § 2.2 / § 3.1 / § 3.2 / § 3.3 / § 5(G2 / G3 / G5 + 段落总量预估表)/ § 6.1 / § 6.2 / § 6.3 / § 8 / § 9.3 / § 10 共 13 节。**v0.2 修订后用户 P2 复审补丁(同日)**:§ 5 段落总量预估表数字与 G2/G3 标题对齐 — G2 ~1100 → ~700,G3 ~1600 → ~2000(反映 P1-1 path-to-three 395 行从 G2 迁到 G3),合计 ~7000 driver 不变 | wenwu + Claude |
