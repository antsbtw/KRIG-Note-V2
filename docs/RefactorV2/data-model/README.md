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

### Phase 1（当前，2026-05-11 启动）—— pm Domain + 总体框架

产出：
- `README.md`（本文件）—— 总体框架 + Atom Domain 总览 + Atom/边设计哲学。
- `atom/spec.md` —— Atom 通用接口 + Domain 注册治理 + pm domain 完整定义；其他 domain 仅登记位置。
- `atom/decisions/002-v1-fields-migration.md` —— V1 atom-types.ts 每个字段 V2 归属判定。
- `atom/decisions/003-naming-conventions.md` —— domain 命名 + 边三段式命名 + 走法 B（属性走边）的总决议。
- `relations/spec.md` —— Edge 通用接口 + 三段式语法 + attrs 规约 + cardinality + vocabulary 治理。

完成后审阅 → 通过 → 才进入下一 Phase。

### Phase 2（NoteView 业务深化）—— relations 启动

产出（按需）：
- `relations/pm-note.md` —— pm atom 如何组成一篇 note；block 类型清单 + attrs schema。
- `relations/pm-folder.md` —— note 与 folder 的树形组织。
- `relations/pm-derived.md` —— note 之间的派生链（`prov:wasDerivedFrom`）。
- 各 decisions 文件按编号追加。

### Phase 3+（其他视图启动时按需展开）

每启动一个新视图：
- 在 `atom/spec.md` 里把对应 domain 从"仅登记"补成"完整定义"。
- 写该 domain 的关系文档（如 family-tree view 启动时写 `relations/three-family-tree.md`，注册 `user:family-tree:%` 命名空间下的边集）。
- 该视图的 view spec 引用 atom spec。

**节奏纪律**：未启动的 domain 只占位、不细化，避免"为未来过度设计"。

---

## 目录结构

```
data-model/
├── README.md                          本文件
├── atom/
│   ├── spec.md                        ✓ Atom 通用接口 + Domain 注册治理 + pm domain 完整定义
│   └── decisions/
│       ├── 002-v1-fields-migration.md ✓ V1 字段 V2 归属判定
│       ├── 003-naming-conventions.md  ✓ domain / 边命名 + 走法 B 总决议
│       └── ...                        后续决策按编号追加
├── relations/
│   ├── spec.md                        ✓ Edge 通用接口 + 三段式语法 + attrs 规约 + cardinality
│   ├── pm-note.md                     （Phase 2+）pm atom 如何组成 note + block 类型清单
│   ├── pm-folder.md                   （Phase 2+）note 与 folder 树形组织
│   ├── pm-derived.md                  （Phase 2+）note 派生链
│   └── ...
└── persistence/                       （留空，建模冻结后再填）
    └── README.md
```

✓ = Phase 1 已写。

---

## 分支

本目录的所有修改在 `feature/L6-data-modeling` 分支上进行。按 [feedback_branch_module_boundary](../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_branch_module_boundary.md) 纪律 —— 多次 commit 但**不合 main**，等整个建模阶段完成再统一合并。
