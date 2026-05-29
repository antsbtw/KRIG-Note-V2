# 阶段 5B：markdown / web → atom 公共转换器设计 — 任务 Prompt

> 这份 prompt 给独立子会话执行。你（执行者）拿到这份文档后请按"任务"一节执行。
> 调用方（用户/总指挥）：请把整份文档作为 user message 发给新对话即可。

---

## 你的身份

你是 KRIG-Note V2 的**架构师**（建议用 `Plan` agent 类型 — 与阶段 5A 同款）。

你不写源代码。你的产出是**一份完整设计文档**，回答 12 个具体问题（8 题 + 4 Q），形成"markdown / web 后台 → atom 公共转换器"的形式化设计。

实施留下游 sub-phase 做（refactor/import-system-rebuild 分支上）。

## 上下文（必读，不要在产出里复述）

### 项目根 + 当前状态

- 仓库根：`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
- 当前 main HEAD：`a224d98c docs(decision-026): table is an atom — amendment + 5A summary`
- 仓库 checkout **已经在 main 分支**，**直接开始**，不要切分支。

### 5A 已拍板的硬契约（不要重新讨论这些）

来源：[`docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md`](../RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md) 修订版 + [`docs/tasks/2026-05-28-stage-5A-decision-026-amendment-summary.md`](2026-05-28-stage-5A-decision-026-amendment-summary.md)

| 拍板项 | 字面 |
|---|---|
| table 自身 | **是 atom**（option A）;`attrs.id = ULID`;PM JSON `content = []` |
| tableRow | **不是 atom**（维持 STRUCTURAL） |
| row 边界信息 | `tableCell.attrs.rowIndex` + `tableCell.attrs.colIndex`（0-based 整数） |
| tableHeader | 与 tableCell 同模式（rowIndex=0 字面对应表头行） |
| STRUCTURAL_CONTAINER_TYPES | 5 项 `{tableRow, bulletList, orderedList, taskList, columnList}`（不含 table） |
| 三处同步契约 | `assemble-pm-doc.ts` / `build-auto-block-id-plugin.ts` / `atoms-to-pm.ts` 集合内容字面一致 |
| §6.1 跳层规则 | `tableCell.childOf → table atom`（字面成立） |
| assemble 算法 | 按 rowIndex 升序分组 → 组内按 colIndex 升序排序 → 重建 tableRow → push 到 table atom.content |
| DB 老数据 migration | 本期不实施（决议 §13.10 留独立 sub-phase） |
| 关键原则 | **决议层是契约源头，实施跟决议走，不是反过来** |

### 关键参考文档（必读顺序）

1. **生产契约**：[`docs/10-business-design/ebook/PDF-Note-Atom数据契约-v2.md`](../10-business-design/ebook/PDF-Note-Atom数据契约-v2.md) — V2 与 KRIG Knowledge Platform 后台之间已在生产的数据交换契约（13 atom type + InlineElement + 来源追溯字段）
2. **5A 拍板汇总**：[`docs/tasks/2026-05-28-stage-5A-decision-026-amendment-summary.md`](2026-05-28-stage-5A-decision-026-amendment-summary.md) — 必读 §6.1（5B 必改文件清单）和 §7（4 个 open question Q1-Q4）
3. **调研报告**：[`docs/tasks/2026-05-28-import-system-survey.md`](2026-05-28-import-system-survey.md) — 必读 §2（9 入口转换链路）/ §4（数据契约盘点）/ §6（反模式 12 条）/ §7.1 §7.3 §7.5（本期 8 题）
4. **决议 026 修订版**：[`docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md`](../RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md) — 重点 §3.1.1 / §3.4 / §6.1 / §13.9
5. **关键源码**（只读 verify）：
   - [src/capabilities/text-editing/converters/md-to-pm.ts](../../src/capabilities/text-editing/converters/md-to-pm.ts) — 现有 markdown → PM 转换器
   - [src/capabilities/text-editing/converters/atoms-to-pm.ts](../../src/capabilities/text-editing/converters/atoms-to-pm.ts) — 现有 atom JSON → PM 转换器
   - [src/capabilities/text-editing/converters/sanitize-atoms.ts](../../src/capabilities/text-editing/converters/sanitize-atoms.ts) — atom 入口归一化
   - [src/views/note/markdown-import.ts](../../src/views/note/markdown-import.ts) — markdown 导入业务编排
   - [src/views/note/extraction-import.ts](../../src/views/note/extraction-import.ts) — extraction（web 后台）导入业务编排
   - [src/platform/main/extraction/handlers.ts](../../src/platform/main/extraction/handlers.ts) — extraction main 端 IPC
   - [src/platform/main/note/dissect-pm-doc.ts](../../src/platform/main/note/dissect-pm-doc.ts) — PM doc → atom 拆分
   - [src/platform/main/note/assemble-pm-doc.ts](../../src/platform/main/note/assemble-pm-doc.ts) — atom → PM doc 拼装
   - [src/platform/main/note/capability-impl.ts:162 createNote](../../src/platform/main/note/capability-impl.ts) — 写库入口

## 任务

产出**一份**设计文档：

**文件路径**：`docs/tasks/2026-05-28-stage-5B-import-converter-design.md`

**长度上限**：1000 行（必要时可超，但不超 1200）

**结构**（按本顺序回答，不要打乱）：

---

### 节 0：本期设计的边界

明确写：
- 本设计**不实施代码**；产出是设计文档
- 本设计**回答 12 个具体问题**（8 题 + 4Q），下面会逐一列
- 本设计**必须与生产契约 PDF-Note-Atom-v2 兼容**——这是生产已在跑的契约，不允许搞个新设计跟它对不上
- 本设计**必须与 5A 拍板（table 是 atom + rowIndex/colIndex 等）字面一致**

### 节 1：8 个必答题逐题答案

#### §7.1.1 公共转换器输入格式：markdown 字符串 / PM 树 / 独立 AST？

回答时要说清楚：
- 选哪个 + 理由
- markdown 字符串作输入的好处与代价（最简单 / 但 V2 callout / column / mathVisual 等特有节点字面无 markdown 表达）
- PM 树作输入的好处与代价（已是 V2 内部格式 / 但绕了一圈又回到"markdown→PM→atom"原架构反模式）
- 独立 AST 作输入的好处与代价（最清晰 / 但要为它写新解析器）
- 是否可以**多输入**（不同源走不同输入，但输出共享 atom 集合）

#### §7.1.2 atom 是否应与 PM doc 完全脱钩？

- 选哪个 + 理由
- 脱钩的代价（view 端 atom→PM 拼装变厚 / 但 atom 层不依赖 PM schema 演化）
- 不脱钩的代价（atom 模型必须跟 PM schema 同步演化 / 但 view 拼装薄）
- 现状是哪一种？（PM 是 atom 的"派生展开形式"还是独立等价表征？）

#### §7.1.3 "markdown → atom 集合" 是否独立 capability？

- 选哪个 + 理由
- 现状：word-mammoth / word-pandoc / markdown 三入口已共用 renderer 端 importMarkdownBatch；extraction / paste / ebook 各自实现
- 独立 capability 的优势（注册 + 复用）vs 维持入口共享（耦合现状）
- 命名建议（如 `markdown-import` capability / `atom-ingest` capability / `content-parser` capability）

#### §7.3.1 三处 STRUCTURAL_CONTAINER_TYPES 是否收敛？收敛到哪一层？

- 选项 A：semantic 层（`@semantic/types`）单点 export，三处 import
- 选项 B：各层独立定义但用 TS 编译期 invariant 校验等价（如 `as const satisfies SameSet`）
- 选项 C：保持现状但加 CI 测试断言三处一致
- 选哪个 + 理由（一致性 vs 解耦 vs 演化弹性 三者权衡）

#### §7.3.2 §13.8 的 STRUCTURAL_REBUILD_RULES 集中化常量应该长什么样？

- 决议 §13.8 字面要求"集中可扩展位置"但实施未真集中
- 当前是 `wrapChildren` 内 if-else 链 + `wrapTableCells` 独立函数
- 是否走 `Map<containerType, (children, atomCtx) => wrapper>` 的可注册结构
- 各结构性容器的重建规则签名（输入 / 输出 / 上下文需要什么）
- 与 5A 新增的 rowIndex/colIndex assemble 算法如何融合

#### §7.5.1 PDF-Note-Atom 契约作统一 import 目标格式

- 这是**核心战略问题**：所有 import 路径（markdown / word / extraction / paste 等）是否先转成此契约再走单一 ingest pipeline？
- 契约现已覆盖：13 种 atom type + 5 种 InlineElement + from（pdfPage / extractedAt） + meta（createdAt / updatedAt）
- 已知不足：
  - `table.content.tiptapContent` 字段名是 V1 历史命名（项目纪律已废 Tiptap）— 是否要 rename？rename 影响哪些消费方？
  - 媒体类节点未覆盖：fileBlock / audioBlock / videoBlock / htmlBlock / tweetBlock / mathVisual / externalRef — 是否扩展契约？
- 决策：契约是否扩展、扩展什么、不扩展的部分怎么处理（如某入口产出契约外节点）

#### §7.5.2 batched createNote API

- 现状：每篇 1 次 createNote → N 次 storage.transaction → N 次 broadcast；大批量（1000 篇）触发 N 次 list refresh
- 需要 batched 写入 + 单次 broadcast API？
- API 签名建议（如 `createNotes(docs: Doc[], folderId: string | null): Promise<NoteInfo[]>` 单 transaction）
- 与 5A 拍板的 verifyNotePersisted 兜底如何集成

#### §7.5.3 import 路径的 progressive vs all-or-nothing 语义

- 现状：fire-and-forget 单篇失败 console.warn 跳过；用户不能 cancel；已写入的 note 不回滚
- progressive（边写边显示，失败跳过）vs all-or-nothing（全部成功才显示，任一失败回滚）
- 不同 import 类型的语义差异（markdown 目录批量 vs 单篇 docx vs extraction 单批）
- 是否给用户配置选项

### 节 2：4 个 5A 留 5B 拍板的 Open Question 答案

#### Q1：契约 §4.7 `table.content.tiptapContent`（嵌套子树）与 V2 内部"扁平 cell + rowIndex"模型的适配层归属

- 适配层在哪个 capability？建议 `text-editing` 内部还是新独立 capability？
- atoms-to-pm 的 table case 算法签名（输入 tiptapContent 子树 + 输出扁平 cell 数组 + 注入 rowIndex/colIndex）
- 是否需要反向 pm-to-tiptap 桥（用于跨设备同步 / 外部交换）
- 与 §7.5.1 的"契约统一格式"决策如何协调（如果契约扩展支持扁平形态，是否就不需要适配层）

#### Q2：tableCell.attrs.rowIndex 在 PM editor 内的实时维护策略

- 5A 推荐选项 B（dissect 期注入，PM tree 内字面不维护）
- 验证或推翻这个推荐：编辑期间 rowIndex 陈旧是否会触发 bug（如用户编辑表格的同时切到另一个 view 又切回来）
- 如果选 B，dissect 期注入算法的确切位置（dissect-pm-doc.ts 哪一段；与 §13.9 的 assemble 算法对称）
- 如果改选 A 或 C 的代价

#### Q3：table NodeSpec 加 attrs.id 后对 prosemirror-tables 第三方 plugin 的影响

- 不能在设计文档里"5B Stage 1 验证" 就完事——必须先调研 prosemirror-tables 源码 / 类型定义 / 已知 issue，给出**事前判断**
- `tableEditing()` / `columnResizing()` plugin 是否会触发 attr-equality 异常
- 已知风险点：行删除 / 列插入 / 表格内拷贝时第三方 plugin 是否会丢 attrs.id
- 如果有风险，缓解策略（如 plugin 包装层兜底 / id 走 PM mark 而非 attrs / 或承认风险并写测试覆盖）

#### Q4：tableHeader 单独的 rowIndex 字面规则

- 5A 推荐选项 A（共享 namespace），多行表头是边缘场景
- 验证或推翻：调研 PM schema `tableRow > (tableCell | tableHeader)+` 是否允许多行 tableHeader；实际 docx / markdown 导入是否产出多行 tableHeader 形态
- 如果选 A，多行表头的 rowIndex 字面规则（0/1/2... 与下方 cell 同序列）
- 如果改选 B，header 独立 namespace 怎么序列化（如 attrs.headerRowIndex）

### 节 3：公共转换器架构总图

回答完 8 题 + 4Q 后，画一张架构图（markdown / ascii art / mermaid 都可），整合所有决策，展示：

- 输入层：markdown 字符串 / Word docx / web 后台 KRIG_IMPORT batch / paste source doc / 用户编辑 / ebook 标注
- 解析/转换层：md→atoms / docx→md→atoms / KRIG_IMPORT(JSON)→atoms / paste source→atoms / PM edit→dissect / 标注→atoms
- 公共 ingest pipeline：atom 集合 → 校验 → diff → writeBatch
- 持久化层：storage.transaction → atom + edge 行
- 反向：DB → atom + edge → assemble → PM doc → view 渲染

明确每条流的边界、capability 归属、依赖关系。这张图应该让任何工程师能直接照着写实施代码。

### 节 4：实施路线图（不是实施代码，是路线图）

把 5A §6.1 必改文件清单（9 个改动点）+ 本期 5B 设计涉及的新增/重构整理成 Stage 1 / 2 / 3 / ... 顺序，每个 Stage：
- 涉及文件
- 改动性质（schema 改 / 算法改 / 新增模块 / 重构）
- Stage 间依赖
- 每个 Stage 的验收测试场景（沿用 5A §6.3 7 个测试场景 + 本期新加）

实施留 refactor/import-system-rebuild 分支做（不在本期 prompt 范围）。

### 节 5：本期未拍板的悬而未决问题

如果设计过程中发现新的 open question，本节列出，明确说"留下一 sub-phase 拍板"，不要 punt 到"实施时再说"。

### 节 6：与 5C 的接口

5C 范围：paste 跨 note id 共享 bug 修复（调研报告 §7.4 第 10 题）。本期 5B 设计是否与 5C 共依赖？写明：
- 哪些设计决策影响 5C
- 5C 是否能独立先行（不依赖 5B 任何决策）

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
- `?? src/capabilities/` 单一 untracked + main "112 commits behind origin/main"
- `git remote -v` URL 是 `KRIG-Note.git`（V1）而非 `KRIG-Note-V2.git`（V2）

### 设计层纪律

- 你**可以**新建 `docs/tasks/2026-05-28-stage-5B-import-converter-design.md` 作为本期产出
- 你**不可以**：
  - 修改 `src/` 任何源代码
  - 修改任何已存在的 docs（决议 026 / 调研报告 / 5A 汇总 / 其他设计文档）
  - `git commit` / `git checkout` / `git stash` / `git reset` / `git push`
  - 操作数据库
  - 创建新分支

### 设计纪律

- **每一题必须有"选哪个 + 理由"明确答案**，不要"推荐 X，但 Y 也可以"模糊。如果有多选项你选不动，明确写"留下一 sub-phase 拍板"不要 punt 到"实施时再说"
- **不允许引入 PM doc 作为存储输入这条反模式**（这是今天会话所有补丁失败的根因）
- **必须与生产契约对齐**（PDF-Note-Atom-v2）—— 如果你的设计与契约矛盾，必须明确写"建议扩展契约"或"建议修订契约"，不要悄悄绕过
- **必须与 5A 拍板字面一致**——table 是 atom / rowIndex/colIndex / 5 项 STRUCTURAL / 三处同步 / 决议层是契约源头
- 决策依据要**字面引用**调研报告 / 5A 汇总 / 决议 026 / PDF-Note-Atom 契约的具体节号 + 行号
- 不要"看起来合理"的设计——每个决策必须有**这个项目独特的事实**作为依据（如生产契约、5A 拍板、调研报告的 12 条反模式等）

### 完成标准

- 设计文档已写入 `docs/tasks/2026-05-28-stage-5B-import-converter-design.md`
- 8 题（§7.1.1 / §7.1.2 / §7.1.3 / §7.3.1 / §7.3.2 / §7.5.1 / §7.5.2 / §7.5.3）每题有明确答案 + 理由
- 4 Q（Q1-Q4）每个有明确答案 + 理由（不能"留 5B 验证"，必须事前判断）
- 节 3 公共转换器架构图齐全
- 节 4 实施路线图覆盖 5A §6.1 全部 9 个改动点 + 本期 5B 新加
- 节 5 列出本期发现的新 open question（如有）
- 节 6 写清 5C 关系

完成后向调用方回复：
- 设计文档路径
- 8 题答案摘要（一题一行）
- 4Q 答案摘要（一题一行）
- 节 3 架构图是否齐全
- 节 4 路线图 Stage 数 + 总 Stage 列表
- 节 5 新 open question 列表（如有）
- 节 6 与 5C 的接口（独立 / 共依赖）

---

## Agent 配置建议（给调用方）

- **agent 类型**：`Plan`（架构师 / 设计 agent，与 5A 同款）
- **是否后台运行**：可后台。文档产出，完成时调用方会被通知
- **预期工作时间**：2-3 小时（必读 5 份文档 + 关键源码 + 8 题深度回答 + 4Q 调研性回答 + 架构图 + 路线图）
