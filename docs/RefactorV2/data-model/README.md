# V2 数据建模规范

本目录是 KRIG-Note V2 **数据建模的权威记录**：定义"语义层有哪些数据、字段长什么样、它们之间的关系怎么表达"。

代码（`src/shared/types/`、`src/semantic/` 等）实现此规范；本目录文档是规范本身。**文档先动，代码再跟。**

---

## 与架构文档的关系

本目录是 **`docs/00-architecture/three-layer.md`** 和 **`docs/00-architecture/vision.md`** 在"语义层最小单元"维度上的具体展开。

- **vision.md** 定义 KRIG 的存在理由："基于知识图谱的知识表达媒介"，知识图谱（机器） ↔ KR 图（人）双向闭环。
- **three-layer.md** 定义三层模型：语义层 / 转换层 / 可视化层；§2.2 把语义层最小单元锁为 PM node JSON 形态。
- **charter.md** 定义 V2 重构总纲：纵向 4 层（视图 / 能力 / 语义 / 存储），§4 给出 atom / block / blockView 的精确定位。
- **本目录** = 把上述架构定义落到具体字段、具体边界、具体决策。

> ⚠️ three-layer.md §2.2 当前把 atom 定义为 "ProseMirror node JSON 形态"。本目录在该定义基础上**进一步泛化** —— 引入 **Atom Domain** 分类，使 atom 不限于内容形态，可承载向量、知识图谱三元组、几何等多种语义单元。PM node JSON 是 **pm domain** 的具体形态，符合 three-layer.md 当前定义。
>
> 等 Atom Domain 体系稳定运行 N 个 Phase 后，反向更新 three-layer.md §2.2。

---

## 当前 V2 状态（开工时 2026-05-11）

V2 现有的零散 atom 概念：

| 位置 | 概念 | 状态 |
|---|---|---|
| `src/capabilities/text-editing/types.ts:65-72` | `AtomInput` —— PDF 提取契约的宽松输入类型 | 已实现，但**未对齐统一 Atom 定义** |
| `src/capabilities/text-editing/types.ts:75-81` | `PMDocNode` —— PM doc 节点形态 | 已实现 |
| `src/capabilities/text-editing/converters/atoms-to-pm.ts` | atom → PM 转换器 | 已实现 |
| `docs/10-business-design/ebook/PDF-Note-Atom数据契约-v2.md` | PDF 提取的 atom 数据契约 | 已存在但散落 |
| 9 个 store（note / folder / graph / ebook / 等） | 各自 schema，互不相通 | 雏形完成，**无统一语义层** |

本目录要做的事 = **把上述零散概念统一到 Atom 这个语义层最小单元下**。

---

## Atom + 边的设计哲学

V2 语义层有两类一等公民：**Atom** 和 **边**。两者并列，都是知识资产。

### Atom 是最小实体

Atom 承载**数据本体**（几何身份 / 数据载体），按 **domain** 分类，每个 domain 用该领域最成熟的数据模型：

| Domain | 数据模型 | 承载 | Phase 1 落地 |
|---|---|---|---|
| **pm** | ProseMirror node JSON | 用户可编辑内容（文本 / 数学 / 代码 / 列表 ...） | ✓ NoteView |
| **rdf** | SPO 三元组（subject-predicate-object） | 客观关系图谱，机器推理 | 占位 |
| **embedding** | number[] + dim + model | 语义相似度向量 | 占位 |
| **three** | 点 / 线 / 面 / 体（仅 node/edge/face 三类落地） | 视觉空间布局（NoteView 之外的所有视图共享） | 占位 |

→ V2 第一波 4 个 domain 足够覆盖所有已知视图。Domain 是**开放注册体系**（不是封闭枚举），未来按需扩展（如 markdown-ast / json-schema / musicxml 等）。

### 边是一等公民，所有属性走边

**Atom 本体只保留数据模型自身必需的字段**。一切非本体属性（语义解释 / 视图绑定 / 来源 / 链接 / 派生关系 / 嵌入引用 / ...）**全部走边表达**。

例如 family-tree 中的一个 person：

