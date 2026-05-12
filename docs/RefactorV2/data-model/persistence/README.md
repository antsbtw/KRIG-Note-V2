# V2 持久化规范（Phase 3）

> **Phase**: 3（persistence 规范 / 范围 X：先文档后代码）
> **状态**: ✅ **已转正**（Phase 3a / 3b / 3c / 3d 全部完成 + audit 通过 + 用户拍板，2026-05-12）
> **分支**: 已合并 main（commit `<待 merge 后填入>`）
>
> 本目录文档为 V2 持久化层**正式规范基线**。"临时默认 / 待决议" 标识的具体决议项（Open Questions SS1-SS7 / EM1-EM6 / N* / 等）在实施 Phase 时按"硬门槛触发 / 真实需求出现"逐项验证决议。规范本身已转正。
>
> **实施代码**应以本目录为准。未来如发现规范与实现冲突，**优先修代码对齐规范**（除非规范确有错误，单独决议修订）。

---

## 0. 本目录的角色

Phase 1 / 2 定义了 **atom 数据形态**（domain + payload + content + attrs + marks + text）—— 是**纯数据层规范**。

Phase 3 解决：**atom / edge 实体如何在存储层落地**。具体覆盖：

- atom 实体壳（atom 数据 + 元属性如 id / 时间戳 / createdBy）
- edge 实体壳（edge 数据 + 元属性）
- 存储后端选型决议
- 存储层抽象接口（StorageAPI）
- SurrealDB schema 设计（按选型结果展开）
- V2 现状 → 目标态的迁移策略

→ Phase 3 不修改 V2 代码（按用户拍板的"路径 X：先文档后代码"），代码改造留到独立 Phase（参考 L6-block-decomposition 模式）。

---

## 1. Phase 3 设计原则

### 1.1 实体壳 vs 数据 vs 视图

V2 数据建模有**三层职责**：

| 层 | 内容 | 负责 |
|---|---|---|
| **atom 数据**（Phase 1） | domain + payload（如 pm 节点 type/content/attrs/marks/text） | 语义层 / `atom/spec.md` |
| **atom 实体**（Phase 3 ←） | atom 数据 + 元属性（id / 时间戳 / createdBy / 等） | **存储层包裹** / 本目录 |
| **atom 视图**（capability 层） | 渲染 / 交互 / dirty 等运行态 | 视图层 / 不持久化 |

Phase 3 的核心 = **明确实体壳的字段定义** + **如何存到后端**。

### 1.2 后端中立性

Phase 3 设计的实体 schema **不绑死任何具体后端**。通过 `StorageAPI` 抽象接口隔离：

```
[实体 schema]
    ↓
[StorageAPI 接口]    ← 接口是中立的
    ↓
[具体实现：SurrealDB / SQLite / JSON / ...]    ← 实现可换
```

这跟 V2 charter.md §1.3 npm 屏障原则一致 —— 后端 npm 依赖只在 storage 层内部，上层零感知。

### 1.3 路径 B：现在不预留多设备 / 云

按 [decision 010](decisions/010-multi-user-multi-device.md)，V2 当前阶段**仅支持单机单用户**，不预留 syncState / vector clock / 设备 id 等字段。

但**保留 3 处最小预留入口**：
- ✓ Edge attrs 强制带 `createdBy: string`（已在 [`relations/spec.md §3.1`](../relations/spec.md) 实现）
- ✓ atom 实体壳加 `createdBy: string`（[`spec.md §1.2`](spec.md)）
- ✓ StorageAPI 接口支持可选 `ownerId` 参数（[`decisions/008`](decisions/008-storage-layer-interface.md)）

这 3 处为未来叠加用户身份 / 多设备同步留**接口入口**，不引入实现复杂度。

---

## 2. 目录结构

```
persistence/
├── README.md                              本文件
├── spec.md                                ✓ Phase 3a — 持久化总规范（实体壳 / 后端中立 / 字段优先级）
├── atom-entity.md                         ✓ Phase 3a — atom 实体 schema 详定义
├── edge-entity.md                         ⏳ Phase 3c — edge 实体 schema 详定义
├── decisions/
│   ├── 006-id-generation.md               ⏳ Phase 3b — id 生成策略
│   ├── 007-storage-target.md              ⏳ Phase 3b — 存储后端选型（SurrealDB vs SQLite vs ...）
│   ├── 008-storage-layer-interface.md     ⏳ Phase 3c — StorageAPI 接口设计
│   ├── 009-migration-strategy.md          ⏳ Phase 3c — V2 现状迁移策略
│   └── 010-multi-user-multi-device.md     ⏳ Phase 3c — 单机单用户决议 + 未来扩展入口
└── surreal-schema.md                      ⏳ Phase 3d — SurrealDB 表设计（按 007 选型展开）
```

