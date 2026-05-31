# Fix: collectNoteBlocks N+1 串行 listEdges — 嫌疑 G 22.4s → ~17s 收尾

> bulkDelete edge 修法已合 main(a96c8a7b,58.6s → 22.4s,-62%).嫌疑 G 字面占余下 28%(6.2s).
> 真因:`collectNoteBlocks` 字面 92 串行 `listEdges` 是 N+1.PR A 已加的 `objectAtomIds: string[]` 字段直接复用,**修法 4 行**.

---

## 0. 角色 / 工作纪律

你是修法 subagent. **strict mode**:

1. 只动本 prompt §3 / §4 列的文件,**不擅自重构**周边代码
2. **每条 Bash 必 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`**(V2 cwd 漂移 16+ 次史)
3. **memory 必读**:
   - `feedback_filter_single_vs_batch_mutex` — `objectAtomId` vs `objectAtomIds` 互斥,不归一化
   - `feedback_fast_path_api_must_migrate_slow_caller` — 加批量 API 必须把热 caller 切过去
   - `feedback_perf_remeasure_must_clean_baseline` — V5 复测必空库
   - `feedback_strict_compliance_workflow` — strict 4 条
   - `feedback_v2_is_workspace_v1_is_reference` — V2 工作 V1 只读
   - `project_bulk_delete_edge_perf_done` — 前序 PR 上下文
4. sandbox 拦截 `npm start` → 报告,用户跑 V5
5. 发现非范围 bug → **登记到汇报里**,不擅自修

---

## 1. 背景 + 真因(字面 grep 锁定)

### 1.1 V5 实测 baseline(bulk-delete edge PR 合 main 后)

```
总耗时: 22.4s
段拆解:
  collect (嫌疑 G)  6205ms  28%   ← 本 PR 修
  edge DELETE       ~4000ms 18%   ← 上 PR 已修
  atom DELETE       ~11800ms 53%  ← 留独立 followup
  其它              ~400ms   1%
```

[[project_bulk_delete_edge_perf_done]] 字面登记本 PR 是嫌疑 G 续修.

### 1.2 真因代码

[src/platform/main/folder/capability-impl.ts:423-435](src/platform/main/folder/capability-impl.ts#L423):

```ts
async function collectNoteBlocks(containerIds: string[]): Promise<string[]> {
  const blockIds: string[] = [];
  for (const containerId of containerIds) {              // ← N 次串行
    const edges = await storage.listEdges({
      predicate: BELONGS_TO_NOTE_PREDICATE,
      objectAtomId: containerId,                          // ← 单 id 查
    });
    for (const e of edges) {
      if (e.subject.kind === 'atom') blockIds.push(e.subject.atomId);
    }
  }
  return blockIds;
}
```

**经典 N+1**:92 container × 1 RPC = 92 RPC.每 RPC ~67ms(6205ms / 92) → V5 真实数据.

### 1.3 caller

[src/platform/main/folder/capability-impl.ts:349](src/platform/main/folder/capability-impl.ts#L349):

```ts
const allBlockIds = await collectNoteBlocks(allResourceIds);
```

唯一 caller — deleteFolder 主路径.

### 1.4 修法字面证据 — PR A 已加 objectAtomIds

[src/storage/api.ts:170-176](src/storage/api.ts#L170)(PR A `3a8f4d8b` 加):

```ts
/**
 * 批量 object atom id 过滤（SQL IN）
 * 新增（P0-1, 2026-05-29 data-layer-audit）:
 * 与 `objectAtomId` 互斥（同时传 throw）；空 array 短路返回 []。
 */
