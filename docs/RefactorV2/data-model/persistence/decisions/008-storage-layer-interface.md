# Decision 008 — StorageAPI 接口设计

> **Phase**: 3c
> **状态**: 📝 **RFC 提议**（待用户拍板）
> **影响**: `persistence/spec.md` + `persistence/edge-entity.md` + 未来 V2 storage 层实施

---

## 0. 决议背景

按 [`persistence/spec.md §3`](../spec.md) 后端中立性原则 —— V2 实体 schema 不绑死任何具体后端。本决议定义 **StorageAPI 抽象接口**，作为 atom / edge 数据的统一存取契约。

不同后端（SurrealDB / SQLite / JSON）通过实现这同一接口替换，上层（capability / view）零感知。

## 1. 设计原则

### 1.1 后端无关

StorageAPI 接口本身**不依赖任何后端 API**（不出现 SurrealQL / SQL / 等具体语法）。

实施方实现 `StorageAPI` 时自由选择查询语言 / 索引策略，但**对外暴露的接口契约统一**。

### 1.2 atom + edge 平行

按 [`atom/decisions/003 走法 B`](../../atom/decisions/003-naming-conventions.md) —— atom / edge 是**同级一等公民**。StorageAPI 提供两套对称操作：

- `getAtom` / `putAtom` / `listAtoms` / `deleteAtom`
- `getEdge` / `putEdge` / `listEdges` / `deleteEdge`

### 1.3 子图查询作为一等操作

走法 B 把所有非本体属性走边后，**最常见查询模式 = 子图查询**：

- 按 namespace 切片（如 `user:family-tree:%`）
- 按邻居关系（atom A 的所有出边 / 入边）
- 按 path 查询（atom A → atom B 路径）

StorageAPI 提供 `querySubgraph` 一等操作，避免上层手写多次 IO。

### 1.4 用户身份预留（路径 B 最小预留 3）

按 [`decision 010`](010-multi-user-multi-device.md) 路径 B —— 接口预留 `ownerId` 可选参数：

- **单机单用户阶段**：调用方不传 `ownerId`，storage 层用 `'user-default'` 填
- **未来引入用户**：调用方传 `ownerId: 'user-wenwu'`，storage 层按用户切片

→ 接口签名一次性预留，**实现暂不分用户**，避免未来 schema breaking change。

## 2. StorageAPI 完整接口

```ts
import type { AtomEntity, EdgeEntity, AtomDomain } from '@/semantic/types';

/**
 * V2 统一存储层抽象接口
 * 实现方: SurrealStorage / SQLiteStorage / JsonStorage / etc.
 */
export interface StorageAPI {
  // ── atom 操作 ──

  /** 读取单个 atom 实体 */
  getAtom<D extends AtomDomain = AtomDomain>(
    id: string,
    options?: StorageOptions,
  ): Promise<AtomEntity<D> | null>;

  /** 写入 atom 实体（创建 / 更新；id 不存在则创建，存在则更新 payload） */
  putAtom<D extends AtomDomain = AtomDomain>(
    atom: PutAtomInput<D>,
    options?: StorageOptions,
  ): Promise<AtomEntity<D>>;

  /** 列表查询 atom 实体（按 domain / 时间范围 / 创建者过滤） */
  listAtoms(
    filter: AtomFilter,
    options?: StorageOptions,
  ): Promise<AtomEntity[]>;

  /** 删除 atom 实体（硬删除；级联策略详 §5.1） */
  deleteAtom(
    id: string,
    options?: StorageOptions,
  ): Promise<{ deleted: boolean; cascadedEdges: number }>;

  // ── edge 操作 ──

  /** 读取单个 edge 实体 */
  getEdge(
    id: string,
    options?: StorageOptions,
  ): Promise<EdgeEntity | null>;

  /** 写入 edge 实体 */
  putEdge(
    edge: PutEdgeInput,
    options?: StorageOptions,
  ): Promise<EdgeEntity>;

  /** 列表查询 edge 实体（按 namespace / subject / object / 时间范围过滤） */
  listEdges(
    filter: EdgeFilter,
    options?: StorageOptions,
  ): Promise<EdgeEntity[]>;

  /** 删除 edge 实体 */
  deleteEdge(
    id: string,
    options?: StorageOptions,
  ): Promise<{ deleted: boolean }>;

  // ── 子图查询 ──

  /**
   * 子图查询 —— 按 namespace 切片或邻居关系返回 atom + edge 子集
   */
  querySubgraph(
    query: SubgraphQuery,
    options?: StorageOptions,
  ): Promise<SubgraphResult>;

  // ── 事务 ──

  /**
   * 事务执行 —— 原子写入多个 atom / edge
   * 用于 "创建 atom + 多条边" 场景（走法 B 物化）
   */
  transaction<T>(
    fn: (tx: StorageTransaction) => Promise<T>,
    options?: StorageOptions,
  ): Promise<T>;

  // ── 健康检查 ──

  /** 后端连接状态检查 */
  health(): Promise<{ alive: boolean; backend: string; version?: string }>;
}
```

