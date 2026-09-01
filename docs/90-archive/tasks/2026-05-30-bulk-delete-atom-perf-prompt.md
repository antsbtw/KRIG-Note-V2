# Fix: bulkDelete atom DELETE 全表扫 — 18s → ~5s 收尾达标

> bulkDelete edge PR(a96c8a7b)+ collect PR(25f00548)合 main 后,V5 实测
> 58.6s → 18s (-69% 累计).剩 atom DELETE 16.2s (90%) 是最后 dominant.
> 真因:`DELETE atom WHERE id INSIDE $rids` 同款"INSIDE 大数组退化扫描",
> Phase A binary verify(`tests/storage/bulk-delete-perf-verify.test.ts`)
> 字面已 declineRatio 17.0× 复现.本期收尾,跑到 < 5s 目标.

---

## 0. 角色 / 工作纪律

你是修法 subagent. **strict mode**:

1. 只动本 prompt §3 / §4 列的文件,**不擅自重构**周边代码
2. **每条 Bash 必 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`**(V2 cwd 漂移 16+ 次史)
3. **memory 必读**(按重要性):
   - `feedback_surrealdb_4x_no_type_thing` — 新 SQL 函数/形式必 grep 仓库 + 看官方 doc verify
   - `feedback_sdk_version_binding_policy` — 拍板 API 前必 grep package.json 版本绑定
   - `feedback_surrealdb_inside_not_in` — IN vs INSIDE 语义不同
   - `feedback_strict_compliance_workflow` — strict 4 条
   - `feedback_no_fallback_bandaid_fixes` — 修真因不兜底
   - `feedback_perf_remeasure_must_clean_baseline` — V5 复测必空库
   - `project_bulk_delete_edge_perf_done` — 前序 PR 上下文 + 双开 sidecar 撞库教训
   - `create-notes-batch-perf-stage-1-done` — Phase A pattern 同款套路
4. sandbox 拦截 `npm start` → 报告,用户跑 V5
5. 发现非范围 bug → **登记到汇报里**,不擅自修
6. **跟 bulk-delete edge PR 同款两步分批**:Phase A binary verify 完成 STOP 汇报,等用户拍板候选后才进 Phase B

---

## 1. 背景 + 真因(字面证据已就位)

### 1.1 V5 实测 baseline(25f00548 后)

```
总耗时: 17996ms
段拆解:
  collect           ~1715ms  10%   ← 已修(本 PR 不动,2 子段合计 ~1.7s)
  edge_subject      ~150ms × N 批  ~4.0s 18%  ← edge PR 已修走索引
  edge_object       ~5ms × N 批    个位 ms  ← edge PR 已修走索引
  atom DELETE       ~11.8s   ~66%   ← **本 PR 修**(drainFolderDeletion 16.2s 主体)
  其它              ~400ms
