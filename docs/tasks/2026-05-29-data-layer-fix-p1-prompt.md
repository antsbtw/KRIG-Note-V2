# Data Layer Fix PR B (P1) — listMarkerAtoms + applyDiff 重写 + folder broadcast 收敛 — Prompt

> 这份 prompt 给新会话执行。直接把整份文档作为 user message 发给新对话即可。
> Self-contained — 新对话没有 5B / audit / PR A 上下文。

---

## 0. 你的身份 + 总目标

你是 KRIG-Note V2 的**实施工程师**。本次任务是修复 audit 报告 P1 全部反模式。

### 0.1 背景（极简）

V2 有 47 处 `storage.list*` 调用、12 处反模式。PR A 已完成 P0（filter 字段扩展 + caller migration，commit `609b0a63` 在 main）。PR B 是 P1（高层 API + applyDiff 重写 + broadcast 收敛）。

PR A 已实施的字段：
- `EdgeFilter.subjectAtomIds?: string[]` / `objectAtomIds?: string[]` / `objectLiteral?: { type, value }`
- `AtomFilter.atomIds?: string[]`
- SurrealDB SQL 用 `INSIDE` 不是 `IN`（关键陷阱，新代码沿用）

**Audit 报告**：[`docs/tasks/2026-05-29-data-layer-audit-report.md`](../../docs/tasks/2026-05-29-data-layer-audit-report.md)，commit `006b500f`，在 `docs/data-layer-audit` 分支。

### 0.2 本期产出（PR B 范围）

3 项改动，1 个 PR：

| 项 | 反模式来源 | 复杂度 |
|---|---|---|
| **P1-1**：storage 新增 `listMarkerAtoms({ domain, markerPredicate })` 高层 API | audit B2（#3/#6/#9）+ §5.6 三处 | s |
| **P1-2**：`applyDiff` removedEdges 改批量 lookup | audit B5 #2（`note/capability-impl.ts:134`）| xs |
| **P1-3**：`broadcastFolderListChanged` 4 viewType → 1 次 listAtoms | audit §5.4（`folder/handlers.ts:38-43`）| xs |

**预期收益**：
- listNotes/listNoteTitles 拉 101k 行 → 1k 行（冷启动再 -5s ~ -10s）
- 删 6100 块 N 次 listEdges → 1 次（与 PR C 分批 deleteAtom 联动可降到 ~3-5s）
- folder 写操作后 broadcast 12 次 storage call → 3 次（快 4×）

**Agent 类型**：`general-purpose`（不是 Plan — Plan 没 Write/Edit）

---

## 1. 必读上下文

### 1.1 项目根 + 分支

- 仓库根：`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
- **实施分支**：`fix/data-layer-p1`（用户预先 checkout，从 main）
- 第一步：`cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && pwd && git remote -v | head -1 && git branch --show-current` 三联守门

### 1.2 PR A 已落地的可用工具

`EdgeFilter` 新字段：
```ts
subjectAtomIds?: string[];
objectAtomIds?: string[];
objectLiteral?: { type: string; value: unknown };
```

`AtomFilter` 新字段：
```ts
atomIds?: string[];
```

PR A 已实施的 SQL 模板（grep `INSIDE` in `src/storage/surreal/storage.ts` 看现成套路）：
```sql
WHERE subject.atomId INSIDE $subjectAtomIds
WHERE id INSIDE $atomRids
WHERE object.kind = 'literal' AND object.type = $type AND object.value = $value
```

互斥规则：单 id 字段（`subjectAtomId`）与批量字段（`subjectAtomIds`）同时传 throw。新 API 沿同款。

### 1.3 P1-1: `listMarkerAtoms` API 设计

#### 问题描述

`note/capability-impl.ts:291` (`listNotes`)：
```ts
const atoms = await storage.listAtoms({ domain: NOTE_DOMAIN });
// 拉 ~101000 行 (1 note container + ~100 block × 1000 notes)
const noteViewEdges = await storage.listEdges({ predicate: HAS_NOTE_VIEW_PREDICATE });
const noteAtomIds = new Set(noteViewEdges.map((e) => e.subject.atomId));
const noteAtoms = atoms.filter((a) => noteAtomIds.has(a.id));
// 只为 ~1000 个 note container
```

`note/capability-impl.ts:351` (`listNoteTitles`) + `:370` 同款。
`folder/capability-impl.ts:105` 同款（`folder` domain + `folderForView` 边）。
`migration/023:68` 同款（启动期）。

#### API 形态

新建 `storage.listMarkerAtoms<D>({ domain, markerPredicate, markerObjectMatch? })`：

```ts
/**
 * 按 marker 边过滤的 atom 查询。
 *
 * 字面语义：拉出所有同时满足以下条件的 atom：
 *  - atom.payload.domain === domain
 *  - 存在一条 edge：subject = atom.id, predicate = markerPredicate
 *  - (可选) edge.object 匹配 markerObjectMatch
 *
 * 字面比"listAtoms({domain}) + listEdges({predicate}) + Set.has filter"快得多 —
 * SQL 走 JOIN/IN-subquery，只返回需要的 atom，不返 N × M 个 block atom。
 *
 * 字面用例：
 *  - listNotes：marker = 'user:krig:hasNoteView'，object = literal true
 *  - listNoteTitles：同上
 *  - listFolders(viewType)：marker = 'user:krig:folderForView'，object = literal viewType
 */
