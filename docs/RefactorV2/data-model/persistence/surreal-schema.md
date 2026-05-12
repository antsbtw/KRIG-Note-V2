# SurrealDB Schema 设计

> **Phase**: 3d
> **状态**: ✅ **已转正**（2026-05-12）
> **参考依据**: `persistence/spec.md` + `atom-entity.md` + `edge-entity.md` + `decisions/006-010`
>
> 表设计 / 索引 / SurrealQL 已转正。Open Questions（§9 SS1-SS7）含 SurrealDB 实际版本特性验证（如 EVENT 触发器 / 递归 SELECT / computed fields）等，待 Phase N 实施时按硬门槛逐项验证。

---

## 0. 本文档定位

定义 V2 选定后端 SurrealDB（按 [decision 007](decisions/007-storage-target.md)）的**具体 schema**：

- 表结构（atom / edge / 等）
- 字段类型映射（ts 类型 → SurrealDB 类型）
- 索引设计（按 [edge-entity.md §5](edge-entity.md) 子图索引切片维度）
- SurrealQL 实施（按 [decision 008](decisions/008-storage-layer-interface.md) StorageAPI 接口的具体查询语句）
- schema migration 策略（版本号 + 升级路径）
- 与 V1 schema 的范式差异

→ 本文档是 Phase 3 最后一份，**承接前 9 份决议** 并准备进入未来 V2 代码实施 Phase。

---

## 1. 表设计总览

### 1.1 V2 vs V1 范式差异（核心论证）

V1 SurrealDB schema（`src/main/storage/schema.ts` 25+ 表）—— **业务驱动 schema**：每个业务领域一张表（note / folder / vocab / ebook / annotation / bookmark / thought / graph_canvas / 等）+ 业务关系边表（sourced_from / clipped_from / links_to / thought_of）。

V2 走法 B 后（按 [decision 003](../atom/decisions/003-naming-conventions.md)）—— **atom + edge 范式**：

```
V2 主表(2 张):
  atom         所有 domain 的 atom 实体(pm / rdf / embedding / three)
  edge         所有跨 atom 关系边

V2 衍生:
  物化视图     按高频查询模式预计算(可选,性能调优)
  schema 版本表  schema migration 追踪
```

**好处**：
- 跨 domain 一致（pm / rdf / embedding / three 共用 atom 表）
- 跨 vocabulary 一致（family-tree / bpmn / prov 共用 edge 表）
- 跨业务一致（笔记 / 画板 / 书架统一为 atom + edge 模型）
- 新业务**无需新表**（注册新 domain / vocabulary 即可）

**精确承诺**：

| 业务变更 | 是否需要 schema migration |
|---|---|
| 新增 domain（如未来加 `markdown-ast`） | **不需要**（domain 字段正则约束允许任意 kebab-case 字符串） |
| 新增 vocabulary（如 `bpmn`） | **不需要**（vocabulary 段同样正则约束） |
| 新增 atom payload 内字段（如 pm domain 加新 attr） | **不需要**（payload 字段是 `any`，schema 不约束内部结构） |
| 新增 edge attrs 字段（vocabulary-specific 扩展） | **不需要**（attrs 是 `[key]: any`） |
| 新增 atom 实体壳字段（如未来加 `lastModifiedBy`） | **需要**（minor 版本号 schema migration） |
| 新增索引 | **需要**（minor 版本号） |
| 修改既有字段类型 | **需要**（major 版本号 + 数据迁移） |

→ "新业务无需 schema migration" 仅指**业务变化**（新 domain / vocabulary / 内部字段）。**实体壳字段变更 / 索引变更**仍需走 SemVer migration（详 §6）。

**代价**：
- atom / edge 表数据量大（V1 一张 note 表对应 V2 一个 atom + 多条 edge）
- 查询需要 join 实体表 + 边表（V1 单表查询不需要）
- 索引设计要求更高（V2 边表索引决定子图查询性能）

→ V2 接受这些代价，**换"知识图谱原生支持"**（vision.md §2.4 闭环根本依赖）。

### 1.2 V2 SurrealDB 表清单