```

drainFolderDeletion 主体 16248ms,首批 atom=790ms 单调递减(declineRatio ~17.5×),跟 Phase A verify 字面一致.

### 1.2 真因代码

[src/storage/surreal/transaction-helpers.ts:218-221](src/storage/surreal/transaction-helpers.ts#L218):

```ts
const rids = ids.map((id) => atomRid(id));
const tAtom = performance.now();
const atomRes = await tx.query<[Array<unknown>]>(
  `DELETE atom WHERE id INSIDE $rids RETURN BEFORE`,
  { rids },
);
```

`id INSIDE $rids` — 1000 元素 RecordId 数组 INSIDE.即使 `id` 是 SurrealDB record 主键,大数组 INSIDE 仍退化扫描整个 atom 表.

### 1.3 Phase A verify 已铁证

[tests/storage/bulk-delete-perf-verify.test.ts](tests/storage/bulk-delete-perf-verify.test.ts) 的 "atom DELETE 同步 verify" it 字面跑过:

```
atom-path (id INSIDE $rids):  declineRatio 17.0× (773→45ms 单调递减),27 批累计 10912ms
```

跟 V5 实测 (atom 16.2s,首批 790ms 末批 ~30ms 量级) 字面一致.全表扫签名复现.

### 1.4 schema 字面证据

[src/storage/surreal/schema.ts:34-37](src/storage/surreal/schema.ts#L34) atom 索引:

```sql
DEFINE INDEX IF NOT EXISTS atom_domain     ON atom FIELDS payload.domain;
DEFINE INDEX IF NOT EXISTS atom_createdBy  ON atom FIELDS createdBy;
DEFINE INDEX IF NOT EXISTS atom_createdAt  ON atom FIELDS createdAt;
DEFINE INDEX IF NOT EXISTS atom_updatedAt  ON atom FIELDS updatedAt;
```

**注意**:atom 表没有 `DEFINE INDEX ... ON FIELDS id` — `id` 是 SurrealDB record 主键(隐式索引).问题不是没索引,是 `INSIDE 大数组` 让 planner 退化.

---

## 2. 修法范围

### 2.1 Phase A: binary verify 3 候选

**必须先做,不能跳** — atom 路径用了新 SQL 形式,SurrealDB 2.0.3 SDK + 3.0.4 server 字面支持性未 verify([[feedback_surrealdb_4x_no_type_thing]] 教训).

复用 `tests/storage/bulk-delete-perf-verify.test.ts`(本期不创新文件,append 新 it).

#### 候选 atom-A: `DELETE $rids` RecordId array 字面 record-link 删

```ts
// 字面 SQL(待 verify):
await db.query(`DELETE $rids`, { rids: [rid1, rid2, ...] });
// 或:
await db.query(`DELETE $rid`, { rid: rid1 });  // 单条对照
```

SurrealDB 字面支持"`DELETE $rid`(主键 record 直接删)"的形式,**是否支持 array 形式 `DELETE $rids` 未 verify**.

#### 候选 atom-B: 逐 RecordId 点查循环

```ts
for (const rid of rids) {
  await tx.query(`DELETE $rid RETURN BEFORE`, { rid });
}
```

确定走主键点删,但 N=1000 × 1 RPC = 1000 SQL.类似 edge 路径候选 B,**预期次于 A** 但走索引平稳.

#### 候选 atom-C: 改 batch size 1000 → 100

把 `DELETE_BATCH_SIZE` 1000 → 100,看 INSIDE 阈值是否在 SurrealDB 内部.原 SQL `id INSIDE $rids` 不变.

10 倍多事务但每事务小,看是否绕过退化扫描.**改 caller 不改 storage**,风险面相反.

### 2.2 verify test 字面 append

`tests/storage/bulk-delete-perf-verify.test.ts` 已有 `describe.skipIf(!BINARY)` block 5 个 it,append 3 个新 it:

```ts
it('atom 候选 A: DELETE $rids RecordId array — 27 批', async () => {
  // 1. seed 27000 atom + 67499 edge (用 multi-row INSERT)
  // 2. 先清边(用候选 A 快路径,仅为隔离 atom 段计时)
  // 3. 27 批跑 DELETE $rids 形式,记每批 atom_ms
  // 4. expect remain=0 + declineRatio < 2(平稳走索引)
});

it('atom 候选 B: 逐 RecordId DELETE $rid 循环 — 27 批', async () => {
  // 同上,但内层 for ids → DELETE $rid 单条
});

