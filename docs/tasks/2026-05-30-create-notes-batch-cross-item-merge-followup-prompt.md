# Followup: createNotesBatch 跨 item 合并(§2.5 e)— 6.7s → ~1s 收尾档

> 档 3 multi-row INSERT 已合 main(c2bae6ca,33.5s → 6.7s,-80%).
> 本 followup = 92 篇 → 单事务**真正 2 次 SQL 全搞定**(理论 ~500ms-1s),边际优化.
> **未启用**,候压测/真实使用反馈后再决定是否启动.

---

## 0. 启动条件(在跑之前先想清楚)

**默认不启用,以下场景才考虑启:**

1. **真实使用场景实测 6.7s 仍体感慢**(eg 1000+ 篇导入显著超慢)
2. **有更大批量导入需求**(eg 一次 500 篇,SP-5 阈值上限),线性扩展到 ~30s+
3. **跨 item 合并的代码主路径要为别的任务重写**,顺手做掉

**反对启动的条件:**

- 6.7s 在 92 篇真实场景**用户体感 OK**(配进度条 [[project_word_import_pipeline_hardening_done]])
- 重构面大(改 `createNotesBatch` 主循环 + tmpId 跨 item 命名空间隔离 verify)
- 边际收益递减:6.7s → 1s 不是用户体感跃迁
- **优先级低于其它债**:deleteNote 分批 PR C / inputRules wrapInTaskRule createdAt / 等

---

## 1. 背景

### 1.1 档 3 实测拆解(2026-05-30 用户 V5)

```
[markdown-import] BATCH createNotesBatch: items=92 notes=92 failures=0 (6659ms)
[markdown-import] done — notes=92 folders=20 elapsed=6812ms
```

档 3 Phase B 已把每 item 内部 ~N RPC 压成 2 RPC(atoms × N → 1 batchPutAtoms + edges × N → 1 batchPutEdges).

但 92 个 item 字面**逐个 for-loop 调** `createSingleNoteFromDrafts`,每 item 仍走:

1. `tx.putAtom`(container)× 1
2. `tx.putEdge`(hasNoteView)× 1
3. `tx.putEdge`(inFolder)× 0-1
4. `tx.batchPutAtoms`(atoms)× 1
5. `tx.batchPutEdges`(三类边)× 1

= 每 item **4-5 RPC** × 92 item = **~400 RPC**(不是 prompt §1.3 估算的 7 RPC).

### 1.2 (e) 修法

**跨 item 收集 atoms + edges 后单次 batchPutAtoms + batchPutEdges**:

```
92 item 全部 container atoms → 1 batchPutAtoms(92 row)
92 item 全部 hasNoteView + inFolder + belongsToNote + childOf + nextSibling
  → 1 batchPutEdges(~100000 row)
92 item 全部 PM block atoms → 1 batchPutAtoms(~26000 row)
```

总 RPC: 92 × 4-5 = ~400 → **3 RPC**.

### 1.3 理论估算

档 3 Phase A 验证 1000 row INSERT ~13-23ms.但**大 row 数线性放大**(rocksdb 写 amplification 推测):

- 92 row container batch: ~5ms
- 100000 row edges batch: 大概 ~500ms-1s(线性扩展待 verify)
- 26000 row atoms batch: ~200-400ms

理论 ~1s.从 6.7s → ~1s = **-85%(本档单独) / -97%(累计 vs 总 baseline 33.5s)**.

但**理论值有大不确定性** — 见 §5.1 风险.

---

## 2. 修法范围

### 2.1 核心挑战:tmpId 跨 item 命名空间隔离

档 3 现状:每 item.atoms[].tmpId 在 `createSingleNoteFromDrafts` 内部局部 Map,**不同 item 间 tmpId 可能冲突**(markdownToAtoms 每 note 独立命名空间 vs 全局命名空间未 verify).

**修法 (a)**:在跨 item 合并前,**字面给每 item 的 tmpId 加 item-idx 前缀**:

```ts
// Phase B createSingleNoteFromDrafts 内:
const tmpToReal = new Map<string, string>();
item.atoms.forEach((draft, i) => tmpToReal.set(draft.tmpId, atomEntities[i].id));

// (e) 修法跨 item:
const tmpToReal = new Map<string, string>(); // 全局 Map
for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
  const item = items[itemIdx];
  item.atoms.forEach((draft, i) => {
    const namespacedTmpId = `item${itemIdx}::${draft.tmpId}`;
    tmpToReal.set(namespacedTmpId, atomEntities[累计 offset + i].id);
  });
}
```

**修法 (b)**(更优雅):直接用 `(itemIdx, draft.tmpId)` 复合 key:

```ts
const tmpToReal = new Map<string, Map<string, string>>(); // itemIdx → tmpId → realId
```

### 2.2 失败语义 — 单事务整体回滚保留

档 3 单事务整体回滚字面**必须保留**:任一 item 失败 → 92 个 item 全 rollback,no partial commit.

**(e) 实施挑战**:跨 item 合并后,**失败定位粒度变粗**:

- 档 3:`createSingleNoteFromDrafts` for-loop catch(err)记录 `failures.push({ index: i, ... })`
- (e):全 batchPutAtoms / batchPutEdges 一次失败,**无法字面定位是哪个 item 的哪个 draft 坏**(SurrealDB 不返"第几行失败")

**修法**:

- (a) 收集阶段加 validation(eg parentTmpId 悬空字面 throw with item idx)
- (b) batch 失败 fallback 到逐 item 失败(N+1 次操作,但只在异常路径)
- (c) **本期不实施 fallback**,失败时 failures.push({ index: -1, error: ... }) 标"batch 失败,无法定位单 item"

### 2.3 collectBatchEdges 函数抽出

把 createSingleNoteFromDrafts 内 3 类边收集逻辑抽成 `collectEdgesForItem(item, tmpToReal, containerAtom, now): PutEdgeInput[]`,跨 item loop 调用累加到全局 edges 数组.

### 2.4 createNotesBatch 主循环重写

```ts
export async function createNotesBatch(input: CreateNoteBatchInput): Promise<CreateNoteBatchResult> {
  // ... 现有 SP-5 阈值 + 入参校验 ...

  try {
    await storage.transaction(async (tx) => {
      // Phase 1: 收集所有 container atom 输入
      const containerInputs: PutAtomInput<'pm'>[] = items.map(item => ({
        payload: { domain: NOTE_DOMAIN, payload: containerPayloadWithTitle(deriveTitleFromDrafts(item.atoms, item.titleHint)) }
      }));
      
      // Phase 2: 单 batch 写 92 个 container
      const containerEntities = await tx.batchPutAtoms<'pm'>(containerInputs);

      // Phase 3: 收集所有 PM atom 输入(跨 item 累计)
      const allAtomInputs: PutAtomInput<'pm'>[] = [];
      const tmpToReal = new Map<number, Map<string, string>>(); // itemIdx → tmpId → realId
      for (let i = 0; i < items.length; i++) {
        tmpToReal.set(i, new Map());
        for (const draft of items[i].atoms) {
          allAtomInputs.push({ payload: draft.payload });
        }
      }

      // Phase 4: 单 batch 写 ~26000 PM atom
      const allAtomEntities = await tx.batchPutAtoms<'pm'>(allAtomInputs);

      // Phase 5: 填 tmpToReal Map(按 item 切分 entities)
      let offset = 0;
      for (let i = 0; i < items.length; i++) {
        const itemMap = tmpToReal.get(i)!;
        items[i].atoms.forEach((draft, j) => itemMap.set(draft.tmpId, allAtomEntities[offset + j].id));
        offset += items[i].atoms.length;
      }

      // Phase 6: 收集所有边(hasNoteView + inFolder + belongsToNote + childOf + nextSibling)
      const allEdges: PutEdgeInput[] = [];
      for (let i = 0; i < items.length; i++) {
        allEdges.push(...collectEdgesForItem(items[i], tmpToReal.get(i)!, containerEntities[i], now));
      }

      // Phase 7: 单 batch 写所有边
      await tx.batchPutEdges(allEdges);

      // Phase 8: 构造 NoteInfo[]
      for (let i = 0; i < items.length; i++) {
        notes.push(buildNoteInfo(containerEntities[i], items[i], tmpToReal.get(i)!));
      }
    });
  } catch (err) {
    if (failures.length === 0) failures.push({ index: -1, error: String(err), rolledBack: true });
    return { notes: [], failures };
  }

  if (broadcastMode === 'final' && notes.length > 0) await broadcastNoteListChanged();
  return { notes, failures };
}
```