### 2.1 通用参数：StorageOptions

```ts
export interface StorageOptions {
  /**
   * 用户身份切片（路径 B 最小预留 3）
   *
   * 不传 = 当前用户（单机单用户阶段默认 'user-default'）
   * 传 = 按指定 ownerId 切片（多用户场景，未来启用）
   */
  ownerId?: string;

  /** 超时（毫秒） */
  timeoutMs?: number;
}
```

### 2.2 atom 输入 / 过滤类型

```ts
/** 写入 atom 时的输入（实体壳字段中只需传 payload，其他由 storage 层管理） */
export interface PutAtomInput<D extends AtomDomain = AtomDomain> {
  /** 创建时不传（storage 层生成 ULID）；更新时传已有 id */
  id?: string;

  /** atom 数据 */
  payload: Atom<D>;
}

/**
 * 迁移 / 内部工具专用 —— 受控 override 入口（不暴露给业务层）
 *
 * 用途: 从 V1 数据迁移时,需要保留原 createdBy/createdAt 等元属性。
 * 调用边界: 仅 src/storage/migrations/ 内部使用,业务 capability **禁止**调用。
 *
 * 实施层面: 由独立的 StorageMigrationAPI 接口暴露 (不在 StorageAPI 中),
 *           确保 type-level 隔离。
 */
export interface PutAtomInputUnsafe<D extends AtomDomain = AtomDomain> extends PutAtomInput<D> {
  /** 受控 override —— 由迁移工具传入原始时间戳 / agentId */
  unsafeOverride?: {
    createdAt?: number;
    createdBy?: string;
  };
}

/** atom 查询过滤条件 */
export interface AtomFilter {
  /** 按 domain 过滤（如 'pm' / 'rdf' / 等） */
  domain?: AtomDomain;

  /** 按创建者 agentId 过滤 */
  createdBy?: string;

  /** 创建时间范围（Unix 毫秒） */
  createdAtRange?: { from?: number; to?: number };

  /** 修改时间范围 */
  updatedAtRange?: { from?: number; to?: number };

  /** 分页 */
  limit?: number;
  offset?: number;

  /** 排序（默认按 createdAt asc） */
  orderBy?: 'createdAt' | 'updatedAt';
  orderDirection?: 'asc' | 'desc';
}
```

### 2.3 edge 输入 / 过滤类型

