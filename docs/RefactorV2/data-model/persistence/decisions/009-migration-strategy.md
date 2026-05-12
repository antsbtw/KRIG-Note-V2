# Decision 009 — V2 现状 → 目标态迁移策略

> **Phase**: 3c
> **状态**: ✅ **已转正**（2026-05-12）—— 渐进迁移 4 sub-phase 策略获用户拍板
> **影响**: 未来 V2 storage 层实施 + 各 store 改造顺序

---

## 0. 决议背景

V2 当前持久化现状（参见 [`persistence/README.md §5`](../README.md)）：

- **9 个独立 store**：renderer 端 4 个 localStorage + main 端 5 个磁盘 JSON
- noteStore 未走持久化（leveldb 实测从未 save 成功）
- 跨 store 无统一 atom / edge 概念

目标态（按 [decision 007](007-storage-target.md)）：

- **SurrealDB 单后端**（Embedded 优先 / Sidecar fallback）
- **StorageAPI 抽象接口**（按 [decision 008](008-storage-layer-interface.md)）统一 9 store

本决议设计**从现状到目标态的迁移路径**。

## 1. 关键事实

### 1.1 V2 无真实用户数据

按 [decision 004 §3 N7](../../atom/decisions/004-phase2b-resolutions.md) 决议：**V2 当前阶段无真实用户数据**。

→ **迁移数据成本 ≈ 0**（按 N7：测试数据可丢，重建即可）。

### 1.2 9 store 已稳定运行

虽然 noteStore 未真正 save，但其他 8 store（folder / workspace / graph / ebook / annotation / vocab / media / inspector）都在 V2 业务路径中实际工作。

→ **不能一次性切换** —— 用户启动 V2 仍要能看到画板 / 书架 / 生词等业务功能。

### 1.3 V1 已有 SurrealDB schema

V1 `src/main/storage/schema.ts` 含完整 schema（note / folder / vocab / activity / ebook 等），可作 V2 schema 设计参考。

## 2. 迁移策略对比

### 2.1 选项 A：一次性切换

**做法**：一个 PR 把 9 store 全部切到 SurrealDB + StorageAPI。

**评估**：

- ✗ 一次性破坏面大（V2 应用所有功能依赖）
- ✗ 调试 / 回滚困难
- ✗ 风险集中
- ✓ 时间最短

→ **不推荐**。

### 2.2 选项 B：渐进迁移（推荐）

**做法**：每次迁一个 store，每次都是独立 commit + 独立审计 + 独立可发布。

**评估**：

- ✓ 风险分散
- ✓ 每步可回滚
- ✓ 跟 L6-block-decomposition 成功模式一致
- ✗ 时间长（9 store 至少 9 个 sub-phase）

→ **推荐**。

### 2.3 选项 C：保留多 store + 仅做 StorageAPI 抽象

**做法**：StorageAPI 接口落地，但每个 store 仍走自己原本的后端（noteStore localStorage / graphStore main JSON），StorageAPI 只是统一接口层。

**评估**：

- ✓ 改动最小
- ✗ 失去 SurrealDB 图查询能力（vision.md §2.4 闭环核心需求失败）
- ✗ 仍 9 store 孤岛

→ **不推荐**（违背 V2 持久化目标态）。

## 3. 推荐方案：选项 B 渐进迁移

### 3.1 阶段划分

V2 9 store 按业务复杂度分 4 个 sub-phase 迁移：

#### Sub-phase 1: SurrealDB 基础设施 ✅ 已完成

**状态**: ✅ 已实施完成（2026-05-12，13 commits / [decision 011](011-sub-phase-1-surrealdb-infrastructure.md)）

**任务**：
- ✅ 引入 SurrealDB —— sub-phase 1 实施期间 EM1 触发，实际采用 **Sidecar only** 模式（详 [decision 007 §4.2](007-storage-target.md) 事实纠错）
- ✅ 实施 `src/storage/api.ts` —— StorageAPI 接口
- ✅ 实施 `src/storage/surreal/` —— SurrealStorage 实现
- ✅ atom + edge 基础 schema（按 [Phase 3d surreal-schema.md](../surreal-schema.md) 设计）
- ✅ Health check / 数据目录初始化
- ✅ 新增 V2 productName 隔离（"KRIG Note" → "KRIG Note V2"）

**完成判据**：
- ✅ `npm start` 跑通，SurrealDB 启动成功（3 次连续冷启动验证）
- ✅ 冷启动时延 < 3 秒（实际 578-1102ms）
- ✅ 写入 / 读取一致性 EM4 验证通过

**不在范围（已保留）**：业务 store 改造（保留 9 store 现状，sub-phase 2-4 处理）

#### Sub-phase 2: noteStore + folderStore 迁移（最优先）

**任务**：noteStore + folderStore 改走 StorageAPI

**理由优先做这两个**：
- noteStore 当前实际未 save（bug fix 同时升级架构）
- folderStore 跟 noteStore 紧耦合（folderId 引用），一起迁移避免半完成态
- 笔记是 V2 核心功能，迁移完成验证最有意义

**完成判据**：
- 新建笔记 / 编辑 / 关闭重启 → 笔记保留 ✓（解决早期对话提到的"笔记找不到"问题）
- 文件夹层级正确
- 跨 workspace 笔记共享正确

#### Sub-phase 3: graphStore + ebookStore + annotationStore 迁移

**任务**：画板 / 书架 / 注解 store 改走 StorageAPI

**理由优先级**：业务复杂度中等，跟 note / folder 已迁移功能解耦

#### Sub-phase 4: 剩余 store 迁移

- workspaceStore（pluginStates 跟笔记关联）
- vocabStore（生词）
- mediaStore（媒体文件 —— 注意 media 是大文件存储，可能保留单独后端）
- inspectorStore（浮窗位置等局部 UI 状态）

