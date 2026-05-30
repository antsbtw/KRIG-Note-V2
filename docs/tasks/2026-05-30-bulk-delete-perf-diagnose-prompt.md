# Diagnose: 批量删除 92 篇 note 耗时 30s+ — 真因定位 prompt

> 用户 V5 实测:导入 92 篇 markdown 后**批量删除耗时 30s+**.写库已优化(档 3 33.5s → 6.7s)
> 删除路径**未触**.本 prompt = 纯诊断,**不修代码**,加 log + 跑实测 + 定位真因 + 写报告.

---

## 0. 角色 / 工作纪律

你是诊断 subagent. **strict mode**:

1. **诊断 only,不改业务代码** — 只加临时 perf log + 必要 console.time/timeEnd
2. **每条 Bash 必 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`**(V2 cwd 漂移 16 次史)
3. **memory 必读**:
   - `feedback_no_fallback_bandaid_fixes` — 先定真因再说,禁止猜
   - `feedback_diag_log_before_speculation` — 跨模块 bug 先 log 不靠看代码猜
   - `feedback_perf_remeasure_must_clean_baseline` — perf 复测必空库同初始态
   - `feedback_main_console_not_in_devtools` — main 进程 log 看 npm start 终端不是 DevTools
   - `feedback_strict_compliance_workflow` — strict 4 条
4. sandbox 拦截 `npm start` → 报告,**用户跑** V5 实测
5. 发现非诊断范围的修法机会 → **登记到汇报里**,不擅自动手
6. **本 prompt 终点是诊断报告**,不是修代码.修法 prompt 由主对话基于本报告写

---

## 1. 现状字面证据

### 1.1 用户场景

```
1. npm start 后空库 + 同样的 92 篇 markdown 导入(档 3 后 createNotesBatch 6.7s ✅)
2. NavSide 全选 92 篇 + 多选删除
3. 删除 overlay 进度条字面跑 30s+ 才完成
```

档 1 / 档 3 的 createNotesBatch 写库优化字面不触删除路径.删除走完全独立的代码路径.

### 1.2 grep 锁定的代码路径(主对话已调研)

字面调用链:

```
NavSide 多选 → deleteSelected(wsId)               (src/views/note/note-commands.ts:124)
  → deleteTreeIdsWithProgress([...ids])           (tree-operations.ts:177)
    → for 循环 N 次:                              (tree-operations.ts:154)
      → deleteOneTreeItem(type, id, taskId)       (tree-operations.ts:106)
        → deleteNote(id, { progressTaskId })      (data-model.ts:197)
          → noteCap().deleteNote(id, opts)        (capabilities/note/index.ts:77)
            → IPC NOTE_DELETE                     (handlers.ts:101)
              → deleteNote main 实施              (capability-impl.ts:629)
                → createIntent(...)               (capability-impl.ts:647)
                → drainNoteAndFinalize(id, intentId, progress?)  (capability-impl.ts:594)
                  ↓
                  for 循环:                       (capability-impl.ts:605)
                    listEdges({ predicate: BELONGS_TO_NOTE, objectAtomId: id })  ← 跨事务 1 RPC
                    storage.transaction(tx => tx.bulkDeleteAtomsAndEdges(batch)) ← 1 事务
                  ↓ 循环退出后
                  storage.transaction(tx => tx.deleteAtom(containerId))           ← 1 事务
                ↓
                deleteIntent(intentId)            ← 1 RPC
              broadcastNoteListChanged()          ← N folder broadcast(P1-3 优化后 3 RPC)
