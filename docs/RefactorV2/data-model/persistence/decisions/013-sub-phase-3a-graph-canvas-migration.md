# Decision 013 — Phase N Sub-phase 3a: Graph Canvas 渐进迁移总纲

> **Phase**: N（实施 Phase）/ Sub-phase 3a 总纲
> **状态**: ✅ **总纲已撰写 + sub-phase 3a-1 已实施完成**(2026-05-12,merge commit `67f18b2`)
>
> **3a-1 完成后反向更新**:
> - §3.2 节点 atom 分解 → 改为 "Instance + ref 模式 + 单 graph-instance domain"(sub-phase 3a-1 实施现实)
> - §3.7 capability 命名表 → 加 `pmContentCapability` + 标 `graph-library-store` 是改造
> - §6.1 子任务表 → 3a-1 范围扩大(含 text-node),3a-2 调整为后续节点
> - §3.5.1 字段位置 → 确认 hasBeenReferenced 在 atom 元数据(entity 字段)
> - 新增 §3.1.bis "画板视觉模型 = Freeform 对标"段落
> - §0.5 设计师纪律累积第 5 次 P1 教训
> **设计师 / 审计师**: main 对话
> **实施者**: 每个 3a-N 子任务由独立 session 执行
> **决议日期**: 2026-05-12
> **前置依赖**: sub-phase 1 (`34e3758`) + sub-phase 2 (`0ad60c7`)
> **对标**: Freeform (Apple) — 纯画板,非图谱推理工具
> **范围风格**: 渐进式 — 一次只持久化一种节点类型,每个独立 sub-phase 闭环

---

## 0. 本文档的角色

### 0.1 与 sub-phase 1/2 的关系

```
sub-phase 1 (decision 011)  →  SurrealDB 基础设施 + StorageAPI
       ↓
sub-phase 2 (decision 012)  →  note + folder 迁移(首次完整跑通 capability + IPC 模式)
       ↓
sub-phase 3a (本决议 013)   →  graph canvas 渐进迁移 — 容器 + 节点逐类型
       ↓
sub-phase 3a-1 (decision 014) →  graph 容器 + shape 节点(首个执行子任务)
sub-phase 3a-2 (decision 015) →  text-node + pmContentCapability(引入双 atom 架构)
sub-phase 3a-3+              →  sticky / connector / image / ... (按需扩展)
```

### 0.2 本决议是总纲,不是执行任务

本决议**只定原则 + 路线 + 约束**,**不实施代码**。每个 3a-N 子任务有自己的独立 decision 文档(014 / 015 / ...)+ 独立分支 + 独立审计。

### 0.3 角色纪律

本决议设计师 = main 对话(审计师同体);每个 3a-N 实施者 = 独立 session(无上下文,decision 文档自包含)。

实施者纪律(与 sub-phase 1/2 同):

1. 严格按本决议 + 对应子决议执行,不自行扩展
2. cwd 严格 cd 到 V2(`feedback_v2_is_workspace_v1_is_reference`)
3. 每完成步骤 commit
4. **不动其他 sub-phase 已完成的模块**(note / folder / storage 基础设施)
5. 完成后停下汇报,等审计批复合 main

### 0.4 设计原则补遗

**补遗 1 — 用户主权**:涉及"删除 / 转换 / 提升内容"等改变 atom 形态的操作,默认提供用户选择,不替用户简化语义。

**补遗 2 — UX 跟随客观状态**:UX 复杂度跟随内容的客观状态(如 `hasBeenReferenced`),而非把决策负担推给用户。草稿态无打扰,流通态有保护,状态升级单向不可逆。

### 0.5 设计师纪律累积(2026-05-12 反向更新加入,sub-phase 3a-1 实施后)

跨多个 sub-phase 累积的 P1 教训,写后续决议时必须遵守:

**纪律 1 — 不假设"已实施模块自动支持新需求"**

任何"x 走已实施的 y 自然支持"假设,**必须 grep 验证已实施代码字面行为**。截至 sub-phase 3a-1 完成,这条纪律已积累 5 次 P1 教训:
- 第 1 次(sub-phase 2): 没核 V2 capability 在哪个进程
- 第 2 次(decision 013): 没核 SurrealDB schema 约束
- 第 3 次(decision 014 撰写): 没核 folder 模块导出 + 进程边界
- 第 4 次(decision 014 实施期): 没核 sub-phase 2 deleteFolder cascade scope
- 第 5 次(decision 014 实施期): 没核 AtomEntity 字段集 + normalizer 是否带出新字段

**纪律 2 — 加 schema field 时必须三层同步**

涉及加 schema field 时,**必须同步核**:
- ① schema DEFINE FIELD(存层)
- ② entity 接口(类型层)
- ③ normalizer(读路径转换层)

任何"x 走 storage.getAtom 拿到"的字段,都要 verify ② + ③ 真带这字段。

**纪律 3 — checkpoint binary verify 模型**

决议字面"每 step 单 binary verify" 在 D-state 等 OS 故障环境下不可行。新决议预设 checkpoint 划分:
- 静态深度审计(typecheck / lint / grep / 接口签名核对 / 域注册闭环 / 进程边界)前置到每 step
- binary verify 合并到 checkpoint(每 sub-phase 通常 2-3 个 checkpoint)
- 任何 checkpoint binary verify 失败 → 立即停下回溯

**纪律 4 — 跨 sub-phase 模块的协作扩展**

"不动已完成模块" 的本意是 "不改对外契约 + atom CRUD 语义",**允许必要的向后兼容字段扩展**(跟 sub-phase 2 加 folder domain + sub-phase 3a-1 加 hasBeenReferenced 同范畴)。新决议措辞应预设这条路径,不强求"字面一行不动"。

---

## 1. 改造目标(What)

### 1.1 范围(整个 sub-phase 3a)

**包含**:
- 新增 graph 容器 atom domain(`'graph-canvas'`)
- 新增节点 wrapper atom domain(按节点类型分:`'graph-shape'` / `'graph-text-node'` / `'graph-sticky'` / ...)
- 新增边类型 `user:krig:inCanvas`(节点归属画板)
- 新增边类型 `user:krig:hasContent`(wrapper 引用 pm content)
- 新增 pmContentCapability(独立 pm atom CRUD,sub-phase 3a-2 引入)
- 删除现有 graph storage 层(`~/Library/Application Support/KRIG Note V2/krig-data/graph/` 磁盘 JSON)
- 渐进迁移现有 graph 节点类型到 SurrealDB(分多个 3a-N 子任务)

**不包含**:
- ❌ family-tree 等 variant 视图(view 层,本 sub-phase 不动)
- ❌ 自动布局算法(view 层)
- ❌ 协作 / 实时编辑(留 sub-phase N+)
- ❌ graph 间的 wikilink / 派生关系(留 sub-phase 4+)

### 1.2 V2 当前 graph 持久化现状

```
~/Library/Application Support/KRIG Note V2/krig-data/graph/
  ├── <graph-id-1>.json   ← 一个画板一个 JSON 文件
  ├── <graph-id-2>.json
  └── ...
```