| 表名 | 类型 | 用途 |
|---|---|---|
| `atom` | SCHEMAFULL | atom 实体（5 字段 + payload JSON） |
| `edge` | SCHEMAFULL | edge 实体（6 字段，含 subject/object/attrs JSON） |
| `schema_version` | SCHEMAFULL | schema migration 版本追踪 |

3 张主表。**不为每个 domain / vocabulary 单独建表**（按 §1.1 范式选择）。

### 1.3 为什么 SCHEMAFULL（不像 V1 SCHEMALESS）

V1 用 SCHEMALESS 因为业务字段灵活变化。V2 走法 B 后字段稳定：

- atom 实体：5 字段（按 [atom-entity.md §1](atom-entity.md)）
- edge 实体：6 字段（按 [edge-entity.md §1](edge-entity.md)）

→ V2 用 **SCHEMAFULL**（DEFINE FIELD 强约束），**实体壳字段固定**，业务变化由 `payload` / `attrs` 内 JSON 承载。

好处：
- 类型校验在 SurrealDB 层（id 必须 string / createdAt 必须 number 等）
- schema 漂移风险低（业务代码不能随意往实体壳加字段）
- 查询性能更可预测

---

## 2. atom 表 schema

### 2.1 DEFINE TABLE 语句

```sql
DEFINE TABLE atom SCHEMAFULL;

-- 实体元属性（按 atom-entity.md §1）
DEFINE FIELD id ON atom TYPE string ASSERT $value != NONE;
DEFINE FIELD createdAt ON atom TYPE number ASSERT $value > 0;
DEFINE FIELD updatedAt ON atom TYPE number ASSERT $value >= createdAt;
DEFINE FIELD createdBy ON atom TYPE string ASSERT $value != "";

-- payload (atom 数据,domain + payload JSON)
DEFINE FIELD payload ON atom TYPE object ASSERT $value != NONE;

-- domain 字段:正则约束格式(kebab-case 字符串),允许扩展
-- 不硬编码白名单 — 按 atom/spec.md §1.1 Domain 注册治理,domain 是开放注册体系
DEFINE FIELD payload.domain ON atom TYPE string
  ASSERT string::matches($value, '^[a-z][a-z0-9-]*$');

DEFINE FIELD payload.payload ON atom TYPE any;  -- 按 domain 分派,SurrealDB 不强约束
```

### 2.2 字段类型映射

| TS 类型 | SurrealDB 类型 | 说明 |
|---|---|---|
| `string`（id） | `string` | ULID 字符串，26 字符 |
| `number`（时间戳） | `number` | Unix 毫秒 |
| `Atom<D>` (payload) | `object` | 嵌套对象，domain 字段强约束，payload 字段 any |

注意：SurrealDB 也支持 **record id 内置类型**（`atom:01HXAB...`）。V2 选 `string` 字段而非 record id 因为：
- id 字符串无类型前缀（按 [decision 006 §4.3](decisions/006-id-generation.md)）
- 跨表 join 形态一致（atom.id / edge.subject.atomId 都是 string）
- 避免业务层处理 record id 的特殊字符串格式

### 2.3 atom 表索引

```sql
-- 按 domain 切片
DEFINE INDEX atom_domain ON atom FIELDS payload.domain;

-- 按 createdBy 切片（用户身份 / agent）
DEFINE INDEX atom_createdBy ON atom FIELDS createdBy;

-- 时间范围查询
DEFINE INDEX atom_createdAt ON atom FIELDS createdAt;
DEFINE INDEX atom_updatedAt ON atom FIELDS updatedAt;

-- 组合索引(高频场景:某用户最近创建的某 domain atom)
DEFINE INDEX atom_user_domain_time ON atom
  FIELDS createdBy, payload.domain, createdAt;
```

### 2.4 全文索引（Phase 3d Open Q）

如果需要支持 `searchAtoms(query: string)`（按 [decision 008 §7 SA1](decisions/008-storage-layer-interface.md)）：

```sql
-- SurrealDB 全文索引(实验性,2.x 起稳定)
DEFINE INDEX atom_fulltext ON atom
  FIELDS payload.payload
  SEARCH ANALYZER ascii BM25;
```

**待决议**：全文索引覆盖范围（仅 pm domain / 全 domain）+ 性能影响。Phase N 业务实施时验证。

---

## 3. edge 表 schema

### 3.1 DEFINE TABLE 语句