```

### 1.3 嫌疑源(按概率排,**诊断报告必须 disambiguate**)

#### 嫌疑 A: 92 次串行 deleteNote(view 层 for 循环)

[src/views/note/tree-operations.ts:154](src/views/note/tree-operations.ts#L154):

```ts
for (const { type, id } of decoded) {
  await deleteOneTreeItem(type, id, taskId);  // 串行 92 次
  done++;
}
```

每篇 deleteNote 至少 5 个跨事务 RPC + broadcast:**~460+ RPC 串行**.

#### 嫌疑 B: drainNoteAndFinalize 循环过于"保守"重查

[src/platform/main/note/capability-impl.ts:605-618](src/platform/main/note/capability-impl.ts#L605-L618):

```ts
for (;;) {
  const belongsEdges = await storage.listEdges({  // ← 每轮跨事务重查
    predicate: BELONGS_TO_NOTE_PREDICATE,
    objectAtomId: id,
  });
  if (belongsEdges.length === 0) break;
  // ...
  await storage.transaction(async (tx) => {
    await tx.bulkDeleteAtomsAndEdges(batch);
  });
}
```

每篇 note 的"块"数 26285 / 92 ≈ 286 块/篇.每篇删除走 1 轮循环(286 < 1000 batch size)= 2 RPC(listEdges + bulkDelete).但**重查 listEdges 设计为"幂等续删基础",非性能路径** — 实际 92 篇 × 2 RPC = 184 RPC.

#### 嫌疑 C: broadcastNoteListChanged × 92

每删一篇 note 触发 1 次 listNotes broadcast.**listNotes 已 metadata-only 优化** (200ms 冷启动) 但 92 次 broadcast 是否仍累积?

[src/platform/main/note/capability-impl.ts ~line 665](src/platform/main/note/capability-impl.ts) deleteNote 收尾应调 broadcastNoteListChanged.具体看实施.

#### 嫌疑 D: bulkDeleteAtomsAndEdges 内部 SQL 慢

[src/storage/surreal/transaction-helpers.ts:123-143](src/storage/surreal/transaction-helpers.ts#L123-L143) `bulkDeleteAtomsAndEdgesViaTx`:

```sql
DELETE edge WHERE subject.atomId INSIDE $ids OR (object.kind = 'atom' AND object.atomId INSIDE $ids) RETURN BEFORE
DELETE atom WHERE id INSIDE $rids RETURN BEFORE
```

286 block × 92 篇 = ~26000 atom delete + ~95000 edge delete(belongsToNote / childOf / nextSibling × ~26000).即使单 SQL 跑,SurrealDB 真实 DELETE 大集合**速度未 verify**(类似档 3 INSERT 大 row 线性放大).

#### 嫌疑 E: intent log 写入慢 / 跨事务

每篇 createIntent + deleteIntent = 2 个独立事务,总 184 个 intent 事务.intent log 表的写入开销?

#### 嫌疑 F: deletionPending 标记小事务

[src/platform/main/note/capability-impl.ts ~line 650] deleteNote 步 1 把 container.deletionPending = true 是个**单独小事务**.每篇 1 次 = 92 次额外事务.

### 1.4 不诊断范围

- ❌ 不改 deleteNote / deleteFolder 业务代码
- ❌ 不引入新 batch deleteNotes API(那是修法,不是诊断)
- ❌ 不删 intent log 路径(SP-1 数据可靠性地基,删了破 crash recovery)
- ❌ 不动 broadcastNoteListChanged 频率(那是 PR D / PR B 已 verify 路径)

---

## 2. 诊断步骤

### 2.1 Phase 1: 加 perf log(view 层 + main 层 + storage 层 3 处)

#### (a) view 层 — `src/views/note/tree-operations.ts:145-167`

```ts
export async function deleteTreeIdsWithProgress(treeIds: string[]): Promise<void> {
  if (treeIds.length === 0) return;
  const decoded = treeIds.map(decodeTreeId);
  const total = decoded.length;

  const tAll = performance.now();
  console.log(`[diag-del/view] BATCH START total=${total}`);

  await runRendererProgress(
    total > 1 ? `正在删除 ${total} 项` : '正在删除',
    async ({ report, taskId }) => {
      let done = 0;
      for (const { type, id } of decoded) {
        const tItem = performance.now();
        await deleteOneTreeItem(type, id, taskId);
        const dur = Math.round(performance.now() - tItem);
        console.log(`[diag-del/view] item ${done + 1}/${total} type=${type} dur=${dur}ms`);
        done++;
        report(`已删除 ${done}/${total} 项`, done, total);
      }
      console.log(`[diag-del/view] BATCH DONE total=${total} elapsed=${Math.round(performance.now() - tAll)}ms`);
      return done;
    },
    { delayMs: 400, doneMessage: (done) => ({ success: true, message: `已删除 ${done} 项` }) },
  );
}
```

#### (b) main 层 — `src/platform/main/note/capability-impl.ts`

deleteNote 入口加 console.time + 拆分阶段:

```ts
export async function deleteNote(id: string, opts?: { progressTaskId?: string }): Promise<void> {
  const tStart = performance.now();
  console.log(`[diag-del/main] deleteNote START id=${id}`);

  // 步 1:check hasBeenReferenced + createIntent + deletionPending
  const tPhase1 = performance.now();
  // ... 原代码 ...
  console.log(`[diag-del/main]   phase1(check+intent+pending) ${Math.round(performance.now() - tPhase1)}ms`);

  // 步 2:drainNoteAndFinalize
  const tDrain = performance.now();
  await drainNoteAndFinalize(id, intentId, opts?.progressTaskId ? makeProgressReporter(opts.progressTaskId) : undefined);
  console.log(`[diag-del/main]   phase2(drainAndFinalize) ${Math.round(performance.now() - tDrain)}ms`);

  // 步 3:broadcastNoteListChanged
  const tBcast = performance.now();
  await broadcastNoteListChanged();
  console.log(`[diag-del/main]   phase3(broadcast) ${Math.round(performance.now() - tBcast)}ms`);

  console.log(`[diag-del/main] deleteNote DONE id=${id} total=${Math.round(performance.now() - tStart)}ms`);
}
```

drainNoteAndFinalize 内部循环:

```ts
async function drainNoteAndFinalize(id: string, intentId: string, onProgress?: ...): Promise<void> {
  let total = 0;
  let deleted = 0;
  let round = 0;
  for (;;) {
    round++;
    const tRound = performance.now();

    const tList = performance.now();
    const belongsEdges = await storage.listEdges({ predicate: BELONGS_TO_NOTE_PREDICATE, objectAtomId: id });
    const listMs = Math.round(performance.now() - tList);

    if (belongsEdges.length === 0) {
      console.log(`[diag-del/main]     drain round=${round} list=${listMs}ms remaining=0 (done)`);
      break;
    }
    if (total === 0) total = belongsEdges.length;
    const batch = belongsEdges.slice(0, DELETE_BATCH_SIZE).map((e) => e.subject.atomId);

    const tDel = performance.now();
    await storage.transaction(async (tx) => {
      await tx.bulkDeleteAtomsAndEdges(batch);
    });
    const delMs = Math.round(performance.now() - tDel);

    deleted += batch.length;
    onProgress?.(Math.min(deleted, total), total);

    console.log(`[diag-del/main]     drain round=${round} list=${listMs}ms del=${delMs}ms batch=${batch.length} remaining=${belongsEdges.length - batch.length}`);
  }

  const tFinal = performance.now();
  await storage.transaction(async (tx) => {
    await tx.deleteAtom(id);
  });
  console.log(`[diag-del/main]     drain finalize(deleteContainer) ${Math.round(performance.now() - tFinal)}ms`);

  const tIntent = performance.now();
  await deleteIntent(intentId).catch(() => {});
  console.log(`[diag-del/main]     drain deleteIntent ${Math.round(performance.now() - tIntent)}ms`);

  pmDocCache.invalidate(id);
}
```

#### (c) storage 层 — `src/storage/surreal/transaction-helpers.ts:123-143`

bulkDeleteAtomsAndEdgesViaTx 拆 SQL 计时:

```ts
export async function bulkDeleteAtomsAndEdgesViaTx(tx: SurrealTransaction, ids: string[]): Promise<{ deletedAtoms: number; deletedEdges: number }> {
  if (ids.length === 0) return { deletedAtoms: 0, deletedEdges: 0 };

  const tEdge = performance.now();
  const edgeRes = await tx.query<[Array<unknown>]>(
    `DELETE edge WHERE subject.atomId INSIDE $ids OR (object.kind = 'atom' AND object.atomId INSIDE $ids) RETURN BEFORE`,
    { ids },
  );
  const edgeMs = Math.round(performance.now() - tEdge);
  const deletedEdges = edgeRes[0]?.length ?? 0;

  const tAtom = performance.now();
  const rids = ids.map((id) => atomRid(id));
  const atomRes = await tx.query<[Array<unknown>]>(`DELETE atom WHERE id INSIDE $rids RETURN BEFORE`, { rids });
  const atomMs = Math.round(performance.now() - tAtom);
  const deletedAtoms = atomRes[0]?.length ?? 0;

  console.log(`[diag-del/storage]       bulkDel ids=${ids.length} edge=${edgeMs}ms(${deletedEdges}) atom=${atomMs}ms(${deletedAtoms})`);

  return { deletedAtoms, deletedEdges };
}
```

### 2.2 Phase 2: V5 实测(用户跑)

诊断 subagent **报告"加 log 完成,请用户跑 V5"** + 等用户贴日志.

用户操作清单(写在汇报里给主对话转交):

```
1. 清空库:
   APP_DIR="$HOME/Library/Application Support/KRIG Note V2"
   rm -rf "$APP_DIR/krig-data/surreal" \
          "$APP_DIR/krig-data/migration-021-completed" \
          "$APP_DIR/krig-data/migration-022-completed" \
          "$APP_DIR/krig-data/migration-023-completed" \
          "$APP_DIR/.db-credentials" \
          "$APP_DIR/import-cache" && \
   cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && \
   rm -rf .vite node_modules/.vite

