# src/storage — 存储层 (SurrealDB Sidecar)

> **纵向类目**: 存储层
> **横向 L 层**: L7 (main 进程持久化基础设施)
> **当前状态**: ✅ Sub-phase 1 基础设施完成 (业务 store 未接入)

完整规范见 [`docs/RefactorV2/data-model/persistence/`](../../docs/RefactorV2/data-model/persistence/);
本 sub-phase 实施任务见
[`decisions/011-sub-phase-1-surrealdb-infrastructure.md`](../../docs/RefactorV2/data-model/persistence/decisions/011-sub-phase-1-surrealdb-infrastructure.md)。

---

## 实施状态 (Phase N sub-phase 1 完成)

- ✓ `api.ts` — `StorageAPI` 接口 + 完整类型 (atom/edge CRUD + querySubgraph + transaction + health)
- ✓ `ulid.ts` — ULID id 生成 (monotonic factory, uppercase, 26 字符 Crockford Base32)
- ✓ `surreal/client.ts` — Sidecar 模式 (Embedded 升级留未来 sub-phase),含防御性启动 (孤儿进程清理 + LOCK 清理)
- ✓ `surreal/schema.ts` — atom + edge + schema_version 三表 SCHEMAFULL,全 `IF NOT EXISTS` 幂等
- ✓ `surreal/storage.ts` — `SurrealStorage` 实现 `StorageAPI`
- ✓ `migrations/runner.ts` — schema migration runner
- ✓ `index.ts` — `storage` 单例 + `initStorage` / `shutdownStorage`
- ✓ Main 进程启动接入 (`src/platform/main/index.ts`)
- ✓ EM1-EM4 硬门槛验证通过 (npm install / 3 次冷启动稳定 / 时延 < 3s / 读写一致)

---

## 下一步 (sub-phase 2-4)

- **sub-phase 2**: noteStore + folderStore 迁移,EVENT 触发器 cascade delete 验证 + 落地
- **sub-phase 3**: graphStore + ebookStore + annotationStore
- **sub-phase 4**: 剩余 store + 真实数据迁移

---

## 调用边界 (decision 008 §4.0)

- **View 层禁止** 直接 `import @storage/*`
- **Capability / Platform 层** 可 import
- 业务层通过 capability API 间接访问

import 路径用 `@storage/index` (tsconfig paths 是 `@storage/*` glob, 不接受裸 `@storage`)。

---

## 配置约束

- **SurrealDB binary**: `build/surreal/<platform-arch>/surreal` (dev 模式) 或 Homebrew `/opt/homebrew/bin/surreal`
- **binary 版本**: 实测 3.0.4 (与 V1 一致)
- **client SDK**: `surrealdb@^2.0.3` (与 binary 3.x 跨版本兼容,V1 已验)
- **连接端口**: 127.0.0.1:8533 (V2 专用,V1 占 8532 不冲突)
- **userData 路径**: `~/Library/Application Support/KRIG Note V2/krig-data/surreal/`
  (productName "KRIG Note V2" 与 V1 隔离,Step 5.1.5)
- **凭据**: 首次启动随机生成 24 字节密码,持久化到 userData `.db-credentials`

---

## SurrealDB binary 3.0.4 与文档预期的差异 (Step 5.12 验证发现)

decision 011 / surreal-schema.md 写作时基于的语法在 3.0.4 binary 上 4 处需调整,均已在 commit
`e3877a6` 修复并注释说明:

1. `DEFINE INDEX ... WHERE` (partial index) → 不支持,改全索引
2. `DEFINE TABLE/FIELD/INDEX` 重复定义 → 报 AlreadyExistsError,全部加 `IF NOT EXISTS`
3. `CREATE schema_version` 重复执行 → UNIQUE 冲突,改 `UPSERT` + RecordId 绑定
4. SCHEMAFULL 表 id 字段是 record id 类型,不是 string → storage.ts 改用 `new RecordId('atom', id)`
   实例绑定 + `SELECT FROM $rid` 语法
