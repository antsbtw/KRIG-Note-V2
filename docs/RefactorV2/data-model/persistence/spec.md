# 持久化总规范（Phase 3 spec）

> **状态**: ✅ **已转正**（Phase 3 全部完成 + audit 通过，2026-05-12）
> **参考依据**: `atom/spec.md` §1.1 + `relations/spec.md` §3 + `naming-conventions.md` + `atom/decisions/003`
>
> 本规范为 V2 持久化层正式基线。具体未决议项标在 §6 Open Questions（实施时按硬门槛 / 真实需求触发逐项验证决议）。

---

## 0. 本规范定位

定义 V2 数据建模的**持久化层**总规范，包括：

- atom 实体壳形态（atom 数据 + 元属性）
- edge 实体壳形态
- 实体元属性字段规约
- 后端中立性原则
- 字段优先级规则
- 跨实体一致性约束

详细的 atom / edge 实体 schema 见 [atom-entity.md](atom-entity.md) / [edge-entity.md](edge-entity.md)。

---

## 1. 实体壳总览

V2 数据建模有**两类实体**：

### 1.1 Atom 实体壳

```ts
interface AtomEntity<D extends AtomDomain = AtomDomain> {
  // 实体元属性（存储层包裹）
  id: string;                  // 全局唯一 id
  createdAt: number;           // 创建时间（Unix 毫秒）
  updatedAt: number;           // 修改时间（Unix 毫秒）
  createdBy: string;           // 创建者 agentId（详 §1.2）

  // atom 数据（Phase 1 已定）
  payload: Atom<D>;            // { domain, payload }
}
```

### 1.2 Edge 实体壳

```ts
interface EdgeEntity {
  // 实体元属性
  id: string;
  createdAt: number;
  updatedAt: number;
  // edge 自身已带 createdBy（attrs），无需重复

  // edge 数据（Phase 1 已定）
  predicate: EdgePredicate;    // <source>:<vocabulary>:<edge-name>
  subject: AtomRef;            // 按当前默认决议必须是 atom（详 §1.3）
  object: EdgeEndpoint;        // atom 或 literal
  attrs: EdgeAttrs;            // 含 createdBy / confidence / 等
}
```

### 1.3 subject 必须是 atom 的约束

按 [`relations/spec.md §5.1`](../relations/spec.md) 当前默认决议：

> **Phase 1 规范层禁止** LiteralValue 作 subject —— subject 必须是 AtomRef。需要"反向语义"时改写边名表达 atom-side-subject。

→ 这是当前默认。**若未来放开**（如允许 literal-as-subject 表达某些场景），需要同步更新 `relations/spec.md §5.1` + 本 spec 的 `EdgeEntity.subject` 类型，**两份文档同步**。

详 [atom-entity.md](atom-entity.md) / [edge-entity.md](edge-entity.md)。

---

## 2. 元属性字段规约

### 2.1 必带元属性（atom + edge 共有）

| 字段 | 类型 | 含义 | 命名依据 |
|---|---|---|---|
| `id` | `string` | 全局唯一标识 | 数据库通用约定（阶梯 3） |
| `createdAt` | `number` | 创建时间（Unix 毫秒） | 数据库通用约定 |
| `updatedAt` | `number` | 修改时间（Unix 毫秒） | 数据库通用约定 |

具体生成策略详 [decisions/006-id-generation.md](decisions/006-id-generation.md)（Phase 3b）。

### 2.2 atom 实体专属元属性

| 字段 | 类型 | 含义 | 来源 |
|---|---|---|---|
| `createdBy` | `string` | agentId（如 `'user-default'` / `'user-wenwu'` / `'ai-gpt4'` / `'sys-auto-embed'`） | KRIG 自定义（数据库通用 + agentId 风格） |

**关于 `createdBy` 的用户预留**（按 [decision 010](decisions/010-multi-user-multi-device.md) 路径 B）：

- **单机单用户阶段**（当前）：`createdBy` 默认填 `'user-default'`，运行时由 storage 层注入。
- **未来引入用户身份**：直接换 `'user-wenwu'` / `'user-xxx'` 形态，**schema 不需要 migration**。

