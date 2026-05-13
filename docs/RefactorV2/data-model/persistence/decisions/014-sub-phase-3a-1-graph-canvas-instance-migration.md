# Decision 014 — Phase N Sub-phase 3a-1: Graph Canvas + Instance 持久化迁移

> **Phase**: N（实施 Phase）/ Sub-phase 3a-1
> **状态**: ✅ **已实施完成**(2026-05-12,merge commit `67f18b2`,10 commits / 28 files / +1502/-342)
> **设计师 / 审计师**: 本对话（main 分支）
> **实施者**: 新对话（`feature/L7-sub3a-1-canvas-instance-migration` 分支)
> **决议日期**: 2026-05-12
> **前置依赖**: sub-phase 2 (`0ad60c7`) + decision 013 总纲 (`281d74b`)
> **总纲依据**: [decision 013 sub-phase 3a 总纲](013-sub-phase-3a-graph-canvas-migration.md)
> **实施总结**: §6.2 8 个核心场景全通过 + EM5/EM6 + 静态合规审计全通过;含 2 个实施期间主对话拍板的关键决策(A: folder cascade 扩展;E: AtomEntity 扩展 hasBeenReferenced)

---

## 0. 本文档的执行指南

### 0.1 角色与流程（与 sub-phase 1 / 2 同模式）

```
本对话 (main) → 写本文档(设计师)
新对话 (feature/L7-sub3a-1-canvas-instance-migration) — 独立 session
    ↓ 按本文档执行代码实施
    ↓ 每完成步骤 commit
    ↓ 完成后停下,通知本对话
本对话 (main) → 审计 + UI 集成测试 + 合并 main
```

### 0.2 实施纪律（实施者必须遵守）

1. **严格按本文档执行**,不自行扩展范围。发现遗漏 → 停下汇报,**不自行决定**。
2. **每完成 §5 步骤 commit 一次**。
3. **不动 V1 仓库**(按 `feedback_v2_is_workspace_v1_is_reference`)。**所有 Bash 命令前 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...` 显式指定**。
4. **不合 main**,留在 `feature/L7-sub3a-1-canvas-instance-migration` 分支。
5. **完成所有 §5 步骤后停下**,发"L7-sub3a-1-canvas-instance-migration 实施完成请审计"。
6. **允许消费已完成模块的对外 API**(`@capabilities/folder` / `@capabilities/note` 的 capability registry 接口),**但禁止修改其行为 / 对外契约 / 内部实施**(`src/capabilities/note/` / `src/capabilities/folder/` / `src/platform/main/note/` / `src/platform/main/folder/` 全部目录不动)。本 sub-phase 只动 graph + 引入 pmContentCapability。

   **如出现模型不匹配**(例如 §3.5.3 graph IPC 契约 `GraphFolderRecord` 跟 `folderCapability.FolderInfo` 字段命名 / 集合不一致):**只在 graph 侧加 adapter 层做映射**(`src/platform/main/graph/folder-adapter.ts`),**不动 folder 模块本身**。详 §3.5.3。
7. **不动 storage 对外契约 + atom CRUD 语义**(原 "不动 storage 内部实施" 字面在实施时发现过严,**实质允许向后兼容字段扩展 + normalizer 同步带出**,跟 sub-phase 2 加 folder domain 同范畴。详 §12.2 偏离 6 + decision 011 §5.7 反向更新)。**禁止改 storage 对外接口签名 + atom CRUD 语义**。
8. 涉及 SurrealQL / schema 操作时**未在 binary 验证**,实施者需在实际 binary 上 verify,发现 SurrealDB 3.0.4 行为不一致**立即停下汇报**。
9. **遵守 decision 013 §3.0 域注册门槛**:新 atom domain 引入前必须完成 4 步代码侧注册闭环(`AtomPayloadOf` / `AtomDomain` / storage dispatch / capability register),commit message 显式列"已注册 domain"。
10. **遵守 decision 013 §3.5.1.bis 单引用约束**:本 sub-phase 仅实现"单引用模式",一段 pm content 只被一个 Instance 引用,**禁止浅引用 / 跨 view 复用**(那是 3a-shared-ref 子任务,前置 Q-tx 必做)。
11. **(实施期间补加)checkpoint 合并 binary verify**:每 step 单独 binary verify 在 D-state 等 OS 故障环境下不可行,允许合并到 checkpoint(配套静态深度审计 + 失败立即回溯)。本 sub-phase 用了 3 checkpoint 替代 5+ 次,详 §12.2 偏离 7。

### 0.3 本子决议覆盖 decision 013 总纲的偏差

总纲撰写时基于推演,V2 graph 现状梳理后发现 3 处与现实不符,**本子决议按实际现状重新定义**:

| 总纲条款 | 总纲设想 | 实际现状 | 本决议处置 |
|---|---|---|---|
| 013 §3.2 节点 atom 分解 | 每节点类型一 domain(`graph-shape` / `graph-text-node` / `graph-sticky`) | V2 是 Instance + ref 模式,所有节点共享一个 Instance 接口 | 走单 atom domain `graph-instance`,通过 payload.type + payload.ref 区分,文字节点是 `ref === 'krig.text.label'` 的特例 |
| 013 §6.1 子任务表 | 3a-1 = shape;3a-2 = text-node + pm-content | shape 和 text-node 是同种 Instance,只差 ref + doc 字段 | 本 3a-1 = graph 容器 + Instance(含 text-node 特例)+ pm-content,**3a-2 改为 sticky 节点专属能力**(若 V2 sticky 跟 Instance 形态差异显著,届时再拆)|
| 013 §3.7 capability 命名 | 新建 `graphCanvasCapability` / `graphShapeCapability` / `graphTextNodeCapability` | V2 已有 `graph-library-store` capability(JSON 后端) | 改造现有 capability 底层落地,接口不变(view 透明)+ 引入 `pmContentCapability`(新) |
| 013 §3 画板视觉模型 | 未明确对标 | V2 已经走 Freeform-style(无限平面 + 扁平节点) | 本决议 §3.1.0 明确对标 Freeform,保留 Figma 扩展占位(`bounds` / `themeRef`),不引入 PowerPoint 母版/布局 |

→ sub-phase 3a-1 完成后反向更新 decision 013 §3.2 / §6.1 / §3.7 + 新增"画板视觉模型 = Freeform"段落,把这 4 处偏差/补充正式登记。

### 0.4 角色冗余复述

每个 3a-N 实施者是独立 session 无上下文。所有关键决议在本文档内复述清楚,跟 sub-phase 1/2 同模式。

---

## 1. 改造目标(What)

### 1.1 本 sub-phase 的范围

**包含**:
- 新增 atom domain `graph-canvas`(画板容器,含 variant 字段)
- 新增 atom domain `graph-instance`(画板内节点,统一 Instance 模型)
- 新增 atom domain `pm`(已有,sub-phase 2 已注册;本子决议**复用**,不重注册)
- 新增边类型 `user:krig:inCanvas`(Instance → Canvas 容器)
- 新增边类型 `user:krig:hasContent`(Instance with text → pm atom),**仅 ref === 'krig.text.label' 时建立**
- 新增 `pmContentCapability`(view-agnostic pm atom 管理,sub-phase 2 noteCapability 不复用此 capability,但底层 storage 共享同 pm domain)
- 改造现有 `src/capabilities/graph-library-store/` capability 的 main 端 impl(JSON → SurrealDB)
- 改造现有 `src/platform/main/graph/canvas-store.ts` 单例底层(磁盘 JSON → SurrealDB CRUD)
- folder 关联升级: `folder_id` 字段 → `user:krig:inFolder` 边(跟 note 同款,通过 sub-phase 2 已有的 folder atom domain)
- 启动时清旧磁盘 JSON(`~/Library/Application Support/KRIG Note V2/krig-data/graph/`)— 选项 M 同 sub-phase 2
- `hasBeenReferenced` 单向 flag(本 sub-phase 内 pm atom 不可能有多引用,但**字段先落地占位**,3a-shared-ref 子任务时 flag 才有真正切换语义)

**不包含**:
- ❌ variant 视图层逻辑(family-tree / mindmap renderer 等,view 层不动)
- ❌ shape-library 改造(ShapeDef 是运行时注册,不持久化)
- ❌ canvas-rendering Host 内部实现(渲染层不动)
- ❌ canvas-text-node 编辑器逻辑(text 编辑 view 不动,仅持久化层换)
- ❌ Inspector / 工具栏等 UI 组件
- ❌ 浅引用 / 跨 view 复用(Q-tx 前置,留 3a-shared-ref)
- ❌ 内容管理 / 游离 atom 清理入口(留 3a-N+)
- ❌ canvas 误删保护(确认弹窗 / 回收站,留 3a-N+,同 sub-phase 2 Q7)

### 1.2 V2 当前状态(实施起点)

按 Explore 摘要梳理的 V2 graph 现状(decision 013 启动前扫):

#### 1.2.1 graph view 层

**目录**: `src/views/graph-canvas-view/`

**主组件**: `GraphCanvasView.tsx` (~170 行) — 通过 `requireCapabilityApi('canvas-rendering')` 拿 Host ref,通过 `requireCapabilityApi('graph-library-store')` 获取 IPC bridge。

**工作位状态**: `pluginStates['graph-canvas-view']` 内存 `activeGraphId / expandedFolders / transientSelectedIds`(`data-model.ts:20-44`)。**本 sub-phase 不动 view 层**。

#### 1.2.2 main 端 graph 持久化(待迁)

**目录**: `src/platform/main/graph/`

**物理落地**: 磁盘 JSON
```
~/Library/Application Support/KRIG Note V2/krig-data/graph/
├── canvases.json            ← metadata + folders 合一
│   { version, entries: GraphCanvasListItem[], folders: GraphFolderRecord[] }
└── documents/{id}.json      ← 单画板 doc_content
    { schema_version: 2, view, instances: Instance[] }