2. npm start

3. 不打开任何 note(避免 NoteView mount 污染)

4. 导入同 92 篇 markdown 数据集

5. NavSide 全选 92 篇 → 多选删除

6. 等删除完成 → 把终端 stdout 贴给主对话(包含所有 [diag-del/...] log)
```

### 2.3 Phase 3: 分析日志 + 写诊断报告

用户日志到位后,**诊断 subagent 写报告**(不修代码):

#### 报告结构

```
一、实测总耗时
- view BATCH DONE elapsed: Xms
- 平均每篇: Xms

二、92 篇耗时分布
- 最快篇: Xms
- 最慢篇: Xms
- 中位数: Xms
- 长尾(top 5): 哪几篇

三、单篇阶段拆解(取 1 篇典型 + 1 篇长尾对照)
- phase1 (check+intent+pending): Xms
- phase2 (drainAndFinalize):
  - 循环轮数 N
  - 每轮 list=Xms del=Xms batch=Y remaining=Z
  - finalize(deleteContainer): Xms
  - deleteIntent: Xms
- phase3 (broadcast): Xms

四、storage 层拆解(每批)
- bulkDel ids=N edge=Xms(M) atom=Xms(K)
- 单批 edge DELETE 与 atom DELETE 耗时比

五、嫌疑定级(基于实测占比)
- 嫌疑 A view 串行: 占比 % (= 累计 Xms / 总 Xms)
- 嫌疑 B drain 重查: 占比 %
- 嫌疑 C broadcast × 92: 占比 %
- 嫌疑 D bulkDelete SQL: 占比 %
- 嫌疑 E intent log: 占比 %
- 嫌疑 F deletionPending: 占比 %