这是按 [decisions/010](decisions/010-multi-user-multi-device.md) "最小预留 2"的实施 —— **加一个字段，预留账户入口**。

### 2.3 edge 实体专属元属性

edge 不重复加 `createdBy`，因为 [`relations/spec.md §3.1`](../relations/spec.md) 已在 edge attrs 强制带：

```ts
edge.attrs.createdBy: string;          // 已存在
edge.attrs.confidence?: number;        // ai/sys 必填
edge.attrs.confirmedBy?: string;       // 用户确认
edge.attrs.confirmedAt?: number;       // 用户确认时间
edge.attrs.rejectedBy?: string;        // 用户拒绝
edge.attrs.rejectedAt?: number;        // 用户拒绝时间
edge.attrs.comment?: string;
```

→ 这是 [decision 010](decisions/010-multi-user-multi-device.md) "最小预留 1"的实施 —— **已存在，无需新动作**。

### 2.4 拒绝的元属性（按路径 B 决议）

V2 当前阶段**不**加以下字段（按 [decision 010](decisions/010-multi-user-multi-device.md)）：

- ❌ `deviceId` / `createdDevice` / `lastModifiedDevice`
- ❌ `syncState`（'local' / 'synced' / 'pending' / 'conflict'）
- ❌ vector clock / CRDT 元数据
- ❌ 加密 / 访问控制元数据
- ❌ 云上传 / 下载状态字段

→ 未来引入对应业务时通过独立 Phase（如 Phase X-multi-device-sync）按需叠加。

---

## 3. 后端中立性原则

### 3.1 实体 schema 不绑死后端

本规范定义的 atom / edge 实体形态**仅是数据形状**，不依赖任何具体后端（SurrealDB / SQLite / JSON / 等）。

→ 同一份实体 schema 可在多种后端实现，通过 [`StorageAPI 接口`](decisions/008-storage-layer-interface.md)（Phase 3c）隔离。

### 3.2 三层职责分离

```
┌───────────────────────────────────────┐
│ Phase 1/2 atom 数据                    │ ← domain + payload + content + attrs + marks + text
│ Phase 3 atom 实体                      │ ← + id / createdAt / updatedAt / createdBy
└─────────────────┬─────────────────────┘
                  ↓ 通过
┌───────────────────────────────────────┐
│ StorageAPI 接口 (Phase 3c)            │ ← 中立接口
└─────────────────┬─────────────────────┘
                  ↓ 实现
┌───────────────────────────────────────┐
│ 具体后端: SurrealDB / SQLite / JSON   │ ← 可换
└───────────────────────────────────────┘
```

### 3.3 后端切换不影响上层

按 V2 charter.md §1.3 npm 屏障原则 —— 后端切换的代价应该是**只改 storage 层内部实现**，所有上层（atom 数据使用方 / capability / view）零修改。

→ 这正是 Phase 3 选 StorageAPI 抽象的根本理由。

---

## 4. 字段优先级规则

V2 数据模型的同名字段处理有**两条独立规则**（不同作用域，互不冲突）：

### 4.1 编写纪律 — 避免重复声明（schema 编写时）

**框架已注入的字段，节点级 spec 不重复 declare**。

引用 [`pm-note.md §3.1`](../relations/pm-note.md)：

> 同名字段若已由 schema 框架注入（如 `indent`），节点级 attrs **不重复声明**，避免 schema 重复定义错误。

适用范围：所有 block / inline 节点 spec.ts 文件（schema-builder 时机）。

### 4.2 层级隔离 — 命名空间不重叠（实体 / atom 数据 / 框架级）

V2 同名字段**通过命名空间隔离**，避免冲突：

```
┌────────────────────────────────────────────┐
│ 1. 实体元属性命名空间 (entity)              │
│   独占字段: id / createdAt / updatedAt /    │
│            createdBy                        │
│   规则: atom 数据不允许定义这些名字          │
├────────────────────────────────────────────┤
│ 2. atom 数据命名空间 (atom payload)         │
│   独占字段: domain / payload                │
│   payload.attrs 内字段由各 domain / block   │
│   自行定义(如 paragraph.attrs.isTitle)      │
├────────────────────────────────────────────┤
│ 3. 框架级注入命名空间 (schema-builder)      │
│   字段: indent 等                           │
│   规则: 写在 atom payload.attrs 内,         │
│         由框架自动注入,节点级不重复声明     │
└────────────────────────────────────────────┘
```