```
atom (three domain):
  { kind: 'node', position: {x, y} }     ← 本体：几何身份

edges (按命名空间叠加，构建时叠加，不替换):
  this-atom ── user:family-tree:isA ────────→ 'person' literal
  this-atom ── user:family-tree:hasGender ──→ 'female' literal
  this-atom ── user:family-tree:hasBirthDate → '1980-01-01' literal
  this-atom ── user:family-tree:isParentOf ─→ child-atom
  this-atom ── user:prov:wasDerivedFrom ────→ source-ebook-atom
  ...
```

**带来的好处**：
1. **同一 atom 可被多种语义体系标注**（既是 family-tree 的 person，又是 org-chart 的 employee）。
2. **新语义解释 = 注册新命名空间 + 叠加边**，不破坏已有 atom。
3. **推理 / 检索通过子图索引切片**（按命名空间），跟 RDF / SPARQL / Cypher 等成熟图查询工具天然对齐。
4. **不需要"高频属性 / 低频属性"的滑坡判断** —— 一律走边，没有迁移债务。

### 边命名：三段式 `<source>:<vocabulary>:<edge-name>`

```
user:family-tree:isParentOf       ← 用户在 family-tree 语境下创建的"父子"边
ai:bpmn:flowsTo                   ← AI 在 BPMN 语境下推断的"流向"边
sys:embedding:similarTo           ← 系统计算的"相似"边（向量近邻）
user:prov:wasDerivedFrom          ← 用户主动 commit 的派生关系（git-style）
ai:prov:wasInformedBy             ← AI 提取笔记时自动追溯来源
user:linksTo                      ← 约定俗成的 wiki-style 链接（可省略 vocabulary 段）
```

| 段 | 取值 | 含义 |
|---|---|---|
| **source** | `user` / `ai` / `sys` | 谁创建的（粗分类，对应 vision.md §8 "AI 写入必须可被用户确认 / 撤销"） |
| **vocabulary** | `family-tree` / `bpmn` / `mind-map` / `prov` / `owl` / `skos` / `krig` / ... | 语义命名空间（标准对齐 + 领域解释） |
| **edge-name** | `isParentOf` / `flowsTo` / `wasDerivedFrom` / ... | 具体边名 |

每条边的 `attrs` 必带：

```ts
{
  createdBy: string,         // agentId（如 user-wenwu / ai-gpt4 / sys-auto-embed）
  createdAt: number,
  confidence?: number,       // ai / sys 创建时必填
  confirmedAt?: number,      // 用户确认时间戳（若有）
  confirmedBy?: string,      // 用户 agentId
}
```

### 边的两种能力

按 vision.md §2.4 闭环原则，边为以下能力提供基础：

1. **关系检索**：视图 → 内容（"画板上点击节点 → 查 `linksTo` 边 → 跳到 note"）、内容 → 内容（"查所有 `user:family-tree:%` 命名空间下的边 → 重建族谱视图"）。
2. **推理**：RDF / OWL 类边支撑客观推理（"`isParentOf` 传递闭包 → `hasAncestor`"），通过 `capability.graph-query` 切片相应子图按命名空间执行。

---

## 四条建模原则

### 1. Atom 按 domain 分类，domain 是开放注册体系

封闭 4 个初始 domain（pm / rdf / embedding / three）覆盖已知视图，未来按需扩展。Domain 表示**数据本体**，不是**领域解释**。

### 2. 边是一等公民，按 `<source>:<vocabulary>:<edge-name>` 三段式命名

边跟 atom 同级，也是开放注册体系。

### 3. 用户边 / 机器边必须可区分（source 段强制）

vision.md §8: 「AI 写入图谱的任何东西必须经人确认 / 可撤销」。`source` 段在边名上就分清楚，零查询代价。

### 4. spec 与 decisions 分离

- **spec**（`atom/spec.md`、`relations/*.md` 等）= 当前生效的字段定义（事实）。
- **decisions**（`atom/decisions/*.md`、`relations/decisions/*.md`）= 为什么这么定（理由 + 替代方案 + 拒绝的方案）。

每条决策一个文件，可回溯。

---

## Phase 推进策略

**优先 NoteView 必须的部分先做完**，其他 domain 等对应视图启动时再展开。

### Phase 1（2026-05-11 完成）—— pm Domain + 总体框架（5 个核心文件）

