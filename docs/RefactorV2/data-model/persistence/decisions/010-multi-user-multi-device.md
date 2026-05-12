# Decision 010 — 多用户 / 多设备处置决议（路径 B 正式登记）

> **Phase**: 3c
> **状态**: ✅ **已决议**（路径 B 已在前面对话拍板，本文件正式登记）
> **影响**: `persistence/spec.md` + `persistence/atom-entity.md` + `decisions/008` + 未来扩展边界

---

## 0. 决议背景

V2 数据建模中是否预留**用户身份**和**多设备同步**字段？

前置对话讨论了两条路径：

- **路径 A**：现在预留（atom 实体加 ownerId / deviceId / syncState / 等）
- **路径 B**：未来加（按业务需求触发独立 Phase 添加）

用户最终拍板 **路径 B + 3 条最小预留入口**。本决议正式登记决议结论。

## 1. 决议结论

V2 当前阶段（Phase 1-3）**仅支持单机单用户**，**不**预留以下字段：

- ❌ deviceId / createdDevice / lastModifiedDevice
- ❌ syncState（'local' / 'synced' / 'pending' / 'conflict'）
- ❌ vector clock / CRDT 元数据
- ❌ 加密 / 访问控制元数据
- ❌ 云上传 / 下载状态字段
- ❌ lastModifiedBy（编辑者标识）

**保留 3 条最小预留入口**，为未来叠加用户身份 / 多设备同步留接口入口，**不引入实现复杂度**。

## 2. 3 条最小预留（已实施 / 待实施）

### 预留 1: Edge `attrs.createdBy`

**位置**：[`relations/spec.md §3.1`](../../relations/spec.md)

**形态**：edge attrs 强制带 `createdBy: string`（agentId）

**当前状态**：📐 **已规范化**（Phase 1 commit `313fb70` 已写入 relations/spec.md）

**实施状态**：⏳ 代码层尚未实施（storage 层尚未对接，Phase N 业务实施时落地）

**实施细节**：
- 边创建时 storage 层填 createdBy（单机单用户阶段 `'user-default'`）
- 未来引入用户身份 → 直接换 `'user-wenwu'` / `'ai-gpt4'` 等真实 agentId

### 预留 2: Atom 实体 `createdBy` 字段

**位置**：[`persistence/atom-entity.md §2.4`](../atom-entity.md)

**形态**：

```ts
interface AtomEntity<D extends AtomDomain = AtomDomain> {
  id: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;        // ← 路径 B 预留
  payload: Atom<D>;
}
```

**当前状态**：📐 **已规范化**（Phase 3a commit `2b2269d` 已写入 atom-entity.md）

**实施状态**：⏳ 代码层尚未实施（storage 层尚未对接，Phase N 业务实施时落地）

**实施细节**：
- atom 创建时 storage 层填 createdBy（默认 `'user-default'`）
- 业务层透明（不需要传 createdBy）
- 未来引入用户身份 → storage 层读当前用户 agentId 自动填

**schema migration 影响**：单机单用户 → 多用户时**不需要 migration**（仅运行时填的值变化，schema 字段不变）。

### 预留 3: StorageAPI `ownerId` 可选参数

**位置**：[`persistence/decisions/008-storage-layer-interface.md §2.1`](008-storage-layer-interface.md)

**形态**：

```ts
interface StorageOptions {
  ownerId?: string;        // ← 路径 B 预留
  timeoutMs?: number;
}
```

**当前状态**：📐 **已规范化**（Phase 3c decision 008 RFC 进行中）

**实施状态**：⏳ 代码层尚未实施（decision 008 RFC 转正后，storage 层实施时落地）

**实施细节**：
- 调用方不传 `ownerId` = 当前用户（storage 层填 `'user-default'`）
- 未来多用户 → 调用方传 `ownerId: 'user-wenwu'` 切换查询用户切片
- **接口签名一次性预留**，实现层（SurrealStorage）暂不分用户

## 3. 拒绝的预留备忘

按路径 B，V2 当前阶段**不**加以下字段。备忘理由 + 未来引入时机：

| 字段 | 拒绝理由 | 未来引入时机 |
|---|---|---|
| `deviceId` | 单机场景下永远是 default 值，字段冗余；多设备场景需要 vector clock 配套，单纯 deviceId 不够 | 多设备同步真实启动时（Phase N） |
| `createdDevice` / `lastModifiedDevice` | 同上 | 同上 |
| `syncState` | 单机场景无意义；多设备场景具体形态（local/synced/pending/conflict）需要业务驱动设计 | 云同步真实启动时（Phase N） |
| vector clock / CRDT 元数据 | 形态复杂，需要协作场景驱动设计（vector clock vs CRDT vs OT，取决于场景） | 协作 / 实时同步真实启动时（Phase N） |
| 加密元数据 | 加密策略（端到端 / 服务端 / 等）需要安全场景驱动 | 加密真实启动时（Phase N） |
| 云上传 / 下载状态字段 | 云后台 API 形态未定 | 云后台真实启动时（Phase N） |
| `lastModifiedBy` | 单用户场景 = createdBy，字段冗余；多用户场景需要协作驱动（如同事改笔记） | 协作真实启动时（Phase N） |

