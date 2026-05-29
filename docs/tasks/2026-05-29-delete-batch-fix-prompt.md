# `deleteNote` / `deleteFolder` 大对象单事务卡死 — Bug Fix Prompt

> ⚠️ **本 prompt 字面已被 superseded (2026-05-29)**
>
> 用户字面反馈后发现：删除卡死 + 冷启动 30s 慢 + 批量删失败字面**同根** —
> 字面**应用层全库扫然后内存 filter 反模式**。本 prompt 字面只修了表面症状
> （单事务串行删 N 次），字面**没修**真正根因（listEdges 字面全库扫）。
>
> **字面接替的 prompt**：[`docs/tasks/2026-05-29-data-layer-audit-prompt.md`](2026-05-29-data-layer-audit-prompt.md)
>   — 字面**只 audit 不改代码**，产出报告后字面再决定字面修复范围（A2 prompt 待写）。
>
> 本 prompt 字面**保留作历史**（字面记录"如果只看删除症状会怎么修"的字面思路），
> 字面**不要按本 prompt 执行**。

> 这份 prompt 给新会话执行。直接把整份文档作为 user message 发给新对话即可。
> Self-contained — 新对话没有 5B / 删除诊断 上下文。

---

## 0. 你的身份 + 总目标

你是 KRIG-Note V2 的**实施工程师**。本次任务**修一个已立项 5 天的生产 bug**：

- **用户反馈**："批量删除失败"（多选 NavSide 项，含大 note 时字面卡死）
- **bug 字面已诊断**（2026-05-27 立项，memory `project-delete-note-batch-plan` 字面登记完整方案蓝图）
- **应急止血**：3 个大 note (6100/1456/373 块) 已在 DB 端手动 SQL 清掉
- **代码 fix 字面未实施**

本期**只修 bug**，**不动 UX 进度可视化**（那是独立 sub-phase，留下一个 prompt）。

**Agent 类型**：`general-purpose`（不是 Plan — Plan 没 Write/Edit）

---

## 1. Bug 字面机制

### 1.1 根因

[`src/platform/main/note/capability-impl.ts:493-523`](../../src/platform/main/note/capability-impl.ts) 字面 `deleteNote`：

```ts
export async function deleteNote(id: string): Promise<{ cascadedEdges: number }> {
  // ...
  const belongsEdges = await storage.listEdges({
    predicate: BELONGS_TO_NOTE_PREDICATE,
    objectAtomId: id,
  });
  let cascadedEdges = 0;
  await storage.transaction(async (tx) => {
    for (const e of belongsEdges) {       // ⚠️ 字面 N 次串行 await
      const res = await tx.deleteAtom(e.subject.atomId);
      cascadedEdges += res.cascadedEdges;
    }
    const containerRes = await tx.deleteAtom(id);
    cascadedEdges += containerRes.cascadedEdges;
  });
  // ...
}
```

字面问题：
- 6100 块 note = 6100 次 `tx.deleteAtom` 串行 await
- 每次 `tx.deleteAtom` 字面在 SurrealDB 单事务内执行 `DELETE atom + 级联 DELETE edge`（≥ 3 query）
- 6100 × 3 = 18000 query 累积在**单个 RocksDB write batch** → SDK 串行往返 → 卡死
- broadcast 字面不发 → UI 字面"点删没反应"

### 1.2 同款 bug — `deleteFolder`

[`src/platform/main/folder/capability-impl.ts:210-239`](../../src/platform/main/folder/capability-impl.ts) 字面 `deleteFolder`：

```ts
export async function deleteFolder(id: string): Promise<...> {
  return storage.transaction(async (tx) => {
    const allFolderIds = await collectFolderSubtree(tx, id);
    const allResourceIds = await collectResourcesInFolders(tx, allFolderIds);

    let cascadedEdges = 0;
    for (const resourceId of allResourceIds) {     // ⚠️ 字面同款串行
      const res = await tx.deleteAtom(resourceId);
      cascadedEdges += res.cascadedEdges;
    }
    for (const folderId of allFolderIds) {          // ⚠️ 字面同款
      const res = await tx.deleteAtom(folderId);
      cascadedEdges += res.cascadedEdges;
    }
    // ...
  });
}
```

字面同样：大 folder（含 N 个 note + 子 folder）→ N 次串行 → 同样卡死。

