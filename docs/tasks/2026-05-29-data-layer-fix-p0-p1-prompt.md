# Data Layer Fix PR A (P0) — storage API filter 字段扩展 — Prompt

> 这份 prompt 给新会话执行。直接把整份文档作为 user message 发给新对话即可。
> Self-contained — 新对话没有 5B / audit 上下文。

---

## 0. 你的身份 + 总目标

你是 KRIG-Note V2 的**实施工程师**。本次任务是修复 audit 报告 P0 全部反模式。

### 0.1 背景（极简）

V2 有 47 处 `storage.listAtoms` / `storage.listEdges` 调用，**12 处是反模式**（应用层全库扫然后内存 filter）。导致：
- **冷启动 30+ 秒**（NavSide 等所有 note assemble 完才显示）
- **删 6100 块大 note 卡死**
- **批量删除失败**

**Audit 报告**是前置工作：[`docs/tasks/2026-05-29-data-layer-audit-report.md`](../../docs/tasks/2026-05-29-data-layer-audit-report.md)，commit `006b500f`，在 `docs/data-layer-audit` 分支。

**新对话第一件事**：read 该报告的关键段（不要全文读，详 §2 Step 1）。

### 0.2 本期产出（PR A 范围）

| PR | 范围 | 分支 | 预估 |
|---|---|---|---|
| **PR A (本期, P0)** | storage 层 3 个 filter 字段扩展 + caller 改 | `fix/data-layer-p0` | 1.5-2.5 小时 |
| **PR B (下期, P1)** | listMarkerAtoms 高层 API + applyDiff 重写 + folder broadcast 收敛 | `fix/data-layer-p1` | 2-2.5 小时 |

**你只做 PR A**。PR B 在 PR A merge 后另起会话执行。

**Agent 类型**：`general-purpose`（不是 Plan — Plan 没 Write/Edit）

---

## 1. 必读上下文

### 1.1 项目根 + 分支

- 仓库根：`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
- **实施分支**：`fix/data-layer-p0`（用户预先 checkout）
- 第一步：`cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && pwd && git remote -v | head -1 && git branch --show-current` 三联守门

### 1.2 PR A 的 3 项改动（用户已拍板）

#### P0-1: `EdgeFilter` 加 `subjectAtomIds` + `objectAtomIds`

位置：[`src/storage/api.ts`](../../src/storage/api.ts) 的 `EdgeFilter`。

```ts
interface EdgeFilter {
  // 现有字段：
  subjectAtomId?: string;      // 单 id
  objectAtomId?: string;       // 单 id
  // ... 其它

  // 新增（P0-1）：
  subjectAtomIds?: string[];   // 批量（SQL IN）
  objectAtomIds?: string[];    // 批量（SQL IN）
}
```

单 id 字段与批量字段**互斥**（同时传 throw）。

#### P0-2: `AtomFilter` 加 `atomIds`

位置：同上的 `AtomFilter`。

```ts
interface AtomFilter {
  // 现有字段（domain / createdBy / range / limit / offset / orderBy / orderDirection）
  // ...

  // 新增（P0-2）：
  atomIds?: string[];   // 批量（SQL IN）
}
```

**用户已拍板**：**不**加 `getAtomsByIds` 高层 API。cache 应在 capability 层，不在 storage 层。caller 统一用 `storage.listAtoms({ atomIds: [...] })`。

#### P0-3: `EdgeFilter` 加 `objectLiteral`

位置：同上的 `EdgeFilter`。

```ts
interface EdgeFilter {
  // ... 现有 + P0-1 新增 ...