---

## 3. Phase 3 推进计划（4 阶段 / 4 commit）

按 Phase 2c 经验，分 4 个 commit 渐进：

| 阶段 | 产出 | 行数 | 状态 |
|---|---|---|---|
| **Phase 3a** | README + spec.md + atom-entity.md | ~900 行 | 📝 撰写中 |
| **Phase 3b** | decisions/006 + 007 | ~600 行 | ⏳ |
| **Phase 3c** | decisions/008 + 009 + 010 + edge-entity.md | ~1000 行 | ⏳ |
| **Phase 3d** | surreal-schema.md（按 007 结果展开） | ~500 行 | ⏳ |

每阶段独立 commit + audit 通过后下一阶段。

---

## 4. 与其他文档的关系

| 上游 | 本目录如何引用 |
|---|---|
| `atom/spec.md` §1.1 Atom 数据 vs 实体 | spec.md §1 实体壳定义直接对接 |
| `atom/decisions/003` 走法 B | edge-entity.md 中边作为一等公民的持久化 |
| `relations/spec.md` §3 Edge attrs | edge-entity.md 继承全部 attrs 字段 |
| `naming-conventions.md` §2.11 边 attrs 命名 | 实体元属性命名沿用 |
| V1 `src/main/storage/`（V1 已有 SurrealDB 实现） | surreal-schema.md 设计参考 |

---

## 5. V2 当前持久化现状（待解决）

V2 当前持久化 = **9 个独立 store**，互不相通：

**Renderer 端（4 个 localStorage）**：
- `krig.notes`（noteStore）—— 笔记
- `krig.folders`（folderStore）—— 文件夹
- `krig-v2-workspace-state`（workspaceManager）—— Workspace 框架壳
- inspector 浮窗位置等局部状态

**Main 端（5 个磁盘 JSON）**：
- `~/Library/Application Support/KRIG Note/krig-data/graph/` —— 画板
- `~/Library/Application Support/KRIG Note/krig-data/ebook/` —— 书架
- `~/Library/Application Support/KRIG Note/krig-data/ebook/annotations/` —— 注解
- `~/Library/Application Support/KRIG Note/krig-data/learning/` —— 生词
- `~/Library/Application Support/KRIG Note/krig-data/media/` —— 媒体文件

**问题**：
- 数据形态各自独立，跨 store 无统一 atom / edge 概念
- 跨 atom 关系（如 noteLink / linksTo / 派生）只能在单个 store 内表达
- 不支持图查询 / 推理（vision.md §2 KRIG 核心愿景被阻断）

**目标态**：统一到 StorageAPI 抽象 + 单一后端（推荐 SurrealDB，待 decision 007 拍板）。

详 [`decisions/009-migration-strategy.md`](decisions/009-migration-strategy.md)（Phase 3c）。

---

## 6. Open Questions（整个 Phase 3）

| 编号 | 问题 | 解决阶段 |
|---|---|---|
| Q3 (atom/spec.md §6) | atom 实体元属性 schema | Phase 3a `atom-entity.md` |
| W3 (decision 002) | id 生成策略（ULID / UUID v7 / 保留 V1） | Phase 3b `decisions/006` |
| E5 (relations/spec.md §8) | edge id 是否必需 | Phase 3c `edge-entity.md` |
| 路径决议 | V2 现状 → 目标态如何迁移 | Phase 3c `decisions/009` |
| 后端选型 | SurrealDB / SQLite / JSON / 等 | Phase 3b `decisions/007` |
| 多用户预留 | 仅最小入口预留 + 拒绝其他预留备忘 | Phase 3c `decisions/010` |

---

## 7. 下一步

按 Phase 3 推进计划：

1. **Phase 3a 进行中** —— 写完本文件 + spec.md + atom-entity.md
2. **Phase 3a commit + audit**
3. **Phase 3b 启动** —— 写 decisions/006 + 007
4. 依次递进

---

**Phase 3 vs Phase 1/2 的延续**：所有规范都是为了让 V2 数据建模"语义层规范完整 + 实体落地清晰 + 后端切换零成本"，跟 vision.md §2.4 KRIG 闭环目标一脉相承。