**注意**：`mediaStore` 是大文件二进制存储，**未必迁 SurrealDB**（SurrealDB 适合元数据，不适合大 BLOB）。decision 008 §5.1 cascade 策略对 media 文件特殊处理待 Sub-phase 4 决议。

`inspectorStore` 是 UI 局部状态，**可能保留 localStorage**（不需要图查询能力，单纯 KV 即可）。

### 3.2 时间预估

每个 sub-phase 预计独立 PR：

| Sub-phase | 预估工程量 | 风险 |
|---|---|---|
| 1（基础设施） | 1-2 周 | 高（SurrealDB 引入 + 接口设计） |
| 2（note + folder） | 1 周 | 中（核心功能） |
| 3（graph + ebook + annotation） | 1-2 周 | 中 |
| 4（剩余 store） | 1 周 | 低 |

**总计**：约 4-6 周（实施 Phase，非本 Phase 3 文档阶段）。

### 3.3 每个 sub-phase 的纪律

参考 L6-block-decomposition 成功模式：

- 独立 `feature/L7N-<store-name>-migration` 分支
- 独立设计文档（如 `data-model/persistence/migrations/note-folder.md`）
- 每个 sub-step commit + audit
- 完成后人工测试清单（参考 L6 §6 70+ 项测试模式）

## 4. 数据迁移决策

### 4.1 不迁移 V1 数据

V2 当前**不**从 V1 SurrealDB 导入历史数据（按 N7 决议）。

理由：
- V2 是新仓库，与 V1 平行开发
- 用户已知 V2 是测试环境

### 4.2 V2 自身的"旧数据"

V2 启动 sub-phase 2 时，用户**可能**有 V2 阶段创建的笔记 / 画板 / 等数据（虽然按 N7 视为测试数据）。

**处置策略**：

- **不写迁移工具**（成本 / 收益不匹配）
- **提供"清空数据"按钮**（用户自愿清空 leveldb / krig-data 后重启）
- **或自动清空 + 重建**（启动时检测 schema 版本不匹配自动清空）

→ Sub-phase 2 实施时具体决议（Phase 3 RFC 不锁死）。

### 4.3 未来真正用户阶段的迁移

如果未来 V2 有真实用户数据需要迁移到新 schema（schema breaking change）：

- 按 SurrealDB schema versioning + migration script 标准做法
- 不在 Phase 3 RFC 范围（按需另开 decision）

## 5. 灰度发布策略

### 5.1 内测期

- 仅 wenwu 自己用，可接受 bug
- 每个 sub-phase 完成后用 1-2 周

### 5.2 实际用户期（未来）

未来如有外部用户：

- 灰度 5% 用户 → 监控崩溃率 / 性能 →  扩大
- 触发 [decision 007 §4.2.1 EM5 硬门槛](007-storage-target.md) → 切 Sidecar 模式

## 6. 风险与回滚

### 6.1 风险清单

| 风险 | 概率 | 影响 |
|---|---|---|
| SurrealDB Embedded 不稳定（触发 EM1-EM6） | 中 | 切 Sidecar，Sub-phase 1 延期 |
| sub-phase 2 noteStore 改造引入数据丢失 | 低 | 触发 §4.2 "清空数据 + 重建" |
| 9 store 间数据一致性问题（半迁移状态） | 中 | 严格按 sub-phase 顺序，不并行 |
| SurrealDB 性能问题（大量边写入） | 低 | 索引调优 / 物化视图（surreal-schema.md 设计） |

### 6.2 回滚机制

每个 sub-phase 独立分支 → 回滚 = 不合并该分支即可。

实施代码层面（参考 L6 模式）：
- main 分支始终保持可工作版本
- sub-phase 分支审计通过才合并

## 7. Open Questions

| 编号 | 问题 | 临时默认 | 解决时机 |
|---|---|---|---|
| MS1 | mediaStore 二进制大文件是否走 SurrealDB？ | **暂不**（保留 main 进程磁盘文件，SurrealDB 只存 metadata） | Sub-phase 4 决议 |
| MS2 | inspectorStore 等纯 UI 状态是否走 SurrealDB？ | **保留 localStorage**（无图查询需求） | Sub-phase 4 决议 |
| MS3 | sub-phase 2 noteStore 迁移时是否提供"导出 V2 旧数据" 按钮？ | **不提供**（V2 视为测试） | Sub-phase 2 实施时决议 |
| MS4 | 是否需要 dual-write 期（同时写老 store + 新 SurrealDB）保险？ | **不 dual-write**（V2 无真实数据，直接切） | Phase N 真实用户期再决议 |

## 8. 影响清单

如本决议获批：

1. `persistence/README.md` §5 V2 现状下加"目标态：渐进迁移"引用
2. **未来 V2 代码改造**：按 §3.1 4 个 sub-phase 顺序执行，每个 sub-phase 独立分支 + 独立 audit + 独立 commit
3. 每个 sub-phase 启动前写迁移设计文档（参考 `decision 005 L6-block-decomposition` 模式）
4. 各 store 改造后 `9 store 现状` 描述在 `README.md §5` 同步更新

## 9. 参考来源

- [`persistence/README.md §5`](../README.md) V2 当前持久化现状
- [`decision 007`](007-storage-target.md) SurrealDB 选型
- [`decision 008`](008-storage-layer-interface.md) StorageAPI 接口
- [`atom/decisions/004 §3 N7`](../../atom/decisions/004-phase2b-resolutions.md) V2 无真实数据决议
- `src/main/storage/`（V1 SurrealDB 实施参考）
- L6-block-decomposition 成功模式（独立分支 + audit）