```

**IPC channels(14 个,全保留)**:
- `graph.list / load / create / save / delete / rename / move-to-folder / duplicate`
- `graph.list-changed`(推送)
- `graph.folder-list / folder-create / folder-rename / folder-delete / folder-move`

**Broadcast 机制**: 写操作后 `broadcastListChanged()` → 全 BrowserWindow.send `IPC_CHANNELS.GRAPH_LIST_CHANGED`。

#### 1.2.3 节点 schema(关键)

**Instance**(画板内节点,统一接口,`src/capabilities/canvas-rendering/types.ts:59-114`):
```typescript
interface Instance {
  id: string;
  type: 'shape' | 'substance';        // InstanceKind
  ref: string;                         // Library id,如 'krig.basic.rectangle' / 'krig.text.label'
  position?: { x: number; y: number };
  size?: { w: number; h: number };
  rotation?: number;
  endpoints?: [InstanceEndpoint, InstanceEndpoint];  // line 类用
  params?: Record<string, number>;
  style_overrides?: { fill?: ...; line?: ...; arrow?: ... };
  props?: Record<string, unknown>;
  doc?: TextNodeAtoms;                 // 仅 ref === 'krig.text.label' 时存
  size_lock?: { w?: boolean; h?: boolean };
  text_valign?: 'top' | 'middle' | 'bottom';
}
```

**CanvasDocument**(磁盘文件形态):
```typescript
interface CanvasDocument {
  schema_version: number;              // = 2
  view: { centerX: number; centerY: number; zoom: number };
  instances: Instance[];
}
```

**GraphCanvasListItem**(metadata):
```typescript
interface GraphCanvasListItem {
  id: string;
  title: string;
  variant: 'canvas' | 'family-tree' | 'knowledge' | 'mindmap';
  folder_id: string | null;            // ← 本 sub-phase 升级为 inFolder 边
  updated_at: number;
}
```

**GraphFolderRecord**(folder 树):
```typescript
interface GraphFolderRecord {
  id: string;
  title: string;
  parent_id: string | null;
}
```

→ 当前 graph folder 跟 note folder **是两套独立体系**(canvases.json.folders vs sub-phase 2 folder atom)。**本 sub-phase 不合并,graph folder 走 sub-phase 2 的 folder domain + inFolder 边**(也就是说,完成后 graph 跟 note **共享同一 folder 树**)。

#### 1.2.4 capability 接口现状

**graph-library-store capability**(`src/capabilities/graph-library-store/`):
- `list() / get(id) / create(title, variant, folderId) / update(id, docContent, title) / delete(id) / rename(id, title) / moveToFolder(id, folderId) / duplicate(id, targetFolderId)`
- `folderList() / folderCreate(title, parentId) / folderRename(id, title) / folderDelete(id) / folderMove(id, parentId)`
- `onGraphListChanged(callback) → unsubscribe`

→ **本 sub-phase 保持此 12 个接口签名不变**,view 端调用透明。

### 1.3 完成判据(高层)

- `npm start` 跑通
- 新建画板 + 添加节点(shape / text-node)+ 关闭应用 + 重启 → 画板 + 节点 + 内容全部保留(解决 graph 跟 SurrealDB 隔离的现状)
- graph 跟 note **共享同一 folder 树**(新建 folder 在 note 列表和 graph 列表都可见)
- variants(family-tree / mindmap 等)渲染功能不破坏(view 层透明改造)
- typecheck + lint 通过
- `git diff main..feature/L7-sub3a-1-canvas-instance-migration -- src/platform/main/graph/canvas-store.ts` 显示磁盘 JSON 实施被 SurrealDB 实施替换
- 启动后旧磁盘 JSON (`krig-data/graph/`)被清理(参 §3.5)

详 §6 测试清单。

---

## 2. 改造背景(Why)

### 2.1 为什么先迁 graph(不是 ebook / annotation)

按 [decision 009 §3.1](009-migration-strategy.md) + decision 013 §2.3:
- graph 是 vision.md §2.4 知识图谱闭环的关键(note + graph 共享 atom)
- graph 跟 note + folder 体系**整合最紧密**(共享 folder 树是直观收益)
- graph 的 Instance + ref 模式是 KRIG substance 三层架构(memory `project_substance_three_layers`)的"实例化"层,符合 V2 既有设计哲学
- ebook / annotation 紧跟 graph 的复杂度梯度,sub-phase 3b 顺手做

### 2.2 为什么 Instance + ref 模式 + 单 atom domain

总纲设想"每节点一 domain",但 V2 现状已经走 Instance 模式。理由:

1. **跟 V2 既有 substance 哲学一致** — substance(类) → Instance(实例),atom domain 应该是"实例容器",不是按"实例形状"分裂
2. **Library 中 ShapeDef 是运行时注册** — 不持久化,所以"`graph-shape`"这种 domain 没意义(shape 的语义在 ShapeDef + ref 上,不在 atom 上)
3. **未来扩展 substance 不需要新 atom domain** — 加新 substance type 只是 Library 注册,storage schema 不变
4. **跟 sub-phase 2 pm domain 同模式** — pm 装多种 PM 节点(paragraph / heading / text / mark / 等),一个 domain 装多形态

### 2.3 为什么 graph folder 跟 note folder 合并

按用户拍板 + decision 013 §3.6 "graph 跟 note 共享 folder 体系":
- 用户视角: 我的"工作"folder 应该同时装 note 和 graph,**不该被工具强行分裂**
- 数据视角: folder 是 KRIG 通用容器概念,不绑定具体内容类型
- 实施代价: V2 sub-phase 2 已有 folder atom domain,graph 复用即可,不重复实现

→ 完成后,note + graph + 未来 ebook / annotation **共享同一 folder 树**,KRIG 知识管理体验自然统一。

### 2.4 接受的代价

- `folder_id` 字段语义变化(从直接外键变为查 inFolder 边),view 端透明但内部逻辑需重写
- 现有 `canvases.json.folders` 数组要全清,改走 folder atom — V2 测试数据可丢(选项 M)
- text-node 持久化引入 hasContent 边 + pm atom 双层,**Instance.doc 字段在 atom payload 中不再保存**(改为查边解析 pm atom)
- variants 渲染逻辑需要验证 — view 层接口不变,但 Instance 进入 view 时形态需保持一致

---

## 3. 实施目标态(What 具体)

### 3.1 新增 atom domain `graph-canvas`

#### 3.1.0 画板模型对标决议

按用户拍板(2026-05-12 选 A):**对标 Freeform 无限白板形态,保留 Figma 扩展接口,明确不引入 PowerPoint 母版/布局体系**。

| 维度 | 决议 | 理由 |
|---|---|---|
| 边界形态 | **无限平面**(Freeform / Miro 同款) | KRIG 是知识工具,边界是认知边界不是物理边界 |
| 节点结构 | **扁平 Instance + ref**(V2 现状)| 不引入 Frame / Group 嵌套(留 sub-phase 4+ 评估)|
| 母版 / 布局 | **不引入** | PowerPoint 演示场景不适用 KRIG |
| 主题系统 | **不引入**(schema 仅占位 `themeRef`) | 留 sub-phase 4+ 跟 substance 三层架构联合实施 |
| 协作元数据 | **不引入** | 单机单用户(decision 010),协作留 v2+ |

→ 本 sub-phase 实施 Freeform-style 极简 canvas 模型,前 4 个 schema 字段必填,后 2 个字段(`bounds` / `themeRef`)做 schema 占位但 capability 不读不写,**为 sub-phase 4+ Figma-style Frame 嵌套 / 主题系统留接口**。

#### 3.1.1 GraphCanvasPayload 定义

```ts
/** graph-canvas domain — 画板容器(Freeform 对标 + Figma 扩展占位)*/
export interface GraphCanvasPayload {
  // ── 基础(V2 现状 + Freeform 对标必填)──

  title: string;
  variant: 'canvas' | 'family-tree' | 'knowledge' | 'mindmap';

  /** viewport(画板默认视角,Freeform / Figma 同款)*/
  view: {
    centerX: number;
    centerY: number;
    zoom: number;
  };

  /** schema 版本(V2 现有,保留)*/
  schemaVersion: number;  // = 2

  // ── Freeform-style 视觉(可选,默认 undefined / 视为透明白底 + 网格显示)──

  /** 背景类型 + 颜色 */
  background?: {
    type: 'solid' | 'dotted-grid' | 'lined-grid' | 'isometric-grid';
    color?: string;
  };

  /** 显示网格(独立于 background,Freeform UX 模式)*/
  gridVisible?: boolean;

  /** 是否锁定编辑(Freeform 同款 view-only 模式;view 端真正实施留 sub-phase 4+)*/
  locked?: boolean;

  // ── Figma-style 扩展接口(本 sub-phase schema 预留,capability 不消费)──

  /**
   * Frame 边界
   * - undefined / null = 无限平面(默认,Freeform-style)
   * - { width, height } = 固定 frame(Figma-style,留 sub-phase 4+)
   *
   * 本 sub-phase capability 不读不写此字段,view 端忽略。
   */
  bounds?: { width: number; height: number } | null;

  /**
   * 主题引用(跟 substance 三层架构 + 主题系统联合实施)
   * 留 sub-phase 4+,本 sub-phase capability 不读不写。
   */
  themeRef?: string | null;
}
```

#### 3.1.2 AtomPayloadOf<D> 分派

```ts
export type AtomPayloadOf<D extends AtomDomain> =
  D extends 'pm'          ? PmPayload :
  D extends 'rdf'         ? RdfPayload :
  D extends 'embedding'   ? EmbeddingPayload :
  D extends 'three'       ? ThreePayload :
  D extends 'folder'      ? FolderPayload :
  D extends 'graph-canvas' ? GraphCanvasPayload :     // ← 新增
  D extends 'graph-instance' ? GraphInstancePayload : // ← 新增(见 §3.2)
  unknown;
```

#### 3.1.3 字段实施范围

| 字段 | 本 sub-phase 实施 | 备注 |
|---|---|---|
| `title` | ✅ 必填 | view 透明 |
| `variant` | ✅ 必填 | 默认 `'canvas'` |
| `view` | ✅ 必填 | viewport,V2 现状 |
| `schemaVersion` | ✅ 必填 = 2 | V2 现状 |
| `background` | ⚠ 可选,默认 `undefined`(渲染为透明白底 + 默认 dotted-grid) | view 端读到后渲染 |
| `gridVisible` | ⚠ 可选,默认 `undefined`(视为 `true`) | view 端读到后控制网格层 |
| `locked` | ⚠ 可选,schema 落地 | view 端 sub-phase 4+ 实施锁定逻辑 |
| `bounds` | ❌ 不实施,仅 schema 占位 | sub-phase 4+ |
| `themeRef` | ❌ 不实施,仅 schema 占位 | sub-phase 4+ |

→ 本 sub-phase capability 在 `library.create` / `library.update` 时:**只写前 4 个必填字段 + 可选 3 个(若 view 端传入)**,不主动初始化 `bounds` / `themeRef`(让它们 undefined)。

#### 3.1.4 关系边

**画板归属 folder**: 走 `user:krig:inFolder` 边,subject=canvas atom, object=folder atom(folder 已在 sub-phase 2 注册)。

**画板内节点**: 走 `user:krig:inCanvas` 边,subject=instance atom, object=canvas atom(下节 §3.2)。

### 3.2 新增 atom domain `graph-instance`

**定义**:

```ts
/** graph-instance domain — 画板内节点统一模型 */
export interface GraphInstancePayload {
  /** 节点类型 — V2 既有 InstanceKind */
  type: 'shape' | 'substance';
  /** Library 中的 ShapeDef / SubstanceDef id(如 'krig.basic.rectangle' / 'krig.text.label')*/
  ref: string;
  /** 位置 / 尺寸(可选,line 类节点用 endpoints)*/
  position?: { x: number; y: number };
  size?: { w: number; h: number };
  rotation?: number;
  /** Line 类:端点引用其他 Instance(留 future 节点类型;3a-1 不实施 line)*/
  endpoints?: [InstanceEndpoint, InstanceEndpoint];
  /** parametric shape 的参数 */
  params?: Record<string, number>;
  /** 样式 override */
  style_overrides?: StyleOverrides;
  /** 通用扩展槽 */
  props?: Record<string, unknown>;
  /** 锁定尺寸 */
  size_lock?: { w?: boolean; h?: boolean };
  /** 文字垂直对齐(仅 ref === 'krig.text.label' 用)*/
  text_valign?: 'top' | 'middle' | 'bottom';
  /**
   * ⚠ doc 字段移除 — text-node 的 PM 内容走 hasContent 边 + pm atom 表达,
   * 不再存 atom payload 内。view 层从 hasContent 边解析 doc 后,在 Host
   * 内部仍按 Instance.doc 形态消费(适配层在 capability 内做,view 透明)。
   */
}

