# Decision 007 — V2 存储后端选型

> **Phase**: 3b
> **状态**: ✅ **已转正**（2026-05-12）—— SurrealDB（Embedded 优先 / Sidecar fallback / 6 硬门槛）获用户拍板
> **影响**: `persistence/spec.md` + `persistence/surreal-schema.md` + 未来 V2 storage 层实施

---

## 0. 决议背景

V2 持久化层目标态需要选定**单一后端**作为主存储。本决议比选候选方案，推荐 V2 实施目标。

V2 当前持久化现状（参见 [`persistence/README.md §5`](../README.md)）：

- **9 个独立 store**，互不相通
- Renderer 端 4 个 localStorage + Main 端 5 个磁盘 JSON
- noteStore 未走持久化（leveldb 实测从未 save 成功）
- 不支持跨 atom 图查询 / 推理

→ 目标态：单一后端 + StorageAPI 抽象 + 支持图查询。

## 1. KRIG 业务对存储的核心需求

按 vision.md + Phase 1/2 规范累积的需求清单：

| 需求 | 详 | 重要性 |
|---|---|---|
| 跨 atom 图查询 | atom + edge 一等公民，按命名空间切片查询（walk 邻居 / 路径） | ★★★★★ vision.md §2 闭环根本依赖 |
| 全文检索 | 笔记内容全文搜索 | ★★★★ |
| 跨 domain 关联 | pm atom / rdf atom / embedding atom / three atom 共存查询 | ★★★★ |
| 事务 | 创建 atom + 多条边的原子写入（走法 B 物化） | ★★★★ |
| 后端中立 | StorageAPI 接口隔离，后端可换 | ★★★ |
| 单机本地 | vision.md §8 明确 v1.x 单人本地优先 | ★★★★ |
| 启动稳定性 | 不引入 sidecar 进程崩溃 / 孤儿进程问题 | ★★★ |
| 备份 / 导出 | 用户可备份 / 导出本地数据 | ★★★ |
| 嵌入式部署 | 集成到 Electron 单进程 / IPC，无外部依赖 | ★★★ |

## 2. 候选方案比选

### 候选 1：SurrealDB（V1 已用）

**形态**：multi-model（document + graph + key-value），支持 SurrealQL（类 SQL + 图查询语法）。

**部署模式**：
- Sidecar 进程（V1 用，spawn 独立 binary，WebSocket 连接 `ws://127.0.0.1:8532/rpc`）
- Embedded（V1 未试，`surrealdb-node` 包，单进程内）

**评估**：

| 维度 | 评分 |
|---|---|
| 图查询原生支持 | ★★★★★ RELATE 边 + graph traversal 一等公民 |
| 全文检索 | ★★★★ 内置全文索引 |
| 跨 domain | ★★★★★ schemaless 表 + 字段分派 |
| 事务 | ★★★★ ACID 事务 |
| 启动稳定性 | ★★ Sidecar 模式有孤儿进程问题（V1 已踩坑，详 memory [project_surreal_defensive_startup](../../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/project_surreal_defensive_startup.md)） |
| 嵌入式部署 | ★★★★ Embedded 模式可，但成熟度待验证 |
| 备份导出 | ★★★★ surreal export CLI |
| V1 经验 | ★★★★★ 已有完整实施（`src/main/storage/`，参见 V1 调研报告） |
| 生态成熟度 | ★★★ 相对年轻（2022 年开源，2024 SurrealDB 2.0） |

**优点**：
- 图查询原生支持（与 vision.md 闭环目标 100% 对齐）
- V1 已有完整实施可参考（schema / IPC / Sidecar 启动 / 孤儿清理）
- multi-model 一站式：文档 + 图 + KV 一个后端搞定

**缺点**：
- Sidecar 启动复杂度（V1 已记录孤儿进程问题）
- 相对年轻，生态 / 文档 / 第三方工具不如 SQLite 成熟
- Embedded 模式（`surrealdb-node` 包）若不成熟则只能走 Sidecar