  // 新增（P0-3）：folder list view 路径专用 — 按 literal value 过滤
  objectLiteral?: { type: string; value: unknown };
}
```

具体场景：[`folder/capability-impl.ts`](../../src/platform/main/folder/capability-impl.ts) 的 `listFolders(viewType)`。详 audit 报告 §三 P0-3。

### 1.3 SurrealDB SQL IN 写法

[`src/storage/surreal/storage.ts`](../../src/storage/surreal/storage.ts) 现有 `WHERE x = $val` 模板。

SurrealDB 支持：
```sql
SELECT * FROM atom WHERE id IN $rids
```

但 `$rids` 必须是 SurrealDB Thing[]（不是 string[]）。grep 现有 `atomRid(id)` helper 看套路。

SurrealDB 对 IN array 大小无硬上限，但 RocksDB write batch overflow 是写场景的限制。filter 是读，IN array 5000 以内安全。本 PR caller 通常 << 1000，不需要处理上限。

### 1.4 caller 改动清单（按 audit §二 反模式分组）

**权威来源**：audit 报告 §二 B1/B2/B3/B4 分组列出了**每一处** caller 的 file:line。逐一对照改，不漏不增。

主对话识别出的 top 3（优先确认这 3 处）：

| 文件 | 行号 | 现状 | 改为 |
|---|---|---|---|
| [`assemble-pm-doc.ts`](../../src/platform/main/note/assemble-pm-doc.ts) | 220 | `listEdges({ predicate: NEXT_SIBLING_PREDICATE })` | `listEdges({ predicate: NEXT_SIBLING_PREDICATE, subjectAtomIds: blockIds })` |
| 同上 | 221 | `listEdges({ predicate: CHILD_OF_PREDICATE })` | `listEdges({ predicate: CHILD_OF_PREDICATE, subjectAtomIds: blockIds })` |
| 同上 | 209 | `Promise.all(blockIds.map((id) => storage.getAtom<'pm'>(id)))` | `storage.listAtoms({ domain: 'pm', atomIds: blockIds })` + 构造 Map |

其余 caller（B1/B2/B3/B4 分组共 12 处）按 audit 报告对照改。

**纪律**：只改 audit 报告 §二 B 分类的 caller。**不改** A 必要 / C 已优化 / D 启动期分类。

### 1.5 已知坑

1. **EdgeFilter 单 id vs 批量 id 互斥**：同时传 `subjectAtomId` + `subjectAtomIds` 应 throw（或归一化为 `[subjectAtomId]` — 二选一，在汇报里登记选哪个）。

2. **空 array 的语义**：`listEdges({ subjectAtomIds: [] })` 应返回 `[]`，不要降级为全扫。caller 的常见边界 case（如新 note 无 block）。

3. **[`tests/mocks/storage-mock.ts`](../../tests/mocks/storage-mock.ts)** 必须**同步**加 `subjectAtomIds` / `objectAtomIds` / `atomIds` / `objectLiteral` 处理。否则 5B Stage 9 测试会挂。

4. **新增单元测**：本 PR **应**新建 [`tests/storage/filter-extensions.test.ts`](../../tests/storage/filter-extensions.test.ts) 覆盖 6 cases（subjectAtomIds 命中 / 空 array / objectAtomIds 同上 / atomIds 同上 / objectLiteral 命中）。**不**要求 SurrealDB sidecar，mock storage 同步实施够用。

---

## 2. 任务（按 Step 1-7 顺序）

### Step 1: 读 audit 报告关键段

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && git log docs/data-layer-audit -1 --oneline
```

audit 报告 commit `006b500f` 在本地 `docs/data-layer-audit` 分支。

提取报告到 /tmp：

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && git show docs/data-layer-audit:docs/tasks/2026-05-29-data-layer-audit-report.md > /tmp/audit-report.md && wc -l /tmp/audit-report.md
```

Read `/tmp/audit-report.md`，**只读以下段**（不要全文）：
- §〇 Executive Summary
- §一 1.1 note 模块（13 处 — top 1/2/3 在这）
- §三 storage API 提议（**P0-1/2/3 权威定义**）
- §四 修复优先级
- §五.4 broadcastFolderListChanged 冗余（仅供前瞻，**不在本 PR 改**）
- §五.5 LIMIT 1 但未用 getEdge（同上）

### Step 2: 改 storage API

文件：[`src/storage/api.ts`](../../src/storage/api.ts)

#### 2.1 EdgeFilter 加 3 字段

grep `^export interface EdgeFilter` 找现有结构，就地新增：

```ts
export interface EdgeFilter {
  // ... 已有字段 ...
  subjectAtomId?: string;
  objectAtomId?: string;

  // 新增（P0-1, 2026-05-29 data-layer-audit）:
  // 批量 atom id 过滤（SQL IN），与单 id 字段互斥
  subjectAtomIds?: string[];
  objectAtomIds?: string[];

  // 新增（P0-3）: literal object 过滤
  // 用于 listFolders(viewType)：object 是 string literal "note" / "ebook" 等
  objectLiteral?: { type: string; value: unknown };
}
```

#### 2.2 AtomFilter 加 1 字段

```ts
export interface AtomFilter {
  // ... 已有字段 ...

