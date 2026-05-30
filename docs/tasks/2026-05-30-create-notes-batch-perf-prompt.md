# Perf: createNotesBatch 单事务 round-trip 风暴 — 92 篇 markdown 写库 35s

> 用户 V5 实测:`importMarkdownBatch` → `createNotesBatch` 92 篇 markdown 一批写库 **35s**.读侧已优化(PR B / listNotes metadata-only),写侧未动.单事务内串行 await query 雪崩,~800 query/s 跟 35s 对得上.本期根治写侧.

---

## 0. 角色 / 工作纪律

你是本 prompt 实施 subagent. **strict mode**:

1. 只动本 prompt §3 / §4 列的文件,**不擅自重构**周边代码
2. **每条 Bash 必 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`**(V2 cwd 漂移已 16 次事故)
3. **memory 必读**:
   - `feedback_surrealdb_4x_no_type_thing` — 新 SQL 函数必 grep 仓库 + 看官方 doc verify
   - `feedback_surrealdb_inside_not_in` — IN vs INSIDE
   - `feedback_filter_single_vs_batch_mutex` — filter 字段互斥纪律
   - `feedback_strict_compliance_workflow` — strict 4 条
   - `feedback_v2_is_workspace_v1_is_reference` — V2 工作 V1 只读参考
   - `feedback_no_fallback_bandaid_fixes` — 修真因不兜底
   - `feedback_fast_path_api_must_migrate_slow_caller` — 新 API 必须把热 caller 切过去
4. sandbox 拦截 `git commit/push`/`npm start` 等 → 停手汇报,**禁** `--dangerouslyDisableSandbox`
5. 发现非本 prompt 范围的 bug → **登记到汇报里**,不擅自修
6. **禁止**用 fallback / 兜底绕过未诊断根因

---

## 1. 背景 + 真因

### 1.1 用户现场

```
用户 V5 实测: 92 篇 markdown 一批导入 createNotesBatch 单事务写库耗时 35 秒
```

读侧 OK(listNotes metadata-only PR cb46dc68 后 200ms).写侧未动.

### 1.2 真因(已字面 grep 锁定)

[src/platform/main/note/capability-impl.ts:781-862](src/platform/main/note/capability-impl.ts#L781-L862) `createSingleNoteFromDrafts` 字面 4 个 await 循环:

```ts
// 3. atoms 字面写入
for (const draft of item.atoms) {
  const entity = await tx.putAtom<'pm'>({ payload: draft.payload });  // N 次串行
}

// 4a. belongsToNote: 每 draft → container
for (const draft of item.atoms) {
  await tx.putEdge({ ... });  // N 次串行
}

// 4b. childOf
for (const draft of item.atoms) {
  if (!draft.parentTmpId) continue;
  await tx.putEdge({ ... });  // ~N 次串行
}

