# L5-G3 设计 — canvas-rendering capability(Three.js 单点屏障核心)

> v0.2 · 2026-05-10 · 实施前用户 P1+P2 复审(Instance 归属 + NodeRenderer 调用方式统一)
>
> 配套:
> - 上游 plan:[../v1-graph-migration-plan.md](../v1-graph-migration-plan.md) v0.2 § 3.3 + § 5 G3
> - 业务规格:[../../10-business-design/graph/canvas/Canvas.md](../../10-business-design/graph/canvas/Canvas.md)
> - 同位参考:[./L5G2-shape-library-design.md](./L5G2-shape-library-design.md) v0.3(G2 输出 EvaluatedPath 数据流上游)
> - 严格屏障规约(P1-1):[../v1-graph-migration-plan.md § 0 第 3 条](../v1-graph-migration-plan.md) + § 3.3
>
> **本段定位**:Graph 迁移 5 段切片(G1~G5)第 3 段。**唯一允许 import three 的 capability**(P1-1 严格版屏障核心落地点);引入 Three.js 渲染管线 + 基础交互(单选 / 拖动 / Delete / pan / zoom),让画板**真能看到画面**。

---

## 0. 一句话目标

打开画板 → 看到 Three.js 渲染的空画布(点阵网格底)→ 滚轮 zoom-to-cursor → 拖空白 pan → 点击节点选中(蓝边框)→ 拖动节点 → Delete 删除 → toolbar Fit-to-content。

完整对应 v0.2 plan § 5 G3 段验收清单:

> 创建画板 → 渲染空画布 + 点阵网格底 → 滚轮 zoom / 拖空白 pan / Cmd+0 fitToContent → toolbar 缩放滑块同步;手测 deserialize V1 画板 JSON 能渲染(用 V1 导出的 .json 文件粘贴到 storage);**屏障 grep 结果只命中 canvas-rendering**

---

## 1. 范围(In/Out)

### 1.1 本段做(In)

