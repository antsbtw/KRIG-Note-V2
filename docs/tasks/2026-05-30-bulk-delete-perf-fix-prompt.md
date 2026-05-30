# Fix: bulkDeleteAtomsAndEdges 全表扫描 — 58s → 目标 < 5s

> 诊断报告(diagnose/bulk-delete-perf 分支 13a744ad)字面锁定 dominant 真因:
> `bulkDeleteAtomsAndEdges` 的 edge DELETE SQL 因 `INSIDE 大数组` + 跨字段 `OR` 击穿索引,27 批每批全表扫描整个 edge 表,累计 35.9s(占 61.3%).
> 本 prompt = 修法 + binary verify + V5 实测,目标 58.6s → < 5s.

---

## 0. 角色 / 工作纪律

你是修法 subagent. **strict mode**:

1. 只动本 prompt §3 / §4 列的文件,**不擅自重构**周边代码
2. **每条 Bash 必 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`**(V2 cwd 漂移 16+ 次史)
3. **memory 必读**:
   - `feedback_surrealdb_4x_no_type_thing` — 新 SQL 函数必 grep 仓库 + 看官方 doc verify
   - `feedback_surrealdb_inside_not_in` — IN vs INSIDE 语义不同
   - `feedback_sdk_version_binding_policy` — 拍板 API 前必 grep package.json
   - `feedback_surrealdb_pipeline_rocksdb_limited` — 单 tx 内 Promise.all 仅 1.9x
   - `feedback_diag_log_before_speculation` — 不靠看代码猜,binary verify 拍板
   - `feedback_no_fallback_bandaid_fixes` — 修真因不兜底
   - `feedback_strict_compliance_workflow` — strict 4 条
   - `feedback_perf_remeasure_must_clean_baseline` — V5 复测必空库
   - `create-notes-batch-perf-stage-1-done` — 档 1 类似优化套路
4. sandbox 拦截 `npm start` → 报告,用户跑 V5 实测
5. 发现非范围 bug → **登记到汇报里**,不擅自修
6. **本期不动 嫌疑 G**(collectNoteBlocks 92 串行 listEdges,~18.4% 内未单独计时)— 留 followup,见 §2.5

---

## 1. 背景 + 真因(diagnose 报告字面证据)

### 1.1 决定性指纹(diagnose 报告 §三)

```
27 批拆解:
  批 1:  edge_ms=2522  edge_cnt=2393   ← 表里有 ~63000 边
  批 14: edge_ms=1356  edge_cnt=2396
  批 27: edge_ms=88    edge_cnt=2403   ← 表里只剩 ~2400 边
  
edge_ms 从 2522ms 单调递减到 88ms (28×),
但 edge_cnt 恒定 ~2400(每批实删边数不变)。
```

**全表扫描的铁证**:每批耗时只随"表里剩余总边数"线性下降,跟"实删边数"无关 — 唯有"扫整张表"能解释这个签名.

### 1.2 schema 字面证据

[src/storage/surreal/schema.ts:66 + 72](src/storage/surreal/schema.ts#L66):

```sql
DEFINE INDEX IF NOT EXISTS edge_subject ON edge FIELDS subject.atomId;
-- 67-71 行注释:SurrealDB 3.0.4 不支持 partial WHERE,index 全量
DEFINE INDEX IF NOT EXISTS edge_object  ON edge FIELDS object.atomId;
```

**索引字面存在**.问题不是没索引,是 planner 退化扫描.

### 1.3 罪魁 SQL

[src/storage/surreal/transaction-helpers.ts:175-180](src/storage/surreal/transaction-helpers.ts#L175):

```sql
DELETE edge
  WHERE subject.atomId INSIDE $ids
     OR (object.kind = 'atom' AND object.atomId INSIDE $ids)
  RETURN BEFORE