### 候选 2：SQLite（+ 自实现图查询层）

**形态**：嵌入式 SQL 数据库，单文件存储。

**评估**：

| 维度 | 评分 |
|---|---|
| 图查询原生支持 | ★ 无原生图查询，需手写递归 CTE 或应用层递归 |
| 全文检索 | ★★★★★ FTS5 extension 业界最佳 |
| 跨 domain | ★★★ 需要手写 schema 表 + 字段约束 |
| 事务 | ★★★★★ ACID + WAL 模式成熟 |
| 启动稳定性 | ★★★★★ 单文件嵌入，无 sidecar |
| 嵌入式部署 | ★★★★★ Electron `better-sqlite3` 包业界标杆 |
| 备份导出 | ★★★★★ 单文件复制即备份 |
| V1 经验 | ✗ V1 无 SQLite 实施 |
| 生态成熟度 | ★★★★★ 30 年历史，无可替代 |

**优点**：
- 极其稳定（每天数十亿设备运行）
- 单文件嵌入式，零 sidecar，启动复杂度低
- 备份导出简单（用户复制单个 `.db` 文件即可）

**缺点**：
- **无原生图查询** —— vision.md §2 KRIG 闭环根本依赖图查询。SQLite 表达图关系需要：
  - 用 edge 表 + 递归 CTE 模拟图遍历
  - 或应用层手写图查询逻辑
  - 性能上扁平表 + 递归 CTE 在小图（< 万节点）OK，大图扩展性差
- 自实现图查询 = **重新发明轮子**，违反 V2 charter.md §1.3 "用最成熟的"原则

### 候选 3：DuckDB

**形态**：嵌入式 OLAP 数据库（类 SQLite，但面向分析）。

**评估**：

| 维度 | 评分 |
|---|---|
| 图查询原生支持 | ★★ 有 graph extension（实验性） |
| OLAP 性能 | ★★★★★ 业界最佳分析性能 |
| 嵌入式部署 | ★★★★★ |
| 事务 | ★★★ 主要面向只读分析，事务支持有限 |
| 备份导出 | ★★★★ |
| V1 经验 | ✗ |
| 生态成熟度 | ★★★ 相对新（2019 年） |

**问题**：DuckDB 主要面向 OLAP（大批量分析），KRIG-Note 是 OLTP（频繁单条写入）场景，**职责不匹配**。

→ **不推荐**（除非未来加分析视图）。

### 候选 4：LevelDB / RocksDB

**形态**：嵌入式 KV 数据库。

**评估**：

| 维度 | 评分 |
|---|---|
| 图查询原生支持 | ✗ 纯 KV，无 SQL / 图能力 |
| 全文检索 | ✗ 需上层实现 |
| 嵌入式部署 | ★★★★ |
| 事务 | ★★★ |
| V1 经验 | ✗ |

**问题**：纯 KV 太底层，所有 schema / 索引 / 查询都要应用层实现。**不推荐**。

### 候选 5：保留多 store + 增加图查询中间层

**形态**：保留 V2 当前 9 store 各自存储，加一个图查询服务层。

**评估**：

**问题**：
- 9 store 各自仍是孤岛，跨 atom 查询要 N 次 IO
- 中间层缓存 / 同步逻辑复杂
- "看起来不动现状" 实际是隐藏复杂度

→ **不推荐**（违反 V2 重构原则）。

## 3. 候选对比矩阵

| 维度 | SurrealDB | SQLite | DuckDB | LevelDB | 多 store |
|---|---|---|---|---|---|
| 图查询原生 | ★★★★★ | ✗ | ★★ | ✗ | ✗ |
| 全文检索 | ★★★★ | ★★★★★ | ★★ | ✗ | ✗ |
| 事务 | ★★★★ | ★★★★★ | ★★★ | ★★★ | ✗ |
| 嵌入式 | ★★★★ | ★★★★★ | ★★★★★ | ★★★★ | ★★★ |
| 启动稳定 | ★★ | ★★★★★ | ★★★★★ | ★★★★ | ★★★★ |
| V1 经验 | ★★★★★ | ✗ | ✗ | ✗ | ✗ |
| KRIG 业务匹配 | ★★★★★ | ★★ | ★ | ✗ | ★ |

