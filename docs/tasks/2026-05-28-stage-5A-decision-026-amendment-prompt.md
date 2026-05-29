# 阶段 5A：Decision 026 矛盾拆解 + table 数据模型拍板 — 任务 Prompt

> 这份 prompt 给独立子会话执行。你（执行者）拿到这份文档后请按"任务"一节执行。
> 调用方（用户/总指挥）：请把整份文档作为 user message 发给新对话即可。

---

## 你的身份

你是 KRIG-Note V2 的**架构师**（建议用 `Plan` agent 类型 — 这就是它为这种工作设计的）。

你不写源代码，**但你可以修改决议文档**（`docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md`）—— 决议文档**就是**你这个阶段要拍板的对象。

## 上下文（必读，不要在产出里复述）

- 仓库根：`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
- 当前 main HEAD：`00489d6c docs(tasks): import system survey report (+ KRIG Platform clarification)`
- 必读输入文档：
  1. **调研报告**：`docs/tasks/2026-05-28-import-system-survey.md` — 重点读节 4.1 / 4.6 / 节 5 / 节 7.2 / 节 7.6
  2. **决议 026 原文**：`docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md` — 通读，重点 §3.1 / §3.4 / §6.1 / §13
  3. **生产契约**：`docs/10-business-design/ebook/PDF-Note-Atom数据契约-v2.md` — 重点 §3 atom 类型清单 / §4 字段语义
  4. **table NodeSpec 现状**：`src/drivers/text-editing-driver/blocks/table/spec.ts`
  5. **dissect / assemble / plugin 三处 STRUCTURAL 集合**：调研报告节 6.3 列出 3 个文件位置

## 总指挥已拍板的输入约束（不要重新讨论这些）

**核心拍板**：**table 自身是 atom**（选项 A）。

理由（不要在产出里复述）：
- 与生产中的 PDF-Note-Atom 契约一致（契约 §3 atom 类型清单含 `type='table'`，table 在生产里是真实存在的 atom）
- 决议 026 §6.1 跳层规则字面要求 `tableCell.childOf → table atom`，table 是 atom 时此规则字面成立
- 未来支持"用户单独拖动整张 table" / "table 内合并单元格" / "跨 row 引用 cell"都需要 table 有稳定锚点
- V2 内部模型与生产契约对齐后，atoms→PM / md→atoms / PM→dissect 三套实现共用同一份契约，避免中间格式转换链反模式

**衍生拍板**（跟随上面的核心拍板）：
- **tableRow 不是 atom**——row 没有独立语义（用户从不单独引用一行），row 信息可以放进 cell.attrs（见下方任务）
- **DB 已存"裸顶层 tableCell"老数据**——本期不写 migration 实施（用户已 rm krig-data），但**决议文档要登记"未来若再遇老数据需走 migration"**

## 任务

你的产出是**两份文档**：

### 产出 1：决议 026 修订版

直接修改 `docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md`，使其与"table 是 atom"决策**字面对齐**、内部不再矛盾。

**必须修的位置**（基于调研报告节 5.4 / 节 4.1 / 节 6.8 / 节 6.9 字面定位）：

1. **§3.1.2 表格行**：当前字面"table | 表格根容器 | 用户从不单独引用整表... | 不拆"必须改写。新字面应明确"table 拆 atom；用户可单独引用整表（拖动 / 跨表引用 / 编辑表格属性）"。

2. **§3.1.4 容量估算**：当前字面"100 行 × 10 列 table 的 atom 负载：1 table atom（根容器，不拆）→ table.content = []"——"不拆"字面已与决策矛盾，要删掉"不拆"措辞，但保留"1 table atom"事实。同时补 row 信息怎么表达——下方任务 4 拍板后回填到这里。

3. **§3.4 例 3**：当前字面 PM payload `{ domain:'pm', payload:{ type:'table', attrs:{id:'<ULID>'}, content:[] } }` 是对的方向（已暗示 table 有 atom + 有 id），保留事实但加注"§3.1.4 的容量估算与本例字面 1:1 一致——决策已拍板 table 是 atom"。

4. **§6.1 跳层规则**：当前字面"tableCell.childOf → table atom（跳过 tableRow）"必须**保留**作为字面契约——决策让此规则字面成立。**新增说明**：tableRow 既然不是 atom，row 边界信息**必须由 tableCell 自身承载**——通过 `tableCell.attrs.rowIndex`（行号，0-based 整数）+ `tableCell.attrs.colIndex`（列号，0-based 整数）表达。

5. **§13 Open Questions 补登**：调研报告节 6.9 字面指出代码 `assemble-pm-doc.ts:128` 自陈"字面登记到 decision 026 §13 待补充"但 §13 实际未登记。补登以下条目（用 §13.9 / §13.10 等下一个空号）：
   - **新 §13.X "tableCell 跨 row 拼装实施"**：决策已拍板 — tableRow 不是 atom；row 信息通过 `tableCell.attrs.rowIndex` 表达；assemble 按 rowIndex 分组重建 tableRow 包裹（具体算法见下方任务）。**不再是 open question，是已拍板规则**。
   - **新 §13.X "DB 历史数据 migration"**：本 sub-phase 不实施（用户已 rm krig-data）；未来若需迁移老 DB（含"裸顶层 tableCell"形态），走独立 migration sub-phase，扫所有 belongsToNote 边的 tableCell/tableHeader 顶层 atom，按 nextSibling 链推断 row 边界（启发式：连续 cells 字面同属一行），重新 dissect 写回。

6. **§3.1 STRUCTURAL_CONTAINER_TYPES 集合定义**：当前 `{table, tableRow, bulletList, orderedList, taskList, columnList}` 6 项需修订为 `{tableRow, bulletList, orderedList, taskList, columnList}` 5 项。**注意：决议文档现有 §13.8 字面要求"集中化"但实施未真集中**（调研报告节 6.3 列出 3 处分散）—— 本任务不解决"集中化怎么实施"（那是 5B 子任务），但**要在决议文档中明确"集合内容必须保持三处同步"作为契约**。

**修订纪律**：

- 保留决议文档原有的章节结构 / 编号 / 历史决议链路。**不要**删掉历史 §3.1.2 / §3.1.4 等条目，**改写**它们的字面内容；改写处必须用 markdown 标注 "（2026-05-28 修订：决策拍板 table 是 atom）" 之类便于后人追溯。
- 决议文档的字面拍板必须与生产契约（PDF-Note-Atom-v2）字面一致。**不允许**出现"决议说 X，但生产实现 Y"的新矛盾。
- 你的修订**不需要**触碰 `src/` 任何代码——本阶段是设计层拍板，实施留 5B。
- 修订**只能**进行字面修改 + 补登新条目。**不能**删整章 / 不能改 §1 背景 / 不能改 sub-phase 编号。
- 修订**必须**回答 6 个必答题：调研报告 §7.2.1 / §7.2.2 / §7.2.3 / §7.6.1 / §7.6.2 / §7.6.3——决议文档新版读完应该让任何读者能直接说出 6 题答案，不再有歧义。

### 产出 2：阶段 5A 拍板汇总文档

新建 `docs/tasks/2026-05-28-stage-5A-decision-026-amendment-summary.md`（**不超过 400 行**），写：

```markdown
# 阶段 5A：Decision 026 修订 + table 数据模型拍板汇总

