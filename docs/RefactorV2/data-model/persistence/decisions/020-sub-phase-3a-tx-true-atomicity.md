# Decision 020 — Phase N Sub-phase 3a-tx: Storage Transaction 真原子性

> **Phase**: N(实施 Phase)/ Sub-phase 3a-tx
> **状态**: 🟡 草稿(2026-05-13)
>
> **设计师 / 审计师**: main 对话(总指挥)
> **实施者**: 独立 session
> **决议日期**: 2026-05-13
> **前置依赖**: sub-phase 1(`34e3758`)+ sub-phase 2(`0ad60c7`)+ sub-phase 3a-1(`67f18b2`)+ 反向更新 10 项(`19b6ed6`)+ sub-phase 3a-2.5(`b8093d9`)
> **总纲**: [decision 011 §4.2 X3a 退化条](011-sub-phase-1-surrealdb-infrastructure.md)+ [decision 012 §8 Q-tx](012-sub-phase-2-note-folder-migration.md)+ [decision 013 §3.5.1.bis](013-sub-phase-3a-graph-canvas-migration.md)
> **范围风格**: storage 底座单点改造 + 全已迁 capability 回归 verify(view 层零改动)
>
> **2026-05-13 反向更新**(decision 021 sub-phase 021 完成):本决议 §3.5.bis 场景 1/3/5 字面 binary verify "单次 db.query() 内 BEGIN/COMMIT 跨语句原子" 实证,被 decision 021 §7.2 clearAll migration 字面引用作为 `BEGIN TRANSACTION; DELETE atom; DELETE edge; COMMIT TRANSACTION;` 单次 query 调用承载多语句事务脚本的字面前置实证。详 [decision 021 §0.7 第 15 次教训](021-sub-phase-021-folder-view-isolation.md#07-设计师累积教训第-15-次2026-05-13-决议自审命中)。

---

## 0. 本文档的执行指南

### 0.1 角色与流程(沿用 sub-phase 1 / 2 / 3a-1 / 3a-2.5 同模式)

- **设计师 + 审计师 = main 对话(总指挥)**
- **实施者 = 独立 session**(粘贴本决议 + L7 启动包 §4 实施者 prompt)
- **协作模式**: 实施者按 §5 顺序推进,每 step commit,关键决策点停下汇报,完成后总指挥审计 + 合 main

### 0.2 实施纪律(实施者必须遵守)

1. **严格 cd**: 所有 Bash 命令前 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 &&`(memory `feedback_v2_is_workspace_v1_is_reference`,已 4 次 cwd 漂移事故 + decision 017 hotfix 排查期复合命令链断事故)
2. **每完成 §5 一个有代码/文档/脚本变更的 step commit 一次**(详 §5 头部分类:5 个 commit step + 5 个非 commit step),commit message 按本文档示例格式;纯 verify / 自测 / 用户测试 step 不 commit
3. **不动其他已完成模块对外契约**:
   - `src/capabilities/note/` / `src/capabilities/folder/` / `src/capabilities/graph-library-store/` / `src/capabilities/pm-content/` 一律不动
   - `src/platform/main/note/` / `src/platform/main/folder/` / `src/platform/main/graph/` / `src/platform/main/pm-content/` 一律不动
   - 例外:`src/storage/surreal/storage.ts` 的 `transaction()` 方法实施 + 必要的 helper(本决议核心改造点)
4. **StorageAPI / StorageTransaction 对外接口签名 0 变化**:[decision 011 §3 line 406](011-sub-phase-1-surrealdb-infrastructure.md) 的 `transaction<T>(fn: (tx: StorageTransaction) => Promise<T>): Promise<T>` 签名不动,5 个 capability 调用站点零改动(原字面 4 个,2026-05-13 实施者 Step 5.0 修正,见 §10.B-1)
5. **SDK 版本锁定 surrealdb@^2.0.3**:**不得在本 sub-phase 内升级 SDK 版本**(用户 P0 纪律:SDK 选定后绑定发布包,跨大版本升级走独立决议)
6. **任何偏离决议 / SurrealDB binary 行为不符 SDK 文档 / 发现额外消费点 → 停下汇报**,等总指挥批复后再继续
7. **进程边界**:
   - storage 改造仅发生在 main 进程,renderer 不感知
   - main 进程 capability 通过 barrel `import { storage } from '@storage/surreal/storage'` 调用,与 sub-phase 1 同
8. **故障注入测试必须 binary verify**:故意中途 throw / 网络断 / SurrealDB kill 场景下回滚行为,不是 unit test mock(沿 decision 014 §12.5 教训)

### 0.3 本子决议对 L7 启动包 §6.2 总纲的偏差登记

| 项 | 启动包倾向 | 本决议拍板 | 理由 |
|---|---|---|---|
| SDK 版本 | "surrealdb-js 3.x SDK 是否原生支持 transaction API(实施者首先 verify)" | ✅ **锁定 surrealdb@^2.0.3** | grep 现状 + 2.x SDK .d.ts 字面调研:**2.x 已原生支持** `SurrealSession.beginTransaction(): Promise<SurrealTransaction>`;启动包字面"3.x 待查"是设计师笔误 |
| 解决路径 | 3 条候选(SDK 原生 / 应用层补偿 / 单点串行)| ✅ **路径 1: SDK 原生 `beginTransaction()` + `commit()` / `cancel()`** | SDK 字面证据充分,后续 binary verify;路径 2/3 留 §3.5 fallback 章节 |
| binary verify 范围 | "transaction 单元 verify + 全 capability 回归 verify" | ✅ **2 个 checkpoint**(§6.1 SDK 行为 + §6.2 全 capability 故障注入回归)| 沿 decision 014 / 016 模式 |
| 工程量预估 | 1-2 天 | **2-3.5 天** | 故障注入测试是新引入工程量,启动包低估 |

### 0.4 设计师纪律累积(沿 decision 013 §0.5 + 014 §12.5 + 016 §0.4 + 017 §9)

本决议撰写前已完成 5 项现状 grep verify(避免第 5/6 次 P1 教训复现):

| # | 核查项 | 结论 |
|---|---|---|
| 1 | 现状 `transaction()` 实施 | ❌ 退化态字面坐实([storage.ts:439-461](../../../../../src/storage/surreal/storage.ts#L439))— 直调 fn,无任何 BEGIN/COMMIT,无回滚机制 |
| 2 | V2 实际安装的 SDK 版本 | ⚠ **surrealdb@^2.0.3**(`package.json` 字面),启动包记载"3.x"是笔误 |
| 3 | SDK 2.x 原生 transaction API | ✅ 字面存在:`SurrealSession.beginTransaction(): Promise<SurrealTransaction>` + `SurrealTransaction.commit() / cancel()`([surrealdb.d.ts:3697-3713 / 3786-3792](../../../../../node_modules/surrealdb/dist/surrealdb.d.ts#L3697))。**V2 现有 `db = new Surreal()` 实例直接可用**(`Surreal extends SurrealSession`) |
| 4 | **5** 个 transaction 调用站点(2026-05-13 实施者 Step 5.0 复 grep 修正,见 §10.B-1)| ✅ 全部锁定:`note/capability-impl.ts:60` createNote / `:139` moveNote / `folder/capability-impl.ts:54` **createFolder** / `:110` **moveFolder** / `:158` deleteFolder |
| 5 | StorageTransaction 接口字面 | ✅ 6 方法签名 `getAtom / putAtom / deleteAtom / getEdge / putEdge / deleteEdge`,无 `listAtoms` / `listEdges` / `querySubgraph` — **事务内不暴露查询,实施时需注意"先查后改"场景的实际事务边界** |

**本决议拍板时不再做 binary 假设**,§3.5 binary verify 完成后再固化路径细节(沿 decision 014 §12 binary verify 模型)。

### 0.5 用户 P0 纪律:SDK 版本锁定与发布包绑定

**用户 2026-05-13 拍板**:
> "SDK 版本路线 — 这个选项注意未来是要绑定发布包的"

**纪律登记**:
1. **本决议锁定 surrealdb@^2.0.3**,实施期间不得升级
2. **未来若有 3.x 升级需求**(例如 3.x 修复 2.x 致命 bug / 3.x 引入必需新特性),必须**独立 sub-phase**,完整回归 + 重打发布包测试
3. **本决议 §5 实施步骤期间**,若发现 2.x SDK 在 SurrealDB binary 3.0.4 上 transaction 行为有 bug,**不得绕过升级 SDK**,必须停下汇报,讨论候选 fallback(应用层补偿模式 / 单点串行更新器)
4. **反向更新 decision 008 / 011**:加 SDK 版本绑定纪律条

### 0.6 设计师累积教训(第 9 次,升级为项目级硬性规则)

> **拍板涉及外部依赖版本时,要意识到该选择会绑定到发布包,跨大版本升级是独立 sub-phase 不能合并**。
>
> 本次教训:启动包 §2.1 / §6.2 字面"surrealdb-js 3.x SDK"是设计师从模糊记忆出发的笔误,grep `package.json` 字面才发现 V2 装的是 2.0.3。设计师纪律应该:
> - 涉及外部依赖时,先 grep `package.json` / lockfile 实证版本
> - 拍板"用 SDK 哪个 API"前,grep `.d.ts` 字面证据(本次本可以一开始就发现 2.x 有原生 transaction,避免误导用户走"3.x 升级"路线考虑)
> - 用户 P0 纪律("绑定发布包")永久登记到所有外部依赖选型决议

**用户 P1 升级(2026-05-13)**:本教训不只作为决议字面登记,**必须升级为项目级硬性规则**:
- ✅ **必须新增** `docs/RefactorV2/data-model/persistence/SDK-version-binding-policy.md` 永久文档(参 §4.4)
- ✅ **必须新增** `feedback_sdk_version_binding_policy.md` memory(永久跨对话纪律)
- ❌ **不再接受"或"措辞**(原 §8 反向更新清单字面"`project_layered_refactor_charter` 或新文件"已废)

落点见 §4.4 + §8 反向更新清单。

---

## 1. 改造目标(What)

### 1.1 本 sub-phase 的范围

**包含**:
- `src/storage/surreal/storage.ts` `transaction()` 方法**重写**:从退化态(直调 fn)改成基于 SDK `beginTransaction()` 的真原子实施
- `StorageTransaction` 内部对象**改造**:6 个方法的实施从"调主 storage"改成"调 SurrealTransaction 实例上的查询"
- `src/storage/surreal/client.ts` 可能的辅助 export(暴露 db 实例给 storage 层创建 transaction)
- 故障注入测试 framework + 5 个调用站点的回滚 binary verify(见 §1.2 / §10.B-1)
- 反向更新 decision 008 / 011 / 012 / 013 / 014 / 016 / 017 / 019 / pm-content README

**不包含**:
- ❌ 任何 capability 内部改造(transaction 调用方零改动)
- ❌ `StorageAPI` 接口签名变化(对外接口透明)
- ❌ `StorageTransaction` 接口签名变化(6 方法签名不动)
- ❌ SDK 升级到 3.x(独立 sub-phase)
- ❌ SurrealDB binary 版本升级(锁定 3.0.4)
- ❌ 浅引用 / 跨 view 复用机制(留 sub-phase 3a-shared-ref,本 sub-phase 是其前置)
- ❌ ebook / annotation 持久化迁移(留 sub-phase 3b,本 sub-phase 之后)

### 1.2 V2 当前状态(实施起点)

**退化态字面**([storage.ts:437-461](../../../../../src/storage/surreal/storage.ts#L437)):
```typescript
async transaction<T>(fn: (tx: StorageTransaction) => Promise<T>): Promise<T> {
  // ⚠ SurrealDB Sidecar WebSocket 协议不支持跨 db.query() 调用的真事务...
  // 当前退化:直接调 fn 不开真事务,无原子性。
  const tx: StorageTransaction = {
    getAtom: (id) => this.getAtom(id),
    putAtom: (input, options) => this.putAtom(input, options),
    deleteAtom: (id) => this.deleteAtom(id),
    getEdge: (id) => this.getEdge(id),
    putEdge: (input, options) => this.putEdge(input, options),
    deleteEdge: (id) => this.deleteEdge(id),
  };
  return fn(tx);
}
```

**SDK 2.x 字面新发现**(`node_modules/surrealdb/dist/surrealdb.d.ts`):
```typescript
// line 3792
beginTransaction(): Promise<SurrealTransaction>;

// line 3703
export declare class SurrealTransaction extends SurrealQueryable {
  commit(): Promise<void>;
  cancel(): Promise<void>;
}

// line 3902
export declare class Surreal extends SurrealSession implements EventPublisher<SurrealEvents>
// → V2 现有 `db = new Surreal()` 直接继承 beginTransaction()
```

**5 个调用站点**(全部字面已锁定,2026-05-13 实施者 Step 5.0 复 grep 修正,见 §10.B-1):

| 文件 | 行 | 操作 | 包内子操作 |
|---|---|---|---|
| `note/capability-impl.ts:60` | createNote | 创建 pm atom + putEdge hasNoteView(+ optional inFolder)| 2-3 步 |
| `note/capability-impl.ts:139` | moveNote | listEdges(查旧)+ N×deleteEdge + 1×putEdge | N+1 步 |
| `folder/capability-impl.ts:54` | **createFolder** | 创建 folder atom(+ optional putEdge inFolder 到 parent)| 1-2 步 |
| `folder/capability-impl.ts:110` | **moveFolder** | listEdges(查旧)+ N×deleteEdge + 1×putEdge | N+1 步 |
| `folder/capability-impl.ts:158` | deleteFolder | cascade 删整棵子树 | N 步(深度递归)|

**笔误修正说明**:
- 原决议字面("4 个 transaction 调用站点 + moveResource + deleteFolder")是设计师 §0.4 第 4 项 grep verify 漏 + 字面错位的双重失误,详 §11.4 第 11 次教训。
- `note/capability-impl.ts:139` **是 moveNote 不是 deleteNote**(原 §0.4 字面笔误,已修)
- `folder/capability-impl.ts:54` **是 createFolder 不是 moveResource**(原 §0.4 字面错位,已修)
- `folder/capability-impl.ts:110` **是 moveFolder 不是 deleteFolder**(原 §1.2 字面把 `:110, 158` 合并为 deleteFolder,错位)
- `folder/capability-impl.ts:158` **才是 deleteFolder**(唯一正确登记)
- **deleteNote** 在 [`note/capability-impl.ts:158-180`](../../../../../src/platform/main/note/capability-impl.ts#L158) 字面**不走 transaction**,直调 `storage.deleteAtom` — storage 层级联删 atom + 相关边(单次 deleteAtom 内部已是 SurrealDB binary 单语句,binary 自身原子,不需要 transaction 包)。

**对实施工程量的影响**:**0 增加**。改造点单一(`storage.ts:transaction()`),5 个调用站点全部透明受益。仅 §7 故障注入矩阵需要增加 §7.5 createFolder 5 项(CF1-CF5,语义挪用 §7.1 C1-C5)。

### 1.3 目标态(本 sub-phase 完成后)

**新 transaction 实施(草案,binary verify 后定稿)**:
```typescript
async transaction<T>(fn: (tx: StorageTransaction) => Promise<T>): Promise<T> {
  const db = ensureDb();
  const surrealTx = await db.beginTransaction();
  try {
    const tx: StorageTransaction = {
      // 6 方法实施:调 surrealTx 上的 query,而不是 this 主 storage
      getAtom: (id) => getAtomViaTx(surrealTx, id),
      putAtom: (input, options) => putAtomViaTx(surrealTx, input, options),
      deleteAtom: (id) => deleteAtomViaTx(surrealTx, id),
      getEdge: (id) => getEdgeViaTx(surrealTx, id),
      putEdge: (input, options) => putEdgeViaTx(surrealTx, input, options),
      deleteEdge: (id) => deleteEdgeViaTx(surrealTx, id),
    };
    const result = await fn(tx);
    await surrealTx.commit();
    return result;
  } catch (err) {
    await surrealTx.cancel();
    throw err;
  }
}
```

**故障注入测试覆盖**:
- ✅ fn 中途 throw → cancel → 数据库无任何变化
- ✅ fn 返回 reject Promise → cancel
- ✅ commit 本身失败 → 上层捕获,数据库无 partial 写入
- ✅ SurrealDB binary 中途 kill → SDK 抛错 → cancel(可能失败,但 binary 重启后无 partial)
- ✅ 5 个调用站点全部走过一遍,各自模拟故障注入(2026-05-13 §10.B-1 修正)

### 1.4 风险陈述

| 风险 | 影响 | 缓解 |
|---|---|---|
| **SDK 文档与 binary 行为不一致** | binary verify 失败 → 候选路径 1 不可行 → 全决议返工 | §3.5 binary verify checkpoint 单独验,失败则启动 §3.4 fallback 路径讨论 |
| **事务内查询行为**(getAtom / getEdge)| `StorageTransaction.getAtom` 字面要看到事务内已写的中间态(读自己的 uncommitted 写)| binary verify §6.1 必含"事务内 putAtom → 紧跟 getAtom 应读到新值"场景 |
| **事务超时 / 长事务死锁** | 长事务期间其他 storage 调用阻塞 | SurrealDB 3.0.4 binary 默认 transaction 超时未知,binary verify §6.1 补一项;捕获超时错误后正常 cancel 流程 |
| **回归范围广** | 5 个调用站点全过一遍(note × 2 + folder × 3) | §6.2 checkpoint 集成测试清单逐个走 |
| **deleteNote 是否需要包 tx** | 字面不包,但 deleteAtom 内部级联删多张表 | binary verify 确认 SurrealDB single statement 是否原子(应是) |

---

## 2. Q-tx 历史 + 退化原因 binary 重现

### 2.1 Q-tx 起源

**Q-tx** 由 [decision 011 §4.2](011-sub-phase-1-surrealdb-infrastructure.md) 在 sub-phase 1 集成测试期间(2026-05-12)首次记录:

> ~~`transaction` 用 SurrealDB BEGIN/COMMIT~~ ⚠ **sub-phase 2 集成测试暴露失效**(2026-05-12):
> - SurrealDB Sidecar WebSocket 协议下 BEGIN/COMMIT 必须聚合在单段 SQL 内,跨 `db.query()` 拆开会让 BEGIN 被立即隐式提交,后续 COMMIT 报 `Cannot COMMIT without starting a transaction`
> - X3a 修复(commit `7d828a6`): `transaction(fn)` 退化为直调 fn,**无真原子性**
> - sub-phase 1 audit 未暴露:测试路径仅走 putAtom/deleteAtom 单语句,从未真用 transaction
> - 部分原子性退化对单机单用户场景影响**有限**(并发概率极低)
> - Open Question Q-tx 留 sub-phase 3+ 评估 SDK 原生 transaction API 或应用层补偿

### 2.2 X3a 退化的根因(binary 行为复盘)

**SurrealDB Sidecar WebSocket 协议 + 跨 `db.query()` 调用 BEGIN/COMMIT 失败的根因**:
- WebSocket 协议每次 `db.query(sql)` 是一次独立 RPC 调用
- SurrealDB binary 内部 BEGIN 状态绑定到**单次 RPC 调用上下文**,RPC 返回后状态消失
- 所以 `db.query('BEGIN'); db.query('INSERT...'); db.query('COMMIT')` 三个调用里,BEGIN 在第一次 RPC 结束时被隐式提交(空事务),后续 INSERT / COMMIT 都不在事务内

**这个限制在 SDK 2.x SDK `beginTransaction()` API 上是否仍存在?**
→ §3.5 binary verify 必须实证。SDK 字面 `SurrealTransaction extends SurrealQueryable`,推测 SDK 内部通过**专用 RPC method**(或专用 session id)维持事务状态,绕开了"跨 db.query() 拆 BEGIN/COMMIT"的限制。但**这是推测,binary verify 前不下结论**。

### 2.3 退化态对当前业务的实际影响

**单机单用户低并发场景**(V2 当前唯一用例):
- 实测 sub-phase 1 / 2 / 3a-1 / 3a-2.5 全部 binary verify 通过,无半成功污染数据库案例
- 5 个调用站点的子操作步数都很短(1-N 步),宿主进程 crash 中途的概率低

**为什么仍要修**:
- **sub-phase 3a-shared-ref(浅引用)绝对不能跑在退化态上** — 浅引用必然多 atom + 多 edge 协同写,半成功 = 引用悬空 = 业务直接错乱
- **sub-phase 3b(ebook + annotation)风险放大** — annotation → ebook 的 annotates 边 + 笔记 → ebook 段落的 cites 边,任一组合失败都污染图谱
- **vision §2.4 知识图谱闭环** — 协同写是常态,半成功污染图谱可信度
- **架构债越积越深** — 现在 5 个调用站,3b 后会变 9-11 个,改造面指数级增长

---

## 3. 候选路径对比 + 拍板

### 3.1 路径 1:SDK 原生 `beginTransaction()`(本决议拍板)

**实施核心**:
```typescript
const surrealTx = await db.beginTransaction();
try {
  // ... fn(txWrapper) ...
  await surrealTx.commit();
} catch (err) {
  await surrealTx.cancel();
  throw err;
}
```

**优点**:
- ✅ SDK 字面已支持,改造点单一(`storage.ts:437-461`)
- ✅ `SurrealTransaction extends SurrealQueryable` 可直接跑 query,事务内读写同 SDK API
- ✅ 不需要应用层补偿日志,无新引入概念

**风险**:
- ⚠ SDK 文档与 binary 行为可能不一致(待 binary verify)
- ⚠ 事务超时 / 死锁等边缘场景行为未知

**前置 verify**:[§3.5 binary verify 计划](#35-binary-verify-计划决议撰写期必跑)。

### 3.2 路径 2:单段 SQL 字符串聚合(fallback A)

**实施核心**:
```typescript
const writes: SqlStatement[] = [];
const txWrapper: StorageTransaction = {
  putAtom: (input) => { writes.push({ sql: 'UPDATE...', bindings: ... }); return Promise.resolve(...); },
  // ...
};
await fn(txWrapper);
await db.query(`BEGIN; ${writes.map(w => w.sql).join('; ')}; COMMIT;`, mergedBindings);
```

**优点**:
- ✅ 不依赖 SDK 行为,直接拼 SurrealQL 字面
- ✅ 跟 sub-phase 1 X3a 之前的设计思路一致(只是把多次调用聚合成一次)

**致命问题**:
- ❌ **`StorageTransaction.getAtom` / `getEdge` 在事务内必须看到事务内已写的中间态** — 单段 SQL 聚合做不到(查询和写入都在同一段 SQL,没法"读 putAtom 后未 commit 的中间态")
- ❌ ID 生成同步(putAtom 返回新 ULID)在聚合模式下无法等到 SQL 执行返回再用于后续 putEdge — 必须**应用层预生成 ID**,改契约

**推迟为路径 1 binary verify 失败时的 fallback。**

### 3.3 路径 3:应用层补偿模式(fallback B)

**实施核心**:每个写操作记录反向操作日志,fn 失败时反向执行。

**致命问题**:
- ❌ 补偿操作本身可能失败(谁补偿补偿者?)
- ❌ 不能解决并发可见性(其他 query 在补偿前可能读到 partial 状态)
- ❌ 大量样板代码,每个 putAtom / putEdge / deleteAtom 都要写反向逻辑

**推迟为路径 1 + 2 都失败时的最后兜底。**

### 3.4 路径 4:单点串行更新器 + WAL(超出本决议范围)

**实施核心**:所有写操作通过单队列串行化 + WAL 日志 + 重启 replay。

**为什么不在本 sub-phase 考虑**:
- 工程量 1 周以上,跟整个 sub-phase 3a-tx 工程量(2-3.5 天)严重失衡
- 引入新概念(WAL / 队列)远超"修退化态"范畴
- 留 sub-phase 5+ 协作 / 多设备同步阶段再讨论

### 3.5 binary verify 计划(决议撰写期必跑)

**verify 脚本位置**:`scripts/verify/sub-phase-3a-tx-binary-verify.ts`(临时脚本,不入仓)

**verify 场景清单**:

| # | 场景 | 期望行为 |
|---|---|---|
| 1 | `db.beginTransaction()` 成功创建 | 返回 SurrealTransaction 实例 |
| 2 | 事务内 putAtom + commit | atom 写入,commit 后能读到 |
| 3 | 事务内 putAtom + cancel | atom **不写入**,cancel 后查询返回 null |
| 4 | 事务内 putAtom + 紧跟 getAtom(同事务内读) | **能读到事务内已写但未 commit 的中间态**(关键!) |
| 5 | 事务内多步写(putAtom + putEdge)+ 中途 throw + cancel | **两步都不生效** |
| 6 | 事务内多步写(putAtom + putEdge)+ commit | 两步都生效 |
| 7 | 事务内 SurrealQL 语法错误 → SDK 行为 | 错误抛出,后续 cancel 应能正常执行 |
| 8 | 长事务(>5s)| 是否超时?超时行为? |
| 9 | 并发两个 beginTransaction 同时跑写 | binary 行为 — 锁?排队?冲突? |
| 10 | commit 后 cancel(error path)| SDK 行为 — 报错?静默? |
| 11 | **commit() 后进程崩溃 / 连接断开 → 重连后查询**(确认提交边界)| commit 返回后数据**必须持久化**;若返回前崩溃,数据**必须不存在** |
| 12 | **并发写同一 atom/edge 的冲突语义**(两个 transaction 同时 putAtom 同 id / putEdge 同 subject+predicate+object)| binary 行为 — 第二个 transaction 是阻塞等待?直接报错?还是 last-write-wins?**任意结果都要字面登记**,决议层契约决定 |
| 13 | **cancel() 失败时持久层最终态**(故意让 cancel 抛错 / kill binary 在 cancel 中途)| 数据库**必须无 partial 写入**(就算 cancel API 失败,SurrealDB 内部 transaction 应自动 timeout 后 rollback)|

**verify 输出**:决议 §3.5.X 字面贴 verify 脚本 + binary 实际行为日志,作为路径 1 拍板的实证。

**verify 关键失败硬门槛(用户 P1 拍板)**:
- 场景 4 失败 → ❌ **路径 1 不可行,STOP + 总指挥设计审查会签**(不自动 fallback)
- 场景 11 失败 → ❌ **持久化语义破损,STOP**(连提交边界都不能保证,任何路径都白搭)
- 场景 13 失败 → ❌ **回滚语义破损,STOP**(故障注入测试无意义)
- 场景 1/2/3/5/6 任一失败 → ❌ **基础 transaction 语义破损,STOP**
- 场景 7/8/9/10/12 失败 → 🟡 **不阻塞拍板**,但作为已知约束登记到 decision 008 + 本决议 §9 Open Question

**verify 跑法**:
```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
# 起 surreal binary(独立端口 8534,memory backend,不污染 V2 数据)
/opt/homebrew/bin/surreal start --bind 127.0.0.1:8534 \
  --username root --password root --log warn memory &
until curl -s http://127.0.0.1:8534/health > /dev/null; do sleep 1; done
# 跑 verify(本决议撰写期 2026-05-13 实跑脚本)
node tmp/verify/sub-phase-3a-tx-binary-verify.mjs
# 清理
pkill -f 'surreal start --bind 127.0.0.1:8534'
```

### 3.5.bis Binary verify 实跑结果(2026-05-13)

**环境**:
- SurrealDB binary: `/opt/homebrew/bin/surreal` 3.0.4 for macos on aarch64
- SDK: `surrealdb@2.0.3`(V2 现状)
- 端口: 127.0.0.1:8534
- backend: memory(不污染磁盘,本决议撰写期临时跑)
- 脚本: [tmp/verify/sub-phase-3a-tx-binary-verify.mjs](../../../../../tmp/verify/sub-phase-3a-tx-binary-verify.mjs)(临时脚本,在 `.gitignore` 的 `tmp/` 下)
- 日志: [tmp/verify/result.log](../../../../../tmp/verify/result.log)(同上)

**实跑结果汇总(PASS 12 / FAIL 0 / WARN 2)**:

| # | 场景 | 结果 | 实际行为 |
|---|---|---|---|
| 1 | beginTransaction 创建 | ✅ PASS | tx.commit / tx.cancel 都存在,API 字面可用 |
| 2 | 事务内 putAtom + commit | ✅ PASS | commit 后主连接能读到 |
| 3 | 事务内 putAtom + cancel | ✅ PASS | cancel 后主连接查不到,无 partial 写入 |
| **4** | **事务内 putAtom + 紧跟 getAtom** | ✅ **PASS** | **关键!事务内能读自己未 commit 的中间态** |
| 5 | 事务内多步 + throw + cancel | ✅ PASS | 两步都不存在(全回滚) |
| 6 | 事务内多步 + commit | ✅ PASS | 两步都存在 |
| 7 | 事务内 SQL 语法错误后 cancel | ✅ PASS | query 抛错 / cancel 仍能正常执行 |
| 8 | 长事务 >5s | ✅ PASS | 6s 后仍能 commit + 数据持久化,**无默认 timeout** |
| 9 | 并发事务写不同 atom | ✅ PASS | 两个事务都成功,无干扰 |
| 10 | commit 后再 cancel | ✅ PASS | cancel 抛 `Transaction not found`,但数据已 commit 保留(commit 优先语义) |
| **11** | **commit 后断开重连** | ✅ **PASS** | **关键!commit 返回后断连重连,数据仍在,提交边界可靠** |
| 12 | **并发写同一 atom** | ⚠ **WARN(重大发现,见 §3.5.ter)** | **OCC 语义**:第一 tx commit 成功;第二 tx commit 报 `Transaction conflict: Write conflict, retry the transaction. This transaction can be retried`(可重试错误) |
| 13a | commit 后再 cancel(异常路径)| ⚠ WARN | 跟场景 10 一致,cancel 抛 `Transaction not found`,数据保留 |
| **13b** | **连接断开未 commit** | ✅ **PASS** | **关键!连接断开未 commit,数据库无 partial 写入** |

**关键门槛硬判定**(§3.5 拍板规则):
- 场景 4 ✅ PASS — 事务内中间态读可见
- 场景 11 ✅ PASS — 提交边界可靠
- 场景 13b ✅ PASS — 连接异常无 partial
- 场景 1/2/3/5/6 ✅ 全 PASS — 基础事务语义完整

→ **路径 1 binary 实证可行,本决议 §4 拍板路径维持不变。**

### 3.5.ter 场景 12 重大发现:SurrealDB OCC 并发冲突语义

**实测行为**:
```
tx1 / tx2 同时 UPDATE atom:s12 SET value = 1/2
tx1.commit() → 成功
tx2.commit() → throw Error("Transaction conflict: Write conflict, retry the transaction. This transaction can be retried")
最终 value = 1, tx = 'tx1'(tx1 写入保留,tx2 写入完全丢失)
```

**字面证据**:错误信息含 `"This transaction can be retried"` — SurrealDB 明确把这归为**应用层应该重试的错误**。

**这是 OCC(Optimistic Concurrency Control)语义**,不同于:
- ❌ 阻塞锁(pessimistic locking,tx2 会等到 tx1 commit)
- ❌ Last-write-wins(tx2 会覆盖 tx1)
- ❌ MVCC 快照隔离(tx2 看到旧版本,不冲突)

**对本决议的影响**:
1. **单机单用户场景下并发冲突概率极低** — 不阻塞本 sub-phase 拍板
2. **但 vision §2.4 协作场景必踩** — 长期必须处理
3. **本 sub-phase 设计选项**:
   - 选项 A:`storage.transaction(fn)` 内置 retry-with-exponential-backoff(限次,默认 3 次),透明化冲突
   - 选项 B:抛给 capability 上层处理(让业务决定是否重试)
   - 选项 C:本 sub-phase 不处理,只字面登记到 decision 008 已知约束 + Open Question

**推荐 → 选项 C(本 sub-phase 不内置 retry)**:
- 理由:V2 当前是单机单用户,本 sub-phase 解的是"半成功污染",不是"高并发优化"
- 内置 retry 会引入新设计点(超时 / 退避策略 / retry 期间 fn 副作用),超出本 sub-phase 范围
- 留 sub-phase 5+ 协作场景启动时单独决议

**§9 Open Question 新增**:Q-tx-occ-retry(见 §9.4)。

### 3.5.quat Binary verify 后置警示

**WARN 项不阻塞拍板,但作为已知约束登记**:

- **场景 8**:6s 长事务未超时 — SurrealDB 3.0.4 默认行为是无超时;**实施期 §5 加 `timeoutMs` option 防御,默认 30s**
- **场景 10/13a**:`Transaction not found` 错误名 — `storage.transaction()` wrapper 实施期必须**捕获 cancel 异常**(不让 cancel 失败遮盖原 fn 错误),已在 §4.1 草案体现
- **场景 12 OCC 冲突**:见 §3.5.ter,本决议字面登记 + Open Question

---

## 4. 拍板路径:SDK 原生 beginTransaction()

**前提:§3.5 binary verify 全 10 项场景通过**(场景 4 = 事务内读 uncommitted 写 = 关键路径)。

### 4.1 实施核心(草案,§5 详细)

**`storage.ts:437-461` 改造**:
```typescript
async transaction<T>(fn: (tx: StorageTransaction) => Promise<T>): Promise<T> {
  const db = ensureDb();  // 复用 client.ts ensureDb()
  const surrealTx = await db.beginTransaction();
  try {
    const tx = createStorageTransactionWrapper(surrealTx);
    const result = await fn(tx);
    await surrealTx.commit();
    return result;
  } catch (err) {
    try {
      await surrealTx.cancel();
    } catch (cancelErr) {
      console.error('[storage.transaction] cancel failed after fn error', cancelErr);
    }
    throw err;
  }
}

function createStorageTransactionWrapper(surrealTx: SurrealTransaction): StorageTransaction {
  return {
    getAtom: (id) => getAtomViaTx(surrealTx, id),
    putAtom: (input, options) => putAtomViaTx(surrealTx, input, options),
    deleteAtom: (id) => deleteAtomViaTx(surrealTx, id),
    getEdge: (id) => getEdgeViaTx(surrealTx, id),
    putEdge: (input, options) => putEdgeViaTx(surrealTx, input, options),
    deleteEdge: (id) => deleteEdgeViaTx(surrealTx, id),
  };
}
```

**`getAtomViaTx` 等 6 个 helper**:
- 内部跑同样的 SurrealQL(跟 `SurrealStorage.getAtom` 等同),但 `await surrealTx.query(sql, bindings)` 替代 `await db.query(sql, bindings)`
- normalizer / RecordId 解析逻辑全部复用现有 helper
- 提取公共逻辑到 `storage/surreal/queries/` 子模块(可选,实施者拍板)

### 4.2 不变约束

| # | 约束 | 验证方法 |
|---|---|---|
| 1 | StorageAPI 对外接口签名 0 变化 | `git diff src/storage/types.ts` 应只动注释/无变化 |
| 2 | StorageTransaction 6 方法签名 0 变化 | 同上 |
| 3 | 5 个调用站点 0 改动 | `git diff src/platform/main/{note,folder}/capability-impl.ts` 应只动注释/无变化 |
| 4 | 退化态注释 (storage.ts:440-446) 必须删除 | `grep "退化\|degraded" src/storage/surreal/storage.ts` 应零结果 |
| 5 | SDK 版本不变(`package.json` surrealdb 字段)| `git diff package.json package-lock.json` 应无变化 |

### 4.3 fallback 触发条件(硬门槛,用户 P1 拍板)

**核心纪律(用户 2026-05-13 P1 拍板)**:
> **任何 binary verify 关键场景失败 → STOP + 总指挥设计审查会签,禁止自动 fallback 到路径 2 或 3。**
>
> 理由:路径 2 改造面明显更大,且会动事务语义假设(应用层预生 ULID + tx 内读写不一致);路径 3 引入应用层补偿日志,新概念新风险。自动切换会绕过架构决策关口。

**触发条件 → 处置矩阵**:

| 场景 | 失败语义 | 处置 |
|---|---|---|
| **场景 4 失败** | 事务内读 uncommitted 写不可见 | ❌ STOP + 设计审查会签,讨论是否启用路径 2 |
| **场景 11 失败** | commit 提交边界不可靠 | ❌ STOP,路径 1/2/3 全部不可行,讨论是否放弃 sub-phase 3a-tx 等 SDK 升级 |
| **场景 13 失败** | cancel 后仍有 partial 写入 | ❌ STOP,binary 层回滚语义破损,任何路径都无效 |
| **场景 1/2/3/5/6 任一失败** | 基础 transaction 语义破损 | ❌ STOP,路径 1 完全报废,讨论紧急方案 |
| **场景 7 失败** | SDK 错误处理路径破损 | 🟡 不阻塞,登记 Open Question + 实施期防御性编码 |
| **场景 8/9/10/12 失败** | 边缘场景行为异常 | 🟡 不阻塞,登记 §9 Open Question + decision 008 已知约束 |

**fallback 可行性分析(留作设计审查会签材料,执行上禁止自动应用)**:

如未来设计审查决定走路径 2,5 个调用站点的事务内读需求 grep verify(已完成,2026-05-13 实施者 Step 5.0 复核修正调用站点数 4→5):
- `note/capability-impl.ts:60` createNote — putAtom 返回新 atom 立即用 `atom.id` 调 putEdge,**字面要看到 putAtom 的返回值**,但**不需要 getAtom 读**(返回值是 SDK helper 拼装的,不依赖事务内查询)
- `note/capability-impl.ts:139` moveNote — `listEdges` 走 `storage.listEdges`(非 tx 方法,字面就是脱离事务上下文的预查),不需要事务内读
- `folder/capability-impl.ts:54` createFolder — 跟 createNote 同模式(putAtom 返回值用于 putEdge,不依赖事务内查询)
- `folder/capability-impl.ts:110` moveFolder — 类似 moveNote,`listEdges` 走非 tx 方法,不需要事务内读
- `folder/capability-impl.ts:158` deleteFolder — 递归 deleteAtom,纯写,不需要事务内读

→ 路径 2 字面可行,**但实施前必须经过设计审查会签 + 评估 putAtom 改返回应用层预生 ULID 的回归面**。本决议不预先授权路径 2 实施。

### 4.4 SDK 版本绑定纪律(用户 P0,两层落地)

**本决议字面登记**:
- 锁定 surrealdb@^2.0.3(`package.json` 现状)
- 本 sub-phase 实施期间不得升级 SDK
- 未来 3.x / 4.x 升级走独立 sub-phase + 重打发布包

**两层落地(用户 P1 拍板,不二选一)**:

1. **当前决议链可追溯层** — 反向更新 decision 008 / 011 加 SDK 版本绑定条(本决议 §8 落点)
2. **跨子阶段永久规则层** — **新建** [`docs/RefactorV2/data-model/persistence/SDK-version-binding-policy.md`](../SDK-version-binding-policy.md)(独立永久文档,跨 sub-phase 复用,避免未来再丢纪律)

`SDK-version-binding-policy.md` 内容骨架(本决议实施期间由总指挥落地):
```markdown
# SDK 版本绑定纪律(项目级永久规则)

## 适用范围
所有外部 SDK 依赖(surrealdb / electron / prosemirror / three / ...)的版本选型决策。

## 核心规则
1. SDK 选定后绑定到发布包,跨大版本升级是独立 sub-phase
2. 任何决议拍板"用 SDK X 版本的某 API"前,必须 grep package.json + .d.ts 字面证据
3. 实施期间不得擅自升级 SDK 主版本(允许 patch 升级)
4. 跨大版本升级流程:独立决议 + 完整回归 + 重打发布包测试 + 反向更新所有依赖该 SDK 的决议

## 当前已锁定版本登记表
| SDK | 锁定版本 | 锁定决议 | 锁定日期 |
|---|---|---|---|
| surrealdb | ^2.0.3 | decision 020 | 2026-05-13 |
| ... | ... | ... | ... |

## 设计师教训
(参 decision 020 §0.6 第 9 次教训)
```

**反向更新 memory 必须**(用户 P1 拍板,非可选):新增 `feedback_sdk_version_binding_policy.md` 永久 memory,引用 `SDK-version-binding-policy.md`。

---

## 5. 实施步骤(按顺序执行,代码/文档 step 必须 commit,纯 verify step 不 commit)

> **§5 已定稿**(2026-05-13 binary verify 完成后):路径 1 实证可行,实施步骤按下述顺序推进。
>
> **共 10 个 Step(5.0 - 5.9)**:
> - **代码 / 文档 / verify 脚本变更 step,必须 commit**(5 个):5.2(新建 helper)/ 5.3(改写 transaction)/ 5.5(Checkpoint 1 verify 脚本)/ 5.6(Checkpoint 2 故障注入脚本)/ 5.8(反向更新)
> - **纯 verify / 自测 / 用户测试 step,不 commit**(4 个):5.0 现状 verify / 5.1 binary verify 复跑 / 5.4 typecheck + lint + 自测 / 5.7 UI 集成测试(用户跑)
> - **完成报告 step,不 commit**(1 个):5.9
> - 纪律:Step 间禁止跨步合并 commit,每个 commit step 独立 commit;commit message 按本决议示例格式

### Step 5.0 — V2 现状 verify(前置 + 实施者独立确认)

**目的**:实施者不只信总指挥决议字面,独立 grep 一遍 §0.4 / §1.2 字面证据。

**任务**:
1. `git log --oneline -3` 确认 V2 main HEAD = `b8093d9`,当前分支 = `feature/L7-sub3a-tx-true-atomicity`,decision 020 已包含 commit `c1f6b37` + `8cafefb`
2. `cat package.json | grep surrealdb` 确认 SDK 锁定 `^2.0.3`
3. `cat src/storage/surreal/storage.ts | sed -n '437,461p'` 确认现状 transaction 是退化态
4. `grep -n "storage\.transaction" src/platform/main/note/capability-impl.ts src/platform/main/folder/capability-impl.ts | wc -l` 确认 **5 个**调用站点字面(2026-05-13 §10.B-1 修正,原 4 个)
5. `grep -n "beginTransaction\|class SurrealTransaction" node_modules/surrealdb/dist/surrealdb.d.ts` 确认 SDK API 字面存在

**完成判据**:5 项 grep 结果跟决议 §0.4 / §1.2 一致;否则停下汇报。

**commit**: 无(纯 verify 步骤,不动代码)

### Step 5.1 — Binary verify 复跑(实施者独立验)

**目的**:实施者不只信决议 §3.5.bis 表格,独立跑 verify 脚本确认 SDK 行为。

**任务**:
1. 起 surreal binary on 8534:`/opt/homebrew/bin/surreal start --bind 127.0.0.1:8534 --username root --password root --log warn memory &`
2. 等就绪:`until curl -s http://127.0.0.1:8534/health > /dev/null; do sleep 1; done`
3. 跑 verify:`node tmp/verify/sub-phase-3a-tx-binary-verify.mjs`
4. 比对结果与决议 §3.5.bis 表格:关键场景 4/11/13b 必须 PASS
5. 清理:`pkill -f 'surreal start --bind 127.0.0.1:8534'`

**完成判据**:实跑 12 PASS / 0 FAIL / 2 WARN(场景 12 + 13a),与决议字面一致;若有 FAIL 停下汇报。

**commit**: 无

### Step 5.2 — Storage tx helper 设计 + 文件骨架

**目的**:不动 `storage.ts` 现有公共方法实施,新增 6 个 ViaTx helper 通过 surrealTx 实例跑查询。

**任务**:
1. 新建 `src/storage/surreal/transaction-helpers.ts`(本决议核心新文件):
   - 6 个 `*ViaTx` helper:`getAtomViaTx / putAtomViaTx / deleteAtomViaTx / getEdgeViaTx / putEdgeViaTx / deleteEdgeViaTx`
   - 每个 helper 签名:`(tx: SurrealTransaction, ...args) => Promise<...>`
   - 内部逻辑跟 `SurrealStorage` 现有同名方法**字面一致**,只把 `await db.query(sql, bindings)` 替换为 `await tx.query(sql, bindings)`
   - 提取 SurrealStorage 现有 helper(normalize / atomRid / edgeRid / RecordId 解析等)到 `transaction-helpers.ts` 或新建 `queries-common.ts`(实施者可选,只要 storage.ts + transaction-helpers.ts 不重复代码即可)
2. 不修改 `storage.ts` 公共方法签名 + 实施
3. import `SurrealTransaction` 类型从 `surrealdb` SDK

**完成判据**:新文件 6 helper 字面齐全,typecheck 通过。

**commit message**:
```
feat(storage/surreal): 新增 transaction-helpers.ts 6 个 ViaTx helper

按 decision 020 §4.1 拍板,新增基于 SurrealTransaction 实例的查询 helper:
- getAtomViaTx / putAtomViaTx / deleteAtomViaTx
- getEdgeViaTx / putEdgeViaTx / deleteEdgeViaTx
逻辑沿 SurrealStorage 同名方法,只替换底层 query 调用为 tx.query。
不改 storage.ts 公共方法签名。
```

### Step 5.3 — 改写 `SurrealStorage.transaction()` 启用真原子性

**目的**:把退化态(直调 fn)替换为真原子(beginTransaction + commit / cancel)。

**任务**:
1. 改 [storage.ts:437-461](../../../../../src/storage/surreal/storage.ts#L437):
   ```typescript
   async transaction<T>(fn: (tx: StorageTransaction) => Promise<T>, options?: StorageOptions): Promise<T> {
     const db = getDB();
     const surrealTx = await db.beginTransaction();
     try {
       const tx: StorageTransaction = {
         getAtom: (id) => getAtomViaTx(surrealTx, id),
         putAtom: (input, opts) => putAtomViaTx(surrealTx, input, opts ?? options),
         deleteAtom: (id) => deleteAtomViaTx(surrealTx, id),
         getEdge: (id) => getEdgeViaTx(surrealTx, id),
         putEdge: (input, opts) => putEdgeViaTx(surrealTx, input, opts ?? options),
         deleteEdge: (id) => deleteEdgeViaTx(surrealTx, id),
       };
       const result = await fn(tx);
       await surrealTx.commit();
       return result;
     } catch (err) {
       try {
         await surrealTx.cancel();
       } catch (cancelErr) {
         console.error('[storage.transaction] cancel failed after fn error', cancelErr);
         // 不让 cancel 错误遮盖原 fn 错误,继续抛 fn 错误
       }
       throw err;
     }
   }
   ```
2. **删除原 X3a 退化注释**(line 440-446):"⚠ SurrealDB Sidecar WebSocket 协议不支持... 当前退化:直接调 fn 不开真事务,无原子性。"全部删除,**改为指向本决议的简短引用注释**:
   ```typescript
   // sub-phase 3a-tx 启用真原子性(decision 020):
   // SDK 2.x beginTransaction + commit / cancel 包整段。
   // OCC 冲突 (Transaction conflict) 不在本 sub-phase 处理 (decision 020 §9.4)。
   ```
3. import `getAtomViaTx` 等 6 helper 从 `./transaction-helpers`

**完成判据**:typecheck 通过 + grep `"退化\|degraded\|无真原子性"` 在 storage.ts 应零结果。

**commit message**:
```
feat(storage/surreal): 启用真原子性 transaction (decision 020 §4.1)

替换 X3a 退化态(直调 fn)为 SDK 原生 beginTransaction + commit/cancel:
- fn 成功 → commit
- fn 抛错 → cancel + 重抛原错(cancel 失败仅 console.error,不遮盖)
- StorageAPI / StorageTransaction 接口签名 0 变化
- 5 个调用站点零改动(note × 2 + folder × 3)

X3a 退化注释删除 + 替换为指向 decision 020 的简短引用。
```

### Step 5.4 — typecheck + lint + 自测

**任务**:
1. `npx tsc --noEmit` — 应零错误
2. `npx eslint src/storage/ 2>&1 | tail -10` — 应零新错误
3. `grep -n "storage\.transaction" src/platform/main/note/capability-impl.ts src/platform/main/folder/capability-impl.ts` — 应仍是 **5 个**调用站点(2026-05-13 §10.B-1 修正),字面 0 改动
4. `git diff src/platform/main/note/capability-impl.ts src/platform/main/folder/capability-impl.ts` — 应字面空(无任何 capability 改动)

**完成判据**:全部通过。任何 typecheck 错误停下汇报。

**commit**: 无(若需要修微调,微调 commit 进 Step 5.3)

### Step 5.5 — §6 Checkpoint 1: SDK transaction 单元 binary verify

**目的**:跑实施期 SDK 行为单元 verify,确认改造后 `storage.transaction(fn)` 与决议 §3.5.bis 行为一致。

**任务**:
1. 跑 verify 脚本 `tmp/verify/sub-phase-3a-tx-binary-verify.mjs`(本决议撰写期已 PASS,实施者复跑确认 SDK 行为没退化)
2. **新增**实施期 verify 脚本 `tmp/verify/sub-phase-3a-tx-storage-integration.{mjs|mts}`(2026-05-13 §10.B-2 偏离修正,见下):
   - ~~直接调 V2 `SurrealStorage.transaction(fn)` 写真 atom / edge~~
   - **改:import `src/storage/surreal/transaction-helpers.ts` 真改造主体(零 electron 依赖)+ 字面 copy `storage.ts:transaction()` 12 行 wrapper(避 electron app 上下文依赖)**
   - 8 个场景(成功 commit / fn 抛 cancel / putAtom + putEdge 原子 / 事务内 getAtom 中间态 / 删 atom cascade / 长事务 30s timeout / cancel 失败注入 / 关键调用站点 1 个 createNote 模拟)
   - 用 V2 真 schema(`atom` 表 + `edge` 表),而不是 verify 脚本的临时 schema
   - **verify 限制**:storage.ts 12 行 wrapper **不**走 verify 真路径(字面 copy 不算真路径覆盖);wrapper 真路径在 Checkpoint 2 故障注入回归 23 项覆盖(走真 capability → 真 storage.transaction → wrapper 真跑)

**完成判据**:Checkpoint 1 全部 PASS。失败停下汇报。

**commit message**:
```
test(storage/surreal): Checkpoint 1 SDK transaction 单元 binary verify PASS

实施期 verify 脚本 sub-phase-3a-tx-storage-integration.mjs 跑 8 场景全 PASS:
- SurrealStorage.transaction(fn) 改造后行为与 decision 020 §3.5.bis 一致
- 5 个调用站点假设(createNote / moveNote / createFolder / moveFolder / deleteFolder)
  原子性符合预期
```

### Step 5.6 — §7 Checkpoint 2: 全 capability 故障注入回归

**目的**:5 个真实调用站点(note × 2 + folder × 3)的故障注入测试 — 中途模拟失败,验证回滚行为。

**任务**:见 §7 故障注入测试矩阵详细。

**完成判据**:Checkpoint 2 全部 PASS。

**commit message**:
```
test: Checkpoint 2 全 capability 故障注入回归 PASS

5 个 storage.transaction 调用站点故障注入回归(decision 020 §7):
- note.createNote: 中途 throw → pm atom + hasNoteView 边都不存在
- note.moveNote: 中途 throw → 旧 inFolder 边保留,新边不存在
- folder.createFolder: 中途 throw → folder atom + (可选)inFolder 边都不存在
- folder.moveFolder: 中途 throw → 旧 inFolder 边保留(回滚),新边不存在
- folder.deleteFolder: 中途 throw → cascade 子树无 partial 删除
```

### Step 5.7 — UI 集成测试清单(用户跑,实施者待)

**目的**:实施者自测可能漏掉的 UX 路径,用户在 IDE 内跑一遍真 V2 应用确认。

**完整测试清单**(用户跑,见 §6.3):

| # | 场景 | 操作 | 期望 |
|---|---|---|---|
| 1 | 创建 note | `Cmd+N` 新建 note | 成功,refresh 后存在 |
| 2 | 移动 note | 右键 → 移到其他文件夹 | 成功,refresh 后归属正确 |
| 3 | 移动文件夹 | 右键 → 移文件夹 | 成功,递归归属正确 |
| 4 | 删除空文件夹 | 右键 → 删除 | 成功消失 |
| 5 | 删除含 note 文件夹 | 同上,内含 1 note | cascade,note 也消失 |
| 6 | 删除含 graph 文件夹 | 同上,内含 1 graph | cascade,graph 也消失 |
| 7 | 删除嵌套子文件夹 | 深 3 层嵌套 | 全 cascade 消失 |
| 8 | 创建 graph + 添加 text-node | 画布新建 text-node | 成功,refresh 保留 |
| 9 | refresh 后所有数据保留 | Cmd+R | 全部正确 |
| 10 | **故障模拟**(实施者协助):中途 kill V2 子进程 | 在 moveFolder 半途 kill V2 | 重启后无 partial 残留(关键!) |

### Step 5.8 — 反向更新决议清单 + memory + 永久文档

**任务**:见 §8 反向更新清单,逐项落地。

**完成判据**:
- 12 个决议反向更新完成(011 / 008 / 009 / 012 / 013 / 014 / 016 / 017 / 019 / pm-content README / folder DESIGN / L7 启动包)
- 新建 `docs/RefactorV2/data-model/persistence/SDK-version-binding-policy.md`(必须新增)
- 新建 memory `feedback_sdk_version_binding_policy.md`(必须新增)
- 更新 MEMORY.md 加新条目

**commit message**:
```
docs: sub-phase 3a-tx 完成后反向更新决议链 + 新增 SDK 版本绑定纪律

- decision 011 §X3a 改"已修复 sub-phase 3a-tx (decision 020)"
- decision 008 / 012 / 013 / 014 / 016 / 017 / 019 §相关章节同步
- 移除 pm-content README / folder DESIGN 中"Q-tx 必做"过时表述
- L7 启动包 §1.4 / §2.1 / §6.2 同步更新
- 新增 SDK-version-binding-policy.md(用户 P1 硬性,跨子阶段永久规则)
- 新增 memory feedback_sdk_version_binding_policy.md
```

### Step 5.9 — 完成报告

**任务**:实施者向总指挥提交完成报告:
- §5 commit step(5 个:5.2 / 5.3 / 5.5 / 5.6 / 5.8)commit hash 列表
- §6 Checkpoint 1 / 2 实跑结果(PASS / FAIL / WARN 矩阵)
- §7 故障注入测试结果(4 站点 × N 场景,共 17 项)
- §10 偏离登记(若有任何偏离决议字面的情况)
- 自动测试 + 集成测试 通过截图

**等待**:总指挥审计 + UI 集成测试用户反馈 + 拍板合 main。

---

## 6. binary verify checkpoint(已定稿)

### 6.1 Checkpoint 1 — SDK transaction 单元 verify(Step 5.5)

**前置**:本决议撰写期已跑过 [tmp/verify/sub-phase-3a-tx-binary-verify.mjs](../../../../../tmp/verify/sub-phase-3a-tx-binary-verify.mjs) 13 场景,结果归档 §3.5.bis(12 PASS / 0 FAIL / 2 WARN)。

**实施期新增 verify**(2026-05-13 §10.B-2 偏离修正):`tmp/verify/sub-phase-3a-tx-storage-integration.{mjs|mts}` 8 场景,~~直接调 V2 `SurrealStorage.transaction(fn)`~~ → **改:import `transaction-helpers.ts` 真改造主体(零 electron 依赖)+ 字面 copy `storage.ts:transaction()` 12 行 wrapper**(storage.ts 链上 electron app 上下文依赖,纯 node 脚本无法直接 import storage.ts)。wrapper 真路径在 Checkpoint 2 故障注入 23 项覆盖(走真 capability → 真 storage.transaction):

| # | 场景 | 期望 |
|---|---|---|
| 1 | `storage.transaction(async tx => tx.putAtom(...))` + 自然完成 | atom 持久化,主连接能读 |
| 2 | `storage.transaction(async tx => { tx.putAtom(...); throw new Error('test') })` | atom **不**持久化,异常正确抛出 |
| 3 | `storage.transaction(async tx => { const a = await tx.putAtom(...); await tx.putEdge({ subject: a.id, ... }); })` 成功 | atom + edge 都持久化 |
| 4 | 场景 3 + 中途 throw → 两者都不持久化 | 全回滚 |
| 5 | 事务内 `tx.putAtom + tx.getAtom`(中间态读) | 能读到 |
| 6 | 长事务模拟:fn 内 `await sleep(30s)` 后 commit | 应成功(无 SDK timeout),storage 层未加 timeoutMs option 时 |
| 7 | 故意触发 cancel 失败:在 fn throw 前先手动 `await surrealTx.commit()`,再 throw → storage 层应捕获 cancel 失败 + 重抛原 fn 错 | 抛 fn 错而非 cancel 错 |
| 8 | createNote 模拟:`storage.transaction` 包 putAtom + putEdge hasNoteView,中途 throw → 两者都不在 | 模拟 createNote 调用站点回滚 |

**关键门槛**:8 场景全 PASS。任一 FAIL → STOP + 设计审查会签。

### 6.2 Checkpoint 2 — 全 capability 故障注入回归(Step 5.6)

见 §7 故障注入测试矩阵。

---

## 7. 故障注入测试矩阵(已定稿)

**故障注入策略**:
- **方式 A**(单测层):在 `fn` 内手动 `throw new Error('FAULT')` 模拟,验证 storage 层回滚
- **方式 B**(集成层):在 fn 中途 process.kill -SIGKILL(V2 启子进程模拟),验证重启后无 partial — **本 sub-phase 留可选**(单机单用户场景影响低,且 kill -SIGKILL 模拟工程量大)

**方式 A 矩阵**(必跑):

### 7.1 noteCapability.createNote

**调用站点**: [note/capability-impl.ts:60](../../../../../src/platform/main/note/capability-impl.ts#L60)

| # | 故障点 | 期望 |
|---|---|---|
| C1 | `tx.putAtom` 前 throw | atom + hasNoteView 边都不存在 |
| C2 | `tx.putAtom` 后 / `tx.putEdge hasNoteView` 前 throw | atom **不**持久化(关键!), hasNoteView 边不存在 |
| C3 | `tx.putEdge hasNoteView` 后 / `tx.putEdge inFolder` 前 throw | atom / hasNoteView / inFolder 都不存在 |
| C4 | folderId=null 路径自然成功 | atom + hasNoteView 边都在,inFolder 边不存在 |
| C5 | folderId 给定路径自然成功 | atom + hasNoteView + inFolder 都在 |

### 7.2 noteCapability.moveNote

**调用站点**: [note/capability-impl.ts:139](../../../../../src/platform/main/note/capability-impl.ts#L139)

| # | 故障点 | 期望 |
|---|---|---|
| M1 | `tx.deleteEdge` (旧 inFolder) 前 throw | 旧 inFolder 边保留,无新边 |
| M2 | `tx.deleteEdge` 后 / `tx.putEdge` (新 inFolder) 前 throw | 旧 inFolder 边**仍保留**(被回滚),无新边(关键回滚验证!)|
| M3 | `tx.putEdge` 后自然成功 | 新 inFolder 边在,旧不在 |
| M4 | newFolderId=null 路径(只删旧 + 不加新) | 旧不在,无新边 |

### 7.3 folderCapability.createFolder

**调用站点**: [folder/capability-impl.ts:54](../../../../../src/platform/main/folder/capability-impl.ts#L54)

(2026-05-13 实施者 Step 5.0 复 grep 发现,原决议字面遗漏 — 见 §10.B-1。语义跟 §7.1 createNote 同模式)

| # | 故障点 | 期望 |
|---|---|---|
| CF1 | `tx.putAtom` 前 throw | folder atom 不存在,无 inFolder 边 |
| CF2 | `tx.putAtom` 后 / `tx.putEdge inFolder` 前 throw | folder atom **不**持久化(关键回滚!),无 inFolder 边 |
| CF3 | parentFolderId=null 路径自然成功 | folder atom 存在,无 inFolder 边 |
| CF4 | parentFolderId 给定路径自然成功 | folder atom + inFolder 边都在 |
| CF5 | `tx.putEdge inFolder` 后自然成功(同 CF4 但显式独立验回滚边界)| 都在 |

### 7.4 folderCapability.moveFolder

**调用站点**: [folder/capability-impl.ts:110](../../../../../src/platform/main/folder/capability-impl.ts#L110)

| # | 故障点 | 期望 |
|---|---|---|
| MF1 | `tx.deleteEdge` (旧 inFolder) 前 throw | 旧 inFolder 边保留,无新边 |
| MF2 | `tx.deleteEdge` 后 / `tx.putEdge` (新 inFolder) 前 throw | 旧 inFolder 边**仍保留**(被回滚),无新边(关键回滚验证!)|
| MF3 | `tx.putEdge` 后自然成功 | 新 inFolder 边在,旧不在 |
| MF4 | newParentFolderId=null 路径(只删旧 + 不加新) | 旧不在,无新边 |

### 7.5 folderCapability.deleteFolder cascade

**调用站点**: [folder/capability-impl.ts:158](../../../../../src/platform/main/folder/capability-impl.ts#L158)

| # | 故障点 | 期望 |
|---|---|---|
| DF1 | cascade 第一个子资源 `tx.deleteAtom` 前 throw | folder + 所有子资源都保留 |
| DF2 | cascade 第 K 个子资源 `tx.deleteAtom` 后,第 K+1 前 throw | folder + 所有子资源**仍全部保留**(K 个回滚)(关键!) |
| DF3 | folder 本身 `tx.deleteAtom` 前 throw | folder + 子全保留 |
| DF4 | 完整成功 cascade | folder + 所有子资源都消失,无悬空边 |
| DF5 | 嵌套子 folder 深 3 层 cascade | 全消失 |

**全矩阵汇总**:5 (C) + 4 (M) + 5 (CF) + 4 (MF) + 5 (DF) = **23 个故障注入测试**(2026-05-13 修正:原决议字面 17 个,加 CF1-CF5 后变 22,但 §7.3 原 moveResource 3 项 → moveFolder 4 项,故净增 5+1=6 → 17+6=23)。Checkpoint 2 全 PASS 才允许进 Step 5.7 UI 集成。

### 7.6 故障注入测试 framework 设计

实施者可选两种实施方式:
- **方式 1**(推荐):写 `tmp/verify/sub-phase-3a-tx-fault-injection.mjs`,临时注入 fn 中途 throw,验证 storage 状态
- **方式 2**:用 `vitest` 或类似框架(V2 当前未集成单测,引入有 sunk cost)

**推荐方式 1**(沿 §3.5 verify 模式),不引入新依赖。

---

## 8. 反向更新清单(实施完成后,Step 5.8 落地)

| 决议 / 文档 | 章节 | 更新内容 |
|---|---|---|
| [011 sub-phase 1](011-sub-phase-1-surrealdb-infrastructure.md) | §4.2 line 864-869 X3a 条 | 改"已修复 sub-phase 3a-tx (decision 020)" + 字面指向 §3.5.bis 实证 + SDK 版本绑定纪律 |
| [008 storage interface](008-storage-layer-interface.md) | §事务 | 加 SDK 版本绑定纪律 + OCC 冲突已知约束(decision 020 §3.5.ter) |
| [009 migration strategy](009-migration-strategy.md) | §sub-phase 进度 | 加 sub-phase 3a-tx ✅ |
| [012 sub-phase 2](012-sub-phase-2-note-folder-migration.md) | §8 Q-tx | 改"已解决 sub-phase 3a-tx" |
| [013 sub-phase 3a 总纲](013-sub-phase-3a-graph-canvas-migration.md) | §3.5.1.bis | 改"已解决 sub-phase 3a-tx" |
| [014 sub-phase 3a-1](014-sub-phase-3a-1-graph-canvas-instance-migration.md) | §12 偏差登记 | 加"3a-tx 已解决,所有依赖 storage.transaction 原子性的设计点重新评估" |
| [016 sub-phase 3a-2.5](016-sub-phase-3a-2.5-note-form-upgrade.md) | §0.3 / §3 注释 | 移除"hasNoteView 边一对一机制留 3a-tx 升级" 的依赖 |
| [017 storage hotfix](017-storage-persistence-hotfix.md) | §12 偏差登记 / §9 Q-P3 | 加"3a-tx 完成"参考 |
| [019 cardinality hotfix](019-graph-instance-cardinality-hotfix.md) | §10 反向更新 | 加 3a-tx 参考 |
| `src/capabilities/pm-content/README.md` | line 29 | 移除"前置 Q-tx (storage.transaction 真原子性) 必做" |
| `src/capabilities/folder/DESIGN.md` | line 63, 98 | 注释更新"事务原子性已恢复" |
| `docs/RefactorV2/notes/L7-next-phase-kickoff.md` | §1.4 Q-tx + §6.2 | 改"已解决",移除"3.x 待查"误导;§2.1 sub-phase 3a-tx ✅ |
| **`docs/RefactorV2/data-model/persistence/SDK-version-binding-policy.md`** | **新建** | **独立永久文档(用户 P1 硬性,非可选)**,骨架见 §4.4 |
| **memory** `feedback_sdk_version_binding_policy.md` | **新建(用户 P1 硬性,非可选)** | feedback 类型,引用 SDK-version-binding-policy.md;描述:"SDK 选定绑定发布包 + 跨大版本独立决议" |
| **memory** MEMORY.md | 加新条目 | 链 feedback_sdk_version_binding_policy.md |

---

## 9. Open Questions(留尾,binary verify 后更新)

### 9.1 Q-tx-perf:长事务超时

**问题**:SurrealDB 3.0.4 binary 默认无超时(场景 8 实测 6s 仍能 commit)。是否需要 storage 层加 timeout 防御?

**当前结论**:**§5 实施期加 `timeoutMs` option,默认 30s,跨 timeout 自动 cancel**。

### 9.2 Q-tx-concurrent:并发事务的锁/排队/冲突

**问题**:并发事务的具体语义?

**实测结论(场景 9/12)**:
- 写不同 record:独立运行,无干扰
- 写同一 record:OCC 冲突,后 commit 报 `Transaction conflict: ... can be retried`

**单机单用户场景影响**:极低。**作为已知约束登记到 decision 008**。

### 9.3 Q-tx-deleteAtom-atomicity

**问题**:`storage.deleteAtom` 内部级联删 atom + 多张边表,单语句 SurrealQL 是否原子?

**当前结论**:**§5 实施期补一个独立 binary verify**(deleteAtom 中途 binary kill,重启后是否有 partial 残留)。不阻塞本决议拍板(因为 deleteAtom 不走 transaction wrapper)。

### 9.4 Q-tx-occ-retry(场景 12 衍生):OCC 冲突的应用层 retry 策略

**问题**:`storage.transaction(fn)` 是否内置 OCC 冲突 retry?

**本决议拍板**:**不内置**(选项 C,见 §3.5.ter)。理由:
- 单机单用户场景并发冲突概率极低
- 内置 retry 引入新设计点(超时 / 退避 / fn 副作用)超出本 sub-phase 范围
- 留 sub-phase 5+ 协作场景启动时单独决议

**当前实施纪律**:storage.transaction 透传 SurrealDB 的 `Transaction conflict` 错误,capability 上层若想处理可以 try-catch retry,本 sub-phase 不强制。

### 9.5 Q-tx-cancel-error-handling:cancel 失败时的错误处理

**问题(场景 7/10/13a 衍生)**:fn 抛错后 cancel 又抛错,该传递哪个错误?

**当前 §4.1 草案**:cancel 失败时 console.error,继续抛原 fn 错误(不让 cancel 异常遮盖原因)。实施期 §5 字面验证。

---

## 10. 偏离登记(实施期更新)

> 实施期间任何偏离本决议字面的情况(SDK 行为意外 / 额外消费点 / 路径调整 / OCC retry 触发等)由实施者在此登记,总指挥反向更新决议正文。

**预期偏离类型分级**:
- **类型 A**(SDK 行为不符 §3.5.bis):严重,STOP + 设计审查
- **类型 B**(发现新调用站点):中等,可能影响 §7 矩阵
- **类型 C**(测试期发现 OCC 冲突):预期外,记录但不阻塞(单机单用户)
- **类型 D**(typecheck / lint 暴露 implicit any / unsafe cast):低,实施期修复 + 登记

### 10.1 已登记偏离

#### 10.1.B-1 调用站点数 4 → 5(2026-05-13,实施者 Step 5.0 发现)

**类型**: B(发现新调用站点 + 设计师 grep verify 失误)

**实施者发现**:Step 5.0 复 grep `storage.transaction` 字面后,实际找到 **5 个**调用站点,非决议 §0.4 第 4 项 / §1.2 表格字面登记的 **4 个**。具体:
- `note/capability-impl.ts:60` createNote(已登记)
- `note/capability-impl.ts:139` moveNote(已登记,决议字面错写 "deleteNote")
- `folder/capability-impl.ts:54` **createFolder**(❌ 决议字面错位为 "moveResource",实际应该是 createFolder)
- `folder/capability-impl.ts:110` **moveFolder**(❌ 决议字面错合并到 "deleteFolder 110/158")
- `folder/capability-impl.ts:158` deleteFolder(已登记)

**根因**:设计师 §0.4 grep verify 第 4 项漏数 + 字面错位,跟 014 §12.5 第 4 次教训(决议 014 实施期 sub-phase 2 deleteFolder cascade scope 漏核)同型,反复踩同类问题。

**总指挥处置**(2026-05-13):**选项 B + 顺手反向更新决议**,不选 "继续按旧字面推进 + §10 登记偏离":
- 反向更新决议字面(§0.4 / §1.2 / §4.3 / §6 / §7.3 / §7.4 / §7.5 / §11.4)修正调用站点数 + 名字 + 行号
- §7 故障注入矩阵字面增加 §7.5 createFolder 5 项(CF1-CF5),原 §7.3 moveResource → §7.4 moveFolder(扩 4 项)
- 全矩阵 17 → 23 项
- 实施工程量影响:**0 增加**(改造点单一,5 站点透明受益);§7 矩阵 + 6 项是字面登记 + 实施期 Step 5.6 必跑

**Commit**: 待本反向更新 commit 完成后落地(在 main 分支直接 commit,实施者 rebase/pull main 拿新决议字面后继续 Step 5.1)

**实施者后续动作**: pull main 后从 Step 5.1 binary verify 复跑继续,无回退;Step 5.6 故障注入矩阵跑 23 项而非 17 项。

**第 11 次设计师教训** → 见 §11.4。

#### 10.1.B-2 verify 脚本不能直接 import storage.ts(electron 依赖)(2026-05-13,实施者 Step 5.5 发现)

**类型**: B(决议字面要求 verify "直接调 V2 SurrealStorage" + 设计师没核 import 链 electron 依赖)

**实施者发现**:Step 5.5 准备写 `tmp/verify/sub-phase-3a-tx-storage-integration.mjs` 时:
- 决议 §5.5 / §6.1 字面要求"直接调 V2 `SurrealStorage.transaction(fn)`"
- 但字面 grep [storage.ts:28](../../../../../src/storage/surreal/storage.ts#L28) `import { getDB, getMode } from './client'`
- [client.ts:16](../../../../../src/storage/surreal/client.ts#L16) `import { app } from 'electron'` + `app.getPath('userData')` 等多处 electron API 调用
- 纯 node 脚本 import storage.ts 会因 electron app 上下文不存在而 fail

**根因**:设计师写决议 §5.5 / §6.1 字面时没 grep storage.ts → client.ts → electron 这条 import 链,字面假设"storage.ts 是纯模块可独立 import"。

**总指挥处置**(2026-05-13):**选项 A**(实施者推荐),4 个具体约束:
- verify 脚本 import `src/storage/surreal/transaction-helpers.ts`(零 electron 依赖,实施者 Step 5.2 设计的解耦主体)
- 自写 12 行 transaction wrapper **字面 copy** `storage.ts:transaction()` 当前实施(commit `ceb92cd` 后形态)
- import surrealdb SDK 用本机临时 Surreal 连接(端口 8534,沿 §3.5 verify 模式)
- 完成报告字面登记"verify 限制":storage.ts 12 行 wrapper **没**走 verify;wrapper 真路径在 Checkpoint 2 故障注入 23 项覆盖(走真 capability → 真 storage.transaction → wrapper 真跑)

**反向更新**:决议 §5.5 / §6.1 字面已修正(2026-05-13)删除线 + 改"import transaction-helpers + 字面 copy wrapper"。

**Commit**: 待本反向更新随总指挥侧 3 件待办一起 commit(本批改动)。

**第 12 次设计师教训** → 见 §11.5。

#### 10.1.D-1 verify 脚本 .mjs → .mts + esbuild bundle(2026-05-13,实施期工程细节)

**类型**: D(typecheck / lint 暴露 implicit any / unsafe cast,但本次是工程链路细节)

**实施者发现**:node v25 strip-types 链式解析需 `.mts` 后缀 + Node ESM 不解 ts 后缀 → 需要 esbuild bundle 替 client.ts 为 stub。

**总指挥处置**:不阻塞,实施期工程细节,登记 §10 类型 D + commit message 字面记录(`a1ae9ab` / `4b33404`)。

---

## 11. 累积教训(实施完成后追加)

### 11.1 第 9 次设计师教训(§0.6 已登记)

> **拍板涉及外部依赖版本时,要意识到该选择会绑定到发布包,跨大版本升级是独立 sub-phase 不能合并。**

落点:`SDK-version-binding-policy.md`(永久文档)+ memory `feedback_sdk_version_binding_policy.md`(永久 memory)+ 第 9 次教训写本决议 §0.6 + 反向更新 008 / 011 字面登记。

### 11.2 第 10 次教训(预登记):binary verify 揭示 OCC 冲突语义

> **拍板事务设计时,必须 binary verify 并发语义**(场景 12 揭示 OCC 而非锁定 / last-write-wins),不靠 SDK 文档假设。

本次 binary verify 场景 12 实证 SurrealDB 走 OCC,后 commit 抛 `Transaction conflict: ... can be retried`。本来设计师可能默认假设"两个 transaction 都成功(MVCC 快照隔离)"或"后写覆盖"。**实证才能拍板**。

落点:Q-tx-occ-retry Open Question + decision 008 已知约束 + 留 sub-phase 5+ 协作场景单独决议。

### 11.3 实施完成后追加教训(占位)

> 实施期 / Checkpoint / 集成测试过程中发现的新教训由总指挥追加。

### 11.4 第 11 次设计师教训(2026-05-13,实施者 Step 5.0 触发)

> **§0.4 grep verify 必须双向核对**:决议字面 → 代码 + 代码 → 决议字面,不能只数"找到 N 个"就完事;`storage.transaction` 调用站点数错算 4 vs 实际 5,反映"列出代码现状时数到一半就停"的失误。

**起因**:设计师写决议 §0.4 第 4 项时 grep `storage\.transaction` 出 4 个调用站点,字面登记 "4 个"。但实际:
- folder/capability-impl.ts 有 3 处(line 54 / 110 / 158),设计师只看到 110/158 误合并为 "deleteFolder",漏 line 54 的 createFolder
- folder/capability-impl.ts:54 字面错登记为 "moveResource"(纯笔误,V2 字面没有 moveResource 这个函数)
- note/capability-impl.ts:139 字面错登记为 "deleteNote"(纯笔误,实际是 moveNote;deleteNote 不走 transaction)

**根因分析**:
1. 设计师从代码 grep 结果**复制行号**到决议时,**没回头核对函数名 / 操作语义**
2. **字面用模糊记忆**("似乎是 moveResource")而非 grep 实证函数定义,违反 SDK-policy §2.2 "实证字面证据" 精神
3. 跟 014 §12.5 第 4 次教训(sub-phase 2 deleteFolder cascade scope 没核)同型 — **反复在"已实施模块自动支持新需求"假设上踩**

**纪律升级**:
- **`grep` 结果**(行号 + 函数名)必须**双向核对**:
  1. 决议字面 → 代码:`grep -n "<函数名>" <文件>` 实证字面行号
  2. 代码 → 决议字面:`grep -n "<操作模式>" <文件> | wc -l` 实证总数
  3. **不允许复制 grep 一边的结果到另一边**而不双向核
- **行号 + 函数名必须配对登记**,不允许"line X / line Y 都是 op Z"的合并(原 §1.2 字面 "folder/capability-impl.ts:110, 158 deleteFolder" 就是这种合并 + 错位)
- **决议 §0.4 grep verify 项必须 commit 时附 grep 命令字面**,实施者 Step 5.0 复跑同命令实证

**落点**:第 11 次教训写入本决议 §11.4 + 反向更新 [decision 013 §0.5](013-sub-phase-3a-graph-canvas-migration.md) 累积纪律表 + 实施者 Step 5.0 verify 任务增"附 grep 命令字面"要求。

### 11.5 第 12 次设计师教训(2026-05-13,实施者 Step 5.5 触发)

> **决议 §5 / §6 字面 verify / 实施任务必须 grep import 链确认可执行性**;不只验证 "API 字面存在",还要验证 "import 链跑得起来"。

**起因**:决议 §5.5 / §6.1 字面要求 "直接调 V2 `SurrealStorage.transaction(fn)`",但字面没核 storage.ts → client.ts → electron 这条 import 链 — 实施者写 verify 脚本时才发现"纯 node 脚本 import storage.ts 会因 electron app 上下文 fail"。

**根因分析**:
1. SDK-policy §2.2 已要求"grep `.d.ts` 字面证据"实证 **API 存在**
2. 但 SDK-policy §2.2 字面**没要求**实证 **API 可在 verify 上下文跑起来**(包含 verify 脚本所在进程的依赖图)
3. 决议字面要求"直接调 V2`SurrealStorage`",设计师假设 storage.ts 是"纯模块可独立 import",没核 import 链
4. 跟第 9 次教训(SDK 版本 grep 实证)同型扩展 — **从"实证 API 字面"扩展到"实证 API 可执行链路"**

**纪律升级**:
- **决议 §5 / §6 字面要求 import 项目内模块跑 verify** 时,**必须**:
  1. `grep -A 5 "import " <目标模块>` 实证 import 链
  2. 跟踪 import 链到底层依赖(node_modules / electron 模块 / etc),实证 verify 脚本运行上下文是否兼容
  3. **若 import 链含 electron / window / DOM / app context**,verify 脚本必须**重新设计**(stub / 解耦 / 字面 copy),不能字面 "直接 import"
- **决议字面如果说"直接调 V2 模块"**,必须**附 import 链验证 grep**,沿 SDK-policy §2.2 模式扩展

**落点**:第 12 次教训写入本决议 §11.5 + **必须**反向更新 [SDK-version-binding-policy.md](../SDK-version-binding-policy.md) §2.2 加"API 可执行链路实证"子项 + 反向更新 [decision 013 §0.5](013-sub-phase-3a-graph-canvas-migration.md) 累积纪律表。

**反向更新追加**(总指挥后续 commit):
- SDK-policy §2.2 升级到 v1.2,加"API 可执行链路实证"作为第 4 项
- 反向更新 SDK-policy §6 修订记录追加 v1.2 行
- 反向更新 SDK-policy §5 教训登记加第 12 次

---

*决议 020 §0-§11 全部完成 + 实施期偏离 B-1 + B-2 + D-1 已落字面(2026-05-13)。Step 5.9 总指挥审计 PASS,5 个关键约束实证 + Step 5.8 反向更新 11 commit 抽检落实。等用户拍板合 main + push 收尾本 sub-phase。*