```sql
DEFINE TABLE edge SCHEMAFULL;

-- 实体元属性
DEFINE FIELD id ON edge TYPE string ASSERT $value != NONE;
DEFINE FIELD createdAt ON edge TYPE number ASSERT $value > 0;
DEFINE FIELD updatedAt ON edge TYPE number ASSERT $value >= createdAt;

-- edge 数据
DEFINE FIELD predicate ON edge TYPE string
  ASSERT string::matches($value, '^(user|ai|sys):([a-z][a-zA-Z0-9-]*:)?[a-z][a-zA-Z0-9]*$');

DEFINE FIELD subject ON edge TYPE object;
DEFINE FIELD subject.kind ON edge TYPE string ASSERT $value = 'atom';
DEFINE FIELD subject.atomId ON edge TYPE string;

DEFINE FIELD object ON edge TYPE object;
DEFINE FIELD object.kind ON edge TYPE string ASSERT $value INSIDE ['atom', 'literal'];
DEFINE FIELD object.atomId ON edge TYPE option<string>;  -- 当 kind='atom'
DEFINE FIELD object.type ON edge TYPE option<string>;    -- 当 kind='literal'
DEFINE FIELD object.value ON edge TYPE any;              -- literal 值

-- attrs (含 createdBy / confidence / 等,JSON 结构)
DEFINE FIELD attrs ON edge TYPE object;
DEFINE FIELD attrs.createdBy ON edge TYPE string ASSERT $value != "";
DEFINE FIELD attrs.createdAt ON edge TYPE number;
DEFINE FIELD attrs.confidence ON edge TYPE option<number> ASSERT $value >= 0 AND $value <= 1;
DEFINE FIELD attrs.confirmedAt ON edge TYPE option<number>;
DEFINE FIELD attrs.confirmedBy ON edge TYPE option<string>;
DEFINE FIELD attrs.rejectedAt ON edge TYPE option<number>;
DEFINE FIELD attrs.rejectedBy ON edge TYPE option<string>;
DEFINE FIELD attrs.comment ON edge TYPE option<string>;
-- vocabulary-specific 扩展字段不约束（[key]: any）
```

### 3.2 predicate 三段式正则约束

`predicate` 字段 ASSERT 用正则强约束三段式语法（按 [relations/spec.md §1.1 BNF](../relations/spec.md)）：

```
^(user|ai|sys):           ← source 段必选
  ([a-z][a-zA-Z0-9-]*:)?  ← vocabulary 段可选（如 'user:linksTo'）
  [a-z][a-zA-Z0-9]*$      ← edge-name 段必选
```

不符合格式的 predicate 写入直接报错。

### 3.3 edge 表索引（核心 — 决定子图查询性能）

按 [edge-entity.md §5](edge-entity.md) 子图索引切片维度落到 SurrealDB INDEX：

```sql
-- 按完整 predicate 查询(高频)
DEFINE INDEX edge_predicate ON edge FIELDS predicate;

-- 按 subject atomId 查询(读 atom 的出边)
DEFINE INDEX edge_subject ON edge FIELDS subject.atomId;

-- 按 object atomId 查询(读 atom 的入边,仅 kind='atom' 时)
DEFINE INDEX edge_object ON edge FIELDS object.atomId WHERE object.kind = 'atom';

-- 时间范围
DEFINE INDEX edge_createdAt ON edge FIELDS createdAt;

-- 按 createdBy 切片(用户边 vs AI 边 vs sys 边)
DEFINE INDEX edge_createdBy ON edge FIELDS attrs.createdBy;

-- 组合索引(高频场景:某 atom 的某 vocabulary 边)
DEFINE INDEX edge_subject_predicate ON edge FIELDS subject.atomId, predicate;
```

### 3.4 namespace 切片索引（可选优化）

按 source / vocabulary 切片高频，可加**虚拟字段**索引（SurrealDB 2.x 支持 computed fields）：