  // 新增（P0-2）:
  // 批量 atom id 过滤（SQL IN），替代 for / Promise.all + getAtom × N 雪崩
  atomIds?: string[];
}
```

### Step 3: 改 SurrealDB storage 实现

文件：[`src/storage/surreal/storage.ts`](../../src/storage/surreal/storage.ts)

#### 3.1 listEdges 接 subjectAtomIds / objectAtomIds / objectLiteral

grep `async listEdges` 找现有实现 + WHERE 拼装段。

新增条件（仿现有套路）：

```ts
// 互斥 sanity check（P0-1）
if (filter.subjectAtomId && filter.subjectAtomIds) {
  throw new Error(
    '[storage.listEdges] subjectAtomId and subjectAtomIds are mutually exclusive',
  );
}
if (filter.objectAtomId && filter.objectAtomIds) {
  throw new Error(
    '[storage.listEdges] objectAtomId and objectAtomIds are mutually exclusive',
  );
}

// 空 array short-circuit（不要降级为全扫）
if (filter.subjectAtomIds?.length === 0) return [];
if (filter.objectAtomIds?.length === 0) return [];

// WHERE 拼装
if (filter.subjectAtomIds !== undefined) {
  conditions.push('subject.atomId IN $subjectAtomIds');
  bindings.subjectAtomIds = filter.subjectAtomIds;
}
if (filter.objectAtomIds !== undefined) {
  conditions.push('object.atomId IN $objectAtomIds');
  bindings.objectAtomIds = filter.objectAtomIds;
}
if (filter.objectLiteral !== undefined) {
  conditions.push(
    'object.kind = "literal" AND object.type = $objLitType AND object.value = $objLitVal',
  );
  bindings.objLitType = filter.objectLiteral.type;
  bindings.objLitVal = filter.objectLiteral.value;
}
```

#### 3.2 listAtoms 接 atomIds

```ts
// 空 array short-circuit
if (filter.atomIds?.length === 0) return [];

// WHERE 拼装：atomId 需转 SurrealDB Thing[]
if (filter.atomIds !== undefined) {
  conditions.push('id IN $atomRids');
  bindings.atomRids = filter.atomIds.map((id) => atomRid(id));
}
```

verify：`atomRid` 是现有 helper，grep 确认导入。

### Step 4: 改 caller（按 audit §二 反模式分组）

#### 4.1 改 `assemble-pm-doc.ts:220-221`（B1 top 1/2）

```ts
// 4. 拉 nextSibling + childOf 边（只拉本 note 的 — P0-1）
const [nextSiblingEdgesRaw, childOfEdgesRaw] = await Promise.all([
  storage.listEdges({
    predicate: NEXT_SIBLING_PREDICATE,
    subjectAtomIds: blockIds,   // P0-1: SQL IN 过滤
  }),
  storage.listEdges({
    predicate: CHILD_OF_PREDICATE,
    subjectAtomIds: blockIds,
  }),
]);

// 应用层 filter 保留作 sanity（object.atomId 也得在 set 内）
const nextSiblingEdges = nextSiblingEdgesRaw.filter(
  (e) =>
    e.object.kind === 'atom' &&
    blockIdSet.has(e.object.atomId),
);
const childOfEdges = childOfEdgesRaw.filter(
  (e) =>
    e.object.kind === 'atom' &&
    (e.object.atomId === containerId || blockIdSet.has(e.object.atomId)),
);
```

#### 4.2 改 `assemble-pm-doc.ts:209`（B4 Promise.all 雪崩）

替换：

```ts
// 3. 拉所有 block atoms（单 query 替代 Promise.all 雪崩 — P0-2）
const blockAtoms = await storage.listAtoms({
  domain: 'pm' as const,
  atomIds: blockIds,
});
const blocksById = new Map<string, AtomEntity<'pm'>>();
for (const atom of blockAtoms) {
  blocksById.set(atom.id, atom as AtomEntity<'pm'>);
}
```

#### 4.3 改 folder caller（P0-3 objectLiteral）

audit §三 P0-3 + §一 1.2 登记位置。grep `listFolders|listEdges` 在 `folder/capability-impl.ts`，对照 audit 报告改。

#### 4.4 其它 caller

audit §二 B1/B2/B3/B4 分组共 12 处。逐一对照改，不漏不增。

### Step 5: 改测试 mock

文件：[`tests/mocks/storage-mock.ts`](../../tests/mocks/storage-mock.ts)

grep `listEdges|listAtoms` 找 mock 实现段，加 4 字段处理：

```ts
// listEdges 内：
if (filter.subjectAtomIds !== undefined) {
  if (filter.subjectAtomIds.length === 0) return [];
  const idSet = new Set(filter.subjectAtomIds);
  edges = edges.filter((e) => idSet.has(e.subject.atomId));
}
// objectAtomIds / objectLiteral 同款

