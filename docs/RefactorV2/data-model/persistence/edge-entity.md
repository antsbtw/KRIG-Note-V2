# Edge 实体 schema 详定义

> **Phase**: 3c
> **状态**: ✅ **已转正**（2026-05-12）
> **参考依据**: `persistence/spec.md` + `relations/spec.md` + `atom/decisions/003`
>
> 字段定义已转正。Open Questions（§9 EE1-EE4）待真实业务场景驱动逐项决议。

---

## 0. 本文档定位

定义 V2 **edge 实体壳**的完整 schema —— edge 数据如何被包装为可持久化的实体形态。

跟 [`atom-entity.md`](atom-entity.md) 平行（atom 实体）。

`spec.md §1.2` 给了 edge 实体壳的接口总览，本文档展开**每个字段的完整定义 + 子图索引设计 + 跨实体一致性**。

---

## 1. EdgeEntity 完整接口

```ts
/**
 * V2 edge 实体壳 —— edge 数据 + 存储层元属性
 *
 * 跟 AtomEntity 平行：edge 是同级一等公民（按 atom/decisions/003 走法 B）。
 */
export interface EdgeEntity {
  // ── 实体元属性（存储层管理） ──

  /** 全局唯一 id（生成策略按 decisions/006 ULID） */
  id: string;

  /** 创建时间（Unix 毫秒，永久不变） */
  createdAt: number;

  /** 修改时间（Unix 毫秒，每次修改自动更新） */
  updatedAt: number;

  // ── edge 数据（Phase 1 已定义） ──

  /** 三段式 predicate: <source>:<vocabulary>:<edge-name> */
  predicate: EdgePredicate;

  /** 关系主语（按当前默认决议必须是 atom，详 §3.1） */
  subject: AtomRef;

  /** 关系宾语（atom 或 literal） */
  object: EdgeEndpoint;

  /** 边属性（含 createdBy / confidence / confirmedBy / 等） */
  attrs: EdgeAttrs;
}
```

**字段总数**：6 个（3 个元属性 + 3 个 edge 数据字段）。

---

## 2. 元属性字段详定义

### 2.1 id

| 维度 | 规约 |
|---|---|
| 类型 | `string` |
| 生成策略 | ULID（按 [decisions/006](decisions/006-id-generation.md)） |
| 可变性 | **永久不变** |
| 跨实体一致 | 与 atom 实体共用同一 ULID 生成器，**id 字符串无类型前缀**（不写 `'edge-01HXAB...'`） |

按 [decision 006 §4.3](decisions/006-id-generation.md)：atom / edge 共用同一生成器，类型区分通过 storage 层 table / 字段标记。

### 2.2 createdAt

| 维度 | 规约 |
|---|---|
| 类型 | `number`（Unix 毫秒） |
| 来源 | edge 创建时由 storage 层自动写入 |
| 可变性 | **永久不变** |

### 2.3 updatedAt

| 维度 | 规约 |
|---|---|
| 类型 | `number`（Unix 毫秒） |
| 来源 | edge 修改时由 storage 层自动写入 |
| 约束 | `updatedAt >= createdAt` |

**业务层透明**：跟 atom 实体一样，业务层不需要管 updatedAt。

### 2.4 为什么不重复加 `createdBy`

跟 [`atom-entity.md §2.4`](atom-entity.md) 的 `AtomEntity.createdBy` 不同 —— edge 实体**不重复加 `createdBy` 元属性**，因为：

[`relations/spec.md §3.1`](../relations/spec.md) 已强制 `edge.attrs.createdBy: string`。

→ edge 自身已带 createdBy（在 attrs 内），元属性层无需重复。

这跟 atom 实体的差异在于：atom 数据形态（PM node JSON / RDF triple / 向量 / 几何）**自身不带 createdBy**，所以需要在实体壳加；edge 数据形态自身已带，所以不重复。

---

## 3. Edge 数据字段详定义

### 3.1 predicate

```ts
type EdgePredicate = string;  // 形态: <source>:<vocabulary>:<edge-name>
```

按 [`relations/spec.md §1.1`](../relations/spec.md) 三段式语法：

| 段 | 取值 | 含义 |
|---|---|---|
| source | `user` / `ai` / `sys` | 创建源 |
| vocabulary | `prov` / `owl` / `skos` / `schema` / `krig` / `family-tree` / `bpmn` / ... | 命名空间 |
| edge-name | `wasDerivedFrom` / `isParentOf` / `embeddedBy` / etc | 具体边名 |

某些约定俗成边可省略 vocabulary 段（如 `user:linksTo`）。

**存储层职责**：写入时校验 predicate 格式（按 [`relations/spec.md §1.1`](../relations/spec.md) BNF）。

### 3.2 subject

```ts
type AtomRef = { kind: 'atom'; atomId: string };

interface EdgeEntity {
  subject: AtomRef;
  // ...
}
```

**约束**：