## 4. 推荐方案：SurrealDB（Embedded 模式优先）

V2 推荐采用 **SurrealDB**，**优先尝试 Embedded 模式**，Sidecar 模式作为 fallback。

### 4.1 论证

**核心理由**：

1. **图查询是 KRIG 核心需求**（vision.md §2.4 闭环 + 走法 B 物化），SurrealDB 是唯一原生支持的候选。
2. **V1 已有实施经验** —— `src/main/storage/` 已完整跑过 SurrealDB（schema / IPC / Sidecar）。V1 调研报告显示 V1 SurrealDB 集成稳定运行。
3. **multi-model 一站式** —— 不需要"图引擎 + 文档存储 + 全文索引"多套整合，降低运维复杂度。
4. **跟走法 B 物化**对齐 —— RELATE 边是 SurrealDB 一等公民，atom + edge 自然映射到 SurrealDB schema。

### 4.2 Embedded vs Sidecar 模式选择

V1 用 Sidecar 模式（spawn 独立 binary）。**V2 RFC 推荐**：

- **优先 Embedded 模式**（`surrealdb-node` 包，单进程内运行）
  - 优点：无孤儿进程问题（V1 已踩坑），启动简单
  - 缺点：包成熟度待验证（V1 未试过）
- **Sidecar 模式作为 fallback** —— 满足下列任一**硬门槛**时切换
  - 复用 V1 完整实施（`src/main/storage/client.ts:140-159` 含孤儿清理）

#### 4.2.1 Embedded → Sidecar 切换硬门槛

满足以下**任一**条件即判定 Embedded 不可行，切换 Sidecar：

| 编号 | 条件 | 判定方式 |
|---|---|---|
| EM1 | **package install 失败** | `surrealdb-node` npm install 失败（如 native binding 编译失败 / 平台不支持） |
| EM2 | **冷启动失败率 ≥ 3 次连续** | Phase 3 实施时跑冷启动 10 次测试，连续 3 次失败即触发 fallback |
| EM3 | **冷启动时延 > 3 秒** | 单次冷启动（从 V2 app 启动到 SurrealDB ready 事件）超 3 秒 |
| EM4 | **首次写入 + 读取一致性校验失败** | 启动后写入 test atom + 立即读取，数据不一致即视为不稳定 |
| EM5 | **崩溃率 ≥ 5%** | Phase 3 灰度阶段（用户内测）单日崩溃率超 5% |
| EM6 | **关键 SurrealQL 语法不支持** | Embedded 模式不支持 RELATE / graph traversal 等本规范依赖的核心特性 |

#### 4.2.2 验证时机

- **Phase 3d 实施 surreal-schema.md** 时跑 EM1-EM4 验证（开发环境）
- **Phase N 业务实施**（独立 Phase）时跑 EM5 / EM6 验证（用户测试 / 集成测试）

任何一条触发 → 直接切 Sidecar 模式（V1 已有完整实施），**不反复争论**。

#### 4.2.3 验证失败后的回退路径

| 触发条件 | 回退动作 |
|---|---|
| EM1-EM3（实施期发现） | Phase 3 RFC 阶段标 "Embedded 已验证不可行,改 Sidecar"，更新本决议 §4.2 |
| EM4-EM5（灰度期发现） | 紧急切 Sidecar；已写入 Embedded 的用户数据通过 SurrealDB 内置 export / import 迁移 |
| EM6（schema 实施期发现） | 立刻切 Sidecar，schema 不需要调整（SurrealDB SurrealQL 语法跨模式一致） |

