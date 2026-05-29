# Data Layer Audit — listAtoms / listEdges 全库扫调用清查 — Prompt

> 这份 prompt 给新会话执行。直接把整份文档作为 user message 发给新对话即可。
> Self-contained — 新对话没有 5B / 删除诊断 上下文。

---

## 0. 你的身份 + 总目标

你是 KRIG-Note V2 的**数据层架构审计师**。本次任务**字面只产报告，不改代码**。

### 0.1 背景

用户字面反馈两件互相关联的事：
- **冷启动慢**：app 打开后 30+ 秒才在 NavSide 字面看到内容
- **批量删除失败**：删 6100 块大 note 字面卡死（已 DB 端手动止血 3 个 note）

主对话已字面初步诊断：**根因不是单事务串行**，而是字面**应用层全库扫然后内存 filter 反模式**。已字面证据：

[`src/platform/main/note/assemble-pm-doc.ts:220-221`](../../src/platform/main/note/assemble-pm-doc.ts) 字面：

```ts
// 字面拉全库所有 nextSibling + childOf 边,然后应用层 filter
storage.listEdges({ predicate: NEXT_SIBLING_PREDICATE }),
storage.listEdges({ predicate: CHILD_OF_PREDICATE }),
```

每次 `assemblePmDoc(noteId)` 字面**全库扫 2 次边集**。listNotes 字面**对每篇 note assemble 一次** → 字面 N² 量级灾难。

→ 在动手修代码前，**必须先 audit 全仓库**字面找出所有 listAtoms / listEdges 调用 → 字面标注哪些是必要的、哪些是反模式、字面修起来复杂度多大。**本期 prompt 就是这个 audit**。

### 0.2 本期产出

**字面唯一产出**：一份**报告文档** [`docs/tasks/2026-05-29-data-layer-audit-report.md`](../../docs/tasks/2026-05-29-data-layer-audit-report.md)（新建）

内容字面包含（详 §3）：
- 全仓 `listAtoms` / `listEdges` 调用清单（含 file:line 字面引）
- 每个调用字面分类（必要全扫 / 反模式 / 可优化）
- 每个反模式字面影响估算（"删 1 篇大 note 字面拉全库 X 次"）
- 字面提议的 storage 层 API 改动（如 EdgeFilter 加 `subjectAtomIds: string[]`）
- 字面修复优先级排序（按"影响 × 复杂度"）

**字面禁止**：
- ❌ 改 `src/` 任何文件
- ❌ 改 `tests/` 任何文件
- ❌ 改 `docs/` 任何文件（除本期新建的 audit-report.md 字面外）
- ❌ 动 git（不 commit、不 merge、不 push、不切分支 — 本期字面在你预先切的 `docs/data-layer-audit` 分支字面跑，**只产报告 + commit 报告**）

**Agent 类型**：`general-purpose`（不是 Plan — Plan 没 Write/Edit）

---

## 1. 必读上下文

### 1.1 项目根 + 分支

- 仓库根：`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
- **实施分支**：`docs/data-layer-audit`（用户预先 checkout）
- 第一步：`cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && pwd && git remote -v | head -1 && git branch --show-current` 三联守门

### 1.2 storage 层字面 API

[`src/storage/api.ts`](../../src/storage/api.ts) 字面：

```ts
interface AtomFilter {
  domain?: AtomDomain;
  createdBy?: string;
  createdAtRange?: { from?: number; to?: number };
  updatedAtRange?: { from?: number; to?: number };
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'updatedAt';
  orderDirection?: 'asc' | 'desc';
}

interface EdgeFilter {
  predicate?: EdgePredicate;
  subjectAtomId?: string;        // ⚠️ 单个 ID
  objectAtomId?: string;          // ⚠️ 单个 ID
  // ... + limit / offset / orderBy
}
```

**字面字段字面 verify 自己跑 grep**：

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -A 20 "^export interface EdgeFilter\|^interface EdgeFilter" src/storage/api.ts
```

字面**关键字面缺**：
- `subjectAtomIds?: string[]` — 多 atom ID 字面批量过滤
- `objectAtomIds?: string[]` — 同上
- domain-aware atom 过滤（如 `hasNoteViewMarker?: boolean`）

→ **不要在本期 audit 提议改 storage API**。本期字面产报告告诉决策方"如果加这些字段，能字面修哪几处反模式"。

### 1.3 5B / Stage 1-9 字面架构上下文