```

3 个嫌疑因子叠加:

1. **`INSIDE $ids`(1000 元素数组)的索引利用差** — 经典 SurrealDB 已知,planner 对大数组 INSIDE 常退化
2. **跨两字段 OR(subject.atomId / object.atomId)击穿索引** — 经典 "OR-defeats-index",planner 无单一索引覆盖整谓词
3. **`RETURN BEFORE`** 额外物化所有被删行 — 非主导(atom DELETE 同有 BEFORE 仅 atom_ms 1/3 of edge_ms)

诊断报告主导嫌疑 = **(1)+(2) 击穿索引导致全表扫**.

### 1.4 同样问题在 atom DELETE 也有(占 20.3%)

```sql
DELETE atom WHERE id INSIDE $rids RETURN BEFORE
```

atom_ms 从 834 → 35 单调递减,atom_cnt 恒 1000 — atom 表同款全表扫描签名,虽然没 OR 但仍可能 INSIDE 大数组退化.atom 表索引 `DEFINE INDEX atom_domain / atom_createdBy / atom_createdAt` 都不覆盖 `id`,但 `id` 是主键应该走 record-link 点查.

### 1.5 caller 复用受益

修一个 `bulkDeleteAtomsAndEdgesViaTx` 字面同时优化:

- `deleteNote` → `drainNoteAndFinalize` → 92 次串行,每次 1-N 批 bulkDelete
- `deleteFolder` → 91 次 collectNoteBlocks + 1 批 bulkDelete(本次场景 27 批)

---

## 2. 修法范围

### 2.1 主修方向 3 候选(必 binary verify 后再选)

诊断报告 §七 字面写"修法阶段必 binary verify edge_ms 不再随剩余表大小递减".

#### 候选 A:拆 OR 为两条单字段 DELETE

```sql
-- DELETE 1: subject 侧
DELETE edge WHERE subject.atomId INSIDE $ids RETURN BEFORE;
-- DELETE 2: object 侧(注:object.kind='atom' 仍要,因 object 是 union)
DELETE edge WHERE object.kind = 'atom' AND object.atomId INSIDE $ids RETURN BEFORE;
```

理论:每条 DELETE 单字段谓词,planner 能选 `edge_subject` / `edge_object` 索引.两条 DELETE 累计 2 RPC.

#### 候选 B:INSIDE 改逐 id 点查循环

```sql
-- 对 ids[] 每个 id 跑 2 条 DELETE(共 2N 条):
DELETE edge WHERE subject.atomId = $id RETURN BEFORE;
DELETE edge WHERE object.kind = 'atom' AND object.atomId = $id RETURN BEFORE;
```

理论:`= $id` 是 SurrealDB 经典点查,100% 索引命中.但 N=1000 → 2000 条 SQL,跨事务 RPC 风暴.**预期次于 A**.

#### 候选 C:候选 A + 去 RETURN BEFORE

```sql
-- 不要 BEFORE 物化(deletedEdges 计数功能上无 caller 依赖):
DELETE edge WHERE subject.atomId INSIDE $ids;
DELETE edge WHERE object.kind = 'atom' AND object.atomId INSIDE $ids;
```

caller 字面 grep([transaction-helpers.ts:182 + 188](src/storage/surreal/transaction-helpers.ts#L182)):返回的 `deletedEdges` / `deletedAtoms` 只是 `.length` 计数,从未读 BEFORE 行内容.**安全去掉 BEFORE**.

但**先 verify 必要性** — 若候选 A 已达标(< 100ms / 批),不必加额外改动.

### 2.2 Phase A: binary verify 三候选

写 verify test(跑完保留作 SDK regression):

```ts
// tests/storage/bulk-delete-perf-verify.test.ts
import { spawn, type ChildProcess } from 'node:child_process';
// (镜像 surreal-multirow-verify.test.ts 自起 rocksdb sidecar + describe.skipIf)