每个 JSON 形态(简化):

```jsonc
{
  "id": "graph-...",
  "title": "...",
  "atoms": [
    { "kind": "shape", "id": "...", "x": 100, "y": 200, "geometry": {...}, ... },
    { "kind": "text-node", "id": "...", "x": ..., "doc": { ... PM doc ... }, ... },
    { "kind": "sticky", ... },
    ...
  ],
  "edges": [...]
}
```

→ graph 是**单 JSON 文件存所有节点**,没有跨 store 概念,跟 V2 atom + edge 语义层完全脱节。

### 1.3 目标态

```
SurrealDB:
  atom 表:
    graph-canvas (容器):  { id, payload: { title, ...画板元属性 } }
    graph-shape:          { id, payload: { x, y, width, height, fillColor, strokeColor, ... } }
    graph-text-node:      { id, payload: { x, y, width, height, align, bgColor, ... } }
    pm (内容):            { id, payload: { type:'doc', content:[...] } }  ← sub-phase 2 已有,3a-2 复用
    ...
  
  edge 表:
    user:krig:inCanvas    { subject: <node>, object: <canvas> }
    user:krig:hasContent  { subject: <wrapper>, object: <pm atom> }
    user:krig:inFolder    { subject: <canvas>, object: <folder> }  ← sub-phase 2 同款 folder 嵌套
```

→ **graph 跟 note 共享 folder 体系**(画板也可以放在 folder 内),**pm 内容跨 view 复用**(画板的 text 内容跟 note 内容是同一种东西)。

### 1.4 完成判据(整个 sub-phase 3a 完成的标志)

- 所有现有 graph 节点类型已迁移(对应每个 3a-N 子任务完成)
- 磁盘 JSON storage(`krig-data/graph/`)完全删除
- 画板 CRUD / 节点 CRUD / 内容跨 view 引用 全部走 SurrealDB
- `pmContentCapability` 完整落地
- `hasBeenReferenced` 删除契约通过所有 wrapper 类型
- decision 009 §3.1 sub-phase 3 标 ✅ 完成

→ **本决议只定原则**,具体每个 3a-N 完成判据见对应子决议。

---

## 2. 改造背景(Why)

### 2.1 为什么 graph 持久化要重做

按 [decision 009](009-migration-strategy.md):
- vision.md §2.4 知识图谱闭环目标 — graph 跟 note 必须共享 atom + edge 体系
- 当前 graph 单 JSON 文件存所有节点 — 没有图查询能力,无法实现"找出引用 X 的所有 graph"
- 跟 sub-phase 2 迁移路径一致 — 业务 store → SurrealDB

### 2.2 为什么渐进迁移(一次一个节点类型)

按用户拍板:

1. **graph 还在演化** — M2 polish 阶段,核心节点类型尚未全部稳定(SVG vs PM label 等仍在探索分支)
2. **每个节点类型形态独立** — shape / text-node / sticky / connector 各有自己的 atom domain + payload,**互不依赖**(除共享 inCanvas 边外)
3. **避免一次性 schema 写死** — atom domain 是**事实白名单**:虽然 SurrealDB schema 对 `payload.domain` 只有正则约束 `^[a-z][a-z0-9-]*$`(`src/storage/surreal/schema.ts:28-29`),不是 SQL 级白名单,但**代码层多处按 domain 字符串硬编码 dispatch**(capability 路由 / atom 类型推断 / 过滤查询)。新增节点类型仍需走 §3.0 域注册门槛,**不是字面 SQL migration,而是代码侧注册 + 测试验证**
4. **风险控制** — 每个节点类型独立 sub-phase,bug 影响面小
5. **跟 sub-phase 1/2 模板复用** — 每个 3a-N 都是 capability + IPC + view 三层迁移,模式成熟

### 2.3 为什么先做 shape(sub-phase 3a-1)

| 维度 | shape | text-node |
|---|---|---|
| atom 数 | 1 (wrapper only) | 2 (wrapper + content) |
| 边数 | 1 (inCanvas) | 2 (inCanvas + hasContent) |
| 跟 V2 既有 capability 关联 | 无 | 跟 text-editing-driver 强相关 |
| 形态稳定性 | 高 (V2 已迭代多版) | 中 (canvas-text-node 仍在打磨) |
| 适合作"模板" | ✅ 最简 | ❌ 太复杂 |

→ shape 是**最小可行的 graph 节点持久化模板**,确立"graph 容器 + wrapper atom + inCanvas 边" 三件套。3a-2 (text-node) 在此基础上引入"content atom + hasContent 边"双 atom 架构。

---

## 3. 实施目标态(What 具体)

### 3.0 ⚠ 前置门槛 — 新 atom domain 注册流程

**问题**: SurrealDB schema 对 `payload.domain` 仅有正则约束(`src/storage/surreal/schema.ts:28-29`),理论上任意符合 `^[a-z][a-z0-9-]*$` 的字符串都能写入。**但代码层多处按 domain 字符串硬编码**,直接首次写入会导致后续路径(capability dispatch / atom 类型推断 / 索引查询 / 过滤)出现 "不识别此 domain" 类型的 silent fallback,行为不可预期。

**约束**: 每个 3a-N 子任务**引入新 atom domain 前**,必须完成以下 4 步注册,缺一不可:

1. **`src/semantic/types/atom.ts`** — `AtomPayloadOf<D>` type map 加新 domain 分派(参 sub-phase 2 commit `9c5ae22` folder domain 添加示例)
2. **`AtomDomain` 联合类型扩展** — 加新 domain 字符串字面量(若已是 `string` 开放则无需,但开放体系下仍建议加 narrowing 类型保护)
3. **storage 层 dispatch 路径验证** — `storage.listAtoms({ domain })` / `storage.getAtom` 对新 domain 行为符合预期(实施者写一个最小 binary 验证:create / list / get / delete 各一次)
4. **capability 层显式注册** — `src/capabilities/<new>/types.ts` 定义 `<new>CapabilityApi`,`src/capabilities/<new>/index.ts` 通过 `capabilityRegistry.register` 注册(对齐 sub-phase 2 noteCapability 模板)

**实施者纪律**: 在新 atom domain 上做任何 storage 写入**之前**,必须先完成 1-4 步并 commit;commit message 显式列"已注册 domain: `xxx`"。

**违反这条门槛的后果**: capability dispatch 失败 / 过滤查询返回空 / view 层拉不到数据,且错误信息不明确(silent fallback)。sub-phase 2 实施时已遵守此模式(folder domain),但**之前总纲文本误导**(说"无需 schema migration"),本节修订。

**总结**: 不是 SQL DDL migration,而是**代码侧的 domain 注册闭环**。但严格度同样高,任何 3a-N 必须前置完成。

### 3.1 graph 容器形态