- [x] **npm 屏障收紧**:`src/capabilities/canvas-rendering/` 是**唯一允许 import three 的位置**(eslint config 配 override allowlist);所有其他位置 0 import three(view / shape-library / 其他 capability 全部禁)
- [x] **capabilities/canvas-rendering/scene/**(Three.js 渲染管线核心,V1 直迁 4 文件 + path-to-three 从 V1 plugin 迁入):
  - `SceneManager.ts`:Three.js 底座(scene / camera / renderer / Retina / RAF / fitToContent / screenToWorld 互转)
  - `NodeRenderer.ts` **G3 砍剩"shape + 简单 substance"**:V1 818 行砍掉 line/text/canvas-text-node 部分(归 G4),~400 行;**直 import shape-library 模块级 `ShapeRegistry / SubstanceRegistry` + `evaluateShape`**(决策 G3-2=B,capability 层间 W5 边界 A 允许;对齐 V2 ebook-rendering 直 import ebook-library 单例模式);拿到 EvaluatedPath → path-to-three 转 Mesh
  - `DotGrid.ts`:F-1 点阵网格底(V1 132 行直迁)
  - **`path-to-three.ts`**:V1 `plugins/graph/library/shapes/renderers/path-to-three.ts` 395 行迁入(P1-1 屏障核心 — V2 单一 Three.Shape 投影位置);**接口改对接 EvaluatedPath**(V1 内部直接吃 ShapeDef + buildEnv,V2 改为接受 G2 输出的 `EvaluatedPath` 纯数据 + `FillStyle / LineStyle` 风格)
- [x] **capabilities/canvas-rendering/interaction/** **G3 减量版**:
  - `InteractionController.ts`:V1 1975 行 → ~700~900 行(留单选/拖动/Delete/pan/zoom/选中边框 overlay;**砍** resize / rotate / marquee 框选 / 画 line / HandlesOverlay / link 路由 → G4)
- [x] **capabilities/canvas-rendering/Host.tsx** forwardRef:
  - Props:`workspaceId / onViewportChange / onSelectionChange / onInstancesChange / onTitleChange / textNode?(G4 注入,本段不用)`
  - Handle:`loadDocument / serialize / setViewport / fitToContent / zoomTo / deleteSelected / clearSelection`
  - 内部装 SceneManager + NodeRenderer + DotGrid + InteractionController
- [x] **capabilities/canvas-rendering/types.ts**:`CanvasHostHandle / CanvasHostProps / CanvasDocument / Viewport / CanvasRenderingApi` **+ `Instance / InstanceKind / InstanceEndpoint / TextNodeAtoms`**(画板上的实例数据类型;G2-10=B 确认 shape-library 不含 Instance 系,本段归 canvas-rendering;V1 类型直迁。canvas-text-node / graph-library-store(IPC 边界仍用 `unknown / CanvasDocumentJson` 通用类型,不强耦合 Instance)/ 未来 family-tree projection 等需要时通过 `import type from '@capabilities/canvas-rendering/types'`)
- [x] **capabilities/canvas-rendering/index.ts**:双导出 + capabilityRegistry.register + alive 行
- [x] **capabilities/canvas-rendering/styles.css**:V1 `plugins/graph/graph.css` 中的 scene / interaction 相关样式迁入
- [x] **capabilities/canvas-rendering/DESIGN.md**:P1-1 屏障落地点显式声明
- [x] **views/graph-canvas-view/GraphCanvasView.tsx**:从占位 placeholder 升级为接 `<Host ref>`,启动恢复(load doc)+ 防抖保存(serialize → save IPC,1s 防抖,对齐 V1 模式)+ 视口持久化(viewport 挂 doc_content.view)
- [x] **install-coverage missing 2 → 1**(canvas-rendering 归零,canvas-text-node 留 G4)
- [x] **renderer/index.tsx**:`import '@capabilities/canvas-rendering'`

### 1.2 本段不做(Out)

- ❌ **line 渲染 / 创建 / rewire / 端点拖动**:V1 LineRenderer 181 行 + magnet-snap 182 行 + InteractionController line 部分 → G4
- ❌ **文字节点(text label)渲染 + 编辑态浮层**:V1 TextRenderer 197 行 + edit/ 4 文件 856 行 → G4 (canvas-text-node capability)
- ❌ **HandlesOverlay** + **resize 8 方向 + rotation handle**:V1 278 行 + interaction 内 resize/rotate 部分 → G4
- ❌ **OBB hit-test**(旋转后 hit-test):G3 用简单 AABB(不旋转 ⇒ 简单)→ G4 旋转上线后再补 OBB
- ❌ **marquee 框选**:V1 InteractionController marquee 部分 → G4
- ❌ **Cmd+C/V 复制粘贴**:决策 D-14=B 留 V1 自管,但本段不实施(G4 一并)
- ❌ **Cmd+Z 撤销**:决策 D-13=B 留 V1 自管,但本段不实施(G4 一并)
- ❌ **link 路由 / dispatchLinkHref**:V1 InteractionController 内 → 与 V2 跨 view 路由协议不同,留独立阶段
- ❌ **Library Picker / Floating Inspector / Combine 对话框**:G4
- ❌ **添加模式**(点击工具 → 点画布实例化):G4
- ❌ **完整 InteractionController**(line 创建 / rewire / 多选 + Cmd+C/V / OBB resize / rotation handle / 文字编辑触发):G4

---

## 2. 决策清单(本段细化)

| # | 决策点 | A(默认) | B(替代) | 推荐 |
|---|---|---|---|---|
| **G3-1** | capability id 字面值 | **`canvas-rendering`**(对齐 plan v0.2 § 3.3) | `canvas-three` / `graph-rendering` | **A** — plan 字面 |
| **G3-2** | NodeRenderer 渲染数据流 — direct 调 shape-library 模块 vs 走 requireCapabilityApi | A 走 `requireCapabilityApi('shape-library')` 间接(对齐 W5 严格态)| **B** 同 capability 层间允许直 import 单例 `ShapeRegistry / SubstanceRegistry`(双导出兜底) | **B** — capability 层间 W5 边界 A 允许直 import 单例(对齐 V2 ebook-rendering 直 import @capabilities/ebook-library 单例的模式;`requireCapabilityApi` 是给 view 用的);**用 type import + 模块级 export** |
| **G3-3** | path-to-three 接收数据形态 | A 接受 ShapeDef + EvaluateContext,内部再调 evaluate(V1 模式) | **B** 接受 EvaluatedPath(G2 输出的纯数据)+ 风格 | **B**(P1-1 严格屏障核心) — NodeRenderer 调 `shapeLibrary.shapes.evaluate(id, props, ctx)` 拿 EvaluatedPath,再 `pathToThree(evalPath, fillStyle, lineStyle)` 转 mesh;**path-to-three 不再 import shape-library**(纯函数,只吃数据) |
| **G3-4** | path-to-three 是否同时支持 SVG path 字符串 input | A 是 — 也可接 raw SVG path 字符串(扩展给 family-tree projection 用) | **B** 否 — v1 只接 EvaluatedPath | **B**(范围控制) — family-tree projection 阶段(里程碑 H)有需求再加 path-to-three 重载 |
| **G3-5** | NodeRenderer 砍 line/text 后,substance 内的 line/text 子组件怎么办 | A skip(渲染 substance 时遇 line/text component 静默跳过) | B fallback 灰色矩形(显式让用户知道 G3 没实现)| **A**(对齐 plan G3 范围 — 完整 substance 渲染留 G4 一起做);V1 内置 substance library 2 / family 3 全是 shape + text 组合,G3 仅渲染 shape 部分,family-tree 验收留 G4+ |
| **G3-6** | InteractionController 减量版的边界 | A 砍到极简(单选 + 拖动 + Delete + pan + zoom + 单层 LineLoop 选中边框,~700 行) | B 多保留多选(Shift-click)便于 G4 接续 | **A**(plan v0.2 § 5 G3 严格说"单选 / 拖动 / Delete / 平移 / 缩放,~1000 行")— 多选留 G4;~700 行更精;G4 时砍剩部分 + 补 marquee/Shift-click 一起回来 |
| **G3-7** | view 端 viewport 持久化:挂 doc_content.view vs pluginStates | **A 挂 doc_content.view**(对齐 V1 schema_version=2 + plan v0.2 序列化结构) | B 挂 pluginStates(per-ws) | **A** — viewport 是画板本身的属性(打开同一画板从不同 ws 应该看到同一视图),不是 per-ws;V1 已有 `doc.view = { centerX, centerY, zoom }` 字段 |
| **G3-8** | view 端防抖保存策略 | **A 1s 防抖**(对齐 V1 CanvasView SAVE_DEBOUNCE_MS=1000) | B 500ms | **A** — V1 已稳定 1 年 |
| **G3-9** | view 端切画板时 | **A 先 flush 旧 → 再 load 新**(对齐 V1 onGraphOpenInView) | B 直接 load 新 | **A** — V1 模式,防数据丢失 |
| **G3-10** | NodeRenderer 文字节点占位 | A 渲染单色矩形作占位(让用户看到节点位置) | **B 渲染半透明 / 灰矩形 + 文字"(G4)"** | **B** — 测试时容易识别"这是 G3 占位,G4 才真渲染" |
| **G3-11** | Host.tsx 是 `useImperativeHandle` 暴露 ref 还是 hook 暴露 API | **A useImperativeHandle**(对齐 V2 ebook-rendering Host) | B hook | **A** — Host 是命令式 API(view 调 host.loadDocument 等),与 ebook 同模式 |
| **G3-12** | path-to-three 内部 Fat Lines(Line2)是否保留 | A 保留(V1 已用,linewidth 真控)| **B** 砍掉 → 用 THREE.Line(简单) | **A** — V1 必须 Fat Lines 才能控线宽(普通 THREE.Line linewidth=1 是 spec,不响应);Line2 复杂度可控 |
| **G3-13** | view 主体 LOC 红线 | **A ≤ 150~200 行**(对齐 charter § 1.4 + ebook EBookView 红线) | B 接受到 300 行 | **A** — view 主体本段从 66 行膨胀到 ~150 行内(接 Host ref + handlers + 防抖保存),仍远低于红线 |

---

## 3. 文件清单(物理路径 + LOC 估算)

### 3.1 新增

```
src/capabilities/canvas-rendering/
├── index.ts                      ~150 行(双导出 + capabilityRegistry.register + alive 行)
├── types.ts                      ~180 行(CanvasHostHandle / CanvasHostProps / CanvasDocument / Viewport / CanvasRenderingApi **+ Instance / InstanceKind / InstanceEndpoint / TextNodeAtoms** — V1 types.ts 内的画板实例类型归本段所有,G2-10=B 决策时 shape-library 显式拆出后这里接收;V1 types.ts 直迁约 80 行)
├── Host.tsx                      ~250 行(forwardRef + useImperativeHandle + 装 SceneManager + NodeRenderer + DotGrid + InteractionController)
├── scene/
│   ├── SceneManager.ts           ~346 行(V1 直迁)
│   ├── NodeRenderer.ts           ~400 行(V1 818 砍 line/text/canvas-text-node 后;G3-2=B 直 import shape-library 模块级 ShapeRegistry + SubstanceRegistry;G3-5 substance 内 line/text 子组件静默 skip;G3-10 文字节点占位)
│   ├── DotGrid.ts                ~132 行(V1 直迁)
│   └── path-to-three.ts          ~310 行(V1 395 砍 SVGLoader 等同等部分;接口改对接 EvaluatedPath;P1-1 屏障核心)
├── interaction/
│   └── InteractionController.ts  ~700 行(V1 1975 行 G3 减量版)
├── styles.css                    ~50 行(V1 graph.css 中 scene / overlay 样式迁入)
└── DESIGN.md                     ~150 行

合计估算:driver ~2280 行 + CSS ~50 + DESIGN ~150
```

### 3.2 修改

```
package.json                                     +three / @types/three(已装,这次 commit 进)
eslint.config.js                                 加 capabilities/canvas-rendering 内部允许 import three 的 override(其他 capability 禁)
src/platform/renderer/index.tsx                  + 1 行 import '@capabilities/canvas-rendering'
src/views/graph-canvas-view/GraphCanvasView.tsx  66 → ~150 行(接 Host ref + 启动恢复 + 防抖保存 + viewport 持久化)
src/views/graph-canvas-view/data-model.ts        view 主体新增 viewport 字段(也可挂 doc_content;G3-7=A 挂 doc_content);本文件可能不改
src/views/graph-canvas-view/GraphCanvasToolbar.tsx 加 Fit-to-content 按钮 + 缩放滑块同步(占位级,完整 toolbar 留 G5)
```

> v0.2 plan § 5 G3 估算 ~2000 行 + ~250 CSS — 本设计估 ~2280 driver + 50 CSS,driver +14% 主要在 path-to-three 单独算入(V1 plugin 内的 395 行迁入)+ Host.tsx 是新写。CSS 大幅低于估算因为 G3 没有 Picker / Inspector / Dialog 等浮层(G4 一起)。

### 3.3 capability/canvas-rendering API 形状

```ts
// types.ts
export interface CanvasHostHandle {
  loadDocument(doc: CanvasDocument): void;
  serialize(): CanvasDocument;
  setViewport(vp: Viewport): void;
  fitToContent(padding?: number): boolean;
  zoomTo(percent: number): void;
  deleteSelected(): void;
  clearSelection(): void;
  getInstance(id: string): Instance | null;
  getInstances(): Instance[];
}

export interface CanvasHostProps {
  workspaceId: string;
  // textNode?: CanvasTextNodeApi;  // G4 注入(canvas-text-node capability)
  onViewportChange?: (vp: Viewport) => void;
  onSelectionChange?: (ids: string[]) => void;
  onInstancesChange?: (instances: Instance[]) => void;
  onContextMenu?: (e: { clientX: number; clientY: number; targetIds: string[] }) => void;
}

export interface Viewport {
  centerX: number;
  centerY: number;
  zoom: number;
}

/** 与 V1 schema_version=2 兼容:view + instances(+ user_substances 用户创建,G4) */
export interface CanvasDocument {
  schema_version: number;
  view: Viewport;
  instances: Instance[];
  user_substances?: unknown[];  // G2 SubstanceDef[],G4 真实施
}

