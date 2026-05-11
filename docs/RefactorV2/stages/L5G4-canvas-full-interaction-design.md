# L5-G4 设计 — canvas-rendering 完整交互 + Library Picker / Inspector + canvas-text-node

> v0.2 · 2026-05-11 · 实施前用户 P1 复审(删除 G4-2 回退到违规路径的文本;W5 严格态 A 边界不可破)
>
> 配套:
> - 上游 plan:[../v1-graph-migration-plan.md](../v1-graph-migration-plan.md) v0.2 § 5 G4
> - 业务规格:[../../10-business-design/graph/canvas/Canvas.md](../../10-business-design/graph/canvas/Canvas.md)(§ 2.1 17 项验收)
> - 同位参考:[./L5G3-canvas-rendering-design.md](./L5G3-canvas-rendering-design.md) v0.3 + completion
> - **设计纪律**:[L5G3-completion § 6 教训登记](./L5G3-canvas-rendering-completion.md) "减量 ≠ 重写,只能砍" — 本段所有 interaction / scene 代码强制按 V1 直迁 + 整段砍模式
>
> **本段定位**:Graph 迁移 5 段切片(G1~G5)第 4 段,**最重段**(总量约 G1+G2+G3 之和)。补回 V1 line / text / handles / 文字编辑 / Library Picker / Inspector / Combine Dialog 全部 graph 主功能。

---

## 0. 一句话目标

Canvas.md § 2.1 v1 验收清单 17 项中 **第 1~17 项**(除第 13 项 Edit Substance API 留 G6 / D-8 不在本迁移)全部通过 → 对齐 V1 里程碑 1。

---

## 1. 范围(In/Out)

### 1.1 本段做(In)

按 4~5 个 commit 子段实施(plan v0.2 G4 一段口径不变,内部拆 commit):

**G4.1 — scene 补齐 + NodeRenderer 还原 line/text**(估 ~1100 行)
- `capabilities/canvas-rendering/scene/LineRenderer.ts`(V1 181 直迁,只依赖 three + LineStyle 类型,无其他依赖)
- `capabilities/canvas-rendering/scene/TextRenderer.ts`(V1 197 直迁)
- `capabilities/canvas-rendering/interaction/magnet-snap.ts`(V1 182 直迁;依赖 ShapeRegistry / SubstanceRegistry — 通过 requireCapabilityApi('shape-library') 拿)
- `capabilities/canvas-rendering/scene/NodeRenderer.ts`:**还原 V1 818 行的 line/text 分支**(目前 V2 是 446 行减量版,占位灰矩形 — G4.1 砍占位,接 LineRenderer / TextRenderer / atom-bridge 真渲染);需要预先把 atom-bridge stub 引入(G4.4 才真接 canvas-text-node)
- 验收:**点开 G3 测试画板,line 节点变成真线段 + magnet 跟随两端;text label 还是占位灰矩形**(text 真渲染需 canvas-text-node 全套,本段先 wire 接口形态)

> ⚠️ 顺序考虑:NodeRenderer 文字节点真渲染 = TextRenderer(SVG) + atom-bridge(NoteAtom → atomsToSvg 内部用的 PM JSON 形态) — 后者依赖 PM converter,**需要 canvas-text-node capability ready**.G4.1 范围内 text 仍用 G3 占位,**仅 line 真渲染**.

**G4.2 — InteractionController 补 HandlesOverlay + resize/rotate + OBB hit-test + Cmd+C/V/Z**(估 ~900 行)
- `capabilities/canvas-rendering/scene/HandlesOverlay.ts`(V1 278 直迁;依赖 SceneManager + RenderedNode + isTextNodeRef 工具)
- InteractionController **按 [G4 砍] placeholder 注释一对一补回 V1 代码**(对齐 G3 教训):
  - resize 状态字段 + `startResize / applyResize / applyResizeSizeLock`(V1 1254-1402)
  - rotation 状态字段 + `startRotate / applyRotate`(V1 1304-1432)
  - OBB hit-test `hitTestByWorldOBB`(V1 804-828)
  - undo/redo stack 字段 + `pushHistory / undo / redo / applySnapshot`(V1 1433-1487;**D-13=B 留 V1 自管,本段实施**)
  - Cmd+C/V 复制粘贴(V1 InteractionController handleKeyDown 内 Cmd+C/V 分支;**D-14=B 留 V1 自管,本段实施**)
  - HandlesOverlay 接线:mousedown 优先 handle hitTest → 走 startResize / startRotate(V1 376-386)