it('atom 候选 C: 改 batch size 100 — 270 批模拟', async () => {
  // 同上,但 BATCH_SIZE=100,跑 270 批 DELETE atom WHERE id INSIDE $rids100
});
```

**关键 verify**:`DELETE $rids` array 形式字面是否被 SurrealDB 2.0.3 SDK 接受 — **第一 it 跑出来若报 ValidationError,字面 abort 候选 A**,转 B/C.

### 2.3 Phase A 判据

| 项 | 通过门槛 |
|---|---|
| 候选 A 语法接受 | SDK 不报 ValidationError + SELECT 回 remain=0 |
| 候选 A 加速比 | edge_ms 27 批累计 < baseline 10912ms × 0.3 (即 < ~3300ms) |
| 候选 A declineRatio | < 2(平稳走主键索引,不再 17× 单调递减) |
| 候选 B 对比 | 走索引但预期慢于 A,记录但不采纳 |
| 候选 C 对比 | 仅当 A/B 都不达标时考虑 |

通过 → 主对话拍板进 Phase B 字面实施候选 A.

**Phase A 完成后 STOP 汇报**,跟 bulk-delete edge PR 同款两步分批.

### 2.4 Phase B 实施(只在 Phase A 通过 + 拍板后)

改 [src/storage/surreal/transaction-helpers.ts:218-221](src/storage/surreal/transaction-helpers.ts#L218):

```ts
// 修法(2026-05-30 fix/bulk-delete-atom-perf,候选 X):
// 原 `DELETE atom WHERE id INSIDE $rids` 同款 INSIDE 大数组退化扫描
// (Phase A verify declineRatio 17×,V5 实测 16.2s 主体). 改 ___(候选拍板后填).
// edge 路径同款套路(commit aa9ff2e5,拆 OR 走索引).
const tAtom = performance.now();
// (候选 A 字面)
const atomRes = await tx.query<[Array<unknown>]>(
  `DELETE $rids`,  // 待 verify 确认语法
  { rids },
);
const atomMs = Math.round(performance.now() - tAtom);
const deletedAtoms = atomRes[0]?.length ?? 0;
```

**RETURN BEFORE 决策**:若候选 A 字面是 `DELETE $rids` 无 WHERE 子句形式,RETURN BEFORE 行为未 verify — 默认尝试**保留**(deletedAtoms = res[0].length).若 verify 显示返回不是 array,降级 `deletedAtoms = rids.length`(假设全删成功,caller 仅读 length).

### 2.5 Phase C V5 实测(用户跑)

清空库 → 导入 92 篇 → 删父 folder → 看 [delete/perf] log,期望:

- atom 段每批 < 50ms(原 ~30ms 末批 + 走主键索引应稳定)
- atom 段 27 批累计 < 1.5s(原 11.8s,-87%)
- 总耗时 18s → ~5s(达成 prompt §六 的"<5s 目标")
- edge_subject/edge_object 段零退化(平稳 ~150ms / 个位 ms)
- 全删干净 remaining=0

### 2.6 不做的事

- ❌ **不要**碰 collectFolderSubtree / collectResourcesInFolders(子段 ~1.7s 占比小)
- ❌ **不要**碰 edge 路径(已修,本期不动)
- ❌ **不要**改 schema(atom 主键索引隐式,不加 explicit index)
- ❌ **不要**改 DELETE_BATCH_SIZE 1000 默认值(除非候选 C 被拍板,且仅本 storage 路径,不动 SP-2/4 蓝图)
- ❌ **不要**用 retry / fallback 包(违 [[feedback_no_fallback_bandaid_fixes]])
- ❌ **不要**改 bulkDeleteAtomsAndEdgesViaTx 函数签名(caller 字面只此 1 处)

---

## 3. 实施步骤

### 3.1 Phase 0: 切分支 + 环境 verify

1. `cd /V2 && git checkout -b fix/bulk-delete-atom-perf main`(用户预切,sandbox 拦你就报)
2. `grep '"surrealdb"' package.json` 字面 verify(应仍 `^2.0.3`)
3. 读 [项目 memory project_bulk_delete_edge_perf_done.md](memory/project_bulk_delete_edge_perf_done.md) — 前序 PR 上下文 + 双开 sidecar 撞库教训

### 3.2 Phase A: binary verify

1. append 3 个 it 到 `tests/storage/bulk-delete-perf-verify.test.ts`(§2.2)
2. **关键**:跑 verify 前确认无其它 verify suite 在跑(双开 sidecar 撞 PORT 8601 / atom:blk_0 冲突教训)
3. 跑 `npm run test -- bulk-delete-perf-verify --disableConsoleIntercept`(sandbox 拦了报)
4. **报告 verify 结果给主对话**,等指挥拍板候选

**Phase A 完成 STOP 汇报**.

### 3.3 Phase B 实施(拍板后)

1. 改 `bulkDeleteAtomsAndEdgesViaTx` atom 段(按拍板的候选)
2. typecheck + V2 现有 tests + scenario-9-rollback + scenario-11-roundtrip 全 PASS
3. commit:
   ```
   fix(storage): bulkDelete atom DELETE 改 ___ 走主键索引 — 全表扫修法
   
   diagnose 13a744ad §1.4 字面预警 atom 路径同款全表扫.
   Phase A verify (commit ___):候选 X declineRatio 17×→Y× / 累计 Xms→Yms.
   
   修法字面 N 行,跟 edge 路径 (aa9ff2e5) 同款套路.
   
   V5 实测 (25f00548 后):
     atom 段:  11.8s → Xms (-Y%)
     总耗时:   17996ms → Zms (-W%)
     edge 段:  零退化 ✅
   
   今日 bulkDelete 系列 (diagnose 起算):
     baseline       58.6s
     + edge PR      22.4s (-62%)
     + collect PR   18.0s (-69%)
     + 本 PR        Xms (-Y%)        ← <5s 目标
   ```
4. Phase C 用户 V5 实测 + STOP 汇报

---

## 4. 文件清单

| 文件 | 改动 | Phase |
|---|---|---|
| `tests/storage/bulk-delete-perf-verify.test.ts` | append 3 个 atom 候选 it | A |
| `src/storage/surreal/transaction-helpers.ts:218-221` | bulkDeleteAtomsAndEdgesViaTx atom 段修法 | B |

**仅 2 文件改动**.无 schema/API/caller 变更.

---

## 5. 风险 + 已知坑

### 5.1 `DELETE $rids` array 形式语法可能不被 SDK 支持

SurrealDB SDK 2.0.3 字面文档**未明确**支持 `DELETE $rids` 接受 RecordId array.可能形式:

- `DELETE $rids`(全 array,空 WHERE)
- `DELETE FROM atom WHERE id INSIDE $rids`(原写法,已知退化)
- `DELETE $rid`(单条主键删,字面支持)

**verify 前不假设**.[[feedback_surrealdb_4x_no_type_thing]] 教训 = 新 SQL 必 binary verify,不能照假设落代码.若 A 不支持转 B / C.

### 5.2 RETURN BEFORE 在 `DELETE $rids` 行为未 verify

原 SQL `DELETE atom WHERE id INSIDE $rids RETURN BEFORE` 字面返被删行 array,length 是计数.

`DELETE $rids` 是否返同款 array?**Phase A 必 verify** — 若返单 record 或 unknown 格式,caller 字面 `res[0]?.length ?? 0` 会取错值.

降级方案:若 verify 显示格式变,改 `deletedAtoms = rids.length`(假设全删成功 — SurrealDB 单 record 删失败应抛错而非静默).

### 5.3 双开 sidecar 撞库教训(已 memory)

[[project_bulk_delete_edge_perf_done]] §六 字面登记:双开 verify suite → 撞 PORT 8601 + 撞 `atom:blk_0` ULID.单跑解决.

Phase A verify 跑之前**确认无其它 verify 进程在跑**:`ps aux | grep surreal | grep -v grep`.

### 5.4 atom 删除后边引用可能漏删

原 SQL 顺序:edge 先删 → atom 再删.若 atom 修法改变写法(eg `DELETE $rids` 是否字面级联?),**字面 verify** 边引用是否仍漏删.

应在 verify test 中加 assertion:删 atom 后 `SELECT id FROM edge WHERE subject.atomId INSIDE $ids OR ...` 应 = 0(本期 edge 修法已字面保证,但 Phase A test 应字面交叉验证).

### 5.5 scenario-9-rollback 自动覆盖

单事务整体回滚字面保留 — 修法不改 storage.transaction wrapper,只改内部 SQL.scenario-9-rollback PASS 自动背书.

### 5.6 候选 C(改 batch size)的 caller 影响

若 Phase A 仅候选 C 达标:改 `DELETE_BATCH_SIZE 1000 → 100` 会让 drainFolderDeletion 跑 270 批而非 27.每批小事务 commit 开销可能反向放大.

**verify test 必须真实模拟** 27 批 vs 270 批整体时间,不只算单批.

---

## 6. 汇报模板

### 6.1 Phase A 完成时(verify only)

```
Phase A binary verify 完成:

环境字面证据:
  package.json:  "surrealdb": "^2.0.3"
  node_modules:  surrealdb@X.Y.Z
  surreal:       3.0.4 macos aarch64

种数据规模(append 复用 27000 atom / 67499 edge sidecar)

候选 atom-A(DELETE $rids):
  语法接受: 是 / 否(ValidationError 详情)
  remain=0 删干净: 是 / 否
  declineRatio: X×
  27 批累计: Yms (vs baseline 10912ms,-Z%)
  是否达标: 通过 / 不通过

候选 atom-B(逐 $rid 点查):
  (同上)

候选 atom-C(batch size 100,270 批):
  (同上 270 批数据)

边引用交叉验证:
  删 atom 后 SELECT edge WHERE subject INSIDE ids → cnt=Z (期望 0)

判据:
  候选 X 本期采纳

等指挥拍板进 Phase B。
```

### 6.2 Phase B/C 完成时

```
PR Phase B/C 完成:

一、字面产出(N commit)
二、Phase B 修法字面 diff
三、验收 (typecheck / tests / scenario)
四、Phase C V5 实测
  atom 段:  11.8s → Xms (-Y%)
  总耗时:   17996ms → Zms (-W%)
  edge 段:  零退化(对照值)
  ✅ 达 <5s 目标 / ⚠ 未达说明
五、关键决策 + 教训
六、剩余债 + 下游
  - collect 子段 (subtree + resources,合计 ~1.7s 占比小,如需再细化)
  - 嫌疑 G 历史 followup 已完成,本期收尾
七、等待指挥拍板:合 main / push
```

---

## 7. Self-Contained Check

- ✅ V5 baseline 字面数据(§1.1)
- ✅ 真因代码字面 grep + Phase A verify 铁证(§1.2-1.3)
- ✅ schema 索引字面证据(§1.4)
- ✅ Phase A 3 候选 + verify 判据(§2.1-2.3)
- ✅ Phase B 修法代码骨架(§2.4)
- ✅ Phase C V5 实测期望(§2.5)
- ✅ 文件清单仅 2 文件(§4)
- ✅ 6 类风险 + 双开 sidecar 教训(§5)
- ✅ 汇报模板 2 阶段(§6)
- ✅ 不做的事(§2.6)

唯一外部依赖:
- 用户预切 `fix/bulk-delete-atom-perf` 分支
- 用户 V5 实测 + 贴 [delete/perf] log
- SurrealDB `DELETE $rids` array 字面语法支持性(Phase A 现场 verify)

---

*Prompt 文档 · 2026-05-30 · fix/bulk-delete-atom-perf · 18s → <5s 收尾*