export interface CanvasRenderingApi {
  Host: ForwardRefExoticComponent<CanvasHostProps & RefAttributes<CanvasHostHandle>>;
}
```

---

## 4. P1-1 严格版屏障落地

### 4.1 ESLint config 修改

`src/capabilities/canvas-rendering/` 是**唯一允许 import three 的 capability**;其他 capability 禁。

修改 `eslint.config.js`,在"能力层 capabilities/**"块**之后**追加 override:

```js
// 屏障层 — capability 内部默认禁 three(P1-1 严格版),例外允许 canvas-rendering
{
  files: ['src/capabilities/**/*.{ts,tsx}'],
  ignores: ['src/capabilities/canvas-rendering/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        // 沿用已有 capability 间禁项(@workspace / @views / 其他 capability 等)
        // ... 复制现有规则 ...
        // P1-1 严格版屏障核心:除 canvas-rendering 外,任何 capability 0 import three
        { group: ['three', 'three/*'],
          message: 'P1-1 严格版屏障:three 只允许 capabilities/canvas-rendering/ import' },
      ],
    }],
  },
},
```

**注**:V2 既有 eslint.config.js 已对 views / workspace / slot / storage / shared 禁 three;本段加 capabilities 层默认禁 + canvas-rendering 例外。

### 4.2 屏障 grep 自检

```bash
# canvas-rendering 内允许 import three(预期命中)
grep -rn "from 'three'" src/capabilities/canvas-rendering/ --include="*.ts" --include="*.tsx"
# 期望:命中 scene/SceneManager.ts + scene/NodeRenderer.ts + scene/DotGrid.ts + scene/path-to-three.ts + interaction/InteractionController.ts + Host.tsx(可能,如果用 THREE.* 类型)

