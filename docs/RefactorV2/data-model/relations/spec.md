# Edge 字段权威定义（V2 spec）

> 本文件定义 V2 Edge（关系边）的核心接口、字段语义、约束条件。代码以本文件为准。
>
> 参考起点：`atom/spec.md` §4 + `atom/decisions/003-naming-conventions.md`。
>
> 本文件是 Phase 1 数据建模的最后一块拼图 —— 走法 B 把系统复杂度搬到边上，边必须有同样严格的 spec。

---

## 0. Edge 是什么

**Edge = V2 语义层与 atom 同级的一等公民**。

按 `atom/decisions/003-naming-conventions.md` 走法 B，所有非 atom 本体属性 / 跨 atom 关系 / 视图绑定 / 派生来源 / 嵌入引用 / 语义解释 —— **全部走边**。

Edge 的核心特性：

1. **三段式命名**：`<source>:<vocabulary>:<edge-name>`，三段都是子图索引切片键。
2. **必须可审计**：每条边必带 `createdBy` / `createdAt`，机器创建的边必带 `confidence`。
3. **subject 必须是 atom，object 可以是 atom 或 literal**：边不一定连两个 atom（属性边的 object 常是 literal 值），但 subject 不允许 literal（详 §5.1）。
4. **cardinality 约束在 vocabulary 自己的 schema 声明**：本 spec 只提供通用接口和约束机制。

---

## 1. EdgeId 三段式语法

### 1.1 BNF 形式约束

```
edge-id          ::= source-segment ':' [ vocabulary-segment ':' ] edge-name-segment

source-segment   ::= 'user' | 'ai' | 'sys'

vocabulary-segment ::= identifier
                       (* 命名空间，如 family-tree / bpmn / prov / owl / krig *)

edge-name-segment ::= identifier
                      (* 具体边名，如 isParentOf / wasDerivedFrom / linksTo *)

identifier       ::= [a-z] [a-zA-Z0-9-]* [a-zA-Z0-9]
                     (* 小写字母开头，字母 / 数字 / 连字符，不以连字符结尾 *)
```

### 1.2 各段命名规则

**source 段**（强制三选一）：

| 取值 | 含义 |
|---|---|
| `user` | 用户主动创建的边 |
| `ai` | AI 自动推断的边（含 LLM / 自动提取 / 自动归纳） |
| `sys` | 系统计算生成的边（含自动 embedding / 自动索引 / 等） |

**vocabulary 段**（可选）：

- 长度 2-32 字符，kebab-case。
- 优先使用业界标准命名空间（参见 §1.3）。
- 约定俗成的常用边（如 `linksTo`）可省略此段。

**edge-name 段**（强制）：

- 长度 2-64 字符，camelCase（动词 / 动词短语优先，如 `isParentOf` / `wasDerivedFrom` / `hasGender` / `flowsTo`）。
- 表达明确语义关系，避免抽象名（不用 `relation1` / `edge` / `data` 等）。

### 1.3 V2 第一波认可的 vocabulary 段

| Vocabulary | 命名空间来源 | 典型边 |
|---|---|---|
| `prov` | W3C PROV-O 标准 | `wasDerivedFrom` / `wasInformedBy` / `wasGeneratedBy` |
| `owl` | W3C OWL 标准 | `sameAs` / `equivalentClass` / `equivalentProperty` |
| `skos` | W3C SKOS 标准 | `broader` / `narrower` / `related` |
| `schema` | Schema.org 词汇表 | `author` / `about` / `creator` |
| `krig` | KRIG 自有 | `embeddedBy` / `represents` / `shownIn` |
| `family-tree` | KRIG 领域命名空间 | `isParentOf` / `hasSpouse` / `hasGender` |
| `bpmn` | KRIG 领域命名空间 | `flowsTo` / `triggers` / `signals` |
| `mind-map` | KRIG 领域命名空间 | `hasChild` / `expandsTo` |

→ 新 vocabulary 注册需遵循 §6 的 vocabulary 治理规则。

### 1.4 合法 / 非法示例

```
✓ 合法：
  user:family-tree:isParentOf
  ai:bpmn:flowsTo
  sys:krig:embeddedBy
  user:prov:wasDerivedFrom
  ai:prov:wasInformedBy
  user:linksTo                  (省略 vocabulary，约定俗成)

✗ 非法：
  family-tree:isParentOf        (缺 source 段)
  user:Family-Tree:isParentOf   (vocabulary 大写)
  user::isParentOf              (空 vocabulary)
  user:family-tree:             (空 edge-name)
  user:family-tree:1isparent    (edge-name 数字开头)
  USER:family-tree:isParentOf   (source 大写)
```

---

## 2. Edge 通用接口