V2 字面 storage 模型是 atom + edge：
- **atom**：5 domain（`pm` / `folder` / `graph-canvas` / `graph-instance` / `ebook` / `reading-state` / `thought`）
- **edge**：三段式 predicate `<source>:<vocabulary>:<edge-name>`
- 三大 edge 字面（block atomization 后）：
  - `user:krig:belongsToNote` — block atom → container atom（每 atom 1 条 outgoing）
  - `user:krig:childOf` — 嵌套子 atom → 父 atom
  - `user:krig:nextSibling` — 同父下兄弟 atom 拉链
- 标志边：
  - `user:krig:hasNoteView` — pm container 字面是 note（非 canvas / 非 thought 区分）
  - `user:krig:inFolder` — note/canvas/ebook 字面属于 folder

字面**5B Stage 1-7 redo 之后**，pm domain 字面装：
- note container atoms（带 hasNoteView 边）
- block atoms（每 note 含 N 个，5B Stage 7 redo 字面 atoms 直写 storage）
- canvas text node atoms（带 canvas-text-node 标志）
- reading-thought atoms

→ `listAtoms({ domain: 'pm' })` 字面拉**全部上述** atom。如果用户字面 1000 篇 note × 平均 100 块 = 100k+ atoms 字面拉到 client。

### 1.4 SurrealDB 字面查询字面性能特点

字面 verify 现有 storage 实现（[`src/storage/surreal/storage.ts`](../../src/storage/surreal/storage.ts)）：

- `listAtoms(filter)` 字面 → `SELECT * FROM atom WHERE domain = $domain ...`（字面有 ORDER BY + LIMIT）
- `listEdges(filter)` 字面 → 类似 `SELECT * FROM edge WHERE predicate = $predicate AND subject.atomId = $sid ...`
- 字面没有 IN ($ids) 字面批量过滤接口

→ 字面 SurrealDB **能力字面支持**批量 IN 过滤（query SQL 字面 `WHERE subject.atomId IN $ids`），但**TypeScript API 层字面没暴露**。

### 1.5 已识别的 6 处可疑调用（字面 audit 起点）

以下字面**主对话已 grep 出**字面调用位置 — 你的 audit 字面**从这 6 处开始**，但**不限于这 6 处**：

| # | 文件:行 | 字面调用 | 字面主对话怀疑 |
|---|---|---|---|
| 1 | [`assemble-pm-doc.ts:220`](../../src/platform/main/note/assemble-pm-doc.ts) | `listEdges({ predicate: NEXT_SIBLING_PREDICATE })` | ⚠️ 全库扫 |
| 2 | [`assemble-pm-doc.ts:221`](../../src/platform/main/note/assemble-pm-doc.ts) | `listEdges({ predicate: CHILD_OF_PREDICATE })` | ⚠️ 全库扫 |
| 3 | [`capability-impl.ts:291`](../../src/platform/main/note/capability-impl.ts) `listNotes` | `listAtoms({ domain: NOTE_DOMAIN })` | ⚠️ 拉所有 pm atom（含 block） |
| 4 | [`capability-impl.ts:292`](../../src/platform/main/note/capability-impl.ts) `listNotes` | `listEdges({ predicate: HAS_NOTE_VIEW_PREDICATE })` | ✓ 必要（hasNoteView 边总数 ≈ note 数，字面小） |
| 5 | [`capability-impl.ts:294`](../../src/platform/main/note/capability-impl.ts) `listNotes` | `listEdges({ predicate: IN_FOLDER_PREDICATE })` | ✓ 必要（inFolder 边总数 ≈ note 数） |
| 6 | [`folder/capability-impl.ts:252`](../../src/platform/main/folder/capability-impl.ts) `collectFolderSubtree` | `listEdges({ predicate: IN_FOLDER_PREDICATE, objectAtomId: current })` | ✓ 单 ID 过滤，OK |

---

## 2. 任务执行