objectAtomIds?: string[];
```

**字段字面已在,storage 层 SQL 字面走 INSIDE,mock 字面已 verify**(PR A `4c19bc67` 5 commit 整套已合 main).

### 1.5 修法

```ts
async function collectNoteBlocks(containerIds: string[]): Promise<string[]> {
  if (containerIds.length === 0) return [];
  // 字面修法(2026-05-30 fix/collect-note-blocks-batch,嫌疑 G):
  // 原 N 次串行 listEdges → 1 次 INSIDE 批量查,复用 PR A 加的 objectAtomIds 字段.
  // V5 baseline: 92 container × 67ms ≈ 6.2s → 1 RPC 应 < 500ms (-92% 预期).
  const edges = await storage.listEdges({
    predicate: BELONGS_TO_NOTE_PREDICATE,
    objectAtomIds: containerIds,
  });
  const blockIds: string[] = [];
  for (const e of edges) {
    if (e.subject.kind === 'atom') blockIds.push(e.subject.atomId);
  }
  return blockIds;
}
```

**4 行核心改动**.无 schema / SQL / API / interface 变更.PR A 字段直接复用.

---

## 2. 实施范围

### 2.1 必做

按 §1.5 字面落到 [src/platform/main/folder/capability-impl.ts:423-435](src/platform/main/folder/capability-impl.ts#L423).加注释引 [[feedback_fast_path_api_must_migrate_slow_caller]] + 引 V5 baseline.

### 2.2 不做的事

- ❌ **不要**碰 collectFolderSubtree(BFS 父子 folder,N 不大且本期未在嫌疑名单)
- ❌ **不要**碰 collectResourcesInFolders(查 inFolder 边,父 folder 数量 ~20 远小于 92 container,占比小)
- ❌ **不要**碰 atom 路径 DELETE(独立 followup PR)
- ❌ **不要**改 `objectAtomIds` 的 storage 实施(PR A 字面已 verify,本期纯 caller 迁移)
- ❌ **不要**用 retry / fallback(违 [[feedback_no_fallback_bandaid_fixes]])
- ❌ **不要**改 collectNoteBlocks 函数签名(caller 字面只有 1 处,签名变更无收益)

### 2.3 验收

- typecheck PASS
- V2 现有 tests + scenario-9-rollback + scenario-11-roundtrip 全 PASS
- 不加新 test(逻辑等价,字段语义 PR A 已 verify;若想加 test 可加 1 case 验"100 container 一次返"作 SDK regression,可选)
- V5 实测:22.4s → < 17s,collect 段 6.2s → < 500ms

---

## 3. 实施步骤

1. `cd /V2 && git checkout -b fix/collect-note-blocks-batch main`(用户预切,sandbox 拦你就报)
2. 改 collectNoteBlocks(§1.5)
3. typecheck + V2 现有 tests
4. commit:
   ```
   perf(folder): collectNoteBlocks N+1 串行 → 1 次 INSIDE 批量查
   
   嫌疑 G(diagnose 报告 13a744ad §六.2 登记)字面修:92 container 串行
   listEdges → 1 RPC 复用 PR A 加的 objectAtomIds 字段.
   
   V5 baseline (a96c8a7b 后): 22.4s 总耗时,collect 段 6205ms (28%).
   修后预期: collect 段 < 500ms,总耗时 22.4s → ~17s (-24%).
   
   字面 4 行核心改动,0 schema/SQL/API 变更,纯 caller 迁移.
   单事务原子性零退化(本路径不在 storage.transaction 内部,跨事务读).
   
   下游 followup: atom 路径 DELETE $rids 候选 verify(本期不动,53% 余下).
   ```
5. **stop 汇报**,等用户跑 V5 实测

### 3.1 V5 用户操作清单(汇报里写明给主对话转)

```
1. 清空库 (同 diagnose 清库脚本)
2. npm start
3. 不打开任何 note
4. 导入同 92 篇 markdown(等 ~6.7s 完成)
5. NavSide 选父 folder + 删除
6. 把终端 stdout 贴主对话(找 [delete/perf] 系列 log)

期望:
  collect 段: 6205ms → < 500ms
  总耗时: 22.4s → < 17s (-24%)
  edge_subject + edge_object 段保持平稳 ~150ms / 个位数 ms (PR a96c8a7b 修法不退化)