// listAtoms 内：
if (filter.atomIds !== undefined) {
  if (filter.atomIds.length === 0) return [];
  const idSet = new Set(filter.atomIds);
  atoms = atoms.filter((a) => idSet.has(a.id));
}
```

### Step 6: 新建单元测

**新建**文件：[`tests/storage/filter-extensions.test.ts`](../../tests/storage/filter-extensions.test.ts)

6 cases：

```ts
import { describe, it, expect } from 'vitest';
import { createMockStorage } from '../mocks/storage-mock';

describe('Storage filter extensions (P0)', () => {
  it('subjectAtomIds 命中返回对应 edges', async () => {
    // setup: putEdge 3 条不同 subject 的 edges
    // assert: listEdges({ subjectAtomIds: [id1, id2] }) 返回 2 条
  });

  it('subjectAtomIds 空 array 返回 []', async () => {
    // assert: listEdges({ subjectAtomIds: [] }) === []
  });

  it('objectAtomIds 同款', async () => { /* ... */ });

  it('atomIds 命中返回对应 atoms', async () => { /* ... */ });

  it('atomIds 空 array 返回 []', async () => { /* ... */ });

  it('objectLiteral 命中返回 literal edges', async () => { /* ... */ });
});
```

### Step 7: 验收 + commit

#### V1: typecheck 0 错

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "src/main/ipc/handlers.ts\|src/renderer/shell/WorkspaceBar.tsx"
```

#### V2: 5B Stage 9 现有测试 0 fail（mock storage 同步加完才能 PASS）

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npm run test
```

#### V3: 新增单元测 0 fail

npm test 输出含 `filter-extensions.test.ts` 6 cases PASS。

#### V4: grep 验证 caller 改完

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -n "listEdges.*predicate.*}\|listEdges.*{ predicate" src/platform/main/note/assemble-pm-doc.ts
```

期望：line 220-221 含 `subjectAtomIds:`。