type InstanceEndpoint = unknown;     // 留 future,本 sub-phase 不实施 line
type StyleOverrides = unknown;       // 沿用 V2 既有 type,实施者从 canvas-rendering/types.ts 复用
```

**实施注意**: `props` / `style_overrides` / `endpoints` 等结构沿用 V2 既有 `src/capabilities/canvas-rendering/types.ts:59-114` 定义,实施者**直接 import 复用类型,不重定义**。

### 3.3 边类型规范

#### `user:krig:inCanvas`(本 sub-phase 新引入)

```
predicate: 'user:krig:inCanvas'
subject:   AtomRef(graph-instance atom)
object:    AtomRef(graph-canvas atom)
cardinality: 一对一(归属边 — 一个 Instance 严格归属一个画板)
attrs:     { createdBy: 'user-default', createdAt }
```

⚠ **P0a-bis 反向更新(2026-05-13)**:`inCanvas` 升级为**归属边**语义。
- **"归属"含义**:容器归属(Instance **诞生于**该 canvas,cascade 跟随 canvas 删除),**不指**编辑者归属(KRIG-Note v1 单机单用户,Owner-Editor 区分无意义)。
- **机制化保证**(P0a-bis 三层防线,详 [decision 019](019-graph-instance-cardinality-hotfix.md)):
  1. **K1 view 端**:`NodeRenderer.nextInstanceId` 走 ULID 全局唯一(原 `i-001/i-002` per-canvas counter 撞库已修)
  2. **K2 store 端**:`canvas-store.createInstance` 在 putEdge inCanvas 前查既有 → keep-latest 自愈(K1 后理论不触发)
  3. **K3 storage 启动**:`runCardinalityCheck` 扫描 inCanvas + hasContent 一对多边 → keep-latest 异步清理(覆盖历史污染数据)
- **文档语言**:用 "归属" / "container" / "contained in" 描述,**避免**用 "owner" 字眼(歧义大)。
- **未来 sub-phase 3a-shared-ref 对照**:届时引入新边 `referencedIn`(暂定名)表示**引用关系**(一对多 cardinality,不改变归属);详 [decision 019 §9](019-graph-instance-cardinality-hotfix.md)。当前 sub-phase **不引入此边**(避免死代码占位)。

#### `user:krig:hasContent`(本 sub-phase 新引入)

```
predicate: 'user:krig:hasContent'
subject:   AtomRef(graph-instance atom,其 ref === 'krig.text.label')
object:    AtomRef(pm atom)
cardinality: 一对一(Instance → pm atom);
            pm → Instance 反向暂时一对一(单引用约束,见 decision 013 §3.5.1.bis)
attrs:     { createdBy: 'user-default', createdAt }
```

⚠ **3a-1 单引用约束**: 每条 pm atom **只能**有 1 条 hasContent 边指向它(从某个 Instance)。多引用是 3a-shared-ref 子任务,前置 Q-tx 必做。

#### `user:krig:inFolder`(sub-phase 2 已有,本 sub-phase 复用)

```
predicate: 'user:krig:inFolder'
subject:   AtomRef(graph-canvas atom)    ← 本 sub-phase 新增使用方
object:    AtomRef(folder atom)
cardinality: 一对一
attrs:     { createdBy: 'user-default', createdAt }
```

→ note + folder + graph-canvas **共用一种 inFolder 边语义**,跟 KRIG 通用容器概念一致。

### 3.4 pmContentCapability(新)

#### 定位

按 decision 013 §3.4,引入独立 `pmContentCapability` 管理 view-agnostic pm atom。本 sub-phase 引入 **3 个核心方法**(其他方法留 3a-N+ 实施):

```ts
// src/capabilities/pm-content/types.ts
export interface PmContentCapabilityApi {
  /** 创建独立 pm atom(从 Instance 创建时调用)*/
  createPmAtom(initialDoc: PmDocEnvelope): Promise<PmAtomInfo>;

  /** 读单个 pm atom */
  getPmAtom(id: string): Promise<PmAtomInfo | null>;

  /** 更新 pm atom 内容 */
  updatePmAtom(id: string, doc: PmDocEnvelope): Promise<PmAtomInfo>;
}

export interface PmAtomInfo {
  id: string;
  doc: PmDocEnvelope;
  hasBeenReferenced: boolean;        // 3a-1 阶段恒 false(单引用)
  createdAt: number;
  updatedAt: number;
}

export type PmDocEnvelope = NoteDocEnvelope;  // 复用 sub-phase 2 的 DriverSerialized 信封
```

**留 3a-N+ 的方法**(本 sub-phase 不实施):
- `listOrphaned()` — 游离 pm atom 列表
- `listReferences(pmAtomId)` — 反查引用 wrapper
- `deletePmAtom(id)` — "彻底删除内容"高级路径
- `forceDetachWrapper(nodeId)` — 强制断引用
- `getReferencedFlag(pmAtomId)` — flag 查询(本 sub-phase 单引用 = 永远 false)

#### 跟 noteCapability 的关系(明确不混用)

| Capability | 职责 | 触达 |
|---|---|---|
| **noteCapability** | sub-phase 2 实施:note view + folder 管理 | 间接通过 storage,但 sub-phase 2 是简化版语义(note = pm atom 1:1,无 hasNoteView 边)|
| **pmContentCapability** | sub-phase 3a-1 引入:**graph 端的 pm atom CRUD** | 直接走 storage |

**底层共享 pm atom domain,但 capability 互不调用**。sub-phase 3a-2.5 升级 noteCapability 时,可考虑合并(改成 noteCapability 内部调 pmContentCapability),**本 sub-phase 不合并**。

#### 实施位置

```
src/capabilities/pm-content/
├── index.ts          renderer 端薄包装(对齐 noteCapability 模板)
├── types.ts          PmContentCapabilityApi + PmAtomInfo + PmDocEnvelope
└── README.md         capability 边界说明

src/platform/main/pm-content/
├── capability-impl.ts    main 端实施(直 import @storage)
├── handlers.ts           IPC handlers
└── index.ts              注册入口
```

### 3.5 graph-library-store capability 改造

**接口不变**(view 端透明),只改 main 端底层落地。

#### 3.5.1 改造路径

```
view 调用                  本 sub-phase 改造       底层变化
──────────                ──────────────         ────────
library.list()        →   不变                →  改用 SurrealDB 查 graph-canvas atoms
library.load(id)      →   不变                →  改用 SurrealDB 拼 CanvasDocument(canvas atom + 关联 Instance + hasContent → pm atom)
library.create(...)   →   不变                →  新建 graph-canvas atom + 可选 inFolder 边
library.update(...)   →   不变                →  diff Instance 列表 → 增/删/改 instance atoms + inCanvas 边 + text-node 的 hasContent + pm atom
library.delete(id)    →   不变                →  应用层 cascade 删 canvas atom + 所有 Instance + 边
library.rename(...)   →   不变                →  更新 canvas atom payload.title
library.moveToFolder  →   不变                →  改 inFolder 边(先删旧 + 后加新 + capability 层去重保护,见 §3.5.3.6)
library.duplicate(id) →   不变                →  深拷贝 atom 树(canvas + instance + pm,**单引用约束:pm 都深拷贝**)
library.folder*       →   不变                →  改走 sub-phase 2 folderCapability(直接 import 调用)
```

#### 3.5.2 CanvasDocument 序列化 / 反序列化

view 期望的 CanvasDocument 形态:
```ts
interface CanvasDocument {
  schema_version: 2;
  view: { centerX, centerY, zoom };
  instances: Instance[];  // 含 doc 字段(text-node)
}
```

main 端 capability 在 `library.load(id)` 时,**实时拼装** CanvasDocument:

```
1. 读 canvas atom → 拿 view / schemaVersion / variant
2. 查 inCanvas 边 subject 为 canvas → 拿所有 instance atom ids
3. 批读所有 instance atoms
4. 对每个 ref === 'krig.text.label' 的 instance:
   ├── 查 hasContent 边 → 拿 pm atom id
   ├── 读 pm atom → 拿 doc envelope
   └── 拼到 Instance.doc 字段
5. 返回完整 CanvasDocument
```

`library.update(id, docContent, title)` 时,**diff 算法**:

```
1. 读现有 instance atoms + hasContent + pm atoms
2. 对比 docContent.instances vs 现有 instances:
   - 新增: putAtom(graph-instance) + putEdge(inCanvas) + 若是 text-node 则 putAtom(pm) + putEdge(hasContent)
   - 修改: putAtom 更新 payload;若 text-node doc 变 → updateAtom(pm)
   - 删除: deleteAtom(instance) + cascade 边;若 text-node 单引用 → 同时 deleteAtom(pm)
3. 更新 canvas atom payload(view / title)
4. 广播 onGraphListChanged
```

⚠ **diff 算法效率**: 1000 节点画板的全量 update 应在合理时间内完成(< 200ms 是软目标,实施者测试)。如有性能问题,**停下汇报**,设计师评估增量 update 接口。

#### 3.5.3 folder 关联升级(含 adapter 设计)

##### 3.5.3.1 数据模型差异(实施前必读)

V2 现状两套 folder 模型不同字段命名 + 集合,**不能直接转调**,必须 adapter 映射:

| 字段语义 | `GraphFolderRecord` (V2 graph) | `FolderInfo` (sub-phase 2) | 差异处置 |
|---|---|---|---|
| id | `id: string` | `id: string` | ✅ 直接映射 |
| 标题 | `title: string` | `title: string` | ✅ 直接映射 |
| 父引用 | `parent_id: string \| null` | `parentId: string \| null` | ⚠ snake_case → camelCase 映射 |
| 创建时间 | `created_at: number` | `createdAt: number` | ⚠ 同上 |
| 更新时间 | (不存在) | `updatedAt: number` | ⚠ adapter 端丢弃 |
| 排序顺序 | `sort_order: number` | **(不存在)** | ⚠ adapter 端规则生成,见 §3.5.3.3 |

→ **GraphCanvasListItem.folder_id**(snake_case)对应业务上的 folder atom id,本身就是 string,**字段名差异由 view 端接口保留,storage 层无差异**。

##### 3.5.3.2 升级路径(对调用方透明)

`library.list()` 返回的 `GraphCanvasListItem[]` **保持 `folder_id` snake_case 字段**(view 透明),但 main 端从 `user:krig:inFolder` 边查出来填充。

`library.moveToFolder(id, folderId)`: 调 `folderCapability.moveFolder(...)` ??? — **不对**,canvas 不是 folder。**正确**: 直接调 storage 层操作 inFolder 边(先删旧 + 后加新),subject=canvas atom, object=folder atom。⚠ 并发语义见 §3.5.3.6。

`library.folderList()` / `folderCreate` / `folderRename` / `folderDelete` / `folderMove`: **不直接转调 folderCapability**,在 graph 侧加 adapter 层做映射。

##### 3.5.3.3 Adapter 设计(`src/platform/main/graph/folder-adapter.ts`,新建)

⚠ **进程边界**: 本文件在 **main 进程**(`src/platform/main/graph/`),**不能**调用 `requireCapabilityApi('folder')`(那是 renderer 侧 capability-registry 入口)。

**正确入口**: 直接从 `@platform/main/folder` barrel 导入 main 侧 capability-impl 函数。这是 sub-phase 2 已建立的同进程直调约定(见 `src/platform/main/folder/index.ts` 注释 "extraction 等 main 端模块可直接 import capability-impl 函数")。

```ts
// src/platform/main/graph/folder-adapter.ts
import type { FolderInfo } from '@shared/ipc/note-folder-types';
import type { GraphFolderRecord } from '@capabilities/graph-library-store/types';
// ⚠ main 侧同进程直调,不走 renderer capability registry
import {
  listFolders,
  createFolder,
  renameFolder,
  moveFolder,
  deleteFolder,
} from '@platform/main/folder';