```ts
/** 写入 edge 时的输入 */
export interface PutEdgeInput {
  id?: string;
  predicate: EdgePredicate;          // <source>:<vocabulary>:<edge-name>
  subject: AtomRef;
  object: EdgeEndpoint;              // AtomRef | LiteralValue
  attrs: EdgeAttrs;
}

/** edge 查询过滤条件 */
export interface EdgeFilter {
  /** 完整 predicate 匹配（如 'user:family-tree:isParentOf'） */
  predicate?: EdgePredicate;

  /** 按命名空间切片 */
  source?: 'user' | 'ai' | 'sys';
  vocabulary?: string;               // 'family-tree' / 'prov' / 'krig' / ...

  /** 按 subject / object atomId 过滤 */
  subjectAtomId?: string;
  objectAtomId?: string;

  /** 时间 / 分页 / 排序（同 AtomFilter） */
  createdAtRange?: { from?: number; to?: number };
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'updatedAt';
  orderDirection?: 'asc' | 'desc';
}
```

### 2.4 子图查询类型

```ts
/** 子图查询输入 */
export interface SubgraphQuery {
  /** 起点 atom id（可多个） */
  rootAtomIds?: string[];

  /** 限制在某命名空间下的边（如 'user:family-tree:%') */
  namespace?: { source?: string; vocabulary?: string };

  /** 邻居遍历深度（默认 1） */
  depth?: number;

  /** 方向（'outgoing' / 'incoming' / 'both'，默认 'both'） */
  direction?: 'outgoing' | 'incoming' | 'both';

  /** 边类型过滤（完整 predicate） */
  edgePredicates?: EdgePredicate[];

  /** 节点 domain 过滤 */
  atomDomains?: AtomDomain[];
}

/** 子图查询输出 */
export interface SubgraphResult {
  atoms: AtomEntity[];
  edges: EdgeEntity[];
}
```

### 2.5 事务接口

```ts
/** 事务内的简化接口（不允许嵌套事务 / 不允许 health 检查） */
export interface StorageTransaction {
  getAtom: StorageAPI['getAtom'];
  putAtom: StorageAPI['putAtom'];
  deleteAtom: StorageAPI['deleteAtom'];
  getEdge: StorageAPI['getEdge'];
  putEdge: StorageAPI['putEdge'];
  deleteEdge: StorageAPI['deleteEdge'];
}
```

**事务保证**：

- ACID 原子性（事务内所有操作要么全成功，要么全失败回滚）
- 由后端实现（SurrealDB / SQLite 都原生支持）

## 3. 接口使用示例

> ⚠ 以下示例**仅在 capability 层 / platform 层内**调用，view 层禁止直接 import StorageAPI（详 §4.0 调用边界规则）。

### 3.1 创建一个 atom + 几条边（走法 B 物化）—— capability 层实施

```ts
// src/capabilities/family-tree/operations.ts (capability 内部实施)
import { storage } from '@/storage';

// family-tree 中的一个 person
await storage.transaction(async tx => {
  // 1. 创建 three atom (几何节点)
  const personAtom = await tx.putAtom({
    payload: {
      domain: 'three',
      payload: { kind: 'node', position: { x: 100, y: 200 }, shape: 'rect' },
    },
  });

  // 2. 叠加 family-tree 语义边
  await tx.putEdge({
    predicate: 'user:family-tree:isA',
    subject: { kind: 'atom', atomId: personAtom.id },
    object: { kind: 'literal', type: 'string', value: 'person' },
    attrs: { createdBy: 'user-wenwu', createdAt: Date.now() },
  });
  await tx.putEdge({
    predicate: 'user:family-tree:hasName',
    subject: { kind: 'atom', atomId: personAtom.id },
    object: { kind: 'literal', type: 'string', value: 'Alice' },
    attrs: { createdBy: 'user-wenwu', createdAt: Date.now() },
  });
  await tx.putEdge({
    predicate: 'user:family-tree:hasBirthDate',
    subject: { kind: 'atom', atomId: personAtom.id },
    object: { kind: 'literal', type: 'date', value: '1980-01-01' },
    attrs: { createdBy: 'user-wenwu', createdAt: Date.now() },
  });
});
```