产出：
- `README.md`（本文件）—— 总体框架 + Atom Domain 总览 + Atom/边设计哲学。
- `atom/spec.md` —— Atom 通用接口 + Domain 注册治理 + pm domain 完整定义；其他 domain 仅登记位置。
- `atom/decisions/002-v1-fields-migration.md` —— V1 atom-types.ts 每个字段 V2 归属判定。
- `atom/decisions/003-naming-conventions.md` —— domain 命名 + 边三段式命名 + 走法 B（属性走边）的总决议。
- `relations/spec.md` —— Edge 通用接口 + 三段式语法 + attrs 规约 + cardinality + vocabulary 治理。

完成后审阅 → 通过 → 才进入下一 Phase。

### Phase 2a（2026-05-11 完成）—— 字段命名 RFC（扩展文档）

产出：
- `naming-conventions.md` —— 字段命名三阶梯（Markdown / PM/HTML / KRIG 自定义）+ V1→V2 字段对照清单 + 字段冗余判定准则。**RFC 状态**（在 Phase 2c 验证后转正式规范）。

### Phase 2b（2026-05-11 完成）—— 关键决议 + Mixin 列表（扩展文档）

产出：
- `atom/decisions/004-phase2b-resolutions.md` —— 4 项决议合集：
  - N6 Mark 命名保留 V1 `bold` / `italic`
  - N4 mathBlock 视觉属性保留 + `bgColor` 改名 `backgroundColor`
  - N7 V1 image.caption 迁移（核验发现 V2 已实现优于 RFC）
  - Mixin 列表（保留 TextFlowAttrs + MediaResourceAttrs，砍 3 个候选）

### Phase 2c-pre（2026-05-11 完成）—— Mixin 文档 + V2 改造任务设计

产出：
- `mixins/spec.md` + `mixins/text-flow.md` + `mixins/media-resource.md` —— 决议 004 §4 拍板的 2 个 Mixin 完整文档（518 行）。
- `atom/decisions/005-block-schema-decomposition.md` —— V2 代码改造任务设计文档（959 行），由独立 session 在 `feature/L6-block-decomposition` 分支执行。

### Phase 2bb（2026-05-11 完成）—— ✅ V2 代码改造（外部分支）

执行：`feature/L6-block-decomposition` 分支（独立 session）按 decision 005 实施 + 本分支审计验收。

成果：
- V2 节点 `text-block` 单节点拆为 PM 标准 `paragraph` + `heading` 双节点
- `heading.attrs.level` 扩到 1-6（CommonMark 标准）
- `noteTitle` 保留为 `paragraph.attrs.isTitle: true`（不是 heading）
- merge to main commit `c9ae4e4`（36 files / +406 / -295）
- 12 个实施 commits + 设计文档修订记录

L6-data-modeling 分支已 merge main 拉到最新，反向更新对齐文档完成。

### Phase 2c（2026-05-11 完成）—— ✅ pm Domain 业务展开

合并到 main commit `a07f84d`（L6-data-modeling 分支）。

产出（33 份子文档）：
- `relations/pm-note.md` —— 主索引
- `relations/pm-note/blocks/` —— 20 份 block 子文档（paragraph / heading / blockquote / 列表系列 / 表格系列 / 媒体 6 份 / 等）
- `relations/pm-note/inlines/` —— 4 份 inline 子文档（mathInline / noteLink / hardBreak / fileLink）
- `relations/pm-note/marks/` —— 4 份 mark 文档（basic-marks 五合一 + textStyle / highlight / link）

完整覆盖 V2 ENABLED_BLOCKS 28 节点 + 8 marks。

### Phase 3（2026-05-11 完成）—— ✅ Persistence 规范

执行：`feature/L7-persistence-spec` 分支（独立分支按 L6 模式）。

产出（9 个文件 / ~3200 行）：
- `persistence/README.md` —— Phase 3 总览 + 设计原则
- `persistence/spec.md` —— 持久化总规范（实体壳 + 后端中立 + 字段优先级）
- `persistence/atom-entity.md` —— AtomEntity 实体壳
- `persistence/edge-entity.md` —— EdgeEntity 实体壳
- `persistence/decisions/006-id-generation.md` —— ULID 推荐
- `persistence/decisions/007-storage-target.md` —— SurrealDB 推荐（Embedded + Sidecar fallback）
- `persistence/decisions/008-storage-layer-interface.md` —— StorageAPI 接口
- `persistence/decisions/009-migration-strategy.md` —— 渐进 4 sub-phase 迁移
- `persistence/decisions/010-multi-user-multi-device.md` —— 路径 B 正式登记
- `persistence/surreal-schema.md` —— SurrealDB schema 设计