/** FolderInfo → GraphFolderRecord(graph IPC 契约保留)*/
function toGraphRecord(info: FolderInfo, sortOrder: number): GraphFolderRecord {
  return {
    id: info.id,
    title: info.title,
    parent_id: info.parentId,
    sort_order: sortOrder,
    created_at: info.createdAt,
  };
}

/**
 * sort_order 生成规则(见 §3.5.3.4)
 * - 按 parentId 分组
 * - 组内主排序键: createdAt 升序
 * - tie-breaker: createdAt 相同则按 id 字典序升序(P2 稳定性约束)
 * - 序号 1..N
 */
function assignSortOrder(folders: FolderInfo[]): GraphFolderRecord[] {
  const byParent = new Map<string | null, FolderInfo[]>();
  for (const f of folders) {
    const arr = byParent.get(f.parentId) ?? [];
    arr.push(f);
    byParent.set(f.parentId, arr);
  }
  const result: GraphFolderRecord[] = [];
  for (const [, group] of byParent) {
    group.sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;  // tie-breaker
    });
    group.forEach((f, idx) => {
      result.push(toGraphRecord(f, idx + 1));
    });
  }
  return result;
}

export async function adapterFolderList(): Promise<GraphFolderRecord[]> {
  const list = await listFolders();
  return assignSortOrder(list);
}

export async function adapterFolderCreate(
  title: string,
  parentId: string | null,
): Promise<GraphFolderRecord | null> {
  const created = await createFolder(title, parentId);
  if (!created) return null;
  // ⚠ P2 一致性: 不用 siblings.length + 1 推算(可能跟后续 list 的 assignSortOrder 不一致),
  // 而是拉全量后跑同一套 assignSortOrder,取该 id 对应的 GraphFolderRecord
  const all = await listFolders();
  const records = assignSortOrder(all);
  return records.find((r) => r.id === created.id) ?? null;
}

export async function adapterFolderRename(id: string, title: string): Promise<void> {
  await renameFolder(id, title);
}

export async function adapterFolderDelete(id: string): Promise<void> {
  // ⚠ 按 sub-phase 2 Path Y 契约: 删 folder 递归删子 folder + 内含 note + 内含 canvas
  // canvas 内含的逻辑由 sub-phase 2 main 侧 deleteFolder 应用层 cascade 实现
  // (storage 层应用层 cascade 自动清 inFolder 边,本 adapter 不重复实施)
  await deleteFolder(id);
}

export async function adapterFolderMove(
  id: string,
  newParentId: string | null,
): Promise<void> {
  await moveFolder(id, newParentId);
}
```

**进程边界纪律**(实施者必须遵守):
- **不可**写: `requireCapabilityApi('folder')`(那是 renderer 路径)
- **不可**写: `window.electronAPI.folderXxx(...)`(那是 renderer → main IPC,本身就在 main 进程)
- **应当**写: `import { ... } from '@platform/main/folder'`(同进程直调,sub-phase 2 已建立的约定)

##### 3.5.3.4 sort_order 生成规则

V2 graph 现有 `GraphFolderRecord.sort_order` 是 V2 graph 模块内部排序状态,**sub-phase 2 folderCapability 未实施排序持久化**(folder 默认按 createdAt 排序)。

**adapter 处理规则**:
- 对每组 folder(同 parentId):
  1. **主排序键**: `createdAt` 升序(早创建的在前)
  2. **tie-breaker**: 若 `createdAt` 相同(同毫秒创建会触发),按 `id` 字典序升序
  3. 排序后序号 1..N
- **稳定性保证**: 同一组数据,不同运行 / 不同进程产生的 sort_order 结果**一致**(ULID id 全局唯一,字典序确定)

**`adapterFolderCreate` 一致性处理**(P2 一致性约束):
- ❌ **不用** `siblings.length + 1` 推算 sort_order(可能跟后续 `adapterFolderList()` 的 `assignSortOrder` 结果不一致)
- ✅ **用** 拉全量 → 跑同一套 `assignSortOrder` → 取该新建 id 对应的 record 返回

→ **graph view 在两个时机拿到的 sort_order 永远一致**(create 返回 vs list 返回同 atom 时)。

**Open Question (Q-folder-sort)**: 用户能否手动拖拽改变 folder 排序?
- **临时默认**: 否,sort_order 由 (createdAt, id) 派生,**不持久化用户手动顺序**
- **触发条件**: 用户提出排序需求 → sub-phase 4+ 评估给 folderCapability 加排序持久化字段(届时 graph adapter 同步消费)

##### 3.5.3.5 风险

- 现有 V2 测试数据中 `canvases.json.folders` 数组的 folder 跟 sub-phase 2 创建的 folder atom **是两套独立数据**。本 sub-phase 启动时按选项 M(下节 §3.6)清旧 JSON 目录,**graph 启动后 folder 列表初始为 sub-phase 2 已有 folder**(可能为空)
- adapter 增加 1 层映射,任何 `FolderInfo` schema 变化(sub-phase 4+ 升级)都需要 graph adapter 同步更新 — 但这是合理代价,跟"不动已完成模块"纪律一致

##### 3.5.3.6 inFolder 边并发语义(继承 Q-tx 退化)

按 decision 011 + sub-phase 2 实施的 X3a 修复(commit `7d828a6`),`storage.transaction(fn)` 当前**退化为无真原子直调**,不保证 BEGIN/COMMIT 原子性。

**`library.moveToFolder(canvasId, newFolderId)` 实施语义**:

```ts
// 走 best-effort 顺序操作,不依赖真原子性
1. listEdges({ predicate: 'inFolder', subjectAtomId: canvasId })  // 读旧边
2. 对每条旧边: deleteEdge(edge.id)                                  // 先删
3. 若 newFolderId !== null: putEdge({ subject: canvasId, object: newFolderId, ... })  // 后加
```

**单机单用户场景的实际风险**: 极低。
- 两步之间被中断的概率 ≈ 进程崩溃 / 电源故障
- 即便中断,worst case 是 canvas 暂时无 inFolder 边(回到根级),**数据不丢失**,用户重做即可

**幂等性保证**:
- 第 1 步如果旧边不存在(已被并发删除),`deleteEdge` 是 no-op,不报错
- 第 3 步即便重复执行,storage 层会建立重复 inFolder 边(违反 cardinality 一对一约束),**这是问题**

**应对 (本 sub-phase)**:

**写路径 (`library.moveToFolder`) — 去重保护**:
1. `listEdges({ predicate: 'inFolder', subjectAtomId: canvasId })` → 拿到所有现有 inFolder 边数组 `existingEdges`
2. **保留最新 = "确定性 keep-latest" 规则**:
   - 主键:`edge.createdAt` 最大者保留
   - tie-breaker:`createdAt` 相同则 `edge.id` 字典序最大者保留
   - **算法**: `existingEdges.sort((a, b) => b.createdAt - a.createdAt || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0))[0]` 即为应保留的"最新"
3. 删除 `existingEdges` 中其他所有边(保留最新一条)
4. 检查保留边的 `object.atomId` 是否等于 `newFolderId`:
   - 相等 → no-op(已经在目标 folder)
   - 不等 → 删保留边 + 创建新 inFolder 边指向 newFolderId
5. 若 `newFolderId === null` → 删保留边(无新边创建,canvas 回根级)

**读路径 (`library.list` / `library.load`) — 自愈规范化**:
- 拼装 `GraphCanvasListItem.folder_id` 时调 `listEdges` 拿 inFolder 边数组
- 若数组 length > 1(脏数据)→ 按上述"keep-latest" 规则选一条,**异步触发清理**(写 console.warn + 后台 `deleteEdge` 多余者),返回保留边的 `object.atomId` 作 `folder_id`
- 避免脏数据长期外溢(即便写路径 bug 残留多条,读路径每次都收敛到 1 条)
- 清理失败不阻塞读路径,只 warn(读优先,清理 best-effort)

**禁止误判为强一致**:
- 测试清单 §6.3 不设"并发 moveToFolder 一致性"项(单机单用户场景无法触发并发)
- 真正强一致性留 Q-tx 解决(sub-phase 3a-tx)

→ **decision 013 §3.5.1.bis 单引用约束 + 本 sub-phase Q-tx 不依赖** 已涵盖该场景。本节作为实施纪律明示。

**hasContent 边同款**:
- 单引用约束下,`hasContent` 边天然一对一(每条 pm atom 只有 1 条入边)
- 删 Instance 时 cascade 删 hasContent 边 + 单引用 pm atom,**顺序敏感但不依赖原子性**(中断 worst case = 残留游离 pm atom,等内容管理入口手动清,sub-phase 3a-N+)
- 读路径若发现 hasContent 边 > 1(违反单引用约束)→ 同 inFolder 模式: warn + 选 keep-latest + 异步清理

### 3.6 graph 现有磁盘 JSON 清理(选项 M)

按 decision 012 同款选项 M,启动时检测旧磁盘 JSON 并清除:

```ts
// src/capabilities/graph-library-store/migration.ts(新建)
export async function clearLegacyGraphStorage(): Promise<void> {
  // main 进程内 — renderer 调 IPC 触发
  const dir = path.join(app.getPath('userData'), 'krig-data', 'graph');
  if (existsSync(dir)) {
    await fs.rm(dir, { recursive: true, force: true });
    console.log('[graph-library-store] cleared legacy disk storage');
  }
}
```

时机: `initStorage()` 后,**graph-library-store 任何 IPC 调用前**,在 main 入口幂等执行。

(V2 测试数据可丢,N7 决议)

### 3.7 hasBeenReferenced 字段落地

**位置**: pm atom payload 内 **不存**(payload 是纯语义内容);改放 atom 元数据(类似 createdBy)— **schema 字段**。

**实施**: 在 `src/storage/surreal/schema.ts` 新增 DEFINE FIELD:

```sql
DEFINE FIELD IF NOT EXISTS hasBeenReferenced ON atom TYPE bool DEFAULT false;
```

→ 此字段适用**所有 atom**(不仅 pm),但目前只有 pm atom 会被多 wrapper 引用(hasContent),其他 domain 此字段恒 false。

**初始值**: false。**永不复位**(decision 013 §3.5.1)。

**触发**: 本 sub-phase 单引用模式下,**永远不触发置 true** — 因为 3a-1 阶段 pm atom 只被 1 个 Instance 引用,没有"第 2 条 hasContent 边"出现。

**字段先落地占位**,等 3a-shared-ref 子任务时:
1. 引入"引用已有 pm atom"UI 路径
2. 在 capability 内创建第 2+ 条 hasContent 边时,update pm atom 此字段为 true
3. 此时 Q-tx 必须已解(decision 013 §3.5.1.bis 约束)

⚠ **实施纪律**: 本 sub-phase 创建 pm atom 时显式赋 `hasBeenReferenced: false`,storage 层 schema DEFAULT false 兜底。任何更新此字段的代码**只允许 false → true 单向**(代码层 assertion / lint 规则)。

### 3.8 删除契约(本 sub-phase 简化版)

按 decision 013 §3.5.2 + 单引用约束:

#### 3.8.1 删 Instance(普通 view 操作)

```ts
graphLibraryStore.update(canvasId, docContent, title) 
// 当 docContent.instances 删了某 Instance:

1. 找出被删 Instance 的 atom id
2. 若 ref === 'krig.text.label':
   ├── 查 hasContent 边 → 拿 pm atom id
   ├── 查 pm atom hasBeenReferenced(本 sub-phase 必为 false)
   └── flag = false → 一并删 pm atom + hasContent 边
