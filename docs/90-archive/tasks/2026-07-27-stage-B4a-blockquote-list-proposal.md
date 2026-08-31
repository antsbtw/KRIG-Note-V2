# 阶段 B4a 第一步方案 — blockquote / list 统一模型（待指挥拍板）

> 本文档只做**调研 + 方案**，**方案通过前不改代码**（B4a prompt 硬要求）。
> 拍板项在文末「决策请求」，指挥拍板后再进第二步实现。

## 0. 调研基线

- 分支 `feat/multi-window-step2`，已含 B1/B2/B3（B3 + embedType 修复已合并，commit `134fb774`）。
- 四路径与所走 pipeline（grep 消费方确认）：
  - **AI 提取** → ①（`ResultParser` → `ExtractedBlock` → `extractedBlocksToPmDoc`）：`ai-sync-blocks.ts` / `ai-commands.ts` / `ask-orchestrator.ts`
  - **文件导入 / 网页剪藏 / Word** → ②（`markdownToProseMirror`）：`markdown-import` / `content-extraction/import-pipeline` / `word-import/converter*`

## 1. blockquote — ①② 现状（方向相反）

| 维度 | ① AI 提取（result-parser.ts:154-192 + blocks-to-pm-doc.ts:115-126） | ② 文件/剪藏/Word（md-to-pm.ts:328-354） |
|---|---|---|
| 模型 | **inline-only**：`> text` → `blockquote > paragraph > inline`，多行 join 成一段 | **递归任意 block**：剥 `>` 后递归 `markdownToProseMirror`，内可含 code/math/heading/list |
| 内嵌 code/math | ❌ 不支持（当纯文本 inline） | ✅ 支持（CommonMark 兼容） |
| GitHub alert `> [!NOTE]` | ✅ → callout（B2 已统一进核） | ✅ → callout（B2 已统一进核） |
| schema 支持 | blockquote `content: 'block+'`（允许任意 block）——**①在underuse** | 同左，② 正确使用 |

**schema 事实**：`blockquote/spec.ts content:'block+'` → 递归模型是 schema 原生支持的；① 的 inline-only 是**能力缺失**，非设计约束。

## 2. list — ①② 现状（恰好反过来）

| 维度 | ① AI 提取（result-parser.ts:524-686 + blocks-to-pm-doc.ts:237-256） | ② 文件/剪藏/Word（md-to-pm.ts:356-409） |
|---|---|---|
| item 内嵌 block（math/code/image/table/多段落） | ✅ 支持（`collectListItemContent` + `ExtractedListItem.blocks` 递归） | ❌ 单行：逐行剥标记 → 单 paragraph |
| 嵌套子列表（list in list） | ❌ **不支持**（`ExtractedListItem` 无 `items` 字段；深缩进 `- x` 被 flatten 成同级项） | ❌ 不支持（同 flatten） |
| task list `- [ ]` | ❌ **完全没有**（`ExtractedBlock` 无 taskList 类型；`- [ ] x` 当普通 bullet，`[ ] x` 进正文文本） | ✅ 支持（taskList > taskItem，带 checked + createdAt） |
| schema 支持 | listItem `content:'block+'`（允许嵌套 block + 子 list）——① 用了 block、未用子 list | 同左，② 只用单 paragraph |

**两侧都不支持真正的嵌套子列表**（都 flatten）。① 强在「item 内嵌非列表 block」，② 强在「task list」。**这不是谁包含谁**，是各有一块对方没有的能力。

## 3. 统一方案（推荐取「能力并集」，而非二选一）

prompt 问「采①还是采②」，但调研发现 blockquote 和 list 的强弱**不在同一侧**，且底层 schema 都支持更强模型。硬二选一会**丢能力**（采②的 list 会丢①的 item 内嵌 block；采①的 list 会丢②的 task list）。故推荐：