**状态**：✅ **已转正**（2026-05-12，merge commit `9580246` / 6 commits）。

### Phase N sub-phase 1（2026-05-12 完成）—— ✅ SurrealDB 基础设施代码实施

执行：`feature/L7-sub1-surreal-infrastructure` 分支（独立 session 按 [decision 011](persistence/decisions/011-sub-phase-1-surrealdb-infrastructure.md) 实施 + 本对话审计验收）。

产出（13 commits）：

- ✅ V2 productName 隔离（"KRIG Note" → "KRIG Note V2"，userData 路径与 V1 完全独立）
- ✅ `src/semantic/types/` —— Atom / Edge / AtomEntity / EdgeEntity TS 类型完整定义
- ✅ `src/storage/api.ts` —— StorageAPI 接口（含 4 层调用边界）
- ✅ `src/storage/ulid.ts` —— ULID 生成（uppercase / monotonic）
- ✅ `src/storage/surreal/` —— Sidecar 模式 client + schema + storage 实现
- ✅ `src/storage/migrations/runner.ts` —— schema migration runner
- ✅ Main 进程启动接入 storage init/shutdown
- ✅ EM1/2/3/4 硬门槛验证通过（3 次连续冷启动 / 时延 578-1102ms / 写入读取一致性）

实施期间 4 处事实纠错（设计文档与 SurrealDB binary 3.0.4 实际行为不一致），已反向更新 decision 007 / 011 / 009 / 010 + surreal-schema.md。

**未实施部分**（留 sub-phase 2-4）：
- ❌ 业务 store 迁移（noteStore / folderStore / 等保留现状）
- ❌ EVENT 触发器 cascade delete（留 sub-phase 2 EM6 验证后）
- ❌ Embedded 引擎切换（留未来 sub-phase，等 surrealdb@3.x client SDK 转 stable）

### Phase N sub-phase 2+（待启动）—— 业务 store 渐进迁移

按 [decision 009 §3.1](persistence/decisions/009-migration-strategy.md)：

- sub-phase 2: noteStore + folderStore 迁移
- sub-phase 3: graphStore + ebookStore + annotationStore
- sub-phase 4: 剩余 store（mediaStore 大文件 / inspectorStore UI 状态等可能不迁）

### Phase 4+（其他视图启动时按需展开）

每启动一个新视图（family-tree / bpmn / mind-map / 等）：
- 在 `atom/spec.md` 里把对应 domain 从"仅登记"补成"完整定义"。
- 写该 domain 的关系文档（如 family-tree view 启动时写 `relations/three-family-tree.md`，注册 `user:family-tree:%` 命名空间下的边集）。
- 该视图的 view spec 引用 atom spec。

**节奏纪律**：未启动的 domain 只占位、不细化，避免"为未来过度设计"。

---

## 目录结构