```ts
// graph-canvas domain
interface GraphCanvasPayload {
  title: string;            // 画板显示名(类似 folder title,真实业务字段)
  /** 视图元属性 — 画板本身的视觉默认值,不存节点 */
  background?: string;      // 背景色
  gridEnabled?: boolean;    // 是否显示网格
  /** 未来扩展:viewport 默认位置 / 缩放 / 工具默认值 等 */
}

// AtomEntity<'graph-canvas'> 例:
{
  id: ULID,
  createdAt / updatedAt / createdBy: 'user-default',
  payload: {
    domain: 'graph-canvas',
    payload: { title: '我的画板', background: '#fafafa', gridEnabled: true }
  }
}
```

**画板归属 folder**(可选):走 `user:krig:inFolder` 边,跟 note 同款。

**画板内节点**(全部):走 `user:krig:inCanvas` 边,subject=node,object=canvas。

### 3.1.bis 画板视觉模型对标(2026-05-12 反向更新加入)

总纲原文未明确对标 app(画板用什么视觉哲学)。sub-phase 3a-1 实施时拍板:

**对标 Freeform(Apple 无限白板)起步 + Figma 扩展占位,明确不引入 PowerPoint 母版/布局体系。**

| 维度 | 决议 | 理由 |
|---|---|---|
| 边界形态 | **无限平面**(Freeform / Miro 同款)| KRIG 是知识工具,边界是认知边界不是物理边界 |
| 节点结构 | **扁平 Instance + ref**(V2 现状)| 不引入 Frame / Group 嵌套(留 sub-phase 4+ 评估)|
| 母版 / 布局 | **不引入** | PowerPoint 演示场景不适用 KRIG |
| 主题系统 | **不引入**(schema 仅占位 `themeRef`)| 留 sub-phase 4+ 跟 substance 三层架构联合实施 |
| 协作元数据 | **不引入** | 单机单用户(decision 010),协作留 v2+ |

sub-phase 3a-1 实施 Freeform-style 极简 canvas 模型,GraphCanvasPayload 字段:
- 必填 4: `title` / `variant` / `view` / `schemaVersion`
- 可选 3(Freeform 视觉): `background` / `gridVisible` / `locked`
- Figma 扩展占位 2: `bounds` / `themeRef`(sub-phase 4+ 实施)

详 decision 014 §3.1。

### 3.2 节点 atom 分解原则

> ⚠ **2026-05-12 反向更新**(sub-phase 3a-1 实施现实覆盖):
>
> 本节原方案是"每节点类型一 domain"(`graph-shape` / `graph-text-node` / `graph-sticky`)。
> sub-phase 3a-1 实施时发现 V2 已经走 Instance + ref 模式(`canvas-rendering/types.ts:59-114`),
> 改为**单 atom domain `graph-instance` + payload.type + payload.ref 区分节点类型**。
>
> 实际落地形态(详 decision 014 §3.2):
> ```ts
> interface GraphInstancePayload {
>   type: 'shape' | 'substance';     // InstanceKind
>   ref: string;                     // Library id,如 'krig.basic.rectangle' / 'krig.text.label'
>   position?, size?, rotation?, params?, style_overrides?, props?, ...
>   // 复合节点(text-node)的内容走 user:krig:hasContent 边 + pm atom
> }
> ```
>
> 优点(实施发现):
> - 跟 V2 substance 三层架构哲学一致(实例容器,不按形状分裂 domain)
> - 加新 substance type 只是 Library 注册,storage schema 不变
> - 跟 pm domain 同模式(一个 domain 装多种 PM 节点形态)
>
> 下文保留原方案描述作历史记录,实施层以 decision 014 §3.2 为准。

#### 简单节点(无内容)— shape / sticky 几何部分

只有一个 wrapper atom:

```ts
interface GraphShapePayload {
  /** 几何 */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  /** 类型 */
  shapeType: 'rect' | 'ellipse' | 'triangle' | 'diamond' | 'hexagon' | ...;
  /** 样式 */
  fillColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  opacity?: number;
  /** Z-order */
  zIndex?: number;
}

// 边:user:krig:inCanvas (shape → canvas)
```

#### 复合节点(有内容)— text-node / sticky 含文字部分 / image

wrapper atom + 独立 content atom(pm / media / etc),用 `hasContent` 边连接:

```ts
// wrapper
interface GraphTextNodePayload {
  /** 几何 + 样式(同 shape)*/
  x, y, width, height, rotation?, zIndex?
  /** 文字相关样式 */
  bgColor?: string;
  borderColor?: string;
  align?: 'top' | 'middle' | 'bottom';   // F-10
  padding?: number;
}

// content (复用 sub-phase 2 已落地的 pm atom)
interface PmPayload {
  type: 'doc',
  content: [...]    // PM 子集
}

// 边 1:user:krig:inCanvas (text-node → canvas)
// 边 2:user:krig:hasContent (text-node → pm atom)
```

→ **wrapper 装画板视图属性,content 装语义内容,两者解耦**。

### 3.3 边类型规范

#### `user:krig:inCanvas`

| 字段 | 值 |
|---|---|
| predicate | `'user:krig:inCanvas'` |
| subject | 节点 wrapper atom(graph-shape / graph-text-node / ...)|
| object | graph-canvas atom |
| cardinality | 一对一(一个节点只在一个画板内)|
| attrs | `{ createdBy, createdAt }` |

#### `user:krig:hasContent`

| 字段 | 值 |
|---|---|
| predicate | `'user:krig:hasContent'` |
| subject | wrapper atom(含内容的节点)|
| object | content atom(pm / media / etc)|
| cardinality | wrapper → content 一对一;content → wrapper 多对一(同一段 content 可被多个 wrapper 引用)|
| attrs | `{ createdBy, createdAt }` |

→ **hasContent 是 KRIG "内容独立 + 跨 view 复用" 的核心边**。

### 3.4 pmContentCapability(新)

按 memory `project_two_atom_layers` "atom 是语义本身,各 view 是同一 atom 的不同呈现" 原则,**pm atom 不属于任何 view**,需要独立的 capability 管理:

```ts
// src/capabilities/pm-content/index.ts (sub-phase 3a-2 落地)

export interface PmContentCapabilityApi {
  /** 创建独立 pm atom(不属于任何 view 默认)*/
  createPmAtom(initialDoc?: PmPayload): Promise<PmAtomInfo>;

  /** 读单个 pm atom */
  getPmAtom(id: string): Promise<PmAtomInfo | null>;

  /** 更新 pm atom 内容 */
  updatePmAtom(id: string, doc: PmPayload): Promise<PmAtomInfo>;

  /** 删除 pm atom(危险操作,会断开所有引用) */
  deletePmAtom(id: string): Promise<{ affectedWrappers: string[] }>;

  /** 列出"游离 pm atom"— 当前没有被任何 wrapper 引用的 */
  listOrphaned(): Promise<PmAtomInfo[]>;

  /** 列出所有引用某 pm atom 的 wrapper(供"内容管理"入口用) */
  listReferences(pmAtomId: string): Promise<Array<{
    wrapperType: string;      // 'graph-text-node' / 'note-via-hasNoteView' / ...
    wrapperId: string;
    contextLabel: string;     // UI 显示用,例如 "我的画板 / text-node-123"
  }>>;

  /** 检查 pm atom 是否曾经流通过(hasBeenReferenced flag)*/
  getReferencedFlag(pmAtomId: string): Promise<boolean>;
}

export interface PmAtomInfo {
  id: string;
  title: string;                // 派生(同 noteCapability.deriveTitle)
  doc: NoteDocEnvelope<PmPayload>;
  hasBeenReferenced: boolean;   // 单向 flag
  createdAt: number;
  updatedAt: number;
}
```