3. 删 Instance atom + inCanvas 边
4. 广播 onGraphListChanged
```

#### 3.8.2 删 Canvas(Path Y 同款)

```ts
graphLibraryStore.delete(canvasId)
// 删整个画板:

1. 查 inCanvas 边 subject 为画板内所有 Instance
2. 对每个 Instance 走 §3.8.1 删除流程(单引用 pm 一并清掉)
3. 删 canvas atom + 应用层 cascade 删 inCanvas / inFolder 边
4. 广播 onGraphListChanged
```

→ V2 现状 canvas-store.delete 是直接删磁盘 JSON,**没有内容保护逻辑**。本 sub-phase 单引用模式下行为等价(草稿态自动 cascade)。

⚠ **风险登记**: 误删画板 = 丢节点 + 丢草稿内容。配套保护(确认弹窗 / 回收站)留 3a-N+(decision 013 §3.6 + sub-phase 2 Q7 同款延期)。

---

## 4. 受影响的代码清单

### 4.1 新建文件

| 文件 | 用途 |
|---|---|
| `src/semantic/types/atom.ts` | 修改:加 `GraphCanvasPayload` + `GraphInstancePayload` + 更新 `AtomPayloadOf<D>` |
| `src/storage/surreal/schema.ts` | 修改:加 `hasBeenReferenced` field DEFINE |
| `src/capabilities/pm-content/index.ts` | renderer 端薄包装 |
| `src/capabilities/pm-content/types.ts` | PmContentCapabilityApi + 类型 |
| `src/capabilities/pm-content/README.md` | 边界说明 |
| `src/capabilities/graph-library-store/migration.ts` | clearLegacyGraphStorage |
| `src/platform/main/graph/folder-adapter.ts` | FolderInfo ↔ GraphFolderRecord 映射 + sort_order 生成(见 §3.5.3.3) |
| `src/platform/main/pm-content/capability-impl.ts` | pm-content main 端实施 |
| `src/platform/main/pm-content/handlers.ts` | pm-content IPC handlers |
| `src/platform/main/pm-content/index.ts` | 注册入口 |
| `src/shared/ipc/pm-content-types.ts` | IPC types |

### 4.2 改造文件

| 文件 | 改动 |
|---|---|
| `src/platform/main/graph/canvas-store.ts` | **完全重写**底层(JSON → SurrealDB),12 个接口签名不变 |
| `src/platform/main/graph/library-handlers.ts` | broadcast 逻辑保留,handlers 内部改调新 capability-impl |
| `src/platform/main/preload/main-window-preload.ts` | 加 `pmContent*` bridge(新 capability)|
| `src/shared/ipc/channel-names.ts` | 加 `PM_CONTENT_*` channels |
| `src/shared/ipc/electron-api.d.ts` | 加 `pmContent*` 接口签名 |
| `src/platform/main/ipc/ipc-bus.ts` | 加 pmContentHandlers 注册 |
| `src/platform/main/index.ts` | 启动时调 `clearLegacyGraphStorage` |

### 4.3 不改的文件(明确边界)

- ✅ `src/views/graph-canvas-view/` 全部 view 层代码(接口透明)
- ✅ `src/capabilities/canvas-rendering/` Host 内部实现(渲染层不动)
- ✅ `src/capabilities/canvas-text-node/` text 编辑器(接口透明)
- ✅ `src/capabilities/shape-library/` ShapeDef 运行时注册(不持久化)
- ✅ `src/capabilities/graph-library-store/index.ts` renderer 端 capability 包装(接口不变)
- ✅ variants 视图层(family-tree / mindmap 等渲染逻辑)
- ✅ sub-phase 2 noteCapability / folderCapability(独立)
- ✅ V1 仓库

---

## 5. 实施步骤(按顺序执行 + 每步 commit)

### Step 5.0 — V2 graph 现状 verify(前置)

实施者**必须先 verify**:

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
# 1. 现有 graph view 路径
ls src/views/graph-canvas-view/
# 2. 现有 graph-library-store capability
ls src/capabilities/graph-library-store/
# 3. 现有 main 端 graph
ls src/platform/main/graph/
# 4. 现有 canvas-rendering / canvas-text-node
ls src/capabilities/canvas-rendering/
ls src/capabilities/canvas-text-node/
```

验证 §1.2 的现状梳理跟实际目录结构一致。**如不一致(目录改名 / 文件移动)→ 停下汇报**。

**commit**: 无(仅 verify)

### Step 5.1 — 创建分支 + 起点验证

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
git checkout main
git pull origin main
git checkout -b feature/L7-sub3a-1-canvas-instance-migration main

npm install
npx tsc --noEmit
npx eslint src/
```

**commit**: 无

### Step 5.2 — 注册新 atom domain(域注册门槛 — decision 013 §3.0)

修改 `src/semantic/types/atom.ts`:

```ts
// 加 GraphCanvasPayload + GraphInstancePayload
// 更新 AtomPayloadOf<D> 加 graph-canvas / graph-instance 分派
```

**域注册 4 步闭环**(commit message 显式列):

1. ✅ `AtomPayloadOf<D>` 加分派
2. ✅ `AtomDomain` 联合类型扩展(若 V2 是 narrow union 形式)
3. ⏳ storage dispatch 验证(留 Step 5.4 / 5.5 完成 capability 后,跑最小 binary 测试)
4. ⏳ capability register(Step 5.4 / 5.6)

**verify**: `npx tsc --noEmit` 通过。

**commit**: `feat(L7-sub3a-1 step 5.2): semantic/types 加 graph-canvas + graph-instance domain (域注册 1/2 步)`

### Step 5.3 — 修改 storage schema 加 hasBeenReferenced field

修改 `src/storage/surreal/schema.ts`,加 DEFINE FIELD。

**binary 验证**:
```bash
# 启动 V2 应用,检查 console 出现:
# [storage/migrations] applying X.X.X: Add hasBeenReferenced field
# 或类似 schema 升级日志(如 migration runner 有版本管理)
```

⚠ **如启动报 schema migration 失败 → 停下汇报**。schema 改动是高风险,实施者必须 binary verify。

**commit**: `feat(L7-sub3a-1 step 5.3): storage schema 加 hasBeenReferenced field`

### Step 5.4 — 实施 pmContentCapability(main 端 + IPC)

新建 `src/platform/main/pm-content/`:
- `capability-impl.ts` — 3 个方法(create / get / update)
- `handlers.ts` — IPC handlers + broadcast(若 sub-phase 3a-N 需要才加 onPmListChanged)
- `index.ts` — `registerPmContentHandlers()`

新建 `src/capabilities/pm-content/`:
- `types.ts` — API + types
- `index.ts` — renderer 包装 + `capabilityRegistry.register`

新建 `src/shared/ipc/pm-content-types.ts`:
- 共享 PmDocEnvelope / PmAtomInfo 等

修改 `src/shared/ipc/channel-names.ts`:
- 加 `PM_CONTENT_CREATE` / `PM_CONTENT_GET` / `PM_CONTENT_UPDATE`

修改 `src/shared/ipc/electron-api.d.ts`:
- 加 `pmContentCreate` / `pmContentGet` / `pmContentUpdate` 签名

修改 `src/platform/main/preload/main-window-preload.ts`:
- 加 `pmContentXxx` bridge

修改 `src/platform/main/ipc/ipc-bus.ts`:
- 加 `registerPmContentHandlers()` 调用

**binary 验证**(实施者跑最小 IPC 测试):
```js
// DevTools console
window.electronAPI.pmContentCreate({ format:'pm-doc-json', version:'0.1', payload:{type:'doc',content:[]} })
  .then(result => console.log('PM CONTENT CREATED:', result));
```

**完成域注册门槛步骤 3 + 4**:
- ✅ storage dispatch 验证(pm-content getAtom 走通)
- ✅ capability register(`capabilityRegistry.register({ id: 'pm-content', api: ... })`)

**commit**: `feat(L7-sub3a-1 step 5.4): pmContentCapability main 端 + IPC + preload bridge (域注册 3/4 步)`

### Step 5.5 — 改造 canvas-store(JSON → SurrealDB)

**核心步骤,工作量最大**。重写 `src/platform/main/graph/canvas-store.ts`:

#### Step 5.5a — list / get / create / rename / moveToFolder / delete

实施 atom + edge 模型:
- `list()` → 查所有 graph-canvas atoms + 查所有 inFolder 边 + 拼 `GraphCanvasListItem[]`(填充 folder_id 字段)
- `get(id)` → 拼装 CanvasDocument(canvas atom + Instance + hasContent + pm)
- `create(title, variant, folderId)` → 新建 canvas atom + 可选 inFolder 边
- `rename(id, title)` → 更新 canvas atom payload.title
- `moveToFolder(id, folderId)` → 先 listEdges 旧 inFolder → 删旧 → 加新(单机单用户 best-effort,§3.5.3.6 并发语义;capability 层做去重保护,即便已有多条旧边也清掉后只留一条新边)
- `delete(id)` → §3.8.2 Path Y for canvas

**binary 验证**(每个方法跑过 IPC 直调):
```js
window.electronAPI.graphCreate('测试画板', 'canvas', null)
  .then(c => console.log('CREATED:', c));
window.electronAPI.graphList().then(list => console.log('LIST:', list));
```

**commit**: `feat(L7-sub3a-1 step 5.5a): canvas-store list/get/create/rename/move/delete 走 SurrealDB`

#### Step 5.5b — update(diff 算法)

实施 §3.5.2 的 diff 算法。**这是最复杂的方法**:
- 读现有 Instance atoms + hasContent + pm atoms
- 对比 docContent.instances vs 现有 → 新增 / 修改 / 删除
- text-node 特例处理(hasContent 边 + pm atom)

**binary 验证**:
```js
const doc = { schema_version: 2, view: {centerX:0,centerY:0,zoom:1}, instances: [
  { id: 'ulid1', type: 'shape', ref: 'krig.basic.rectangle', position:{x:0,y:0}, size:{w:100,h:50} }
]};
window.electronAPI.graphSave(canvasId, doc, '测试')
  .then(() => window.electronAPI.graphLoad(canvasId))
  .then(record => console.log('LOADED:', record));
```

→ 写入 1 个 shape + 读回应一致。

**commit**: `feat(L7-sub3a-1 step 5.5b): canvas-store update diff 算法 + text-node hasContent 双 atom`

#### Step 5.5c — duplicate(深拷贝)

实施: 深拷贝 canvas atom + 所有 Instance atoms + text-node 的 pm atom(单引用约束:都深拷贝,不浅引用)。

**commit**: `feat(L7-sub3a-1 step 5.5c): canvas-store duplicate 深拷贝(单引用约束)`

### Step 5.6 — folder 关联升级(通过 adapter)

#### 5.6a — 实施 folder-adapter

新建 `src/platform/main/graph/folder-adapter.ts`,按 §3.5.3.3 模板:
- `toGraphRecord(info, sortOrder)` 映射
- `assignSortOrder(folders)` sort_order 生成
- `adapterFolderList / Create / Rename / Delete / Move`

⚠ **不动 `src/capabilities/folder/` / `src/platform/main/folder/`**(纪律 §0.2.6)。

#### 5.6b — canvas-store folder* 改调 adapter

修改 `canvas-store.ts` 的 folder* 方法:

```ts
// 旧
folderList() → 读 canvases.json.folders
// 新
folderList() → return adapterFolderList();    // 走 adapter → folderCap().listFolders() → 加 sort_order
```

graph-library-store IPC handler 仍然暴露 `graph.folder-*` channels,**接口不变,view 透明**。

⚠ `library.moveToFolder(canvasId, folderId)` **不是** folder 操作而是 canvas 的 inFolder 边操作(canvas atom 是 subject, folder atom 是 object)。**直接走 storage.listEdges / putEdge / deleteEdge**,不经 folder-adapter,语义见 §3.5.3.6 并发处理。

#### 5.6c — binary 验证

```js
// 在 NavSide(note view)创建一个 folder → 然后:
window.electronAPI.graphFolderList()
  .then(list => console.log('GRAPH FOLDERS:', list));