### 1.3 用户场景字面复合

[`src/views/note/tree-operations.ts:99`](../../src/views/note/tree-operations.ts) 字面 `deleteSelected`（NavSide 多选 → 删）：

```ts
export async function deleteSelected(workspaceId: string): Promise<void> {
  // ...
  for (const treeId of ids) {        // ⚠️ 字面 view 端再串行一层
    if (type === 'note') {
      await deleteNote(id);          // ⚠️ 卡在某个大 note → 后面字面静默
    } else {
      await deleteFolder(id);
    }
  }
  // ...
}
```

字面：选 10 个含 1 个大 note → 删大 note 字面卡死 → 其余 9 个字面跟着卡 / 静默。

---

## 2. 必读上下文

### 2.1 项目根 + 分支

- 仓库根：`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
- **实施分支**：`fix/note-batch-delete`（用户预先 checkout）
- 第一步：`cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && pwd && git remote -v | head -1 && git branch --show-current` 三联守门

### 2.2 SurrealDB 字面约束（来自 2026-05-27 诊断）

- **无官方硬上限**，但 RocksDB 单 tx 内存 buffer 全部 write batch
- issue #6327 字面报 2M rows DELETE 让 RocksDB crash
- **官方 best practice**：`DELETE (SELECT id FROM t WHERE ...)` 子查询包一层走索引，比 `DELETE … WHERE …` 快
- `DELETE … RETURN BEFORE` + `array::len()` 字面"删了几条"自校验
- **没有官方 cascade 原语**（RELATE 上才有；本项目字面 `subject.atomId` 字符串外键模式自管）
- 社区范式 = "**pending flag + 分批 + sweeper**" 替代大事务原子性
- `SURREAL_MEMORY_THRESHOLD=2gb` 环境变量（PR #5221 / #5704）字面 OOM 兜底

### 2.3 storage 层字面 API（已字面 verify）

[`src/storage/api.ts`](../../src/storage/api.ts) 字面：
- `storage.transaction(fn)` ✓
- `storage.listEdges({ predicate, objectAtomId })` ✓
- `tx.deleteAtom(id)` — 字面单 atom + 级联 edges
- `tx.deleteEdge(id)`
- **字面没有**：批量删除 / 原生 SQL query / 子查询包装

→ **本期字面要加** storage 层批删 API（详 §3.3）。

### 2.4 5B Stage 9 测试基线字面位置

[`tests/`](../../tests/) 字面 5B Stage 9 落地了 vitest 5 单元 + 5 场景 + 1 bench。**测试字面跑 in-memory mock storage**，**没测 deleteNote**。本期可加测试，**但优先字面修 bug** — 加测试**留 §4 验收**判断是否在本期范围。

---

## 3. 任务（按 Step 1-6 顺序）

### Step 1：storage 层加 `bulkDeleteAtoms(ids: string[])` API

#### 3.1 [`src/storage/api.ts`](../../src/storage/api.ts) 加 interface

在 `StorageAPI` 字面加：

```ts
/**
 * 批量删除 atom + 级联 edges (字面单 query 走 SurrealDB 子查询).
 *
 * 2026-05-29 fix/note-batch-delete: 替代 N 次串行 deleteAtom 单事务卡死.
 *
 * 字面契约:
 *  - 单 SQL query (DELETE atom WHERE id IN $ids + DELETE edge WHERE subject/object IN $ids)
 *  - 不在 StorageAPI.transaction 内调用 (本 API 字面起独立 small tx)
 *  - 返回 { atoms: number; edges: number } 字面实删数 (用 RETURN BEFORE 字面统计)
 *  - ids 字面**不超过 1000** (caller 字面分批);若超过字面 throw
 */
