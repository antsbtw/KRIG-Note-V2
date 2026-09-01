# Decision 003 — Domain / 边命名约定 + 走法 B（属性全走边）

> **状态**：草拟中（待审阅）
> **日期**：2026-05-11
> **影响**：`atom/spec.md` + `README.md` + 未来所有 domain / 边定义

---

## 0. 本决议覆盖的范围

本决议是 Phase 1 数据建模的**总决议**，涉及 4 个相互关联的设计决策：

1. Domain 命名按"数据模型标签"原则，不按承载内容描述。
2. 4 个初始 domain 是封闭起点（pm / rdf / embedding / three），但 domain 是开放注册体系。
3. 边按三段式 `<source>:<vocabulary>:<edge-name>` 命名。
4. **走法 B** —— Atom 本体只保留 domain 数据模型自身必需字段，所有非本体属性走边。

每一项单独看可能不大，但**合在一起决定了 V2 整个语义层的工程哲学**。

---

## 1. Domain 命名按"数据模型标签"

### 1.1 拒绝的方案

**方案 A（被拒绝）**：按"承载内容"描述命名 —— `content` / `vector` / `kg-triple` / `geometry`。

**理由**：
- "content" 模糊（什么算 content？markdown 是 content，json 也是 content）。
- 切实现时（如 PM → Lexical）出现两难：改名违反"零成本"承诺，不改名"content"暗示的实现已变化导致名实不符。

### 1.2 采纳的方案

**方案 B（采纳）**：按"数据模型标签"命名 —— `pm` / `rdf` / `embedding` / `three`。

**理由**：
- 命名直接对应数据模型标准（PM node JSON / W3C RDF / 向量 embedding / 几何）。
- 切实现不是改名是**加新 domain**：将来引入 Lexical，注册新 `lexical` domain，旧 `pm` domain 保留可用，跨 domain 通过 converter 转换。
- 这把"实现切换"从破坏性变更降级为加法操作（参见 charter.md §1.3 屏障原则的延伸）。

### 1.3 一个特别说明 —— 为什么领域解释不做成 domain

**这是本决议最关键的一节。**

我们一度考虑把 family-tree / bpmn / mind-map / state-machine / org-chart 等做成独立 domain。**这是错的**。

理由：

**family-tree / bpmn 不是数据模型**，它们的"数据模型"还是点 + 线 + 属性。它们独有的是：

- 语义解释（这个 node 是 person / 这个 edge 是 isParentOf）
- 约束规则（family-tree 必须树形、BPMN 必须 gateway 配对）
- 推理规则（isParentOf 传递闭包 → hasAncestor）

→ 这些是**消费侧（视图 / 推理引擎）的工作**，不是数据本身。

如果把它们做成 domain：
- domain 数量随业务爆炸（认知科学家 Stephen Few 列过 30+ 种图谱模式 + 行业专属 SysML / DBML / SBGN ...）。
- 通用渲染 / 通用交互 / 通用图查询会在每个 domain 里重复实现。
- 把"消费方式"当成"数据本身"，违反 SRP。

**正确做法**：领域解释通过**边的命名空间（vocabulary 段）**表达。一个 family-tree 中的 person 节点 = 一个 three atom + 一组 `user:family-tree:*` 命名空间下的边。

→ 这跟 vision.md §3.2「关系是资产，视图是消耗品」一致 —— 数据本体稳定，语义解释通过叠加边实现。

### 1.4 V2 第一波 4 个初始 domain

| Domain | 数据模型 | 承载 |
|---|---|---|
| `pm` | ProseMirror node JSON | 用户可编辑内容 |
| `rdf` | SPO 三元组 | 客观关系图谱 / 推理 |
| `embedding` | number[] + dim + model | 语义相似度向量 |
| `three` | 点 / 线 / 面 / 体（仅 node/edge/face 三类落地） | 视觉空间布局 |

这 4 个 domain 覆盖 V2 当前所有已知视图。`AtomDomain` 类型签名采用开放 string（运行时由 `atom-domain-registry` 校验），未来扩展（如 markdown-ast / json-schema / musicxml）通过注册新 domain 加入。

---

## 2. 边按三段式 `<source>:<vocabulary>:<edge-name>` 命名

### 2.1 三段含义

| 段 | 取值 | 含义 |
|---|---|---|
| **source** | `user` / `ai` / `sys` | 谁创建的（粗分类） |
| **vocabulary** | `family-tree` / `bpmn` / `mind-map` / `prov` / `owl` / `skos` / `krig` / ... | 语义命名空间 |
| **edge-name** | `isParentOf` / `flowsTo` / `wasDerivedFrom` / ... | 具体边名 |