### 3.1 blockquote → 采 ② 递归模型（进核）
- 核加 `parseBlockquote`：剥 `>`（沿用 ② 的 `trimStart` 容错防无限递归）后**递归调 `markdownCore`**（sync，无 async）。
- ①②都改调核。
- **输出结构变更（显式）**：
  - **① AI 提取的 blockquote 会从 inline-only 变递归**。绝大多数 AI blockquote 是纯文本 → `blockquote > paragraph > inline`，**输出不变**；仅当 AI 在 `>` 内写了 code/math/heading（罕见）时，从「压成一段文本」升级为「真 code/math 子块」——这是**能力增强**，非丢内容。
  - ② 递归模型**不变**。

### 3.2 list → 采「① 内嵌 block ∪ ② task list」并集（进核）
- 核加 `parseList`：识别 bullet/ordered/**task**（task 从 ② 移植）；item 内容用 ① 的 `collectListItemContent` 思路，内嵌非列表 block **递归调 `markdownCore`**（sync）。
- **子列表**：两侧现状都 flatten，本任务**保持 flatten**（不新增嵌套子列表能力，避免范围膨胀；真嵌套子列表另立项）。
- **输出结构变更（显式）**：
  - **② 文件/剪藏/Word 的普通单行 list**：`listItem > paragraph`，**逐字段不变**（并集里单行仍走单 paragraph 分支）。仅当 item 后跟缩进的 code/math/table 时，② 从「丢/断成同级块」升级为「item 内嵌子块」——**能力增强**。
  - **② 的 task list**：保持不变（taskItem + checked + createdAt 语义照搬进核）。
  - **① AI 提取**：新增 task list 识别（`- [ ]` 从「bullet + 正文 `[ ]`」变「真 taskItem」）——**能力增强 + 输出结构变**（这条要重点实机验 AI 提取）。① 的 item 内嵌 block 保持。

### 3.3 核纯 sync 如何保证
- blockquote/list 内容递归调 `markdownCore`（B1 的 sync 入口），**全程无 async**；媒体本地化仍在各自外壳（B3 已分层，list item 内的 image 由 caller 外壳 resolve，核只产原始 src）。
- 无限递归防护：沿用 ② 的 `replace(/^\s*>\s?/, '')` 容错剥前缀（B2 注释记录的 relay-design-v2 栈溢出根因已修）；list 递归只对「item 内非列表行」下钻，不对 item marker 行递归，无自吞。

## 4. 回归影响 + 四路径验法

| 路径 | pipeline | blockquote 影响 | list 影响 | 手验步骤 |
|---|---|---|---|---|
| AI 提取 | ① | 纯文本引用不变；`>` 内 code/math 升级 | **task list 新增**（重点）；item 内嵌 block 不变 | 提取一段含 `> 引用`、`- [ ] 任务`、`1. 项\n  ```code```` 的 AI 回复，核对落库节点 |
| 文件导入 | ② | 不变 | 普通 list 不变；item 缩进子块升级 | 导入含 blockquote + 多级 list 的 .md，核对 |
| 网页剪藏 | ② | 不变 | 同上 | 剪藏含引用/列表的网页 |
| Word | ② | 不变 | 普通 list 不变 | 导入含列表的 .docx |

**回归红线**：② 三路径的**普通单行 list**、**普通递归 blockquote** 必须逐字段不变（契约测试断言）；① 的 **task list 新增**是有意的输出结构变更，需实机确认 AI 提取不炸。

## 5. 决策请求（请指挥拍板）

1. **blockquote**：采 ② 递归模型（推荐）？还是保留 ① inline-only？
2. **list**：采「① 内嵌 block ∪ ② task list」并集（推荐）？还是硬二选一（会丢一侧能力）？
3. **子列表嵌套**：本任务保持 flatten、真嵌套另立项（推荐）？还是本任务一并做？
4. **① task list 新增**是有意的输出结构变更（`- [ ]` 从正文文本变真 taskItem）——确认可接受？

拍板后我进第二步实现（进核 + ①②改调核 + 契约测试 + 四路径回归说明），分支 `feat/markdown-core-b4a`。
