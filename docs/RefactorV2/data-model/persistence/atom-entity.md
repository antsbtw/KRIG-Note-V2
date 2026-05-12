# Atom 实体 schema 详定义

> **Phase**: 3a
> **状态**: 📝 **RFC 进行中**
> **参考依据**: `persistence/spec.md` + `atom/spec.md` §1.1 + `atom/decisions/003`
>
> ⚠ 字段名 / 形态 / 默认值含"临时默认 / 待决议"项均为 RFC 提议，未最终拍板。实施前需对照 V2 现有实现 + Phase 3 后续决议（006-010）。

---

## 0. 本文档定位

定义 V2 **atom 实体壳**的完整 schema —— atom 数据如何被包装为可持久化的实体形态。

`spec.md` §1.1 给了实体壳的接口总览，本文档展开**每个字段的完整定义 + V2 现状对齐 + 跨 domain 一致性**。

---

## 1. AtomEntity 完整接口

```ts
/**
 * V2 atom 实体壳 —— atom 数据 + 存储层元属性
 *
 * 所有 atom domain（pm / rdf / embedding / three / ...）共用同一份实体壳，
 * 仅 payload 字段按 domain 分派形态。
 */
export interface AtomEntity<D extends AtomDomain = AtomDomain> {
  // ── 实体元属性（存储层管理） ──

  /** 全局唯一 id（生成策略详 decisions/006-id-generation.md） */
  id: string;

  /** 创建时间（Unix 毫秒，永久不变） */
  createdAt: number;

  /** 修改时间（Unix 毫秒，每次修改自动更新） */
  updatedAt: number;

  /** 创建者 agentId（路径 B 最小预留，永久不变） */
  createdBy: string;

  // ── atom 数据（Phase 1 已定义） ──

  /** Atom 数据载体：domain + payload */
  payload: Atom<D>;
}
```

**字段总数**：5 个（4 个元属性 + 1 个 payload 容器）。

---

## 2. 字段详定义

### 2.1 id

| 维度 | 规约 |
|---|---|
| 类型 | `string` |
| 长度 | 由生成策略定（决议在 [decisions/006](decisions/006-id-generation.md)） |
| 字符集 | 由生成策略定 |
| 可变性 | **永久不变**（写入后不可改） |
| 命名 | 实体身份字段，沿用数据库通用 `id` |
| 跨进程 | 必须保证跨 renderer / main 进程唯一 |

**生成时机**：atom 实体写入存储时由 storage 层生成（**不允许业务层指定**，按 spec.md §6 PE4）。

**临时形态**（V2 当前实施）：沿用 V1 `note-${counter}` 风格，待 [decisions/006](decisions/006-id-generation.md) 升级。

### 2.2 createdAt

| 维度 | 规约 |
|---|---|
| 类型 | `number` |
| 单位 | Unix 毫秒（与 V1 一致） |
| 来源 | `Date.now()` 在创建时写入 |
| 可变性 | **永久不变** |
| 时区 | 无（毫秒时间戳是绝对时间） |

### 2.3 updatedAt

| 维度 | 规约 |
|---|---|
| 类型 | `number` |
| 单位 | Unix 毫秒 |
| 来源 | `Date.now()` 每次修改时由 storage 层自动写入（按 spec.md §6 PE2） |
| 可变性 | 每次修改更新 |
| 约束 | `updatedAt >= createdAt` |

**业务层 vs storage 层职责**：
- 业务层**不需要**自己管 updatedAt 字段，调用 `storageAPI.putAtom()` 时 storage 层自动写。
- 这避免了 V1 atom-types.ts 里 `meta.updatedAt` 由各处业务代码各自维护导致时钟乱的问题。

### 2.4 createdBy

| 维度 | 规约 |
|---|---|
| 类型 | `string` |
| 格式 | agentId 字符串（参考 `relations/spec.md §3.1` 的 createdBy 约定） |
| 取值示例 | `'user-default'` / `'user-wenwu'` / `'ai-gpt4'` / `'sys-auto-embed'` |
| 可变性 | **永久不变** |
| 默认值 | `'user-default'`（单机单用户阶段） |

**单机单用户阶段约定**：

V2 当前阶段（按 [decisions/010](decisions/010-multi-user-multi-device.md) 路径 B）：

- storage 层创建 atom 时自动填 `createdBy: 'user-default'`
- 业务层**无需感知**这个字段（透明实现）

**未来引入用户身份**：

- 用户登录后，storage 层读到当前 agentId（如 `'user-wenwu'`）
- 新创建的 atom `createdBy` 字段自动用真实 agentId
- 老数据 `createdBy: 'user-default'` 仍然保留（或在数据迁移时改为系统默认用户）

