# Decision 025 — Atom 颗粒度当前形态承接 + Block 独立化远期愿景 V2 落地登记

> **类型**:架构断裂修复(纯文档,无代码改动)
> **决议日期**:2026-05-21
> **触发依据**:[调查报告 `atom-granularity-investigation-2026-05-21.md`](../../notes/atom-granularity-investigation-2026-05-21.md)
> **用户决策**:同时承接 v1.3 工程妥协 + 显式登记 block 独立化 sub-phase(decision 026)
> **前置事实**:[three-layer.md §2.4 / §6.4 / §8](../../../00-architecture/three-layer.md) 字面已登记 v1.2 工程妥协 + 远期愿景,**但 V2 决议体系字面未承接**

---

## 0. 本决议为何存在

本决议**不引入新设计 / 不动代码**,纯文档级修复。

### 0.1 问题陈述(字面事实)

调查报告 §4.1 字面发现:

- [`three-layer.md §2.4`](../../../00-architecture/three-layer.md) 字面承认"当前形态(v1.2 阶段,工程妥协):Atom 内联在各视图自己的表里,没有独立的语义实体"
- [`three-layer.md §6.4`](../../../00-architecture/three-layer.md) 字面登记"Block 独立化(spec v1.0 / v1.1 提过的方向) — 不阻塞 v1.3,但是语义层落地的最终形态"
- [`three-layer.md §8`](../../../00-architecture/three-layer.md) 字面留痕"v1.3 阶段不实施投影模型 / 版本图 — 工程妥协,保留 atom 内联现状 — 2026-04-25"

**但**:V2 持久化决议体系(011-024 共 14 个决议)字面**未引用**上述工程妥协登记,也**未把 block 独立化登记为待启动 sub-phase**。

- [`decision 012 §3.2`](../../persistence/decisions/012-sub-phase-2-note-folder-migration.md) 字面拍板 "pm atom = note"(整篇 PM doc 作为单 atom payload),**未列举 "block 拆 atom" 作为替代方案被拒绝**
- [`decision 016`](../../persistence/decisions/016-sub-phase-3a-2.5-note-form-upgrade.md) `hasNoteView` 边语义层修法,**不动 atom 颗粒度**
- [`decision 022 §3.2`](../../persistence/decisions/022-sub-phase-022-ebook-thought-migration.md) 字面承认 "block 是 atom-level 子结构,不能被边直接引用(**decision 030+ 大架构升级才能解**)",但 decision 030 **实际不存在**(persistence/decisions/ 字面最高编号为 024)

→ V1→V2 跨界时,"block 独立化是远期愿景"这件事**未在 V2 决议体系里重新登记**。

### 0.2 本决议要做的事

1. **字面承接** [three-layer.md §2.4](../../../00-architecture/three-layer.md) "v1.2 工程妥协" + §6.4 "Block 独立化远期愿景" + §8 "决策留痕"
2. **字面声明**:V2 当前 atom 颗粒度(note=整篇 / graph=细颗粒)是**显式选择**,不是疏忽
3. **字面登记** decision 026 作为 Block 独立化 sub-phase 设计文档的正式编号(注销 decision 022 §3.2 占位提及的 "decision 030+")
4. **字面登记** [Canvas-As-Note-Migration.md](../../../10-business-design/graph/Canvas-As-Note-Migration.md) 作为该 sub-phase 的设计起点

### 0.3 不在本决议范围

- ❌ 不动 atom schema 字面定义([`atom/spec.md`](../spec.md) 不改)
- ❌ 不动既有 decisions 012 / 016 / 022 字面(下游 decision 026 实施时再同步)
- ❌ 不写代码 / 不动 src/
- ❌ 不拍板 block 独立化的实施路径(留 decision 026)

---

## 1. 当前 V2 Atom 颗粒度形态字面登记

### 1.1 现状字面陈述

V2 当前 atom 颗粒度形态(2026-05-21):