### 3.2 子图查询（family-tree 视图加载）

```ts
const familyTree = await storage.querySubgraph({
  namespace: { source: 'user', vocabulary: 'family-tree' },
  depth: 5,
});

// familyTree.atoms — 所有 family-tree person 节点
// familyTree.edges — 所有 user:family-tree:* 边
```

### 3.3 全文检索 atom

```ts
// 简单 listAtoms + 按 createdBy + 时间范围
const myRecentAtoms = await storage.listAtoms({
  createdBy: 'user-wenwu',
  createdAtRange: { from: Date.now() - 7 * 86400_000 },
  limit: 50,
  orderBy: 'createdAt',
  orderDirection: 'desc',
});
```

**注**：全文检索（基于 atom payload 内容搜索）需要后端实现 FTS。SurrealDB 内置 FTS 索引，SQLite 用 FTS5 extension。接口形态待 Phase 3d `surreal-schema.md` 落地时具体设计（可能加 `searchAtoms(query: string)` 接口）。

## 4. 调用边界与职责分配

### 4.0 调用边界规则（按 V2 charter.md §1.1-§1.2 分层 / 注册原则）

V2 数据建模严格遵守分层调用规则：

```
┌─────────────────────────────────────────────────┐
│ View 层 (src/views/)                             │
│ ✗ 禁止直接 import 或调用 StorageAPI              │
│ ✓ 通过 capability API 间接访问数据              │
├─────────────────────────────────────────────────┤
│ Capability 层 (src/capabilities/)               │
│ ✓ 允许调用 StorageAPI                            │
│ ✓ 封装持久化细节,对 view 暴露业务 API           │
├─────────────────────────────────────────────────┤
│ Platform 层 (src/platform/main/)                │
│ ✓ 允许调用 StorageAPI                            │
│ ✓ IPC handler 直接操作 storage                  │
├─────────────────────────────────────────────────┤
│ StorageAPI 实现 (src/storage/)                  │
│ ✓ 唯一可 import 后端 SDK (surrealdb / sqlite)   │
└─────────────────────────────────────────────────┘
```

**强制规则**：

- **View 层**：**禁止** `import { storage } from '@/storage'`。view 通过 capability API（如 `noteCapability.createNote(...)`）间接访问。
- **Capability 层**：允许 import StorageAPI，封装持久化操作并对 view 暴露业务级 API。
- **Platform 层**（main 进程）：允许直接调 StorageAPI（用于 IPC handler 等基础设施）。

→ 这是 charter.md §1.3 "npm 屏障" 在数据持久化维度的延续 —— **StorageAPI 是 capability/platform 与 storage 之间的唯一接口；view 永远在屏障之外**。

#### ESLint 自检规则

```js
overrides: [
  {
    files: ['src/views/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: ['@/storage/**', '../../storage/**'],
      }],
    },
  },
];
```

### 4.1 storage 层职责

- 实体 id 生成（ULID，按 [decision 006](006-id-generation.md)）
- 实体 createdAt / updatedAt 自动填
- 实体 createdBy 默认值填（路径 B 单机单用户填 `'user-default'`）
- 跨实体引用校验（写入边时验证 subject / object atomId 存在）
- 事务原子性
- 子图索引维护

### 4.2 Capability 层职责

- 调用 StorageAPI 方法
- 处理返回值 / 错误
- 对 view 暴露业务级 API（封装 atom / edge 形态，view 不感知底层）
- **不**需要管 id 生成 / 时间戳 / createdBy（storage 层透明实现）

### 4.3 View 层职责（边界外）

- **不**直接调 StorageAPI
- 通过 capability API（如 `noteCapability.createNote(...)`）间接访问数据
- 不感知 atom / edge / storage 概念（capability 已封装为业务术语）

### 4.4 后端实现层职责（SurrealDB 实现 / etc）

- 具体存储 schema 实现
- 索引设计
- 查询优化
- 备份 / 恢复