## 4. 未来扩展入口

如果未来真实业务需要叠加用户 / 多设备 / 云同步：

### 4.1 启动新 Phase 流程

参考 L6-block-decomposition 成功模式：

1. 设计师写新 decision 文件（如 `data-model/persistence/decisions/0XX-multi-device-sync.md`）
2. 拍板范围 + 字段形态 + 接口扩展
3. 独立分支 `feature/LN-multi-device-sync-spec`（规范）
4. 独立分支 `feature/LN-multi-device-sync-impl`（实施）

### 4.2 扩展字段添加路径

按 [`decision 003`](../../atom/decisions/003-naming-conventions.md) **走法 B 叠加原则**：

新字段优先**走边表达**，而非 atom / edge 实体壳直接加字段：

| 业务需求 | 推荐表达方式 |
|---|---|
| "这个 atom 在哪些设备上有副本" | 走边 `*:sync:hasReplicaOn` → device atom |
| "这个 atom 上次在哪个设备改" | 走边 `*:sync:lastModifiedOn` → device atom |
| "这个 atom 的协作历史" | 走边 `prov:wasGeneratedBy` / `prov:wasInformedBy` 序列 |

→ 实体壳保持 5 字段极简，多用户 / 多设备复杂度通过边模型扩展。

如果**确实需要**在实体壳加字段（如 `deviceId` 高频读，走边性能不行）—— 通过新 decision 单独决议。

## 5. KRIG vision 一致性

按 [`vision.md §8`](../../../../00-architecture/vision.md)：

> 至少 v1.x 单人本地优先

→ 路径 B 跟 vision 完全一致。多用户 / 多设备 / 云后台是 **v2+** 才考虑。

## 6. 跨决议的 createdBy 一致性

V2 三个 createdBy 字段在不同层级：

| 字段 | 层级 | 何时填 |
|---|---|---|
| `AtomEntity.createdBy` | 实体壳 | atom 创建时 storage 层填 |
| `EdgeAttrs.createdBy` | edge 数据 | edge 创建时 storage 层填 |
| `EdgeAttrs.confirmedBy` | edge 数据（可选） | 用户确认 ai/sys 边时 |
| `EdgeAttrs.rejectedBy` | edge 数据（可选） | 用户拒绝 ai/sys 边时 |

**所有 createdBy / confirmedBy / rejectedBy 字段**用同一种 agentId 格式（按 [`relations/spec.md §3.1`](../../relations/spec.md) 约定）：

```
'user-<userId>'        如 'user-default' / 'user-wenwu'
'ai-<modelId>'         如 'ai-gpt4' / 'ai-claude-opus-4.7'
'sys-<taskId>'         如 'sys-auto-embed' / 'sys-graph-query-cache'
```

→ 未来引入用户身份时，**只需把所有 `'user-default'` 替换为真实 agentId**，schema 不变。

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| MU1 | "用户" 定义是 KRIG-Note 内部账户还是 OS 用户 / Google 账户 / 等？ | **暂未决议**（v1.x 单机阶段仅 `'user-default'`） | v2+ 引入认证系统时决议 |
| MU2 | 单机阶段是否区分多个本地 profile（如 "工作" / "个人" 笔记分库）？ | **不区分**（一份本地数据库） | 视真实需求 |
| MU3 | createdBy 字段是否需要校验格式（如必须匹配 agentId 正则）？ | **不强制校验**（schema 灵活，运行时业务层负责） | 不阻塞 |

## 8. 影响清单

本决议作为路径 B 正式登记：

1. `persistence/spec.md` §2.4 拒绝清单引用本决议
2. `persistence/atom-entity.md` §2.4 `createdBy` 字段说明引用本决议
3. `persistence/decisions/008` §1.4 `ownerId` 预留说明引用本决议
4. **未来如有用户 / 多设备 / 云同步业务需求** → 启动新 decision 0XX 扩展，本决议作为前置参考

## 9. 参考来源

- [`vision.md`](../../../../00-architecture/vision.md) §8 单人本地优先
- [`persistence/spec.md`](../spec.md) §2.4 拒绝的元属性
- [`atom-entity.md`](../atom-entity.md) §2.4 createdBy 字段
- [`decision 008`](008-storage-layer-interface.md) §1.4 ownerId 预留
- [`relations/spec.md §3.1`](../../relations/spec.md) edge attrs createdBy
- [`atom/decisions/003`](../../atom/decisions/003-naming-conventions.md) 走法 B 叠加原则