bulkDeleteAtoms(ids: string[]): Promise<{ atoms: number; edges: number }>;
```

#### 3.2 [`src/storage/surreal/storage.ts`](../../src/storage/surreal/storage.ts) 字面实现

字面位置：找现有 `deleteAtom` 方法附近（line ~148）字面加：

```ts
async bulkDeleteAtoms(ids: string[]): Promise<{ atoms: number; edges: number }> {
  if (ids.length > 1000) {
    throw new Error(
      `[storage.bulkDeleteAtoms] batch size ${ids.length} > 1000;` +
        `caller must chunk (avoid RocksDB write batch overflow)`,
    );
  }
  if (ids.length === 0) return { atoms: 0, edges: 0 };

  const db = getDB();
  const atomRids = ids.map((id) => atomRid(id));

  // 字面 step 1: 删 edges (subject/object 任一在 ids 内的)
  // SurrealDB 字面要求子查询走索引 (decision 026 §3.x 字面 cardinality check 用 atom_id 索引,
  // 字面 verify 是否有 edge.subject.atomId / edge.object.atomId 索引;若无 grep migration 文件
  // 看是否需在 migration 加).
  const edgeRes = await db.query<[Array<unknown>]>(
    `DELETE (SELECT id FROM edge
       WHERE subject.atomId IN $ids
          OR object.atomId IN $ids)
     RETURN BEFORE`,
    { ids },
  );
  const edgeCount = edgeRes[0]?.length ?? 0;

  // 字面 step 2: 删 atoms
  const atomRes = await db.query<[Array<unknown>]>(
    `DELETE $rids RETURN BEFORE`,
    { rids: atomRids },
  );
  const atomCount = atomRes[0]?.length ?? 0;

  return { atoms: atomCount, edges: edgeCount };
}
```

**字面验证**（subagent 必须字面 verify）：
- `subject.atomId` 字面是 SurrealDB 里 edge 字段名（grep migration 文件 + storage.ts 字面看现有 query 形态）
- `IN` 操作字面 SurrealDB 字面支持（看现有 query 字面用法）
- `$rids` 多 rid 字面 DELETE 字面 SurrealDB 字面支持（现有 deleteAtom 字面用 `DELETE $rid` 单个；多个字面需 verify SurrealDB 行为）

字面如果**发现 SurrealDB 不支持 `DELETE $rids` 多 rid 形态**：字面降级为 `DELETE atom WHERE id IN $rids`。在汇报里登记字面用了哪种语法。

#### 3.3 [`src/storage/index.ts`](../../src/storage/index.ts) export

字面把 `bulkDeleteAtoms` 字面加到 `surrealStorage` 导出（如果字面 storage 单例字面是字面用 spread / 字面手列方法 — grep 字面确认）。

### Step 2：deleteNote 重写为分批 + pending flag

#### 3.4 [`src/platform/main/note/capability-impl.ts:493-523`](../../src/platform/main/note/capability-impl.ts) 字面**整段重写**

```ts
const DELETE_BATCH_SIZE = 1000;

/**
 * 删除 note container + 所有 block atoms (5B + 2026-05-29 batch fix).
 *
 * 字面策略 (project-delete-note-batch-plan):
 *  1. 标 container.payload.deletionPending = true (小 tx)
 *  2. 分批 (每批 1000) bulkDeleteAtoms,每批独立 tx
 *  3. 删 container 自身 (小 tx)
 *
 * 字面意图: 6100 块 note 字面拆 7 批 × 1000 + 1 收尾批,字面避免 RocksDB write
 * batch overflow / SDK 卡死.
 *
 * 字面崩溃恢复:
 *  - 步骤 1 后 app crash → 重启 sweepPendingDeletions() 字面续命扫
 *    container.payload.deletionPending=true 字面续删
 *  - 步骤 2 中 app crash → 同上,字面残余 block atom 字面被 sweeper 拾遗
 */
