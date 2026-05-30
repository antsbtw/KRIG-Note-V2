# Perf 档 3: createNotesBatch multi-row INSERT — 17s → ~500ms 根治档

> 档 1 完成(35s → 17s,-49%,合 main ed5b6341).档 2 字面跳过(rocksdb pipeline 仅 1.9x).
> 档 3 = 单 SQL `INSERT INTO atom [{...}, {...}, ...]` 多 row 写入,~95000 串行 RPC 压成 ~10 batch query,理论 17s → ~500ms.

---

## 0. 角色 / 工作纪律

你是档 3 实施 subagent. **strict mode**:

1. 只动本 prompt §3 / §4 列的文件,**不擅自重构**周边代码
2. **每条 Bash 必 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`**(V2 cwd 漂移 16 次事故史)
3. **memory 必读** (按重要性):
   - `feedback_surrealdb_4x_no_type_thing` — 新 SQL 函数必 grep 仓库 + 看官方 doc verify
   - `feedback_sdk_version_binding_policy` — 拍板 API 前必 grep package.json + .d.ts 字面证据
   - `feedback_surrealdb_pipeline_rocksdb_limited` — 新近教训,SurrealDB perf 优化路径限制
   - `feedback_surrealdb_inside_not_in` — IN vs INSIDE
   - `feedback_filter_single_vs_batch_mutex` — filter 字段互斥纪律
   - `feedback_strict_compliance_workflow` — strict 4 条
   - `feedback_v2_is_workspace_v1_is_reference` — V2 工作 V1 只读参考
   - `feedback_no_fallback_bandaid_fixes` — 修真因不兜底
   - `feedback_perf_remeasure_must_clean_baseline` — perf 复测必空库
   - `create-notes-batch-perf-stage-1-done` — 档 1 完成上下文
4. sandbox 拦截 `git commit/push`/`npm start` 等 → 停手汇报,**禁** `--dangerouslyDisableSandbox`
5. 发现非本 prompt 范围的 bug → **登记到汇报里**,不擅自修

---

## 1. 背景

### 1.1 SDK / Server 版本字面证据(已 verify)

```
package.json: "surrealdb": "^2.0.3"
server: SurrealDB 3.0.4 (用户字面汇报)
```

档 1 prompt 字面误标 "SDK 4.x" — 本 prompt 字面修正,跟 [[feedback_sdk_version_binding_policy]] 教训对齐.

**实施前你必须再 grep 一次 package.json verify**(防止本 prompt 写作期到 subagent 实施期之间版本变).

### 1.2 档 1 / 档 2 现状

- 档 1 e243f30f 已合 main:35s → 17.1s (-49%),删 putEdgeViaTx 内 assertAtomExistsViaTx
- 档 2 字面跳过:Promise.all pipeline ratio 1.9x < prompt 阈值 3x

档 1 后 17.1s 拆解(用户字面汇报):

| 阶段 | 耗时 | 串行 RPC 数 |
|---|---|---|
| putAtom × ~26000 | 4826ms | ~26000 |
| belongsToNote putEdge × ~26000 | 4894ms | ~26000 |
| childOf putEdge × ~22000 | 2673ms | ~22000 |
| nextSibling putEdge × ~25000 | 3998ms | ~25000 |
| **总计** | ~16.4s | **~99000 RPC** |

平均 ~166μs/RPC localhost.

### 1.3 档 3 修法思路

把"N 次单 row 写入"压成"1 次多 row 写入" — 单 SQL `INSERT` 字面接受 `[{...}, {...}, ...]` array.SurrealDB 1.x 字面支持,3.x 实测前**必须 verify**.

理论估算(假设 multi-row INSERT 支持):

| 阶段 | 修后 RPC | 估时 |
|---|---|---|
| putAtom × 26000 → 1 INSERT array | 1 | ~50ms |
| belongsToNote × 26000 → 1 INSERT array | 1 | ~50ms |
| childOf × 22000 → 1 INSERT array | 1 | ~50ms |
| nextSibling × 25000 → 1 INSERT array | 1 | ~50ms |
| container × 92 → 1 INSERT array | 1 | ~10ms |
| hasNoteView × 92 → 1 INSERT array | 1 | ~10ms |
| inFolder × ~80 → 1 INSERT array | 1 | ~10ms |
| **总计** | **~7 RPC + ULID 生成** | **~300-500ms** |

理论 17s → ~500ms,**-97%**.

---

## 2. 修法范围

### 2.1 Phase A: binary verify SurrealDB 3.0.4 + SDK 2.0.3 是否支持 INSERT multi-row

**必须先做,否则 0 价值**.

写 verify test (跑完删 / 或保留为永久测):

```ts
// tests/storage/surreal-multirow-verify.test.ts
import { connectStorage } from '@/storage';

