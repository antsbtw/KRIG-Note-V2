# 导入体系调研任务 Prompt（2026-05-28）

> 这份 prompt 给独立子会话执行。你（执行者）拿到这份文档后请按下面"任务"一节执行。
> 调用方（用户/总指挥）：请把整份文档作为 user message 发给新对话即可。

---

## 你的身份与上下文

你是 KRIG-Note V2 项目的代码侦探。你的产出**只是一份调研报告**，不写代码、不 commit、不切分支。

你的报告会喂给后续的"导入体系重做"工作（分阶段进行：先 markdown 与 web 公共抽象、再 word 接入）。所以你的报告必须**事实精确、契约清晰、不夹带方案建议**。

## 项目背景（只读，不要在报告里复述）

- **仓库根**：`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
- **平台**：Electron + TypeScript + SurrealDB sidecar
- **存储模型**：atom + edge 二元图。任何写库最终都走 `src/storage/surreal/storage.ts` 的 `storage.transaction(fn)` / `storage.putAtom` / `storage.putEdge`
- **note 的存储形态**：domain='pm' 的 container atom + 一批 block atom + 边集合（belongsToNote / nextSibling / childOf / hasNoteView / inFolder 等 predicate）
- **本仓库有 cwd 漂移风险**：harness 多次 Bash 调用 cwd 不稳定，容易漂到隔壁 V1 仓库 `/Users/wenwu/Documents/VPN-Server/KRIG-Note`。漂了之后会读到完全不同的代码，误导调研。**纪律**见下方"操作纪律"一节。

## 调研对象

**当前 main HEAD `3263b37f`**——所有已落地功能（含 word-import / markdown-import / backup-restore / ai-extraction 等）都在这里。**不要切到任何其他分支**（archive/2026-05-28-import-wrong-direction 和 refactor/import-system-rebuild 与本调研无关，archive 是错方向的归档、refactor 是新设计起点不在调研范围）。

进入后第一步：

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
git checkout main
git log --oneline -1   # 必须看到 3263b37f Merge fix/markdown-import-diagnostics — Word import pipeline hardening
git remote -v          # 必须看到 KRIG-Note-V2.git;若看到 KRIG-Note.git 立刻停手——cwd 漂到 V1 了
pwd                    # 必须是 /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
```

任意一条不符立刻停手向调用方报告。

---

## 任务

产出报告 `/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2/docs/tasks/2026-05-28-import-system-survey.md`（**不 commit、不切分支**）。

报告内容覆盖下面 7 节。

### 节 1：所有"写库入口"清单

列出**所有调用 `noteCap().createNote` / `noteCap().updateNote` / `noteCap().deleteNote` / `noteCap().moveNote` 的代码位置**。每一条记录写：

- **文件:行号**（用 markdown link 格式 `[file.ts:123](src/path/to/file.ts#L123)`）
- **触发场景**：用户手动操作 / IPC 推送 / 自动 / 测试
- **调用前 doc 的产出方式**：
  - 经过 PM editor schema 实例化 + buildAutoBlockIdPlugin？（即"PM editor 路径"）
  - 还是绕过 editor，手工拼 JSON（即"裸 JSON 路径"，如 `markdownToProseMirror` / `atomsToProseMirror`）
- **传入 createNote 的 PmPayload 中 block 节点是否带 `attrs.id` 字段**

特别注意区分**真实运行代码**与**测试/迁移代码**。

同样列出**所有绕过 capability 直接调 `storage.transaction` / `storage.putAtom` / `storage.putEdge` 的位置**（migration、debug 工具、test fixtures、特殊 capability 等）。

### 节 2：转换链路对照表

对节 1 中每个入口，用统一格式画出它的转换链路。例：

```
入口: File → Import Word (mammoth)
   触发: 用户菜单点击
   main: src/platform/main/word-import/index.ts:runImportMammoth
   ↓ docx → mammoth.convertToHtml + turndown → markdown 字符串
   ↓ IPC MARKDOWN_IMPORT_RUN 推 ScannedFile[] 给 renderer
   renderer: src/views/note/markdown-import.ts:importMarkdownBatch
   ↓ ScannedFile → markdownToProseMirror(content) → PMNode[]
   ↓ wrap 成 { type:'doc', content: PMNode[] } 再 wrapPmDoc 进 DriverSerialized 信封
   ↓ noteCap().createNote(initialDoc, folderId)
   main: src/platform/main/note/capability-impl.ts:createNote
   ↓ unwrapPmDoc → injectIdsForCreate
   ↓ storage.transaction:
       - putAtom container (payload=empty doc + cached title)
       - putEdge hasNoteView
       - putEdge inFolder (if folderId)
       - fullCreateDiff → applyDiff → putAtom + putEdge 每个 block
   ↓ DB: container atom + N block atom + 边集合
```