### Step 1：grep 全仓 listAtoms / listEdges / listFolders 等"批量 list" 调用

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -rn "storage\.list\|tx\.list" src/platform src/capabilities --include='*.ts'
```

字面**得到完整调用清单**（应字面 30-50 处）。**不要省略** — 每一处字面**都要在报告里登记**。

字面还要 grep：
- `storage.getAtom` / `tx.getAtom` 在 for 循环里 / Promise.all 里字面调（每次 1 query × N → 全表扫等价物）
- `storage.listAtoms` 不传 filter 的字面调（更严重的全扫）
- `storage.listEdges` 无 predicate filter 的字面调（最严重）

### Step 2：每个调用字面分类

对每处调用字面回答：

| 字段 | 内容 |
|---|---|
| **file:line** | 字面引用（如 `src/platform/main/note/assemble-pm-doc.ts:220`）|
| **函数** | 字面是哪个 export function 字面内调（如 `assemblePmDoc`）|
| **调用形态** | 字面参数（如 `listEdges({ predicate: 'X' })` 字面无 atomId 过滤）|
| **字面分类** | A 必要全扫 / B 反模式（应用层 filter）/ C 已优化（带 atomId 过滤）/ D 启动期一次性（可接受） |
| **字面被谁调** | 字面 caller 字面频率（每篇 note 调一次 / 字面冷启动 1 次 / 用户操作触发 / 字面广播触发）|
| **字面影响估算** | 在 1000 篇 note × 100 块/篇 的字面场景下，**字面拉了多少行**（atom + edge 数字面估算）|
| **字面修复方案** | 字面建议怎么改（如"storage 层加 `subjectAtomIds: string[]` 字段后字面改成传 blockIds"）|
| **字面修复复杂度** | 字面估算：xs (5 行) / s (50 行) / m (200 行) / l (500+ 行) |

### Step 3：分类汇总 + 优先级

字面把所有 B 类反模式 + C 类已优化 + A 类必要 + D 类启动期 字面分组。

每组字面统计：
- 反模式总数
- 字面影响最大的 top 3
- 字面如果修了反模式 top 3，字面预估冷启动从 30s 字面降到多少
- 字面如果修了 top 3，删 6100 块 note 字面预估从"卡死"字面降到多少时间

### Step 4：storage API 改动字面提议

按 audit 字面发现，**字面列出**：

| 字面提议 | 字面收益（修了哪几处 B 反模式）| 字面复杂度 |
|---|---|---|
| EdgeFilter 加 `subjectAtomIds: string[]` | #1, #2, ... | s |
| EdgeFilter 加 `objectAtomIds: string[]` | #X, #Y | s |
| AtomFilter 加 `atomIds: string[]` | #Z | s |
| 加 `listNotesAtomsOnly` 高层 API (filter 出 pm container atom，不返 block) | #3 | m |
| 加 `attrs.title` 字面 cache 字面充分利用（避免 N× assemble）| #3 部分 | s |
| ... 字面其它发现 | ... | ... |

### Step 5：写报告

字面新建 [`docs/tasks/2026-05-29-data-layer-audit-report.md`](../../docs/tasks/2026-05-29-data-layer-audit-report.md)，字面结构：

```markdown
# Data Layer Audit Report — listAtoms / listEdges 全库扫清查

> 字面日期：2026-05-29
> 字面 audit 范围：src/platform + src/capabilities（main 端 + storage 调用层）
> 字面**不含 src/views**（view 端字面只调 capability API，不直接调 storage）

## 〇、Executive Summary（给决策方字面看）

- 字面**发现**：N 处 listAtoms / listEdges 调用
- 字面**反模式**：M 处全库扫然后内存 filter
- 字面**影响最大**：[top 3 list]
- 字面**冷启动 30s 字面根因 top 3 改善后字面预估降到 X 秒**
- 字面**删除 6100 块大 note 卡死字面根因 top 3 改善后字面预估降到 Y 秒**
- 字面**字面建议**：先修 [top 3]，字面再考虑 [其它]

## 一、字面调用清单（完整）

| # | file:line | 函数 | 调用形态 | 分类 | 调用频率 | 影响估算 | 修复方案 | 复杂度 |
|---|---|---|---|---|---|---|---|---|
| 1 | ... | ... | ... | B | 每篇 assemble 一次 | 1000×2=2000 全表扫 / 冷启动 | 加 subjectAtomIds | s |
| 2 | ... | ... | ... | ... | ... | ... | ... | ... |
| ... | ... | ... | ... | ... | ... | ... | ... | ... |

## 二、反模式分组