**注意**: sub-phase 2 的 noteCapability 跟 pmContentCapability 是**两个 capability**,职责不同:
- **noteCapability**: 业务级,管理"note view + folder"层面(后续 hasNoteView 边模型升级时跟 pmContentCapability 协作)
- **pmContentCapability**: 数据级,直接管理 pm atom 本身(view-agnostic)

sub-phase 3a-2 同步引入 pmContentCapability + graphTextNodeCapability 协作模式,note 形态升级留 sub-phase 3a-2.5(详 §5)。

### 3.5 `hasBeenReferenced` 删除契约(核心规范)

#### 3.5.1 字段定义

> ✅ **2026-05-12 反向更新**(sub-phase 3a-1 实施时确认):
>
> **字段位置 = atom 元数据(entity 字段),不进 payload。**
>
> 落地形态(详 decision 014 §3.7 + decision 011 §5.7 反向更新):
> ```ts
> // src/semantic/types/atom-entity.ts
> export interface AtomEntity<D extends AtomDomain = AtomDomain> {
>   id: string;
>   createdAt: number;
>   updatedAt: number;
>   createdBy: string;
>   payload: Atom<D>;
>   hasBeenReferenced?: boolean;   // ← optional,sub-phase 1/2 旧数据用 ?? false 兜底
> }
> ```
>
> SurrealDB schema:`DEFINE FIELD hasBeenReferenced ON atom TYPE bool DEFAULT false`(sub-phase 3a-1 migration 1.1.0)
>
> 适用所有 atom(不仅 pm),但目前只有 pm 会被多 wrapper 引用 hasContent,其他 domain 此字段恒 false。

每个 pm atom(及其他可被引用的 content atom 类型)有单向 flag:

```ts
// 实际落地(2026-05-12 sub-phase 3a-1 确认):
// 位置 = atom 元数据(AtomEntity 字段),不进 payload(payload 是纯语义内容)。
interface AtomEntity {
  // ... id / timestamps / createdBy / payload ...
  hasBeenReferenced?: boolean;   // 单向 flag,永不复位
}
```

**初始值**: `false`(刚创建时,DB schema DEFAULT false 兜底)。

**触发条件**: 当**任意 capability 创建第 2+ 条 `hasContent` 边指向此 pm atom 时**(即开始流通),置为 `true`。**单引用模式(sub-phase 3a-1..3a-5)下永不触发**(每个 pm atom 只被 1 个 wrapper 引用)。

**永不复位**: 即便所有引用后来都断开,`hasBeenReferenced` 保持 `true`(单向门)。

#### 3.5.1.bis ⚠ 一致性约束 — 跟 Q-tx 退化的协同

**问题**: sub-phase 1 storage.transaction() 已退化为无真原子性(commit `7d828a6`)。本契约的关键路径是:

```
读 pm atom hasBeenReferenced → 查现有 hasContent 边数 → 决定是否 cascade 删 → 更新 flag
```

这是经典的 **read-modify-write**,并发场景下两个 capability 同时创建 hasContent 边指向同一 pm atom 时,**可能两个都读到 0 条已有边,各自决定不置 flag**,结果应该置 true 但实际还是 false → 后续删除走错分支(以为是草稿,把已流通的 cascade 删了)。

**约束 — sub-phase 3a-2 / 3a-2.5 阶段强制单引用模式**:

| 阶段 | 允许 | 禁止 |
|---|---|---|
| **sub-phase 3a-2 (text-node + pmContentCapability)** | 一个 wrapper 创建一个 pm atom(必然 hasBeenReferenced=false 且 1:1) | 引用已有 pm atom 到第 2 个 wrapper(浅引用 / 跨画板共享) |
| **sub-phase 3a-2.5 (note 升级)** | note 形态升级 + migration 加 hasBeenReferenced=false 给所有现有 pm atom | 同上 |
| **sub-phase 3a-N+ (浅引用 / 复用)** | 引入浅引用,但**前提是 Q-tx 已解** | 在 Q-tx 未解时引入浅引用 |

**理由**: 单引用模式下,**hasBeenReferenced flag 永远保持 false**(因为永远只有 1 个 wrapper 引用),read-modify-write 不会发生冲突。删除逻辑退化为"草稿态 cascade",跟 sub-phase 2 noteCapability.deleteNote 行为完全一致,**契约成立但不依赖原子性**。

**触发"引入浅引用"的前置门槛**:

1. ✅ Q-tx 已解(SDK 原生 transaction / 应用层补偿模式 / 单点串行更新器,三选一)
2. ✅ 一致性方案明确(乐观锁 / 悲观锁 / 串行队列,选定后写入 decision)
3. ✅ 浅引用 UI 入口设计(让用户感知"我在引用,不是复制")
4. ✅ 单元测试覆盖竞态场景

→ **未达上述门槛前,所有 graph-text-node / 升级后 note 都走"深拷贝创建新 pm atom"模式**,不引入浅引用。

**这条约束反向更新到 §6 子任务表 3a-2 / 3a-2.5 范围**,sub-phase 3a-N+(浅引用)是独立子任务,**必须在 Q-tx 解之后**。

**实际影响**:

- sub-phase 3a-2 完成时,UX 上每个 text-node 都有独立 pm atom(1:1),跟 sub-phase 2 noteCapability 行为对称
- 跨 view 复用(同一段内容在 note + graph 同时显示)在 3a-N+ 实现,**当前阶段不暴露给用户**
- 删除契约的代码逻辑仍按 §3.5.2 实施(检查 flag),但 flag 在 3a-2/2.5 阶段恒为 false,等价于"草稿态自动 cascade"

**好处**: 即便 Q-tx 永远不解(单机单用户场景可接受退化),sub-phase 3a-2/2.5 仍然完整可用,且未来引入浅引用时**契约本身不需要再改**(代码已经按 flag dispatch)。

#### 3.5.2 删除行为

当 wrapper(graph-text-node / 未来 note 升级形态)被删除时:

| pm atom 状态 | 行为 | UI 表现 |
|---|---|---|
| `hasBeenReferenced = false`(草稿态)| **直接 cascade 删 pm atom + hasContent 边** | 用户点删除按钮立即生效,无弹窗 |
| `hasBeenReferenced = true`(已流通)| **仅删 wrapper + hasContent 边**,pm atom 保留 | 用户点删除按钮立即生效,无弹窗;pm atom 进入"游离已流通"状态 |

