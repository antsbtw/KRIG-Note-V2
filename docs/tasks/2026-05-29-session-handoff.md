# 会话交接 — KRIG-Note V2

> 上一会话 context 过长，本文档把状态交接给你。
> 你的角色：接替前一会话继续协助用户推进 V2 重构 sub-phase。
>
> **第一步**：读完本文档（10 分钟），然后跟用户对齐"下一步做什么"，**不要自己 invent 任务**。

---

## 0. 当前状态（origin/main HEAD = `8aa28731`）

5B 重构系列字面**已完成**：Stage 1-9 + 多个 follow-up sub-phase 已 merge + push。
data-layer audit + 优化系列**进行中**：PR A merge，PR B prompt 已 push 待 subagent 实施。

近 10 commit（origin/main）：

```
8aa28731  PR B (P1) prompt: listMarkerAtoms + applyDiff + folder broadcast  ← 待启 subagent
609b0a63  Merge fix/data-layer-p0 (PR A: storage filter 字段 + caller migration)
6fc76823  perf(thought): #33 follow-up
9aea7fdc  perf(data-layer): P0 caller IN-array migration
3a8f4d8b  feat(storage): P0 EdgeFilter/AtomFilter batch fields
0d06097d  PR A (P0) prompt
926ff392  audit prompt + supersede delete-batch
b93771b1  delete-batch prompt (已 supersede，保留作历史)
0b64901a  import progress UX prompt
55f13479  Merge contract v2.1 full rewrite
```

---

## 1. 项目根 + 工作目录

- **仓库**：`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`（V2 工作目录）
- **V1 参考目录**：`/Users/wenwu/Documents/VPN-Server/KRIG-Note`（**只读参考**，禁止改）
- **cwd 漂移已 16 次事故**：每条 Bash 都必须 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`
- 远程：`origin = https://github.com/antsbtw/KRIG-Note-V2.git`

---

## 2. 关键 memory（你必须读）

在 `/Users/wenwu/.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/MEMORY.md`，**最近新增 2 条**（PR A 教训）：

- `feedback_surrealdb_inside_not_in` — SurrealDB SQL 用 `INSIDE` 不是 `IN`（数组成员检查）
- `feedback_filter_single_vs_batch_mutex` — storage filter 单 id vs 批量 id 字段同时传应 throw 不归一化

其它**绕不开**的 memory：
- `feedback_v2_cwd_drift_again` — cwd 漂移 16 次史，每条 Bash 必 cd /V2
- `feedback_branch_module_boundary` — 一模块一分支，禁止直接在 main 开发功能代码
- `feedback_merge_requires_explicit_ok` — "commit" ≠ "commit+merge"，每步破坏性操作需独立授权
- `feedback_strict_compliance_workflow` — "严格"任务 4 条纪律
- `feedback_v2_is_workspace_v1_is_reference` — V2 是工作仓库 V1 只读参考
- `project_delete_note_batch_plan` — deleteNote 大 note 卡死方案（**注意**：PR A 完成后这条 memory 部分过时，待 PR C 重新设计基于 P0+P1 后的世界）

---

## 3. 待选 sub-phase（用户拍板用）

按优先级排，**不要自己选，问用户**：

### 3.1 已 prompt 待启实施

| 项 | Prompt 文档 | 状态 |
|---|---|---|
| **PR B (P1)** data layer 优化 | [`docs/tasks/2026-05-29-data-layer-fix-p1-prompt.md`](2026-05-29-data-layer-fix-p1-prompt.md) | 文档 push，等用户切分支 `fix/data-layer-p1` 后 spawn subagent |
| Import 进度 UX | [`docs/tasks/2026-05-29-import-progress-ux-prompt.md`](2026-05-29-import-progress-ux-prompt.md) | 同上，分支 `feature/import-progress-ux` |

### 3.2 已识别需新设计 prompt

| 项 | 描述 | 触发条件 |
|---|---|---|
| **PR C** deleteNote 单事务分批 + sweepPendingDeletions | audit §五.1 + project_delete_note_batch_plan memory | PR B merge 后，基于 P0+P1 后的代码重新设计（旧的 `delete-batch-fix-prompt.md` 已 supersede） |
| word-import 进度 UX | import-progress-ux 的 word 扩展（需 main 解析阶段 + renderer markdown 阶段双段进度） | import-progress-ux merge 后 |
| ImportSession.cancel UI | 5B §7.5.3 字面留 view 层 sub-phase | 用户主动要求时 |

### 3.3 audit §五 其它债（按需）

- §5.2 ebook list 1000 书并发雪崩 — 真实场景压测确认后才修
- §5.3 storage.listEdges 在 storage.transaction 外被调 — 跨事务一致性
- §5.5 findEdge 单点 API — API 设计建议（非阻塞）