```ts
/**
 * V2 语义层关系边 —— 与 atom 同级一等公民。
 */
export interface Edge {
  /**
   * 边语义标识 —— 三段式 `<source>:<vocabulary>:<edge-name>`。
   * 详见 §1。
   */
  predicate: EdgePredicate;

  /** 关系主语（subject）—— 按 §5.1 Phase 1 规范层禁止 literal,类型层强制 AtomRef */
  subject: AtomRef;

  /** 关系宾语（object）—— 允许 atom 或 literal */
  object: EdgeEndpoint;

  /** 边属性（必填字段见 §3） */
  attrs: EdgeAttrs;
}

/** 三段式 predicate 标识 */
export type EdgePredicate = string;
// 运行时由 edge-predicate-registry 校验语法 + vocabulary 已注册

/** 边端点 —— 可以是 atom 引用或 literal 值 */
export type EdgeEndpoint = AtomRef | LiteralValue;

/** Atom 引用 */
export interface AtomRef {
  kind: 'atom';
  /** atom 实体 id（存储层分配，详见 atom/spec.md §1.1 atom 数据 vs atom 实体） */
  atomId: string;
}

/** Literal 值（属性边的 object 常用）*/
export type LiteralValue = StringLiteral | NumberLiteral | BooleanLiteral | DateLiteral | TypedLiteral;

export interface StringLiteral  { kind: 'literal'; type: 'string'; value: string }
export interface NumberLiteral  { kind: 'literal'; type: 'number'; value: number }
export interface BooleanLiteral { kind: 'literal'; type: 'boolean'; value: boolean }
export interface DateLiteral    { kind: 'literal'; type: 'date'; value: string /* ISO-8601 */ }
export interface TypedLiteral   { kind: 'literal'; type: string; value: unknown /* vocabulary 自定义 */ }
```

**关键设计意图**：

- **predicate 是语义标识**，subject / object 是关系两端。这是标准 RDF 三元组结构（subject - predicate - object）。
- **subject 必须是 AtomRef，object 可以是 AtomRef 或 LiteralValue**：边不强制连两个 atom。`person-atom user:family-tree:hasGender 'female'` 中 object 是 literal，不需要为 'female' 单独建一个 atom。但 subject 端**禁止 literal**（详 §5.1）。
- **attrs 携带必带审计字段 + vocabulary 扩展字段**，详见 §3。

### 2.1 Atom 实体 id 的来源

`AtomRef.atomId` 是存储层分配的实体 id，**不**等同于 atom 数据形态里的任何字段（atom 数据本身没有 id，见 `atom/spec.md` §1.1）。具体 id 生成策略 / 格式留到 Phase 3 persistence 决议。

### 2.2 三元组 vs RDF triple

V2 Edge 结构 = RDF triple 的扩展。差别：

| 维度 | RDF triple | V2 Edge |
|---|---|---|
| subject | IRI / blank node | AtomRef（V2 atom 实体引用） |
| predicate | IRI | 三段式字符串（语义等同 IRI） |
| object | IRI / literal | AtomRef 或 LiteralValue |
| 附加属性 | 无（要用 RDF reification 或 RDF-star） | 一等公民 `attrs` 字段 |

V2 把 attrs 提升为边的一等字段，避免 RDF reification 的复杂度。

---

## 3. attrs 字段规约

### 3.1 必填字段

```ts
export interface EdgeAttrs {
  /** Agent 标识 —— 具体哪个用户 / AI 模型 / 系统任务创建了此边 */
  createdBy: string;

  /** 创建时间（Unix 毫秒） */
  createdAt: number;

  /** 条件必填 + 可选字段见 §3.2 / §3.3 */
  [key: string]: unknown;
}
```

`createdBy` 取值约定：

| source 段 | createdBy 约定取值 |
|---|---|
| `user` | `user-<userId>`（如 `user-wenwu`） |
| `ai` | `ai-<modelId>`（如 `ai-gpt4` / `ai-claude-opus-4.7`） |
| `sys` | `sys-<taskId>`（如 `sys-auto-embed` / `sys-graph-query-cache`） |

### 3.2 条件必填字段

| 字段 | 何时必填 | 含义 |
|---|---|---|
| `confidence: number` | source = `ai` 或 `sys` 时**必填** | 置信度（[0.0, 1.0]），0=完全不确定，1=完全确定 |

不同 vocabulary 下 `confidence` 含义可能不同（如 `sys:krig:embeddedBy` 的 confidence 是向量余弦相似度，`ai:bpmn:flowsTo` 的 confidence 是 LLM 推断置信度）。各 vocabulary 在自己的 schema 里声明 confidence 的具体语义。

### 3.3 可选字段