# 任何其他位置 0 命中
grep -rn "from 'three'" src/ --include="*.ts" --include="*.tsx" | grep -v "canvas-rendering/"
# 期望:0 命中
```

---

## 5. 自我诊断(charter § 5)

启动 console 期望:

```
[shape-library] alive | shapes: 22, substances: 5
[canvas-rendering] alive | three: 0.184.0, scene/interaction ready
[L4] viewTypeRegistry: view 'graph-canvas-view' install ids 未在 capabilityRegistry 中: canvas-text-node
  ← P1-A 渐进式 install,G4 归零
[install-coverage] ❌ install 覆盖率自检:5 views · 16 capabilities · 缺失 1
  graph-canvas-view × ['graph-library-store','shape-library','canvas-rendering']
  · missing: canvas-text-node
```

---

## 6. 完成判据(charter § 6.3)

| 项 | 标准 |
|---|---|
| ✅ npm start 跑得起来 | 无报错,窗口出来 |
| ✅ console 显 `canvas-rendering` alive 行 | + three 版本 + scene/interaction ready |
| ✅ 上一层 alive 行也在 | L0~L5 + G1 + G2 alive 行无回归 |
| ✅ install-coverage missing 2 → 1 | canvas-rendering 归零;`missing: canvas-text-node`(G4 归零) |
| ✅ viewTypeRegistry warn 同源配套 | `[L4] viewTypeRegistry: ... canvas-text-node`(P1-A 预期) |
| ✅ typecheck 0 error | tsc --noEmit |
| ✅ lint 0 warn | eslint . 全工程 |
| ✅ **屏障 grep**:`grep "from 'three'" src/` 排除 canvas-rendering 后 0 命中 | P1-1 严格版屏障核心 |
| ✅ 新建画板 → 渲染空画布 | DotGrid 点阵网格底可见 |
| ✅ 滚轮 zoom-to-cursor | 鼠标位置作为缩放中心 |
| ✅ 拖空白 pan | zoom 不变 |
| ✅ 创建画板自动 fitToContent | toolbar Fit 按钮可手动触发 |
| ✅ 切画板正常 | 旧画板 flush → 新画板 load |
| ✅ 重启恢复 viewport | doc_content.view 持久化 + 反序列化恢复 |

---

## 7. 用户验收清单(本段有 UI,完整手测)

按此顺序手测:

1. **启动** — npm start → 出窗口 + console 显:
   - `[canvas-rendering] alive | three: 0.184.0, ...`
   - install-coverage missing 1(canvas-text-node)
2. **创建画板** — NavSide [+ 画板] → 切入 → **看到空 Three.js 画布 + 点阵网格底**(不再是占位文字)
3. **pan** — 鼠标在空白处按下拖动 → 网格点跟着移动
4. **zoom** — 滚轮 → 以鼠标位置为中心缩放(zoom-to-cursor) → toolbar 显当前缩放百分比(占位级)
5. **Fit-to-content** — Cmd+0 / toolbar Fit 按钮 → 空画板时:维持当前视图;有节点时:适配全部节点
6. **手测渲染** — 用 V1 导出的 .json 文件复制到 storage(`{userData}/krig-data/graph/documents/{id}.json`)→ 重启 → 打开该画板 → 看到 V1 创建的 shape(基础矩形 / 圆 / 多边形 等)被 Three.js 渲染出来;**line / text 类节点显占位灰矩形**(G3-5 / G3-10)
7. **选中** — 点击节点 → 显蓝色矩形选中边框(单层 LineLoop;无 8 resize / rotation handle,留 G4)
8. **拖动** — 拖动选中节点 → 跟随鼠标
9. **Delete** — 选中节点按 Delete → 节点删除
10. **clearSelection** — 点击空白 → 取消选中边框
11. **切画板** — NavSide 切到另一画板 → 旧画板 flush 保存 → 新画板 load 渲染
12. **重启恢复** — 关 app → 重启 → 上次画板 + viewport(zoom / pan)完整恢复
13. **重命名 / 删除 / 复制 / 移动**(G1 功能回归) — NavSide 操作不受影响
14. **多 workspace** — 双 ws 各自打开同一画板 → 同步保存(全局共享)+ activeGraphId per-ws 独立

---

## 8. 风险登记

| 风险 | 缓解 |
|---|---|
| V1 NodeRenderer 818 砍 line/text 后逻辑断点 | 设计 § 3.5(G3-5)skip 策略;V1 `renderInstance` 主干保留(shape / substance);line/text 分支整段砍 + 占位 fallback(G3-10) |
| path-to-three V1 接口接 ShapeDef,V2 改接 EvaluatedPath 需重写入口 | 入口函数 `pathToThree(evalPath: EvaluatedPath, opts: PathToThreeOptions)`;V1 内部 `pathCmdToShape` 直接接受 path commands 数组,改名 `evaluatedPathToThreeShape` + 入参从 path[] + env → evalPath.d 字符串重新解析(SVG path 字符串解析比 V1 直接吃 PathCmd 数组复杂一点点) |
| ESLint 屏障 override 顺序敏感 | V2 既有 config 用 array-of-overrides 模式,**后面的规则覆盖前面** — 把 canvas-rendering 例外块放在 capabilities 通用块**之前**,用 `ignores` 反向;或者用 `files: ['src/capabilities/canvas-rendering/**']` 单独允许 — 测试后选稳的 |
| Retina + ResizeObserver 双重缩放 bug(memory feedback_threejs_retina_setsize)| V1 SceneManager `setSize(w, h, true)` 第三参 true 已防御,V1 已稳一年,直迁即可 |
| canvas 容器始终 mount(memory feedback_canvas_container_must_always_render)| GraphCanvasView 改为 `<div ref>` 始终渲染 + `<Host ref>` 内部决定空 / 有内容状态 — 不按 activeGraphId 切 mount(否则 ref 时机错过) |
| fitToContent NaN 防御(memory feedback_fitcontent_nan_defense)| V1 SceneManager.fitToBox 4 分量 isFinite 检查已实现,直迁 |
| Host.tsx 命令式 API 容易膨胀 | 接口最小(8 个方法),新增 method 需走 capability DESIGN.md 评审(对齐 ebook-rendering Host 模式) |
| view 从占位升级到接 Host,LOC 升高可能违反红线 | G3-13=A view 主体 ≤200 行;若超线需评估是否拆 use-canvas-handlers hook |
| install-coverage 仍报 missing 1(canvas-text-node)| P1-A 预期 warn,G4 归零;G3 design / completion 沿用 G1/G2 表述 |

---

## 9. 实施分 commit

按 ebook C2 / graph G1 节奏,本段拆 **双 commit**:

### Commit 1 — feat(capabilities/canvas-rendering): 渲染管线 + 交互(估 ~2280 driver + 50 CSS)

- `src/capabilities/canvas-rendering/` 全套:types / Host / scene/ × 4 / interaction / styles / DESIGN
- `eslint.config.js` 加 P1-1 严格版屏障 override
- `package.json` lock three / @types/three
- 验证:typecheck 0 / lint 0 / 屏障 grep 0 误命中

### Commit 2 — feat(view): graph-canvas-view 接 Host(估 ~+100 行 net)

- `src/views/graph-canvas-view/GraphCanvasView.tsx` 升级(占位 → Host ref 接管)
- `src/views/graph-canvas-view/GraphCanvasToolbar.tsx` 加 Fit 按钮 + 缩放显示
- `src/platform/renderer/index.tsx` + 1 行 import @capabilities/canvas-rendering
- 验证:§ 7 用户验收 14 项

---

## 10. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-10 | v0.1 | 初稿;G3 范围 + 13 决策点 + 文件清单 + EvaluatedPath → path-to-three 数据流 + 14 项验收清单 + 双 commit 拆分 + 风险登记 + P1-1 严格版屏障 ESLint 落地点 |
| 2026-05-10 | v0.2 | 实施前用户 P1+P2 复审 — 两条 design 内部口径冲突修订:**P1 Instance 归属冲突**:v0.1 § 1.1 + § 3 文件清单写"Instance 类型 type import @capabilities/shape-library/types",但 G2-10=B 已决策 shape-library 不含 Instance 系(实际 src/capabilities/shape-library/types.ts 已确认不含);修法:Instance / InstanceKind / InstanceEndpoint / TextNodeAtoms 显式归 canvas-rendering/types.ts(从 V1 plugins/graph/library/types.ts 直迁,V1 当时 Instance 与 ShapeDef 混在一起;V2 G2 已分离 ShapeDef → shape-library,G3 接 Instance → canvas-rendering);canvas-text-node / graph-library-store(IPC 边界仍 unknown / CanvasDocumentJson)/ future family-tree 通过 `import type from '@capabilities/canvas-rendering/types'`;types.ts LOC 估算 120 → 180(+60 行 V1 Instance 类型迁入).**P2 NodeRenderer 调用方式冲突**:v0.1 § 1.1 写"通过 requireCapabilityApi('shape-library') 调 evaluate",与 § 2 G3-2=B 决策(直 import 模块级 ShapeRegistry)矛盾;修法:§ 1.1 改"**直 import shape-library 模块级 ShapeRegistry / SubstanceRegistry + evaluateShape**(决策 G3-2=B,capability 层间 W5 边界 A 允许;对齐 ebook-rendering 直 import ebook-library 单例模式)" |