## 5. 边界场景设计

### 5.1 atom 删除 + 级联策略

删除 atom 时，**该 atom 被引用的边怎么办**？

V2 采用 **级联删除**（cascade delete）：

```ts
const result = await storage.deleteAtom('atom-id');
// result = { deleted: true, cascadedEdges: 12 }
// 同时删除 subject 或 object 指向该 atom 的所有边
```

**理由**：保持一致性，避免悬空引用。

**例外**：如果业务需要"软删除 atom 保留边"，**Phase N 决议**（不在 Phase 3 范围）。

### 5.2 写入边时引用校验

写入 edge 时如果 subject / object atomId 不存在：

- **默认行为**：拒绝写入（抛错）
- **理由**：避免悬空引用

业务层批量创建场景（如导入大量 atom + 边），用 `transaction` 保证 atom 先于边创建。

### 5.3 并发写入

V2 阶段（单机单用户）**不需要分布式锁**。storage 层保证：

- 单进程并发用 Promise / async 序列化
- 跨进程并发（renderer ↔ main）通过 IPC 走 main 进程串行化

## 6. 实施形态：单例 vs 多实例

V2 推荐 **storage 单例**：

```ts
// src/storage/index.ts
export const storage: StorageAPI = createStorage();
```

理由：
- V2 单机单用户场景下，全应用共用一份存储
- 多实例引入复杂度无收益

未来多用户 / 多设备场景如需多实例（按用户分库），通过 `getStorageForUser(userId)` 工厂函数支持，**不破坏当前单例**。

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| SA1 | 全文检索是否独立接口 `searchAtoms(query: string)` 还是 `listAtoms({ search: '...' })` 扩展？ | **暂未决议**，Phase 3d schema 设计时决议 | Phase 3d |
| SA2 | querySubgraph 返回是否需要包含 path 信息（subject → object → ...）？ | **基础形态仅 atoms + edges**，path 由调用方自己组装；如未来需要再加 `paths` 字段 | Phase N |
| SA3 | 是否需要 `subscribeToChanges` 实时订阅接口？V2 当前用 store 模式（Note）/IPC 通知（Graph） | **暂不加**（按 V2 现有模式），未来云同步时再加 | Phase N |
| SA4 | 事务隔离级别（READ_COMMITTED / SERIALIZABLE）？ | 由后端默认值决定（SurrealDB / SQLite 都用 READ_COMMITTED 风格） | Phase 3d |
| SA5 | StorageAPI 错误模型 —— throw 还是 Result type（如 `{ ok: boolean, error?: Error }`）？ | **throw**（与 V2 现有 async API 一致） | Phase 3 实施时确认 |

## 8. 影响清单

如本决议获批：

1. `persistence/spec.md` §3 后端中立性补充本接口引用
2. `persistence/edge-entity.md`（同 Phase 3c）的字段定义与本接口的 `PutEdgeInput` / `EdgeFilter` 对齐
3. `persistence/surreal-schema.md`（Phase 3d）按本接口设计 SurrealDB 表 + SurrealQL 实现
4. **未来 V2 代码改造**（独立 Phase）：
   - 新建 `src/storage/api.ts` —— 定义 `StorageAPI` interface + 相关类型
   - 新建 `src/storage/surreal/` —— SurrealStorage 实现
   - 9 个 store 逐个对接 `StorageAPI`（详 [decision 009](009-migration-strategy.md)）

## 9. 参考来源

- [`persistence/spec.md §3`](../spec.md) 后端中立性原则
- [`atom/decisions/003 走法 B`](../../atom/decisions/003-naming-conventions.md)
- [`decision 010`](010-multi-user-multi-device.md) 路径 B 多用户预留
- [`relations/spec.md`](../../relations/spec.md) Edge 通用接口
- [`atom/spec.md` §1](../../atom/spec.md) Atom 通用接口