listMarkerAtoms<D extends AtomDomain = AtomDomain>(opts: {
  domain: D;
  markerPredicate: EdgePredicate;
  markerObjectMatch?: { type: string; value: unknown } | { atomId: string };
}): Promise<AtomEntity<D>[]>;
```

#### SQL 实现策略

字面两种写法，二选一（subagent 自决，在汇报里说明选哪个 + 理由）：

**写法 A：INSIDE subquery**
```sql
SELECT * FROM atom
WHERE domain = $domain
  AND id INSIDE (
    SELECT VALUE subject.atomId FROM edge
    WHERE predicate = $marker
      AND object.kind = 'literal' AND object.type = $litType AND object.value = $litValue
  )
ORDER BY createdAt DESC
```

**写法 B：JOIN（如果 SurrealDB 支持）**
```sql
SELECT atom.* FROM atom, edge
WHERE atom.id = edge.subject.atomId
  AND atom.domain = $domain
  AND edge.predicate = $marker
  AND edge.object... 
```

SurrealDB 字面更原生支持 graph traversal（`->predicate->target`）但 V2 edge schema 是字符串外键（subject.atomId 字段），所以 JOIN 形态更可能走通。**写法 A 字面更稳**（用已 verify 的 INSIDE 语义），如果性能不够再考虑 B。

### 1.4 P1-2: applyDiff removedEdges 重写

#### 问题描述

`note/capability-impl.ts:131-141` (`applyDiff` 函数内)：
```ts
for (const e of diff.removedEdges) {
  const found = await storage.listEdges({
    predicate: e.predicate,
    subjectAtomId: e.subjectId,
    objectAtomId: e.objectId,
  });
  if (found.length > 0) {
    await tx.deleteEdge(found[0].id);
  }
}
```

字面 N 条 removedEdge = N 次 listEdges。删 6100 块 note 时 N ≈ 18000，全跑串行。

#### 修法 — 字面有两个选择

**选项 A（推荐，最简）**：用 PR A 已加的 `subjectAtomIds`/`objectAtomIds` 字段一次拉所有候选 edges，应用层 dedupe 后批量 deleteEdge：

```ts
// 字面按 predicate 分组（不同 predicate 不能合并查）
const byPredicate = new Map<string, BlockDiff['removedEdges']>();
for (const e of diff.removedEdges) {
  if (!byPredicate.has(e.predicate)) byPredicate.set(e.predicate, []);
  byPredicate.get(e.predicate)!.push(e);
}