describe('SurrealDB multi-row INSERT verify', () => {
  it('INSERT INTO atom [...] 接受 array', async () => {
    const storage = await connectStorage(/* rocksdb 真引擎,不是 mem:// */);
    const N = 1000;
    const rows = Array.from({length: N}, (_, i) => ({
      id: `atom:test_${i}_${Date.now()}`,
      payload: { domain: 'pm', payload: {} },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: 'verify-test',
    }));

    const t0 = performance.now();
    // 真 SDK 字面用法,看官方 doc
    await db.query('INSERT INTO atom $rows', { rows });
    const dur = performance.now() - t0;

    console.log(`[verify] multi-row N=${N} dur=${dur}ms`);
    expect(dur).toBeLessThan(500);  // 1000 row < 500ms

    // 真 verify: SELECT 出来对比
    const selected = await db.query(
      'SELECT id FROM atom WHERE createdBy = $u',
      { u: 'verify-test' },
    );
    expect(selected[0].length).toBe(N);
  });

  it('对比串行 N 次 CREATE 时间', async () => {
    const N = 1000;
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      await db.query(
        'CREATE $rid SET payload = $p',
        { rid: `atom:serial_${i}_${Date.now()}`, p: {} },
      );
    }
    const dur = performance.now() - t0;
    console.log(`[verify] serial N=${N} dur=${dur}ms`);
    // 期望 multi-row vs serial 至少 10x
  });
});
```

**判据**:

- multi-row 1000 row < 500ms 且 ≥ serial × 10 → **通过,Phase B 实施**
- multi-row 不支持(SDK 报语法错 / 返单 row 不是 array)→ **字面 abort 档 3**,汇报"语法不支持"
- multi-row 支持但加速 < 5x → 字面登记加速比,**问主对话**是否继续(可能 server-side 仍有锁瓶颈)

### 2.2 Phase B: batchPutAtomsViaTx / batchPutEdgesViaTx 实现

只在 Phase A 通过后实施.

#### (a) 加 batch helper

```ts
// src/storage/surreal/transaction-helpers.ts

/**
 * 批量 putAtom — 单 SQL INSERT 多 row.
 *
 * 性能: createNotesBatch 92 篇 / 26000 atom 场景, ~26000 串行 RPC → 1 RPC.
 * Phase A binary verify 通过 (≥10x serial).
 *
 * 关键差异:
 *  - 单 putAtomViaTx: storage 层生成 ULID
 *  - 本 API: 应用层预生成 ULID + 一次 SQL 写入 (caller 拿 id 后用)
 *
 * 校验: 同 putAtomViaTx 不校验 id 是否冲突 (UPSERT 语义留单 row 版本承载).
 *       本 API 仅 CREATE 语义.
 */