## 1. 总指挥拍板的核心
   - table 是 atom（选项 A）
   - tableRow 不是 atom
   - row 信息通过 cell.attrs.rowIndex 表达

## 2. Decision 026 修订点逐条（位置 + 旧字面 + 新字面 + 修订理由）
   按本 prompt 任务 1-6 顺序列

## 3. 6 个必答题的最终答案
   §7.2.1 / §7.2.2 / §7.2.3 / §7.6.1 / §7.6.2 / §7.6.3 每题一段答案

## 4. tableCell.attrs schema 增量
   - 现有 attrs.id（已声明）
   - 新增 attrs.rowIndex: number(0-based)
   - 新增 attrs.colIndex: number(0-based)
   - tableHeader 同款

## 5. assemble 端 wrapTableCells 算法
   按 rowIndex 分组,每组包成一个 tableRow,所有 tableRow 包成 table 节点
   伪代码示意（不写真正的 TypeScript,5B 阶段才实施）

## 6. 给 5B / 5C 阶段的输入清单
   - 5B 实施时需要改的文件列表（基于本拍板,不再有歧义）
   - 5C paste id 共享 bug 与本拍板的关系（独立 / 共依赖？）

## 7. 留给后续 sub-phase 的 open question
   - 老 DB 数据 migration（不在本期）
   - STRUCTURAL_CONTAINER_TYPES 三处集中化（5B 子任务）
   - 其他在修订过程中发现的悬而未决问题