- 按 [`relations/spec.md §5.1`](../relations/spec.md) 当前默认决议，**Phase 1 规范层禁止** LiteralValue 作 subject —— subject 必须是 AtomRef。
- subject.atomId 必须**指向已存在的 atom 实体**（写入时由 storage 层校验，见 §5.1）。

### 3.3 object

```ts
type EdgeEndpoint = AtomRef | LiteralValue;

interface EdgeEntity {
  object: EdgeEndpoint;
}
```

object 可以是 atom（跨 atom 关系如 derived_from）或 literal（属性边如 hasGender → 'female'）。

LiteralValue 详 [`relations/spec.md §5.2`](../relations/spec.md) 类型清单（string / number / boolean / date / 等）。

### 3.4 attrs

```ts
type EdgeAttrs = {
  createdBy: string;
  createdAt: number;
  confidence?: number;       // ai/sys 必填
  confirmedAt?: number;
  confirmedBy?: string;
  rejectedAt?: number;
  rejectedBy?: string;
  comment?: string;
  // vocabulary-specific 扩展字段
  [key: string]: unknown;
};
```

完整规约见 [`relations/spec.md §3`](../relations/spec.md)。

**注意**：`EdgeAttrs.createdAt` 跟实体壳 `EdgeEntity.createdAt` 是**不同字段**：
- `EdgeEntity.createdAt`（实体元属性）：edge 写入存储的时间
- `EdgeAttrs.createdAt`（业务字段）：edge 在业务语义上的创建时间（通常与实体 createdAt 相同，但业务可显式指定）

→ 写入时 storage 层会保证 `EdgeEntity.createdAt === EdgeAttrs.createdAt`（除非业务显式覆盖）。

---

## 4. 跨实体一致性

### 4.1 subject / object 引用 atom 必须存在

写入 edge 时：

- `subject.atomId` 必须指向已存在的 atom 实体
- 若 `object` 是 AtomRef，`object.atomId` 同样必须指向已存在 atom

**违反时**：storage 层抛错，拒绝写入（按 [`decision 008 §5.2`](decisions/008-storage-layer-interface.md)）。

**例外**：业务批量创建场景 → 用 `transaction` 保证 atom 先于边创建。

### 4.2 时间戳单调性

跟 atom 实体一致：

- `updatedAt >= createdAt`
- `EdgeEntity.createdAt` 与 `EdgeAttrs.createdAt` 一致（默认）

### 4.3 删除级联

按 [`decision 008 §5.1`](decisions/008-storage-layer-interface.md)：

- 删除 atom → **级联删除**该 atom 被 subject / object 引用的所有 edge
- 删除 edge → 仅删除该 edge，不影响 subject / object 实体

---

## 5. 子图索引设计（落到字段级）

按 [`relations/spec.md §8`](../relations/spec.md) 子图索引切片维度，落到具体字段：

| 切片维度 | 索引字段 | 用途 |
|---|---|---|
| **按 source** | predicate（解析 `<source>` 段） | 备份用户边 / 撤销 AI 边 |
| **按 vocabulary** | predicate（解析 `<vocabulary>` 段） | family-tree 推理引擎只读 `*:family-tree:%` |
| **按 source + vocabulary** | predicate（解析前两段） | "用户主动建立的 family-tree 边" |
| **按 subject** | subject.atomId | 读一个 atom 所有出边 → O(度数) |
| **按 object** | object.atomId（若是 AtomRef） | 读一个 atom 所有入边 → O(度数) |
| **按完整 predicate** | predicate | 所有 `user:linksTo` 边 |

### 5.1 SurrealDB 索引实施（Phase 3d）

具体索引在 [`surreal-schema.md`](surreal-schema.md)（Phase 3d）实施，本文档仅声明**索引切片维度**。

预期实施形态：

```sql
DEFINE INDEX edge_predicate ON TABLE edge FIELDS predicate;
DEFINE INDEX edge_subject_atomid ON TABLE edge FIELDS subject.atomId;
DEFINE INDEX edge_object_atomid ON TABLE edge FIELDS object.atomId WHERE object.kind = 'atom';
DEFINE INDEX edge_created_at ON TABLE edge FIELDS createdAt;
```

具体落到 [`surreal-schema.md`](surreal-schema.md) §3 索引设计章节。

---

## 6. V2 现状对齐

V2 当前**没有独立的 edge store** —— 关系信息散布在各 store 中：

| V2 当前关系 | 当前存储位置 | 目标态：迁移为 edge |
|---|---|---|
| noteLink 节点的 `noteId` attrs | atom payload 内 | `user:linksTo` edge |
| paragraph 等节点的 `from` attrs（V1 概念）| atom payload 内 | `*:prov:wasInformedBy` edge |
| folder 树形结构（noteStore.folderId） | atom payload 内 | `user:krig:inFolder` edge |
| 派生关系（git-style note 演化） | 当前未实现 | `user:prov:wasDerivedFrom` edge |
| embedding 关联（atom → 向量索引） | 当前未实现 | `sys:krig:embeddedBy` edge |

