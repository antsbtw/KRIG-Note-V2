# 「导入到 Note」路径调研与统一方案

> 立项动机（2026-07-25，总指挥拍板）：代码块解析 bug 先在 **AI 提取**路径被发现并修复，随后调研证实**同一个 bug 在 Markdown 导入 / 网页剪藏路径原封不动地存在**——因为它们各用一套独立的 markdown→PM 转换器。这正是「同一问题在不同导入路径反复复发」的活证据。本文摸清所有「→ Note」的需求入口、梳理转换器分布、给出一条可靠的统一路径。
>
> 调研方法：三个并行 Explore agent（入口分布 / 转换器对比 / 写库路径与约束）+ 实战定位。入口分布 agent 因服务过载中断，该部分据已确认事实补全，缺口已标注 `【待补】`。

---

## 一、需求清单：所有「内容 → Note」的入口

按来源分组。每条：触发场景 → 入口 → 转换链路 → 落库 API。

### 1. AI 提取（AI 对话 → Note）
- **提取整页对话**：命令 `ai-view.extract-conversation`（`src/views/ai/ai-commands.ts:71`）。链路：extractor 抓 markdown → `aiMarkdownToNoteDoc`（转换器①）→ PM doc → 若右槽是 Note 走 `note-view.append-pm-nodes`，否则建 Thought 卡片。
- **右键单条提取**：命令 `ai-view.extract-turn`（`ai-commands.ts:187`）。链路同上，落 `append-pm-nodes`（右槽必须是 Note，否则提示）。
- **ai-sync**（Note 里问 AI 后同步回来）：`src/views/note/ai-sync-integration.ts` → `ai-sync-blocks` → 转换器①。

### 2. 网页剪藏（HTML 网页 → Note）
- Defuddle 提取正文 → markdown → `sanitizeDefuddleMarkdown`（`src/platform/main/content-extraction/sanitize.ts:12`）→ `markdownToAtoms`（转换器③，委托②）→ `createNotesBatch`。蓝本 mirro-desktop fullpage-capture。

### 3. 文件导入（Markdown / Word → Note）
- **Markdown 文件**：`src/views/note/markdown-import.ts` → `markdownToAtoms`（转换器③）→ `createNotesBatch`（批量，单事务，≤500 篇）。
- **Word**：`src/platform/main/word-import` → docx→HTML→turndown→markdown → `markdownToProseMirror`（转换器②）。落 import-cache 诊断。

### 4. PDF / eBook 提取（→ Note）
- `src/capabilities/content-extraction` / `src/platform/main/extraction/handlers.ts` → V1 atom 格式 → `atomsToProseMirror`（转换器④）→ `createNotesBatch`。

### 5. 编辑器内操作
- **新建 / 粘贴 / 拖拽**：走 `createNote` 或编辑器内 PM transaction，经 `auto-block-id-plugin`。
- **cross-view 插入**：命令 `note-view.append-pm-nodes` → 驱动 `insertNodesAtEnd/insertNodesAtCursorOrEnd`。

> 【待补】入口分布 agent 中断，粘贴/拖拽的精确入口文件、以及是否还有其它 `→ note` 路径（如 graph 节点转 note）需再扫一轮补全。

---

## 二、转换器分布：**5 套独立实现**（碎片化根源）

| # | 转换器 | 入口 | 文件:行 | 输入 → 输出 |
|---|--------|------|---------|-------------|
| ① | **AI Markdown Parser** | `ResultParser.parse` + `extractedBlocksToPmDoc` | `src/shared/ai-markdown-parser/result-parser.ts:23` / `blocks-to-pm-doc.ts:69` | markdown → ExtractedBlock[] → PM doc |
| ② | **通用 Markdown→PM** | `markdownToProseMirror` | `src/capabilities/text-editing/converters/md-to-pm.ts:116` | markdown → PMNode[] |
| ③ | **Markdown→Atoms** | `markdownToAtoms` | `src/capabilities/content-ingest/internal/markdown-to-atoms.ts:46` | markdown →(委托②)→ PmAtomDraft[] |
| ④ | **Atoms→PM** | `atomsToProseMirror` | `src/capabilities/text-editing/converters/atoms-to-pm.ts:542` | V1Atom[] → PMNode[] |
| ⑤ | **Web 剪藏链** | `sanitizeDefuddleMarkdown` →(③) | `src/platform/main/content-extraction/sanitize.ts:12` | HTML→markdown → PmAtomDraft[] |

其中 ①②③ 都是「markdown 字符串 → PM/atoms」，**平行独立、逐行自研、无共享**。③ 委托 ②；⑤ 委托 ③（即 ②）。① 完全独立。

### Block 支持差异（关键）

| Block | ① ResultParser | ② md-to-pm | ④ atoms-to-pm |
|-------|:---:|:---:|:---:|
| 代码块 | ✅ | ✅ | ✅ |
| **代码块·嵌套 fence** | ✅（2026-07-25 修） | **❌ 有 bug** | N/A |
| List 内嵌 block | ✅ | ❌ 简单 | flat+parentId |
| callout | ✅ | ❌ | ✅ |
| table | ✅ | ✅（零单元格行静默跳过） | tiptapContent 直装 |
| math | ✅ | ✅ | ✅ |

---

## 三、核心问题：同一 bug 跨路径复发（已证实）