export async function deleteNote(id: string): Promise<{ cascadedEdges: number }> {
  // 字面: hasBeenReferenced 字面 fallback 同原 (2026-05-29 不动 single-ref 策略)
  const atom = await storage.getAtom<'pm'>(id);
  if (atom?.hasBeenReferenced === true) {
    console.error(
      `[noteCapability.deleteNote] pm atom ${id} hasBeenReferenced=true ` +
        `not supported in sub-phase 3a-2.5 (single-ref mode); ` +
        `falling back to draft branch (will cascade delete pm atom).`,
    );
  }
  if (!atom) {
    return { cascadedEdges: 0 };  // 字面 idempotent (已删 / 不存在)
  }

  // Step 1: 标 deletionPending (小 tx, 字面瞬秒)
  await storage.transaction(async (tx) => {
    await tx.putAtom<'pm'>({
      id,
      payload: {
        domain: 'pm',
        payload: {
          ...atom.payload.payload,
          attrs: {
            ...((atom.payload.payload as { attrs?: Record<string, unknown> }).attrs ?? {}),
            deletionPending: true,
          },
        },
      },
    });
  });

  let totalCascadedEdges = 0;
  let totalDeletedAtoms = 0;

  // Step 2: 分批删 block atoms
  while (true) {
    // 字面拉一批 (1000) belongsToNote 边
    const belongsEdges = await storage.listEdges({
      predicate: BELONGS_TO_NOTE_PREDICATE,
      objectAtomId: id,
      limit: DELETE_BATCH_SIZE,
    });
    if (belongsEdges.length === 0) break;

    const batchIds = belongsEdges.map((e) => e.subject.atomId);
    const res = await storage.bulkDeleteAtoms(batchIds);
    totalCascadedEdges += res.edges;
    totalDeletedAtoms += res.atoms;

    // 字面 sanity: 实删数 应该 ≈ batchIds.length (差异字面 warn 但不 throw)
    if (res.atoms !== batchIds.length) {
      console.warn(
        `[deleteNote] batch mismatch: requested ${batchIds.length} got ${res.atoms} (id=${id.slice(-8)})`,
      );
    }

    console.log(
      `[deleteNote] batch removed ${res.atoms} atoms + ${res.edges} edges ` +
        `(id=${id.slice(-8)}, total=${totalDeletedAtoms} atoms)`,
    );

    // 字面: 如果一批 < BATCH_SIZE 字面剩余字面 < BATCH_SIZE,下次 listEdges 字面拉到 0 → 退出.
    if (belongsEdges.length < DELETE_BATCH_SIZE) break;
  }

  // Step 3: 删 container 自身 (小 tx,级联自己的 hasNoteView / inFolder 边)
  await storage.transaction(async (tx) => {
    const containerRes = await tx.deleteAtom(id);
    totalCascadedEdges += containerRes.cascadedEdges;
  });

  pmDocCache.invalidate(id);

  console.log(
    `[deleteNote] DONE id=${id.slice(-8)} atoms=${totalDeletedAtoms} edges=${totalCascadedEdges}`,
  );
  return { cascadedEdges: totalCascadedEdges };
}
```

**字面注意**：
- `storage.listEdges` 字面字段 `limit` 字面 verify 是否在 `EdgeFilter` 字面支持 — 字面 grep `interface EdgeFilter`
- 如果**字面没 limit 字段**：字面要 (a) 加 EdgeFilter.limit 字段（storage 层小改）+ (b) surreal 实现字面加 `LIMIT $limit` 子句。grep `EdgeFilter` 看字面用法 — 应该字面已有 `limit` 字段（看 `AtomFilter` 字面同款）。

### Step 3：sweepPendingDeletions 启动期续命

#### 3.5 同文件**新增** `sweepPendingDeletions()`

```ts
/**
 * 启动期续命删除 (project-delete-note-batch-plan).
 *
 * 字面扫所有 pm container 字面 attrs.deletionPending=true,字面续删.
 * 字面应在 storage init 完成后字面调一次 (main 启动期).
 */
export async function sweepPendingDeletions(): Promise<void> {
  const atoms = await storage.listAtoms({ domain: 'pm' as const });
  const pending = atoms.filter((a) => {
    const payload = a.payload.payload as { attrs?: { deletionPending?: boolean } };
    return payload.attrs?.deletionPending === true;
  });

  if (pending.length === 0) return;

  console.warn(
    `[sweepPendingDeletions] found ${pending.length} pending note(s), resuming delete`,
  );

  for (const atom of pending) {
    try {
      const res = await deleteNote(atom.id);
      console.log(
        `[sweepPendingDeletions] resumed id=${atom.id.slice(-8)} cascadedEdges=${res.cascadedEdges}`,
      );
    } catch (err) {
      console.error(
        `[sweepPendingDeletions] failed id=${atom.id.slice(-8)}:`,
        err,
      );
    }
  }
}
```

#### 3.6 main 启动期字面调

文件：grep `runMigration023IfNeeded\|initSurrealDB` 字面找 main 启动序列字面位置（应该在 [`src/platform/main/index.ts`](../../src/platform/main/index.ts) 字面）。

在 storage init + 023 migration 之后字面加：

```ts
import { sweepPendingDeletions } from '@platform/main/note/capability-impl';