→ Phase 3 实施时按 [decision 009](decisions/009-migration-strategy.md) sub-phase 迁移，逐步把 attrs 内的引用关系迁移到 edge 实体。

---

## 7. 拒绝的字段（与 atom 实体一致）

跟 [`atom-entity.md §5`](atom-entity.md) 同等处置 —— 不加：

- ❌ `deviceId` / `createdDevice` / `lastModifiedDevice`（路径 B 拒绝）
- ❌ `syncState` / vector clock / CRDT 元数据
- ❌ `version` / `deleted`（按 spec PE1 / PE3 暂不加）
- ❌ `priority` / `weight` 等业务字段（业务字段走 attrs.vocabulary-specific 扩展）

---

## 8. 关键设计选择论证

### 8.1 为什么 edge 实体壳没有 createdBy（vs atom 实体壳有）

详 §2.4 已论证：

- atom 数据形态不带 createdBy → atom 实体壳加
- edge 数据形态自身带 createdBy（在 attrs 内）→ edge 实体壳不重复

### 8.2 为什么 edge 需要独立的 id（vs RDF triple 用 SPO 复合主键）

RDF 经典做法：`(subject, predicate, object)` 三元组作为复合主键。

V2 选择给 edge 独立 id 的理由：

1. **edge attrs 增加复杂度**：V2 edge 有 createdBy / confidence / confirmedAt 等 attrs，**同一 SPO 可能有多条 edge**（不同时刻创建、不同 confidence 的 ai/sys 边）。复合主键约束这不成立。
2. **删除 / 更新方便**：edge id 让 deleteEdge(id) / putEdge({id, ...}) 操作直观。
3. **跨实体一致**：atom / edge 共用 ULID 生成器（按 decision 006），形态对称。
4. **关系检索友好**：edge 可作为子图查询的"对象"返回，不只是 atom 间的"连线"。

→ V2 edge 既是关系也是实体（**关系一等公民**，按 decision 003 走法 B 哲学）。

### 8.3 为什么 EdgeEntity.createdAt 与 EdgeAttrs.createdAt 并存

如 §3.4 所述，**两者是不同语义**：

- 实体 createdAt = 物理写入时间（数据库角度）
- attrs.createdAt = 业务创建时间（语义角度）

通常两者相同（写入即创建）。但**特殊场景**可能不同：
- 用户从 V1 迁移历史数据：实体 createdAt = 迁移时间，attrs.createdAt = V1 原始创建时间
- 数据补录场景：业务表示"这条 edge 在历史上某时间点应该存在"

→ 默认两者一致，仅特殊场景由业务层显式区分。

---

## 9. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| EE1 | edge 是否需要 `version` 字段（schema 版本演进）？ | **暂不加**（按 spec.md §6 PE1） | Phase 3+ |
| EE2 | 是否需要批量 deleteEdges API（如"删除该 atom 所有出边"）？ | **暂用 listEdges + deleteEdge 批量调**；高频场景再加 | Phase N |
| EE3 | edge 是否允许"软删除"（保留 audit trail）？V2 选硬删除 | **硬删除**（与 atom 实体一致） | 不引入 |
| EE4 | edge 属性 attrs 内 vocabulary-specific 字段是否需要 schema 校验？ | **不强制 schema 校验**（attrs 是 `[key: string]: unknown`），由调用方负责 | 不调整 |

---

## 10. 影响清单

如本文档获批：

1. `persistence/spec.md` §1.2 edge 实体壳接口与本文件一致
2. `decisions/008-storage-layer-interface.md` `PutEdgeInput` / `EdgeFilter` 类型与本文件 §3 字段对齐
3. `persistence/surreal-schema.md`（Phase 3d）按本文件 §5 索引设计落地
4. **未来 V2 代码改造**（独立 Phase）：
   - 新建 `src/storage/edge-store.ts` —— EdgeEntity 操作（getEdge / putEdge / 等）
   - 各业务 store 改造时把"atom 内嵌引用"逐步迁移为 edge（按 [decision 009 §3.1](decisions/009-migration-strategy.md) sub-phase）

---

## 11. 参考来源

- [`persistence/spec.md`](spec.md) §1.2 edge 实体壳总览
- [`atom-entity.md`](atom-entity.md)（姊妹文档，atom 实体壳）
- [`relations/spec.md`](../relations/spec.md) Edge 通用接口 + 三段式语法 + attrs 规约
- [`atom/decisions/003`](../atom/decisions/003-naming-conventions.md) 走法 B（边是一等公民）
- [`decisions/006-id-generation.md`](decisions/006-id-generation.md) ULID id 生成
- [`decisions/008-storage-layer-interface.md`](decisions/008-storage-layer-interface.md) StorageAPI