- view 端 GraphCanvasView 加 hostRef.undo / redo 调用方便 Cmd+Z(view 内 keymap 监听 — 可选)
- 验收:**单选节点显示 8 个 resize handle + 1 个 rotation handle**;拖动 handle 改 size / rotation;Cmd+C 复制 → Cmd+V 粘贴(屏幕中心新建);Cmd+Z 撤销 / Cmd+Shift+Z 重做

**G4.3 — InteractionController 补 marquee + addMode(画 line)+ multi-select 拖动**(估 ~700 行)
- InteractionController 补:
  - marquee 状态字段 + `startMarquee / updateMarquee / finishMarquee / cancelMarquee`(V1 1110-1168)
  - 多选拖动(已经在 V1 mousemove 内,本段把 dragging.snapshots 扩展到 multi-select)
  - addMode 状态字段 + `enterAddMode / exitAddMode / isAddMode / placeInstance`(V1 217-241 + 429-464)
  - line 创建 + rewire 状态字段 + `tryStartDrawingLine / updateDrawingLine / tryFinishDrawingLine / cancelDrawingLine / startRewire / updateRewire / tryFinishRewire / cancelRewire`(V1 874-1108)
  - magnet hints overlay + `refreshMagnetHintsForHover / findShapesNearMouse / showMagnetHintsFor / clearMagnetHints`(V1 1169-1252)
  - line endpoint handles + `refreshLineEndpointHandles / clearLineEndpointHandles / resolveLineWorldEndpoints / hitTestLineEndpointHandle`(V1 1524-1611)
- 验收:**空白处拖 = marquee 框选;Shift-click 加多选;addMode 进入后画布点击实例化 shape;Picker 选 line → 从某 magnet press-drag-release 拖到另一 magnet → 创建 line**

**G4.4 — UI 浮层(Library Picker / Floating Inspector / Combine Dialog)**(估 ~1100 行)
- `capabilities/canvas-rendering/ui/library-picker/index.tsx`(V1 442 + preview-svg ~200 = ~640 直迁)
- `capabilities/canvas-rendering/ui/floating-inspector/index.tsx`(V1 521 直迁)
- `capabilities/canvas-rendering/ui/create-substance-dialog/index.tsx`(V1 223 直迁)
- `capabilities/canvas-rendering/Host.tsx` 集成:Picker / Inspector / Dialog 浮层挂载(画板内浮层归 capability 内部,charter § 1.4)
- view 端 GraphCanvasToolbar 加 `+ 添加` 按钮(触发 Picker)+ multi-select 时 Combine 按钮
- 验收:**Picker 选 shape → 进添加模式 → 点击画布实例化;Picker 选 substance → 同;Inspector 双击节点打开 → 改 fill/line/size 视觉立即更新;多选 → Combine to Substance 弹对话框 → 创建 substance**

**G4.5 — canvas-text-node capability(文字节点 PM 桥接)**(估 ~1100 行,**本段最难子段**)
- 新建 `src/capabilities/canvas-text-node/` capability:
  - `types.ts`:`CanvasTextNodeApi / EnterEditOptions / EditSession`(plan v0.2 § 3.5)
  - `atom-bridge.ts`:V1 121 行改对接 text-editing capability 的 `atomsToProseMirror`(V2 已暴露)+ 反向 `prosemirrorToAtoms`(可能需扩展 text-editing API)
  - `edit-session.ts`:V1 GraphEditor 167 + EditOverlay 197 合并瘦身 ~250 行;**关键改造**:V1 GraphEditor 直接 `import { blockRegistry } from '@plugins/note/registry'` + `buildSchema / buildBlockPlugins`,V2 这些迁到了 driver 内部,view/capability 不可见 → 改方案:**复用 V2 text-editing.Host 作为子 PM EditorView 挂载点**(text-editing.Host 已经是完整 PM 实例,canvas-text-node 把它嵌入 EditOverlay 的 popup 内部)
  - `inline-toolbar/index.tsx`:V1 371 行直迁 — 不接 text-editing 命令,自管 mark toggle(对齐 V1 模式;V2 floating-toolbar 跟 text-editing.Host 内部已绑定,canvas-text-node 不复用)
  - `index.ts`:capabilityRegistry.register({ id: 'canvas-text-node', api })
  - `DESIGN.md`