for (const [predicate, removals] of byPredicate) {
  const subjectIds = removals.map((r) => r.subjectId);
  const objectIds = removals.map((r) => r.objectId);

  // 1 次拉所有候选 edges（同 predicate + subjectIds + objectIds）
  const candidates = await storage.listEdges({
    predicate,
    subjectAtomIds: subjectIds,
    objectAtomIds: objectIds,
  });

  // 字面应用层匹配（subject, object pair）
  const wanted = new Set(removals.map((r) => `${r.subjectId}|${r.objectId}`));
  for (const edge of candidates) {
    if (edge.object.kind !== 'atom') continue;
    const key = `${edge.subject.atomId}|${edge.object.atomId}`;
    if (wanted.has(key)) {
      await tx.deleteEdge(edge.id);
    }
  }
}
```

**选项 B（彻底修）**：BlockDiff schema 加 `edgeId` 字段（diff 算时已知 edgeId，dissect 阶段可记下来），直接 `tx.deleteEdge(edgeId)`：

- 优点：1 次 lookup → 0 次（diff 自带 edgeId）
- 缺点：需改 `BlockDiff` schema + 改 dissect 写边时记录 edgeId + 改 diff 算法

→ **本期选 A**。B 留 future（需要重构 BlockDiff schema）。

### 1.5 P1-3: broadcastFolderListChanged 收敛

#### 问题描述

`folder/handlers.ts:38-43`：
```ts
const [noteFolders, graphFolders, ebookFolders, thoughtFolders] = await Promise.all([
  listFolders('note'),
  listFolders('graph'),
  listFolders('ebook'),
  listFolders('thought'),
]);
// broadcast 4 个独立 list 到 renderer
```

每个 `listFolders(viewType)` 调用字面跑 3 次 storage call（listAtoms + listEdges × 2），总 12 次/broadcast。

#### 修法

抽 `listAllFoldersGroupedByView()` 一次拉全集 + 内存切分：

**步骤**：
1. 1 次 `listAtoms({ domain: 'folder' })` 拿所有 folder atoms（量小，~50-200）
2. 1 次 `listEdges({ predicate: FOLDER_FOR_VIEW_PREDICATE })` 拿所有 view marker（同量级）
3. 1 次 `listEdges({ predicate: IN_FOLDER_PREDICATE, subjectAtomIds: folderIds })` 拿 folder 间 parent 关系（用 PR A 字段）
4. 内存按 viewType 分 4 组

总 storage call：3 次（vs 12 次）。

字面新增函数放 `folder/capability-impl.ts`，`folder/handlers.ts:38-43` 改用新函数。

**注意**：`listFolders(viewType)` 是 capability 公开 API，**不删**（其它 caller 可能在用，先 grep confirm）。新函数 `listAllFoldersGroupedByView()` 仅为 broadcast 优化。

---

## 2. 任务（按 Step 1-7 顺序）

### Step 1: 提取 audit 报告 + 读关键段

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && git show docs/data-layer-audit:docs/tasks/2026-05-29-data-layer-audit-report.md > /tmp/audit-report.md && wc -l /tmp/audit-report.md
```

Read `/tmp/audit-report.md`，**只读以下段**（不要全文）：
- §〇 Executive Summary
- §一 1.1 note 模块（找 #3 / #6 / #9 / #34 / #2 detail）
- §二 B2（listAtoms 内存 filter 反模式）
- §二 B5（其它反模式）
- §三 P1-1 / P1-2 详细
- §五.4（folder broadcast 4× 冗余）
- §五.6（listAtoms 走 in-memory filter 3 处）

### Step 2: 实施 P1-1 — listMarkerAtoms

#### 2.1 在 `src/storage/api.ts` 加 API 签名

按 §1.3 字面 API 形态加到 `StorageAPI` interface。

#### 2.2 在 `src/storage/surreal/storage.ts` 实施

字面用 SQL 写法 A（INSIDE subquery）。

verify 项：
- `markerObjectMatch` 字段支持两种形态（literal 或 atomId），两种 SQL 不同
- 不传 `markerObjectMatch` 时 SQL 字面省略 object 字面条件（即"只要有 marker 边就算"）

#### 2.3 在 `tests/mocks/storage-mock.ts` 加 mock 实现

#### 2.4 在 `tests/storage/filter-extensions.test.ts` 加测试

新增 4 cases：
- listMarkerAtoms 基本命中（atom + marker edge 都满足）
- listMarkerAtoms 不带 markerObjectMatch（只要 marker 边存在就算）
- listMarkerAtoms 带 markerObjectMatch literal
- listMarkerAtoms 带 markerObjectMatch atomId

#### 2.5 改 caller

**caller 清单**（audit §一 / §二 B2 + §5.6）：