至少要画出：
- Import Word (mammoth)
- Import Word (pandoc, High Quality)
- Import Markdown...
- 用户在 NoteView 手动 + 新建
- 用户在 NoteView 编辑既有 note
- AI extraction（ai-extraction capability 走的路径）
- backup-restore（恢复时怎么写库，是否绕过 capability）
- 如有找到 web JSON 导入（见节 3）也画出

### 节 3：寻找 "web 后台 JSON 文件导入" 路径

用户记得历史上做过一个**从 web 后台导出的 JSON 格式文档**的导入处理方法，但不记得具体在哪。请定位它。

候选关键词（grep / find / git log）：

- `import.*json` / `loadJson` / `restoreJson` / `parseJson`
- File 菜单注册（`menuRegistry.registerCommand` / `file.import`）
- extraction 相关（特别是 ai-extraction，可能有 JSON 输入路径）
- V1 兼容性导入（`tiptapContent` / `v1-import` / `legacy-import` / `tiptap-json`）
- web 后台（`web-import` / `web-export` / `share-import`）
- `git log --all --oneline | grep -iE "json|import"` 翻 commit 历史

**找到后必须提取数据契约**：
- 输入 JSON 格式定义在哪？schema 文件？interface？示例文件？
- 这个契约定义了什么（atom 数组？PM doc？某种自定义 block 数组？）
- 这个契约是否已经规范化、可作为未来 markdown / word 导入的统一目标格式？

如果**没找到**：明确写"未找到"并说明 grep 范围、git log 范围、确认无遗漏的依据。

### 节 4：当前数据契约盘点

列出 V2 现有的"note / 写库"相关数据契约。包括但不限于：

- `decision 026`（block atomization）——找到设计文档（可能在 `docs/`、可能在 `src/platform/main/note/DESIGN.md` 等），摘录关键不变量
- `@semantic/types`：`AtomEntity` / `EdgeEntity` / `PmPayload` / `AtomDomain` 等的定义
- `src/storage/surreal/schema.ts`：DB schema 层约束
- `src/platform/main/note/dissect-pm-doc.ts` 的 `STRUCTURAL_CONTAINER_TYPES` 和 `shouldGenerateAtom`、`assemble-pm-doc.ts` 的 `wrapChildren` / `wrapTableCells`
- `src/drivers/text-editing-driver/plugins/build-auto-block-id-plugin.ts` 的 `STRUCTURAL_CONTAINER_TYPES` 和 `shouldHaveId`
- 各个 NodeSpec 的 `attrs.id` 字段声明（在 `src/drivers/text-editing-driver/blocks/*/spec.ts`）

对每条契约：
- 它**强制**什么？（如"每个 block atom 必有 attrs.id"）
- 它假设输入**已经满足**什么？（如 dissect 假设输入 doc 已经过 buildAutoBlockIdPlugin）
- 哪些位置**消费**这个契约？哪些位置**生产**应该满足这个契约的数据？

特别回答：**当前 markdown-import / word-import 调用 createNote 时传的 PmPayload 是否满足这些契约？哪里满足、哪里漂了？**

### 节 5：table 结构丢失 bug 根因层级定位

bug 重现（已观测）：
- 用户导入一份含 GFM 表格的 markdown（或 word 转出来的 markdown）
- `markdownToProseMirror` 转成 PM doc 后，顶层是 `table > tableRow > tableCell` 三层嵌套子树（正常）
- 该 PM doc 传给 `createNote` → `dissectPmDoc` → 写入 SurrealDB
- 写完后 DB 里：container atom 下挂了一堆 tableHeader / tableCell **直接作为顶层 block**（belongsToNote 直挂 container），**没有 table atom，没有 tableRow atom**
- 重启后 `assemblePmDoc` 拿一堆顶层 tableCell 拼不回 `table > tableRow > cell` 嵌套，**渲染塌陷**

请确认根因层级，并写明：

- dissect 端为什么 table / tableRow 没生成 atom？看 `dissect-pm-doc.ts:STRUCTURAL_CONTAINER_TYPES` 和 `processChildren` 的逻辑
- assemble 端为什么拼不回？看 `assemble-pm-doc.ts:wrapChildren` 注释（line 108-109 等）和 `wrapTableCells`
- `decision 026` 是否有"§6.1 Open Question / tableCell 跨 row 拼装的真实信息丢失"这类自陈未完成的设计登记？如果有，摘录出来
- 这条 bug 在**用户 NoteView 编辑路径**会触发吗？为什么？（推测：编辑路径每次 updateNote 走 diffBlockTree 而非 fullCreateDiff，dissect 一样会压平，但用户不重启所以看不见——请验证或否定这条推测）

### 节 6：暴露的反模式 / 设计问题清单

把调研中观察到的设计层问题列出来。不写"怎么修"，只写"这里有问题"。预期会出现的几条（如果你确认事实存在，按下面框架写；如果你不能确认，标"待确认"）：