```sql
-- 虚拟字段:从 predicate 提取 source 段
DEFINE FIELD predicate_source ON edge VALUE
  string::split(predicate, ':')[0];

-- 虚拟字段:从 predicate 提取 vocabulary 段(可能空)
DEFINE FIELD predicate_vocab ON edge VALUE
  IF string::split(predicate, ':').len() >= 3
  THEN string::split(predicate, ':')[1]
  ELSE NONE END;

-- 按 source 切片索引
DEFINE INDEX edge_predicate_source ON edge FIELDS predicate_source;

-- 按 vocabulary 切片索引
DEFINE INDEX edge_predicate_vocab ON edge FIELDS predicate_vocab;
```

**好处**：`WHERE predicate_source = 'user'` 直接走索引，比 `WHERE string::startsWith(predicate, 'user:')` 快。

---

## 4. 跨表关系：atom-edge 引用

### 4.1 引用一致性约束

edge.subject.atomId / edge.object.atomId 必须指向已存在的 atom.id。

**实施方式**：

```sql
-- SurrealDB 没有 SQL 风格 FOREIGN KEY,通过应用层校验
-- (storage 层 putEdge 时先 SELECT atom WHERE id = $atomId)

-- 或用 SurrealDB record link(替代字符串 id):
DEFINE FIELD subject.atomRef ON edge TYPE option<record<atom>>;
-- 此时 SELECT * FROM edge FETCH subject.atomRef 自动 join
```

**V2 选择**：用字符串 atomId（非 SurrealDB record link），保持跨后端 portable。引用校验由 storage 层在 putEdge 时执行。

### 4.2 atom 删除级联

按 [decision 008 §5.1](decisions/008-storage-layer-interface.md) cascade delete：

```sql
-- 删除 atom 时同时删除所有引用该 atom 的 edge
-- (用 SurrealDB 事件触发器,2.x 支持)

DEFINE EVENT atom_delete_cascade ON TABLE atom
  WHEN $event = 'DELETE' THEN (
    DELETE edge WHERE subject.atomId = $before.id;
    DELETE edge WHERE object.atomId = $before.id AND object.kind = 'atom';
  );
```

**待验证**：SurrealDB EVENT 触发器在 Embedded 模式是否完全支持（按 [decision 007 §4.2.1 EM6](decisions/007-storage-target.md) 验证）。

---

## 5. 子图查询 SurrealQL 实施

按 [decision 008 §2.4](decisions/008-storage-layer-interface.md) `querySubgraph` 接口，SurrealQL 实施示例：

### 5.1 按 namespace 切片查询

按 §3.4 namespace 切片索引启用与否，本节有**两种版本**：

#### 基础版（始终可用 —— 直接 predicate 字符串匹配）

```sql
-- 查询所有 family-tree 边
SELECT * FROM edge
WHERE string::starts_with(predicate, 'user:family-tree:')
   OR string::starts_with(predicate, 'ai:family-tree:')
   OR string::starts_with(predicate, 'sys:family-tree:')
ORDER BY createdAt;

-- 查询某用户的所有 family-tree 边
SELECT * FROM edge
WHERE string::starts_with(predicate, 'user:family-tree:')
  AND attrs.createdBy = $userId
ORDER BY createdAt;
```

**性能**：依赖 `edge_predicate` 索引前缀扫描。SurrealDB 字符串前缀查询性能通常较好但**不如等值查询**。

#### 优化版（依赖 §3.4 启用 computed fields + 索引）

**前置条件**：必须先按 §3.4 创建 `predicate_source` / `predicate_vocab` 虚拟字段及对应索引。

```sql
-- 查询所有 family-tree 边
SELECT * FROM edge
WHERE predicate_vocab = 'family-tree'
ORDER BY createdAt;

-- 查询某用户的所有 family-tree 边
SELECT * FROM edge
WHERE predicate_source = 'user'
  AND predicate_vocab = 'family-tree'
  AND attrs.createdBy = $userId;
```

**性能**：走 `edge_predicate_vocab` / `edge_predicate_source` 索引等值查询，比基础版快。

#### 选用建议

| 阶段 | 推荐方案 |
|---|---|
| V2 启动初期（业务少 / 数据小） | **基础版**（不启用 §3.4 优化字段，schema 更简单） |
| 数据规模增长 / 性能瓶颈出现 | 启用 §3.4 优化字段 → **优化版** |
| Phase N 业务实施时 | 视真实数据规模决定，**默认基础版** |

### 5.2 邻居遍历（深度 1）

