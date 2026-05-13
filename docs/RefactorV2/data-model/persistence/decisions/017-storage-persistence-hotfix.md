# Decision 017 — Sub-phase 1 Storage 持久化 Hotfix

> **Phase**: N（实施 Phase）/ Hotfix（跨越 Sub-phase 1 + 3a-1）
> **状态**: ✅ **已实施完成 + binary verify 三层实证 + 反向更新完成,授权合 main**(commits `e6b5ca3` + `04a5c5e` + 决议 + 反向更新 3 commit)
> **设计师 / 审计师**: 总指挥(main)
> **诊断 + 实施**: `debug/persistence-probe` 分支 → `fix/storage-persistence-hotfix` 分支
> **决议日期**: 2026-05-13
> **暴露日期**: 2026-05-12(sub-phase 3a-2.5 Checkpoint 2 期间用户报"shape 跨重启全丢")
>
> ## TL;DR
>
> Sub-phase 3a-2.5 实施期间用户报 P1 持久化丢失,经字面 grep 复核 + binary
> 实测,确认两个独立 P0 bug,均位于 sub-phase 1 / 3a-1 代码,跟 3a-2.5 业务无关:
>
> | Bug | 位置 | 影响 |
> |---|---|---|
> | **P0a** | [storage.ts:114](../../../../../src/storage/surreal/storage.ts#L114) putAtom UPDATE-only | view 端推 client id 的 graph instance 永远写不进数据库,**真实数据丢失** |
> | **P0c** | [runner.ts:32](../../../../../src/storage/migrations/runner.ts#L32) SELECT 3.0.4 不兼容 + catch 静默 | currentVersion 永远 fallback '0.0.0',MIGRATIONS 每次启动全跑;**不丢数据**但浪费 + 埋诊断 |
>
> 先前怀疑的 sidecar shutdown 不 await(P0b)**经 binary 实测排除** — RocksDB 持久化健全,
> schema_version 1.2.0 行跨重启完整保留。该假设作废。
>
> 本 hotfix 不动 sub-phase 3a-2.5 分支,3a-2.5 在 017 合 main 后由实施者 session
> rebase / merge main 恢复 Step 5.5+ 推进。

---

## 0. 执行指南

### 0.1 角色与流程

```
sub-phase 3a-2.5 实施者(暂停)
    ↓ 报 P1 持久化丢失
排查对话(本对话)
    ↓ 起 debug/persistence-probe 加探针(IPC dump + check-persistence 脚本)
    ↓ 实测三轮,事实层确认 P0a + P0c,排除 P0b
    ↓
总指挥(批复)
    ↓ 拍板修法:P0a UPSERT;P0c SELECT 加 appliedAt + catch 不静默
    ↓
排查对话(本对话)
    ↓ 起 fix/storage-persistence-hotfix(基于 main 60e1229)
    ↓ 两个 commit 实施修复
    ↓ 写本决议 017
    ↓ 报"017 hotfix 实施完成请审计"
    ↓
总指挥
    ↓ 静态复核 + 协调用户跑 binary verify 2 场景
    ↓ 通过 → 合 main + push → 反向更新决议链 011 / 014
    ↓
sub-phase 3a-2.5 实施者(恢复)
    ↓ merge main 拉 storage 修复 → 继续 Step 5.5+
```

### 0.2 实施纪律(本次已遵守)

1. 起独立分支 `fix/storage-persistence-hotfix` 基于 main `60e1229`
2. **不在** `debug/persistence-probe` 上继续做(诊断探针留 debug 分支作历史)
3. **不在** `feature/L7-sub3a-2.5-note-form-upgrade` 上做(避免违反分支按模块切纪律)
4. 每个 bug 一个 commit,commit message 按 KRIG-Note V2 规范

---

## 1. 问题字面描述 + 实证证据

### 1.1 P0a — putAtom UPDATE-only,view client id 路径全部失败

**字面位置**:[`src/storage/surreal/storage.ts:114-122`](../../../../../src/storage/surreal/storage.ts#L114)(修复前)

```ts
if (input.id) {
  const result = await db.query<...>(
    `UPDATE $rid SET payload = $payload, updatedAt = $now RETURN AFTER`,
    { rid: atomRid(input.id), payload: input.payload, now },
  );
  const row = result[0]?.[0];
  if (!row) throw new Error(`Atom ${input.id} not found`);
  ...
}
```

**触发链**:[`canvas-store.ts:535-549`](../../../../../src/platform/main/graph/canvas-store.ts#L535)

```ts
const instId = typeof inst.id === 'string' ? inst.id : null;
if (!instId) {
  await createInstance(id, inst, /*targetId*/ null);  // 走 CREATE,OK
  continue;
}
...
// 新增 (view 端可能预先生成了 client-side id;storage putAtom 允许传 id)
await createInstance(id, inst, instId);   // ← 走 UPDATE,新 record 抛
```

注释字面表明 canvas-store 期望 putAtom 支持"传 client id 新建",但 putAtom 实际契约
是 UPDATE-only(传 id = 必须已存在)。设计意图与实现错位。

**实证(2026-05-13 03:57 探针 dump)**:

```
canvas.id:   01KRFQNEVZKT39C1VFEX9YYBQZ
instances:   1 个
  - id=i-001 ref=krig.basic.hexagon
error:       Error: Atom i-001 not found
durationMs:  9
```

`/tmp/krig-debug-last.json` 含完整入参 — view 端推了 `id=i-001` 的 hexagon,
putAtom UPDATE 找不到 rid 立即抛,**整个 graph.save 失败回滚,instance 不入库**。

数据库实际状态(`npm run check-persistence` 修脚本 bug 后):
```
atom 表: 3 条
  - domain=graph-canvas  count=1
  - domain=graph-instance  count=1   ← 不是这次 hexagon,是更早会话的残留
  - domain=pm  count=1
```

`i-001` 在 atom 表用 `type::record('atom:\`i-001\`')` 字面查询不存在 — 实锤未入库。

### 1.2 P0c — runner SELECT 3.0.4 不兼容 + catch 静默吞掉错误

**字面位置**:[`src/storage/migrations/runner.ts:32-38`](../../../../../src/storage/migrations/runner.ts#L32)(修复前)

```ts
let currentVersion = '0.0.0';
try {
  const versionRes = await db.query<[Array<{ version: string }>]>(
    `SELECT version FROM schema_version ORDER BY appliedAt DESC LIMIT 1`,
  );
  currentVersion = versionRes[0]?.[0]?.version ?? '0.0.0';
} catch {
  // schema_version 表还不存在 — 视为 0.0.0,后续 initSchema 会创建它
}
```

**实证(2026-05-13 binary 直查)**:

```bash
curl -X POST http://127.0.0.1:8533/sql \
  -H "surreal-ns: krig" -H "surreal-db: krig_note_v2" \
  --data 'SELECT version FROM schema_version ORDER BY appliedAt DESC LIMIT 1;'
```

返回:

```json
{
  "code": 400,
  "information": "Parse error: Missing order idiom `appliedAt` in statement selection\n --> [1:45]\n  |\n1 | SELECT version FROM schema_version ORDER BY appliedAt DESC LIMIT 1;\n  |                                             ^^^^^^^^^^^^^^"
}
```

SurrealDB 3.0.4 要求 ORDER BY 字段须出现在 SELECT 投影中(否则称 "missing order idiom")。

后果:每次启动 try 块 SQL parse 失败 → catch 静默 → `currentVersion = '0.0.0'`
→ MIGRATIONS 列表全部满足 `compareVersions('0.0.0', mig.version) < 0` → 全部 up()。

**数据库实测确认**(schema_version 表):
```
- 1.0.0  appliedAt=2026-05-13T03:55:50.826Z  ← 这次启动 UPSERT 覆盖
- 1.1.0  appliedAt=2026-05-13T03:55:50.827Z  ← 这次启动 UPSERT 覆盖
- 1.2.0  appliedAt=2026-05-13T03:44:25.265Z  ← 上次启动 sub-phase 3a-2.5 写入,**跨重启完整保留**
```

1.2.0 行存活证明:RocksDB 持久化健全,先前 P0b 假设(sidecar shutdown 不 await
丢数据)**不成立**;data loss 完全由 P0a 一处导致。

每次启动重跑 1.0.0/1.1.0 不丢数据,因为:
- `DEFINE TABLE/FIELD/INDEX IF NOT EXISTS` 重复执行无副作用
- `UPSERT schema_version:1.0.0 SET ...` 同 record id,只刷新 appliedAt

但 catch 静默吞 parse error 这一点本身是反 debug 模式 — 未来真出 SQL 语法 bug
也会被埋,**修法必须连 catch 一并改**。

### 1.3 排除项 P0b — sidecar shutdown 不 await

诊断早期怀疑 [`client.ts:260-275`](../../../../../src/storage/surreal/client.ts#L260) 同步 `shutdownSurrealDB()`
在 Electron `before-quit` 不 await,300ms `setTimeout` SIGKILL 在主进程退出后
根本不执行,可能导致 RocksDB WAL flush 中断。

**binary 实测排除**:
- 用户多次 graceful Cmd+Q + 重启
- schema_version 1.2.0 行跨多次启动完整保留,appliedAt 未变
- atom 表的 graph-canvas / graph-instance / pm 3 条 atom(来自更早会话)未丢失

RocksDB SIGTERM 后默认会 fsync WAL,300ms 实测足够 flush 当前数据量。
当前数据量小时不踩,但**写量大 / SIGTERM 时长不够时可能踩** — 列入 §9 Q-P3 留独立 issue。

---

## 2. 修法拍板 + 工程量

### 2.1 P0a 修法 — putAtom 改 UPSERT 短路语义

**文件**:`src/storage/surreal/storage.ts:114-122`

**修法**:`UPDATE` → `UPSERT`,createdAt / createdBy 用 `field OR $val` 短路:

```ts
if (input.id) {
  const result = await db.query<...>(
    `UPSERT $rid SET
       createdAt = createdAt OR $now,
       updatedAt = $now,
       createdBy = createdBy OR $ownerId,
       payload = $payload
     RETURN AFTER`,
    { rid: atomRid(input.id), payload: input.payload, now, ownerId },
  );
  ...
}
```

**语义**:
- `createdAt = createdAt OR $now` — record 不存在时 `createdAt` 为 NONE,OR 短路取 `$now`;存在时保留原值
- `createdBy = createdBy OR $ownerId` — 同上
- `updatedAt = $now` / `payload = $payload` — 总是覆盖

**3.0.4 兼容性验证**(§6.1 已 binary 实测):
- TEST 1 不存在 record:`createdAt = createdAt OR 1000` → createdAt=1000 ✓
- TEST 2 已存在 record:`createdAt = createdAt OR 9999` → createdAt=1000(保留)✓

**工程量**:1 处 SQL 语句改写 + 1 行 throw message 更新 + 注释。**13 行 +/- 3 行**。

### 2.2 P0c 修法 — runner SELECT 加 appliedAt + catch 不静默

**文件**:`src/storage/migrations/runner.ts:32-38`

**修法**:

```ts
try {
  const versionRes = await db.query<[Array<{ version: string; appliedAt: number }>]>(
    `SELECT version, appliedAt FROM schema_version ORDER BY appliedAt DESC LIMIT 1`,
  );
  currentVersion = versionRes[0]?.[0]?.version ?? '0.0.0';
} catch (err) {
  console.warn(
    '[storage/migrations] schema_version SELECT failed, treating as 0.0.0:',
    err,
  );
}
```

**3.0.4 兼容性验证**(§6.1 已 binary 实测):

```
SELECT version, appliedAt FROM schema_version ORDER BY appliedAt DESC LIMIT 1;
→ { "version": "1.1.0", "appliedAt": 1778644550827 }  ✓
```

**catch 不静默**:console.warn 暴露真实错误信息,future SQL 语法 bug 不会被埋。

**工程量**:1 处 SELECT 改写 + 类型注解扩展 + 1 个 console.warn + 注释。**12 行 +/- 4 行**。

### 2.3 不做的事

- **不动** sub-phase 3a-2.5 分支(实施者 session 自行 rebase / merge main)
- **不动** sidecar shutdown 路径(P3,§9 留 issue)
- **不动** canvas-store 写入路径(P0a 在 storage 层修足够,canvas-store 无需改)
- **不动** debug/persistence-probe 分支的探针 commit(留作历史)

---

## 3. 验证清单

### 3.1 静态验证(本对话已跑过)

- ✅ `npx tsc --noEmit` typecheck pass
- ✅ `npx eslint src/storage/surreal/storage.ts src/storage/migrations/runner.ts` lint clean
- ✅ binary 实测 UPSERT OR 短路两场景(新 record / 已存在 record)
- ✅ binary 实测 SELECT 加 appliedAt 修法语法通过

### 3.2 用户 binary verify(待跑,总指挥协调)

**场景 ① — graceful close + reopen 数据保留**

1. 关 V2 全部进程(包括 sidecar):
   ```
   pkill -f "KRIG Note V2"; pkill -f "surreal start"
   ```
2. 启动 V2(此分支 build):
   ```
   cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npm start
   ```
3. 在 graph 视图新建画板(标题 `verify-1`)
4. 在画板上拖 3-5 个 shape(普通 hexagon / rect / circle)
5. 拖一个文字节点输入"hotfix verify"
6. Cmd+Q **graceful** 退出
7. 等 5 秒,重启 V2(`npm start`)
8. 打开 `verify-1` 画板
   - **预期**:shape / 文字节点全部保留,位置 + 内容一致
9. 跑(可选,需用户预先 cherry-pick debug 探针的 scripts/check-persistence.js,
   不强制 — 直接看 UI 已可判定):
   ```
   curl -s -X POST http://127.0.0.1:8533/sql \
     -H "Authorization: Basic $(...)" \
     -H "surreal-ns: krig" -H "surreal-db: krig_note_v2" \
     --data 'SELECT count() AS n FROM atom GROUP ALL;'
   ```
   atom 表应有 ≥ 6 条(1 canvas + N shape instance + M pm)

**通过标准**:UI 上 shape 全部保留,数据库 atom 行数 ≥ 入参 instance 数。

**场景 ② — 启动 5 次 migration 只跑 1 次 console.log**

1. 已跑过场景 ① 的状态(数据库已有 schema_version 1.0.0 / 1.1.0 行)
2. Cmd+Q 退出
3. 重新启动 5 次,每次启动后立刻退出(可用 Cmd+Q),观察主进程日志
4. **预期**:第 1 次启动可能打 `applying 1.0.0` / `applying 1.1.0`(若数据库为空)
   或一条都不打(若已有 1.1.0 行);第 2-5 次启动**完全不再打** applying 日志
5. 不应再出现 `schema_version SELECT failed` warn(若出现说明 SQL 还有兼容问题)

**通过标准**:重复启动后 `applying` 日志在收敛后稳定不打。

### 3.3 回归验证 — 现有 atom CRUD 不破坏

- canvas 创建(`canvasStore.create()` → putAtom 不传 id):应仍走 CREATE 路径
  - 修法 1 的 UPSERT 改动只影响 `input.id` 路径,不传 id 的 CREATE 路径未动 ✓
- canvas 重命名 / 更新(`canvasStore.rename / update` → putAtom 传 id 已存在 record):
  应仍 UPDATE 现有 record,createdAt 保留原值,updatedAt 刷新
- note pm atom 创建 / 更新:同上

---

## 4. 实施 commit 链

| Commit | 内容 | 文件 |
|---|---|---|
| `e6b5ca3` | fix(storage): UPSERT putAtom 语义 — 修 P0a | `src/storage/surreal/storage.ts` |
| `04a5c5e` | fix(storage/migrations): runner SELECT 3.0.4 兼容 + catch 不静默 — 修 P0c | `src/storage/migrations/runner.ts` |

分支基础:main `60e1229`(Merge feature/L7-sub3a-2.5-decision-016)

---

## 5. (留空,本决议不涉及)

## 6. 验证证据(SurrealDB 3.0.4 binary 实测记录)

### 6.1 UPSERT OR 短路语义实测

**测试环境**:本机 `/opt/homebrew/bin/surreal` v3.0.4 + 用户 V2 sidecar 8533 / probe DB

**TEST 1 — 不存在的 record**:

```bash
curl -X POST http://127.0.0.1:8533/sql \
  -H "surreal-ns: krig" -H "surreal-db: test_upsert_probe" \
  --data 'UPSERT probe:t1 SET
    createdAt = createdAt OR 1000,
    updatedAt = 2000,
    createdBy = createdBy OR "alice",
    payload = { v: 1 } RETURN AFTER;'
```

返回:`{ createdAt: 1000, createdBy: "alice", updatedAt: 2000, payload: { v: 1 } }` ✓

**TEST 2 — 已存在的 record**(同一 probe:t1):

```bash
curl ... --data 'UPSERT probe:t1 SET
    createdAt = createdAt OR 9999,
    updatedAt = 3000,
    createdBy = createdBy OR "bob",
    payload = { v: 2 } RETURN AFTER;'
```

返回:`{ createdAt: 1000, createdBy: "alice", updatedAt: 3000, payload: { v: 2 } }` ✓

createdAt / createdBy 保留;updatedAt / payload 覆盖。短路逻辑符合预期。

### 6.2 runner SELECT 修法实测

```bash
curl -X POST http://127.0.0.1:8533/sql \
  -H "surreal-ns: krig" -H "surreal-db: krig_note_v2" \
  --data 'SELECT version, appliedAt FROM schema_version ORDER BY appliedAt DESC LIMIT 1;'
```

返回:`{ "version": "1.1.0", "appliedAt": 1778644550827 }` ✓

---

## 9. Open Questions

### Q-P3 — Electron before-quit 同步 shutdown 在写量大时是否够 flush?

**字面位置**:[`src/platform/main/index.ts:109-111`](../../../../../src/platform/main/index.ts#L109)
+ [`src/storage/surreal/client.ts:260-275`](../../../../../src/storage/surreal/client.ts#L260)

**当前实测**:小数据量(几 atom / 边)graceful Cmd+Q 后跨重启保留完整,RocksDB
WAL flush 在 300ms SIGTERM 窗口内完成。

**潜在风险**:
- 写量大(几千 atom / 大画板批量 save)时,主进程退出可能早于 RocksDB flush 完成
- SIGTERM 之后 300ms `setTimeout` SIGKILL 在主进程退出后**实际不执行**(主进程已死,定时器随之丢)
- `db.close()` 未 await,WS 最后批未确认写入可能丢

**触发条件**:
- 用户在画板上瞬间 batch 创建 200+ instance + Cmd+Q
- macOS launchd 在主进程退出后立刻收割 surreal 子进程
- 实测尚未出现,但写量上来后可能踩

**修法方向(留 sub-phase 后续)**:
- A:`before-quit` 改 `event.preventDefault() + await shutdownStorage()` + 完成后 `app.quit()`
- B:加 `serverProcess.unref()` 让 sidecar 跨主进程独立存活直到 RocksDB flush
- C:embedded 模式(等 surrealdb-js + @surrealdb/node 同主版本)消除主子进程边界

**优先级**:P3 — 实测无 reproducer,不卡 sub-phase 3a-2.5 恢复;留独立 issue
等写量提升 / 用户实测踩到后再做。

---

## 10. 反向更新清单

合 main 后必须更新以下决议链:

### 10.1 `decisions/011-sub-phase-1-surrealdb-infrastructure.md`

在文件顶部"实施过程偏离设计的事实纠错"表加 1 行:

| 偏离点 | 设计文档原写法 | 实际实施 | 原因 |
|---|---|---|---|
| **§5.7 putAtom 语义** | UPDATE-only(传 id 必须已存在) | **UPSERT 短路**(传 id 不存在则 CREATE) | view 端预生成 client id 推过来场景,UPDATE-only 抛错丢数据;decision 017 修复 |
| **§5.x runner SELECT** | `SELECT version FROM schema_version ORDER BY appliedAt DESC LIMIT 1` | 加 `appliedAt` 字段到 SELECT 投影 | SurrealDB 3.0.4 要求 ORDER BY 字段须在 SELECT 中;decision 017 修复 |

### 10.2 `decisions/014-sub-phase-3a-1-graph-canvas-instance-migration.md`

§3.x canvas-store.createInstance 路径备注 storage 依赖修复:

> 注:本路径依赖 storage.putAtom 在传 id 不存在时 UPSERT 创建(decision 017)。

### 10.3 `surreal-schema.md`(若引用了 putAtom 契约)

如有"传 id = UPDATE"字面表述,改为"传 id = UPSERT 短路"。

### 10.4 `data-model/README.md` 或 phase 进度表

Phase N 状态加:`2026-05-13 hotfix 017 — sub-phase 1 putAtom + runner 修复`。

---

## 12. 实施实际情况(填写于实施后)

### 12.1 Commit hash

- `e6b5ca3` — fix(storage): UPSERT putAtom 语义
- `04a5c5e` — fix(storage/migrations): runner SELECT 3.0.4 兼容 + catch 不静默
- 本决议自身作为第 3 个 commit(hash 见 `git log fix/storage-persistence-hotfix`)

### 12.2 静态验证结果

- TypeScript:`npx tsc --noEmit -p tsconfig.json` — 无输出(pass)
- ESLint:`npx eslint src/storage/surreal/storage.ts src/storage/migrations/runner.ts` — 无 warning(pass)
- SurrealDB 3.0.4 binary 实测:见 §6.1 / §6.2

### 12.3 Binary verify 结果(✅ 三层实证全过)

2026-05-13 总指挥协调用户跑,实证齐全:

| 场景 | 状态 | 实证 |
|---|---|---|
| ① graceful close + reopen 数据保留 | ✅ 通过 | shape 3 个跨重启保留 + atom 10 个数据完整(P0a UPSERT 生效) |
| ② 启动 5 次 migration 只跑 1 次 console.log | ✅ 通过 | 重启后 0 行 `applying` 日志 + schema_version 3 条记录 `appliedAt` 是历史时间(P0c SELECT 修法 + UPSERT 不刷 appliedAt 生效) |

### 12.4 反向更新(✅ 合 main 前完成)

| 文档 | 状态 | Commit |
|---|---|---|
| 011 §10.x "后续 hotfix" blockquote 加 P0a/P0c 偏离登记 + binary verify 实证 | ✅ 完成 | `57ed282` |
| 014 §12.7 后续 hotfix + §12.8 P1 教训第 6 次 | ✅ 完成 | `8e8213f` |
| L7-next-phase-kickoff.md §1.4 加 Q-P3 + P0d 占位 / §1.5 教训 6 / §1.6 cwd 漂移 4 | ✅ 完成 | `acf6328` |
| 决议 017 §12 标实施完成 + 三层实证 | ✅ 本 commit | (本次) |

注:`surreal-schema.md` putAtom 契约 / `data-model/README.md` phase 进度未在本轮做 — 总指挥未列入授权清单,
留 sub-phase 后续(若有新需求触发再更)。

### 12.5 P0d 新发现(独立 hotfix,不在 017 范围)

2026-05-13 binary verify 期间总指挥发现 sub-phase 3a-1 范围 1 个新 P0 bug:

- **症状**: text-node pm content 被空 doc 覆盖,跨重启丢文字
- **位置怀疑**: sub-phase 3a-1 §3.4 pmContentCapability 写路径或 canvas-store
  text-node update 路径(`updateInstance` 内 pm payload 处理)
- **本对话未深查**:不在 017 修法范围,独立 hotfix 处理
- **占位**:L7 启动包 §1.4 加 P0d 占位条目;独立 decision 文档由后续对话/总指挥起

### 12.6 P3 留独立 issue

参 §9 Q-P3 — Electron `before-quit` 不 await。小数据量实测不踩,但写量大 / SIGTERM 时长不够时可能踩。
本 hotfix 不修;留 sub-phase 后续。L7 启动包 §1.4 已挂 Q-P3 跟踪。

### 12.7 链下游 — P0a UPSERT 揭露 sub-phase 3a-1 cardinality 漏(2026-05-13 P0a-bis)

本 017 hotfix 合 main 后,binary verify 期间用户截图实证 P0a-bis 现象:同一个
instance `i-001` 同时显示在两个不同画板里(本是 P0a 的"同一现象不同表现")。

**真根因 — 不是 017 引入,是揭露**:

- decision 014 §3.3 line 388 字面拍板"`inCanvas` cardinality 一对一",但 sub-phase 3a-1
  实施时 view 端 [`NodeRenderer.nextInstanceId`](../../../../../src/capabilities/canvas-rendering/scene/NodeRenderer.ts#L257)(原版)
  用 per-NodeRenderer counter 生成 `i-001` / `i-002`,跨画板碰撞
- P0a 修法**前**(UPDATE-only 抛 not found)隐藏漏:撞库时 storage 抛错 → 写入失败,
  业务层看到 P0a 现象(shape 跨重启丢)
- P0a 修法**后**(UPSERT 存在则更新)化为可见:撞库时 storage 覆盖 atom payload +
  写新 inCanvas 边 → 业务层看到 `i-001` 出现在两个画板(P0a-bis 现象)

**P0a-bis 三层防线补完**(详 [decision 019](019-graph-instance-cardinality-hotfix.md)):

1. **K1 view 端**:`NodeRenderer.nextInstanceId` 改 `generateUlid` 全局唯一(commit `27595aa`)
2. **K2 store 端**:`canvas-store.createInstance` 加 inCanvas 一对一守门 keep-latest(commit `8198f56`)
3. **K3+K4 storage 启动**:`runCardinalityCheck` 扫 inCanvas + hasContent + 自愈历史污染(commit `0fd3dda`)
4. **K6 反向更新**:inCanvas 升级归属边语义(`relations/spec.md` §10.1 + decision 014 §3.3)
5. **K7 未来扩展**:`referencedIn` 边接口预留(sub-phase 3a-shared-ref)

**binary verify 4 场景全过**(2026-05-13):
- ① self-check 清污染:scanned 2 / found 1 / cleaned 1
- ② inCanvas 边 keep-latest 后仅 1 条
- ③ 跨画板新 instance ULID 生效(`01KRGMJQTYBXGPB4MH4CQHX72G` triangle)
- ④ 重启 0 violations 0 cleaned

**链下游意义**:P0a 修法语义正确,P0a-bis 揭露的是 sub-phase 3a-1 设计师 P1 第 7 次教训
(decision 014 §12.10),不是 017 修法缺陷。017 + 019 形成"持久化基础 → cardinality
机制"两层完整闭环。

### 12.8 P0d binary verify 暴露 P0a-bis + P0d 恢复路径(2026-05-13)

本 017 hotfix 合 main 后,§12.5 占位的 P0d(text-node pm content 跨重启丢文字)进入
独立 hotfix 流程,但 P0d binary verify 期间用户截图实证**同一个 instance i-001 出现
在两个画板** — 这是 P0a-bis 现象(P0a UPSERT 揭露 sub-phase 3a-1 cardinality 漏)。

**hotfix 顺序拍板(2026-05-13 总指挥)**:P0d 暂停 → 先修 P0a-bis(cardinality 是 P0d
binary verify 的前置环境清洁,P0d 修文字写入正确性必须在干净 cardinality 环境上 verify)。

**hotfix 链关系**:

```
017 P0a UPSERT 合 main (60e1229 → f7f908d)
    ↓ binary verify 期间用户报 P0d 占位
    ↓ binary verify 期间用户报 P0a-bis (i-001 跨画板)
P0d 暂停 (fix/canvas-text-node-doc-sync 5 commits)
    ↓
019 P0a-bis hotfix 合 main (f7f908d → c64183b) — 三层防线
    ↓
P0d 恢复:fix/canvas-text-node-doc-sync git merge main → 7104ad9
    ↓ ort 策略无 conflict(P0d helper 函数 vs P0a-bis createInstance 守门字面位置不重叠)
    ↓ P0d binary verify 场景 ① 三层实证 PASS + K1 ULID 兼容 + K3 self-check 0 violations
    ↓
018 P0d hotfix 合 main(本次)
```

**链下游意义**:P0a/P0c 修法→ 揭露 P0a-bis + P0d 两个 sub-phase 3a-1 漏 → 串行 hotfix
(P0a-bis 先做)→ P0d 在 P0a-bis 修过的环境上 binary verify 通过。017 + 018 + 019 形成
"持久化基础 → cardinality 机制 → text-node 形态对齐"三层完整闭环,sub-phase 3a-1
设计师 P1 教训累积到第 8 次(详 [decision 014 §12.10 / §12.12](014-sub-phase-3a-1-graph-canvas-instance-migration.md))。
