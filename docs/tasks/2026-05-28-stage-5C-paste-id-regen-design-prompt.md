# 阶段 5C：paste 跨 note id 共享 bug 修复设计 — 任务 Prompt

> 这份 prompt 给独立子会话执行。你（执行者）拿到这份文档后请按"任务"一节执行。
> 调用方（用户/总指挥）：请把整份文档作为 user message 发给新对话即可。

---

## 你的身份

你是 KRIG-Note V2 的**架构师**（建议 **`general-purpose`** agent — 不是 Plan，因为 Plan agent 没有 Write 工具无法落盘）。

你的产出是**一份设计文档**，落盘到 `docs/tasks/2026-05-28-stage-5C-paste-id-regen-design.md`，形式化修复方案。

实施留下游 sub-phase（`refactor/import-system-rebuild` 分支），不在本期。

## 上下文（必读，不要在产出里复述）

### 项目根 + 当前状态

- 仓库根：`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
- 当前 main HEAD：`e85cedb7 docs(tasks): stage 5B design — common ingest converter`
- 仓库 checkout **已经在 main 分支**，直接开始，不要切分支。

### 5A / 5B 已拍板的硬契约（5C 必须对齐）

| 拍板项 | 字面 | 来源 |
|---|---|---|
| table 是 atom | `attrs.id = ULID`;`content = []` | 5A |
| tableRow 不是 atom | row 信息走 cell.attrs.rowIndex/colIndex | 5A |
| STRUCTURAL_CONTAINER_TYPES | 5 项 `{tableRow, bulletList, orderedList, taskList, columnList}` | 5A |
| STRUCTURAL 集合收敛 | 单点 export 在 `@semantic/types/structural.ts`，五处 import（含 5C 新加的 regenerateIdsForPaste）| 5B §7.3.1 |
| Atom 与 PM doc 脱钩 | import 路径只产 atom 不产 PM doc；view 端 assemble 是唯一图→树翻译点 | 5B §7.1.2 |
| paste 入口归属 | 5C 独立 — paste 不走 ingest pipeline，仍走原 createNote 单条 | 5B §6.1 |
| 关键原则 | 决议层是契约源头，实施跟决议走 | 5A §7.6.3 |

### 关键参考文档（必读顺序）

1. **5B 设计**：[`docs/tasks/2026-05-28-stage-5B-import-converter-design.md`](2026-05-28-stage-5B-import-converter-design.md) — 必读 §6（与 5C 的接口）+ §7.3.1（STRUCTURAL 集合）
2. **5A 拍板汇总**：[`docs/tasks/2026-05-28-stage-5A-decision-026-amendment-summary.md`](2026-05-28-stage-5A-decision-026-amendment-summary.md) — 必读 §1 拍板 + §6.2 5C 关系
3. **调研报告**：[`docs/tasks/2026-05-28-import-system-survey.md`](2026-05-28-import-system-survey.md) — 必读 **§6.7（paste 跨 note id 共享 bug 详描）** + §7.4 必答题 + §4.5（buildAutoBlockIdPlugin 现有实施）+ §2.8（paste 入口现状）
4. **决议 026**（修订版）：[`docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md`](../RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md) — 必读 **§5.2（paste 全部生成新 id）** + §5.3（split 上半保留下半新）
5. **关键源码**（只读 verify）：
   - [src/views/note/tree-operations.ts:172-237](../../src/views/note/tree-operations.ts) — pasteNote / pasteFolderTree 现有代码
   - [src/platform/main/note/capability-impl.ts:162-307](../../src/platform/main/note/capability-impl.ts) — createNote / injectIdsForCreate 现有逻辑
   - [src/drivers/text-editing-driver/plugins/build-auto-block-id-plugin.ts](../../src/drivers/text-editing-driver/plugins/build-auto-block-id-plugin.ts) — PM editor 内 id 注入 + 重复检测重生成

## 任务

产出**一份**设计文档：

**文件路径**：`docs/tasks/2026-05-28-stage-5C-paste-id-regen-design.md`

**长度上限**：500 行（小范围 bug 修复，不要膨胀）

**结构**：

---

### 节 0：本期设计边界

- 不实施代码；产出设计文档
- **范围**：调研报告 §7.4 第 10 题 — paste 跨 note id 共享 bug 修复
- 不涉及 5B 的 content-ingest capability / batch API / 契约扩展
- 不解决调研报告 §6.4 一般性"inject/plugin 双轨"问题（那留更远 sub-phase）；本期只解 paste 入口

### 节 1：bug 复述与影响面

详细写：
- bug 触发链（用户操作 → tree-operations.ts:183 pasteNote → JSON.parse 深拷贝 → noteCap().createNote → injectIdsForCreate 不重生成 → 新 note 与源 note 共享所有 block id）
- 实际后果（cross-note belongsToNote 边混乱？引用追踪错乱？storage 层是否抛错？）—— **你必须事前调研给出明确结论**，不能 punt 到"实施时验证"
  - 关键 grep：storage 层是否对"同一 atom id 出现在多条 belongsToNote 边的 subject 位置"有约束？
  - 关键 grep：cardinality-check.ts 是否检测这个？
- 影响入口列举（tree-operations.ts:183 pasteNote / tree-operations.ts:236 pasteFolderTree / 其他可能受影响的入口）
- 为什么 buildAutoBlockIdPlugin 内的重复检测在 paste 路径**不生效**（capability 层 paste 不过 PM editor）

### 节 2：修复方案设计

#### 2.1 新增 `regenerateIdsForPaste(doc)` 函数

签名 + 算法字面伪代码 + 实施位置（建议放在 `src/platform/main/note/regenerate-ids-for-paste.ts` 或同等位置，给出具体路径建议）。

算法关键点：
- 递归遍历 PM doc 内所有节点
- 跳过 STRUCTURAL_CONTAINER_TYPES（5 项，从 `@semantic/types/structural.ts` import）
- 跳过 inline 节点（text / mathInline / fileLink / noteLink / hardBreak）
- 对剩余 block 节点：**无条件生成新 ULID**，覆盖 attrs.id（不论原 id 是否存在）
- table cell 的 rowIndex / colIndex 字面**不变**（5B Q2 拍板 dissect 期注入，paste 路径走 dissect 路径会重算）

与 5B `@semantic/types/structural.ts` 的依赖关系明示。

#### 2.2 新增 `pasteAndCreateNote(srcDoc, folderId)` API

- 位置：`capabilities/note` 暴露公共 API
- 内部：`regenerateIdsForPaste(srcDoc)` → 走原 `createNote` 内部路径
- 与现有 `createNote` 的关系：现有 createNote 保留语义不变；pasteAndCreateNote 是 paste 入口的独立路径

#### 2.3 view 端切换

- `src/views/note/tree-operations.ts:172 pasteNote` 改 `noteCap.createNote(docCopy)` → `noteCap.pasteAndCreateNote(docCopy)`
- `src/views/note/tree-operations.ts:236 pasteFolderTree` 同款改

### 节 3：决议 026 字面遵守

决议 026 §5.2 字面 "粘贴全部生成新 id"——5C 字面让此规则在 capability paste 路径**真正落地**。

是否需要修订决议 026？给出明确答案：
- 不需要修订（决议字面已对，只是实施漂移）
- 需要修订（如果决议有遗漏 capability 层 paste 的字面）

如果不需要修订，明示决议层无字面变更，只是实施补齐。

### 节 4：边缘场景与决策

逐个回答：

1. **paste 内嵌套（如 callout 内 nested list）**——递归是否覆盖全部嵌套层？
2. **paste table**（含 5A 拍板的 rowIndex/colIndex）——table atom 自身 id 新生成；cells id 也新生成；rowIndex/colIndex 不变（dissect 期重算）。验证这条字面对路。
3. **paste 大 note**（如导入产生的 13552 块大表）——regenerateIds 性能；是否需要 lazy？还是一次性扫全树？
4. **paste 失败时的 id 状态**——regenerate 完后 createNote 失败：是 noop（doc 副本已含新 id 但未入库）还是要 cleanup？
5. **paste 内含 mathBlock / image / 等带 src 的节点**——src 字段是否要保留（仍指原 media）？还是 dedup 拷贝？

### 节 5：5C 路线图（小范围，3 个 stage）

**Stage 5C.1**：新增 `regenerateIdsForPaste` 函数 + 单元测试（依赖 5B Stage 1-2 即 `@semantic/types/structural.ts` 已落地）
**Stage 5C.2**：新增 `pasteAndCreateNote` capability API + IPC + handler
**Stage 5C.3**：view 端切换 + 端到端测试场景

每个 Stage 写：
- 改动文件清单（含行号）
- 验收测试场景

验收测试场景至少覆盖：
- 复制 1 note 粘贴到同 folder → 检查两 note 字面无任何共享 block id（SurrealDB 旁路查 belongsToNote）
- 复制 1 note 粘贴到不同 folder → 同上
- 复制含表格的 note 粘贴 → table atom id 不共享 + cells id 不共享 + rowIndex/colIndex 字面不变
- 复制 folder 树（含 5 篇 note）粘贴 → 全部 25 个 block id（假设每篇 5 块）字面无共享

### 节 6：与 5B 的协调点

- 5C Stage 5C.1 字面**依赖** 5B Stage 1-2（STRUCTURAL 集合单点 export）
- 推荐 5B Stage 1-2 先做（~2 天），5C 之后才能开工
- 或：**5C 可在 5B Stage 1-2 完成前先 hardcode 5 项 STRUCTURAL**（第 6 处独立定义），5B Stage 2 完成后回头收敛——但**不推荐**，因为会再次引入"独立定义"的反模式滋生地

### 节 7：本期发现的悬而未决问题（如有）

如果 5C 设计过程中发现新的 open question，本节列出，留独立 sub-phase 拍板。

如果没有，明确写"无"。

---

## 操作纪律（**违反任意一条立刻停手报告**）

### cwd 漂移防御

V2 仓库的 harness 多次 Bash 调用之间 cwd 不稳定，会漂到隔壁 V1 仓库 `/Users/wenwu/Documents/VPN-Server/KRIG-Note`（已发生 14+ 次事故）。漂了会读到错代码，误导整份设计。

**每一条 Bash 都必须以 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...` 开头**，不论上一条是什么。