describe.skipIf(!BINARY)('bulkDelete edge DELETE perf candidates', () => {
  // setup:种 ~60000 edge + ~26000 atom(模拟 92 篇 markdown 量级)
  beforeAll(async () => {
    // 用 INSERT $rows multi-row 一次种好(档 3 batch helper 同款)
    // edges 三类:belongsToNote ~26000 / childOf ~10000 / nextSibling ~20000
  });

  it('candidate A:拆 OR 为两条 INSIDE — 27 批模拟', async () => {
    // 取 1000 atom id / 批,跑 27 批,记每批 edge_ms
    // 期望:edge_ms 不再随剩余表大小递减(应稳定 < 200ms / 批)
  });

  it('candidate B:逐 id 点查 = $id 循环 — 27 批模拟', async () => {
    // 同上,跑 = $id 循环
  });

  it('candidate C:候选 A + 去 RETURN BEFORE', async () => {
    // 候选 A 基础上去 BEFORE,看是否额外加速
  });

  it('对照:原 OR + INSIDE — 验证 baseline 全表扫描签名', async () => {
    // 跑原 SQL,确认 edge_ms 随表剩余规模递减(diagnose 报告复现)
  });
});
```

**判据**:

- **候选 A** edge_ms 每批稳定 < 200ms(理论应 < 50ms,索引点 list 27000 / 1000 = 27 ms 量级)+ 不随表大小递减 → 通过,本期采纳候选 A
- 候选 A 不达标(eg 仍 > 500ms/批 或 仍递减)→ 试候选 B,**问指挥**(可能 SurrealDB 3.0.4 别的瓶颈)
- 候选 C 在 A 基础上加速 ≥ 1.5x → 加入本期实施
- 候选 C 加速 < 1.5x → 不动 RETURN BEFORE(保留兼容,deletedEdges 字段还能用)

### 2.3 Phase B: 实施(只在 Phase A 通过后)

按候选 A(或 A+C)实施:

```ts
// src/storage/surreal/transaction-helpers.ts:170-190
export async function bulkDeleteAtomsAndEdgesViaTx(
  tx: SurrealTransaction,
  ids: string[],
): Promise<{ deletedAtoms: number; deletedEdges: number }> {
  if (ids.length === 0) return { deletedAtoms: 0, deletedEdges: 0 };

  // 修法(2026-05-30 fix/bulk-delete-edge-perf):
  // 拆 OR 为两条单字段 DELETE,让 planner 命中 edge_subject / edge_object 索引.
  // 原 OR + INSIDE 大数组击穿索引致每批全表扫(diagnose 报告 13a744ad §三/四).
  // Phase A binary verify PASS:edge_ms 不再随剩余表大小递减.

  // 边删:subject 侧
  const edgeSubjectRes = await tx.query<[Array<unknown>]>(
    `DELETE edge WHERE subject.atomId INSIDE $ids RETURN BEFORE`,
    { ids },
  );
  // 边删:object 侧(object 是 union,仅 atom kind 才有 atomId 字段)
  const edgeObjectRes = await tx.query<[Array<unknown>]>(
    `DELETE edge WHERE object.kind = 'atom' AND object.atomId INSIDE $ids RETURN BEFORE`,
    { ids },
  );
  const deletedEdges =
    (edgeSubjectRes[0]?.length ?? 0) + (edgeObjectRes[0]?.length ?? 0);

  // atom 删(原 INSIDE id 不变 — id 是主键 record-link,Phase A 验证是否同样全表扫)
  const rids = ids.map((id) => atomRid(id));
  const atomRes = await tx.query<[Array<unknown>]>(
    `DELETE atom WHERE id INSIDE $rids RETURN BEFORE`,
    { rids },
  );
  const deletedAtoms = atomRes[0]?.length ?? 0;

  return { deletedAtoms, deletedEdges };
}
```

**若 Phase A 显示 atom DELETE 也是全表扫**(`DELETE atom WHERE id INSIDE $rids` atom_ms 单调递减),atom 路径同款修法(拆 INSIDE 或改 record-link 批量删):

```sql
-- atom 候选(待 verify):用 RecordId array 形式 DELETE
DELETE $rids;  -- $rids 是 RecordId[] 字面 array,SurrealDB 应该直接 record-link 点删
```

**本期 verify 后决定 atom 路径修法**.若 atom 路径单 RT 已 < 100ms 不动.

### 2.4 Phase C: V5 实测

清空库 + 重新导入 92 篇 markdown + 删 folder(同 diagnose 场景),期望:

- 总耗时 58.6s → < 5s(目标 -91%)
- edge_ms 单批 < 200ms 且不随剩余表大小递减
- 0 OCC conflict / 0 cancel failed / 0 typecheck error

### 2.5 不做的事

- ❌ **不要**碰嫌疑 G(`collectNoteBlocks` 92 串行 listEdges,18.4% 内未单独计时)— 留 followup PR
- ❌ **不要**碰 deleteNote 路径 view 层串行 92 次 deleteNote(诊断报告显示本次场景**未触发**,且修 bulkDelete 同等受益)
- ❌ **不要**碰 intent log / sweeper / deletionPending(SP-1 数据可靠性地基)
- ❌ **不要**改 schema(edge_subject / edge_object 索引字面已在,本期是 SQL 写法问题)
- ❌ **不要**动 `tx.bulkDeleteAtomsAndEdges` API 签名(caller 已固定,api.ts:76 + StorageTransaction)
- ❌ **不要**用 retry / fallback 包(违 [[feedback_no_fallback_bandaid_fixes]])

---

## 3. 实施步骤

### 3.1 Phase 0: 切分支 + 环境 verify

1. `cd /V2 && git checkout -b fix/bulk-delete-edge-perf main`(用户预先切,sandbox 拦你就报)
2. grep package.json verify `"surrealdb": "^2.0.3"` (档 3 同款 [[feedback_sdk_version_binding_policy]])
3. 读 [diagnose 报告 docs/tasks/2026-05-30-bulk-delete-perf-diagnose-report.md](docs/tasks/2026-05-30-bulk-delete-perf-diagnose-report.md)(diagnose/bulk-delete-perf 分支,**不在 main**,用 `git show diagnose/bulk-delete-perf:docs/tasks/2026-05-30-bulk-delete-perf-diagnose-report.md` 提取读)
4. 读 schema.ts:65-75 字面索引定义

### 3.2 Phase A: binary verify 三候选

1. 写 `tests/storage/bulk-delete-perf-verify.test.ts`(镜像 surreal-multirow-verify.test.ts 自起 rocksdb sidecar)
2. **种数据真实量级**(60000 edge / 26000 atom,贴近 92 篇 markdown 真实场景)
3. 跑 4 个 it:候选 A / B / C / 对照 baseline
4. 跑 `npm run test -- bulk-delete-perf-verify`(sandbox 拦了报)
5. **报告 verify 结果给主对话**,等指挥决定本期采纳哪个候选

**Phase A 完成后停手汇报**,等主对话拍板进 Phase B.

### 3.3 Phase B: 实施(只在 Phase A 通过后)

1. 改 `bulkDeleteAtomsAndEdgesViaTx`(按拍板的候选)
2. typecheck + V2 现有 tests PASS(verify test 也跑)
3. **关键 verify**:scenario-9-rollback / scenario-11-roundtrip 仍 PASS(单事务原子性零退化)
4. commit:
   ```
   fix(storage): bulkDelete edge DELETE 拆 OR 走索引 — 全表扫修法
   
   diagnose 报告 13a744ad 字面锁定:原 SQL `DELETE edge WHERE subject INSIDE
   OR object INSIDE` 因 OR + 大数组 INSIDE 击穿 edge_subject/edge_object 索引,
   27 批每批全表扫整张 edge 表,累计 35.9s(占 58.6s 总耗时 61.3%).
   
   修法:拆 OR 为两条单字段 DELETE,planner 命中索引点 list.
   
   Phase A binary verify(N=60000 edge / 27 批模拟):
   - 修前(对照): edge_ms 从 Xms 单调递减到 Yms(全表扫签名复现)
   - 修后(候选 A): edge_ms 稳定 ~Zms / 批(不递减,走索引)
   
   实测 V5(同 92 篇 markdown / 26000 atom / 63000 edge 场景):
   58.6s → Xms (-Y%).
   
   单事务原子性零退化(scenario-9-rollback PASS).
   ```

### 3.4 Phase C: V5 实测(用户)

`npm start` 拦你 → 报告主对话.主对话转用户操作清单:

```
1. 清空库 (同 diagnose 报告的清库脚本)
2. npm start
3. 不打开任何 note
4. 导入同 92 篇 markdown(等 6.7s 完成)
5. NavSide 选父 folder + 删除(同 diagnose 场景)
6. 等删除完成 → 把终端 stdout 贴主对话
```

期望:删除总耗时 < 5s.

---

## 4. 文件清单

| 文件 | 改动 | Phase |
|---|---|---|
| `tests/storage/bulk-delete-perf-verify.test.ts` | **新建** binary verify(永久保留作 SDK regression) | A |
| `src/storage/surreal/transaction-helpers.ts:170-190` | bulkDeleteAtomsAndEdgesViaTx 修法 | B |

**仅 2 文件改动**.无 schema 变更 / 无 API 变更 / 无 caller 变更.

---

## 5. 风险 + 已知坑

### 5.1 Phase A 候选 A 不达标的兜底

若候选 A binary verify edge_ms 仍递减或 > 500ms/批:

- 可能 SurrealDB 3.0.4 对 INSIDE 大数组(1000 元素)即使单字段也退化扫
- 试候选 B(逐 id 点查),但 N=1000 → 2 RPC × 1000 = 2000 SQL 跨事务,**比 A 慢但比原 OR 快**
- 试改 batch size(DELETE_BATCH_SIZE 1000 → 200,index lookup 数组阈值可能在 SurrealDB 内部)
- 全失败 → 报告 + 让指挥决定是否升级 SurrealDB 或换 record-link graph 删

### 5.2 atom DELETE 是否同样全表扫

诊断报告 atom_ms 也从 834 → 35 递减,同款签名.但 `id INSIDE $rids` 是主键索引应走点查 — verify 后看实际数据.若 atom 也全表扫:

- 试 `DELETE $rids`(SurrealDB record-link array DELETE 形式)
- 试逐 RecordId 点删循环

本期 verify 后决定.

### 5.3 RETURN BEFORE 必要性

caller 字面 grep:

```ts
// transaction-helpers.ts:182 + 188
const deletedEdges = edgeRes[0]?.length ?? 0;
const deletedAtoms = atomRes[0]?.length ?? 0;
```

仅读 `.length`,从未读 BEFORE 行内容.**字面安全去掉**.

但 Phase A 单独 verify 候选 C 加速 ≥ 1.5x 才落代码(否则保留 BEFORE 作 forward-compat).

### 5.4 单事务整体回滚保留

诊断报告 §六.3 字面预警 "若 SQL 改成两条 DELETE,失败时事务 rollback 仍保留" — 两条 DELETE 都在同 `tx.query` 同事务内,任一失败 → 整事务 rollback.scenario-9-rollback 自动覆盖测试.

### 5.5 INSIDE 数组大小阈值

SurrealDB 3.0.4 文档未明确"INSIDE 多大数组退化扫描"阈值.diagnose 报告 1000 元素时退化.Phase A verify 应跑 N=100 / 1000 / 5000 看曲线(retest 多档),拿真实数据.

### 5.6 嫌疑 G 真实占比

诊断报告字面"嫌疑 G ≤18.4% 内未计时".本期修 bulkDelete 后 58.6s → 假设 < 5s,嫌疑 G 绝对值 10.8s 不变(if 主修不影响 listEdges)→ **修后嫌疑 G 占比可能 > 50%**.

修法完成 + V5 实测后,**若总耗时仍 > 5s**,嫌疑 G 升级为新的 dominant 真因,**留 followup PR**(本期不动,保持单点修法纪律).

### 5.7 diagnose 分支字面在哪

diagnose 报告 commit 13a744ad 在 `diagnose/bulk-delete-perf` 分支,**不在 main**.subagent 读报告必须用:

```bash
git show diagnose/bulk-delete-perf:docs/tasks/2026-05-30-bulk-delete-perf-diagnose-report.md
```

或:

```bash
git checkout diagnose/bulk-delete-perf -- docs/tasks/2026-05-30-bulk-delete-perf-diagnose-report.md
# 读完后:git checkout HEAD -- docs/tasks/2026-05-30-bulk-delete-perf-diagnose-report.md(还原 main 干净)
```

或更简单:直接看 commit `13a744ad` 的文件内容用 `git show`.

---

## 6. 汇报模板

### 6.1 Phase A 完成时(verify only)

```
Phase A binary verify 完成:

环境:
- package.json: "surrealdb": "^2.0.3" (✅ verify)
- node_modules: surrealdb@X.Y.Z
- surreal binary: 3.0.4 macos aarch64

种数据规模:60000 edge / 26000 atom

对照(原 OR + INSIDE):
- 批 1: edge_ms=Xms / 批 27: edge_ms=Yms / 趋势:单调递减 ✅ 复现 baseline 全表扫

候选 A(拆 OR):
- 批 1: edge_ms=Xms / 批 27: edge_ms=Yms / 趋势:稳定 vs 递减
- 27 批累计: Xms (vs baseline Yms,-Z%)
- 是否达标 < 200ms/批 + 不递减:是 / 否

候选 B(逐 id 点查):
- (类似数据)

候选 C(候选 A + 去 RETURN BEFORE):
- (类似数据)

判据:
- 候选 A 达标,本期采纳
- 候选 C 额外加速 X×(< 1.5x 不采纳 / ≥ 1.5x 合 A 实施)

atom DELETE 同步 verify:
- atom_ms 趋势:递减 / 稳定
- 是否需要 atom 路径修法:是 / 否

等指挥拍板进 Phase B。
```

### 6.2 Phase B/C 完成时

```
PR Phase B/C 完成:

一、字面产出(N commit)
- (列 hash + 描述)