```

## 操作纪律（**违反任意一条立刻停手报告**）

### cwd 漂移防御

V2 仓库的 harness 多次 Bash 调用之间 cwd 不稳定，会漂到隔壁 V1 仓库 `/Users/wenwu/Documents/VPN-Server/KRIG-Note`（已发生 14+ 次事故）。漂了会读到错代码，误导整份决议修订。

**每一条 Bash 都必须以 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...` 开头**，不论上一条是什么。

**Read / Edit / Write 工具一律传绝对路径** `/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2/...`，不依赖 cwd。

V1 / V2 区分速判：

| V1 顶层 | V2 顶层 |
|---|---|
| `src/main/`、`src/renderer/`、`src/plugins/`、`@plugins/*` paths | `src/platform/main/`、`src/views/`、`src/capabilities/`、`src/drivers/`、`src/storage/`、`src/semantic/` |

git log / git status 看到 V1 特征立即停手：
- commit hash 出现 `47015ed8` / `7f47f42f` / 包含 `canvas-m2-polish` / `sticky-color-bar`
- `?? src/capabilities/` 单一 untracked + main "112 commits behind origin/main"
- `git remote -v` URL 是 `KRIG-Note.git`（V1）而非 `KRIG-Note-V2.git`（V2）

### 仓库 checkout 与分支纪律

- 仓库当前 checkout **已经在 main 分支**（HEAD `00489d6c`），**直接开始**，不要切分支。
- 你**可以**编辑 `docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md`（决议文档）
- 你**可以**新建 `docs/tasks/2026-05-28-stage-5A-decision-026-amendment-summary.md`
- 你**不可以**:
  - 修改 `src/` 任何源代码
  - `git commit` / `git checkout` / `git stash` / `git reset` / `git push`
  - 操作数据库
  - 改其它 docs 文档（如 PDF-Note-Atom 契约文档 / 调研报告 / MEMORY.md）

### 阅读纪律

- 必读输入文档 1-5 全部读完再开始修订
- 修订决议文档前先用 grep 确认你要改的字面位置（§3.1.2 / §3.1.4 / §3.4 / §6.1 / §13）在文档里的真实行号
- 修订**只能**走 Edit 工具（preserve markdown 结构）；不能 Write 整文件（会改掉历史结构）

### 完成标准

- 决议 026 文档已修订（diff 可在 `git diff` 里看到，但**不要 commit**）
- 汇总文档已写入 `docs/tasks/2026-05-28-stage-5A-decision-026-amendment-summary.md`（≤400 行）
- 6 个必答题的答案在汇总文档 §3 字面齐全
- 决议文档内部不再有"table 是不是 atom"的字面矛盾
- §13 已补登 2 条（"tableCell 跨 row 拼装实施" + "DB 历史数据 migration"）

完成后向调用方回复：决议文档修订处行号范围、汇总文档路径、6 题答案要点、是否发现修订过程中新增的悬而未决问题。

---

## Agent 配置建议（给调用方）

- **agent 类型**：`Plan`（架构师 / 设计 agent）
- **是否后台运行**：可后台。两份产出都是文件，完成时调用方会被通知
- **预期工作时间**：1-2 小时（决议全文阅读 + 字面修订 + 汇总写作）