→ Phase 3d `surreal-schema.md` 实施时优先试 Embedded，触发任一硬门槛即退 Sidecar。

### 4.3 接受的代价

- Sidecar / Embedded 启动复杂度（V1 已有应对方案）
- 相对年轻的生态（SurrealDB 2.0 2024 发布，成熟度比 SQLite 低）

→ V2 接受这些代价，**换图查询原生支持**。

## 5. 备选方案：如果 SurrealDB 不可行

虽然推荐 SurrealDB，但保留 fallback 路径：

**Fallback 1**：SQLite + 自实现图查询层
- 用 `better-sqlite3` 嵌入式数据库
- atom / edge 表 + 递归 CTE 实现图查询
- 适用条件：SurrealDB Embedded + Sidecar 都失败

**Fallback 2**：保留多 store 现状，仅做 StorageAPI 抽象
- 适用条件：完全无法引入新后端
- 跨 atom 图查询能力放弃（KRIG 核心愿景受损）

→ 这些是 **Plan B**，**首选 Plan A = SurrealDB**。

## 6. 拒绝的方案备忘

| 方案 | 拒绝理由 |
|---|---|
| DuckDB | OLAP 而非 OLTP，职责不匹配 |
| LevelDB / RocksDB | 纯 KV 太底层 |
| PostgreSQL / MySQL（服务端 RDBMS） | 需独立 server，违反 vision.md §8 单人本地优先 |
| Neo4j | 图数据库强，但需独立 server + 商业授权 |
| MongoDB | 文档数据库，无原生图查询 |
| 完全自研 | YAGNI，重新发明轮子 |

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| ST1 | SurrealDB 版本选择 1.x（稳定）vs 2.x（最新功能 / 较新）？ | **2.x** —— Phase 3 实施时确认最新 stable | Phase 3d 实施时确认 |
| ST2 | Embedded 模式（`surrealdb-node`）实际可用性？ | **Phase 3 RFC 假设可用**，Phase 3d 实施时验证 | Phase 3d |
| ST3 | 数据库文件位置：`{userData}/krig-data/surreal/` ？ | **是**（对齐 V1 现有目录约定） | Phase 3d |
| ST4 | 启动失败时 fallback 策略（SurrealDB 崩溃 / 文件损坏）？ | 显示错误界面 + 提供"导出现有数据"按钮，不静默切 fallback | Phase 3 实施时确认 |
| ST5 | SurrealDB 不同 namespace / database 是否用于多用户预留？ | **暂不预留**（按 [decision 010](010-multi-user-multi-device.md) 路径 B）；未来真实多用户引入时再决议 | Phase 3c decision 010 |

## 8. 影响清单

如本决议获批：

1. `persistence/spec.md` 后端中立部分加 "V2 当前推荐 SurrealDB" 说明
2. `persistence/surreal-schema.md`（Phase 3d）正式启动 schema 设计
3. **未来 V2 代码改造**（独立 Phase）：
   - 引入 `surrealdb` npm 包（Embedded 模式）或 SurrealDB binary（Sidecar 模式）
   - 实施 `src/storage/surreal/` —— 客户端 + schema init + 迁移
   - 9 个 store 逐个对接 StorageAPI（详 Phase 3c decision 009 迁移策略）
4. 数据目录：`{userData}/krig-data/surreal/`

## 9. 参考来源

- [SurrealDB 官方文档](https://surrealdb.com/docs)
- [SurrealDB Node.js SDK](https://github.com/surrealdb/surrealdb.js)
- V1 实施：`src/main/storage/`（client.ts / schema.ts / 等）
- V1 调研报告（早期对话产出）：V1 SurrealDB Sidecar 模式 / WebSocket 集成 / schema 设计完整记录
- vision.md §2.4 KRIG 闭环（图查询根本需求）
- [memory project_surreal_defensive_startup](../../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/project_surreal_defensive_startup.md)（孤儿进程清理经验）