二、Phase B 修法
- bulkDeleteAtomsAndEdgesViaTx:拆 OR / 去 BEFORE / atom 路径(若改)
- 字面 diff 行数:X 行

三、验收
- typecheck: PASS
- V2 现有 tests + scenario-9-rollback + scenario-11-roundtrip: 全 PASS
- bulk-delete-perf-verify 新 tests: PASS

四、Phase C V5 实测
- 同 92 篇 markdown / 删父 folder 场景
- 修前: 58.6s
- 修后: Xms (-Y%)
- 是否达 < 5s 目标:是 / 否
- 嫌疑 G(collectNoteBlocks)修后占比:Z%(若 > 50% 登记下游 followup PR)

五、关键决策 + 教训
- (列偏离 prompt / 决议的拍板)
- memory 建议

六、剩余债 + 下游
- 嫌疑 G 若仍是瓶颈 → followup PR
- atom DELETE 修法(若本期改了)
- 其它登记

七、等待指挥拍板
- 合 main / push
```

---

## 7. Self-Contained Check

修法 subagent 不必跑额外调研,本 prompt 已含:

- ✅ 真因决定性指纹(§1.1)
- ✅ schema 索引字面证据(§1.2)
- ✅ 罪魁 SQL + 3 因子分析(§1.3)
- ✅ atom 路径同款问题登记(§1.4)
- ✅ caller 双受益(§1.5)
- ✅ 3 候选 + verify 判据(§2.1-2.2)
- ✅ Phase B 修法代码骨架(§2.3)
- ✅ V5 实测期望(§2.4)
- ✅ 不做的事(§2.5)
- ✅ 文件清单 仅 2 文件(§4)
- ✅ 7 类风险(§5)
- ✅ 汇报模板 2 阶段(§6)
- ✅ diagnose 分支字面提取办法(§5.7)

唯一外部依赖:

- 用户预切 `fix/bulk-delete-edge-perf` 分支
- 用户 V5 实测 + 贴日志(Phase C)
- diagnose 报告字面提取(`git show diagnose/bulk-delete-perf:...`)

---

*Prompt 文档 · 2026-05-30 · fix/bulk-delete-edge-perf · 58s → < 5s 根治档*