// 4c. nextSibling
for (const realIds of siblingGroups.values()) {
  for (...) await tx.putEdge({ ... });  // ~N 次串行
}
```

**雪上加霜**:[src/storage/surreal/transaction-helpers.ts:171-174](src/storage/surreal/transaction-helpers.ts#L171-L174) `putEdgeViaTx` 字面对每条边跑 1-2 次 `assertAtomExistsViaTx`(SELECT 校验 subject/object 存在):

```ts
await assertAtomExistsViaTx(tx, input.subject.atomId, 'subject');  // 1 query
if (input.object.kind === 'atom') {
  await assertAtomExistsViaTx(tx, input.object.atomId, 'object');  // 1 query
}
```

一条 nextSibling 边 = **3 round-trip**(1 putEdge + 2 assert).childOf 同理.belongsToNote = 2 round-trip(subject 是 atom + object 是 atom = 2 assert + 1 putEdge).

**且 assert 命中率 100%** — subject/object 字面就是本事务刚 putAtom 出来的,assert 必通过,纯浪费.

### 1.3 估算

3000 块场景(92 篇 × ~30 块平均):

| 阶段 | 次数 | round-trip / 次 | 累计 |
|---|---|---|---|
| putAtom × 3000 | 3000 | 1 | 3000 |
| container × 92 | 92 | 1 | 92 |
| hasNoteView 边 × 92 | 92 | 1 + 0 assert(object 是 literal) | 92 |
| inFolder 边 × ~80 | 80 | 1 + 1 assert | 160 |
| belongsToNote × 3000 | 3000 | 1 + 1 assert(object container 已校验) | 6000 |
| childOf × ~2500 | 2500 | 1 + 2 assert | 7500 |
| nextSibling × ~2900 | 2900 | 1 + 2 assert | 8700 |
| **总计** | | | **~25500 round-trip** |

35s / 25500 ≈ 1.4ms/query — 跟 SurrealDB 单 RPC localhost round-trip 量级对得上.

### 1.4 决议关联

`docs/RefactorV2/data-model/persistence/decisions/020-sub-phase-3a-tx-true-atomicity.md` §4.1 / §5.2 字面拍板 ViaTx helper 走 `tx.query` 替代 `db.query`,本身不涉及"是否批量".本 prompt 不破 decision 020.

decision 020 §3.5.bis 场景 4 binary verify "事务内读 uncommitted 写"已 PASS,所以**事务内 assert 命中率 100%** 这个事实有 binary verify 背书.

---

## 2. 修法范围(优先级排序)

按 **ROI 排序**,subagent 字面按顺序实施;每档实施后 V5 实测,根据时间再决定下一档.

### 2.1 档 1(必做):删 putEdgeViaTx 内的 assertAtomExistsViaTx

**理由**:

- 单事务内 subject/object 是本事务刚 putAtom 出的,`assertAtomExists` 100% 命中(verify by decision 020 §3.5.bis 场景 4)
- 校验意义 = 防止 caller 传错 atomId / 防止数据坏,但 caller 是受控 capability 不是用户输入
- 删 assert 节省 ~14000 round-trip(每边 1-2 次 × 8500 边)

**修法**:

```ts
// transaction-helpers.ts:159 putEdgeViaTx
// 删除:
await assertAtomExistsViaTx(tx, input.subject.atomId, 'subject');
if (input.object.kind === 'atom') {
  await assertAtomExistsViaTx(tx, input.object.atomId, 'object');
}
```

**降级风险评估**:assert 删了后若 caller 真传错 atomId,SurrealDB **edge 表的 reference 字段**会接受任何 string(不强校验存在),变孤儿边.孤儿边在 listEdges 时不影响查询,但 atom 查询/cascade 时可能露馅.

**字面缓解**:

- 删 assert 不等于无校验 — `db.query` 失败本身就会 throw(SurrealDB schema 拒绝)
- 真要校验,放 `storage.transaction` 提交前一次性批量 SELECT,而不是每条边 2 次
- **本期采纳 = 直接删**,理由:
  - createNotesBatch 唯一调用者是受控 import 路径(view → IPC → capability),caller 字面构造 tmpToReal Map 后才 putEdge,数据正确性已由应用层保证
  - 若未来 caller 增多需要校验,在 storage 层另加 `tx.assertAtomsExist(ids[])` 批量 API

### 2.2 档 2(推荐):事务内 await 改 Promise.all 并发

**理由**:SurrealDB 单 connection 字面串行处理 query,但 **WebSocket RPC 层支持 pipeline**(批量发请求,SurrealDB 按收到顺序返回响应).Promise.all 字面在 client 端并发发出,SDK 透明 pipeline,**单事务内并发不破原子性**(同 connection 同事务).

**风险**:

- SurrealDB SDK 4.x 是否真支持 pipeline / 并发 query → **必须 binary verify**(写一个小测把 50 个 putAtom Promise.all 跟串行对比时间,差 5x 以上 = 支持 pipeline)
- 若不支持,Promise.all 字面降级到串行,无负面影响,但也无收益 → 字面保留代码可读性差,**确认不支持就 revert**

**修法**(伪代码,需 verify 后落地):

```ts
// 阶段 3: putAtom 全 atoms 并发
const atomEntities = await Promise.all(
  item.atoms.map(draft => tx.putAtom<'pm'>({ payload: draft.payload })),
);
item.atoms.forEach((draft, i) => tmpToReal.set(draft.tmpId, atomEntities[i].id));