// 应:
// - 包含 NavSide 创建的 folder(共享 folder 树)
// - 每条含 sort_order 字段(adapter 生成)
// - parent_id 字段(snake_case,从 FolderInfo.parentId 映射)
```

**commit**: `feat(L7-sub3a-1 step 5.6): folder 关联升级 — graph 跟 note 共享 folder 树 + adapter 映射`

### Step 5.7 — clearLegacyGraphStorage

新建 `src/capabilities/graph-library-store/migration.ts` + 改 `src/platform/main/index.ts`:

```ts
// in initStorage 后:
await clearLegacyGraphStorage();
```

**verify**: 启动后 console 出现 `[graph-library-store] cleared legacy disk storage`(若旧目录存在),旧目录已被删除。

**commit**: `feat(L7-sub3a-1 step 5.7): clearLegacyGraphStorage 启动时清旧磁盘 JSON`

### Step 5.8 — typecheck + lint

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
npx tsc --noEmit
npx eslint src/
```

修复任何报错。

**commit**: `chore(L7-sub3a-1 step 5.8): typecheck + lint pass`

### Step 5.9 — npm start 集成验证

按 §6 测试清单跑核心场景。

**EM 验证**:
- EM5 崩溃率: 连续 30+ 次操作(创建画板 / 加节点 / 编辑文字 / 删除)无崩溃
- EM6 cascade delete: 删画板时 console 反查 SurrealDB 中是否还有 orphan 边

**commit**: `chore(L7-sub3a-1 step 5.9): EM5/EM6 + 集成测试通过`

### Step 5.10 — capability README + DESIGN

新建:
- `src/capabilities/pm-content/README.md`
- `src/capabilities/pm-content/DESIGN.md`

更新:
- `src/capabilities/graph-library-store/DESIGN.md`(若 V2 已有)说明 SurrealDB 后端

**commit**: `docs(L7-sub3a-1 step 5.10): capability README + DESIGN`

### Step 5.11 — 完成报告

发消息:

```
L7-sub3a-1-canvas-instance-migration 实施完成请审计

分支: feature/L7-sub3a-1-canvas-instance-migration
共 X commits

域注册闭环: ✅ graph-canvas + graph-instance + pm (复用)

测试报告:
- typecheck: ✓
- eslint: ✓
- §6.x 测试清单结果
- EM5/EM6 结果

未实施部分:
- variants 视图层逻辑(view 不动)
- sticky / connector 等其他节点类型(留 3a-3+)
- 浅引用 / 跨 view 复用(留 3a-shared-ref)

等审计师批复。
```

---

## 6. 测试清单

### 6.1 静态检查

| 序号 | 操作 | 期望 |
|---|---|---|
| 6.1.1 | `npx tsc --noEmit` | 0 errors |
| 6.1.2 | `npx eslint src/` | 0 errors(允许 pre-existing warnings)|

### 6.2 业务功能(核心)

| 序号 | 操作 | 期望 |
|---|---|---|
| 6.2.1 | 启动应用 | console 显示 `[storage] initialized` + `[graph-library-store] cleared legacy disk storage`(若旧数据)+ `[L0]-[L5] alive` |
| 6.2.2 | 新建画板 → 加 shape → 改位置 → 关闭重启 | 画板 + shape + 位置全部保留 |
| 6.2.3 | 新建画板 → 加 text-node → 输入文字 → 关闭重启 | 文字内容保留(验证 hasContent 边 + pm atom 双层)|
| 6.2.4 | 新建画板 → 加 text-node → 删除该 text-node | text-node 消失,**且 SurrealDB 中对应 pm atom 也被 cascade 删**(单引用模式,console 验证)|
| 6.2.5 | NavSide 新建 folder → graph NavSide 拖画板进 folder | 画板归属正确,**且 NavSide(note view)也看到此 folder 内含 graph**(共享 folder 树)|
| 6.2.6 | 删 folder X(内含 2 个画板 + 3 个 note)| Path Y:folder X / 内含画板 / 内含 note 全部消失(沿用 sub-phase 2 Path Y)|
| 6.2.7 | 创建 variant='family-tree' 画板,加节点 | family-tree view 渲染正常(view 透明)|
| 6.2.8 | 复制画板(duplicate)| 副本独立,改副本不影响原版(深拷贝)|

### 6.3 EM 验证

| 序号 | 操作 | 期望 |
|---|---|---|
| 6.3.1 | EM5 崩溃率:连续 30+ 次操作 | 0 次崩溃 |
| 6.3.2 | EM6 cascade delete | 删 Instance 后 console 查 inCanvas / hasContent 边无残留 |
| 6.3.3 | moveToFolder 重入幂等 | 同一画板连续 `graphMoveToFolder(canvasId, folderA)` × 3 次 → SurrealDB 内只有 1 条 inFolder 边(去重保护,§3.5.3.6 写路径)|
| 6.3.4 | moveToFolder null 语义 | `graphMoveToFolder(canvasId, null)` → 删除现有 inFolder 边,无新边,画板回到根级 |
| 6.3.5 | 读路径自愈(脏数据) | 人为通过 `db.query('CREATE edge ...')` 直接 SurrealQL 插 2 条同 subject 的 inFolder 边 → 调 `graphList()` 后:返回的 `folder_id` 收敛到 keep-latest 规则,console.warn 出现"脏 inFolder 多边",**异步清理后 SurrealDB 内只剩 1 条** |

### 6.4 反向 grep 验证

| 序号 | 操作 | 期望 |
|---|---|---|
| 6.4.1 | `grep -rn "@/storage" src/views/graph-canvas-view/` | 0 处(view 不直连 storage)|
| 6.4.2 | `grep -rn "canvases.json\|documents/\${id}\.json" src/` | 0 处(磁盘 JSON 引用全清)|
| 6.4.3 | `grep -rn "krig-data/graph" src/` | 仅在 migration.ts 内出现(用于清理路径)|
| 6.4.4 | `git diff main -- src/platform/main/graph/canvas-store.ts` | 显著重写(不再有 fs.writeFile / readFile)|

### 6.5 binary 验证(pm-content)

```js
// DevTools console:
const env = { format:'pm-doc-json', version:'0.1', payload:{type:'doc',content:[]} };
const a = await window.electronAPI.pmContentCreate(env);
console.log('Created:', a.id, a.hasBeenReferenced);  // → false
const b = await window.electronAPI.pmContentGet(a.id);
console.log('Got:', b);
```

---

## 7. 审计验收标准

### 7.1 代码合规审计

- commit 序列完整(约 8-10 个,可能因 5.5a/b/c 拆分有变化)
- view 层(`src/views/graph-canvas-view/`)0 处 import `@/storage`
- `canvas-store.ts` 完全重写,不再读写磁盘 JSON
- pmContentCapability 完整(3 个方法 + IPC + preload + register)
- 域注册门槛 4 步闭环(graph-canvas / graph-instance / pm 三 domain 全 register)
- schema 加 hasBeenReferenced field
- folder 共享 sub-phase 2 folder 体系

### 7.2 实施细节审计

- diff 算法 verify(写 + 读对称)
- text-node 的 hasContent 边 + pm atom 联动 verify
- 单引用约束 verify(任何 pm atom 只能有 1 条 hasContent 入边)
- Path Y for canvas 删除 verify
- variants(family-tree)渲染不破坏

### 7.3 行为审计

实测 §6.2 8 个核心场景通过。

### 7.4 通过后流程

按用户授权:
1. merge `feature/L7-sub3a-1-canvas-instance-migration` 到 main(--no-ff)
2. push origin main
3. 反向更新 decision 013(§3.2 / §6.1 / §3.7 偏差登记) + decision 009 §3.1 sub-phase 3a-1 标 ✅
4. atom domain 列表加 graph-canvas / graph-instance

---

## 8. Open Questions

| 编号 | 问题 | 临时默认 / 应对 |
|---|---|---|
| Q1 | diff 算法对 1000+ 节点画板的性能 | 实测,>200ms 时考虑增量 update 接口(留 3a-N+)|
| Q2 | Instance.props / style_overrides / params 在 atom payload 内的 schema 严格度 | 不严格,沿用 V2 既有 `Record<string, unknown>` 灵活 schema |
| Q3 | hasContent 边的 attrs 是否要加"reference 顺序"(原始 owner)| 不加(decision 013 §3.5 单向 flag 已替代 origin 概念)|
| Q4 | graph-library-store 是否要分拆 canvas / instance / pm 三个 capability | 不分拆(view 端期望 12 接口,接口不变最少改动)|
| Q5 | duplicate 时 pm atom 是否深拷贝 | ✅ 深拷贝(单引用约束)|
| Q6 | family-tree / mindmap variant 在 atom payload 内 | ✅ 存 canvas atom payload.variant 字段 |
| Q7 | 误删 canvas 保护 | 留 3a-N+(同 sub-phase 2 Q7)|
| Q8 | canvas-rendering Host 是否需要适配 Instance 形态变化 | ⚠ 关键:Instance 接口在 view 端不变,**capability 层在 load 时拼装 doc 字段**,Host 透明。但如 V2 Host 期望 doc 是字符串 vs 对象,实施时 verify |
| Q-tx | storage.transaction() 真原子性 | sub-phase 1 Q-tx 继承,本 sub-phase 不依赖(单引用模式)。`moveToFolder` / hasContent 删除等多步骤 best-effort 语义见 §3.5.3.6,单机单用户场景实际风险极低,不在本 sub-phase 范围 |
| Q-canvas-model | 画板视觉模型对标哪个 app | ✅ 已拍板(2026-05-12 用户选 A):**Freeform 起步 + Figma 扩展占位**。无限平面 + 扁平节点 + 极简 canvas-level 字段;`bounds` / `themeRef` schema 占位但本 sub-phase 不消费。PowerPoint 母版/布局明确不引入 |
| Q-canvas-model-future | Frame 嵌套 / 主题系统何时引入 | sub-phase 4+,跟 substance 三层架构(memory `project_substance_three_layers`)联合设计;触发条件 = 用户出现"画板内嵌套画板"或"跨画板共享主题"真实需求 |

---

## 9. 决议链

### 9.1 与已 commit 规范文档的关系

- [`decision 008 §4.0`](008-storage-layer-interface.md) — view 不直连 storage
- [`decision 009 §3.1`](009-migration-strategy.md) — sub-phase 3 范围
- [`decision 011`](011-sub-phase-1-surrealdb-infrastructure.md) — Q-tx 继承
- [`decision 012`](012-sub-phase-2-note-folder-migration.md) — capability + IPC 模板 + Path Y + folder atom 复用
- [`decision 013`](013-sub-phase-3a-graph-canvas-migration.md) — sub-phase 3a 总纲(本子决议受其约束 + 修订其偏差)
- [`atom/spec.md`](../../atom/spec.md) — graph-canvas / graph-instance 作为新 domain(开放命名 + 强制代码侧注册)
- [`relations/spec.md`](../../relations/spec.md) — `user:krig:inCanvas` / `user:krig:hasContent` 边定义