// ... 现有 init 序列 ...
await runMigration023IfNeeded();
await sweepPendingDeletions();  // 字面续命扫
```

### Step 4：deleteFolder 同款分批

#### 3.7 [`src/platform/main/folder/capability-impl.ts:210-239`](../../src/platform/main/folder/capability-impl.ts) 重写

字面策略：folder 字面**也分批**，但 folder 字面 atom 数字面通常远小于 note block atom 数（一个 folder 字面装 10-100 个 note）。**字面只需把"删每个 note"换成调 `deleteNote` 而不是 `tx.deleteAtom`**：

```ts
export async function deleteFolder(id: string): Promise<{
  deletedFolders: number;
  deletedResources: number;
  cascadedEdges: number;
}> {
  // 字面 step 1: 收集 (字面快, 不动)
  const allFolderIds = await storage.transaction(async (tx) =>
    collectFolderSubtree(tx, id),
  );
  const allResourceIds = await storage.transaction(async (tx) =>
    collectResourcesInFolders(tx, allFolderIds),
  );

  // 字面 step 2: 逐个删 resource (note → 走 deleteNote 字面分批; graph-canvas/thought →
  //              字面单 atom 删,沿用原 tx.deleteAtom)
  let totalCascadedEdges = 0;
  for (const resourceId of allResourceIds) {
    const atom = await storage.getAtom(resourceId);
    if (!atom) continue;
    if (atom.payload.domain === 'pm') {
      // 字面走 deleteNote 分批
      const res = await deleteNote(resourceId);
      totalCascadedEdges += res.cascadedEdges;
    } else {
      // graph-canvas / thought 字面单 atom 直删
      await storage.transaction(async (tx) => {
        const res = await tx.deleteAtom(resourceId);
        totalCascadedEdges += res.cascadedEdges;
      });
    }
  }

  // 字面 step 3: 删 folder atoms (字面小,单事务 OK)
  await storage.transaction(async (tx) => {
    for (const folderId of allFolderIds) {
      const res = await tx.deleteAtom(folderId);
      totalCascadedEdges += res.cascadedEdges;
    }
  });

  return {
    deletedFolders: allFolderIds.length,
    deletedResources: allResourceIds.length,
    cascadedEdges: totalCascadedEdges,
  };
}
```

**字面注意**：`collectFolderSubtree` / `collectResourcesInFolders` 字面**接受 tx 参数**（看签名 `tx: StorageTransaction`）。字面如果传 `tx` 字面不动这两个函数。如果字面需要 storage 级版本 — grep 字面看是否能直接走 `storage.listEdges`（应该可以，因为 `collectFolderSubtree` 内部字面调 `storage.listEdges` 不是 `tx.listEdges`）。

### Step 5：deleteSelected 不动 view 端

[`src/views/note/tree-operations.ts:99-131`](../../src/views/note/tree-operations.ts) 字面**不动**。view 端字面继续 `for` 串行调 `deleteNote` / `deleteFolder`，**但因为 deleteNote 字面分批 + 每批小 tx + console.log 字面打字面进度** — view 字面**就算**没 UI 也字面**有 console 字面观察**（用户字面打开 DevTools 字面可见，开发者字面诊断字面够用）。

UI 字面进度可视化字面**留下个 sub-phase**（参考 `docs/tasks/2026-05-29-import-progress-ux-prompt.md` 模式）。

### Step 6：测试

#### 6.1 V1 typecheck 0 错

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "src/main/ipc/handlers.ts\|src/renderer/shell/WorkspaceBar.tsx"
```

期望 0 行。

#### 6.2 V2 现有测试 0 fail

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npm run test
```

期望全 PASS。**特别字面注意**：5B Stage 9 测试字面**没测 deleteNote**，所以字面本期改动字面**不应该**让测试挂。如挂，字面修复 storage mock（让 mock 字面也实现 `bulkDeleteAtoms`）— 字面**这字面是允许的**（mock 字面跟 API 同步）。

#### 6.3 V3 手动 npm start 验证（核心字面）

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npm start
```

字面操作：

**场景 A 小 note**：
1. 新建 note，写几段
2. 删除 → 字面瞬秒，NavSide 字面立刻刷