**强制规则**：
- 实体元属性字段名（id / createdAt / updatedAt / createdBy）**禁止**出现在 atom 数据内
- 框架级注入字段名（indent）由 schema-builder 自动添加到所有 `group: 'block'` 节点的 attrs，节点级 spec 不再重复 declare

→ 命名空间不重叠，**不存在"谁覆盖谁"的运行时冲突**。

**例**：
- atom 数据**不允许**有顶层 `id` 字段（实体层独占）
- atom 数据**不允许**有顶层 `createdAt` / `updatedAt` 字段（实体层独占）
- pm 节点 spec **不需要**显式 declare `indent` attr（框架级自动注入；节点级冗余声明会触发 schema 编译错误）

---

## 5. 跨实体一致性约束

### 5.1 atom id 跨边引用一致

edge.subject.atomId / edge.object.atomId（如果是 AtomRef）必须指向**已存在**的 atom 实体 id。

→ 不允许悬空引用（dangling reference）。具体校验时机由 [StorageAPI](decisions/008-storage-layer-interface.md) 决定（写入时校验 vs 读取时容错）。

### 5.2 时间戳单调性

- atom / edge 的 `updatedAt >= createdAt`（实体修改时间不早于创建时间）
- atom / edge 修改时 `updatedAt = Date.now()`（写入时由 storage 层自动更新）

### 5.3 实体不可变 vs 可变字段

| 字段 | 可变性 |
|---|---|
| `id` | **永久不变**（实体身份） |
| `createdAt` / `createdBy` | **永久不变**（创建事件不可改） |
| `updatedAt` | 每次修改自动更新 |
| `payload`（atom 数据） / `attrs`（edge） | 可变 |

→ id / createdAt / createdBy 是"事件型"字段（once written, immutable）。

---

## 6. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| PE1 | atom 实体壳是否需要 `version` 字段（schema 版本演进）？ | **暂不加**（按"加法"原则，未来 schema 改时再加） | Phase 3+ |
| PE2 | `updatedAt` 由 storage 层自动写还是允许业务层指定？ | **storage 层自动写**（避免业务层时钟混乱） | Phase 3c |
| PE3 | atom 实体是否需要 `deleted` 软删除字段（vs 硬删除）？ | **硬删除**（V2 简化，未来按需加） | Phase 3+ |
| PE4 | id 是否允许业务层指定（如 `'note-1'` 这种语义 id）？还是 storage 层统一生成？ | **storage 层统一生成**（避免业务层重复 / 冲突） | Phase 3b decision 006 |
| PE5 | atom 实体的 `dirty` 字段（V1 atom-types.ts 有）—— V2 是否需要？ | **不需要**（dirty 是渲染层概念，违反语义层原则 1） | 不引入 |

---

## 7. 影响清单

如本 spec 获批，下一步要做：

1. **Phase 3a 收尾** —— 完成 `atom-entity.md` 详定义。
2. **Phase 3b** —— 写 `decisions/006` 决议 id 生成 + `decisions/007` 决议存储后端。
3. **Phase 3c** —— 写 `decisions/008` StorageAPI 接口 + `decisions/009` 迁移策略 + `decisions/010` 多用户/多设备决议 + `edge-entity.md`。
4. **Phase 3d** —— 写 `surreal-schema.md`（按 007 结果展开）。

---

## 8. 参考来源

- [`atom/spec.md`](../atom/spec.md) §1.1（atom 数据 vs 实体）
- [`relations/spec.md`](../relations/spec.md) §3（edge attrs 规约）
- [`atom/decisions/003-naming-conventions.md`](../atom/decisions/003-naming-conventions.md)（走法 B）
- [`naming-conventions.md`](../naming-conventions.md)（字段命名三阶梯）
- V1 `src/main/storage/`（V1 已有 SurrealDB 实现，Phase 3d 参考）