某些约定俗成边可省略 vocabulary 段（如 `user:linksTo`）。

### 2.2 为什么是三段不是两段或四段

考虑过的方案：

**两段（vocabulary:edge-name）**：丢失"谁创建"信息，违反 vision.md §8 "AI 写入必须可被用户确认 / 撤销"。

**两段（source:edge-name）**：同一种语义关系（如 `linksTo`）在多种 vocabulary 下重复，推理时枚举成本高。

**四段（source:vocabulary:edge-name:variant）**：variant 段在 attrs 里表达更合适，不需要进命名。

**三段是恰好的颗粒度** —— source 段满足审计 / 撤销需求，vocabulary 段满足标准对齐 / 子图切片需求，edge-name 段是关系本身。

### 2.3 三段的检索 / 推理优势

按段索引：

- `WHERE namespace LIKE 'user:%'` → 所有用户主动创建的边（可备份 / 可导出）。
- `WHERE namespace LIKE 'ai:%'` → 所有 AI 创建的边（可批量审核 / 撤销）。
- `WHERE namespace LIKE '*:family-tree:%'` → family-tree 推理引擎使用的所有边（不管 source）。
- `WHERE namespace = 'user:prov:wasDerivedFrom'` → 精确查派生链。

→ 命名结构本身就是子图切片的天然索引键。

### 2.4 边的 attrs 必带字段

```ts
{
  createdBy: string;        // agentId (user-wenwu / ai-gpt4 / sys-auto-embed)
  createdAt: number;
  confidence?: number;      // ai / sys 创建时必填
  confirmedAt?: number;     // 用户确认时间戳（若有）
  confirmedBy?: string;     // 用户 agentId
}
```

`source` 段告诉粗分类，`createdBy` 告诉具体 agent。二者职责分明，不冗余。

### 2.5 第一波核心边集

详见 `atom/spec.md` §4.3（包含 prov:wasDerivedFrom / prov:wasInformedBy / krig:embeddedBy / krig:represents / krig:shownIn / linksTo 等）。

---

## 3. 走法 B —— 所有非本体属性走边

### 3.1 走法 A / B / C 对比

**走法 A（被拒绝）**：所有属性（含语义解释）塞 atom.attrs。
- 缺点：atom.attrs 变成"什么都能塞"，schema 弱化；同一 atom 不能被多种语义体系并存标注。

**走法 C（被拒绝）**：高频几何属性留 payload，语义属性走边。
- 缺点：「什么是高频」无客观定义 → payload 越长越大 → 退化为 V1 atom-types.ts 的 484 行混合类型。

**走法 B（采纳）**：atom 本体只保留 domain 数据模型自身必需字段，所有非本体属性走边。

### 3.2 走法 B 的核心原则

**判定字段是否进 payload 的规则**：

> "脱掉这个字段，atom 还是同一个本体吗？"
> 是 → 属于附加属性，走边。
> 否 → 属于本体身份，留在 payload。

**例**：
- three atom 的 `position`：脱掉它 → 这个几何节点失去身份（点的位置都没了还叫点吗？）→ **留 payload**。
- three atom 的 `color`：脱掉它 → 几何节点身份不变 → **走边**。
- three atom 的 `family-tree:gender`：脱掉它 → 几何节点身份不变 → **走边**。

### 3.3 走法 B 的工程影响

**1. 边数量爆炸是真的，但不是问题。**

一个 family-tree person 真实拥有 10+ 个属性边（name / gender / birthDate / birthPlace / isParentOf / ...）—— 这些关系**本来就存在**，A / C 方案只是把它们打包压扁塞 atom，**省的是写代码的复杂度，不是省关系本身**。

走 B 等于承认"关系数量等于知识丰富度"，跟 vision.md §3.2「关系是资产」完全一致。

**2. 性能通过子图索引解决。**

不能每次都全图扫描，但 SurrealDB 原生支持：
- 命名空间索引（按 `<source>:<vocabulary>` 切片）
- 实体邻居索引（atom id → 出边 / 入边）
- 物化视图（高频查询模式预计算）

走 B 永远只有一种查询模式 —— **查边**。这跟 RDF / SPARQL / Cypher 等成熟图查询工具天然对齐。

**3. 构建路径是构造性的（叠加），不是替换性的。**

- 创建 family-tree person = 1 个 three atom + 叠加 N 条 `user:family-tree:*` 边。
- 同一个人也是 org-chart 的 employee = 同一 three atom + 叠加 `user:org-chart:*` 边。
- 多语义解释共存，互不破坏。

走法 A / C 都做不到这点 —— A 的 attrs.semanticVocab 只能写一个，C 在 payload 里塞特定 vocab 字段会污染本体。