→ **普通用户视图操作下,UI 没有"是否删除内容"的弹窗**(数据层语义自动适配 UX)。

#### 3.5.3 "彻底删除 pm atom" 高级路径

用户要彻底删除已流通的 pm atom 时,**不能通过画板的"删除节点"按钮触发**,必须通过专门入口:

- "内容管理"页面 / 入口(sub-phase 3a-N+ 实施)
- 显示当前所有引用(画板列表 / note 列表)
- 显式按钮"彻底删除内容(将影响 <N> 处引用)"
- 强警告 + 确认

→ **危险操作放在合适地方,不让普通操作不慎触及**。

#### 3.5.4 游离 pm atom 的合法性

`hasBeenReferenced = true` 且当前 0 引用的 pm atom 是合法状态,代表"曾经是知识资产,现在等待重新发现 / 重新引用"。它们:
- 出现在"游离内容列表"(pmContentCapability.listOrphaned)
- 可以被新 wrapper 重新引用
- 可以在"内容管理"入口彻底删除

→ **不是 bug,是 feature** — 给"被遗忘但有价值的内容"留找回的可能性。

### 3.6 inCanvas 边的级联策略

删除 graph-canvas atom 时,**画板内所有节点(及内容)如何处置?**

按 sub-phase 2 Path Y 删 folder 同款思路:

**Path Y for canvas**(对齐 macOS Finder + sub-phase 2 一致性):

```
删 canvas X 时:
  1. 查 inCanvas 边 subject 为画板内所有节点
  2. 对每个节点:走该节点类型的 capability.deleteNode (按 §3.5 hasBeenReferenced 自动适配 content)
  3. 删 canvas atom + 应用层 cascade 删 inCanvas/inFolder 边
  
  → 草稿节点连内容一起删,已流通节点的内容保留为游离
```

→ **canvas 级联删除复用单个 wrapper 删除的 hasBeenReferenced 契约**,语义一致。

⚠ 风险登记:误删 canvas = 丢节点 + 丢草稿内容。配套保护(删除前弹窗 + 回收站)留 sub-phase 3+(同 sub-phase 2 Q7)。

### 3.7 capability 边界与命名

> ⚠ **2026-05-12 反向更新**(sub-phase 3a-1 实施现实覆盖):
>
> 本节原方案是"新建 `graphCanvasCapability` / `graphShapeCapability` / `graphTextNodeCapability` / ..."。
> sub-phase 3a-1 实施时改为:
> - **改造**既有 `graph-library-store` capability(view 端期望 12 接口,接口不变最少改动 + 内部底层换 SurrealDB)
> - **新建** `pmContentCapability`(view-agnostic pm atom CRUD,跟 noteCapability 解耦)
>
> 实际命名映射(详 decision 014 §9.4):
> | 资源 | atom domain | capability 模块 | IPC channel | electron-api |
> |---|---|---|---|---|
> | 画板容器 | `graph-canvas` | `@capabilities/graph-library-store`(改造)| `graph.*`(保留)| `graph*` |
> | 画板节点 | `graph-instance`(单 domain)| 同上 | 同上 | 同上 |
> | 内容 (pm) | `pm`(sub-phase 2 已注册)| `@capabilities/pm-content`(新)| `pm-content.*` | `pmContent*` |
>
> 下文保留原方案描述作历史记录,实施层以 decision 014 §9.4 为准。

按 decision 008 §4.0 调用边界:

```
view 层 (src/views/graph/)
  通过 graphCanvasCapability / graphShapeCapability / graphTextNodeCapability / ... 调用
Capability 层
  src/capabilities/graph-canvas/
  src/capabilities/graph-shape/      (sub-phase 3a-1)
  src/capabilities/graph-text-node/  (sub-phase 3a-2)
  src/capabilities/graph-sticky/     (sub-phase 3a-3)
  src/capabilities/graph-connector/  (sub-phase 3a-4)
  ...
  src/capabilities/pm-content/       (sub-phase 3a-2)
Storage 层 (sub-phase 1 已落)
```

#### 命名规范

| 资源 | atom domain | capability 模块 | IPC channel 前缀 | electron-api flat name |
|---|---|---|---|---|
| 画板容器 | `graph-canvas` | `@capabilities/graph-canvas` | `graph-canvas.*` | `graphCanvas*` |
| 形状节点 | `graph-shape` | `@capabilities/graph-shape` | `graph-shape.*` | `graphShape*` |
| 文字节点 | `graph-text-node` | `@capabilities/graph-text-node` | `graph-text-node.*` | `graphTextNode*` |
| 便签节点 | `graph-sticky` | `@capabilities/graph-sticky` | `graph-sticky.*` | `graphSticky*` |
| 连接线 | `graph-connector` | `@capabilities/graph-connector` | `graph-connector.*` | `graphConnector*` |
| 内容 (pm) | `pm` (已有) | `@capabilities/pm-content` (新) | `pm-content.*` | `pmContent*` |

→ **命名一致性约束**: 同一种节点类型在 atom domain / capability 模块 / IPC 三处用一致字符串(连字符 vs 驼峰按各层惯例)。

---

## 4. 删除契约总规范

### 4.1 wrapper 删除场景(普通用户路径)

```
用户操作:画板右键删除某节点 / 按 Delete 键

  ↓
graph<NodeType>Capability.delete<NodeType>(nodeId)
  ├── 查 hasContent 边 → 拿到 content atom id (如有)
  ├── 查 content atom hasBeenReferenced flag
  ├── 删 wrapper atom + inCanvas/hasContent 边
  └── 按 flag 决策:
      ├── false → cascade 删 content atom
      └── true  → 保留 content atom (游离)

  ↓
返回 { deletedContent: boolean }
```

UI 端:**不弹窗**,删除按钮直接生效。

### 4.2 content 彻底删除场景(高级路径,sub-phase 3a-N+)

```
用户操作:进入"内容管理"页面 → 选某 pm atom → 点"彻底删除"

  ↓
UI 弹强警告:"将删除内容 + 影响 <N> 处引用 (列出引用列表)"

  ↓
用户确认

  ↓
pmContentCapability.deletePmAtom(pmAtomId)
  ├── 查所有指向此 atom 的 hasContent 边
  ├── 按 capability 类型逐个调对应 deleteWrapper(强制 + 仅删壳模式,避免循环)
  ├── 删 pm atom + 应用层 cascade 删剩余 hasContent 边
  └── 返回 { affectedWrappers: string[] }
```

UI 弹强警告 + 列出引用 + 显式确认。

### 4.3 canvas 级联删除场景(Path Y for canvas)

按 §3.6 — 复用单个 wrapper 删除契约,内容按 hasBeenReferenced flag 自动适配。

### 4.4 capability 接口约束

每个 graph<NodeType>Capability 必须实现:

```ts
interface GraphNodeCapabilityApi {
  // ... CRUD ...
  
  /** 普通用户视图删除路径(走 hasBeenReferenced 契约)*/
  deleteNode(nodeId: string): Promise<{
    deletedWrapper: boolean;
    deletedContent: boolean;    // true = content 也 cascade 删了(草稿态)
    contentAtomId: string | null; // 保留的 content atom id(已流通态)
  }>;
  
  /** "内容管理"入口的高级删除路径(强制断引用,仅 sub-phase 3a-N+ 暴露给特定 UI)*/
  forceDetachWrapper(nodeId: string): Promise<void>;
}
```

→ **普通 view 层只用 `deleteNode`,不接触 `forceDetachWrapper`**。`forceDetachWrapper` 仅被 pmContentCapability.deletePmAtom 内部使用。

---

## 5. note 形态升级路径(sub-phase 3a-2.5) — ✅ 已实施(2026-05-13 反向更新)

> **状态**: ✅ 实施完成 → 详 [decision 016](016-sub-phase-3a-2.5-note-form-upgrade.md)(本总纲 §5 是路径起点,decision 016 是落地详细规范)。
> **commits**: `21ac1d2` / `56a8304` / `535ca2e` / `0ae0930` / `f145384` + 反向更新链。
> **binary verify**: 8 场景全过(decision 016 §12.4),核心业务价值 graph text-node 完全隔离实证通过。
> **实施路线选择**: 路线 B(Literal Marker)— 但 `relations/spec.md krig vocab` 实施时按 [decision 016 §3.2](016-sub-phase-3a-2.5-note-form-upgrade.md) 拍板的字面 `object = { kind: 'literal', value: <boolean> }` 落地。

### 5.1 当前形态(sub-phase 2 已落)

```
note = pm atom (1:1) + inFolder 边

noteCapability.createNote → 直接创建 pm atom
noteCapability.deleteNote → 直接删 pm atom + inFolder 边
```

→ **note 跟 pm atom 1:1 绑定**,简化版语义 A。

### 5.2 目标形态(sub-phase 3a-2.5 升级)

```
note = pm atom (语义) + krig:hasNoteView 边(表征标记) + inFolder 边(归属)

pm atom 不再"是" note,而是"被 note view 引用"。
一段 pm atom 可同时被 note view + graph text-node + ... 多处引用。
```

### 5.3 升级步骤(sub-phase 3a-2.5)

⚠ **关键修订**:`krig:hasNoteView` 边的 object **不能是 null**。按 `relations/spec.md §2` + `src/storage/surreal/schema.ts:49` `object.kind INSIDE ['atom', 'literal']`,edge object 必须是 AtomRef 或 LiteralValue,不允许 null。

**两种实施路线二选一**(sub-phase 3a-2.5 决议 016 撰写时拍板,本总纲倾向路线 B):

#### 路线 A — Marker Atom

引入一个**单例的 view-marker atom**(domain 例如 `'system-marker'`,payload `{ name: 'note-view' }`),所有 `krig:hasNoteView` 边都指向这个固定 atom。

- 优点:边模型纯净(全是 atom→atom),复用 storage schema 全部能力
- 缺点:引入特殊 atom,需要保证全系统只有一个(竞态保护 / 单例语义)
- 缺点:全部 hasNoteView 边都对一个 atom,边索引可能成性能热点

#### 路线 B — Literal Marker(本总纲倾向)

`krig:hasNoteView` 边的 object 是 `{ kind: 'literal', value: true }`(LiteralValue 布尔):

- 优点:无需特殊 atom,符合"标记型边"的本意(就是个 flag)
- 优点:vocabulary `krig` 内固化此边的语义 = "subject 是 pm atom 且参与 note view"
- 缺点:同一 vocabulary 内 literal vs atom object 混用,需要 vocab schema 文档明确登记

→ **总纲倾向路线 B**,理由:更符合"hasNoteView 是个布尔标记,不是关系"的本意。决议 016 撰写时确认 + 在 `relations/spec.md krig vocab` 中正式登记此边的 object 形态。

**实施步骤**:

1. 引入 `krig:hasNoteView` 边类型(按路线 B,object 形态在 `relations/spec.md krig vocab` 章节登记)
2. migration:给所有 sub-phase 2 创建的 pm atom 加一条 `hasNoteView` 边
   - subject = pm atom,object = `{ kind: 'literal', value: true }`
   - 等价于"标记这个 pm atom 在 note view 中可见"
3. noteCapability.listNotes 改成"查所有带 hasNoteView 边的 pm atom + 派生 title"
4. noteCapability.deleteNote 改成:
   - 走 hasBeenReferenced 契约(草稿 cascade,已流通仅断 hasNoteView 边)
5. 给所有 sub-phase 2 已存 pm atom 加 `hasBeenReferenced: false`(默认草稿态)
6. 反向更新 decision 012 + relations/spec.md krig vocab 登记 hasNoteView

### 5.4 升级时机

**sub-phase 3a-2.5** = sub-phase 3a-2(text-node + pmContentCapability)完成后立即进行。

理由:
- 3a-2 引入 pmContentCapability 后,note 形态升级是自然延伸
- 跨 view 复用 UX(pm atom 同时在 note 和 graph)需要 note 也走 hasNoteView 边模型
- 不升级会导致 note vs graph text-node 两套删除契约不一致

### 5.5 升级风险

- migration 影响所有现有 note(虽然只是加一条边)
- 实施时 noteCapability 旧接口 (createNote / listNotes / deleteNote) 行为变化,但**对调用方透明**(view 层接口不变)
- 必须有 binary 验证(对应 pm atom 已经存在的情况下加 hasNoteView 边幂等)

→ sub-phase 3a-2.5 单独 decision 016(届时撰写),本决议只登记路径。

---

## 6. 子任务列表 + 优先级

### 6.1 子任务全表

| 子任务 | 内容 | 依赖 | 风险 | 优先级 / 状态 |
|---|---|---|---|---|
| **3a-1** | graph 容器(Instance + ref 模式)+ shape 节点 + **text-node 节点(2026-05-12 合并入 3a-1 实施)** + pmContentCapability + hasContent 边 + hasBeenReferenced 契约(单引用模式,见 §3.5.1.bis)| sub-phase 2 | 中(双 atom 架构首次落地)| ✅ **已完成**(merge `67f18b2`)|
| **3a-2.5** | note 形态升级(hasNoteView 边 — 路线 B literal marker,见 §5.3)| 3a-1 | 中(migration)| **必要,接 3a-1** |
| **3a-2** | sticky 节点专属能力(若 V2 sticky 跟 Instance 形态差异显著,届时再拆;原 3a-2 内容已并入 3a-1)| 3a-1 | 中 | 按 V2 需求 |
| **3a-3** | connector(连接线 — 端点引用其他节点 wrapper)| 3a-1 | 中(新边类型 `krig:connects`)| 按 V2 需求 |
| **3a-4** | image / media node(wrapper + media content atom,单引用模式)| 3a-1 模板 | 中 | 按 V2 需求 |
| **3a-5+** | 其他节点类型(按 V2 后续 graph 节点演化)| 各异 | 各异 | 按需 |
| **3a-tx** | **Q-tx 解决** — SDK 原生 transaction / 应用层补偿 / 单点串行更新器(三选一,独立 decision)| 任意 3a-x | 中-高(影响所有 capability 写路径)| **浅引用前置必做** |
| **3a-shared-ref** | 浅引用 / 跨 view 复用(同一 pm atom 多 wrapper 引用) | **3a-tx 必须先完成** | 中(竞态保护)| 按 vision 闭环需求触发 |
| **3a-N** | 后续节点类型(按 graph variant 演化 + Freeform 对标) | 各异 | 各异 | 按需 |