| 字段 | 含义 |
|---|---|
| `confirmedAt: number` | 用户确认时间戳（用户接管 ai / sys 边时记录） |
| `confirmedBy: string` | 确认操作的 agentId（如 `user-wenwu`） |
| `rejectedAt: number` | 用户拒绝时间戳（拒绝后边可保留作历史，或被存储层 GC） |
| `rejectedBy: string` | 拒绝操作的 agentId |
| `comment: string` | 可选注释（用户对边的自由文本说明） |

### 3.4 Vocabulary-specific 扩展字段

每个 vocabulary 可在自己的 schema 里声明额外的 attrs 字段。例：

```ts
// user:prov:wasInformedBy 边的扩展 attrs
{
  createdBy: 'user-wenwu',
  createdAt: ...,
  pdfPage: 42,         // prov vocabulary 扩展：PDF 页码
  pdfBbox: { ... },    // prov vocabulary 扩展：PDF bbox
}

// sys:krig:embeddedBy 边的扩展 attrs
{
  createdBy: 'sys-auto-embed',
  createdAt: ...,
  confidence: 0.87,    // 余弦相似度
  model: 'openai-ada-002',  // krig vocabulary 扩展：嵌入模型
}
```

扩展字段在 `relations/<vocabulary>/<edge>.md`（Phase 2+）登记。

### 3.5 Schema 校验时机

- **运行时**：写入边时由 capability.graph-query / storage 层按 vocabulary schema 校验（schema 不通过 → 拒绝写入）。
- **类型层**：泛型 `Edge<P extends EdgePredicate>` 可由 vocabulary 提供精确 attrs 类型（Phase 2+ 视实现需要展开）。

---

## 4. Cardinality 约束

### 4.1 三种典型形态

| 约束 | 含义 | 示例 |
|---|---|---|
| **1-1** | 每个 subject 最多 1 条出边，每个 object 最多 1 条入边 | `user:family-tree:hasGender`（一个人只有一个性别） |
| **1-n** | 每个 subject 可有多条出边 | `user:family-tree:isParentOf`（一个人可有多个孩子） |
| **n-n** | 双向都可多条 | `user:linksTo`（一个 atom 可指向多个 atom，反之亦然） |

### 4.2 约束声明位置

Cardinality 约束**不在本 spec 强制声明**，由各 vocabulary 在自己的 schema 文档（`relations/<vocabulary>/<edge>.md`）里声明。

例（family-tree vocabulary schema 片段，待 Phase 2 展开）：

```markdown
# user:family-tree:isParentOf
- cardinality: 1-n（subject 端多个孩子 / object 端多个父母 —— 双向都 1-n）
- subject 端口约束: atom (three domain, kind='node')
- object 端口约束: atom (three domain, kind='node')
- attrs 扩展: 无
```

### 4.3 约束违反的处理

由 capability.graph-query / storage 层在写入时校验：

- 1-1 违反 → 拒绝写入或自动替换旧边（由 vocabulary 自己规定行为）。
- 1-n / n-n 不可能违反（无上限）。

---

## 5. Subject / Object 类型约束

### 5.1 端点类型组合

| Subject | Object | 典型场景 |
|---|---|---|
| AtomRef | AtomRef | atom 间关系（最常见）：派生 / 链接 / 嵌入 / 呈现 |
| AtomRef | LiteralValue | atom 的属性边：name / gender / birthDate |
| LiteralValue | AtomRef | **Phase 1 规范层禁止** —— subject 必须是 AtomRef。需要"反向语义"时改写边名表达 atom-side-subject（例：`'female' isGenderOf x` → `x hasGender 'female'`） |
| LiteralValue | LiteralValue | **禁止** —— 边必须至少有一端是 atom，且 subject 必须是 atom |

### 5.2 LiteralValue 类型清单

V2 Phase 1 支持的 literal 类型：

| type | 数据形态 | 说明 |
|---|---|---|
| `string` | string | UTF-8 字符串 |
| `number` | number | IEEE 754 double（与 JSON 一致） |
| `boolean` | boolean | true / false |
| `date` | string (ISO-8601) | 日期 / 日期时间，存储为 ISO-8601 字符串 |
| `<custom>` | unknown | TypedLiteral 扩展，由 vocabulary 在 schema 声明类型 |

复杂结构（如 `{ x, y }` 坐标）—— 不用 LiteralValue 表达，应该提升为 atom（具体由 vocabulary 决定）。

### 5.3 端点 Atom domain 约束

每条边可在自己的 vocabulary schema 里限定 subject / object 所属的 atom domain。例：

- `user:family-tree:isParentOf` —— subject / object 都必须是 `three` domain 且 `kind='node'`。
- `sys:krig:embeddedBy` —— subject 任意 atom，object 必须是 `embedding` domain。
- `*:krig:represents` —— subject 必须是 `pm` domain，object 必须是 `rdf` domain。