**场景 B 中 note（手动构造 200 块）**：
1. 新建 note，字面手动加 200 个 paragraph（或字面 markdown import 一个 200 段文件）
2. 删除 → 字面看 main terminal log:
   - 字面应字面看到 1 批 `batch removed 200 atoms + ... edges`
   - 字面 NavSide 字面 1-2 秒内字面刷

**场景 C 大 note（手动构造 2500 块）**：
1. 字面 markdown import 一个 2500 段文件
2. 删除 → 字面看 main terminal log：
   - 字面应字面看到 3 批：1000 + 1000 + 500 = 2500
   - 字面每批 < 5 秒 完成
   - 字面 NavSide 字面 15 秒内字面刷
   - 字面**整个过程 UI 不字面卡死**

**场景 D batch select 删除**：
1. NavSide 字面多选 3 个 note（含小、中、大各一）
2. Cmd+Delete / 字面右键删
3. 字面观察：3 个 note 字面顺序删，每个字面分批走，**字面 UI 全程不字面卡死**

**场景 E sweep 续命**：
1. 字面 import 一个大 note
2. 字面点删 → 字面在 deletionPending 标了之后，**手动 Cmd+Q 杀 app**
3. 字面重启 → main terminal log 字面应字面看到 `[sweepPendingDeletions] found 1 pending note(s), resuming delete`
4. 字面续命字面完成，NavSide 字面少那个 note

**场景 F folder 字面删除**：
1. 字面创建一个 folder，字面塞 5 个 note 进去
2. 字面右键删 folder
3. 字面 confirm → 字面观察：5 个 note 字面依次走 `deleteNote` 分批路径 + folder 自身字面删

### Step 7：完成标准

完成全部 Step 1-6 + V1-V3 验收 PASS 后，**拆 3 commit**：

- **commit a**：storage 层 — api.ts + storage.ts 字面加 `bulkDeleteAtoms`
- **commit b**：note capability — deleteNote 字面分批 + sweepPendingDeletions + main 启动期 hook
- **commit c**：folder capability — deleteFolder 字面用 deleteNote 走每个 note

每段 commit 前 V1 typecheck 必须 0 错。如 sandbox 拦 tsc / git，**停手汇报让总指挥介入**。

- **不要** push
- **不要** merge 到 main
- 不要 commit `docs/tasks/import-progress-ui-prompt.md` 等老 untracked
- **可以** commit 本 prompt 文档 `docs/tasks/2026-05-29-delete-batch-fix-prompt.md`（与 commit a 同 commit）

---

## 4. 操作纪律（违反任意一条立刻停手报告）

### 4.1 cwd 漂移防御

V2 cwd 漂移已 16 次事故。每条 Bash 都必须 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`。Read/Edit/Write 一律绝对路径。

三联守门：

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && pwd && git remote -v | head -1 && git branch --show-current
```

V1 / V2 速判：
- V1 顶层有 `src/main/` / `src/renderer/` / `src/plugins/`
- V2 顶层有 `src/platform/main/` / `src/views/` / `src/capabilities/` / `src/drivers/` / `src/storage/` / `src/semantic/`
- V1 main hash `47015ed8` / V2.git URL 字面 `KRIG-Note-V2.git`

### 4.2 sandbox 限制（已知）

harness 可能拦 `tsc` / `git add` / `git commit` / `npm run test` / `npm start`。**遇拦截不走 `--dangerouslyDisableSandbox`**，停手汇报让总指挥介入。

### 4.3 严格实施纪律

**可以**：
- 改 [`src/storage/api.ts`](../../src/storage/api.ts) + [`src/storage/surreal/storage.ts`](../../src/storage/surreal/storage.ts) + [`src/storage/index.ts`](../../src/storage/index.ts)（storage 层加 bulkDeleteAtoms）
- 改 [`src/platform/main/note/capability-impl.ts`](../../src/platform/main/note/capability-impl.ts)（deleteNote 重写 + sweepPendingDeletions 新增）
- 改 [`src/platform/main/folder/capability-impl.ts`](../../src/platform/main/folder/capability-impl.ts)（deleteFolder 改走 deleteNote per note）
- 改 [`src/platform/main/index.ts`](../../src/platform/main/index.ts) 启动序列字面加 `sweepPendingDeletions()` 调用
- 改 [`tests/mocks/storage-mock.ts`](../../tests/mocks/storage-mock.ts) 加 `bulkDeleteAtoms` mock（不破现有测试用）
- 跑 `npx tsc` / `npm run test` / `npm start` 验证