```sql
-- 读 atom 的所有出边 + 邻居 atoms
SELECT
  *,
  (SELECT * FROM atom WHERE id = $parent.subject.atomId) AS subjectAtom,
  (SELECT * FROM atom WHERE id = $parent.object.atomId AND $parent.object.kind = 'atom') AS objectAtom
FROM edge
WHERE subject.atomId = $rootAtomId;
```

### 5.3 子图查询（深度 N，按 namespace 限定）

按 §4.1 决议 —— V2 用**字符串 atomId**引用（非 SurrealDB record link），所以**不能用** `->edge->atom` 图遍历语法。子图查询走**应用层 BFS / 多次查询**或 SurrealDB **递归 SELECT** 实现：

#### 方案 A：应用层 BFS（storage 层实施）

```ts
// 伪代码 (StorageAPI.querySubgraph 内部实施)
async function querySubgraph(rootAtomId: string, namespace: string, depth: number) {
  const visitedAtomIds = new Set<string>([rootAtomId]);
  const allEdges: EdgeEntity[] = [];
  let frontier = [rootAtomId];

  for (let d = 0; d < depth; d++) {
    // 查询当前 frontier 的所有出边 (按 namespace 切片)
    const edges = await db.query(`
      SELECT * FROM edge
      WHERE subject.atomId INSIDE $frontier
        AND predicate_vocab = $namespace
    `, { frontier, namespace });

    allEdges.push(...edges);

    // 收集下一层 frontier (object.atomId, 跳过已访问)
    const nextFrontier = edges
      .filter(e => e.object.kind === 'atom' && !visitedAtomIds.has(e.object.atomId))
      .map(e => e.object.atomId);

    nextFrontier.forEach(id => visitedAtomIds.add(id));
    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }

  // 一次性加载所有命中的 atoms
  const atoms = await db.query('SELECT * FROM atom WHERE id INSIDE $ids', {
    ids: [...visitedAtomIds],
  });

  return { atoms, edges: allEdges };
}
```

**好处**：
- 跟字符串 atomId 引用方案一致
- 每层只一次查询（深度 D → D 次查询）
- 利用 `edge_subject` 索引高效

#### 方案 B：SurrealDB 递归 SELECT（性能更好但语法复杂）

SurrealDB 2.x 支持递归 SELECT（视具体版本特性）。如果可用，可用单条查询替代应用层 BFS：

```sql
-- 伪代码,实际语法待 V2 实施时按 SurrealDB 2.x 文档验证
-- (注: SurrealDB 2.x 是否完整支持此模式待 Phase N 实施时验证)
SELECT *, (
  -- 递归收集到深度 N 的所有 atom + edge
  -- 具体实施方式: WITH RECURSIVE 或 LET 链式查询
) AS subgraph
FROM atom WHERE id = $rootAtomId;
```

#### 方案 C：未来切 record link 方案时

如果未来 [decision 008](decisions/008-storage-layer-interface.md) / 本文档 §4.1 重新评估，**改用 SurrealDB record link**（`subject: option<record<atom>>`），则可用原生图遍历语法：

```sql
-- 仅当切到 record link 方案时适用
SELECT ->edge[WHERE predicate_vocab = $namespace]->atom AS reachable_atoms
FROM atom
WHERE id = $rootAtomId
LIMIT $depth;
```

**当前默认**：用方案 A（应用层 BFS），待 Phase N 实施时验证方案 B 可用性。如方案 B 不可用，方案 A 已足够覆盖业务场景。

→ 标 Open Q SS7（详 §9）。

### 5.4 物化视图（高频查询优化）

按 [edge-entity.md §5](edge-entity.md) 子图索引切片，对**高频组合查询**可预计算物化视图：

```sql
-- 物化视图:family-tree person 基本信息(name + gender + birthDate)
DEFINE TABLE family_tree_person_view AS
  SELECT
    subject.atomId AS personId,
    (SELECT object.value FROM edge
     WHERE subject.atomId = $parent.subject.atomId
       AND predicate = 'user:family-tree:hasName')[0] AS name,
    (SELECT object.value FROM edge
     WHERE subject.atomId = $parent.subject.atomId
       AND predicate = 'user:family-tree:hasGender')[0] AS gender,
    (SELECT object.value FROM edge
     WHERE subject.atomId = $parent.subject.atomId
       AND predicate = 'user:family-tree:hasBirthDate')[0] AS birthDate
  FROM edge
  WHERE predicate = 'user:family-tree:isA' AND object.value = 'person';
```