**子任务依赖图**:

```
sub-phase 2 ─┬─ 3a-1 ─┬─ 3a-2 ─┬─ 3a-2.5
              │        │        ├─ 3a-3
              │        │        └─ 3a-5
              │        └─ 3a-4
              │
              └─────── 3a-tx ── 3a-shared-ref(浅引用)
                       (独立分支,与 3a-1..3a-5 解耦)
```

→ **关键纪律**: 3a-1 到 3a-5 都遵守"单引用模式",不依赖事务原子性;浅引用 / 跨 view 复用是**独立子任务集合**,前置 Q-tx 解决。

### 6.2 每个 3a-N 子任务模板

每个 3a-N 都遵守同模板(便于复用经验 + 减少决策成本):

1. **设计阶段**(main 对话写决议 0XX)
   - §1 范围 / §2 背景 / §3 目标态 / §5 实施步骤 / §6 测试清单 / §8 Open Q / §9 决议链
   - 复述 decision 013 总纲约束(命名 / 删除契约 / pmContentCapability 协作)
   
2. **实施阶段**(独立 session)
   - 在分支 `feature/L7-sub3a-<N>-<node-type>-migration` 上做
   - 严格 cd 到 V2
   - 每步 commit
   - 实施 5+ 步:atom domain / capability main / preload bridge + alias / IPC handlers / view 层迁移 / 删旧存储路径(如有)/ typecheck + lint / UI 集成测试 / capability README
   
3. **审计阶段**(main 对话)
   - 静态校验 (typecheck / lint / grep)
   - 实施细节核 (atom domain / capability API / IPC / view 改造完整性)
   - UI 集成测试清单 (创建 / 编辑 / 删除 / 跨重启持久化 / 跨 view 广播)
   - 反向更新对应决议
   
4. **合并阶段**(用户授权后)
   - merge --no-ff
   - push origin main(用户授权)
   - 反向更新 decision 009 §3.1 sub-phase 3 进度

### 6.3 3a-1 → 3a-2 → 3a-2.5 三步合并节奏

按用户拍板的"渐进迁移"原则,**不要一次性合大批 3a-N**。每个子任务单独 sub-phase + 单独审计 + 单独合并 + UI 实测。

```
3a-1 (shape)
  → 合 main → 用户测 → 通过
3a-2 (text-node + pmContentCapability)
  → 合 main → 用户测 → 通过
3a-2.5 (note 形态升级 + hasBeenReferenced migration)
  → 合 main → 用户测 → 通过
3a-3 / 3a-4 / 3a-5 / ...
  → 按 V2 当前 graph 节点演化优先级排序
```

→ **不要因为"节点类型类似"就并行做多个 3a-N**。集成测试反馈是关键防火墙,串行才能验。

---

## 7. 跟 V2 既有模块的边界

### 7.1 不动的部分

- ✅ sub-phase 1 storage 基础设施 (`src/storage/`)
- ✅ sub-phase 2 note + folder capability (`src/capabilities/note/` / `@capabilities/folder/`)
- ✅ workspace / 命令注册 / NavSide / 等基础设施
- ✅ family-tree 等 variant 视图(view 层,本 sub-phase 不动)
- ✅ canvas-text-node 内嵌 PM 编辑器(driver instance 复合 id 不变)
- ✅ shape library / substance registry(consume side)

### 7.2 受影响的部分

- 🔄 `src/views/graph/` — 渐进改造,每个 3a-N 子任务改一部分
- 🔄 `src/views/graph/<existing-storage-adapter>` — 删除(替换为 capability 调用)
- 🔄 `~/Library/Application Support/KRIG Note V2/krig-data/graph/` — 删除磁盘 JSON storage
- 🔄 `src/platform/main/graph/` — 现有 main 端 graph handlers / data layer 替换为 capability impl

### 7.3 跟 family-tree 等 variant 的解耦

family-tree(memory `project_basic_graph_view_only` + `project_graph_architecture`)是**视图层 variant**,消费 `src/capabilities/shape-library` + graph storage 产生的 atom + edge。

本决议范围只动 graph 数据持久化层,**family-tree 等 variant 视图代码不动**。variant 视图通过 graphCapability 拿数据,**对存储后端透明**。

→ 唯一改动:family-tree 视图如果之前直接读磁盘 JSON / graphStore,改成读 capability,但**渲染逻辑不变**。

---

## 8. Open Questions

| 编号 | 问题 | 临时默认 / 应对 |
|---|---|---|
| Q1 | `hasBeenReferenced` 字段放 atom 元数据 / payload / 独立边 attrs?| sub-phase 3a-2 实施时定(推荐元数据,跟 createdBy 同位置)|
| Q2 | 多个 wrapper 同时引用同一 pm atom 时,谁能"编辑"内容?| 任意 wrapper 编辑都更新 pm atom 本身;其他 wrapper 通过广播自动同步(sub-phase 2 同款 onListChanged 模式)|
| Q3 | wrapper "复制"操作语义(用户在画板复制 text-node)| 默认深拷贝(创建新 wrapper + 新 pm atom);"浅引用"留高级操作,UI 暂不暴露 |
| Q4 | graph storage migration:V2 现有磁盘 JSON 数据如何处置?| 按 sub-phase 2 选项 M 同款:启动时检测 + 清空(V2 是测试数据,user 已知接受)|
| Q5 | canvas 跨 workspace 怎么处理?| 当前 V2 canvas 跟 graphStore 一对应,本 sub-phase 保持单 workspace 概念,跨 workspace 留 sub-phase 4+ |
| Q6 | `hasBeenReferenced` 触发时机的边界:wrapper 复制是否算引用?| ✅ 已拍板:**深拷贝**(创建新 pm atom + 新 hasContent 边)**不触发** flag;**浅引用**(新 hasContent 边指向旧 pm atom)**触发** flag。但**浅引用仅在 3a-shared-ref 子任务实现**(前置 Q-tx 解),3a-1 到 3a-5 阶段只走深拷贝,flag 恒为 false |
| Q7 | 误删 canvas 保护(确认弹窗 / 回收站)| 同 sub-phase 2 Q7,留 sub-phase 3+ |
| Q-tx | **storage.transaction() 真原子性 — 升级为 sub-phase 3a 关键阻断项** | sub-phase 1 Q-tx 继承 — 当前 X3a 退化(`7d828a6`)。**本决议 §3.5.1.bis 明确:浅引用 / 跨 view 复用必须前置 Q-tx 解,否则 hasBeenReferenced 契约在并发下失态**。3a-1 / 3a-2 / 3a-2.5 / 3a-3-5 走单引用模式不依赖此项;3a-shared-ref 必须等 Q-tx 解 |
| Q-tx-solution | Q-tx 的具体解法选项 | 三个候选,留 3a-tx 决议时拍板:(a) surrealdb-js 原生 transaction API(待 SDK 文档调研);(b) 应用层补偿(记录已做操作 + 失败时反向);(c) 单点串行更新器(单 worker / mutex 序列化所有跨语句操作)|
| Q-orphan | 游离 pm atom 清理策略 | "内容管理"入口手动清理(sub-phase 3a-N+);自动 GC 留 sub-phase N+ |