- NodeRenderer 文字节点真渲染:接 `canvas-text-node.atomBridge.atomsToSvgInput` 转 atoms → SVG;G3 占位灰矩形改为真 SVG mesh
- Host.tsx textNode prop 接入(view 注入)+ 双击文字节点 → `canvas-text-node.enterEdit(opts)` 打开 EditOverlay
- view install 列表 `canvas-text-node` 归零(install-coverage missing 1 → 0)
- 验收:**双击文字节点 → 弹 EditOverlay → 在 PM 编辑器内打字 / B / I / 公式 / link 等 / Esc 退出 / 内容更新 SVG mesh**

### 1.2 本段不做(Out)

- ❌ **D-8 Canvas API**(family-tree 等 view 调 canvas 创作 substance)— 留独立阶段(family-tree variant 启动时一并实施)
- ❌ Toolbar 注册到 V2 toolbarRegistry(G5)
- ❌ 画板右键菜单走 V2 contextMenuRegistry(G5)
- ❌ Substance 独立 note 化(D-9=A 沿用嵌入式)
- ❌ family-tree variant(里程碑 H)

---

## 2. 决策清单

| # | 决策点 | A(默认) | B(替代) | 推荐 |
|---|---|---|---|---|
| **G4-1** | 子段拆分粒度(plan G4 一段口径下) | **A 4~5 commit 子段**(G4.1 scene + G4.2 handles + G4.3 marquee/addMode + G4.4 UI + G4.5 canvas-text-node)| B 单 commit | **A** — G3 教训:巨变 commit 容易卡;每子段独立 typecheck + lint + 手测;最后统一合 main |
| **G4-2** | canvas-text-node 内 PM 实例化路径 | ❌ A 直迁 V1 GraphEditor(import @drivers/text-editing-driver 直接拿 blockRegistry)— **W5 严格态 A 边界硬约束:capability 不直 import @drivers/* 运行时**,本选项不可行,仅作历史记录(V1 模式) | **B 复用 text-editing.Host 作为子 PM 挂载** — Host 是 React 组件,canvas-text-node 把它嵌入 EditOverlay popup 内 | **B**(唯一合规路径) — V2 text-editing.Host 是完整 PM EditorView,canvas-text-node 当"管理 popup 浮层 + 注入初始 atoms + 接编辑结果回调"的薄壳即可;**如 Host 当前不支持嵌入 + 自定义 plugin,见 § 7 风险表 — 走"扩展 text-editing API"前置子任务,不走任何回退** |
| **G4-3** | canvas-text-node 内 InlineToolbar(选区浮工具栏)| **A 直迁 V1 InlineToolbar 371 行**(自管 mark toggle) | B 复用 V2 floating-toolbar-registry 注册项 | **A** — V1 InlineToolbar 是浮层内**独立小工具栏**,跟 V2 floating-toolbar(应用级)定位不同;且 V2 floating-toolbar 跟 text-editing.Host 内部已耦合,跨 view 复用复杂.G5 时若需统一可再评估 |
| **G4-4** | atom-bridge 反向 prosemirrorToAtoms 路径 | A 让 text-editing API 加 `prosemirrorToAtoms` 方法 | **B canvas-text-node 内部自管反向转换**(用 PM doc.toJSON 后,自己写转换器) | **A** — text-editing 已经有 atomsToProseMirror,加配对的 prosemirrorToAtoms 是同位扩展;V2 text-editing.Host 编辑时 view 拿到的是 DriverSerialized(PM JSON),atom 转换在 capability 内部.**预留 G4.5 子段实施**;如 text-editing 内部反向已存在(可能在 ebook extraction 链路里也有),直接复用 |
| **G4-5** | undo/redo 实现 | **A V1 50 步快照模式**(InteractionController 内 pushHistory)| B 接 V2 `undo-redo` capability | **A** — 对齐 D-13=B 决议;画板状态是 Three.js mesh + JSON,V2 undo-redo 当前只针对 PM 文档;后续 v1.5+ 评估抽 view-agnostic |
| **G4-6** | Cmd+C/V 实现 | **A V1 view-scoped 自管**(InteractionController 内 handleKeyDown 接 Cmd+C/V) | B 接 V2 `clipboard` capability | **A** — 对齐 D-14=B 决议;画板剪贴板格式 = `Instance[] JSON`,跨 view 粘贴留 v1.5+ |
| **G4-7** | NodeRenderer text 真渲染时机 | A G4.1 一起补 | **B G4.5 一起补**(依赖 canvas-text-node atom-bridge) | **B** — G4.1 时 text 仍占位灰矩形,只 line 真渲染;G4.5 接 canvas-text-node 时一并把 NodeRenderer text 分支补回 |
| **G4-8** | Library Picker 触发入口 | A Toolbar `+ 添加` 按钮(G4.4 自管 UI) | B 右键菜单(G5)| **A** — V1 模式;G5 时若 Toolbar 改注册系统,Picker 触发点跟着改 |
| **G4-9** | LibraryPicker 内 Substance 项的 thumbnail | A 直迁 V1 preview-svg(用 shape-library evaluate + 自己画 SVG) | B 用占位图标 | **A** — V1 实证,SVG 缩略图视觉直观 |
| **G4-10** | InteractionController 改造方式 | **A 按 [G4 砍] placeholder 注释一对一补回 V1 行号** — 不重写 | B 重新设计 | **A**(charter § 6.5 教训) — G3 教训登记的核心纪律;先补字段,再补方法,再补 import,最后改 mouseDown/Move/Up 路由 |
| **G4-11** | UI 文件归属 | **A canvas-rendering/ui/**(画板内浮层归本 capability,charter § 1.4 第二条)| B views/graph-canvas-view/components/ | **A** — 对齐 G3 design D-10 决策(画板内浮层归 capability) |
| **G4-12** | 子段间是否中途 merge main | A 每子段独立合 main | **B 全 5 子段在 G4 分支跑完后统一合** | **B** — plan v0.2 G4 单段口径;且 G4.1~G4.5 之间相互依赖(NodeRenderer text 改回 G4.5 时,G4.1~G4.4 才能完整测) |

---

## 3. 文件清单(物理路径 + LOC 估算)

### 3.1 新增

```
src/capabilities/canvas-rendering/
├── scene/
│   ├── LineRenderer.ts            ~181 行(V1 直迁;依赖 three + LineStyle 类型;无其他依赖)
│   ├── TextRenderer.ts            ~197 行(V1 直迁;依赖 three;atomsToSvg 接 canvas-text-node atom-bridge)
│   └── HandlesOverlay.ts          ~278 行(V1 直迁;依赖 three + SceneManager + RenderedNode + isTextNodeRef)
├── interaction/
│   └── magnet-snap.ts             ~182 行(V1 直迁;依赖 shape-library API)
└── ui/                            画板内浮层(G4-11=A 归 capability)
    ├── library-picker/
    │   ├── index.tsx              ~442 行(V1 直迁)
    │   └── preview-svg.ts         ~200 行(V1 直迁)
    ├── floating-inspector/
    │   └── index.tsx              ~521 行(V1 直迁)
    └── create-substance-dialog/
        └── index.tsx              ~223 行(V1 直迁)

src/capabilities/canvas-text-node/    ★ 新 capability(plan v0.2 § 3.5)
├── types.ts                       ~80 行(CanvasTextNodeApi / EnterEditOptions / EditSession)
├── atom-bridge.ts                 ~150 行(V1 121 改对接 text-editing API)
├── edit-session.ts                ~280 行(V1 GraphEditor 167 + EditOverlay 197 合并;G4-2=B 复用 text-editing.Host)
├── inline-toolbar/index.tsx       ~371 行(V1 直迁,G4-3=A 自管)
├── index.ts                       ~80 行(capabilityRegistry.register + 双导出 + alive 行)
├── styles.css                     ~60 行(V1 graph.css 内 EditOverlay 相关样式迁入)
└── DESIGN.md                      ~150 行

合计估算:driver ~3245 + DESIGN ~150 + CSS ~60(单段)
```

### 3.2 修改

```
src/capabilities/canvas-rendering/
├── scene/NodeRenderer.ts          减量版 446 行 → ~700 行(补回 V1 line/text 分支;G4-7=B text 在 G4.5 一起补)
├── interaction/InteractionController.ts  415 行 → ~1500 行(按 [G4 砍] placeholder 补回 V1 marquee/resize/rotate/drawingLine/rewire/magnetHints/addMode/undo-redo/Cmd+C+V/HandlesOverlay 路由)
├── Host.tsx                       196 行 → ~280 行(集成 Picker/Inspector/Dialog 浮层 + textNode prop)
├── types.ts                       189 行 → ~220 行(补 AddModeSpec + 内部 props)
└── index.ts                       62 行 → ~70 行(API 加 install textNode prop 转发)

src/views/graph-canvas-view/
├── GraphCanvasView.tsx            249 行 → ~280 行(双击触发 enterEdit + Picker 触发 + Combine 触发)
├── GraphCanvasToolbar.tsx         93 行 → ~130 行(加 + 添加 按钮 + Combine 多选按钮)
└── canvas-commands.ts             161 行 → ~200 行(加 add-shape / combine-substance / duplicate / copy / paste / undo / redo 命令)

src/platform/renderer/index.tsx    +1 行 import '@capabilities/canvas-text-node'
src/views/graph-canvas-view/index.ts   install 列表 4 项无需改(canvas-text-node 已在)
```

> v0.2 plan § 5 G4 估算 ~3000 行 + ~400 CSS — 本设计估 ~3245 新增 + ~1700 改写(主要 InteractionController 415→1500 + NodeRenderer 446→700 + view 集成胶水)= ~4945 行总操作.比 plan 估算 +60%,合理(plan 当时没单独算 NodeRenderer 还原 / view 集成).

### 3.3 子段间依赖图

```
G4.1 scene 补齐(LineRenderer + TextRenderer + magnet-snap + NodeRenderer 还原 line)
   ↓ (LineRenderer + magnet-snap 给 G4.3 line 创建用)
G4.2 InteractionController handles + resize/rotate + Cmd+C+V+Z
   ↓ (HandlesOverlay 给 G4.3 mouseDown 优先级用)
G4.3 marquee + addMode + line 创建/rewire + magnet hints
   ↓ (addMode + LibraryPicker 配套)
G4.4 UI 浮层(Picker + Inspector + Dialog)
   ↓ (Inspector / Combine 触发 Substance 创建)
G4.5 canvas-text-node capability + NodeRenderer text 真渲染
   ↓ (install-coverage missing 1 → 0)
G4 收尾(本段单段 merge main)
```

子段间**共享分支** `feature/L5G4-canvas-full-interaction`,每子段独立 commit(每个 commit 自包含可 typecheck + lint + 用户验收);**全 5 commit 完成后统一 merge main**(G4-12=B).

---

## 4. P1-1 严格屏障保持

本段大量新增 capability 内代码 + 1 个新 capability(canvas-text-node):

- **canvas-rendering**:已是 three 唯一允许位置;G4.1/4.2/4.3 直迁的 LineRenderer / TextRenderer / HandlesOverlay 全部加进来,three import 命中数从 G3 的 7 文件涨到 ~10 文件
- **canvas-text-node**:依赖 `prosemirror-*`(通过 text-editing capability 间接),不 import three;ESLint 默认 capabilities/** 禁 three 自动覆盖
- **shape-library**:不动,保持 0 import three
- **graph-library-store**:不动

屏障 grep 自检:
```sh
grep -rn "from 'three'" src/ --include="*.ts" --include="*.tsx" | grep -v "canvas-rendering"
# 期望 0 命中
grep -rn "from 'prosemirror" src/ --include="*.ts" --include="*.tsx" | grep -v "text-editing\|note/"
# 期望 0 命中(canvas-text-node 0 直 import prosemirror,通过 text-editing.Host 间接)
```

---

## 5. 自我诊断 + 完成判据

启动 console 期望:

```
[shape-library] alive | shapes: 22, substances: 5
[canvas-rendering] alive | three: 184, scene/interaction ready
[canvas-text-node] alive | text-editing ready
[install-coverage] ✅ install 覆盖率自检:5 views · 17 capabilities · 缺失 0
  graph-canvas-view × ['graph-library-store','shape-library','canvas-rendering','canvas-text-node']
```

| 完成判据 | 标准 |
|---|---|
| ✅ install-coverage 0 missing | G3 missing 1 → G4 missing 0(canvas-text-node 归零)|
| ✅ Canvas.md § 2.1 17 项验收 | 第 1~12 + 14~17 项全过(13 项 Edit Substance API 不在迁移)|
| ✅ typecheck 0 / lint 0 warn | 全工程 |
| ✅ 屏障 grep 0 命中 | three 仅 canvas-rendering;prosemirror 仅 text-editing |
| ✅ 5 commit 子段全过 | 每子段独立用户验收 + commit |
| ✅ 上一段 alive 行无回归 | L0~L5 + G1+G2+G3 |

---

## 6. 用户验收清单(对齐 Canvas.md § 2.1)

按 4 个子段连续手测:

### G4.1 验收
1. ✅ G3 测试画板:line 节点变成真线段 + magnet 跟随两端;text 仍占位灰矩形
2. ✅ 拖动 shape → 连接的 line 端点跟随
3. ✅ 旋转 shape(已选中 + rotation handle G4.2 后)→ line 端点跟随旋转后的 magnet

### G4.2 验收
4. ✅ 单选 → 显 8 个 resize handle + 1 个 rotation handle
5. ✅ 拖 corner handle → 等比缩放(对角线方向投影)
6. ✅ 拖 edge handle → 单边缩放
7. ✅ rotation handle 拖 → 节点旋转;Shift 吸附 15°
8. ✅ Cmd+C / Cmd+V → 复制粘贴(屏幕中心新建)
9. ✅ Cmd+Z / Cmd+Shift+Z → 撤销 / 重做

### G4.3 验收
10. ✅ 空白拖动 → marquee 框选
11. ✅ Shift-click → 多选 toggle
12. ✅ Picker 选 shape → 进添加模式 → 点画布实例化
13. ✅ Picker 选 line → 从 shape magnet press-drag-release 拖到另一 magnet → 创建 line(落空取消)
14. ✅ 选 line → 拖端点 handle → rewire 到新 magnet

### G4.4 验收
15. ✅ Toolbar `+ 添加` → 弹 Picker(Freeform 风格双栏 popover)
16. ✅ 双击节点 → 弹 Floating Inspector → 改 fill/line/size → 视觉立即更新
17. ✅ 多选 2 个 shape + 1 个 line → Toolbar `⊟ Combine` → 弹 CreateSubstanceDialog → 命名 → 创建 substance + 原 shape 替换为 substance 实例

### G4.5 验收(最难)
18. ✅ 双击文字节点 → 弹 EditOverlay → 内嵌 PM EditorView
19. ✅ 编辑文字(B / I / 公式 / link)→ Esc 退出 → SVG mesh 更新
20. ✅ install-coverage missing 0 + canvas-text-node alive 行

---

## 7. 风险登记

| 风险 | 缓解 |
|---|---|
| **G4-2 canvas-text-node 走 text-editing.Host** 是新接口设计,V2 既有节奏没先例 | G4.5 启动前**单独前置子任务**:评估 text-editing.Host 是否支持"嵌入到任意 DOM 节点 + 自定义 plugin 清单";**如不支持**,暂停 G4.5,先开独立 commit 扩展 text-editing capability API(`Host` props 加 `mountTarget / pluginsBuilder / initialDoc / onUpdate` 等接口字段;同时配套补 `prosemirrorToAtoms`,见 G4-4),text-editing 自身典型场景(NoteView)0 影响后再进 G4.5.**绝不**降级到"view/capability 直 import @drivers/* 运行时" — W5 严格态 A 边界不可破,无"实用但违规"的退路 |
| **G4-4 prosemirrorToAtoms** 接口可能 text-editing 暂未暴露 | 同上,G4.5 启动前 grep text-editing.api.ts / DESIGN.md 看是否有 docToAtoms;无则提 text-editing API 扩展 PR(单独 commit,在 G4.5 commit 之前) |
| InteractionController 直迁 V1 1975 行后,**部分方法依赖 dispatchLinkHref / 自定义事件**等 V2 没的能力 | dispatchLinkHref 整段砍(独立阶段);其他依赖逐行评估 |
| HandlesOverlay 依赖 V1 `isTextNodeRef`(在 V1 edit/atom-bridge 内),G4.1 砍掉 atom-bridge 真依赖前,先在 canvas-rendering 内提供 isTextNodeRef helper 简版(`ref === 'krig.text.label'`) | 已在 G3 NodeRenderer.ts 内有同名常量(TEXT_REF)逻辑;G4.1 时抽出公共 helper |
| **5 commit 子段失败**:某子段卡住时,前面 commit 已经基于残缺状态 | 每个子段先 typecheck + lint + 手测;失败时 git reset 当前 commit,**不污染前面**;G4 分支不合 main 直到全 5 子段过 |
| **NodeRenderer 还原**:G4.1 还原 line 时复用 V1 renderLineShape(818 行 NodeRenderer 内片段);V1 这块依赖 resolveLineEndpoints(magnet-snap),要确保 magnet-snap 先就位 | G4.1 commit 顺序:LineRenderer → magnet-snap → NodeRenderer.line 分支 |
| 子段间 commit 顺序差错导致编译失败 | 每个子段开始前先 git log --oneline 看当前位置;每子段结束 npx tsc --noEmit 通过才提交 |
| ESLint 规则被无意中触发(如 capabilities 间 import) | 每个子段 commit 前 npx eslint . 验证全工程 0 warn |
| **巨变 commit 用户验收风险**:某子段需要 fix 修补时,用户验收 G4 整体可能要重测前面子段 | 每子段独立验收清单(本 design § 6 拆 5 段),用户可单段验收 |

---

## 8. 实施分 commit(对齐 G4-1=A + G4-12=B)

```
feature/L5G4-canvas-full-interaction 分支:

Commit 1  design(L5-G4)v0.1                          (本文)
Commit 2  feat(L5-G4.1) scene 补齐 + NodeRenderer 还原 line(~1100 行)
Commit 3  feat(L5-G4.2) handles + resize/rotate + Cmd+C+V+Z(~900 行)
Commit 4  feat(L5-G4.3) marquee + addMode + 画 line + rewire(~700 行)
Commit 5  feat(L5-G4.4) UI 浮层(Picker + Inspector + Combine Dialog)(~1100 行)
Commit 5.5 feat(text-editing) 扩展 API:Host 嵌入式 + prosemirrorToAtoms
           — **G4.5 前置依赖,W5 严格态 A 唯一合规路径**(条件触发:G4.5 启动
           前评估 text-editing.Host 不支持嵌入 + 自定义 plugin 时,先开本
           commit;若已支持则跳过)
Commit 6  feat(L5-G4.5) canvas-text-node + NodeRenderer text 真渲染(~1100 行)
Commit 7  docs(L5-G4) completion + snapshot
Merge --no-ff feature/L5G4-canvas-full-interaction → main

每个 commit 自包含 typecheck 0 + lint 0 warn + 屏障 grep 0 + 用户子段验收过
全 5(或 6,含 5.5)实施 commit 完成 + 用户全段验收通过后,统一合 main
```

---

## 9. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-10 | v0.1 | 初稿;G4 单段 + 内部 5 commit 子段(G4.1~G4.5);12 决策点全 A 默认或推荐项;3 段验收清单 20 项;P1-1 严格屏障保持;LOC 估算 ~3245 新增 + ~1700 改写;**charter § 6.5 教训登记**:本段所有 interaction / scene 代码强制按 V1 直迁 + 整段砍模式(G4-10=A);**G4-2=B canvas-text-node 走 text-editing.Host 嵌入式**是新接口设计,需 G4.5 启动前评估 text-editing capability API 扩展(可能 prosemirrorToAtoms / Host 自定义 plugin 清单需扩) |
| 2026-05-11 | v0.2 | 实施前用户 P1 复审 — 删除 G4-2 回退到违规路径的文本:v0.1 § 7 风险表把"降级 G4-2=A 直接 import @drivers(违反 W5 但实用)"写成可执行备选,与 W5 严格态 A 边界硬约束冲突(view/capability 不直 import @drivers/* 运行时).修法:① § 7 风险条目改写为"暂停 G4.5 并先补 text-editing capability API",绝不允许任何"实用但违规"退路;② § 2 决策表 G4-2 行 A 选项标 ❌ 不可行(仅作 V1 历史记录),B 标"唯一合规路径";③ § 8 实施分 commit 加 **Commit 5.5 text-editing API 扩展前置子任务**(条件触发,Host 嵌入式 + prosemirrorToAtoms;典型场景 NoteView 0 影响后再进 G4.5).其余审计 4 项(three 屏障/install/canvas-text-node registry/UI 归属)通过 |