- **markdownToProseMirror 是否定位是 view 层（PM 渲染）的反向，被错误地用作 "存储输入"** 的中间格式
- **dissectPmDoc / assemblePmDoc 的输入约束**（要求 PM editor 已注入 id）是否有文档化？markdown-import 是否在违反这个约束？
- **三个 STRUCTURAL_CONTAINER_TYPES 集合**（在 plugin、dissect、可能还有别处）是否物理上分散，未来加新 block type 时容易漂？
- **`injectIdsForCreate`**（如果它存在）的语义是什么？它是补丁吗？补的是什么洞？
- 每个导入入口（word-mammoth / word-pandoc / markdown / web JSON 如有）是否都"自己实现了一套 markdown→PM→atom"逻辑而非复用公共转换？
- 是否存在"应有但缺失"的 capability/抽象层？例如"markdown → atom 集合"是否本应是个公共能力而非每个 import 入口自己组装？

### 节 7：给"重做工作"的输入清单

不写方案，写**"重做时必须回答的问题"** 列表。例：

- "未来公共的 markdown → atom 转换器，输入应该是 markdown 字符串还是某种 AST？为什么？"
- "atom 是否应该和 PM doc 完全脱钩，还是保留某种 1-1 映射方便 view 层渲染？"
- "table 的 atom 模型——table 自身是 atom 还是整张表一个 atom？两种选项各自的代价？"
- "JSON 导入的契约（如找到）是否能作为统一输入格式，所有 import 路径先转成它再走？"
- "现有 dissect / assemble / build-auto-block-id-plugin 三处 STRUCTURAL_CONTAINER_TYPES 是否应该收敛？收敛到哪里？"

---

## 操作纪律（**违反任意一条立刻停手报告**）

### cwd 漂移防御

V2 仓库的 harness 多次 Bash 调用之间 cwd 不稳定，会漂到隔壁 V1 仓库 `/Users/wenwu/Documents/VPN-Server/KRIG-Note`（已发生 14+ 次事故）。漂了会读到错代码，误导整份调研。

**每一条 Bash 都必须以 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...` 开头**，不论上一条是什么。

**Read 工具一律传绝对路径** `/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2/src/...`，不依赖 cwd。

V1 / V2 区分速判：

| V1 顶层 | V2 顶层 |
|---|---|
| `src/main/`、`src/renderer/`、`src/plugins/`、`@plugins/*` paths | `src/platform/main/`、`src/views/`、`src/capabilities/`、`src/drivers/`、`src/storage/`、`src/semantic/` |

git log / git status 看到 V1 特征立即停手：
- commit hash 出现 `47015ed8` / `7f47f42f` / 包含 `canvas-m2-polish` / `sticky-color-bar`
- `?? src/capabilities/` 单一 untracked + main "112 commits behind origin/main"
- `git remote -v` URL 是 `KRIG-Note.git`（V1）而非 `KRIG-Note-V2.git`（V2）

任何 `git checkout` / `git stash` / `git reset` / `git rebase` / `git push` 之前必须三联守门：
```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && pwd && git remote -v | head -1
```

### 不写代码、不 commit、不切分支

你只读、grep、git log、写报告 .md 文件。

- **不要修任何 `.ts` / `.tsx` / `.js` 等源文件**
- **不要 git commit**（即使你写了 .md 报告也只是 untracked 文件不 commit）
- **不要切分支**（一直待在 main = 3263b37f）
- **不要建分支**
- **不要碰数据库**（不连 surrealdb、不查 SQL、不删 krig-data）

### 报告纪律

- 写到 `/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2/docs/tasks/2026-05-28-import-system-survey.md`（用 Write 工具，绝对路径）
- 报告**不超过 1200 行**（避免膨胀，但比"严格 800 行"宽松一些）
- 所有文件引用用 markdown link 格式 `[file.ts:42](src/path/to/file.ts#L42)`
- 写**事实**，不写"我建议怎么修"——重做策略由总指挥后续阶段拍板
- 节 5 的 bug 根因层级，要明确写到"是 dissect 设计假设违反 + decision 026 §6.1 自陈未完成"这种**层级清晰**的判断，不写"我感觉是 XXX 问题"

### 完成标准

- 报告文件存在
- 七节齐全
- 节 3 有明确结论（找到 = 详写契约；未找到 = 写明 grep 范围 + 否决依据）
- 节 5 根因层级清晰
- 节 7 是"问题列表"不是"方案列表"

完成后向调用方回复：报告路径、节数完整、节 3 web JSON 结论、节 5 根因结论。

---

## Agent 配置建议（给调用方）

- **agent 类型**：`general-purpose`（不是 Explore——本任务需要写中等长度报告 + 多步推理 + 提取契约，Explore 只读片段会漏）
- **是否后台运行**：可后台。报告 .md 是文件产物，完成时调用方会被通知
- **预期工作时间**：可能 30 分钟到 1 小时（grep + 多文件 Read + 写报告）