### 9.2 跟 V2 现状梳理的关系

本决议 §1.2 现状叙述直接复用 decision 013 启动前的 Explore 摘要,**事实优先,不推演**。

### 9.3 设计纪律备忘

- 实施者执行 §5 Step 5.3 schema 改动 + Step 5.5 canvas-store 重写时,**任何 SurrealDB 行为偏离文档立即停下汇报**
- 本决议覆盖 decision 013 §3.2 / §6.1 / §3.7 偏差,反向更新留 sub-phase 3a-1 合并后做

### 9.4 命名一致性

| 资源 | atom domain | capability 模块 | IPC channel | electron-api |
|---|---|---|---|---|
| 画板容器 | `graph-canvas` | `@capabilities/graph-library-store` (现有,复用) | `graph.*`(现有,复用) | `graph*`(现有,复用) |
| 画板节点 | `graph-instance` | 同上 | 同上 | 同上 |
| 内容 (pm) | `pm`(sub-phase 2 已注册,复用) | `@capabilities/pm-content`(新) | `pm-content.*` | `pmContent*` |

---

## 10. 反向更新清单(审计通过后做)

**已完成 (2026-05-12 反向更新合 main 时同步做)**:

1. ✅ `decision 013` 顶部状态: 加"sub-phase 3a-1 已完成"段
2. ✅ `decision 013 §3.2` 节点 atom 分解原则反向修订: "每节点一 domain" → "Instance + ref 模式,单 domain"
3. ✅ `decision 013 §6.1` 子任务表反向修订: 3a-2 内容(原为 text-node)合并入 3a-1,3a-2.5 调整为 note 形态升级
4. ✅ `decision 013 §3.7` capability 命名表反向修订: 加 `pmContentCapability` + 标注 `graph-library-store` 是改造非新建
5. ✅ `decision 013` 新增"画板视觉模型 = Freeform 对标"段落(原决议未明确对标 app)
6. ✅ `decision 013 §3.5.1` 字段位置确认: hasBeenReferenced = atom 元数据(entity 字段),不进 payload
7. ✅ `decision 013 §0.5` 新增设计师纪律累积条款 (第 4 / 第 5 次 P1 教训)
8. ✅ `decision 014` 顶部状态 → ✅ 已实施完成 + merge commit `67f18b2`
9. ✅ `decision 014 §0.2.7` 措辞调整: 实质允许向后兼容字段扩展(详 §12.2 偏离 6)
10. ✅ `decision 014 §5.7` 路径偏差登记: `migration.ts` 实际放 `src/platform/main/graph/` 而非 `src/capabilities/graph-library-store/`(renderer 包不能 import electron/fs)
11. ✅ `decision 014 §12.2` 偏离 6 (AtomEntity 扩展) + 偏离 7 (checkpoint 合并 verify) + 偏离 8 (migration.ts 路径) 完整登记
12. ✅ `decision 012 §12` 偏离登记: deletedNotes → deletedResources cascade scope 扩展
13. ✅ `decision 011 §5.7` AtomEntity 字段表加 hasBeenReferenced (sub-phase 1 反向更新)
14. ✅ `decision 009 §3.1 sub-phase 3` 标 ✅ 部分完成(3a-1)+ merge commit `67f18b2`
15. ✅ `atom/spec.md` atom domain 列表加 graph-canvas / graph-instance(若该文档有列表)
16. ✅ `relations/spec.md` krig vocab 加 inCanvas / hasContent 登记
17. ✅ `src/capabilities/folder/DESIGN.md` cascade scope 扩展说明
18. ✅ `memory feedback_v2_is_workspace_v1_is_reference` 加复合命令陷阱条款 (本 sub-phase npm start & cwd 漂移事故)

**审计发现登记 (F1) — 留 sub-phase 3a-N+ 补**:

- **F1 (Audit)**: §6.3.5 读路径自愈端到端 binary verify 未跑
  - 代码已实施 (`getFolderIdForCanvas` / `getPmAtomIdForInstance` / `asyncCleanupStaleEdges` 完整)
  - 未端到端 verify: 人为插脏边 → `graphList/Load` 触发自愈 → 异步清理验证
  - 风险: 单引用约束正常使用不产生脏边,自愈是兜底但未实测;若写路径任何 bug 残留脏边,自愈是唯一收敛路径
  - 处置: 留 sub-phase 3a-N+ 补 binary verify(可通过手工 surreal CLI 插边模拟)

---

## 11. 风险与回滚

### 11.1 风险

| 风险 | 概率 | 影响 |
|---|---|---|
| diff 算法实施复杂,正确性不易保证 | 中 | 重点 binary 验证(写 + 读对称),最坏退化为全量替换实施 |
| canvas-rendering Host 期望 Instance 形态跟 capability 拼装出来的不一致 | 中 | Step 5.5b binary 测试 verify,不一致 → 停下汇报,设计师评估 |
| hasContent 边 + pm atom 双层删除链路出错 | 中 | Step 5.4 单元 binary 测试 + 5.9 集成测试覆盖 |
| schema 加 hasBeenReferenced field migration 失败 | 低 | Step 5.3 binary verify,失败立即汇报 |
| folder 共享后 sub-phase 2 NavSide 显示异常 | 低 | Step 5.6 verify,note + graph 两侧都看到同 folder |
| variants 渲染破坏 | 低 | Step 5.9.6.2.7 测 family-tree variant 渲染 |

### 11.2 回滚

```bash
git checkout main
git branch -D feature/L7-sub3a-1-canvas-instance-migration
```

main 不受影响。

---

## 12. 附录 A — 跟 sub-phase 2 实施模板的对比

| 维度 | sub-phase 2 | sub-phase 3a-1 |
|---|---|---|
| atom domain 新增数 | 1 (folder) | 2 (graph-canvas + graph-instance) |
| capability 新增数 | 2 (noteCapability + folderCapability) | 1 (pmContentCapability,graph-library-store 是改造) |
| 边类型新增数 | 0(inFolder 已在 spec 中) | 2 (inCanvas + hasContent) |
| IPC channels 新增 | 14 个 note + folder | 3 个 pm-content + 14 个 graph(改造,不新增) |
| view 层改造行数 | 17 文件大改 | 0 (view 透明) |
| schema 改动 | 无 | 加 hasBeenReferenced field |
| storage migration | localStorage 清理 | 磁盘 JSON 目录清理 |
| 工程量预估 | 实际 3 天 | 预估 4-6 天(diff 算法 + pm-content 双层链路) |

---

## 13. 附录 B — 跟 decision 013 总纲的对照表

本决议是 decision 013 §6.1 "3a-1" 行的展开,**新增决议(总纲未提及)**:

- ⚠ Instance + ref 模式(总纲 §3.2 假设每节点一 domain,被现状覆盖)
- ⚠ 单 atom domain `graph-instance`(同上)
- ⚠ text-node 持久化合并入 3a-1(总纲 §6.1 列在 3a-2)
- ✅ `pmContentCapability` 落地(总纲 §3.4 设计)
- ✅ hasContent 边 + 单引用约束(总纲 §3.5.1.bis)
- ✅ Path Y for canvas(总纲 §3.6)
- ✅ folder 共享 sub-phase 2 体系(总纲 §3.6 隐含)

---

*Decision 014 版本结束。预估实施工程量 4-6 天,实际 1 天完成。*

---

## 12. 实施实际情况(2026-05-12 反向更新)

### 12.1 commit 序列(共 10 个)

| # | Step | Commit | 内容 |
|---|---|---|---|
| 1 | 5.2 | `71ea3bc` | semantic/types 加 graph-canvas + graph-instance domain (域注册 1/2) |
| 2 | 5.3 | `991f3d6` | storage schema 加 hasBeenReferenced field (1.1.0 migration) |
| 3 | 5.4 | `c652dee` | pmContentCapability main + IPC + preload + AtomEntity 扩展 |
| 4 | 5.5a | `9c95011` | canvas-store list/get/create/rename/move/delete 走 SurrealDB |
| 5 | 5.5b | `8774c0f` | canvas-store update diff 算法 + text-node hasContent 双层 |
| 6 | 5.5c | `2a71bd0` | canvas-store duplicate 深拷贝(单引用 Q5)|
| 7 | 5.6 | `cec5580` | folder 关联升级 — graph 跟 note 共享 folder 树 + adapter |
| 8 | 5.6.bis | `5764aab` | sub-phase 2 deleteFolder cascade 扩展 graph-canvas(决策点 A)|
| 9 | 5.7 | `7a6c9bf` | clearLegacyGraphStorage 启动时清旧磁盘 JSON |
| 10 | 5.10 | `7e7ea4f` | pm-content DESIGN.md + graph-library-store DESIGN.md v0.2 |

合并 commit: `67f18b2`

### 12.2 与本决议的偏离登记

#### 偏离 1: §3.2 节点 atom 分解(已在 §0.3 / §13 提及)

总纲假设"每节点一 domain",实际 V2 是 Instance + ref,单 `graph-instance` domain + ref 字段区分类型。已反向更新 decision 013 §3.2。

#### 偏离 2: §6.1 子任务表(已在 §0.3 / §13 提及)

总纲 3a-2 = text-node,实际 text-node 合并入 3a-1(因为只比 shape 多 hasContent 边 + pm atom,跟 shape 实施同模板)。3a-2 调整为后续节点类型(如 sticky / connector)。

#### 偏离 3: §3.7 capability 命名(已在 §0.3 提及)

总纲设想"新建 graphCanvasCapability",实际改造既有 `graph-library-store`(接口透明),新建 `pmContentCapability`(view-agnostic pm atom)。

#### 偏离 4: 画板视觉模型 = Freeform(已在 §0.3 + §3.1.0 提及)

总纲未明确对标 app,本决议 §3.1.0 显式拍板 Freeform 对标 + Figma 扩展占位。

#### 偏离 5: 决策点 A — folder cascade scope 扩展

**问题**: sub-phase 2 `deleteFolder` `collectNotesInFolders` 字面只 cascade `payload.domain === 'pm'`,sub-phase 3a-1 加 graph-canvas 后 Path Y for canvas 期望删 folder 时同步删内含 canvas,但代码不支持。

**处置(实施期间主对话拍板 A)**:
- `collectNotesInFolders` → `collectResourcesInFolders`
- 白名单 `['pm', 'graph-canvas']`
- 返回字段 `deletedNotes` → `deletedResources`
- 实施 commit: `5764aab` (step 5.6.bis)
- 反向更新 decision 012 §12 偏离登记

**未来扩展**: sub-phase 3b ebook 接入时,白名单加 `'ebook'`;每加一个内容 domain,显式约束(代码层 + 决议层登记)。

#### 偏离 6: 决策点 E — AtomEntity 扩展 hasBeenReferenced

**问题**: 决议 §3.4 `PmAtomInfo.hasBeenReferenced` 要求 capability 能读到此字段,但 sub-phase 1 `AtomEntity` 5 字段不含(写决议时设计师漏核 — 第 5 次同类 P1 教训)。

**处置(实施期间主对话拍板 A)**:
- `AtomEntity` 加 `hasBeenReferenced?: boolean`(optional 字段,sub-phase 1/2 旧数据 normalizer 用 `?? false` 兜底)
- `normalizeAtomEntity` 同步带出字段
- 实施 commit: `c652dee` (step 5.4 内)
- 反向更新 decision 011 §5.7 + decision 013 §3.5.1