**严禁**：
- ❌ 改 [`tests/`](../../tests/) 字面 5 单元/5 场景/1 bench 字面测试（5B Stage 9 基线）
- ❌ 改 [`src/views/`](../../src/views/) 字面 view 端任何文件（deleteSelected 字面不动；UI 进度字面留下个 sub-phase）
- ❌ 改 [`src/shell/global-progress-overlay/`](../../src/shell/global-progress-overlay/)（本期不动 UX）
- ❌ 切其它分支 / merge / push / docs/（除本 prompt 文档外）
- ❌ 操作数据库 / 跑 migration（**字面警告**：不要试图字面"加 index 提速"— memory §可选 字面提到的 `DEFINE INDEX atom_deletion_pending` 字面**留独立 sub-phase**，本期字面不动 migration）

### 4.4 完成标准

- V1-V3 验收全部 PASS（V3 手动跑 6 场景）
- 3 个 commit 在 `fix/note-batch-delete` 分支
- 用户字面**能**删 1000+ 块大 note 字面不卡死

完成后向调用方汇报：
- 3 个 commit hash + 改动文件清单（应字面是 6 个 src 文件 + 1 prompt 文档）
- V1-V3 各项验收结果（含 V3 6 场景**每个**字面 PASS/FAIL + main terminal log 关键行）
- 任何 SurrealDB 字面 SQL 语法字面 verify 时的偏离（如 `DELETE $rids` 多 rid 字面降级为 `WHERE IN` 等）
- 是否字面需要后续 sub-phase（UI 进度可视化 / index 加速 / SURREAL_MEMORY_THRESHOLD 字面环境变量等）

---

## 5. Agent 配置建议（给调用方）

- **agent 类型**：`general-purpose`
- **后台运行**：可后台。完成时通知
- **预期工作时间**：2-3 小时（storage API 新增 + 2 capability 改写 + main 启动期 hook + 6 场景手动验证）

---

## 6. 已知风险

1. **SurrealDB DELETE 多 rid 字面行为**：subagent 字面 verify `DELETE $rids RETURN BEFORE` 字面是否被 SurrealDB 字面接受。如不接受 → 字面降级为 `DELETE atom WHERE id IN $ids`。

2. **edge 字段路径字面**：`subject.atomId` 字面是 SurrealDB schema 字面字段名？字面 grep [`src/storage/migrations/`](../../src/storage/migrations/) + 现有 query 字面用法字面 verify。如果字段名字面是 `subject_atom_id` 字面或别的字面形式 — 字面相应调整。

3. **EdgeFilter.limit 字段**：字面如果字面没有 — Step 2 字面 `while (true) listEdges({limit: 1000})` 字面会拉全部 → 字面退化为原 bug。字面 grep `interface EdgeFilter` 字面确认 — 如果字面缺 limit，**字面在 EdgeFilter 字面加 `limit?: number` + storage.ts 字面接 LIMIT 子句**。

4. **sweepPendingDeletions 字面并发**：字面 main 启动期字面**串行**调（for of），字面避免字面多 sweep 字面同时跑。

5. **deletionPending 字面冲突**：如果用户字面在 deleteNote 调用过程中字面**又触发 listNotes 字面拉到 deletionPending=true 字面 note** — listNotes 字面应**过滤这些**（NavSide 字面不显示"正在删的"）。字面 grep [`src/platform/main/note/capability-impl.ts`](../../src/platform/main/note/capability-impl.ts) 字面 `export async function listNotes` 字面看是否字面 filter — 如果没 filter，**字面加 filter**（一行 .filter 字面够）。

6. **测试 mock 字面 bulkDeleteAtoms**：字面 [`tests/mocks/storage-mock.ts`](../../tests/mocks/storage-mock.ts) 字面要加 mock 实现 — 字面看 `tests/mocks/storage-mock.ts:281` 字面已有 `deleteAtom`，字面同款加 bulkDeleteAtoms 即可。

---

*deleteNote/deleteFolder batch fix sub-phase · 2026-05-29 · self-contained · 用户拍板：先修 bug, UX 进度留下一 sub-phase*