→ **schema 不需要 migration**，仅运行时填的值变化。

### 2.5 payload

| 维度 | 规约 |
|---|---|
| 类型 | `Atom<D>` —— `{ domain: D, payload: AtomPayloadOf<D> }`（详 [`atom/spec.md §1`](../atom/spec.md)） |
| 内容 | atom 数据形态（按 domain 分派） |
| 可变性 | 可变（每次修改时 storage 层把新 payload 写入 + 更新 updatedAt） |

**注意命名重叠**：

- `AtomEntity.payload` —— 外层实体壳的字段（"装着 atom 数据"）
- `Atom<D>.payload` —— 内层 atom 数据中按 domain 分派的具体载荷（如 pm domain 的 PmPayload）

两层 payload 是**嵌套关系**（外层是容器，内层是具体内容），不混淆。

示意：

```ts
const entity: AtomEntity<'pm'> = {
  id: '01HXAB...',
  createdAt: 1736000000000,
  updatedAt: 1736000001234,
  createdBy: 'user-default',
  payload: {                        // ← AtomEntity.payload (容器)
    domain: 'pm',
    payload: {                      // ← Atom<'pm'>.payload (PmPayload)
      type: 'paragraph',
      content: [{ type: 'text', text: 'hello' }],
      attrs: { isTitle: false },
    },
  },
};
```

---

## 3. 跨 domain 一致性

V2 所有 atom domain（pm / rdf / embedding / three / ...）**共用同一份 AtomEntity 实体壳**。

差异仅在 `Atom<D>.payload` 的内部形态（按 domain 分派），实体元属性（id / 时间戳 / createdBy）形态完全一致。

```ts
// 不同 domain 的 atom 实体（仅 payload 内部不同）
const pmAtom: AtomEntity<'pm'> = { ..., payload: { domain: 'pm', payload: PmPayload } };
const rdfAtom: AtomEntity<'rdf'> = { ..., payload: { domain: 'rdf', payload: RdfPayload } };
const threeAtom: AtomEntity<'three'> = { ..., payload: { domain: 'three', payload: ThreePayload } };
// id / createdAt / updatedAt / createdBy 形态全部一致
```

**好处**：
- 跨 domain 查询（如"查所有 user-wenwu 创建的 atom"）形态统一
- 后端 schema 只需要一张 atom 表 + domain 字段分派（详 [surreal-schema.md](surreal-schema.md) Phase 3d）

---

## 4. V2 现状对齐

V2 当前持久化形态（按 `views/note/note-store.ts` line 17-25）：

```ts
// V2 当前 Note 形态
interface Note {
  id: string;            // 'note-${counter}'
  title: string;         // 派生字段（doc 第一段文本）
  doc: DriverSerialized; // PM doc JSON 序列化
  folderId: string | null;
  createdAt: number;
  updatedAt: number;
}
```

### 4.1 V2 Note → V2 AtomEntity 映射

V2 当前 `Note` 接口跟 Phase 3 目标态的对齐情况：

| V2 当前字段 | Phase 3 目标态 | 处置 |
|---|---|---|
| `id: string` | ✓ AtomEntity.id | 直搬，待 id 生成策略升级 |
| `createdAt: number` | ✓ AtomEntity.createdAt | 直搬 |
| `updatedAt: number` | ✓ AtomEntity.updatedAt | 直搬 |
| `doc: DriverSerialized` | AtomEntity.payload（pm domain）| **形态变化** —— DriverSerialized 嵌套 PM doc，需展开到 Atom<'pm'> |
| `title: string` | **派生字段**（从 doc 第一段提取，不持久化） | 删除（运行时计算） |
| `folderId: string \| null` | **走边表达**（`*:krig:inFolder`）| 删除字段，迁移到边 |
| ❌ 无 `createdBy` | ✓ AtomEntity.createdBy | **新增字段**（路径 B 最小预留） |

### 4.2 V2 → Phase 3 迁移路径

按 [decisions/009-migration-strategy.md](decisions/009-migration-strategy.md)（Phase 3c）详定，简要：

1. V2 当前 `note-${counter}` id → 升级为新生成策略（按 [decisions/006](decisions/006-id-generation.md)）
2. `doc: DriverSerialized` → 拆解为 `Atom<'pm'>` 形态
3. `title` 字段删除（派生）
4. `folderId` 字段迁移为 `*:krig:inFolder` 边
5. 新增 `createdBy: 'user-default'` 字段

**V2 当前无真实用户数据**（按 N7 决议），迁移成本几乎为零。

---

## 5. 拒绝的字段（按 Phase 3 spec.md §2.4 + decisions/010 路径 B）

V2 当前 AtomEntity **不**加以下字段：