### 2.5 不做的事

- ❌ **不要**改 storage.transaction / api 接口(档 3 已加 batch helper,本期复用)
- ❌ **不要**为容错加 try-catch retry(违 [[feedback_no_fallback_bandaid_fixes]])
- ❌ **不要**改 createSingleNoteFromDrafts(本期主路径换成 createNotesBatch 内联,可以**删除** createSingleNoteFromDrafts)
- ❌ **不要**碰 markdownToAtoms / tmpId 生成逻辑(view 层契约)
- ❌ **不要**改 SP-5 500 篇硬拦阈值

---

## 3. 实施步骤(只在用户拍板启动后才跑)

### 3.1 Phase 0: 启动 verify

1. 用户拍板"启 (e) followup"
2. `cd /V2 && git checkout -b perf/create-notes-batch-cross-item main`(用户预切)

### 3.2 Phase 1: tmpId 命名空间隔离 binary verify

写小 test 字面 verify "不同 item 的 markdownToAtoms 输出 tmpId 是否可能冲突":

```ts
// tests/import/tmpid-namespace-verify.test.ts(临时,跑完删)
import { markdownToAtoms } from '@capabilities/content-ingest';

it('两个独立 markdown 输入 tmpId 是否冲突', async () => {
  const { atoms: a1 } = await markdownToAtoms('# Title 1\n\nbody 1', { titleHint: 'T1' });
  const { atoms: a2 } = await markdownToAtoms('# Title 2\n\nbody 2', { titleHint: 'T2' });

  const ids1 = new Set(a1.map(d => d.tmpId));
  const ids2 = new Set(a2.map(d => d.tmpId));

  const intersection = [...ids1].filter(x => ids2.has(x));
  console.log(`[verify] item1 tmpIds: ${[...ids1].slice(0, 3)}... item2 tmpIds: ${[...ids2].slice(0, 3)}... intersection.length=${intersection.length}`);

  // 若 intersection.length > 0 → 必须加 (i, tmpId) 复合 key 或 item-idx 前缀
  // 若 intersection.length === 0 → markdownToAtoms 字面已用全局唯一(eg ULID),无需修法
});
```

**判据**:

- `intersection.length === 0` → markdownToAtoms 字面全局唯一,直接 flat Map 即可,无需复合 key
- `intersection.length > 0` → 必须实施 §2.1 修法(复合 key 或 item-idx 前缀)

### 3.3 Phase 2: 实施 createNotesBatch 主循环重写

按 §2.4 字面伪代码实施:

1. 抽 `collectEdgesForItem` helper
2. 主循环改 8 阶段(container batch / atoms batch / tmpToReal 填充 / edges batch)
3. **删除** `createSingleNoteFromDrafts`(主路径换内联,**确认** scenario-9-rollback / scenario-11 仍 PASS)
4. typecheck + 现有 tests PASS
5. commit:
   ```
   perf(note): createNotesBatch 跨 item 合并 — 6.7s → ~Xs
   
   档 3 (e) followup: 92 item × 4-5 RPC = ~400 RPC → 3 RPC 全 batch.
   tmpToReal 改 itemIdx → tmpId → realId 复合 Map.
   collectEdgesForItem helper 抽出.
   createSingleNoteFromDrafts 删除(主路径内联到 createNotesBatch).
   单事务整体回滚保留(scenario-9-rollback PASS 背书).
   失败定位:batch 异常路径无法定位单 item,failures.push({index:-1,...}).
   实测 V5 同 92 篇: 6659ms → Xms (-Y%).
   ```

### 3.4 Phase 3: V5 实测(用户)

清空库 + 同 92 篇导入,期望 < 2s(理论 ~1s).若收益 < 2x(eg 6.7s → 4s),登记原因 + 问指挥是否回滚.

---

## 4. 文件清单

| 文件 | 改动 | Phase |
|---|---|---|
| `tests/import/tmpid-namespace-verify.test.ts` | **新建** verify test(跑完删/保留 SDK regression) | 1 |
| `src/platform/main/note/capability-impl.ts` | createNotesBatch 主循环重写 + collectEdgesForItem 抽出 + 删 createSingleNoteFromDrafts | 2 |