---

## 9. 决议链

### 9.1 与已 commit 规范文档的关系

- [`decision 008 §4.0`](008-storage-layer-interface.md) — view 不直连 storage
- [`decision 009 §3.1`](009-migration-strategy.md) — sub-phase 3 范围(本决议将 sub-phase 3 拆为 3a / 3b)
- [`decision 010`](010-multi-user-multi-device.md) — createdBy 默认 user-default
- [`decision 011`](011-sub-phase-1-surrealdb-infrastructure.md) — Q-tx 继承
- [`decision 012`](012-sub-phase-2-note-folder-migration.md) — capability + IPC 模板 + Path Y 删除契约
- [`atom/spec.md`](../../atom/spec.md) — graph-* 作为新 domain(开放命名 + 强制代码侧注册闭环,见 §3.0)
- [`relations/spec.md`](../../relations/spec.md) — `user:krig:inCanvas` / `user:krig:hasContent` 边定义

### 9.2 跟 vision.md 的对齐

按 [`vision.md §2.4`](../../../../00-architecture/vision.md):

> 知识图谱(机器)↔KR图(人)双向闭环

→ pm atom 跨 view 复用 + hasContent 边可查 + hasBeenReferenced 状态机 = 闭环数据基础。

### 9.3 设计纪律备忘

按 sub-phase 1/2 经验,本决议涉及的新 SurrealQL / 边类型 / 字段**未在 binary 验证**。每个 3a-N 实施者执行时如遇 SurrealDB 行为偏差,**立即停下汇报**。

### 9.4 外部参考(借鉴,不对标)

| 工具 | 借鉴的部分 | 不照搬的部分 |
|---|---|---|
| **Apple Freeform** | 节点类型集 (sticky / text / shape / image / connector) + 直觉性 UX | 闭源、无知识图谱概念 |
| **tldraw** | document JSON schema + reactive store 思路 | 不深绑 React + 不照搬 nested document tree |
| **Excalidraw** | 轻量 JSON 节点形态 + group / arrow / text 简洁性 | 不照搬手绘风 |
| **React Flow** | node-based 编辑器交互模式 | 不照搬 stateless component 路线 |
| **PowerPoint OOXML** | shape library schema(已有 memory 锚点)| 不照搬 XML 复杂度 |
| **VOWL** | 知识图谱可视化(future variant 参考)| 不照搬范式严格性 |

→ **没有单一对标**,组合借鉴。

---

## 10. 反向更新清单(每个 3a-N 完成后做)

| 3a-N 完成时反向更新 | 目标文档 |
|---|---|
| 3a-1 (shape) 完成 | decision 014(本子任务决议)标 ✅,decision 013 §6.1 子任务表勾 3a-1,decision 009 §3.1 标 sub-phase 3a-1 ✅ |
| 3a-2 (text-node) 完成 | decision 015 标 ✅,decision 013 §6.1 勾 3a-2,decision 009 标 sub-phase 3a-2 ✅,**新增 atom domain 列表加 `graph-text-node` / `graph-shape`** |
| 3a-2.5 (note 升级) 完成 | decision 016 标 ✅,**反向更新 decision 012 标注 noteCapability 形态升级** |
| 3a-3+ ... | 各自决议标 ✅ |
| 整个 sub-phase 3a 完成 | decision 013 顶部状态 → ✅,decision 009 §3.1 sub-phase 3 标 ✅(graph 部分),atom domain 列表补齐 |

---

## 11. 风险与回滚

### 11.1 风险

| 风险 | 概率 | 影响 |
|---|---|---|
| graph 业务主线(SVG label / canvas-text-node 等)仍在演化导致改造跟主线冲突 | 中 | 每个 3a-N 启动前确认主线状态,必要时延期 |
| 双 atom 架构(wrapper + content)首次落地复杂度 | 中 | 3a-2 重点测试,UI 集成测试 + 跨重启验证 |
| `hasBeenReferenced` flag 时机出错 | 低 | 单向 flag 设计简化,边界由 Q6 明确 |
| migration 影响 V2 现有 graph 数据 | 低 | 按 §8 Q4,清空 + 重建(V2 测试数据)|
| 跟 sub-phase 2 note 接口耦合 | 低 | sub-phase 3a-2.5 单独 decision 016 处理升级 |

### 11.2 回滚

每个 3a-N 独立分支 → 回滚 = 不合该分支。main 不受影响。

整个 sub-phase 3a 回滚(假设要重做):

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
git revert <3a-1 merge>..<3a-N merge>  # 倒序 revert
```

但实际上每个 3a-N 已经通过审计 + UI 实测,回滚概率极低。

---

## 12. 附录 A — sub-phase 3a-1 起步条件

**启动 sub-phase 3a-1 (decision 014 撰写 + 实施) 的前置条件**:

1. ✅ 本决议 013 已 commit(规范基线)
2. ⏳ graph 主线骨架稳定确认(用户拍板)
3. ⏳ V2 现状梳理(`src/views/graph/` + 现有磁盘 JSON 形态)
4. ⏳ decision 014 (3a-1 子决议) 撰写完成,用户拍板
5. ⏳ 起 feature/L7-sub3a-1-canvas-shape-migration 分支

---

## 13. 附录 B — 跟 sub-phase 2 的模板差异

| 维度 | sub-phase 2 (note + folder) | sub-phase 3a (graph 节点们) |
|---|---|---|
| 范围广度 | 2 个模块一次性迁完 | 1 个节点类型一个 sub-phase |
| atom 数 | 1 (note=pm + folder=folder) | 1 (shape) 或 2 (text-node + pm) |
| 边类型 | inFolder | inCanvas + hasContent + (inFolder for canvas) |
| 跨 atom 引用 | 无 | hasContent 跨 view 复用 |
| 内容生命周期 | note 删 = pm atom 删(简化版语义 A)| hasBeenReferenced 三档自动适配 |
| capability 数 | 2 (note + folder) | N+1 (graph-canvas + 各节点类型 + pm-content) |
| migration 复杂度 | 简单(localStorage → SurrealDB) | 中(磁盘 JSON → SurrealDB + 双 atom 解耦)|

---

*Decision 013 总纲版本结束。预估整个 sub-phase 3a 工程量 4-8 周(分多个 3a-N 渐进推进)。*