| 文件:行 | 函数 | 原写法 | 新写法 |
|---|---|---|---|
| `note/capability-impl.ts:291` | `listNotes` | listAtoms + listEdges + filter | `listMarkerAtoms({ domain: 'pm', markerPredicate: HAS_NOTE_VIEW_PREDICATE, markerObjectMatch: { type: 'boolean', value: true } })` |
| `note/capability-impl.ts:351` | `listNoteTitles` | 同上 | 同上 |
| `note/capability-impl.ts:370` | `listNoteTitles` backfill 重拉 | 同上 | 同上 |
| `folder/capability-impl.ts:104-105` | `listFolders(viewType)` | listAtoms + filter | `listMarkerAtoms({ domain: 'folder', markerPredicate: FOLDER_FOR_VIEW, markerObjectMatch: { type: 'string', value: viewType } })` |
| `storage/migrations/023-note-title-cache.ts:65-68` | migration | listAtoms + listEdges + filter | 同 note/capability-impl.ts:291 |

每处改完字面**保留**原 `noteViewEdges`/`folderForViewEdges` 的 listEdges 调用（如果后续逻辑还需要这些 edges，不只是为 filter atom）。**只删 "拉全部 + 内存 filter" 这一步**，不删边集合本身。

### Step 3: 实施 P1-2 — applyDiff removedEdges 重写

按 §1.4 选项 A 修。

文件：`src/platform/main/note/capability-impl.ts:131-141`（在 `applyDiff` 函数内）。

字面 verify：
- diff.removedEdges 字面有 `predicate` / `subjectId` / `objectId` 字段（grep `BlockDiff` schema）
- tx 字面有 `deleteEdge` 方法（看 `StorageTransaction` 接口）

### Step 4: 实施 P1-3 — broadcastFolderListChanged 收敛

#### 4.1 在 `src/platform/main/folder/capability-impl.ts` 新增 `listAllFoldersGroupedByView()`

```ts
export async function listAllFoldersGroupedByView(): Promise<{
  note: FolderInfo[];
  graph: FolderInfo[];
  ebook: FolderInfo[];
  thought: FolderInfo[];
}> {
  // 1 次拉所有 folder atoms
  const atoms = await storage.listAtoms({ domain: FOLDER_DOMAIN });

  // 1 次拉所有 folderForView 边
  const viewEdges = await storage.listEdges({
    predicate: FOLDER_FOR_VIEW_PREDICATE,
  });

  // 字面按 viewType 分组 atom ids
  const idsByView = { note: new Set<string>(), graph: new Set<string>(), ebook: new Set<string>(), thought: new Set<string>() };
  for (const e of viewEdges) {
    if (e.object.kind !== 'literal') continue;
    const viewType = e.object.value as 'note' | 'graph' | 'ebook' | 'thought';
    if (viewType in idsByView) {
      idsByView[viewType].add(e.subject.atomId);
    }
  }

  // 字面拉 parent 关系（用 PR A 字段：folder 间 inFolder 边）
  const folderIds = atoms.map((a) => a.id);
  const parentEdges = folderIds.length > 0
    ? await storage.listEdges({
        predicate: IN_FOLDER_PREDICATE,
        subjectAtomIds: folderIds,
      })
    : [];

  // 字面按 viewType 切分 + 拼 FolderInfo（看现有 listFolders 实现拼装套路）
  // ...
}
```

字面**复用** `listFolders(viewType)` 内部字面拼 FolderInfo 的逻辑（抽 helper 函数共用）。

#### 4.2 改 `src/platform/main/folder/handlers.ts:38-43`

```ts
// 字面原:
const [noteFolders, graphFolders, ebookFolders, thoughtFolders] = await Promise.all([
  listFolders('note'),
  listFolders('graph'),
  listFolders('ebook'),
  listFolders('thought'),
]);

// 字面新:
const grouped = await listAllFoldersGroupedByView();
const noteFolders = grouped.note;
const graphFolders = grouped.graph;
const ebookFolders = grouped.ebook;
const thoughtFolders = grouped.thought;
```

`listFolders(viewType)` 公开 API **保留不动**。

### Step 5: 验收

#### V1: typecheck 0 错

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "src/main/ipc/handlers.ts\|src/renderer/shell/WorkspaceBar.tsx"
```

#### V2: 现有测试 0 fail

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npm run test
```

期望 12 文件 / 50 tests + 新增 4 cases = 54 tests PASS。