#### V5: 手动 npm start 验证（**核心收益**）

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npm start
```

操作：
- import 50 篇 markdown（如果数据库没数据，参考 5B Stage 9 bench 思路构造）
- **重启 app**
- 测量 NavSide 从启动到显示 list 的时间（看 main terminal log 的 `[listNotes]` 耗时）
- **期望**：50 篇 < 2 秒（baseline 1000 篇 × 100 块 = 30s+，50 篇按比例缩放）

汇报里**包含**：
- 50 篇修后耗时
- 修前 baseline（如果用户提供了）

#### Commit 纪律

拆 **2 commit**：

- **commit a**：storage 层 + mock + 新单元测（api.ts + surreal/storage.ts + tests/mocks/storage-mock.ts + tests/storage/filter-extensions.test.ts）
- **commit b**：caller 改（assemble-pm-doc.ts + folder/capability-impl.ts + 其它 audit §二 caller）

**拆 commit 原因**：commit a 是独立可验收（typecheck + 新 test PASS）。commit b 是 caller 改后行为不变，5B Stage 9 集成测应仍 PASS。

每段 commit 前 V1 typecheck 必须 0 错。如 sandbox 拦 tsc / git / npm test / npm start，**停手汇报让总指挥介入**。

- **不要** push
- **不要** merge 到 main
- 不要 commit 老 untracked docs
- **可以** commit 本 prompt 文档 `docs/tasks/2026-05-29-data-layer-fix-p0-p1-prompt.md`（与 commit a 同 commit）

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
- 改 [`src/storage/api.ts`](../../src/storage/api.ts) + [`src/storage/surreal/storage.ts`](../../src/storage/surreal/storage.ts)
- 改 audit §二 B 反模式分组登记的 caller（按表照改）
- 改 [`tests/mocks/storage-mock.ts`](../../tests/mocks/storage-mock.ts)（同步新字段）
- **新建** [`tests/storage/filter-extensions.test.ts`](../../tests/storage/filter-extensions.test.ts)
- 跑 `npx tsc` / `npm run test` / `npm start`

**严禁**：
- ❌ 改 5B Stage 9 现有测试（[`tests/`](../../tests/) 已存在文件不动；本期只新建 filter-extensions.test.ts）
- ❌ 改 storage 层 SSOT（atom-entity.ts / edge-entity.ts / atom.ts / edge.ts 不动）
- ❌ 改 capability 层 type SSOT（pm-atom-draft.ts / structural.ts 不动）
- ❌ 改 audit 报告 A 必要 / C 已优化 / D 启动期分类的 caller（**只**改 B 反模式）
- ❌ **新建** `getAtomsByIds` 高层 API（用户拍板不要这层）
- ❌ 切其它分支 / merge / push / docs/（除本 prompt 文档外）
- ❌ 操作数据库 / 跑 migration
- ❌ 顺手修 audit §五 登记的其它问题（5.1 deleteNote 单事务 / 5.2 ebook 雪崩 / 5.3 transaction 外 listEdges 等 — 留 P1+ 后续 PR）

### 3.4 完成标准

- V1-V5 全部 PASS
- 2 commit 在 `fix/data-layer-p0` 分支
- audit §二 B1/B2/B3/B4 分组**每一处** caller 都改完
- 5B Stage 9 现有测试**仍** PASS（行为不变只 perf 改）
- 新增单元测 PASS

完成后向调用方汇报：
- 2 个 commit hash + 改动文件清单
- V1-V5 各项验收结果（**含 V5 npm start 手动测量冷启动时间**）
- audit §二 B 分组是否**全改完**（如有漏，登记 file:line）
- EdgeFilter 单 id vs 批量 id 互斥**怎么处理**（throw 还是归一化 — 选哪个 + 理由）
- 任何 SurrealDB SQL IN 行为 verify 发现（如不支持某语法的降级方案）
- audit §五 其它问题是否在改 caller 过程中发现新表象（**只登记不修**）

---

## 4. Agent 配置建议（给调用方）

- **agent 类型**：`general-purpose`
- **后台运行**：可后台。完成时通知
- **预期工作时间**：1.5-2.5 小时（storage API 30 分钟 + mock 同步 15 分钟 + 12 处 caller × 5 分钟 = 1 小时 + 单元测 30 分钟 + 验收）

---

## 5. PR B 前瞻（不在本期）

PR B (P1) 留下一对话执行，依赖 PR A merge：

| PR B 改动 | 位置 | 收益 |
|---|---|---|
| storage 新建 `listMarkerAtoms({ domain, markerPredicate })` 高层 API | audit §三 P1-1 | listNotes / listNoteTitles 拉 101k 行 → 1k 行 |
| applyDiff removedEdges 用 P0-1 IN 批量 lookup | audit §三 P1-2 | 删 6100 块 N 次 listEdges → 1 次 |
| broadcastFolderListChanged 合 4 次为 1 次 | audit §五.4 | folder 操作快 4× |

→ **本期不动这些**。

---

## 6. 已知风险

1. **EdgeFilter 单 id vs 批量 id 互斥**：默认 throw，也可归一化（单 id → `[id]`）。**选哪个在汇报里登记**。

2. **SurrealDB `IN $rids`**：**verify** SurrealDB 接受 `WHERE id IN $rids` + `$rids` 是 Thing[]。如不接受 → 降级为 `WHERE id IN (rid1, rid2, ...)` 拼接（用 binding 避免 SQL injection）。

3. **objectLiteral SQL**：SurrealDB object 是 nested JSON — `WHERE object.kind = 'literal' AND object.value = $val` **verify** 索引走（可能走全扫，但比应用层 filter 好 — SQL 层 filter 比网络传 + 应用层 filter 快）。

4. **caller 漏改风险**：audit §二 B 分组有 12 处。grep verify 改前 + 改后对比 — 改前记下 12 处 file:line，改后 grep `listEdges.*predicate.*}.*$`（无 atomId 字段）对照。期望 B1/B2 分组位置 0 命中。A 必要 / D 启动期位置仍命中（必要全扫，不动）。

5. **5B Stage 9 mock storage 同步**：如果 mock 新字段处理有 bug → 5B Stage 9 集成测会挂（比单元测先暴露）。单元测 + 集成测联合验收。

6. **冷启动 baseline**：audit §〇 写"1000 篇 × 100 块 → 30s+"。用户实际数据库可能 50-500 篇。V5 手动测量用**用户真实数据库**跑（不是 mock / 合成），汇报**真实测量值**。

---

*Data Layer Fix P0 sub-phase · 2026-05-29 · self-contained · 用户拍板：AtomFilter.atomIds[] 不加 getAtomsByIds 高层 / EdgeFilter 单 id vs 批量 id 互斥*