**代码块嵌套 fence 配对 bug**：
- ChatGPT 把整段回复包成外层 ```` ```` ````markdown 里再套 ```` ``` ````mermaid。转换器逐行找闭栏时若不按 fence 长度配对，会把内层 ```` ``` ````mermaid 误当闭栏 → 产出空 codeBlock + 内容漏成正文。
- **① ResultParser**：2026-07-25 已修（`collectCodeBlock` 按开栏长度配对；`result-parser.ts:472+`），并加 `tests/ai-markdown-fenced-code.test.ts` 锁死。修复中一度把闭栏收严成「整行纯 backtick」，导致「提取只出第一段」回归（闭栏行带残留时吞到文末），已放宽为「起始连续 backtick 数 ≥ 开栏」。
- **② md-to-pm**：**同款 bug 未修**（`md-to-pm.ts:131-147` 直接扫 closing ```` ``` ````，无长度配对）。影响 **Markdown 文件导入 + 网页剪藏**。← 若不统一，从这两条路径导入必复现。

**其它隐患**：② 表格「零单元格行静默跳过」（可能误删正常行，违反 fail-loud）；schema 校验只靠 `PMNode.fromJSON()`，转换器产出错误时 schema 层拦不住（代码块 bug 就是这样溜过去的）。

---

## 四、写库真源与硬约束（统一路径的地基）

### 写入 API（3 个）
- `createNote(initialDoc, folderId)`：单篇，吃 PM doc envelope。`src/platform/main/note/capability-impl.ts:227`
- `createNotesBatch(items)`：批量，吃 `PmAtomDraft[]`，单事务、≤500 篇。同文件 `:955`。**批量导入主入口**。
- `note-view.append-pm-nodes`（→ 驱动 `insertNodesAtEnd/AtCursorOrEnd`）：往已开编辑器插 PM nodes。`src/views/note/note-commands.ts:399` / `src/drivers/text-editing-driver/api.ts:2083`

### 硬约束（都已在写库必经处收口）
1. **block 必须带 attrs.id**（否则 dissect/diff throw → 改动静默丢）。4 处注入：`auto-block-id-plugin`（编辑器 tx）、`injectIdsForCreate`（createNote）、`ensureBlockIds`（updateNote 兜底）、`injectBlockIdsIntoJson`（driver 插入前）。参见记忆 `[[project-imported-note-idless-autosave]]`。
2. **至多一个 isTitle 首块**：`enforce-single-title.ts`，在 updateNote + createNotesBatch 双路收口。参见 `[[project-note-single-title-invariant]]`。
3. **dissect 拒空 id / 重复 id**：fail loud。

---

## 五、可靠的统一导入路径（方案）

**目标**：所有来源 → 归一到唯一的 markdown→PM 真源 → 唯一的批量落库 API。让代码块这类解析 bug **只在一处修**。

### 收敛动作
1. **认定唯一 markdown→PM 真源**：留 **② `markdownToProseMirror`**（被文件导入/剪藏/Word 广泛使用），把 ① ResultParser 的正确实现（嵌套 fence 配对、List 内嵌 block、callout）**合并进去**，然后 **AI 提取改调 ②**，删掉 ① 的重复 block 解析。或反向——但必须收敛到一套。
2. **统一批量落库入口**：所有来源产出 → `PmAtomDraft[]` → `content-ingest` 层单一函数 → `createNotesBatch`。约束（单标题、block id）已在此层，不重复实现。
3. **补「转换正确性」这一关**：现在只靠 schema 校验，拦不住解析错误。统一真源后，用 `tests/ai-markdown-fenced-code.test.ts` 这类**契约测试**覆盖各 block 类型（代码块/嵌套 fence/表格/公式/callout/List 内嵌），作为唯一真源的回归网。

### 落点判断
统一入口落在 **`content-ingest` capability 层**（已是导入逻辑集中处）：`markdown(或其它源) → 唯一转换器 → PmAtomDraft[] → createNotesBatch`。编辑器内的 `append-pm-nodes` 是另一条「插入已开 note」的语义，保留，但其 markdown→PM 部分也复用同一真源。

### 分阶段（建议）
- **A**：✅**已完成（2026-07-25）**。把 ② md-to-pm 的嵌套 fence bug 按 ① 的实现补上（按开栏 backtick 长度配对；闭栏只看「起始数≥开栏」不要求整行纯 backtick，避免闭栏带残留吞到文末的回归）。**未**移植 ① 的「展开 markdown 包裹块」——那是 ChatGPT 特有习惯的补偿，通用导入应保真。锁死于 `tests/md-to-pm-fenced-code.test.ts`（4 绿）。注意：这只是止血，① ② 仍是两套独立实现，下次别的 block 类型 bug 仍会各犯一次 → 阶段 B 才根治。
- **B**：合并 ①→②（或反向），AI 提取改调统一真源，删重复。补契约测试。
- **C**：所有来源统一走 content-ingest → createNotesBatch，收敛落库入口。
- **D**：② 表格「零单元格行静默跳过」改 fail-loud（warn + 保留）。

---

## 附：相关记忆
- `[[project-markdown-import-unify]]` — 本方向的记忆索引
- `[[project-module-boundary-governance]]` — 模块边界治理总纲（本问题属其一）
- `[[feedback-fail-loud-no-fallback]]` — 静默跳过违反纲领
- `[[project-block-serialization-layering]]` — block→产物序列化分层能力地图