**触发更新**：SurrealDB 2.x 支持物化视图自动更新（数据变化时刷新）。

**性能权衡**：物化视图加快读，但增加写入成本。Phase N 实施时按需启用。

---

## 6. schema migration 策略

### 6.1 版本追踪表

```sql
DEFINE TABLE schema_version SCHEMAFULL;
DEFINE FIELD version ON schema_version TYPE string;
DEFINE FIELD appliedAt ON schema_version TYPE number;
DEFINE FIELD description ON schema_version TYPE string;
DEFINE INDEX schema_version_unique ON schema_version FIELDS version UNIQUE;
```

### 6.2 版本号命名约定

按 SemVer：`<major>.<minor>.<patch>`

- **major**：破坏性变更（字段类型变 / 删除字段 / 等）
- **minor**：新增字段 / 新增表 / 新增索引
- **patch**：bug 修复 / 索引调优

V2 起点版本：`1.0.0`（Phase 3d schema 实施时）。

### 6.3 升级路径

```ts
// 伪代码:src/storage/migrations/runner.ts
async function runMigrations(currentVersion: string): Promise<void> {
  const migrations = [
    { version: '1.0.0', description: '初始 schema (Phase 3d)', up: initial },
    { version: '1.1.0', description: '加 X 字段', up: addXField },
    // ...
  ];

  for (const mig of migrations) {
    if (compareVersions(currentVersion, mig.version) < 0) {
      await mig.up();
      await db.create('schema_version', {
        version: mig.version,
        appliedAt: Date.now(),
        description: mig.description,
      });
    }
  }
}
```

### 6.4 破坏性 vs 加法变更

按 [`atom/spec.md §1.1 Domain 注册治理`](../atom/spec.md) "加法" 原则：

- **新增字段 / 表 / 索引** → minor 版本号即可
- **删除 / 修改既有字段** → major 版本号 + 数据迁移脚本

V2 当前阶段（无真实用户数据）—— 破坏性变更代价低。未来真实用户期需严格遵守 SemVer。

---

## 7. V1 SurrealDB schema 参考与差异

### 7.1 V1 schema 概况

V1 `src/main/storage/schema.ts` 含表（25+ 张）：

```
业务表: note / folder / vocab / activity / ebook / ebook_folder / annotation /
       bookmark / bookmark_folder / web_history / media / thought / graph_canvas /
       graph_folder
关系边表: sourced_from / clipped_from / links_to / thought_of
```

### 7.2 V1 → V2 范式差异

| 维度 | V1 | V2 |
|---|---|---|
| 表数量 | 25+（业务驱动） | **2 主表 + 物化视图**（atom + edge） |
| schema 形态 | SCHEMALESS（字段灵活） | **SCHEMAFULL**（字段强约束 + JSON payload） |
| 跨业务关系 | 业务边表（sourced_from / clipped_from / 等） | **统一 edge 表 + 三段式 predicate**（user:prov:wasInformedBy / 等） |
| 新业务接入 | 加新表 + 加新边表 | **注册新 domain / vocabulary,无需改 schema** |
| 跨视图共享 | 各视图独立表（note / graph_canvas） | **共享 atom + edge 表**（按 domain 分派） |

### 7.3 V1 经验复用

虽然范式不同，V1 实施经验可参考：

| V1 经验 | V2 复用方式 |
|---|---|
| SurrealDB 启动 / 连接管理（`client.ts`） | 直搬到 V2 storage 层（如选 Sidecar 模式） |
| 孤儿进程清理（memory `project_surreal_defensive_startup`） | 直搬应对策略 |
| schema migration runner | 借鉴 §6.3 升级路径 |
| Sidecar / WebSocket / IPC 集成 | V2 Sidecar fallback 时直搬 |
| SurrealQL 语法 / 函数 | 直接复用 |

---

## 8. 性能 / 索引调优 / 物化视图

### 8.1 性能基线（预期）

按 [decision 007 §1 KRIG 业务对存储的核心需求](decisions/007-storage-target.md)，V2 关键路径性能预期：