// 阶段 4a/4b/4c: 边并发
const edges = [
  // belongsToNote
  ...item.atoms.map(draft => ({ predicate: BELONGS_TO_NOTE_PREDICATE, ... })),
  // childOf
  ...item.atoms.filter(d => d.parentTmpId).map(draft => ({ predicate: CHILD_OF_PREDICATE, ... })),
  // nextSibling
  ...[...siblingGroups.values()].flatMap(realIds => realIds.slice(0, -1).map((id, i) => ({
    predicate: NEXT_SIBLING_PREDICATE,
    subject: { kind: 'atom', atomId: id },
    object: { kind: 'atom', atomId: realIds[i + 1] },
    ...
  }))),
];
await Promise.all(edges.map(e => tx.putEdge(e)));
```

**估算**:25500 串行 → ~50 并发批次(SDK pipeline 上限取决于 SurrealDB connection limit + buffer),时间 ~5s.

### 2.3 档 3(选做):storage 加 batchPutAtoms / batchPutEdges 批量 API

**理由**:单 SQL `CREATE atom CONTENT [{...}, {...}, ...]` 字面**一次 round-trip 多行写入**.SurrealDB 4.x 支持 multi-row CREATE/INSERT(需 verify).

**修法**:

```ts
// transaction-helpers.ts 加:
export async function batchPutAtomsViaTx<D>(
  tx: SurrealTransaction,
  inputs: PutAtomInput<D>[],
): Promise<AtomEntity<D>[]> {
  // 1 query 多 row INSERT
  await tx.query(
    `INSERT INTO atom $rows`,
    { rows: inputs.map((input, i) => ({ id: atomRid(generateUlid()), ... })) },
  );
  // 返回所有 entity
}