#### V3: 新测试 PASS

`filter-extensions.test.ts` 新增 4 cases 全 PASS。

#### V4: caller 改完 grep verify

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -n "listMarkerAtoms" src/platform/main src/storage --include='*.ts' -r
```

期望 ≥ 5 处命中（api.ts 定义 + surreal/storage.ts 实施 + mock + 3-5 处 caller）。

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -n "listAllFoldersGroupedByView" src/platform/main/folder --include='*.ts'
```

期望 ≥ 2 处（定义 + 1 处 handlers.ts caller）。

#### V5: 手动 npm start 验证（核心收益）

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npm start
```

操作：
- 重启 app，**对比 PR A 后的冷启动时间**（PR A 时 661ms）
- 期望：PR B 后字面 < 500ms（listMarkerAtoms 字面省了"拉 ~10000 行 pm atom 再 filter"那段）
- folder 操作（创建/删除 folder）后字面看 main terminal log，应该字面只有 3 次 storage call（vs 修前 12 次）

汇报里**包含**：
- 冷启动 PR A 后 vs PR B 后对比
- folder 操作后 main terminal storage call 次数（如果有 log 的话）

### Step 6: 字面拆 commit

拆 **3 commit**：

- **commit a**：P1-1 storage 层（api.ts + surreal/storage.ts + tests/mocks/storage-mock.ts + 测试新增）
- **commit b**：P1-1 caller migration（note/capability-impl.ts + folder/capability-impl.ts + migrations/023）
- **commit c**：P1-2 + P1-3（applyDiff 重写 + listAllFoldersGroupedByView + handlers 收敛）

**拆 commit 原因**：commit a 是 storage 加 API + 测试（独立可验收）；commit b 是 caller 切换（行为不变只 perf 改）；commit c 是另外两个独立小修。

每段 commit 前 V1 typecheck 必须 0 错。如 sandbox 拦 tsc / git / npm test / npm start，**停手汇报让总指挥介入**。

- **不要** push
- **不要** merge 到 main
- 不要 commit 老 untracked docs
- **可以** commit 本 prompt 文档 `docs/tasks/2026-05-29-data-layer-fix-p1-prompt.md`（与 commit a 同 commit）

---

## 3. 操作纪律（违反任意一条立刻停手报告）

### 3.1 cwd 漂移防御

V2 cwd 漂移已 16 次事故。每条 Bash 都必须 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`。Read/Edit/Write 一律绝对路径。