**4. 没有"高频 vs 低频"的滑坡判断。**

走 C 一旦开始混合，永远在判断"这个属性要不要升 payload"。走 B 一刀切的清晰度让设计 / 审查 / 重构都简单一个数量级。

### 3.4 走法 B 的局限性 / 接受的代价

- **简单场景变得很重**：仅显示"这是一个圆，标签是 Alice"也需要查 1 个 atom + 至少 1 条 edge。物化视图缓解这部分代价。
- **写入操作要事务**：创建 person 涉及 1 个 atom + 10+ 条边的原子写入，依赖 SurrealDB 的事务能力（已支持）。
- **学习成本**：开发者要适应"读 atom 必然要 join 边"的心智模型。但跟图数据库 / RDF 已有的工具生态对齐，长期是资产。

---

## 4. 各决策的相互关系

四个决策不是独立的，是一个相互支撑的整体：

```
  ┌────────────────────────────────────────────┐
  │ 决策 1: Domain 命名按数据模型标签           │
  │   ↓ 4 个稳定 domain（pm / rdf / embedding / │
  │     three）+ 开放注册                       │
  └─────────────────┬──────────────────────────┘
                    │
                    ↓
  ┌────────────────────────────────────────────┐
  │ 决策 1.3: 领域解释不做成 domain             │
  │   ↓ family-tree / bpmn 等是边的命名空间     │
  │     而不是新 domain                         │
  └─────────────────┬──────────────────────────┘
                    │
                    ↓
  ┌────────────────────────────────────────────┐
  │ 决策 2: 边按三段式 source:vocabulary:edge   │
  │   ↓ vocabulary 段承载所有领域解释           │
  │   ↓ source 段满足用户/机器审计              │
  │   ↓ 三段都是子图索引切片键                  │
  └─────────────────┬──────────────────────────┘
                    │
                    ↓
  ┌────────────────────────────────────────────┐
  │ 决策 3: 走法 B 所有属性走边                  │
  │   ↓ atom 本体只保留 domain 本体字段         │
  │   ↓ 一切附加属性叠加为边                    │
  │   ↓ 跟决策 2 的三段命名 + 子图索引联动      │
  └────────────────────────────────────────────┘
```

→ 拆任何一个，其他三个都站不住。

---

## 5. 影响清单

如本决议获批：

1. **README.md** —— 反映四条建模原则 + Atom/边设计哲学。
2. **atom/spec.md** —— Domain 改名（content → pm，等），three domain payload 严格定义本体字段，§4 边一等公民 + 三段命名 + 子图索引说明。
3. **decisions/002** —— 顶部 "content domain" 改为 "pm domain"。
4. **未来 Phase 2+** —— relations 目录展开时，所有边按三段式命名；每条边在 `relations/<vocab>/<edge>.md` 登记。
5. **未来 Phase 3 persistence** —— 子图索引机制具体实现（命名空间索引 / 实体邻居索引 / 物化视图）。
6. **未来代码实施** —— `capability.graph-query` 负责子图切片查询；`capability.text-editing` 等表征类能力消费各 domain 数据；视图层 install 能力组合。

---

## 6. 拒绝方案的备忘

为未来回溯，记录被拒绝的方案 + 拒绝理由：

| 方案 | 拒绝理由 |
|---|---|
| Domain 按承载内容命名（content / vector / kg-triple / geometry） | 切实现时名实矛盾，违反"零成本"承诺 |
| family-tree / bpmn / mind-map 做成独立 domain | 把"领域解释"当"数据本体"，违反 SRP；domain 数量爆炸；通用渲染/交互/查询重复实现 |
| 边两段式 vocabulary:edge-name | 丢失"谁创建"信息，违反 vision.md §8 审计要求 |
| 边两段式 source:edge-name | 同语义关系在多 vocabulary 下重复，推理成本高 |
| 走法 A —— 所有属性塞 atom.attrs | attrs 大杂烩；多语义并存不支持 |
| 走法 C —— 高频属性留 payload + 语义属性走边 | "高频"无客观定义，滑坡进 V1 模式 |
| 把通用图能力（geometry / 交互 / 查询）放进"graph-base domain" | 违反 charter.md §1.1 纵向分层（这些是能力层职责） |

---

## 7. 待审阅人确认

- [ ] 决策 1：Domain 命名 + 4 个初始 domain 无异议
- [ ] 决策 1.3：领域解释（family-tree / bpmn / 等）不做成 domain，归边的 vocabulary 段
- [ ] 决策 2：边三段式 `<source>:<vocabulary>:<edge-name>` 命名
- [ ] 决策 3：走法 B（所有非本体属性走边）
- [ ] 各决策相互关系图（§4）准确反映设计意图