export async function batchPutEdgesViaTx(...): Promise<EdgeEntity[]> { ... }
```

createNotesBatch 字面切到这两个新 API.

**风险**:

- SurrealDB INSERT multi-row 语法字面在 4.x 是否支持(`feedback_surrealdb_4x_no_type_thing` 教训!必须 grep 仓库现有用法 + 看官方 doc verify)
- ULID 生成移到应用层(不能让 storage 一行一个),tmpId → realId 映射前置
- 估算:25500 round-trip → ~10 batch query,**时间 ~500ms**

**本期采纳决策**:档 3 **设计但不实施**,理由:

- 档 1 + 档 2 估算已能从 35s → ~5s,90% 用户场景够用
- 档 3 引入新 SQL 语法 + ULID 前置生成,风险面大
- 留 followup PR,有 binary verify 后再做

### 2.4 不做的事

- ❌ **不要**改 `createNotesBatch` 为多事务(破单事务整体回滚语义,字面破 SP-5 design)
- ❌ **不要**加 retry / fallback(`feedback_no_fallback_bandaid_fixes`)
- ❌ **不要**碰 read path(读侧已经 PR B + listNotes 优化过,不在本期范围)
- ❌ **不要**碰 `storage.transaction` 自身(decision 020 § 拍板)
- ❌ **不要**降级单篇并发到多事务(SP-5 设计 = 单事务整体回滚)
- ❌ **不要**改 SP-5 的 500 篇硬拦阈值(`MAX_BATCH_NOTES`,非本期范围)

---

## 3. 实施步骤

### 3.1 Phase 1: baseline 测量

1. `cd /V2 && git checkout -b perf/create-notes-batch main`(用户预先切,sandbox 拦你就报)
2. 用户预备**复现数据集**:92 篇 markdown / ~3000 块的导入 batch(用户已有,可重复 import)
3. 加临时 baseline log(只测量,不修代码):
   ```ts
   // createSingleNoteFromDrafts 入口
   const t0 = performance.now();
   // ... 4 个 await 循环 ...
   console.log(`[perf/createSingleNote] note=${title} atoms=${item.atoms.length} dur=${Math.round(performance.now()-t0)}ms`);
   
   // createNotesBatch 入口/出口
   const tBatch = performance.now();
   // ... storage.transaction ...
   console.log(`[perf/createNotesBatch] items=${items.length} dur=${Math.round(performance.now()-tBatch)}ms`);
   ```
4. 用户 npm start + 复现 → 贴 baseline log 给主对话(预期 ~35s + 各 single note 分布)

### 3.2 Phase 2: 档 1 实施

1. 删 `putEdgeViaTx` 内 2 处 assertAtomExistsViaTx 调用
2. 加注释字面说明"事务内 subject/object 已由应用层 caller (capability 层) 保证存在,assert 100% 命中无意义"
3. typecheck + V2 50/50 tests PASS
4. 用户 V5 实测 → 贴 log 给主对话(预期 35s → ~12-15s,约 -57%)
5. commit:
   ```
   perf(storage): 删 putEdgeViaTx 内 assertAtomExistsViaTx
   
   单事务内 subject/object 由 caller 保证存在,assert 100% 命中纯浪费.
   createNotesBatch 92 篇场景 ~14000 redundant SELECT 删除.
   实测 35s → Xs.
   ```

### 3.3 Phase 3: 档 2 实施(条件:档 1 后仍 > 10s)

1. **先 binary verify** SurrealDB SDK 4.x 是否支持单 connection 并发 query:
   ```ts
   // tests/storage/surreal-pipeline-verify.test.ts (新建,跑完删)
   const t0 = performance.now();
   await Promise.all(Array.from({length: 50}, () => 
     storage.putAtom({ payload: { domain: 'pm', payload: {} } })));
   const tParallel = performance.now() - t0;
   
   const t1 = performance.now();
   for (let i = 0; i < 50; i++) {
     await storage.putAtom({ payload: { domain: 'pm', payload: {} } });
   }
   const tSerial = performance.now() - t1;
   
   console.log(`parallel=${tParallel}ms serial=${tSerial}ms ratio=${tSerial/tParallel}`);
   ```
   - 若 ratio >= 3x → SDK 支持 pipeline,实施档 2
   - 若 ratio < 2x → SDK 不支持,字面跳过档 2 直接评估档 3 或 stop
2. 实施 Promise.all 并发(按 §2.2 伪代码)
3. typecheck + V2 50/50 + V5 实测
4. commit:
   ```
   perf(note): createSingleNoteFromDrafts atoms/edges Promise.all 并发
   
   SDK 4.x 单 connection pipeline 实测 binary verify Nx 加速.
   单事务原子性保留(同 connection 同 tx).
   实测 Xs → Ys.
   ```

### 3.4 Phase 4: 清理 baseline log + 汇报

1. 删 Phase 1 加的 perf log(grep `[perf/createSingleNote]` 应 0 残留)
2. 按 §6 模板汇报主对话

---

## 4. 文件清单

| 文件 | 改动 | 档 |
|---|---|---|
| `src/storage/surreal/transaction-helpers.ts:171-174` | 删 putEdgeViaTx 内 2 处 assertAtomExistsViaTx | 档 1 |
| `src/platform/main/note/capability-impl.ts:781-862` | createSingleNoteFromDrafts 4 个 await 循环改 Promise.all | 档 2 |
| `tests/storage/surreal-pipeline-verify.test.ts` | 临时 binary verify SDK pipeline,跑完删 | 档 2 验证 |
| `tests/storage/transaction-helpers.test.ts`(若已存在) | 同步 mock 更新 | 档 1 |

---

## 5. 风险 + 已知坑

### 5.1 删 assert 后 caller 数据正确性责任转移

createNotesBatch 唯一调用者是 import 路径(`importMarkdownBatch` → `noteCap().createNotesBatch`).import 路径走 `markdownToAtoms` 生成 tmpId,createNotesBatch 内部构造 tmpToReal 映射,putEdge 前 throw if `tmpToReal.get` undefined(line 836).

**字面有应用层校验**,无 silent corruption 风险.

未来若有非 import 路径调 createNotesBatch / 加新 caller — 必须在 caller 端保证 atomId 引用正确.字面 doc 注释 capability types.ts `createNotesBatch` 入口说明这条契约.

### 5.2 SurrealDB SDK pipeline 行为字面未 verify

档 2 实施前必须跑 §3.3 步骤 1 的 binary verify.若 SDK 不支持单 connection 并发(同 connection 内 await 必串行),Promise.all 字面无收益.**verify 之前不要落代码**.

### 5.3 SurrealDB 4.x INSERT multi-row(档 3 才涉及)

`feedback_surrealdb_4x_no_type_thing` 教训:新 SQL 必须 grep 仓库现有用法 + 看官方 doc.档 3 本期**不实施**,仅设计登记.

### 5.4 Memory log 临时遗留

Phase 1 加的 perf log 必须 Phase 4 删干净.grep `[perf/createSingleNote]` 应 0 残留.

### 5.5 5B Stage 7 spec 字面约束

docs/RefactorV2/data-model/persistence/spec.md §6 PE4 字面拍板"createNotesBatch 单事务 + 三类边(belongsToNote / childOf / nextSibling)" — 本 prompt 不破这条 spec.单事务保留,仅优化事务内 round-trip.

---

## 6. 汇报模板(向主对话)

```
createNotesBatch perf 完成汇报:

一、字面产出(N commit)
- (列 hash + 描述)

二、Phase 1 baseline 实测
- 用户复现数据集: 92 篇 / ~3000 块
- createNotesBatch 总耗时: ~35s
- 单 note 平均: ~380ms (~30 块/note)

三、Phase 2 档 1 实施
- 修法:删 putEdgeViaTx 内 2 处 assertAtomExistsViaTx
- 实测: 35s → Xs (-Y%)

四、Phase 3 档 2 实施(若实施)
- SDK pipeline binary verify ratio: X (>=3 才落代码)
- 修法: 4 个 await 循环改 Promise.all
- 实测: Xs → Ys (-Z%)

五、验收
- V1 typecheck: PASS / FAIL
- V2 现有 50/50: PASS / FAIL
- V3 临时 verify test: 跑完删 / 保留(若加值)
- V4 grep perf log: [perf/createSingleNote] 0 残留
- V5 用户实测: 35s → ?s

六、关键决策 + 教训
- (列偏离 prompt / 决议的拍板)
- (memory 建议)

七、剩余债 + 下游 PR
- 档 3 batchPutAtoms / batchPutEdges 批量 API (本期未实施,设计登记)
- 其它(若发现)

八、等待指挥拍板
- 合 main / push / decision 文档更新
```

---

## 7. Self-Contained Check

新会话 subagent 不必跑额外调研,本 prompt 已含:

- ✅ 真因(§1.2 字面 grep 锁定)
- ✅ 估算(§1.3 round-trip 数 + 时间对账)
- ✅ 修法 3 档优先级 + 字面规格(§2)
- ✅ 实施步骤 Phase 1-4(§3)
- ✅ 文件清单(§4)
- ✅ 风险 + 已知坑(§5)
- ✅ 汇报模板(§6)
- ✅ 反对策(§2.4 不做的事)
- ✅ 决议关联(decision 020 / spec PE4 字面不破)

唯一外部依赖:

- `git checkout -b perf/create-notes-batch main` — 用户预切
- 用户准备 **92 篇 markdown 复现数据集** — 跟会话 baseline 同一数据
- `npm start` 实测 — 用户跑(sandbox)

---

*Prompt 文档 · 2026-05-30 · perf/create-notes-batch · 写侧 round-trip 雪崩根治*