export async function batchPutAtomsViaTx<D extends AtomDomain = AtomDomain>(
  tx: SurrealTransaction,
  inputs: PutAtomInput<D>[],
  options?: StorageOptions,
): Promise<AtomEntity<D>[]> {
  if (inputs.length === 0) return [];
  // 应用层预生成 ULID
  const ownerId = options?.ownerId ?? DEFAULT_OWNER;
  const now = nowMs();
  const entities: AtomEntity<D>[] = inputs.map((input) => {
    const id = input.id ?? generateUlid();
    return {
      id,
      createdAt: now,
      updatedAt: now,
      createdBy: ownerId,
      payload: input.payload,
    };
  });

  const rows = entities.map((e) => ({
    id: atomRid(e.id),
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    createdBy: e.createdBy,
    payload: e.payload,
  }));

  // Phase A verify 通过的字面 SQL
  await tx.query(`INSERT INTO atom $rows`, { rows });

  return entities;
}

export async function batchPutEdgesViaTx(
  tx: SurrealTransaction,
  inputs: PutEdgeInput[],
  options?: StorageOptions,
): Promise<EdgeEntity[]> {
  if (inputs.length === 0) return [];
  // 同 putEdgeViaTx 删除 assertAtomExists (档 1 拍板,caller 责任)
  const ownerId = options?.ownerId ?? DEFAULT_OWNER;
  const now = nowMs();
  const entities: EdgeEntity[] = inputs.map((input) => {
    const baseAttrs = { ...input.attrs };
    if (baseAttrs.createdBy === undefined || baseAttrs.createdBy === '') {
      baseAttrs.createdBy = ownerId;
    }
    if (baseAttrs.createdAt === undefined) baseAttrs.createdAt = now;
    return {
      id: generateUlid(),  // edge id 应用层生成
      predicate: input.predicate,
      subject: input.subject,
      object: input.object,
      attrs: baseAttrs as EdgeAttrs,
    };
  });

  const rows = entities.map((e) => ({
    id: edgeRid(e.id),
    predicate: e.predicate,
    subject: e.subject,
    object: e.object,
    attrs: e.attrs,
  }));

  await tx.query(`INSERT INTO edge $rows`, { rows });

  return entities;
}
```

#### (b) StorageTransaction 接口扩展

```ts
// src/storage/api.ts
export interface StorageTransaction {
  getAtom: ...;
  putAtom: ...;
  /** 批量 putAtom — 档 3 perf,单 SQL multi-row INSERT */
  batchPutAtoms<D>(inputs: PutAtomInput<D>[]): Promise<AtomEntity<D>[]>;
  deleteAtom: ...;
  getEdge: ...;
  putEdge: ...;
  /** 批量 putEdge — 档 3 perf,单 SQL multi-row INSERT */
  batchPutEdges(inputs: PutEdgeInput[]): Promise<EdgeEntity[]>;
  deleteEdge: ...;
}
```

#### (c) StorageMock 同步加 batchPutAtoms / batchPutEdges

`tests/mocks/storage-mock.ts` 加 mock 实现(应用层 for loop 调 putAtom / putEdge,语义对应即可).

#### (d) createSingleNoteFromDrafts 切到 batch API

```ts
// src/platform/main/note/capability-impl.ts:781-862
async function createSingleNoteFromDrafts(
  tx: StorageTransaction,
  item: CreateNoteBatchItem,
): Promise<NoteInfo> {
  // 1. container atom — 单 row 走原 putAtom (单条不值得 batch)
  const title = deriveTitleFromDrafts(item.atoms, item.titleHint);
  const containerAtom = await tx.putAtom<'pm'>({ ... });
  const now = Date.now();

  // 2. hasNoteView + inFolder 边 — 2 条单条仍走原 putEdge (或合到 §4 一起 batch)
  await tx.putEdge({ ... hasNoteView ... });
  if (item.folderId) await tx.putEdge({ ... inFolder ... });

  // 3. atoms 字面批量写入
  const atomEntities = await tx.batchPutAtoms<'pm'>(
    item.atoms.map(draft => ({ payload: draft.payload })),
  );
  const tmpToReal = new Map<string, string>();
  item.atoms.forEach((draft, i) => tmpToReal.set(draft.tmpId, atomEntities[i].id));

  // 4. 三类边收集到一个 array 一次 batchPutEdges
  const edges: PutEdgeInput[] = [];

  // 4a. belongsToNote
  for (const draft of item.atoms) {
    edges.push({
      predicate: BELONGS_TO_NOTE_PREDICATE,
      subject: { kind: 'atom', atomId: tmpToReal.get(draft.tmpId)! },
      object: { kind: 'atom', atomId: containerAtom.id },
      attrs: { createdBy: 'user-default', createdAt: now },
    });
  }

  // 4b. childOf
  for (const draft of item.atoms) {
    if (!draft.parentTmpId) continue;
    const parentRealId = tmpToReal.get(draft.parentTmpId);
    if (!parentRealId) {
      throw new Error(`dangling parentTmpId=${draft.parentTmpId}`);
    }
    edges.push({
      predicate: CHILD_OF_PREDICATE,
      subject: { kind: 'atom', atomId: tmpToReal.get(draft.tmpId)! },
      object: { kind: 'atom', atomId: parentRealId },
      attrs: { createdBy: 'user-default', createdAt: now },
    });
  }

  // 4c. nextSibling
  const siblingGroups = ...; // 同档 1 字面分组逻辑
  for (const realIds of siblingGroups.values()) {
    for (let i = 0; i + 1 < realIds.length; i++) {
      edges.push({
        predicate: NEXT_SIBLING_PREDICATE,
        subject: { kind: 'atom', atomId: realIds[i] },
        object: { kind: 'atom', atomId: realIds[i + 1] },
        attrs: { createdBy: 'user-default', createdAt: now },
      });
    }
  }

  // 单 SQL 批量写入所有三类边
  await tx.batchPutEdges(edges);

  return buildNoteInfo(containerAtom, item.atoms, tmpToReal, ...);
}
```

#### (e) createNotesBatch 跨 item 合并(可选优化)

进一步:`createNotesBatch` 字面 for item:N 调 `createSingleNoteFromDrafts`,每 item 仍 2 次 SQL(atoms + edges).可改为**跨 item 收集 atoms + edges 后单次 batchPutAtoms + batchPutEdges**.

92 篇 → 单事务 2 次 SQL 全搞定(理论 ~100ms).

**本期采纳**:**先做 (d),不做 (e)**.理由:
- (d) 已能拿绝大部分收益(每 item 内部 ~50 RPC → 2 RPC)
- (e) 重构面更大(改 createNotesBatch 主循环 + tmpToReal 跨 item 隔离需谨慎),收益边际递减
- 留 (e) 给档 3+ followup,可选

### 2.3 Phase C: V5 实测 + 清理

1. 用户 V5 实测同 92 篇数据集(空库 + 同初始态,[[feedback_perf_remeasure_must_clean_baseline]])
2. 期望:17.1s → < 2s (-88% 以上)
3. 若 < 5x 收益:登记原因(possibly server-side lock / 单 INSERT row 数过多撞 SurrealDB 内部分块),问主对话是否继续 (e)
4. 删 verify test (或保留 tests/storage/surreal-multirow-verify.test.ts 作 SDK regression test)

### 2.4 不做的事

- ❌ **不要**改 `createNotesBatch` 为多事务(破单事务整体回滚语义)
- ❌ **不要**碰 read path
- ❌ **不要**碰 `storage.transaction` 自身
- ❌ **不要**为 (e) 优化重构 createNotesBatch 主循环(本期范围外)
- ❌ **不要**在 Phase A verify 不通过时硬上 INSERT 语法 ([[feedback_surrealdb_4x_no_type_thing]])
- ❌ **不要**用 retry / fallback 包 batch INSERT ([[feedback_no_fallback_bandaid_fixes]])

---

## 3. 实施步骤

### 3.1 Phase 0: 切分支 + 环境 verify

1. `cd /V2 && git checkout -b perf/create-notes-batch-multirow main`(用户预先切,sandbox 拦你就报)
2. `grep -E '"surrealdb"' package.json` 字面 verify 版本 (期望 `^2.0.3`)
3. 看 SDK 官方 doc 字面 `INSERT INTO ... $rows` 语法 (URL 用户给或 WebSearch:`SurrealDB INSERT multi-row syntax v2 SDK`)

### 3.2 Phase A: binary verify (§2.1)

1. 写 `tests/storage/surreal-multirow-verify.test.ts`
2. **必须用真 rocksdb 引擎**,不能 mem://([[feedback_surrealdb_pipeline_rocksdb_limited]] 教训)
3. 跑 `npm run test -- surreal-multirow-verify`(sandbox 拦了报)
4. 根据结果:
   - **通过 → 继续 Phase B**
   - **不通过 → abort,汇报"INSERT multi-row 语法不支持/收益不足"**

### 3.3 Phase B: 实施 (§2.2 a-d)

1. 加 `batchPutAtomsViaTx` + `batchPutEdgesViaTx`
2. 加 StorageTransaction 接口 + mock
3. 改 `createSingleNoteFromDrafts` 切到 batch API
4. typecheck + V2 现有 tests PASS(可能需更新 mock 测)
5. commit:
   ```
   perf(storage): batchPutAtoms / batchPutEdges multi-row INSERT
   
   Phase A binary verify SurrealDB 3.0.4 + SDK 2.0.3 multi-row INSERT
   字面支持 ≥Nx serial. createSingleNoteFromDrafts 4 个 await 循环
   改批量 API: atoms × N 1 RPC + edges × N 1 RPC.
   
   单事务原子性保留. 应用层预生成 ULID + tmpToReal 映射逻辑不变.
   
   实测 17.1s → Xs (-Y%).
   ```

### 3.4 Phase C: V5 实测 + 清理 (§2.3)

1. 用户 V5 实测 (清空库脚本见 [[feedback_perf_remeasure_must_clean_baseline]])
2. 决定 verify test 删除 or 保留
3. 按 §6 汇报模板汇报主对话

---

## 4. 文件清单

| 文件 | 改动 | Phase |
|---|---|---|
| `tests/storage/surreal-multirow-verify.test.ts` | **新建** verify test | A |
| `src/storage/surreal/transaction-helpers.ts` | 加 batchPutAtomsViaTx + batchPutEdgesViaTx | B |
| `src/storage/api.ts` | StorageTransaction 接口加 batchPutAtoms / batchPutEdges | B |
| `src/storage/surreal/storage.ts` | transaction wrapper 暴露 batch helper | B |
| `tests/mocks/storage-mock.ts` | mock 加 batch 实现 | B |
| `src/platform/main/note/capability-impl.ts:781-862` | createSingleNoteFromDrafts 切 batch API | B |

---

## 5. 风险 + 已知坑

### 5.1 Phase A 失败可能性

SurrealDB SDK 2.0.3 字面是否支持 `INSERT INTO atom $rows` array 形式未 verify.可能的失败模式:

- 语法不支持(返 ValidationError)→ abort 档 3
- 语法支持但单 row 处理(逐 row 串行)→ 收益不足 5x,登记 + 问指挥
- 语法支持且 batch 处理但单次 row 数有上限(SurrealDB 内部 buffer 限制)→ 分段 batch (eg 每 5000 row 一批)

### 5.2 ULID 生成移到应用层

档 3 batchPutAtoms 必须**应用层预生成 ULID**(单 putAtomViaTx 字面 storage 生成).

`generateUlid()` 已是应用层函数 ([[src/storage/ulid.ts]]),字面没问题.但要确保:

- 单事务内 N 个 ULID 严格单调递增(generateUlid 同一 ms 内是否唯一 — 看 ulid.ts 实现)
- 失败回滚后 ULID 不复用(commit 失败 ULID 浪费可接受)

### 5.3 跨 item ULID 隔离(若做 §2.5 (e))

本期不做 (e),无此风险.做 (e) 时需考虑 tmpId 命名空间隔离(不同 item.atoms[i].tmpId 可能冲突 — markdownToAtoms 是否每 note 独立 tmpId 命名空间 需 verify).

### 5.4 verify test 留 or 删

Phase A verify test 跑完:

- **建议保留** → 升级为永久 regression test,SDK 升级时自动跑(对照 [[feedback_sdk_version_binding_policy]] 纪律)
- 删 → 简洁但下次 SDK 升级要重写

本期采纳:**保留**,test 内字面注释"SDK 版本绑定 verify,升级 SurrealDB SDK 前必跑".

### 5.5 BlockDiff applyDiff 路径不受益

`applyDiff`(note 编辑期增量修改)路径字面单 atom / 单 edge 写入居多,不走 createNotesBatch.档 3 不优化 applyDiff(那是单 note 内增量,RT 已经很少).**本期不动**.

---

## 6. 汇报模板(向主对话)

```
档 3 multi-row INSERT 完成汇报:

一、字面产出(N commit)
- (列 hash + 描述)

二、Phase A binary verify
- SurrealDB 3.0.4 + SDK 2.0.3 INSERT multi-row 支持: 是 / 否
- N=1000 multi-row vs serial 加速比: Xx
- 字面判断: 通过 / 不通过

三、Phase B 实施(若 A 通过)
- batchPutAtomsViaTx / batchPutEdgesViaTx 加 RPC 数: Y
- createSingleNoteFromDrafts 改动: 4 循环 → 2 batch
- 不做 §2.5 (e) 跨 item 合并的原因

四、Phase C V5 实测
- 同 92 篇 / 26285 块数据集
- 修前: 17105ms (档 1 baseline)
- 修后: Xms (-Y%)
- 阶段拆解: putAtom Xms / belongsToNote Xms / childOf Xms / nextSibling Xms

五、验收
- V1 typecheck: PASS / FAIL
- V2 现有 50/50 (或新数 N/N): PASS / FAIL
- V3 verify test: 保留 / 删除
- V4 grep perf log: 0 残留
- V5 用户实测: 17.1s → ?s

六、关键决策 + 教训
- (列偏离 prompt / 决议的拍板)
- memory 建议: 多 row INSERT row 数上限 / 跨 item 合并 (若做了 (e))

