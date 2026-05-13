# Decision 011 — Phase N Sub-phase 1: SurrealDB 基础设施实施任务

> **Phase**: N（实施 Phase）/ Sub-phase 1
> **状态**: ✅ **已实施完成**（merge commit `34e3758`，13 commits）
> **设计师 / 审计师**: main 分支
> **实施者**: `feature/L7-sub1-surreal-infrastructure` 分支（已审计通过）
> **决议日期**: 2026-05-12
> **实施完成**: 2026-05-12
>
> ## 实施过程偏离设计的事实纠错（已合入实施）
>
> 实施期间发现 4 处设计文档与 SurrealDB binary 3.0.4 实际行为不一致，由实施者按设计师批复修正：
>
> | 偏离点 | 设计文档原写法 | 实际实施 | 原因 |
> |---|---|---|---|
> | **§3.4 + §5.6 Embedded 模式** | "Embedded 优先 / Sidecar fallback" | **Sidecar only** | `surrealdb@2.x` client SDK 与 `@surrealdb/node@3.x` Embedded engine 主版本不兼容（3.x 仍 alpha）；EM1 硬门槛触发 |
> | **§3.4 edge_object 索引** | `DEFINE INDEX edge_object ... WHERE object.kind = 'atom'` | 去除 WHERE 子句，全索引 | SurrealDB 3.0.4 DEFINE INDEX 不支持 WHERE 子句（partial index 语法 v3.x 不识别）|
> | **§3.4 schema 幂等性** | 无 IF NOT EXISTS | 全部 DEFINE 加 `IF NOT EXISTS` | 二次冷启动 DEFINE 重复执行触发 AlreadyExistsError |
> | **§3.4 schema_version CREATE** | `CREATE schema_version SET version = '1.0.0'` | 改 `UPSERT schema_version:'1.0.0'` + RecordId 绑定 | 字面量字符串在 SurrealQL 解析为 strand 而非 record id，CREATE 重复执行 UNIQUE 冲突 |
> | **§5.7 storage.ts id 类型** | `string` 字段绑定 | `new RecordId('atom', id)` / `new RecordId('edge', id)` 绑定 | SCHEMAFULL 表 id 字段是 record id 类型（`atom:01K...`），不是普通 string |
>
> 责任在设计师 —— 写 SQL / SurrealQL 时未在 binary 实测。**未来 sub-phase 2-4 设计文档应明示"已 binary 验证 / 仅纸上推演"标识**。
>
> ## 后续 hotfix(sub-phase 1 合入后新发现并修复)
>
> 2026-05-13 在 sub-phase 3a-2.5 Checkpoint 2 排查 P1 持久化丢失时,发现并修复
> 2 个 sub-phase 1 阶段已埋下、尚未触发的 bug。详 [decision 017](017-storage-persistence-hotfix.md):
>
> | Bug | 位置 | 偏离描述 | 修复 |
> |---|---|---|---|
> | **P0a — putAtom UPDATE-only** | [`storage.ts:114`](../../../../../src/storage/surreal/storage.ts#L114) | 设计契约 "传 id = UPDATE 必须已存在",sub-phase 3a-1 引入 view 端预生成 client id 模式后触发 — 新 instance 全部抛 "Atom not found" 不入库 | `e6b5ca3` 改 UPSERT 短路语义,OR 短路 createdAt/createdBy(decision 017 §2.1) |
> | **P0c — runner SELECT 3.0.4 不兼容** | [`runner.ts:32`](../../../../../src/storage/migrations/runner.ts#L32) | `SELECT version FROM schema_version ORDER BY appliedAt DESC LIMIT 1` 在 SurrealDB 3.0.4 触发 parse error (要求 ORDER BY 字段须在 SELECT 中),catch 静默吞 → currentVersion 永远 fallback '0.0.0' → migration 每次启动全跑;不丢数据但浪费 + 埋诊断 | `04a5c5e` SELECT 加 `appliedAt` 投影 + catch console.warn(decision 017 §2.2) |
>
> binary verify 三层实证(2026-05-13 总指挥协调用户跑):
> - shape 3 个跨重启保留 + atom 10 个数据完整(P0a UPSERT 生效)
> - schema_version 3 条记录 appliedAt 是历史时间(P0c SELECT 修法生效)
> - 重启后 0 行 applying 日志(P0c catch 修法生效)
>
> ## 实施新增（未在原文档预设）
>
> | 新增 step | 内容 | 理由 |
> |---|---|---|
> | **Step 5.1.5** | 改 V2 productName "KRIG Note" → "KRIG Note V2" | 隔离 V1/V2 userData（Electron `app.getPath('userData')` 按 productName 走，V1/V2 同名会冲突） |
>
> ## 反向更新已对齐的下游文档
>
> - `decisions/007-storage-target.md` §4.2 — Embedded 优先变 Sidecar only + EM1 触发说明
> - `decisions/009-migration-strategy.md` §3.1 — sub-phase 1 标 ✅ 完成
> - `decisions/010-multi-user-multi-device.md` §2 预留 3 — ownerId 状态改"接口已落地，运行时仍 user-default"
> - `surreal-schema.md` §3.3 — edge_object 索引去 WHERE + 4 处事实纠错备注
> - `data-model/README.md` — Phase N sub-phase 1 完成记录
>
> ---
>
> **以下为原设计文档**（实施已完成，保留作历史记录；事实纠错见上文）：

---

---

## 0. 本文档的执行指南

### 0.1 角色与流程

```
本对话 (main)
    ↓ 写本文档(设计师)
    ↓
新对话 (feature/L7-sub1-surreal-infrastructure) — 独立 session
    ↓ 按本文档执行代码实施(实施者)
    ↓ 每完成一个步骤 commit 一次
    ↓ 完成后停下,通知本对话
    ↓
本对话 (main)
    ↓ 验证测试清单 + 审计代码(审计师)
    ↓ 通过 → 合并 main
    ↓ 不通过 → 列问题清单 → 新对话继续修
```

### 0.2 实施纪律（实施者必须遵守）

1. **严格按本文档执行**，不要自行扩展范围。发现文档遗漏 → 停下来等本对话补充，**不要自行决定**。
2. **每完成一个 §5 步骤 commit 一次**（细粒度 commit 便于回滚 / 审计）。
3. **不动 V1 任何代码**（pwd 在 `/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`，按 [feedback_v2_is_workspace_v1_is_reference](../../../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_v2_is_workspace_v1_is_reference.md)）。
4. **不合并到 main**，所有 commit 留在 `feature/L7-sub1-surreal-infrastructure` 分支。
5. **完成所有 §5 步骤后停下**，发消息 "L7-sub1-surreal-infrastructure 实施完成请审计"。不要继续做别的事。
6. 实施期间若发现本文档矛盾 / 不可行 → 立刻停下汇报，**不要"绕过"**。
7. **不动业务 store**（noteStore / folderStore / graphStore / ebookStore / 等）—— 本 sub-phase 1 仅做基础设施，保留 9 store 现状。

### 0.3 本文档为何要冗余复述决议链

本文档面向**独立新对话**，那个对话不会自动继承本对话的数据建模上下文。因此本文档必须自包含：

- 不假设读者知道 "decision 003 走法 B"、"naming-conventions" 等内容。
- 所有关键规范 / 命名 / 阶梯在本文档内**复述清楚**。
- 不用 "按 Phase 3 决议处置" 这种内部引用 —— 直接给出实施代码 / 步骤。

---

## 1. 改造目标（What）

### 1.1 本 sub-phase 的范围（仅基础设施）

按 [`decisions/009-migration-strategy.md`](009-migration-strategy.md) §3.1 sub-phase 1 定义：

**包含**：
- 引入 SurrealDB（Embedded 优先 / Sidecar fallback）
- 实施 `src/storage/api.ts` —— StorageAPI 接口定义
- 实施 `src/storage/surreal/` —— SurrealStorage 实现
- 实施 `src/storage/ulid.ts` —— ULID id 生成
- 实施 `src/storage/migrations/runner.ts` —— schema migration runner
- 实施 `src/semantic/types/` —— Atom / AtomEntity / Edge / EdgeEntity TS 类型
- 实施 SurrealDB schema 初始化（atom + edge + schema_version 三张表）
- EM1-EM6 硬门槛验证（按 [`decisions/007-storage-target.md`](007-storage-target.md) §4.2.1）

**不包含**：
- 业务 store 改造（noteStore / folderStore / graphStore / 等保留现状）
- view 层改动
- capability 改造
- 真实数据迁移

→ 完成后，V2 有"可用的 storage 基础设施"，但**业务还没接进来**。下一个 sub-phase 才接 noteStore。

### 1.2 V2 当前现状（实施起点）

V2 当前 `src/storage/` 和 `src/semantic/` 是**空目录**（只有 README.md 占位）。

V2 当前持久化分布在 9 个独立 store：
- Renderer 端 4 个 localStorage（krig.notes / krig.folders / krig-v2-workspace-state / inspector 位置）
- Main 端 5 个磁盘 JSON（graph / ebook / annotation / vocab / media）

本 sub-phase **不动这些 store**。

### 1.3 完成判据（高层）

- `npm start` 跑通
- SurrealDB Embedded 模式启动成功（或 fallback Sidecar 成功）
- 测试 atom + 测试 edge 写入 / 读取成功
- typecheck + lint 通过
- EM1-EM6 硬门槛验证通过

详 [§6 测试清单](#6-测试清单实施完成判据)。

---

## 2. 改造背景（Why）

### 2.1 V2 持久化目标态

按 [`decisions/007-storage-target.md`](007-storage-target.md) 决议，V2 选 **SurrealDB**（Embedded 优先 / Sidecar fallback）。原因：

- 图查询原生支持（KRIG 闭环根本需求）
- V1 已有完整 SurrealDB 实施经验
- multi-model 一站式（文档 + 图 + KV）

按 [`decisions/008-storage-layer-interface.md`](008-storage-layer-interface.md)，所有上层（capability / view）通过 **StorageAPI 抽象接口**访问，不直接依赖具体后端。

按 [`decisions/009-migration-strategy.md`](009-migration-strategy.md)，迁移走渐进 4 sub-phase 模式，**sub-phase 1 = 基础设施**。

### 2.2 为什么先做基础设施（不混业务迁移）

- **风险隔离**：SurrealDB 引入 + 接口设计是高风险动作，单独 sub-phase 便于回滚
- **测试便利**：基础设施完成后单元 / 集成测试可独立跑，不依赖业务状态
- **下游解锁**：sub-phase 2 noteStore 迁移 + sub-phase 3-4 各 store 迁移都依赖基础设施

### 2.3 接受的代价

- 本 sub-phase 完成后 V2 应用看起来"没变化"（业务没切，用户感知 0）
- 但 storage 层已经准备好，下一 sub-phase 可立刻接

---

## 3. 实施目标态（What 具体）

### 3.1 目录结构

实施后 V2 src/ 结构：

```
src/storage/                              ← 本 sub-phase 新建
├── README.md                              已存在(更新内容)
├── api.ts                                 StorageAPI interface + 类型
├── ulid.ts                                ULID id 生成 (uppercase / monotonic)
├── surreal/
│   ├── client.ts                          SurrealDB 客户端 (Embedded 优先 / Sidecar fallback)
│   ├── schema.ts                          SurrealDB schema 初始化 (atom + edge + schema_version)
│   ├── storage.ts                         SurrealStorage 类 (实现 StorageAPI)
│   └── index.ts                           导出 storage 单例
├── migrations/
│   └── runner.ts                          schema migration runner
└── index.ts                               主入口,导出 storage 单例 + StorageAPI 类型

src/semantic/                              ← 本 sub-phase 新建
├── README.md                              已存在(更新内容)
├── types/
│   ├── atom.ts                            Atom<D> + AtomDomain + AtomPayloadOf<D>
│   ├── atom-entity.ts                     AtomEntity 接口
│   ├── edge.ts                            Edge + EdgePredicate + EdgeEndpoint + AtomRef + LiteralValue + EdgeAttrs
│   ├── edge-entity.ts                     EdgeEntity 接口
│   └── index.ts                           re-export
└── index.ts                               主入口
```

### 3.2 关键 TS 类型定义

#### `src/semantic/types/atom.ts`

```ts
/**
 * V2 语义层 Atom 通用接口
 * 详 docs/RefactorV2/data-model/atom/spec.md §1
 */

export type AtomDomain = string;  // 'pm' / 'rdf' / 'embedding' / 'three' / 等(开放注册)

/** Atom 主接口 */
export interface Atom<D extends AtomDomain = AtomDomain> {
  domain: D;
  payload: AtomPayloadOf<D>;
}

/** 按 domain 分派 payload 类型 */
export type AtomPayloadOf<D extends AtomDomain> =
  D extends 'pm'        ? PmPayload :
  D extends 'rdf'       ? RdfPayload :
  D extends 'embedding' ? EmbeddingPayload :
  D extends 'three'     ? ThreePayload :
  unknown;

/** pm domain — ProseMirror node JSON 形态 */
export interface PmPayload {
  type: string;
  content?: PmPayload[];
  attrs?: Record<string, unknown>;
  marks?: Mark[];
  text?: string;
}

/** rdf domain (Phase N 占位,本 sub-phase 不展开) */
export interface RdfPayload {
  subject: string;
  predicate: string;
  object: string;
}

/** embedding domain (占位) */
export interface EmbeddingPayload {
  vector: number[];
  dim: number;
  model: string;
}

/** three domain (占位) */
export interface ThreePayload {
  kind: 'node' | 'edge' | 'face';
  position?: { x: number; y: number; z?: number };
  shape?: string;
  size?: { w: number; h: number; d?: number };
}

/** Mark (pm domain inline) */
export type Mark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'underline' }
  | { type: 'strike' }
  | { type: 'code' }
  | { type: 'highlight'; attrs?: { color?: string } }
  | { type: 'textStyle'; attrs?: { color?: string } }
  | { type: 'link'; attrs: { href: string; title?: string } };
```

#### `src/semantic/types/atom-entity.ts`

```ts
import type { Atom, AtomDomain } from './atom';

/**
 * V2 atom 实体壳
 * 详 docs/RefactorV2/data-model/persistence/atom-entity.md §1
 *
 * ⚠ 2026-05-12 反向更新(sub-phase 3a-1 实施时扩展):
 * 加 hasBeenReferenced?: boolean 字段(decision 013 §3.5 + decision 014 §3.7)
 * - 单向 flag,DEFAULT false,被第 2+ 条 hasContent 边引用时置 true(永不复位)
 * - optional 字段,sub-phase 1/2 旧数据无此字段 — normalizer 用 `?? false` 兜底
 * - 适用所有 atom,但目前只有 pm 会被多引用(sub-phase 3a-1 单引用约束下恒 false)
 * - 详 decision 014 §12.2 偏离 6(决策点 E)
 */
export interface AtomEntity<D extends AtomDomain = AtomDomain> {
  id: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
  payload: Atom<D>;
  hasBeenReferenced?: boolean;   // ← sub-phase 3a-1 反向扩展
}
```

#### `src/semantic/types/edge.ts`

```ts
/**
 * V2 语义层 Edge 通用接口
 * 详 docs/RefactorV2/data-model/relations/spec.md §2
 */

export type EdgePredicate = string;  // <source>:<vocabulary>:<edge-name>

/** Atom 引用 */
export interface AtomRef {
  kind: 'atom';
  atomId: string;
}

/** Literal 值 */
export type LiteralValue = StringLiteral | NumberLiteral | BooleanLiteral | DateLiteral | TypedLiteral;

export interface StringLiteral  { kind: 'literal'; type: 'string'; value: string }
export interface NumberLiteral  { kind: 'literal'; type: 'number'; value: number }
export interface BooleanLiteral { kind: 'literal'; type: 'boolean'; value: boolean }
export interface DateLiteral    { kind: 'literal'; type: 'date'; value: string }
export interface TypedLiteral   { kind: 'literal'; type: string; value: unknown }

/** 边端点 */
export type EdgeEndpoint = AtomRef | LiteralValue;

/** Edge attrs */
export interface EdgeAttrs {
  createdBy: string;
  createdAt: number;
  confidence?: number;
  confirmedAt?: number;
  confirmedBy?: string;
  rejectedAt?: number;
  rejectedBy?: string;
  comment?: string;
  [key: string]: unknown;  // vocabulary-specific 扩展
}

/** Edge 主接口 */
export interface Edge {
  predicate: EdgePredicate;
  subject: AtomRef;            // 按 Phase 1 规范层禁止 literal,类型层强制 atom
  object: EdgeEndpoint;
  attrs: EdgeAttrs;
}
```

#### `src/semantic/types/edge-entity.ts`

```ts
import type { Edge } from './edge';

/**
 * V2 edge 实体壳
 * 详 docs/RefactorV2/data-model/persistence/edge-entity.md §1
 */
export interface EdgeEntity extends Edge {
  id: string;
  createdAt: number;
  updatedAt: number;
}
```

### 3.3 StorageAPI 接口（`src/storage/api.ts`）

按 [`decisions/008-storage-layer-interface.md`](008-storage-layer-interface.md) §2 完整接口实施。简要：

```ts
import type {
  AtomEntity, EdgeEntity, AtomDomain,
  Atom, Edge, EdgePredicate, AtomRef, EdgeEndpoint, EdgeAttrs,
} from '@/semantic/types';

export interface StorageAPI {
  // atom CRUD
  getAtom<D extends AtomDomain = AtomDomain>(id: string, options?: StorageOptions): Promise<AtomEntity<D> | null>;
  putAtom<D extends AtomDomain = AtomDomain>(atom: PutAtomInput<D>, options?: StorageOptions): Promise<AtomEntity<D>>;
  listAtoms(filter: AtomFilter, options?: StorageOptions): Promise<AtomEntity[]>;
  deleteAtom(id: string, options?: StorageOptions): Promise<{ deleted: boolean; cascadedEdges: number }>;

  // edge CRUD
  getEdge(id: string, options?: StorageOptions): Promise<EdgeEntity | null>;
  putEdge(edge: PutEdgeInput, options?: StorageOptions): Promise<EdgeEntity>;
  listEdges(filter: EdgeFilter, options?: StorageOptions): Promise<EdgeEntity[]>;
  deleteEdge(id: string, options?: StorageOptions): Promise<{ deleted: boolean }>;

  // 子图查询
  querySubgraph(query: SubgraphQuery, options?: StorageOptions): Promise<SubgraphResult>;

  // 事务
  transaction<T>(fn: (tx: StorageTransaction) => Promise<T>, options?: StorageOptions): Promise<T>;

  // 健康检查
  health(): Promise<{ alive: boolean; backend: string; version?: string }>;
}

export interface StorageOptions {
  ownerId?: string;       // 路径 B 最小预留 3,本 sub-phase 不消费
  timeoutMs?: number;
}

export interface PutAtomInput<D extends AtomDomain = AtomDomain> {
  id?: string;            // 创建时不传(storage 层生成 ULID);更新时传
  payload: Atom<D>;
  // 业务层不传 createdBy(storage 层注入)
}

/** 受控 override —— 仅 src/storage/migrations/ 内部使用,业务层禁止调用 */
export interface PutAtomInputUnsafe<D extends AtomDomain = AtomDomain> extends PutAtomInput<D> {
  unsafeOverride?: {
    createdAt?: number;
    createdBy?: string;
  };
}

export interface AtomFilter {
  domain?: AtomDomain;
  createdBy?: string;
  createdAtRange?: { from?: number; to?: number };
  updatedAtRange?: { from?: number; to?: number };
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'updatedAt';
  orderDirection?: 'asc' | 'desc';
}

export interface PutEdgeInput {
  id?: string;
  predicate: EdgePredicate;
  subject: AtomRef;
  object: EdgeEndpoint;
  attrs: EdgeAttrs;
}

export interface EdgeFilter {
  predicate?: EdgePredicate;
  source?: 'user' | 'ai' | 'sys';
  vocabulary?: string;
  subjectAtomId?: string;
  objectAtomId?: string;
  createdAtRange?: { from?: number; to?: number };
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'updatedAt';
  orderDirection?: 'asc' | 'desc';
}

export interface SubgraphQuery {
  rootAtomIds?: string[];
  namespace?: { source?: string; vocabulary?: string };
  depth?: number;
  direction?: 'outgoing' | 'incoming' | 'both';
  edgePredicates?: EdgePredicate[];
  atomDomains?: AtomDomain[];
}

export interface SubgraphResult {
  atoms: AtomEntity[];
  edges: EdgeEntity[];
}

export interface StorageTransaction {
  getAtom: StorageAPI['getAtom'];
  putAtom: StorageAPI['putAtom'];
  deleteAtom: StorageAPI['deleteAtom'];
  getEdge: StorageAPI['getEdge'];
  putEdge: StorageAPI['putEdge'];
  deleteEdge: StorageAPI['deleteEdge'];
}
```

### 3.4 SurrealDB schema 初始化（`src/storage/surreal/schema.ts`）

按 [`surreal-schema.md`](../surreal-schema.md) §2-§3 完整实施。简要：

```ts
import type { Surreal } from 'surrealdb';

const SCHEMA_VERSION_1_0_0 = `
-- atom 表
DEFINE TABLE atom SCHEMAFULL;
DEFINE FIELD id ON atom TYPE string ASSERT $value != NONE;
DEFINE FIELD createdAt ON atom TYPE number ASSERT $value > 0;
DEFINE FIELD updatedAt ON atom TYPE number ASSERT $value >= createdAt;
DEFINE FIELD createdBy ON atom TYPE string ASSERT $value != "";
DEFINE FIELD payload ON atom TYPE object ASSERT $value != NONE;
DEFINE FIELD payload.domain ON atom TYPE string
  ASSERT string::matches($value, '^[a-z][a-z0-9-]*$');
DEFINE FIELD payload.payload ON atom TYPE any;

-- atom 索引
DEFINE INDEX atom_domain ON atom FIELDS payload.domain;
DEFINE INDEX atom_createdBy ON atom FIELDS createdBy;
DEFINE INDEX atom_createdAt ON atom FIELDS createdAt;
DEFINE INDEX atom_updatedAt ON atom FIELDS updatedAt;

-- edge 表
DEFINE TABLE edge SCHEMAFULL;
DEFINE FIELD id ON edge TYPE string ASSERT $value != NONE;
DEFINE FIELD createdAt ON edge TYPE number ASSERT $value > 0;
DEFINE FIELD updatedAt ON edge TYPE number ASSERT $value >= createdAt;
DEFINE FIELD predicate ON edge TYPE string
  ASSERT string::matches($value, '^(user|ai|sys):([a-z][a-zA-Z0-9-]*:)?[a-z][a-zA-Z0-9]*$');
DEFINE FIELD subject ON edge TYPE object;
DEFINE FIELD subject.kind ON edge TYPE string ASSERT $value = 'atom';
DEFINE FIELD subject.atomId ON edge TYPE string;
DEFINE FIELD object ON edge TYPE object;
DEFINE FIELD object.kind ON edge TYPE string ASSERT $value INSIDE ['atom', 'literal'];
DEFINE FIELD object.atomId ON edge TYPE option<string>;
DEFINE FIELD object.type ON edge TYPE option<string>;
DEFINE FIELD object.value ON edge TYPE any;
DEFINE FIELD attrs ON edge TYPE object;
DEFINE FIELD attrs.createdBy ON edge TYPE string ASSERT $value != "";
DEFINE FIELD attrs.createdAt ON edge TYPE number;
DEFINE FIELD attrs.confidence ON edge TYPE option<number> ASSERT $value >= 0 AND $value <= 1;
DEFINE FIELD attrs.confirmedAt ON edge TYPE option<number>;
DEFINE FIELD attrs.confirmedBy ON edge TYPE option<string>;
DEFINE FIELD attrs.rejectedAt ON edge TYPE option<number>;
DEFINE FIELD attrs.rejectedBy ON edge TYPE option<string>;
DEFINE FIELD attrs.comment ON edge TYPE option<string>;

-- edge 索引
DEFINE INDEX edge_predicate ON edge FIELDS predicate;
DEFINE INDEX edge_subject ON edge FIELDS subject.atomId;
DEFINE INDEX edge_object ON edge FIELDS object.atomId WHERE object.kind = 'atom';
DEFINE INDEX edge_createdAt ON edge FIELDS createdAt;
DEFINE INDEX edge_createdBy ON edge FIELDS attrs.createdBy;
DEFINE INDEX edge_subject_predicate ON edge FIELDS subject.atomId, predicate;

-- schema_version 表
DEFINE TABLE schema_version SCHEMAFULL;
DEFINE FIELD version ON schema_version TYPE string;
DEFINE FIELD appliedAt ON schema_version TYPE number;
DEFINE FIELD description ON schema_version TYPE string;
DEFINE INDEX schema_version_unique ON schema_version FIELDS version UNIQUE;
`;

export async function initSchema(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_0_0);

  // 记录版本
  await db.query(`
    CREATE schema_version SET
      version = '1.0.0',
      appliedAt = $now,
      description = 'Initial schema (Phase 3d / sub-phase 1)'
  `, { now: Date.now() });
}
```

注：本 sub-phase **不实施** EVENT 触发器（[surreal-schema.md §4.2](../surreal-schema.md) cascade delete）—— 留到 sub-phase 2 业务接入时验证 EM6 后实施（按 Embedded 模式是否支持决议）。

---

## 4. 受影响的代码清单

### 4.1 新建文件（核心）

| 文件 | 用途 |
|---|---|
| `src/semantic/types/atom.ts` | Atom + AtomDomain + AtomPayloadOf + 4 个 domain payload + Mark |
| `src/semantic/types/atom-entity.ts` | AtomEntity 接口 |
| `src/semantic/types/edge.ts` | Edge + EdgePredicate + AtomRef + LiteralValue + EdgeAttrs |
| `src/semantic/types/edge-entity.ts` | EdgeEntity 接口 |
| `src/semantic/types/index.ts` | re-export 4 个 types |
| `src/semantic/index.ts` | re-export types |
| `src/storage/api.ts` | StorageAPI interface + 完整类型 |
| `src/storage/ulid.ts` | ULID id 生成（uppercase + monotonic） |
| `src/storage/surreal/client.ts` | SurrealDB 客户端（Embedded 优先 / Sidecar fallback） |
| `src/storage/surreal/schema.ts` | schema 初始化 SQL |
| `src/storage/surreal/storage.ts` | SurrealStorage 类（实现 StorageAPI） |
| `src/storage/surreal/index.ts` | 导出 SurrealStorage |
| `src/storage/migrations/runner.ts` | schema migration runner |
| `src/storage/index.ts` | storage 单例 + StorageAPI re-export |

### 4.2 更新文件

| 文件 | 改动 |
|---|---|
| `src/storage/README.md` | 当前是占位 README，更新为本 sub-phase 实施完成的概览 |
| `src/semantic/README.md` | 同上 |
| `package.json` | 加 dependencies: `surrealdb` 包 + `ulid` 包（具体版本号见 §5.1） |
| `tsconfig.json` | 如有 paths alias 需要（如 `@/semantic` / `@/storage`），加上 |

### 4.3 不动的文件

- `src/views/**` —— view 层（按 decision 008 §4.0 调用边界规则，view 禁止 import @/storage）
- `src/capabilities/**` —— capability 层（本 sub-phase 不接 capability）
- 所有 V2 现有业务 store（noteStore / folderStore / 等）—— 保留 9 store 现状
- `src/platform/main/` —— main 进程现有代码（仅启动时由 platform/main/index.ts 初始化 storage，详 §5.7）

### 4.4 不能动的文件

- V1 仓库任何文件
- main 分支已 commit 的 docs/

---

## 5. 实施步骤（按顺序执行 + 每步 commit）

每完成一步**立刻 commit**，commit message 用 `feat(L7-sub1-surreal-infrastructure step X.Y): <step name>` 格式。

### Step 5.1 — 创建分支 + 起点验证

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
git checkout main
git pull origin main   # 拉到最新
git checkout -b feature/L7-sub1-surreal-infrastructure main
git branch --show-current   # 确认在新分支

# 验证起点
npm install     # 拉所有依赖
npx tsc --noEmit  # 确认 typecheck 起点通过
npx eslint src/  # lint 起点通过
```

**起点判据**：typecheck + eslint 起点通过（不需要跑 npm start，那是 Electron 长进程）。

**commit**: 无（仅准备分支）

### Step 5.2 — 加 npm 依赖

```bash
# 注：surrealdb 包名是 'surrealdb'（V1 仓库用的是这个）
# Embedded 模式包名可能是 'surrealdb' 或 'surrealdb-wasm' 或别的，
# 实施者需先到 npm 实际查询确认 SurrealDB 2.x stable 版本和 embedded 包

npm install surrealdb           # ← 实施者需先 verify 实际包名 / 版本
npm install ulid                # ULID 包
```

**待实施者 verify** 的关键点：

- SurrealDB Embedded 模式 npm 包名（可能是 `@surrealdb/embedded` / `surrealdb-wasm` / `surrealdb` + 选项参数 / 等）
- 如不确定，**停下来汇报**，等设计师确认后再继续
- `ulid` 包是事实标准（github.com/ulid/javascript），直接装即可

**commit**: `feat(L7-sub1-surreal-infrastructure step 5.2): add surrealdb + ulid dependencies`

### Step 5.3 — 实施 `src/semantic/types/`

按 [§3.2 关键 TS 类型定义](#32-关键-ts-类型定义) 实施 5 个文件：

- `src/semantic/types/atom.ts`
- `src/semantic/types/atom-entity.ts`
- `src/semantic/types/edge.ts`
- `src/semantic/types/edge-entity.ts`
- `src/semantic/types/index.ts`（re-export）

`src/semantic/index.ts`：

```ts
export * from './types';
```

**验证**：`npx tsc --noEmit` 通过（types-only 改动，不应该影响现有代码）。

**commit**: `feat(L7-sub1-surreal-infrastructure step 5.3): src/semantic/types/ atom + edge 类型定义`

### Step 5.4 — 实施 `src/storage/ulid.ts`

```ts
/**
 * V2 ULID id 生成
 * 按 docs/RefactorV2/data-model/persistence/decisions/006-id-generation.md
 */
import { ulid, monotonicFactory } from 'ulid';

// monotonic factory 保证同毫秒批量插入严格单调
const generateMonotonicUlid = monotonicFactory();

/**
 * 生成 ULID
 * - uppercase (ULID 官方规范)
 * - monotonic (同毫秒批量插入严格单调)
 * - 26 字符 Crockford Base32
 */
export function generateUlid(): string {
  return generateMonotonicUlid();
}

/** 给定时间戳生成 ULID(测试 / 迁移用) */
export function generateUlidAt(timestamp: number): string {
  return ulid(timestamp);
}
```

**commit**: `feat(L7-sub1-surreal-infrastructure step 5.4): src/storage/ulid.ts`

### Step 5.5 — 实施 `src/storage/api.ts`

按 [§3.3 StorageAPI 接口](#33-storageapi-接口-srcstorageapits) 实施完整 interface + 所有相关类型定义。

**验证**：`npx tsc --noEmit` 通过。

**commit**: `feat(L7-sub1-surreal-infrastructure step 5.5): src/storage/api.ts StorageAPI 接口`

### Step 5.6 — 实施 SurrealDB 客户端 + schema

#### 5.6a 实施 `src/storage/surreal/schema.ts`

按 [§3.4 SurrealDB schema 初始化](#34-surrealdb-schema-初始化-srcstoragesurrealschemats) 实施。

#### 5.6b 实施 `src/storage/surreal/client.ts`

**Embedded 优先 + Sidecar fallback** 双模式实施：

```ts
import { app } from 'electron';
import path from 'node:path';
// ↓ 实施者根据 step 5.2 verify 的实际包名调整
import { Surreal } from 'surrealdb';

const NAMESPACE = 'krig';
const DATABASE = 'krig_note_v2';

let db: Surreal | null = null;
let mode: 'embedded' | 'sidecar' | null = null;

export async function initSurrealDB(): Promise<void> {
  // 优先尝试 Embedded
  try {
    db = await initEmbedded();
    mode = 'embedded';
    console.log('[storage/surreal] Embedded mode started');
  } catch (err) {
    console.warn('[storage/surreal] Embedded mode failed, fallback to Sidecar:', err);
    db = await initSidecar();
    mode = 'sidecar';
    console.log('[storage/surreal] Sidecar mode started');
  }
}

async function initEmbedded(): Promise<Surreal> {
  // TODO: 实施者按 step 5.2 verify 的 Embedded 包 API 实施
  // 关键: 使用 file:// 或 mem:// 或 surrealkv:// 协议(取决于包版本)
  const dataDir = path.join(app.getPath('userData'), 'krig-data', 'surreal');
  // ... 实施细节由实施者填(参考 SurrealDB 2.x 官方文档)
  throw new Error('Embedded init not implemented yet');  // 占位,实施者替换
}

async function initSidecar(): Promise<Surreal> {
  // 参考 V1 src/main/storage/client.ts (Sidecar 模式完整实施)
  // V1 已踩过孤儿进程坑,直搬 V1 防御性启动逻辑
  // 详 memory project_surreal_defensive_startup
  throw new Error('Sidecar init not implemented yet');  // 占位,实施者填
}

export function getDB(): Surreal {
  if (!db) throw new Error('SurrealDB not initialized; call initSurrealDB() first');
  return db;
}

export function getMode(): 'embedded' | 'sidecar' | null {
  return mode;
}

export async function shutdownSurrealDB(): Promise<void> {
  if (!db) return;
  await db.close();
  // 如 Sidecar 模式,还需要 kill 子进程 + 孤儿清理(参考 V1)
  db = null;
  mode = null;
}
```

**实施细节由实施者按 SurrealDB 2.x 文档 + V1 client.ts 参考填**。

#### 5.6c 实施 `src/storage/surreal/index.ts`

```ts
export { initSurrealDB, getDB, getMode, shutdownSurrealDB } from './client';
export { initSchema } from './schema';
```

**commit**: `feat(L7-sub1-surreal-infrastructure step 5.6): src/storage/surreal/ client + schema (Embedded 优先 / Sidecar fallback)`

### Step 5.7 — 实施 `src/storage/surreal/storage.ts` SurrealStorage 类

实施 `StorageAPI` 接口的 SurrealDB 实现。核心方法（其余按接口类似实施）：

```ts
import type { StorageAPI, ... } from '../api';
import type { AtomEntity, EdgeEntity, ... } from '@/semantic/types';
import { getDB } from './client';
import { generateUlid } from '../ulid';

class SurrealStorage implements StorageAPI {
  // ── atom CRUD ──

  async getAtom<D extends AtomDomain = AtomDomain>(
    id: string,
    options?: StorageOptions,
  ): Promise<AtomEntity<D> | null> {
    const db = getDB();
    const result = await db.query<[AtomEntity<D>[]]>(
      `SELECT * FROM atom WHERE id = $id LIMIT 1`,
      { id },
    );
    return result[0]?.[0] ?? null;
  }

  async putAtom<D extends AtomDomain = AtomDomain>(
    input: PutAtomInput<D>,
    options?: StorageOptions,
  ): Promise<AtomEntity<D>> {
    const db = getDB();
    const now = Date.now();
    const ownerId = options?.ownerId ?? 'user-default';

    if (input.id) {
      // 更新
      const result = await db.query<[AtomEntity<D>[]]>(
        `UPDATE atom SET payload = $payload, updatedAt = $now WHERE id = $id RETURN AFTER`,
        { id: input.id, payload: input.payload, now },
      );
      const updated = result[0]?.[0];
      if (!updated) throw new Error(`Atom ${input.id} not found`);
      return updated;
    } else {
      // 创建
      const id = generateUlid();
      await db.query(
        `CREATE atom SET id = $id, createdAt = $now, updatedAt = $now,
                         createdBy = $ownerId, payload = $payload`,
        { id, now, ownerId, payload: input.payload },
      );
      return {
        id,
        createdAt: now,
        updatedAt: now,
        createdBy: ownerId,
        payload: input.payload,
      };
    }
  }

  // ... listAtoms / deleteAtom / edge CRUD / querySubgraph / transaction / health
  // 详按 decision 008 实施
}

export const surrealStorage: StorageAPI = new SurrealStorage();
```

**实施重点**：

- 所有 CRUD 方法对应 SurrealQL 实施（按 [surreal-schema.md §5](../surreal-schema.md) 查询示例）
- ~~`transaction` 用 SurrealDB BEGIN/COMMIT~~ ⚠ **sub-phase 2 集成测试暴露失效**(2026-05-12):
  - SurrealDB Sidecar WebSocket 协议下 BEGIN/COMMIT 必须聚合在单段 SQL 内,跨 `db.query()` 拆开会让 BEGIN 被立即隐式提交,后续 COMMIT 报 `Cannot COMMIT without starting a transaction`
  - X3a 修复(commit `7d828a6`): `transaction(fn)` 退化为直调 fn,**无真原子性**
  - sub-phase 1 audit 未暴露:测试路径仅走 putAtom/deleteAtom 单语句,从未真用 transaction
  - 这正是本决议 §4.2 "binary 验证风险条款" 命中,sub-phase 1 设计师纸上推演遗漏
  - Open Question Q-tx 留 sub-phase 3+ 评估 SDK 原生 transaction API 或应用层补偿
- `querySubgraph` 按 [surreal-schema.md §5.3 方案 A 应用层 BFS](../surreal-schema.md) 实施
- 写入边时校验 subject / object atomId 存在（[decision 008 §5.2](008-storage-layer-interface.md)）

**commit**: `feat(L7-sub1-surreal-infrastructure step 5.7): src/storage/surreal/storage.ts SurrealStorage`

### Step 5.8 — 实施 `src/storage/migrations/runner.ts`

```ts
import type { Surreal } from 'surrealdb';
import { initSchema } from '../surreal/schema';

interface Migration {
  version: string;
  description: string;
  up: (db: Surreal) => Promise<void>;
}

const MIGRATIONS: Migration[] = [
  {
    version: '1.0.0',
    description: 'Initial schema (Phase 3d / sub-phase 1)',
    up: initSchema,
  },
  // 未来 migrations 按序追加
];

export async function runMigrations(db: Surreal): Promise<void> {
  // 读 schema_version 表当前版本
  const versionRes = await db.query<[{ version: string }[]]>(
    `SELECT version FROM schema_version ORDER BY appliedAt DESC LIMIT 1`,
  );
  const currentVersion = versionRes[0]?.[0]?.version ?? '0.0.0';

  for (const mig of MIGRATIONS) {
    if (compareVersions(currentVersion, mig.version) < 0) {
      console.log(`[storage/migrations] applying ${mig.version}: ${mig.description}`);
      await mig.up(db);
    }
  }
}

function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((aParts[i] ?? 0) !== (bParts[i] ?? 0)) {
      return (aParts[i] ?? 0) - (bParts[i] ?? 0);
    }
  }
  return 0;
}
```

**commit**: `feat(L7-sub1-surreal-infrastructure step 5.8): src/storage/migrations/runner.ts`

### Step 5.9 — 实施 `src/storage/index.ts` 主入口

```ts
import { initSurrealDB, shutdownSurrealDB, getDB } from './surreal/client';
import { runMigrations } from './migrations/runner';
import { surrealStorage } from './surreal/storage';

export type { StorageAPI, StorageOptions, PutAtomInput, AtomFilter, PutEdgeInput, EdgeFilter, SubgraphQuery, SubgraphResult, StorageTransaction } from './api';

export const storage = surrealStorage;

export async function initStorage(): Promise<void> {
  await initSurrealDB();
  await runMigrations(getDB());
  console.log('[storage] initialized');
}

export async function shutdownStorage(): Promise<void> {
  await shutdownSurrealDB();
}
```

**commit**: `feat(L7-sub1-surreal-infrastructure step 5.9): src/storage/index.ts storage 单例 + initStorage`

### Step 5.10 — 在 main 进程启动时初始化 storage

修改 `src/platform/main/index.ts`（或对应启动入口），在 Electron app ready 后调用 `initStorage()`：

```ts
// 在适当位置(app.whenReady().then(...) 内)加:
import { initStorage, shutdownStorage } from '@/storage';

app.whenReady().then(async () => {
  await initStorage();   // ← 加这行
  // ... 现有窗口创建代码
});

app.on('before-quit', async () => {
  await shutdownStorage();  // ← 加这行
});
```

**注意**：本步骤是**仅在 main 进程**调用 storage 的初始化。renderer 进程不直接 import storage（按 decision 008 §4.0 调用边界）。

**commit**: `feat(L7-sub1-surreal-infrastructure step 5.10): main 进程启动接入 storage init/shutdown`

### Step 5.11 — typecheck + lint

```bash
npx tsc --noEmit
npx eslint src/
```

修复任何报错。

**commit**: `chore(L7-sub1-surreal-infrastructure step 5.11): typecheck + lint pass`

### Step 5.12 — npm start 集成验证（EM1-EM4 硬门槛）

按 [decision 007 §4.2.1](007-storage-target.md) EM 硬门槛验证：

```bash
npm start
```

观察 console，记录：

| EM 编号 | 验证 | 期望 |
|---|---|---|
| EM1 | npm install / package 安装是否成功 | ✓ 已在 step 5.2 验证 |
| EM2 | 冷启动失败率（连续跑 3 次 npm start） | ≤ 0 次失败 |
| EM3 | 冷启动时延（从 app.whenReady 到 storage initialized 日志） | < 3 秒 |
| EM4 | 首次写入 + 读取一致性测试（见下方测试代码） | 数据一致 |

#### EM4 一致性测试

在 storage initialized 之后插入诊断代码（或单独写脚本）：

```ts
// 临时诊断,在 main 进程 storage init 后调用
async function diagnostic() {
  // 写一个测试 atom
  const written = await storage.putAtom({
    payload: {
      domain: 'pm',
      payload: { type: 'paragraph', content: [{ type: 'text', text: 'test' }] },
    },
  });
  console.log('[diagnostic] atom written:', written.id);

  // 立即读取
  const read = await storage.getAtom(written.id);
  console.log('[diagnostic] atom read:', read?.id);

  // 验证一致性
  if (read?.id === written.id && read?.payload.payload.text === 'test') {
    console.log('[diagnostic] EM4 ✓ consistency check passed');
  } else {
    console.error('[diagnostic] EM4 ✗ consistency check FAILED');
  }
}
```

诊断完成后**删除这段代码**（不留 production），仅日志告知 EM 验证结果。

**commit**: `chore(L7-sub1-surreal-infrastructure step 5.12): EM1-EM4 硬门槛验证通过`

**如 EM1-EM4 任一失败**：停下汇报，等设计师确认是否切 Sidecar 模式。

### Step 5.13 — 更新 README.md

更新 `src/storage/README.md` 和 `src/semantic/README.md` 反映本 sub-phase 完成状态：

```markdown
# src/storage/

V2 持久化层。详 [`docs/RefactorV2/data-model/persistence/`](../../docs/RefactorV2/data-model/persistence/) 完整规范。

## 实施状态（Phase N sub-phase 1 完成）

- ✓ StorageAPI 接口（`src/storage/api.ts`）
- ✓ ULID id 生成（`src/storage/ulid.ts`）
- ✓ SurrealDB 客户端（Embedded 优先 / Sidecar fallback）
- ✓ SurrealDB schema 初始化（atom + edge + schema_version 三表）
- ✓ schema migration runner
- ✓ Main 进程启动接入

## 下一步（sub-phase 2-4）

- sub-phase 2: noteStore + folderStore 迁移
- sub-phase 3: graphStore + ebookStore + annotationStore
- sub-phase 4: 剩余 store

## 调用边界

按 [decision 008 §4.0](../../docs/RefactorV2/data-model/persistence/decisions/008-storage-layer-interface.md):

- **View 层禁止**直接 import @/storage
- **Capability 层 / Platform 层**可 import
- 业务层通过 capability API 间接访问
```

**commit**: `docs(L7-sub1-surreal-infrastructure step 5.13): 更新 src/storage 和 src/semantic README`

### Step 5.14 — 完成报告

完成所有 step 后，发消息：

```
L7-sub1-surreal-infrastructure 实施完成请审计

分支: feature/L7-sub1-surreal-infrastructure
共 X commits (X 为实际数,预计 11-13 个)

测试报告:
- typecheck: ✓ pass
- eslint: ✓ pass (允许 1 pre-existing warning,与本任务无关)
- EM1 包安装: ✓
- EM2 冷启动稳定性 (3 次): ✓
- EM3 冷启动时延: X 秒 (< 3 秒判据)
- EM4 写入读取一致性: ✓ 或 ✗ (附 console 输出)

实施模式: Embedded / Sidecar (实际)
未实施部分:
- EVENT 触发器 cascade delete (按 surreal-schema §4.2 留 sub-phase 2 验证 EM6 后实施)
- 全文索引 (留 sub-phase N 视真实需求实施)

等审计师批复后下一步动作。
```

**不要**：
- 不要合并到 main
- 不要继续做其他事（包括"顺便"接入 noteStore 或其他业务 store）
- 不要写新功能
- 不要改数据建模文档

---

## 6. 测试清单（实施完成判据）

每项必须**实际验证**报告"通过 / 失败 + 现象"。

### 6.1 静态检查

| 序号 | 操作 | 期望 |
|---|---|---|
| 6.1.1 | `npx tsc --noEmit` | 0 errors |
| 6.1.2 | `npx eslint src/` | 0 errors（允许 1 pre-existing warning） |

### 6.2 npm 包安装

| 序号 | 操作 | 期望 |
|---|---|---|
| 6.2.1 | `npm install` 完整跑 | 成功，无 native binding 编译错误 |
| 6.2.2 | `package.json` 含 `surrealdb` + `ulid` | ✓ |

### 6.3 SurrealDB 启动（EM1-EM3）

| 序号 | 操作 | 期望 |
|---|---|---|
| 6.3.1 | `npm start` 启动 V2 应用 | 进程跑起来，主窗口出现 |
| 6.3.2 | console 看 `[storage]` 日志 | 出现 `[storage/surreal] Embedded mode started` 或 fallback Sidecar |
| 6.3.3 | 关闭应用 + 重启 3 次 | 每次都成功（EM2 冷启动稳定性） |
| 6.3.4 | 测量冷启动时延（app.whenReady → storage initialized 日志） | < 3 秒（EM3） |

### 6.4 EM4 写入读取一致性

| 序号 | 操作 | 期望 |
|---|---|---|
| 6.4.1 | 跑 §5.12 诊断代码 | console 出现 `EM4 ✓ consistency check passed` |
| 6.4.2 | 关闭应用 + 重启 | atom 数据保留（持久化生效） |

### 6.5 typecheck / lint clean

| 序号 | 操作 | 期望 |
|---|---|---|
| 6.5.1 | 完整跑 typecheck + lint | clean（除 pre-existing warning） |

### 6.6 grep 反向验证

| 序号 | 操作 | 期望 |
|---|---|---|
| 6.6.1 | `grep -rn "@/storage" src/views/` | **0 处**（view 层不允许 import storage） |
| 6.6.2 | `grep -rn "from 'surrealdb'" src/` | 仅在 `src/storage/surreal/` 内（npm 屏障原则） |
| 6.6.3 | `grep -rn "from 'ulid'" src/` | 仅在 `src/storage/ulid.ts` 内 |

### 6.7 业务 store 不动验证

| 序号 | 操作 | 期望 |
|---|---|---|
| 6.7.1 | V2 应用打开后新建笔记 / 编辑 / 等业务功能 | 跟改造前完全一致（业务 store 没动） |
| 6.7.2 | grep noteStore / graphStore / etc 是否被修改 | 未修改 |

### 6.8 测试报告模板

实施完成后，按以下模板报告：

```markdown
## L7-sub1-surreal-infrastructure 测试报告

### 静态检查
- 6.1.1 typecheck: ✓ / ✗
- 6.1.2 eslint: ✓ / ✗（X 个 pre-existing warning）

### npm 包
- 6.2.1 npm install: ✓ / ✗
- 6.2.2 surrealdb 版本: <实际版本>; ulid 版本: <实际版本>

### SurrealDB 启动
- 6.3.1 npm start: ✓
- 6.3.2 实施模式: Embedded / Sidecar
- 6.3.3 3 次冷启动: ✓ / ✗
- 6.3.4 冷启动时延: X 秒（< 3 秒判据）

### EM4 一致性
- 6.4.1 写入读取一致: ✓ / ✗
- 6.4.2 重启数据保留: ✓ / ✗

### 反向验证
- 6.6.1 view 不 import storage: ✓
- 6.6.2 surrealdb 仅 storage/surreal 内: ✓
- 6.6.3 ulid 仅 storage/ulid 内: ✓

### 业务功能
- 6.7.1 业务功能正常: ✓
- 6.7.2 业务 store 未修改: ✓

### 总结
- 通过 / N 项失败
- commit 数: M
- 分支: feature/L7-sub1-surreal-infrastructure
```

---

## 7. 审计验收标准（审计师执行）

审计师（本对话）收到完成通知后执行：

### 7.1 代码合规审计

1. `git log --oneline feature/L7-sub1-surreal-infrastructure` 查看 commit 序列
2. `grep -rn "@/storage" src/views/` 应为 0 处
3. `grep -rn "from 'surrealdb'" src/` 应仅在 `src/storage/surreal/` 内
4. `git diff main..feature/L7-sub1-surreal-infrastructure -- 'src/views/'` 应无 view 层改动
5. 业务 store 文件（noteStore / folderStore / 等）未被本分支修改

### 7.2 实施细节审计

阅读：
- `src/semantic/types/atom.ts` —— 与 §3.2 一致
- `src/semantic/types/edge.ts` —— `subject: AtomRef` 而不是 `EdgeEndpoint`
- `src/storage/api.ts` —— 与 §3.3 一致
- `src/storage/surreal/schema.ts` —— 与 §3.4 一致
- `src/storage/ulid.ts` —— monotonic ULID

允许的差异：注释 / 风格调整 / SurrealDB 包名实际验证后的调整（如 Embedded 包名）。

### 7.3 行为审计

启动应用，跑 §6 测试清单关键项（至少 6.3 / 6.4）。

### 7.4 不通过场景

- 任何 §6 测试失败 / §7.1 §7.2 §7.3 偏差 → 列问题清单返回实施者
- 实施者继续修 + 重新 commit → 修完再审

### 7.5 通过后流程

审计通过 → 本对话执行：

1. `git checkout main && git merge feature/L7-sub1-surreal-infrastructure --no-ff` （需用户授权后）
2. 准备 sub-phase 2 设计文档（noteStore + folderStore 迁移）

---

## 8. Open Questions（实施期间可能遇到）

| 编号 | 问题 | 应对 |
|---|---|---|
| Q1 | SurrealDB Embedded 实际包名（`surrealdb` / `@surrealdb/embedded` / `surrealdb-wasm` / 等） | step 5.2 实施者先 verify npm 包，不确定停下汇报 |
| Q2 | Embedded 模式数据目录协议（`file://` / `surrealkv://` / 等） | 按 SurrealDB 2.x 官方文档；不确定汇报 |
| Q3 | EM1-EM4 任一失败 | 停下汇报，等设计师决议切 Sidecar / 调整 |
| Q4 | typecheck 报错涉及现有代码 | 不要改现有代码，调整新代码避开（如加 `// eslint-disable-next-line` 是临时手段） |
| Q5 | SurrealDB SCHEMAFULL ASSERT 在 Embedded 模式不支持某语法 | 降级到 SCHEMALESS + 应用层校验，作为 EM6 触发标记 |
| Q6 | EVENT 触发器在 Embedded 模式不支持（cascade delete） | 本 sub-phase 不实施 EVENT（按 §3.4 注），sub-phase 2 业务接入时再决议 |

实施期间发现新问题 → 停下来等设计师补充。

---

## 9. 决议链（设计师写给审计师 + 实施者的备忘）

### 9.1 与数据建模规范的关系

本 sub-phase 是 **Phase N 实施 Phase 的第一步**，承接 Phase 3 RFC 已转正规范：

- [`decisions/006-id-generation`](006-id-generation.md) → ULID 实施（step 5.4）
- [`decisions/007-storage-target`](007-storage-target.md) → SurrealDB Embedded + Sidecar fallback（step 5.6）+ EM1-EM6 验证（step 5.12）
- [`decisions/008-storage-layer-interface`](008-storage-layer-interface.md) → StorageAPI 接口（step 5.5）+ 调用边界（step 5.10 + §6.6 验证）
- [`decisions/009-migration-strategy`](009-migration-strategy.md) → sub-phase 1 范围（本文档 §1）
- [`decisions/010-multi-user-multi-device`](010-multi-user-multi-device.md) → 路径 B 最小预留（StorageOptions.ownerId step 5.5 实施）
- [`atom-entity.md`](../atom-entity.md) → AtomEntity 类型（step 5.3）
- [`edge-entity.md`](../edge-entity.md) → EdgeEntity 类型（step 5.3）
- [`surreal-schema.md`](../surreal-schema.md) → schema 初始化（step 5.6）

### 9.2 不在本 sub-phase 范围

- ❌ 业务 store 迁移（noteStore / folderStore / 等）—— sub-phase 2-4
- ❌ EVENT 触发器 cascade delete —— 等 EM6 验证后 sub-phase 2 实施
- ❌ 全文索引 —— 视真实需求 Phase N 实施
- ❌ 物化视图 —— 视真实需求 Phase N 实施
- ❌ 监控 / 灰度发布机制 —— 真实用户期再决议

---

## 10. 完成后的反向更新清单（设计师审计通过后做）

审计通过 + 合 main 后，本对话执行：

| 文件 | 改动 |
|---|---|
| `decisions/009-migration-strategy.md` | §3.1 sub-phase 1 标 ✓ 已完成 + commit hash |
| `decisions/010-multi-user-multi-device.md` | §2 预留 3 ownerId 状态从"代码层未实施"改"已部分实施（接口签名落地，运行时仍仅 user-default）" |
| `decisions/007-storage-target.md` | §4.2.1 EM1-EM4 验证结果记录 |
| 顶层 `data-model/README.md` | Phase N sub-phase 1 完成记录 |

新增 commit: `docs(L7-sub1-surreal-infrastructure): 反向更新规范文档对齐 sub-phase 1 实施`。

---

## 11. 风险与回滚

### 11.1 风险清单

| 风险 | 概率 | 影响 |
|---|---|---|
| SurrealDB Embedded 模式包不可用（EM1） | 中 | 直接切 Sidecar，已有 V1 完整实施可参考 |
| EM3 冷启动 > 3 秒 | 低 | 索引优化 / 切 Sidecar |
| EM4 一致性失败 | 低 | 严重问题，停下排查 |
| schema migration runner 跑失败 | 低 | schema 初始化是幂等的（CREATE IF NOT EXISTS） |
| typecheck 跨模块影响（如 @/semantic 跟现有类型冲突） | 低 | 新代码 namespaces 独立，影响范围小 |
| view 层意外 import storage | 极低 | grep 自检 + 未来加 ESLint 规则 |

### 11.2 回滚

如改造严重出问题：

```bash
git checkout main
git branch -D feature/L7-sub1-surreal-infrastructure
# 删 npm 加的依赖(如本地 node_modules 不影响,package.json 改回去即可)
git checkout main -- package.json package-lock.json
npm install
```

main 不受影响。

### 11.3 不允许的回滚

- 不允许 `git push --force` main
- 不允许 `git reset --hard` 本分支以外的任何分支

---

## 附录 A — 与设计师对话的关键节点

| 节点 | 实施者动作 |
|---|---|
| 实施开始 | 创建分支 + 起点验证，发"开始实施" |
| Step 5.2 SurrealDB Embedded 包名不确定 | 停下来发"设计师，SurrealDB Embedded 包名 verify：[查询结果]，是否用 X？" |
| 实施期间发现文档遗漏 | 停下来发"设计师，§X.Y 有歧义：[问题]"，等设计师回复 |
| Step 5.12 EM 验证失败 | 停下来发"EM<N> 验证失败：[现象]"，等设计师决议切 Sidecar / 调整 |
| Step 5.13 完成 | 发"L7-sub1-surreal-infrastructure 实施完成请审计" + §6.8 测试报告全文 |
| 审计不通过 | 收设计师问题清单 → 修复 → 再 commit → 再发 "重新请审计" |
| 审计通过 | 等设计师合并 main + 反向更新规范文档 |

---

*Decision 011 完整版结束。预估实施工程量 3-5 天（含 EM 验证）。*