| Domain | 颗粒度 | 实施位置 | 字面拍板 |
|---|---|---|---|
| `pm`(note 用) | **整篇 PM doc = 1 atom** | [`src/platform/main/note/capability-impl.ts:54-66`](../../../../src/platform/main/note/capability-impl.ts#L54) | [decision 012 §3.2](../../persistence/decisions/012-sub-phase-2-note-folder-migration.md) |
| `pm`(graph text-node 用) | 整段 PM doc = 1 atom(单段引用,非整篇)| [`src/platform/main/pm-content/`](../../../../src/platform/main/pm-content/) | [decision 013 §3.4](../../persistence/decisions/013-sub-phase-3a-graph-canvas-migration.md) |
| `pm`(thought 用) | 整篇 thought PM doc = 1 atom | [decision 022 §1.3.1](../../persistence/decisions/022-sub-phase-022-ebook-thought-migration.md) | 同上 |
| `graph-canvas` | 画板容器 = 1 atom | [`src/platform/main/graph/canvas-store.ts`](../../../../src/platform/main/graph/canvas-store.ts) | [decision 014](../../persistence/decisions/014-sub-phase-3a-1-graph-canvas-instance-migration.md) |
| `graph-instance` | **画板内每节点 = 1 atom**(细颗粒)| 同上 | 同上 |
| `folder` | 每文件夹 = 1 atom | [`src/platform/main/folder/`](../../../../src/platform/main/folder/) | [decision 012 §3.1](../../persistence/decisions/012-sub-phase-2-note-folder-migration.md) |

**关键观察**(字面证据):
- **graph 域已是 block-level atom** — 每个画板节点 1 atom,带稳定 ULID,通过边表达归属
- **note / thought 域仍是 doc-level atom** — 整篇 PM doc 1 atom,block 是 PM 内部嵌套,无独立 id
- 这是 **同一项目内并存的两种颗粒度策略**

### 1.2 字面登记:这是 V2 的工程妥协,不是疏忽

V2 决议体系**字面承接** [three-layer.md §2.4](../../../00-architecture/three-layer.md) 拍板:

> v1.3 阶段**不实施**投影模型与版本图——保持 v1.2 现状(atom 内联)。
> 长期目标作为本规范的"远期愿景"登记,未来由专项工作推进。

**对应到 V2 实施层**(本决议字面承接):

- V2 sub-phase 1-3 阶段(decision 011-024)**保留 pm domain 整篇 atom 颗粒度**作为工程妥协
- 该工程妥协是**显式选择**,理由见 §1.3
- **block 独立化是 V2 语义层落地的最终形态**(对齐 three-layer.md §6.4)
- 该工作由 [`decision 026`](../../persistence/decisions/026-block-atomization-sub-phase-design.md) 承接,启动条件 / 时机由 decision 026 拍板

### 1.3 当前颗粒度形态的字面合理性(不评价对错)

按调查报告 §5.3 字面整理,当前 pm 整篇 atom 颗粒度的工程优势:

- **写入简单**:整篇 PM doc 一次 `putAtom` 完成,无 diff 增量同步复杂度
- **SurrealDB 一行 storage 操作**,无需 listEdges + 拼装
- **跟 [decision 016 §1.3](../../persistence/decisions/016-sub-phase-3a-2.5-note-form-upgrade.md) "3-query listNotes" 模式契合**
- **PM 文档结构在 atom payload 内保持完整**(PM schema 不需要"虚拟根",整篇 doc 自然是 root)

按调查报告 §5.1 字面整理,当前颗粒度的代价(由 decision 026 解决):

- 跨 note 引用某段:`krig://block/<noteId>/<idx>:<前30字>` anchor 用 PM 顺序索引 + 文本前缀,**用户编辑后必漂**
- thought 标注某 note 段:NoteLocator 用 `pmPos + 冗余 text`,编辑后漂移
- ebook 标注塞 PM `block.attrs.bookAnchor`(decision 022 字面权宜模式),block 无稳定 id
- 边只能指向 atom 整体(整篇 note),**无法指向某 block**

---

## 2. 字面承接 three-layer.md §2.4 / §6.4 / §8

### 2.1 §2.4 工程妥协承接

[three-layer.md §2.4](../../../00-architecture/three-layer.md) 字面:

> **当前形态(v1.2 阶段,工程妥协)**:Atom 内联在各视图自己的表里,**没有独立的语义实体**。
>
> **v1.3 阶段的处置**:
> - **不实施**投影模型与版本图——保持 v1.2 现状(atom 内联)
> - v1.3 现状是工程妥协
> - 长期目标作为本规范的"远期愿景"登记,未来由专项工作推进

**V2 决议体系字面承接**(本决议):

- V2 当前 atom 内联形态(整篇 PM doc 1 atom)= three-layer.md §2.4 字面"v1.2 工程妥协"的 V2 直系延续
- V2 sub-phase 1-3 阶段(decision 011-024)**显式继承** v1.3 工程妥协,**不需要在每个 sub-phase 单独说明**(本决议作为承接条款)
- 未来由 [`decision 026`](../../persistence/decisions/026-block-atomization-sub-phase-design.md) 设计的专项 sub-phase 推进 block 独立化,**对齐**投影模型路线

### 2.2 §6.4 远期愿景承接

[three-layer.md §6.4](../../../00-architecture/three-layer.md) 字面:

> **Block 独立化(spec v1.0 / v1.1 提过的方向)**
> - SurrealDB 增加 `block:[id]` 表
> - 各视图通过 blockId 引用语义层,而不是 inline 存 Atom[]
> - 实现真正的"跨视图 Block 复用"和"修改一处自动同步多视图"
> - 不阻塞 v1.3,但是**语义层落地的最终形态**

**V2 决议体系字面承接**(本决议):

- 本决议**字面登记** [`decision 026`](../../persistence/decisions/026-block-atomization-sub-phase-design.md) 作为 V2 实施 block 独立化的正式入口
- decision 026 拍板:`block-level atom **仍走现有 atom 表**`(详 decision 026 §5,与 three-layer §6.4 字面 "SurrealDB 增加 block:[id] 表" **略有不同** — V2 选择"block = atom" 同表模型,跟 graph-instance 同模式)
- 跨视图 Block 复用 / 修改自动同步 = decision 026 之上的下游能力(留更未来 sub-phase)

**字面差异说明**:
- three-layer §6.4 字面"SurrealDB 增加 `block:[id]` 表" 是 V1 时代 spec v1.0 / v1.1 的方向
- V2 实施时由用户拍板(决议 026 用户决策点)选择**不增表**,block-level atom 仍在 `atom` 表(跟 graph-instance / folder 同模式),理由:架构一致性 + 未引入新存储抽象
- 这不违反 §6.4 的语义意图("各视图通过 blockId 引用语义层"),只是落地表现选择 "block = atom" 而非 "block 单独成表"

### 2.3 §8 决策留痕承接

[three-layer.md §8](../../../00-architecture/three-layer.md) 决策表字面:

| 决策 | 结论 | 日期 |
|---|---|---|
| Block 独立化 | 长期方向(v1.0 / v1.1 提过),不阻塞 v1.3 | 2026-04-25 |
| 投影模型(每个视图持有自己的 atom 投影) | 远期愿景,不阻塞 v1.3 | 2026-04-25 |
| v1.3 阶段不实施投影模型 / 版本图 | 工程妥协,保留 atom 内联现状 | 2026-04-25 |

**V2 决议体系字面承接 + 补充**(本决议新增):

| 决策 | 结论 | 日期 |
|---|---|---|
| V2 sub-phase 1-3 阶段继承 v1.3 工程妥协(pm domain 整篇 atom)| 显式选择,本决议承接 | 2026-05-21 |
| Block 独立化由 decision 026 承接为正式 sub-phase 设计文档 | 登记 | 2026-05-21 |
| 投影模型(语义层 vs PM 渲染层彻底分离)留更远未来 | 不在 decision 026 范围内(用户拍板)| 2026-05-21 |
| `block = atom`(block-level atom 仍走 `atom` 表) | V2 落地选择,与 three-layer §6.4 字面"增 block 表"略有差异 | 2026-05-21 |

---

## 3. 注销 decision 030+ 占位

### 3.1 字面问题

[decision 022 §3.2](../../persistence/decisions/022-sub-phase-022-ebook-thought-migration.md) 路径 2 拍板理由字面提及:

> "block 是 atom-level 子结构,不能被边直接引用(**decision 030+ 大架构升级才能解**)"

**但** `docs/RefactorV2/data-model/persistence/decisions/` 字面最高编号为 024,decision 030 **实际不存在**。这是 decision 022 字面留下的占位引用,无实体文档对接。

### 3.2 本决议字面注销

**注销 "decision 030+" 占位**:

- decision 022 §3.2 字面提及的 "decision 030+ 大架构升级才能解" 的工作,**正式承接到** [`decision 026`](../../persistence/decisions/026-block-atomization-sub-phase-design.md)
- decision 022 §3.2 字面**不需修改**(保留历史记录),由本决议 §3 / §4 字面承接其义务
- 未来开发者读 decision 022 §3.2 看到 "decision 030+" 字样,通过本决议(025)指向 decision 026

### 3.3 字面替代关系

| 旧字面 | 新字面 | 字面承接位置 |
|---|---|---|
| decision 022 §3.2 "decision 030+ 大架构升级" | decision 026 "Block 独立化 sub-phase" | 本决议 §3.2 / §4 |
| three-layer.md §2.4 "未来由专项工作推进" | decision 026 实施任务设计 | 本决议 §2.1 |
| three-layer.md §6.4 "Block 独立化" 远期愿景 | decision 026 §1 改造目标 | 本决议 §2.2 |
| Canvas-As-Note-Migration.md "M3 独立工作" | decision 026 §2 设计起点引用 | 本决议 §4 |

---

## 4. Canvas-As-Note-Migration.md 作为设计起点字面登记

### 4.1 字面登记

[Canvas-As-Note-Migration.md](../../../10-business-design/graph/Canvas-As-Note-Migration.md)(2026-05-01 写,V1 时代)字面是 **block 级 atom + atom.meta.canvas 视图特性**的完整设计草案。

**本决议字面登记**:

- Canvas-As-Note-Migration.md §0.3 / §1.3 / §1.4 字面提出的 atom 模型 — `{ id, type, content, parentId?, meta }` — **是 decision 026 的设计起点**
- decision 026 引用本文件 §4 字面承接 Canvas-As-Note-Migration.md 作为参考实现 / 设计输入
- Canvas-As-Note-Migration.md 文件**保持不动**(它是 V1 时代的草案,V2 实施细节由 decision 026 重新拍板)

### 4.2 Canvas-As-Note-Migration.md 的关键设计输入(字面引用)

| 设计点 | Canvas-As-Note-Migration.md 字面 | decision 026 对应位置 |
|---|---|---|
| **每 block 独立 atom + 稳定 id** | §0.3 / §1.3:`{ id: 'atom-001', type: 'canvasShape', ... }` | decision 026 §3 颗粒度 + §4 ID 字段 |
| **嵌套通过 parentId 边表达** | §1.4:`{ id, parentId: 'atom-002', order, ... }` | decision 026 §5 嵌套 + §6 边集 |
| **视图特性挂 atom.meta.<viewKey>** | §1.1:`AtomMeta.canvas?: CanvasAtomMeta` | decision 026 不直接采用,因本 sub-phase 范围"只解 atom 颗粒度"(用户拍板),不解决"多视图 meta 投影"的字面登记 |
| **view-specific 表(画板视口 / user_substances)** | §1.5:`canvas_meta` 表 | decision 026 不涉及(留更远未来) |

---

## 5. 影响面登记(本决议落地后哪些既有决议被影响)

### 5.1 本决议**不直接修改**任何既有决议字面

本决议是**承接条款**,既有 decision 012 / 016 / 022 字面**保持不变**。下游 decision 026 实施落地时再同步修改这些决议字面(本决议 §6 列出待修改清单作为前瞻提示)。

### 5.2 既有决议字面引用的 "整篇 atom" 形态清单

下列决议字面采用 "pm atom = 整篇" 形态,**decision 026 实施时**需要同步更新:

| 决议 | 字面位置 | 同步更新性质 |
|---|---|---|
| [decision 012 §3.2](../../persistence/decisions/012-sub-phase-2-note-folder-migration.md) | "路径 Y: pm atom = note" | 加历史注释 / 字面拍板承接条款 |
| [decision 016 §1.3](../../persistence/decisions/016-sub-phase-3a-2.5-note-form-upgrade.md) | `note = pm atom + hasNoteView 边` | hasNoteView 边语义升级:挂在哪个 atom 上重新拍板(note 根 atom vs 每 block atom) |
| [decision 022 §1.3.1](../../persistence/decisions/022-sub-phase-022-ebook-thought-migration.md) | thought 整篇 PM doc 1 atom + bookAnchor 塞 block.attrs | thought 字面也要 block 拆 atom;bookAnchor 字段是否迁出 attrs 重新决策 |
| [`atom/spec.md §2.2`](../spec.md) | "pm atom = 最小单元(如 `{type:'text', text:'hello'}`)" | 字面与 V2 实施一致(inline 级是字面最小);本决议不动 |
| [`atom/spec.md §2.5`](../spec.md) | V2 当前实现对齐说明 | decision 026 落地后字面同步 |

### 5.3 既有代码影响清单(decision 026 实施时使用)

调查报告 §5.1 字面影响面:

| feature | 字面位置 | 影响性质 |
|---|---|---|
| 跨 note 引用某段 | [`src/drivers/text-editing-driver/api.ts:823`](../../../../src/drivers/text-editing-driver/api.ts#L823) `getBlockAnchorAt` | anchor 算法升级 |
| Thought 标注某 note 段 | [`src/shared/ipc/thought-types.ts:57`](../../../../src/shared/ipc/thought-types.ts#L57) `NoteLocator { pmPos, anchorType, text }` | Locator 升级为 `blockId` 模式(对齐 GraphLocator) |
| ebook bookAnchor 塞 block.attrs | 24 种 PM block attrs(decision 022 §1.3.1)| bookAnchor 是否迁出 block.attrs 由 decision 026 拍板 |
| `krig://block/<noteId>/<idx>:<前30字>` URL | [`src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts:73`](../../../../src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts#L73) | URL 协议演化,旧 URL 直接废弃(用户拍板) |
| 已有 6 个媒体 block 的 `atomId: { default: null }` 占位[^audit-grep] | [`image/spec.ts`](../../../../src/drivers/text-editing-driver/blocks/image/spec.ts) 等 6 个 block | L5-B+ 占位,decision 026 实施时升级为正式 id 字段 |

[^audit-grep]: 此事实由审计阶段补 grep 发现(2026-05-21 审计报告 §2.2),不在原调查报告 `atom-granularity-investigation-2026-05-21.md` 字面登记。对 decision 026 §4.4 字段复用方案有直接价值,故字面保留。grep 验证:`grep -l "atomId" src/drivers/text-editing-driver/blocks/*/spec.ts` → image / audioBlock / videoBlock / htmlBlock / tweetBlock / mathVisual。

---

## 6. 反向更新清单(本决议落地后必须同步的位置)

### 6.1 立即同步(本决议合 main 时)

| 文件 | 同步内容 | 性质 |
|---|---|---|
| 本文件 | 写入 | 新建 |
| [`docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md`](../../persistence/decisions/026-block-atomization-sub-phase-design.md) | 写入(本决议触发的核心决议) | 新建 |
| [`docs/RefactorV2/stages/block-atomization-implementation-plan.md`](../../stages/block-atomization-implementation-plan.md) | 写入(实施任务设计) | 新建 |

### 6.2 decision 026 实施时同步(留 future sub-phase)

| 文件 | 同步内容 | 性质 |
|---|---|---|
| [`docs/RefactorV2/data-model/persistence/decisions/022-sub-phase-022-ebook-thought-migration.md`](../../persistence/decisions/022-sub-phase-022-ebook-thought-migration.md) §3.2 | 修订 "decision 030+ 大架构升级才能解" 引用 → 指向 decision 026 | 字面修订 |
| [`docs/RefactorV2/data-model/atom/spec.md`](../spec.md) §2.5 | 字面同步:V2 当前实现对齐说明随 decision 026 实施变化 | 字面修订 |
| [`docs/00-architecture/three-layer.md`](../../../00-architecture/three-layer.md) §2.4 / §6.4 / §8 | 字面追加:V2 已通过 decision 025 / 026 承接 v1.2 工程妥协 + 实施 block 独立化 | 字面追加 |

---

## 7. 决策留痕

| 决策 | 结论 | 日期 |
|---|---|---|
| V2 决议体系字面承接 [three-layer.md §2.4 / §6.4 / §8](../../../00-architecture/three-layer.md) v1.2 工程妥协 + 远期愿景登记 | 采纳 | 2026-05-21 |
| 当前 V2 atom 颗粒度(note=整篇 / graph=细颗粒)是显式选择,不是疏忽 | 字面声明 | 2026-05-21 |
| Block 独立化是 V2 语义层落地的最终形态;由 decision 026 承接 | 字面登记 | 2026-05-21 |
| 注销 decision 022 §3.2 占位 "decision 030+ 大架构升级",改指 decision 026 | 字面承接 | 2026-05-21 |
| Canvas-As-Note-Migration.md 作为 decision 026 设计起点 | 字面登记 | 2026-05-21 |
| 投影模型(语义层 vs PM 渲染层彻底分离)留更远未来,**不在 decision 026 范围** | 用户拍板(本对话 AskUserQuestion)| 2026-05-21 |
| `block = atom`(block-level atom 仍走 `atom` 表,跟 graph-instance 同模式),与 three-layer §6.4 字面"增 `block:[id]` 表"略有差异 | 用户拍板(本对话 AskUserQuestion)| 2026-05-21 |

---

## 8. 后续工作

本决议(decision 025)**单独无价值**,价值在于触发下游 [`decision 026`](../../persistence/decisions/026-block-atomization-sub-phase-design.md)(核心决议)+ [`block-atomization-implementation-plan.md`](../../stages/block-atomization-implementation-plan.md)(实施任务)。

读者按顺序读:

1. **本决议(025)** — 知道工程妥协承接 + 远期愿景登记
2. **decision 026** — 知道 block 独立化的具体设计
3. **实施任务文档** — 知道如何分阶段实施

---

*Decision 025 · v1.0 · 2026-05-21*