| 操作 | 预期延迟（单机） |
|---|---|
| 单 atom 写入 | < 10ms |
| 单 atom 读取 | < 5ms |
| 单边写入（含 cascade 校验） | < 15ms |
| 邻居遍历（深度 1，节点 10 个） | < 50ms |
| 子图查询（深度 5，节点 100 个） | < 200ms |
| 全文检索（atom 内容） | < 500ms（1 万 atom） |

→ Phase 3d 实施时跑 benchmark 验证（[decision 007 §4.2.1 EM3 硬门槛](decisions/007-storage-target.md) 冷启动 < 3s 已涵盖）。

### 8.2 索引调优原则

按 V2 走法 B：

- **edge 表索引**是核心 —— atom 单表查询少，边查询多
- **避免索引爆炸** —— 仅为高频查询路径建索引
- **组合索引覆盖** —— 高频 WHERE 组合（如 `subject.atomId + predicate`）

### 8.3 物化视图启用时机

物化视图（§5.4）**不在 Phase 3d 默认启用**。仅在以下场景启用：

- 真实业务遇到高频查询性能问题
- 监控数据显示某查询模式 > 10 次/秒 且 > 100ms 延迟
- 单独 decision 立项决议

---

## 9. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| SS1 | SurrealDB EVENT 触发器在 Embedded 模式可用性 | **假设可用**，[decision 007 EM6](decisions/007-storage-target.md) 验证 | Phase 3 实施时 |
| SS2 | computed fields（虚拟字段 predicate_source / predicate_vocab）SurrealDB 2.x 语法 | **按 2.x stable 文档语法**，实施时确认 | Phase N 实施 |
| SS3 | 全文索引覆盖范围（仅 pm domain / 全 domain）| 暂仅 pm domain（搜索笔记内容是主场景） | Phase N 业务实施 |
| SS4 | record link vs 字符串 atomId 选型 | **字符串 atomId**（跨后端 portable） | 不调整 |
| SS5 | 物化视图启用策略 | 默认不启用，按需立项 | Phase N |
| SS6 | schema_version 表的 migration runner 实施位置 | `src/storage/migrations/runner.ts`（待 Phase N 落地） | Phase N |
| SS7 | SurrealDB 2.x 是否支持递归 SELECT 实现深度 N 子图查询？（§5.3 方案 B） | **默认用方案 A 应用层 BFS**（始终可用）；方案 B 待 Phase N 实施时验证 | Phase N 实施 |

---

## 10. 影响清单

如本规范获批：

1. **Phase 3 RFC 全部完成** → 等待用户拍板转正
2. **未来 V2 代码改造**（独立 Phase N）：
   - 创建 `src/storage/surreal/schema.ts` —— 含本文 §2-§3 完整 DEFINE TABLE / FIELD / INDEX 语句
   - 创建 `src/storage/surreal/client.ts` —— Embedded 优先（按 [decision 007](decisions/007-storage-target.md)）
   - 创建 `src/storage/migrations/` —— 含本文 §6.3 升级 runner
   - 实施 `src/storage/api.ts` StorageAPI 接口（按 [decision 008](decisions/008-storage-layer-interface.md)）
3. **按 [decision 009 sub-phase 渐进迁移](decisions/009-migration-strategy.md)** 逐步迁移 9 store

---

## 11. 参考来源

- [`persistence/spec.md`](spec.md) 持久化总规范
- [`persistence/atom-entity.md`](atom-entity.md) atom 实体壳
- [`persistence/edge-entity.md`](edge-entity.md) edge 实体壳
- [`decisions/006-id-generation.md`](decisions/006-id-generation.md) ULID
- [`decisions/007-storage-target.md`](decisions/007-storage-target.md) SurrealDB 选型
- [`decisions/008-storage-layer-interface.md`](decisions/008-storage-layer-interface.md) StorageAPI
- [`decisions/009-migration-strategy.md`](decisions/009-migration-strategy.md) 迁移策略
- [`decisions/010-multi-user-multi-device.md`](decisions/010-multi-user-multi-device.md) 路径 B
- V1 实施：`src/main/storage/schema.ts` / `client.ts`
- [SurrealDB 2.x 文档](https://surrealdb.com/docs)