```
data-model/
├── README.md                              本文件
├── naming-conventions.md                  ✓2a 字段命名 RFC + 三阶梯 + V1→V2 字段对照清单
├── atom/
│   ├── spec.md                            ✓1  Atom 通用接口 + Domain 注册治理 + pm domain 完整定义
│   └── decisions/
│       ├── 002-v1-fields-migration.md     ✓1  V1 字段 V2 归属判定
│       ├── 003-naming-conventions.md      ✓1  domain / 边命名 + 走法 B 总决议
│       ├── 004-phase2b-resolutions.md     ✓2b N6/N4/N7 决议 + Mixin 列表
│       ├── 005-block-schema-decomposition.md ✓2bb V2 改造任务（text-block → paragraph + heading）
│       └── ...                            后续决策按编号追加
├── relations/
│   ├── spec.md                            ✓1  Edge 通用接口 + 三段式语法 + attrs 规约 + cardinality
│   ├── pm-note.md                         ✓2c pm atom 主索引(33 份子文档)
│   ├── pm-note/blocks/                    ✓2c 20 份 block 子文档
│   ├── pm-note/inlines/                   ✓2c 4 份 inline 子文档
│   ├── pm-note/marks/                     ✓2c 4 份 mark 子文档
│   ├── pm-folder.md                       （Phase 4+）note 与 folder 树形组织
│   ├── pm-derived.md                      （Phase 4+）note 派生链
│   └── ...
├── mixins/
│   ├── spec.md                            ✓2c-pre Mixin 总览 + 设计原则
│   ├── text-flow.md                       ✓2c-pre TextFlowAttrs
│   └── media-resource.md                  ✓2c-pre MediaResourceAttrs
└── persistence/                           ✓3  Phase 3 完整产出(10 文件,已转正)
    ├── README.md                          ✓3a 总览
    ├── spec.md                            ✓3a 持久化总规范
    ├── atom-entity.md                     ✓3a AtomEntity 实体壳
    ├── edge-entity.md                     ✓3c EdgeEntity 实体壳
    ├── decisions/
    │   ├── 006-id-generation.md           ✓3b ULID 推荐(已实施)
    │   ├── 007-storage-target.md          ✓3b SurrealDB 推荐(Sidecar 模式已实施)
    │   ├── 008-storage-layer-interface.md ✓3c StorageAPI 接口(已实施)
    │   ├── 009-migration-strategy.md      ✓3c 渐进迁移策略(sub-phase 1 已完成)
    │   ├── 010-multi-user-multi-device.md ✓3c 路径 B 正式登记
    │   └── 011-sub-phase-1-surrealdb-infrastructure.md ✓Phase N sub1 sub-phase 1 实施任务(已完成)
    └── surreal-schema.md                  ✓3d SurrealDB schema 设计(已实施)
```

文件状态标识：
- **✓1** = Phase 1 核心规范文件（5 个）
- **✓2a** = Phase 2a 扩展文档（字段命名 RFC）
- **✓2b** = Phase 2b 补充决议（N6/N4/N7 + Mixin）
- **✓2c-pre** = Phase 2c-pre Mixin 文档 + V2 改造设计
- **✓2bb** = Phase 2bb V2 代码改造已完成（在 main 分支 commit `c9ae4e4`）
- **✓2c** = Phase 2c pm domain 业务展开（在 main 分支 commit `a07f84d`，33 份子文档）
- **✓3a/3b/3c/3d** = Phase 3 persistence 规范（已合 main commit `9580246`，2026-05-12 转正）
- **✓Phase N sub1** = Phase N sub-phase 1 SurrealDB 基础设施代码实施（已合 main，2026-05-12 完成）

**Phase 1 是核心规范**，**Phase 2a/2b/2c-pre 是基于 Phase 1 的扩展决议**，**Phase 2bb 是数据建模驱动的 V2 代码改造**，**Phase 2c 是 pm domain 业务展开**，**Phase 3 是持久化规范**，**Phase N 是规范落地的代码实施 sub-phases**。各阶段各有定位，互不替代。

---

## 分支策略

按 [feedback_branch_module_boundary](../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_branch_module_boundary.md) 纪律 —— 每个独立模块开独立分支，audit 通过后合并 main。

**已完成分支（已合 main）**：
- `feature/L6-data-modeling` —— Phase 1 / 2a / 2b / 2c-pre / 2c，merge commit `a07f84d`
- `feature/L6-block-decomposition` —— Phase 2bb V2 代码改造，merge commit `c9ae4e4`
- `feature/L7-persistence-spec` —— Phase 3 persistence 规范（已转正），merge commit `9580246`
- `feature/L7-sub1-surreal-infrastructure` —— Phase N sub-phase 1 SurrealDB 基础设施代码实施，merge commit `34e3758`

**待启动分支（按 [decision 009 sub-phase 顺序](persistence/decisions/009-migration-strategy.md)）**：
- `feature/L7-sub2-note-folder-migration` —— sub-phase 2 noteStore + folderStore 迁移
- `feature/L7-sub3-graph-ebook-migration` —— sub-phase 3 graph / ebook / annotation 迁移
- `feature/L7-sub4-remaining-store-migration` —— sub-phase 4 剩余 store 迁移