三联守门：

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && pwd && git remote -v | head -1 && git branch --show-current
```

V1 / V2 速判：
- V1 顶层 `src/main/` / `src/renderer/` / `src/plugins/`
- V2 顶层 `src/platform/main/` / `src/views/` / `src/capabilities/` / `src/drivers/` / `src/storage/` / `src/semantic/`
- V1 main hash `47015ed8` / V2.git URL `KRIG-Note-V2.git`

### 3.2 sandbox 限制

harness 可能拦 `tsc` / `git add` / `git commit` / `npm run test` / `npm start`。**遇拦截不走 `--dangerouslyDisableSandbox`**，停手汇报。

### 3.3 严格实施纪律

**可以**：
- 改 `src/storage/api.ts` + `src/storage/surreal/storage.ts`（加 listMarkerAtoms）
- 改 `src/platform/main/note/capability-impl.ts`（listNotes / listNoteTitles / applyDiff）
- 改 `src/platform/main/folder/capability-impl.ts`（listFolders 内 + 新增 listAllFoldersGroupedByView）
- 改 `src/platform/main/folder/handlers.ts`（broadcastFolderListChanged 内）
- 改 `src/storage/migrations/023-note-title-cache.ts`（同 listNotes 反模式）
- 改 `tests/mocks/storage-mock.ts`（同步新 API）
- 改 `tests/storage/filter-extensions.test.ts`（加 4 新 cases）
- 跑 `npx tsc` / `npm run test` / `npm start`

**严禁**：
- ❌ 改 5B Stage 9 现有测试（已存在测试文件除 filter-extensions.test.ts 外不动）
- ❌ 改 storage 层 SSOT（atom-entity.ts / edge-entity.ts / atom.ts / edge.ts 不动）
- ❌ 改 capability 层 type SSOT（pm-atom-draft.ts / structural.ts 不动）
- ❌ 改 BlockDiff schema 加 edgeId（这是 §1.4 选项 B，本期不动；选 A 简单路径）
- ❌ 改 audit 报告 A 必要 / C 已优化 / D 启动期分类的 caller
- ❌ 删 `listFolders(viewType)` 公开 API（保留兼容其它 caller）
- ❌ 切其它分支 / merge / push / docs/（除本 prompt 文档外）
- ❌ 操作数据库 / 跑 migration
- ❌ 顺手修 audit §五.1 deleteNote 单事务 / 5.2 ebook 雪崩 / 5.3 transaction 外 listEdges / 5.5 findEdge 单点 API 等（PR C 后续 PR 处理）

### 3.4 完成标准

- V1-V5 全部 PASS
- 3 commit 在 `fix/data-layer-p1` 分支
- audit B2 + §5.6 + §5.4 + B5 #2 字面全改完
- 5B Stage 9 现有测试**仍** PASS
- 新增 4 测试 cases PASS

完成后向调用方汇报：
- 3 个 commit hash + 改动文件清单
- V1-V5 各项验收结果（**含 V5 冷启动 PR A vs PR B 对比时间**）
- listMarkerAtoms SQL 写法（A INSIDE subquery / B JOIN）选哪个 + 理由
- audit §5.6 三处是否全改完（migration 023 也要确认）
- 任何 SurrealDB subquery 行为 verify 发现
- audit §五 其它问题在改 caller 过程中发现新表象（**只登记不修**）

---

## 4. Agent 配置建议（给调用方）

- **agent 类型**：`general-purpose`
- **后台运行**：可后台。完成时通知
- **预期工作时间**：2-2.5 小时（listMarkerAtoms 实施 40 分钟 + caller 改 5 处 × 5 分钟 + applyDiff 30 分钟 + folder broadcast 30 分钟 + 测试 + 验收）

---

## 5. PR C / 后续 PR 前瞻（不在本期）

P1 完成后剩余的债（按 audit §五）：

| 项 | 位置 | 描述 |
|---|---|---|
| `deleteNote` 单事务分批 + pending + sweeper | audit §五.1 | 已废 `delete-batch-fix-prompt.md`，重新设计基于 P0+P1 后的世界 |
| ebook list 1000 书并发雪崩 | audit §五.2 | 等真实场景压测确认是否需要修 |
| `storage.listEdges` 在 `storage.transaction` 外被调 | audit §五.3 | 跨事务一致性债，独立 sub-phase |
| `findEdge` 单点 API | audit §五.5 | API 设计建议，不阻塞 |

---

## 6. 已知风险

1. **listMarkerAtoms SQL 写法**：subquery 是新形态，SurrealDB 行为字面 verify。如 INSIDE subquery 不工作，降级为 2-step（先拉 marker edges 拿 atomIds，再 `listAtoms({ atomIds })`）。**降级方案性能不如 1-step，但功能等价**。

2. **markerObjectMatch literal vs atomId 两种 SQL**：literal 走 `object.kind = 'literal' AND object.value = $v`，atomId 走 `object.kind = 'atom' AND object.atomId = $id`。两套 SQL 模板。

3. **broadcastFolderListChanged 的 view 端依赖**：renderer 可能期望 4 个独立 list payload。grep `onFolderListChanged` 看 renderer 接收方，确保 broadcast payload 格式不变。

4. **listFolders(viewType) 公开 API 不删**：grep `listFolders\(` 字面看所有 caller，确认只 broadcast 一处需要 4 viewType，其它 caller 仍传单 viewType（保留单 API）。

5. **migration 023 启动期跑**：改完后 npm start 第一次启动会跑 migration，**验证 migration 仍正常工作**（不破坏现有 backfill）。

6. **冷启动 baseline 661ms 来自小数据规模**：audit baseline 是 1000 篇 × 100 块。用户本地 ~1400 nextSibling + 800 childOf 边，规模相对小。PR B 收益绝对值可能不大（200-300ms），但**反模式根治意义更重要**。

---

*Data Layer Fix P1 sub-phase · 2026-05-29 · self-contained · 用户拍板：选 SQL 写法 A INSIDE subquery / 选 §1.4 选项 A 不改 BlockDiff schema*