---

## 4. 工作风格 + 重要纪律

### 4.1 用户拍板的工作流模式（5B 全程贯彻）

1. **不直接执行长任务**：把任务写成 self-contained prompt 文档 commit 到 main，用户切分支后 spawn subagent 跑
2. **主对话仅做**：调研、审阅、写 prompt、merge、push、汇报
3. **subagent 跑长任务**：用户拍板 strict mode（subagent 不许擅自改 src 外的东西、遇 sandbox 拦截停手汇报、发现 bug 只登记不修）
4. **merge 节奏**：subagent 完成后用户手动跑 npm start 验证 → 用户说 "merge+push" 才执行

### 4.2 sandbox 拦截已知

harness 经常拦：`git checkout -b`（用户预先手动切）、`tsc`、`npm run test`、`npm start`、`git add/commit`、`git push`。

**禁止**走 `--dangerouslyDisableSandbox`。拦了就停手报告。

### 4.3 三联守门模板

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && pwd && git remote -v | head -1 && git branch --show-current
```

任何 git checkout / merge / push / reset / stash 前必跑。

### 4.4 token 退化自检

写 prompt / 设计文档时，**避免**任何词被退化成无意义口吃。已观察到的退化：
- "字面"被退化成断句词（应该只在 2 种场景用：强调"按字面执行" / 强调代码 literal）

自检：写完后 grep 高频词，每段 ≥ 3 次同一词 = 退化信号，重写。

### 4.5 commit message 规范

类型(scope): 短描述（< 70 字符）

详细 body（why > what）

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

---

## 5. V2 架构速判（grep 路径前必知）

| 顶层目录 | 角色 |
|---|---|
| `src/semantic/` | atom + edge SSOT（Atom\<D\> / AtomEntity\<D\> / Edge / EdgeEntity / structural / pm-atom-draft） |
| `src/storage/` | StorageAPI + SurrealDB sidecar 实现 |
| `src/capabilities/` | 28 capability（note / folder / content-ingest / text-editing / 等）|
| `src/platform/main/` | main 进程实现层（note / folder / ebook / graph / thought / ipc / window / 等）|
| `src/drivers/` | 编辑器驱动（text-editing-driver 等）|
| `src/views/` | View 层（NoteView / EBookView / 等），**走 IPC 不直接调 storage** |
| `src/shell/` | 全局 UI 框架（GlobalProgressOverlay / WorkspaceBar / 等）|

**V1 速判**：顶层有 `src/main/` / `src/renderer/` / `src/plugins/` → V1，立刻 cd /V2。

---

## 6. PR A 学到的硬约束（PR B / 后续都适用）

1. **SurrealDB SQL 用 INSIDE，不是 IN**（IN 是 graph traversal）
2. **filter 单 id vs 批量字段同时传 throw**（不归一化）
3. **EdgeFilter 已有字段**（PR A 加的）：
   - `subjectAtomIds?: string[]` / `objectAtomIds?: string[]` / `objectLiteral?: { type, value }`
4. **AtomFilter 已有字段**（PR A 加的）：`atomIds?: string[]`
5. **测试 mock 必须同步**：`tests/mocks/storage-mock.ts` 加新字段时同步 mock 实现
6. **现有 5B Stage 9 测试 12 文件 / 50 tests 必须 still PASS**（行为不变只 perf 改）

---

## 7. 你的第一句话（推荐）

读完本文档后，给用户说类似：

> 接替工作。当前状态：origin/main HEAD `8aa28731`（PR B prompt 已 push）。
> 下一步选哪个：
> - (a) 启 PR B subagent（你切 `fix/data-layer-p1` 分支，我 spawn）
> - (b) 启 import progress UX subagent
> - (c) 其它（PR C 设计、word import、cancel UI、等）

让用户拍板，**不要自己开干**。

---

## 8. 不在本文档但你可能需要的

| 需要时 | 看哪 |
|---|---|
| audit 报告全文 | `docs/data-layer-audit` 分支的 `docs/tasks/2026-05-29-data-layer-audit-report.md`（commit `006b500f`），用 `git show docs/data-layer-audit:docs/tasks/2026-05-29-data-layer-audit-report.md > /tmp/audit.md` 提取 |
| 5B 设计 / Stage 1-9 历史 | `docs/tasks/2026-05-28-stage-5B-import-converter-design.md` + 各 stage 实施 prompt |
| 数据契约 v2.1 | `docs/10-business-design/ebook/PDF-Note-Atom数据契约-v2.1.md`（完整版，752 行）|
| V2 数据模型规范 | `docs/RefactorV2/data-model/`（atom/spec.md / persistence/ / relations/ 等）|

---

*Handoff doc · 2026-05-29 · 接替前任会话 · 第一步：跟用户对齐下一步做什么*