**Read / Write 工具一律传绝对路径** `/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2/...`，不依赖 cwd。

V1 / V2 区分速判：

| V1 顶层 | V2 顶层 |
|---|---|
| `src/main/`、`src/renderer/`、`src/plugins/`、`@plugins/*` paths | `src/platform/main/`、`src/views/`、`src/capabilities/`、`src/drivers/`、`src/storage/`、`src/semantic/` |

git log / git status 看到 V1 特征立即停手：
- commit hash 出现 `47015ed8` / `7f47f42f` / 包含 `canvas-m2-polish` / `sticky-color-bar`
- `git remote -v` URL 是 `KRIG-Note.git`（V1）而非 `KRIG-Note-V2.git`（V2）

### 设计层纪律

- 你**可以**新建 `docs/tasks/2026-05-28-stage-5C-paste-id-regen-design.md`
- 你**不可以**：
  - 修改 `src/` 任何源代码
  - 修改任何已存在的 docs（5B 设计 / 5A 汇总 / 调研报告 / 决议 026 等）
  - `git commit` / `git checkout` / `git stash` / `git reset` / `git push`
  - 操作数据库
  - 创建新分支

### 设计纪律

- **节 1 bug 影响面必须事前调研给出明确结论**（不能 punt 到"实施时验证"）
- **必须与 5A / 5B 拍板字面一致**（特别是 STRUCTURAL 5 项集合 + atom 与 PM doc 脱钩 + 决议层是契约源头）
- **paste 入口与 5B ingest pipeline 隔离**（5B 已拍板 paste 不进 batch API）—— 不要把 5C 设计塞进 ingest 路径
- 决策依据要**字面引用**调研报告 / 5A 汇总 / 5B 设计 / 决议 026 的具体节号 + 行号

### 完成标准

- 设计文档已写入 `docs/tasks/2026-05-28-stage-5C-paste-id-regen-design.md`（≤500 行）
- 节 1 bug 影响面有明确结论（storage 层是否抛错？cardinality 是否检测？）
- 节 2 三个子节齐全（regenerateIdsForPaste / pasteAndCreateNote / view 端切换）
- 节 4 五个边缘场景每个有明确决策
- 节 5 三个 Stage 每个有具体文件清单 + 测试场景
- 节 6 与 5B 协调点明确

完成后向调用方回复：
- 设计文档路径 + 行数
- 节 1 bug 影响面调研结论摘要
- 节 4 五个边缘场景决策摘要
- 节 5 三个 Stage 是否齐全
- 节 7 是否有新 open question

---

## Agent 配置建议（给调用方）

- **agent 类型**：**`general-purpose`**（**不是 Plan** — Plan agent 没有 Write/Edit 工具无法落盘产出，5B 已踩过这个坑；详见 memory `plan-agent-no-write-tool`）
- **是否后台运行**：可后台
- **预期工作时间**：1-1.5 小时（范围小 + 5A/5B 已奠定大量基础）