```

---

## 4. 文件清单

| 文件 | 改动 |
|---|---|
| `src/platform/main/folder/capability-impl.ts:423-435` | collectNoteBlocks N+1 → 1 RPC |

**仅 1 文件,4 行核心改动**.

---

## 5. 风险 + 已知坑

### 5.1 objectAtomIds 大数组 INSIDE 退化扫描风险

bulk-delete PR 字面发现 `INSIDE 大数组` + `OR` 击穿索引致全表扫(diagnose 报告 §四).本路径只有**单字段** `objectAtomIds INSIDE $containerIds`(无 OR),storage schema 字面定 `edge_predicate` + `edge_object` 单字段索引([schema.ts:65, 72](src/storage/surreal/schema.ts#L65)),且本路径是**读不是删**,planner 行为可能不同.

92 元素 INSIDE 数组 + 单字段单索引应能走 list lookup.但**未 binary verify**,V5 实测若 collect 段仍 > 1s,登记调研 [[feedback_surrealdb_4x_no_type_thing]]/[[feedback_surrealdb_inside_not_in]] 同款"INSIDE 大数组退化"是否扩散到读路径.

**不实施额外 verify** — 1 RPC 即使 2s 仍比 92 RPC × 67ms 快 ~3×.若需进一步优化加 binary verify test.

### 5.2 listEdges 跨事务读 vs collectNoteBlocks 调用上下文

本路径调用点 [folder/capability-impl.ts:349](src/platform/main/folder/capability-impl.ts#L349)在 `deleteFolder` 主路径,**不在 storage.transaction 内部**(查 line 332-380 字面 deleteFolder 不开事务,只 collect → createIntent → drainFolderDeletion).跨事务读 audit §5.3 已登记债,本期不动.单 RPC vs N RPC 行为字面同款(都是跨事务 storage.listEdges).

### 5.3 PR A 字段语义 verify 历史

PR A `4c19bc67` 加 `objectAtomIds` 时字面 verify 过:`tests/storage/filter-extensions.test.ts` 4 case PASS.本期纯 caller 迁移,无需重 verify.

### 5.4 嫌疑 G 实测 28% 跟 V5 数据对账

V5 [delete/perf] collect log 字面打印 collect 总耗时(folder/capability-impl.ts:341 已 perf log).但 collect 段含 collectFolderSubtree(~20 folder × 1 RPC = ~1.3s)+ collectResourcesInFolders(~20 父 folder × 1 RPC = ~1.3s)+ collectNoteBlocks(~3.6s).精确拆 collect 子段在 deleteFolder perf log 字面可能未拆到这级别 — 修后 V5 直接看 collect 总段是否从 6.2s → ~2.6s (1.3 + 1.3 + ~0).

实测若 < 3s 即 dominant 子段(collectNoteBlocks)已修.其它子段是次要(若需要再开 follow-up).

---

## 6. 汇报模板

```
collectNoteBlocks N+1 修法完成:

一、字面产出(1 commit)
- perf(folder): collectNoteBlocks N+1 串行 → 1 次 INSIDE 批量查

二、修法
- folder/capability-impl.ts:423-435: 字面 4 行核心改动
- 复用 PR A 加的 EdgeFilter.objectAtomIds 字段

三、验收
- typecheck PASS / V2 现有 tests + scenario-9 + scenario-11 PASS
- 0 schema/SQL/API 变更

四、Phase C V5 实测(用户跑后填)
- collect 段: 6205ms → Xms (-Y%)
- 总耗时: 22.4s → Zs (-W%)
- edge subject/object 段未退化 ✅

五、剩余债 + 下游
- atom 路径 DELETE $rids verify(53%,独立 followup PR)
- atom + G 两个都做后达 < 5s 目标

六、等待指挥拍板:合 main / push
```

---

## 7. Self-Contained Check

- ✅ V5 baseline 字面数据(§1.1)
- ✅ 真因代码字面 grep(§1.2)
- ✅ 修法 4 行(§1.5)
- ✅ PR A 字段字面证据(§1.4)
- ✅ 文件清单 1 文件(§4)
- ✅ 5 类风险(§5)
- ✅ V5 用户操作清单(§3.1)
- ✅ 不做的事(§2.2)

唯一外部依赖:
- 用户预切 `fix/collect-note-blocks-batch` 分支
- 用户 V5 实测 + 贴 [delete/perf] log

---

*Prompt 文档 · 2026-05-30 · fix/collect-note-blocks-batch · 嫌疑 G 4 行修法收尾*