约束违反时由写入路径拒绝。

---

## 6. Vocabulary 治理规则

Vocabulary 是开放注册体系，但注册需遵循以下规则：

### 6.1 命名规则

- kebab-case（小写 + 连字符），长度 2-32 字符。
- 优先使用业界标准命名空间名（prov / owl / skos / schema 等），无标准对应时用领域名（family-tree / bpmn / mind-map 等）。
- 通用 KRIG 自有边用 `krig`。

### 6.2 注册流程

新增 vocabulary 时：

1. 在 `relations/<vocabulary>/README.md` 登记 vocabulary 元数据（命名理由 / 来源 / 主要边集）。
2. 每条边在 `relations/<vocabulary>/<edge>.md` 登记完整 schema（cardinality / endpoint 约束 / attrs 扩展）。
3. 在 `atom/spec.md` §4.3 或本文件 §1.3 加一行索引。

### 6.3 兼容性规则

- 已注册的 vocabulary **不可修改**已有边的语义（含 cardinality / endpoint 约束）。要改 = 注册新边名。
- 已注册边的 attrs **可增**不可删（删字段会破坏存量数据）。
- 删除 vocabulary 或边 = 重大变更，需在 decision 文件单独决议。

### 6.4 版本规则

Vocabulary 自身的版本通过 `relations/<vocabulary>/README.md` 顶部 SemVer 记录。**单条边不带版本**（修改边 = 注册新边）。

---

## 7. 子图索引与查询

边数量爆炸通过子图索引解决。索引机制 = storage 层 + capability.graph-query 共同职责。

### 7.1 索引切片维度

| 维度 | 切片键 | 用途 |
|---|---|---|
| **按 source** | source 段 | 备份用户边 / 审核 AI 边 / 撤销 sys 边 |
| **按 vocabulary** | vocabulary 段 | family-tree 推理引擎只读 `*:family-tree:%` 子图 |
| **按 source + vocabulary** | source + vocabulary | "用户主动建立的 family-tree 边" |
| **按 subject** | atom-id | 读一个 atom 所有出边 |
| **按 object** | atom-id | 读一个 atom 所有入边 |
| **按 predicate** | 完整 predicate 字符串 | 按精确边名查（如所有 `user:linksTo` 边） |

### 7.2 物化视图

对高频查询模式预计算视图（如 family-tree 的 "person 基本信息" = name + gender + birthDate + birthPlace 多边联查）。具体物化视图的注册 / 维护 / 失效策略由 capability.graph-query 实现，本 spec 不展开。

---

## 8. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| ~~E1~~ | ~~反向 literal-as-subject 边是否允许？~~ | **已决议（Phase 1 规范层）**：禁止 literal 作 subject，subject 必须是 AtomRef。方向不便时改写边语义为 atom-side-subject。详 §5.1。 | ✅ 已闭环 |
| E2 | 边自身是否可被边描述（元边，RDF-star 风格）？ | **默认不支持** —— attrs 字段已足够。Phase N 视场景需要再升级。 | Phase N |
| E3 | Cardinality 1-1 违反时是 reject 还是 replace？由 vocabulary 自己规定还是 spec 统一规定？ | **默认 reject**（保守策略），vocabulary 可在 schema 中覆盖为 replace。 | Phase 2 |
| E4 | TypedLiteral 的 type 字段是否需要全局注册表？ | **默认不需要** —— 由 vocabulary 自包含。 | Phase N 视实际场景 |
| E5 | Edge id（边自身实体身份）是否需要？还是 predicate + subject + object 三元组就够了？ | **默认需要 id**（存储层方便引用 / 删除 / 更新）。 | Phase 3 persistence |
| E6 | 边的 attrs `confidence` 在不同 vocabulary 下含义可能不同（embedding 余弦 vs LLM 推断），是否需要标准化？ | **不强制统一** —— vocabulary 在自己 schema 里说明 confidence 语义。 | Phase 2 |

---

## 9. 影响清单

如本 spec 获批：

1. **Phase 2 推进** —— `relations/<vocabulary>/<edge>.md` 按本 spec 模板逐条登记边定义。
2. **V2 代码实施** —— `src/semantic/edge.ts`（或类似位置）实现 `Edge` 接口；`capability.graph-query` 提供 predicate 校验 + cardinality 校验 + 子图查询。
3. **存储层 schema** —— Phase 3 persistence 决议 edge 表 schema（含索引设计）。
4. **架构文档反向更新** —— 等边体系稳定运行 N 个 phase 后，反向更新 `docs/00-architecture/three-layer.md`，把"边是一等公民"纳入架构定义。