---

## 5. 风险

### 5.1 大 row 数 INSERT 线性扩展未 verify

档 3 Phase A 只 verify N=1000 一档.大 row 数 INSERT(N=26000 / N=100000)的耗时曲线**未 verify**.SurrealDB 可能内部分块 / 触发 memory pressure / fsync 频率改变,实测可能远高于理论线性外推.

**缓解**:Phase 3 实测,若 6.7s → 5s 而非 ~1s,**回滚本档**(单事务原子性是硬约束,batch 单点失败定位差但写库慢就回到档 3).

### 5.2 失败定位粒度变粗

档 3 字面"哪个 item 第几个 atom 失败"可定位.本档 batch 失败只知道"整批 rollback",失败诊断困难.

**缓解**:加 validation 阶段(parentTmpId 悬空 throw with itemIdx 字面)+ failures.push 写明"batch 失败,详细诊断需 single-item 重跑".

### 5.3 createSingleNoteFromDrafts 删除影响

grep 全仓 caller:仅 createNotesBatch 主路径调用.但**测试 / 历史 commit 引用**可能存在,git rm 前必 grep.

### 5.4 ULID 跨 item 顺序

batch 写所有 atoms 时,**应用层预生成 ULID 顺序**字面影响插入顺序.SurrealDB INSERT 是否保证顺序与 SQL row array 顺序一致**需 verify**.若顺序错乱 → nextSibling 边 atomId 引用错位.

**缓解**:Phase 1 verify test 加"插入顺序 verify":

```ts
const inputs = Array.from({length: 100}, (_, i) => ({ id: `atom:order_${i}`, ... }));
await tx.query('INSERT INTO atom $rows', { rows: inputs.map(...) });
const selected = await tx.query('SELECT id FROM atom WHERE createdBy = $u ORDER BY id', ...);
// 验证 selected 顺序与 inputs 顺序一致(或 ULID 单调,顺序保证)
```

### 5.5 6.7s 真因可能不在跨 item

如果 §5.1 验证显示**大 row 数线性扩展不成立**(eg 26000 row INSERT 本身 ~3s),那 §2.4 修法**理论收益就不是 ~1s 而是 ~4s**,启动 ROI 进一步打折.

**Phase 1 verify 必须含大 row 数曲线 verify**(N=100/1000/10000/26000 × 3 轮),拿到真实曲线再决定是否进 Phase 2.

---

## 6. 汇报模板(若启动)

```
(e) followup 完成汇报:

一、字面产出(N commit)

二、Phase 1 verify
- tmpId 跨 item 冲突: 有 / 无
- 大 row 数 INSERT 曲线: N=100/1000/10000/26000 × 3 轮平均
- INSERT 顺序 verify: 一致 / 不一致

三、Phase 2 实施(若 verify 通过)
- createSingleNoteFromDrafts 删除: 是 / 否
- collectEdgesForItem 抽出
- 8 阶段重写

四、Phase 3 V5 实测
- 同 92 篇 / 26285 块
- 修前(档 3): 6659ms
- 修后: Xms (-Y%)
- 是否达到 < 2s 目标

五、验收(typecheck / tests / lint / log 清理)

六、关键决策 + 教训

七、剩余债

八、等待指挥拍板
```

---

## 7. Self-Contained Check

新会话 subagent 不必跑额外调研,本 prompt 已含:

- ✅ 启动条件 + 反对启动条件(§0)
- ✅ 背景 + 实测数据(§1.1)
- ✅ 修法 + tmpId 隔离方案(§2.1-2.4)
- ✅ Phase 0-3 实施步骤(§3)
- ✅ 文件清单(§4)
- ✅ 5 类风险(§5)
- ✅ 汇报模板(§6)
- ✅ 反对策(§2.5)

唯一外部依赖:

- 用户拍板启动(本 prompt 默认**不启用**)
- `git checkout -b perf/create-notes-batch-cross-item main` — 用户预切
- 用户 92 篇复现数据集 + 空库(同档 3)

---

*Prompt 文档 · 2026-05-30 · perf/create-notes-batch-cross-item · followup 待启*