| 字段 | 拒绝理由 |
|---|---|
| `dirty: boolean` | V1 atom-types.ts 有此字段，但渲染层概念（违反原则 1） |
| `nodeIds: string[]` | V1 atom-types.ts 有，关联 PM 节点 id（严重违反原则 1） |
| `deviceId` / `createdDevice` / `lastModifiedDevice` | 路径 B 决议（多设备场景未来叠加） |
| `syncState` | 同上 |
| vector clock / CRDT 元数据 | 同上 |
| `version` | 暂不加（按 spec.md §6 PE1） |
| `deleted` 软删除标记 | 暂不加（V2 用硬删除，按 spec.md §6 PE3） |
| `tags` / `category` / `priority` 等业务字段 | 业务字段走边表达（按 decisions/003 走法 B），不在实体壳 |

---

## 6. 关键设计选择论证

### 6.1 为什么实体壳只有 5 个字段（极简）

按 V2 数据建模原则（decisions/003 走法 B + 原则 1）：

- **走法 B**：所有非本体属性走边 → 实体壳不需要 tags / category / priority 等业务字段
- **原则 1**：语义层不知道渲染层 → 不加 dirty / nodeIds
- **路径 B**：单机单用户阶段不预留多设备字段 → 不加 deviceId / syncState

→ 最终保留的 5 个字段（id / createdAt / updatedAt / createdBy / payload）都是**实体身份 + 时间生命周期 + 数据容器**这三个不可少的概念。

### 6.2 为什么 createdBy 不放 atom 数据里

理论上 `createdBy` 也可以放 `Atom<D>.payload` 内（如 attrs 字段）。但放实体壳的理由：

- **跨 domain 一致**：所有 domain（pm / rdf / embedding / three）都需要"谁创建的"信息，放 payload 会导致每个 domain 重复定义
- **实体级元属性**：createdBy 跟 atom 数据内容无关，是关于"实体创建事件"的元数据，归实体壳更合理
- **存储层透明实现**：放实体壳意味着 storage 层自动填，业务层零感知

### 6.3 为什么不加 `lastModifiedBy`

按 [decisions/010](decisions/010-multi-user-multi-device.md) 单机单用户阶段：

- 单机单用户场景下，"上次修改是谁" 跟"创建者"通常是同一个人 → 字段冗余
- 多用户场景下，"上次修改是谁"是协作维度（如同事 A 改了同事 B 的笔记）—— 这是**未来叠加**才需要的字段，不属于当前预留范围

→ 未来需要时通过新决议加 `lastModifiedBy` 字段，schema migration 加新字段对老数据无破坏。

---

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| AE1 | atom 实体被引用（如某个 edge.subject = atomId）后，若 atom 被删除，引用如何处置？级联删除 / 标记孤儿 / 保留？ | **暂未决议**，待 [decisions/008](decisions/008-storage-layer-interface.md) StorageAPI 决议 | Phase 3c |
| AE2 | 实体 id 是否需要支持"自定义命名 id"（如用户给 atom 起名 `'my-special-atom'`）？ | **不支持**（id 由 storage 层生成，业务层用 [linksTo / 等边] 引用） | 不引入 |
| AE3 | 实体壳的 createdAt 时区 / 夏令时如何处理？（毫秒时间戳是 UTC，渲染时本地化） | **毫秒时间戳 = 绝对时间**，本地化由 capability.text-editing / view 层处理 | 不引入 |
| AE4 | V2 当前 Note 接口的 `title` 字段（派生自 doc）—— 迁移时是否需要写入实体某处供索引？ | **不写入实体**（每次按需从 payload 派生） | Phase 3c 决议 |

---

## 8. 影响清单

如本文档获批，下一步要做：

1. **Phase 3b 启动** —— 写 [decisions/006](decisions/006-id-generation.md) 决议 id 生成 + [decisions/007](decisions/007-storage-target.md) 决议后端
2. **Phase 3c** —— 写 StorageAPI 接口 + 迁移策略 + 多用户决议 + edge-entity
3. **未来 V2 代码改造**（独立 Phase）—— V2 当前 Note 接口升级为 AtomEntity<'pm'>，noteStore 改走 StorageAPI

---

## 9. 参考来源

- [`atom/spec.md`](../atom/spec.md) §1.1 atom 数据 vs 实体
- [`atom/decisions/003-naming-conventions.md`](../atom/decisions/003-naming-conventions.md) 走法 B
- [`relations/spec.md`](../relations/spec.md) §3.1 edge attrs createdBy 约定
- `src/views/note/note-store.ts` line 17-25（V2 当前 Note 接口）
- `src/views/note/data-model.ts`（V2 当前 createNote 实现）