**§0.2.7 措辞调整原因**: 字面"不动 storage 内部实施"过严,实质允许向后兼容字段扩展(跟 sub-phase 2 加 folder domain 同范畴)。

#### 偏离 7: Checkpoint 合并 binary verify

**问题**: 决议 §0.2 + §5.X 各 step 字面要求单独 binary verify(5+ 次),实施期间 D-state 孤儿 surreal 进程让每次 binary verify 都需用户协助重启 mac,5+ 次用户疲劳不可行。

**处置(实施期间主对话拍板修改版 B)**:
- 划分 3 个 checkpoint 合并 verify:
  - Checkpoint 1: Step 5.3 + 5.4 (schema + pm-content IPC)
  - Checkpoint 2: Step 5.5a + 5.5b + 5.5c (canvas-store CRUD/diff/duplicate)
  - Checkpoint 3: Step 5.6 + 5.7 + 5.9 (folder 共享 + cleanup + §6.2 集成)
- 每 step 完成时配套静态深度审计(typecheck / lint / grep / 接口签名核对 / 域注册闭环 / 单引用约束 / 进程边界)
- 任何 checkpoint binary verify 失败 → 立即停下汇报 + 回溯 checkpoint 内所有 step
- 用户协作次数从 5+ 降到 3 次,binary verify 早期 fail-fast 设计基本保留

#### 偏离 8: §5.7 migration.ts 路径

**问题**: 决议 §5.7 字面要求 `src/capabilities/graph-library-store/migration.ts`,但该路径属 renderer 侧 capability 包,无法 import `electron` / `node:fs`(sub-phase 1 边界严防 renderer 包侵入 main API)。

**处置(实施期间务实纠正)**:
- 实际放 `src/platform/main/graph/migration.ts`(main 进程内)
- migration.ts 注释主动登记此偏差
- 反向更新 decision 014 §5.7 + §4.1 文件清单

### 12.3 §6.2 UI 集成测试结果(Checkpoint 3)

| 序号 | 操作 | 结果 |
|---|---|---|
| 6.2.1 | 启动应用 | ✅ `[storage] initialized` + 1.0.0/1.1.0 migration 日志 + clearLegacyGraphStorage(无旧目录 → skip) |
| 6.2.2 | 持久化核心(画板 + shape + 关闭重启)| ✅ |
| 6.2.3 | text-node 持久化(hasContent + pm atom 双层)| ✅ |
| 6.2.4 | 删 text-node cascade 删 pm atom(单引用)| ✅ |
| 6.2.5 | folder 共享(graph + note 双向看到同 folder)| ✅ |
| 6.2.6 | Path Y cascade — 删 folder X 内含 1 画板 + 1 note | ✅ 返 `{deletedFolders:1, deletedResources:2, cascadedEdges:3}` 全删 |
| 6.2.7 | family-tree variant 持久化 | ✅ |
| 6.2.8 | duplicate 独立性 | ✅ |
| 6.3.3 | moveToFolder × 3 幂等(keep-latest 去重)| ✅ |
| 6.3.4 | moveToFolder null(回根级)| ✅ |
| 6.4.1-4.4 | 反向 grep 验证 | ✅ |

EM5/EM6 累计远超 30+ 次操作无崩溃,cascade 边路径正确。

### 12.4 实施期间事故 / 障碍

#### 事故 1: cwd 漂移到 V1(第 3 次同类)

- 实施者后台 `npm start &` 命令漏 `cd V2 &&` 前缀
- zsh 默认 cwd 是 V1,导致 V1 启动了一次,V2 没启动
- 实施者主动汇报 + 自查 + 纠正
- V1 文件系统 / git 完全无损害
- 沉淀: memory `feedback_v2_is_workspace_v1_is_reference` 加复合命令陷阱条款

#### 障碍 1: D-state 孤儿 surreal 进程

- 之前 sub-phase 启动留的 surreal 8533 进程 hang 在内核 IO(UE state)
- SIGTERM / SIGKILL 均无效,只能重启 mac
- 阻塞 Step 5.3 binary verify,用户协助重启 mac 根治
- 沉淀: sub-phase 1 防御链不足(memory `project_surreal_defensive_startup` 仅在正常 shutdown 触发,异常退出留残留)
- 留 Open Question Q-orphan-surreal-d-state-cleanup(留 sub-phase 3a-N+ 或独立小修)

### 12.5 设计师 P1 教训累积(第 5 次)

| 次 | sub-phase | 失误 |
|---|---|---|
| 1 | sub-phase 2 IPC 设计 | 没核实 V2 capability 在哪个进程 |
| 2 | decision 013 §3.0 | 没核实 SurrealDB schema 约束 |
| 3 | decision 014 §3.5.3.3 (前) | 没核实 folder 模块导出 + 进程边界 |
| 4 | decision 014 §3.5.3.3 (实施期) | 没核实 sub-phase 2 deleteFolder cascade scope |
| **5** | **decision 014 §3.4 / §3.7 (实施期)** | **没核实 AtomEntity 字段集 + normalizer 是否带出 hasBeenReferenced** |

**沉淀**: 涉及加 schema field 时,**必须同步核 entity 接口 + normalizer 是否带出**。任何"x 走 storage.getAtom 拿到"的字段,都要 verify entity + normalizer 真带这字段。

### 12.6 审计结论

**代码合规**: typecheck 0 / lint 0 / view 不直连 storage / 磁盘 JSON 全清 / main 进程无 requireCapabilityApi 误用 / 域注册 4 步闭环 / keep-latest + 自愈代码完整。

**行为合规**: §6.2 8 场景 + EM5/EM6 全通过。

**审计发现**: F1 §6.3.5 读路径自愈端到端 binary verify 未跑(已登记到 §10 反向更新清单尾部)。

**审计判定**: ✅ 通过,合 main。

### 12.7 后续 hotfix — sub-phase 3a-1 view client id 模式触发 P0a(2026-05-13)

sub-phase 3a-1 实施引入 [canvas-store.createInstance](../../../../../src/platform/main/graph/canvas-store.ts#L280)
"view 端预生成 client-side id"模式(§3.2.x + canvas-store §5.5b 内 update diff
"新增 (view 端可能预先生成了 client-side id;storage putAtom 允许传 id)"),
但 sub-phase 1 [putAtom](../../../../../src/storage/surreal/storage.ts#L106) 契约字面是
UPDATE-only(传 id 必须已存在),**两者错位**导致 graph instance 写入全部抛
"Atom not found",新 shape 永远不入库(P0a)。

3a-1 实施 / 审计期间 §6.2.2 持久化核心场景通过的原因:**实施期间画板 instance 没传 client id**
(走 createInstance 不带 targetId 路径,storage 生成 ULID,走 putAtom CREATE 分支
不触发 UPDATE-only 抛错);后期 sub-phase 3a-2.5 引入用户拖入 hexagon 等 ref-shape
时 view 端拼出 client id `i-001` 推过来,即刻暴露。

**修复**: [decision 017](017-storage-persistence-hotfix.md) P0a 改 putAtom 为 UPSERT
短路语义(commit `e6b5ca3`),createdAt/createdBy 用 `field OR $val` 短路。

**附带修 P0c**(runner SELECT 3.0.4 不兼容 + catch 静默,跟 3a-1 范围无关
但同一 hotfix 一并修;详 017 §1.2)。

**binary verify 三层实证**(2026-05-13 总指挥协调用户跑):
- shape 3 个跨重启保留 + atom 10 个数据完整(P0a)
- schema_version 3 条 appliedAt 历史时间(P0c)
- 重启 0 行 applying 日志(P0c)

**遗留**: P0d 新发现 — text-node pm content 被空 doc 覆盖跨重启丢文字
(sub-phase 3a-1 §3.4 pmContentCapability 写路径),不在 017 范围,留独立 hotfix。

### 12.8 设计师 P1 教训累积(第 6 次)

| 次 | sub-phase | 失误 |
|---|---|---|
| 6 | decision 014 §3.5.3 / canvas-store.createInstance | 设计 "view 端预生成 client id 推过来" 模式时,没核 sub-phase 1 putAtom 契约支不支持;字面注释"storage putAtom 允许传 id"是设计师一厢情愿,实际只 UPDATE 不 UPSERT |

**沉淀**: 跨 sub-phase 调用 storage 契约时,**必须读 storage.ts 源码验证 input 路径行为**,
而不是按"看起来该这样"假设。注释里写"X 允许 Y"必须配套 grep 实现验证。

### 12.9 后续 hotfix — P0a UPSERT 揭露 inCanvas cardinality 漏机制(2026-05-13 P0a-bis)

decision 017 P0a 修法把 putAtom 改 UPSERT 后,sub-phase 3a-1 实施漏的 cardinality
机制立刻显化:同一个 instance `i-001` 同时出现在两个画板(用户截图实证)。

**根因 — 决议字面拍板,实施漏机制**:

- decision 014 §3.3 line 388 **字面**:`inCanvas cardinality: 一对一(一个 Instance 只在一个画板内)`
- 但 sub-phase 3a-1 三层实施全部漏机制保证:
  - **view 端** [NodeRenderer.nextInstanceId](../../../../../src/capabilities/canvas-rendering/scene/NodeRenderer.ts#L257):基于 `byId.size + 1` 的 per-NodeRenderer counter 生成 `i-001` / `i-002` 短可读 id;NodeRenderer 是 per-canvas 实例 → counter 跨画板碰撞
  - **store 端** [canvas-store.createInstance](../../../../../src/platform/main/graph/canvas-store.ts#L301):直接走 putEdge inCanvas,不查既有边
  - **storage 启动**:无 cardinality self-check
- P0a 修法前(UPDATE-only 抛 not found)隐藏漏(写入失败);P0a 修法后(UPSERT 存在则更新)化为可见(撞库覆盖 + 一对多 inCanvas 边)

**修复 — [decision 019](019-graph-instance-cardinality-hotfix.md) P0a-bis 三层防线**:

1. **K1 view 端**:`nextInstanceId` 改 `generateUlid` 全局唯一(commit `27595aa`)
2. **K2 store 端**:`createInstance` 加 inCanvas 一对一守门 keep-latest 自愈(commit `8198f56`)
3. **K3+K4 storage 启动**:`runCardinalityCheck` 扫 inCanvas + hasContent 一对多边 keep-latest 异步清理(commit `0fd3dda`)
4. **K6 反向更新**:inCanvas 升级归属边语义(本节 §3.3 + relations spec §10.1)
5. **K7 未来扩展**:decision 019 §9 留 `referencedIn` 边接口(sub-phase 3a-shared-ref)

### 12.10 设计师 P1 教训累积(第 7 次)

| 次 | sub-phase | 失误 |
|---|---|---|
| 7 | decision 014 §3.3 line 388 cardinality | **决议字面拍板 "一对一",但实施层(view + store + storage)三层全部漏机制保证。** P0a UPSERT 修法揭露(而非引入)此漏 |

**沉淀**: **决议字面拍板的 cardinality 约束(一对一 / 一对多)是契约,不是注释**。实施时必须:
1. **view 端 id 生成**:跨 view 实例使用同一种 atom 时,client id 必须**全局**唯一(per-view counter 是踩雷模式)
2. **store 端 putEdge 前**:对一对一边,必须查既有边 + 自愈(沿 keep-latest 模式)
3. **storage 启动**:对一对一边,必须有 self-check 兜底(防御实施漏 + 历史污染)

cardinality 约束的实施成本远小于事后排查的成本 — 字面拍板时就要同步登记**三层防线落地点**,而非只写"cardinality: 一对一"一行。