六、真因定位(占比 ≥ 30% 算重大,≥ 50% 算 dominant)
- dominant: 嫌疑 X
- 显著: 嫌疑 Y / Z

七、修法方向建议(只提建议,不实施)
- 主修(根治 dominant 嫌疑):
- 次修(收尾显著嫌疑):
- 不修(占比小 < 10%):

八、Phase 4 清理 log
- 已删除所有 [diag-del/*] log
- grep 0 残留 verify
- typecheck PASS
```

### 2.4 Phase 4: 清理 + 提交诊断报告

1. 删除 (a) (b) (c) 三处 perf log,grep `[diag-del/` 应 0 残留
2. typecheck PASS
3. 把诊断报告作为一个 commit 提交到 diagnose 分支(纯 doc commit):
   ```
   docs(tasks): 批量删除 30s+ 诊断报告
   
   92 篇 note 多选删除耗时实测拆解,定位 dominant 真因 + 修法方向.
   主对话据此报告写修法 prompt.
   
   (报告内容...)
   ```
4. **不 merge 到 main**(诊断报告留 diagnose 分支当历史记录)

---

## 3. 实施步骤

1. `cd /V2 && git checkout -b diagnose/bulk-delete-perf main`(用户预切,sandbox 拦你就报)
2. Phase 1 加 3 处 perf log:
   - `src/views/note/tree-operations.ts` deleteTreeIdsWithProgress 拆 92 项计时
   - `src/platform/main/note/capability-impl.ts` deleteNote + drainNoteAndFinalize 拆阶段
   - `src/storage/surreal/transaction-helpers.ts` bulkDeleteAtomsAndEdgesViaTx 拆 SQL
3. typecheck PASS(不应破坏既有逻辑,只加 log)
4. commit 临时:
   ```
   diag(delete): 加 [diag-del/*] perf log(临时,Phase 4 删)
   ```
5. **停手汇报**主对话:"log 加完,请用户跑 V5 + 贴日志"
6. **用户贴日志后**继续 Phase 3 分析 + Phase 4 清理 + 写诊断报告

---

## 4. 文件清单

| 文件 | 改动 | Phase |
|---|---|---|
| `src/views/note/tree-operations.ts` | 加 view 层 perf log | 1 |
| `src/platform/main/note/capability-impl.ts` | 加 deleteNote + drainNoteAndFinalize 阶段 perf log | 1 |
| `src/storage/surreal/transaction-helpers.ts` | 加 bulkDeleteAtomsAndEdgesViaTx SQL perf log | 1 |
| **诊断报告文档** | docs/tasks/2026-05-30-bulk-delete-perf-diagnose-report.md(新建) | 3 |

---

## 5. 风险 + 已知坑

### 5.1 main 进程 log 在 npm start 终端 stdout

[[feedback_main_console_not_in_devtools]]:main 进程 console.log 在终端,**不在 DevTools renderer 控制台**.

用户操作清单字面写明"看终端 stdout"避免找错地方.

### 5.2 broadcast 触发 NavSide 重渲染污染

诊断 subagent 必须**告诉用户**:V5 实测时**别打开任何 note**(NoteView mount 污染计时).但 NavSide 是常驻无法避免.

诊断报告里**显式标注**"BroadcastNoteListChanged 后 renderer NavSide 重渲染耗时**未计入 deleteNote 耗时**(只测 main 端)".若用户体感 30s 包含 renderer 卡顿,**需要再加 view 层 broadcast→render 计时 log**(本期暂不加,看 main 数据决定).

### 5.3 progressTaskId 透传链路不动

诊断 log 不能改 progressTaskId 透传逻辑(这是 7 层契约,改了破删除进度 UX).

### 5.4 V5 复测必须空库

[[feedback_perf_remeasure_must_clean_baseline]]:同档 3 教训.前次 92 篇数据残留 + intent log 残留会污染.

### 5.5 92 次 broadcast 可能撞 OCC

PR D 教训 [[feedback_pm_internal_attr_write_must_mark_no_history]]:跨事务 broadcast 触发 listNotes 读 + 同时 main 端写 deletionPending 标记 = 潜在 OCC 冲突.诊断报告字面观察终端是否有 `Transaction conflict` log.

---

## 6. 汇报模板(诊断 subagent 给主对话)

### 6.1 Phase 1 完成时(加 log 完成)

```
[diag-del] Phase 1 完成 — 加 log 候 V5

一、字面产出(1 commit)
- diag(delete): 加 [diag-del/*] perf log

二、3 处 log 字面位置
- view: tree-operations.ts:145-167
- main: capability-impl.ts (deleteNote + drainNoteAndFinalize)
- storage: transaction-helpers.ts (bulkDeleteAtomsAndEdgesViaTx)

三、用户操作清单(主对话转发给用户)
1. 清空库 ...
2. npm start
3. 不打开任何 note
4. 导入 92 篇 markdown
5. 全选 + 多选删除
6. 把终端 stdout 全贴主对话

四、等用户贴日志后继续 Phase 3/4
```

### 6.2 Phase 3/4 完成时(诊断报告)

```
[diag-del] Phase 3/4 完成 — 诊断报告

(按 §2.3 报告结构填充)

修法建议交主对话,本 subagent 不实施.
```

---

## 7. Self-Contained Check

诊断 subagent 不必跑额外调研,本 prompt 已含:

- ✅ 现状字面证据 + 调用链(§1.1-1.2)
- ✅ 6 个嫌疑源排序(§1.3)
- ✅ Phase 1 三处 log 字面代码(§2.1)
- ✅ V5 用户操作清单 + 清库脚本(§2.2)
- ✅ Phase 3 诊断报告结构(§2.3)
- ✅ 实施步骤(§3)
- ✅ 5 类风险(§5)
- ✅ 汇报模板 2 个阶段(§6)
- ✅ 不诊断范围(§1.4)

唯一外部依赖:

- 用户预切 `diagnose/bulk-delete-perf` 分支
- 用户跑 V5 实测 + 贴终端 stdout

---

*Prompt 文档 · 2026-05-30 · diagnose/bulk-delete-perf · 纯诊断,修法待报告后写*