七、剩余债 + 下游 PR
- §2.5 (e) 跨 item 合并(若本期未做,登记)
- applyDiff 优化(独立讨论)
- 其它(若发现)

八、等待指挥拍板
- 合 main / push / decision 文档更新
```

---

## 7. Self-Contained Check

新会话 subagent 不必跑额外调研,本 prompt 已含:

- ✅ SDK / Server 版本字面证据(§1.1)
- ✅ 档 1/2 现状 + 17.1s 拆解(§1.2)
- ✅ 档 3 修法思路 + 理论估算(§1.3)
- ✅ Phase A verify 详尽规格(§2.1)
- ✅ Phase B 实施 a-d 完整代码骨架(§2.2)
- ✅ 文件清单(§4)
- ✅ 5 类风险 + 已知坑(§5)
- ✅ 汇报模板(§6)
- ✅ 反对策(§2.4)
- ✅ 决议关联(decision 020 / SP-5 / spec PE4 字面不破)

唯一外部依赖:

- `git checkout -b perf/create-notes-batch-multirow main` — 用户预切
- 用户准备 **92 篇 markdown 复现数据集 + 空库** — 跟档 1 baseline 同条件 ([[feedback_perf_remeasure_must_clean_baseline]])
- `npm start` / `npm run test` 实测 — 用户跑(sandbox)
- SurrealDB INSERT multi-row 语法官方 doc — WebSearch 查或用户提供

---

*Prompt 文档 · 2026-05-30 · perf/create-notes-batch-multirow · 17s → ~500ms 根治档*