### B1. listEdges 无 atomId 过滤的全扫
[列出所有 #]

### B2. listAtoms 拉所有 pm 然后内存 filter 出 note
[列出所有 #]

### B3. for 循环内字面 getAtom × N
[列出所有 #]

### B4. Promise.all 字面并发字面拉 N atoms
[列出所有 #]

### B5. 其它反模式

## 三、storage API 字面提议

[详细列出每个提议 + 收益 + 复杂度]

## 四、字面修复优先级（按影响 × 复杂度排序）

| 优先级 | 字面项 | 影响 | 复杂度 | 字面收益估算 |
|---|---|---|---|---|
| P0 | ... | 冷启动 -25s | s | 修了字面 80% 冷启动慢 |
| P1 | ... | ... | ... | ... |
| ... | ... | ... | ... | ... |

## 五、字面已发现的次要问题

字面 audit 期间字面发现的其它非"listAtoms/listEdges 反模式"但相关的问题（如 storage.transaction 字面用法 / 字面 cache 字面失效场景 / 字面广播频率等）。

## 六、字面 audit 范围声明

- 字面**已审**：src/platform + src/capabilities
- 字面**未审**：src/views（view 端字面不直接调 storage） / src/storage 内部（storage 层字面实现细节，audit 对外行为不审内部）
- 字面**未审**：tests（5B Stage 9 测试字面 mock storage，不在生产路径）
```

### Step 6：commit + push

完成 Step 1-5 后：

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && git add docs/tasks/2026-05-29-data-layer-audit-report.md docs/tasks/2026-05-29-data-layer-audit-prompt.md && git commit -m "..."
```

字面 commit message 字面**包含**：
- 字面 audit 发现的反模式总数
- 字面 top 3 反模式字面 file:line
- 字面 storage API 提议数
- 字面提议的 P0 修复字面预估收益

**不要** push（保留给总指挥）。**不要** merge 到 main。

---

## 3. 操作纪律

### 3.1 cwd 漂移防御

V2 cwd 漂移已 16 次事故。每条 Bash 都必须 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`。Read/Edit/Write 一律绝对路径。

三联守门：

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && pwd && git remote -v | head -1 && git branch --show-current
```

V1 / V2 速判：
- V1 顶层 `src/main/` / `src/renderer/` / `src/plugins/`
- V2 顶层 `src/platform/main/` / `src/views/` / `src/capabilities/` / `src/drivers/` / `src/storage/` / `src/semantic/`
- V1 main hash `47015ed8` / V2.git URL 字面 `KRIG-Note-V2.git`

### 3.2 sandbox 限制

harness 可能拦 `git add` / `git commit`。**遇拦截不走 `--dangerouslyDisableSandbox`**，停手汇报。

### 3.3 严格 read-only 纪律

**可以**：
- 跑 `grep` / `find` / `wc -l` 等纯查询命令
- `Read` 任何 src/ 文件
- `Write` 字面新建 `docs/tasks/2026-05-29-data-layer-audit-report.md`
- `git add` + `git commit` 字面 audit 报告

**严禁**：
- ❌ 改 `src/` 任何文件（**read-only audit**）
- ❌ 改 `tests/` 任何文件
- ❌ 改 `docs/` 任何文件（**除**本期 audit-report.md）
- ❌ 跑 `npm run test` / `npm start` / `tsc`（本期字面无代码改动需要 verify）
- ❌ 切其它分支 / merge / push
- ❌ 操作数据库

### 3.4 完成标准

- audit-report.md 字面完整产出（含 §〇-§六 全部段）
- 单 commit 在 `docs/data-layer-audit` 分支
- 字面**不 push、不 merge**

完成后向调用方汇报：
- commit hash + 报告字面位置
- 字面 audit 发现摘要（反模式总数 + top 3 + 字面收益估算）
- **报告内不涉及代码改动决策** — 报告字面只产数据，决策字面留总指挥

---

## 4. Agent 配置建议（给调用方）

- **agent 类型**：`general-purpose`
- **后台运行**：可后台。完成时通知
- **预期工作时间**：4-6 小时（30-50 处调用字面**逐一**字面读 + 字面分类 + 字面估算影响 + 字面写报告）

---

## 5. 已知风险

1. **字面影响估算字面准不准**：subagent 字面没真实数据库可跑 benchmark，估算字面基于"用户字面 1000 篇 note × 平均 100 块" 字面假设。**字面在报告里登记字面假设**让决策方判断。

2. **字面分类边界**：A 必要 vs B 反模式字面在某些 case 字面模糊。**字面**：subagent 字面对模糊 case 字面标 "B?" + 字面解释，让决策方决定。

3. **字面看到 src/ bug 不修**：audit 期间字面可能字面看到非 "list 反模式" 但字面明显的 bug（如 race / leak / 等）。**字面登记在 §五 字面"其它发现"段**，不修。

4. **字面 5B Stage 9 测试字面 mock storage 与生产 SurrealDB 字面行为不一致**：subagent 字面不要把 mock 字面行为字面当生产参考。

---

*Data Layer Audit sub-phase · 2026-05-29 · read-only · 不改代码,只产报告*
