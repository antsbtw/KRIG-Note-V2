# 阶段 5B 实施 Stage 6：text-editing 公开 API 收敛 + view 端切换到 content-ingest — 任务 Prompt

> 这份 prompt 给独立子会话执行。
> 调用方（用户/总指挥）：把整份文档作为 user message 发给新对话。

---

## 你的身份

你是 KRIG-Note V2 的**实施工程师**。本次任务是把 5B 设计 §节 4 Stage 6 字面落地为 TypeScript 代码 —— 删除 text-editing capability 公开导出的 import 转换器、切换 view 端调用方走 content-ingest API。

**Agent 类型**：`general-purpose`（**不是 Plan** — Plan 没有 Write/Edit 工具）。

## 上下文（必读，不要在产出里复述）

### 项目根 + 实施分支

- 仓库根：`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
- **实施分支**：`feature/import-refactor-stage-5B-6`（基于 main HEAD，含 Stage 1-5 合入）
- **重要**：分支需要由用户预先手动 `git checkout -b feature/import-refactor-stage-5B-6 main` 创建（harness sandbox 拦截 git checkout -b）。如果分支已就位你跳过此步，否则停下来请用户切。

### 5B 设计文档 §节 4 Stage 6 与现实之间的 GAP（必读关键）

**5B 设计 §节 4 Stage 6 字面要求**：
- 删除 `src/capabilities/text-editing/converters/md-to-pm.ts`、`atoms-to-pm.ts`、`sanitize-atoms.ts` 的 capability **公开导出**
- view 端 `markdown-import.ts` / `extraction-import.ts` 改走 `content-ingest` API
- `TextEditingApi` 删除 `markdownToProseMirror` / `atomsToProseMirror` / `sanitizeAtoms` 三个字段

**调研发现的 design gap**（5B 设计文档 §节 4 Stage 6 **没提**这个）：

`atomsToProseMirror` + `sanitizeAtoms` 还被 `src/capabilities/canvas-text-node/atom-bridge.ts` 用（**3 处调用**），用于**向后兼容 V1 NoteView Atom[] 持久化**（V1 画板节点存的是老 Atom[]，需要转 PM doc 给画板渲染）。这是**反向**语义（不是 ingest，是"已有 Atom[] → PM 拼装"），跟 ingest 路径不同。

### 用户拍板（写进 prompt，不是 subagent 决定）

**拆 atomsToProseMirror 方案 — 物理文件保留，capability 公开 API 删除，canvas 改走深路径 import**：

| 函数 | 物理位置 | TextEditingApi 字段 | canvas 怎么用 |
|---|---|---|---|
| `markdownToProseMirror` | `text-editing/converters/md-to-pm.ts` **保留** | **删除** | n/a（canvas 不用） |
| `atomsToProseMirror` | `text-editing/converters/atoms-to-pm.ts` **保留** | **删除** | 深路径 import：`from '@capabilities/text-editing/converters/atoms-to-pm'` |
| `sanitizeAtoms` | `text-editing/converters/sanitize-atoms.ts` **删除（content-ingest 已有副本）** | **删除** | 改走 `from '@capabilities/content-ingest/internal/sanitize-atoms'` |

**理由**（写进代码注释）：
- TextEditingApi 清爽：只剩 PM editor 驱动相关 API
- content-ingest 是 sanitize 的唯一归属（5B §7.1.3）
- text-editing/converters 物理文件保留 atoms-to-pm.ts / md-to-pm.ts 作为**capability 内部工具**（不再算"公开 API"），canvas-text-node + content-ingest 都通过深路径 import 使用 — 这与 content-ingest 自身已经深路径 import `markdownToProseMirror` 的模式一致（5B Stage 5 已落地）
- Stage 8 契约 rename `tiptapContent → pmContent` 时再决定要不要进一步动 atoms-to-pm（不在本期）

### 必读输入文档（必读顺序）

1. **5B 设计 §节 4 Stage 6**：[`docs/tasks/2026-05-28-stage-5B-import-converter-design.md`](2026-05-28-stage-5B-import-converter-design.md)
2. **5A 拍板汇总**：[`docs/tasks/2026-05-28-stage-5A-decision-026-amendment-summary.md`](2026-05-28-stage-5A-decision-026-amendment-summary.md)
3. **Stage 5 实施文档**：[`docs/tasks/2026-05-28-stage-5B-impl-5-prompt.md`](2026-05-28-stage-5B-impl-5-prompt.md)（了解 content-ingest API 已有形态）
4. **content-ingest 现状**：`src/capabilities/content-ingest/types.ts` + `src/capabilities/content-ingest/index.ts`（了解 markdownToAtoms / krigBatchToAtoms 签名、Atom / AtomFrom / KrigImportBatch drift 类型）
5. **既有 view 端调用**：
   - `src/views/note/markdown-import.ts:657 / :714`（2 处 `tea.markdownToProseMirror` 调用）
   - `src/views/note/extraction-import.ts:109 / :113`（2 处 `tea.sanitizeAtoms` + `tea.atomsToProseMirror` 调用）
6. **canvas-text-node 现状**：`src/capabilities/canvas-text-node/atom-bridge.ts:59 / :64 / :98`（3 处调用）

## 任务

### S6.1 改 `TextEditingApi`（删 3 个字段）

文件：`src/capabilities/text-editing/types.ts`

字面删除以下三个 `readonly` 字段：
- `markdownToProseMirror`
- `atomsToProseMirror`
- `sanitizeAtoms`

同步删除相关 jsdoc 注释（line 163-181 那段）。**不删** `PMDocNode` type 定义（canvas 还要用，从深路径 import）。

### S6.2 改 `text-editing/index.ts`

文件：`src/capabilities/text-editing/index.ts`

字面删除：
- `import { atomsToProseMirror } from './converters/atoms-to-pm';`
- `import { markdownToProseMirror } from './converters/md-to-pm';`
- `import { sanitizeAtoms } from './converters/sanitize-atoms';`（如果有）
- 三个对应的 export 字段

`atomsToProseMirror` / `markdownToProseMirror` 物理文件**不动**（capability 内部工具）。

### S6.3 删除 `text-editing/converters/sanitize-atoms.ts`

字面执行：

```bash
rm src/capabilities/text-editing/converters/sanitize-atoms.ts
```

content-ingest 已有副本（Stage 5 已落地），这里物理删原文件。

### S6.4 改 canvas-text-node 深路径 import

文件：`src/capabilities/canvas-text-node/atom-bridge.ts`

字面改 3 处调用，从走 `getTextEditing()` API 改为**深路径 import**：

```ts
import { sanitizeAtoms } from '@capabilities/content-ingest/internal/sanitize-atoms';
import { atomsToProseMirror } from '@capabilities/text-editing/converters/atoms-to-pm';
```

然后字面把 `api.sanitizeAtoms(...)` → `sanitizeAtoms(...)`，`api.atomsToProseMirror(...)` → `atomsToProseMirror(...)`。

若 `getTextEditing()` 调用后**只剩**这两个用途，删除 getTextEditing 调用 + import。若有其它残余用法，保留并删除字面失效的字段（你字面 grep 验证）。

### S6.5 改 view 端 markdown-import.ts 调 content-ingest

文件：`src/views/note/markdown-import.ts`

line 657 与 line 714 两处 `tea.markdownToProseMirror(...)` 调用：

**当前**：拿 PMNode[] → 装 DriverSerialized → `noteCap.createNote()`

**新**：拿 Atom[] → 留作 Stage 7 `createNotesBatch` 入口

**但 Stage 7 还没实施 `createNotesBatch`**，所以**本期 view 端切换需要兜底**：

- **选项 A**（推荐）：字面调 `content-ingest.markdownToAtoms()` 拿 Atom[]，然后**继续走旧 `noteCap.createNote(driverSerialized)` 路径** —— 用 `atomsToProseMirror`（深路径 import）把 Atom[] **临时**转回 PMNode[]，装 DriverSerialized。这个临时桥 Stage 7 才删。
- **选项 B**：保留旧 view 端逻辑（继续调 `tea.markdownToProseMirror`），等 Stage 7 一并切换。**但** Stage 6 字面要求"删 markdownToProseMirror"，B 实施不了。

走**选项 A**：

```ts
// 5B Stage 6 临时桥(Stage 7 createNotesBatch 实施时删除):
// content-ingest.markdownToAtoms 产 Atom[] -> 临时回 atomsToProseMirror 拼 PMNode[] ->
// 装 DriverSerialized -> 旧 createNote 单条入口.
import { markdownToAtoms } from '@capabilities/content-ingest';
import { atomsToProseMirror } from '@capabilities/text-editing/converters/atoms-to-pm';

// 替换原 `await tea.markdownToProseMirror(body)`:
const { atoms, warnings } = await markdownToAtoms(body);
if (warnings.length) console.warn('[markdown-import] markdownToAtoms warnings:', warnings);
const content = await atomsToProseMirror({ atoms });
```

**关键纪律**：临时桥**必须**带 jsdoc 字面登记 "5B Stage 6 临时桥;Stage 7 createNotesBatch 实施时删除"。

### S6.6 改 view 端 extraction-import.ts 调 content-ingest

文件：`src/views/note/extraction-import.ts`

类似 S6.5：

**当前**（line 109-113）：
```ts
const cleaned = tea.sanitizeAtoms(atoms);
pmContent = await tea.atomsToProseMirror({ atoms: cleaned });
```

**新**：走 content-ingest.krigBatchToAtoms（如果上层语义对得上 batch），或字面保留就地的 sanitize + atomsToProseMirror 但**改为深路径 import**：

```ts
import { sanitizeAtoms } from '@capabilities/content-ingest/internal/sanitize-atoms';
import { atomsToProseMirror } from '@capabilities/text-editing/converters/atoms-to-pm';

// 替换:
const cleaned = sanitizeAtoms(atoms);
pmContent = await atomsToProseMirror({ atoms: cleaned });
```

字面注释登记 "5B Stage 6 临时桥;Stage 7 createNotesBatch 实施时整段走 krigBatchToAtoms"。

**注意**：`extraction-import.ts` 的 `BatchInput`（line 59）字面是 `KrigImportBatch` 的 inline 副本（drift #3，content-ingest/types.ts 已 named）。本期**不强制收敛** inline → 命名 import（保持改动最小化，留 Stage 7 一并做）。

### Stage 6 验收

**子会话必须做的自验收**（用 Bash + 工具，不依赖 UI）：

#### V1：typecheck 全绿

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "src/main/ipc/handlers.ts\|src/renderer/shell/WorkspaceBar.tsx"
```

**期望**：0 行错误。

#### V2：TextEditingApi 三字段已删

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -n "markdownToProseMirror\|atomsToProseMirror\|sanitizeAtoms" src/capabilities/text-editing/types.ts
```

**期望**：0 命中（除非在删除的 jsdoc 残留里 — 那也应该删干净）。

#### V3：text-editing/index.ts 删除三 export

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -n "markdownToProseMirror\|atomsToProseMirror\|sanitizeAtoms" src/capabilities/text-editing/index.ts
```

**期望**：0 命中。

#### V4：sanitize-atoms.ts 原文件已删

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ls src/capabilities/text-editing/converters/sanitize-atoms.ts 2>&1
```

**期望**：`No such file or directory`。

#### V5：canvas-text-node 走深路径 import

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -n "sanitizeAtoms\|atomsToProseMirror" src/capabilities/canvas-text-node/atom-bridge.ts
```

**期望**：命中处全部走"直接函数调用"，不再走 `api.sanitizeAtoms` / `api.atomsToProseMirror`。

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -n "^import" src/capabilities/canvas-text-node/atom-bridge.ts | head -20
```

**期望**：含 `from '@capabilities/content-ingest/internal/sanitize-atoms'` + `from '@capabilities/text-editing/converters/atoms-to-pm'`。

#### V6：view 端 markdown-import.ts 临时桥就位

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -n "markdownToAtoms\|markdownToProseMirror\|atomsToProseMirror" src/views/note/markdown-import.ts
```

**期望**：含 `markdownToAtoms` 调用；**0** 处 `tea.markdownToProseMirror`（旧路径已切）；**含** `atomsToProseMirror` 临时桥调用。

#### V7：view 端 extraction-import.ts 临时桥就位

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -n "tea\.sanitizeAtoms\|tea\.atomsToProseMirror\|^import.*sanitizeAtoms\|^import.*atomsToProseMirror" src/views/note/extraction-import.ts
```

**期望**：**0** 处 `tea.sanitizeAtoms` / `tea.atomsToProseMirror`；含深路径 import 后的直接函数调用。

#### V8：全仓 grep 不再有公开 API 引用 `tea.markdownToProseMirror` / `tea.sanitizeAtoms` / `tea.atomsToProseMirror`

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -rn "\.markdownToProseMirror\|\.sanitizeAtoms\|\.atomsToProseMirror" src --include='*.ts' --include='*.tsx' | grep -v "node_modules\|content-ingest/internal\|text-editing/converters\|\\* "
```

**期望**：0 行命中（除注释外）。`text-editing/converters/` 内的递归调用 / atoms-to-pm.ts 内 `atomsToProseMirror` 自调用、content-ingest/internal/ 内副本不算 — 字面 grep -v 排除。

### Commit 纪律

完成全部 S6.1-S6.6 + V1-V8 验收 PASS 后，**单 commit 进 `feature/import-refactor-stage-5B-6` 分支**：

- commit message 字面标注："5B Stage 6 implementation — text-editing API deprecation + view migration to content-ingest"
- **不要** push
- **不要** merge 到 main
- 不要 commit 任何与 5B Stage 6 无关的文件（如 `docs/tasks/import-progress-ui-prompt.md`）

## 操作纪律（违反任意一条立刻停手报告）

### cwd 漂移防御

V2 仓库的 harness 多次 Bash 调用之间 cwd 不稳定，会漂到隔壁 V1 仓库。

**每一条 Bash 都必须以 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...` 开头**。

**Read / Edit / Write 工具一律传绝对路径** `/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2/...`。

V1 / V2 速判：V1 顶层有 `src/main/`、`src/renderer/`、`src/plugins/`；V2 顶层有 `src/platform/main/`、`src/views/`、`src/capabilities/`、`src/drivers/`、`src/storage/`、`src/semantic/`。

三联守门：

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && pwd && git remote -v | head -1 && git branch --show-current
```

### Sandbox 限制（已知）

harness sandbox 已知拦截：
- `git checkout -b` / `git switch -c`（**用户预先切**）
- 可能拦截 `tsc` / `git add` / `git commit`（如发生，stop and ask user）

遇到拦截**不要绕过、不要走 dangerouslyDisableSandbox**，停下来汇报让总指挥手动跑或授权。

### 实施纪律

**可以**：
- 在 `feature/import-refactor-stage-5B-6` 分支上修改 src/
- `rm src/capabilities/text-editing/converters/sanitize-atoms.ts`
- 跑 `npx tsc --noEmit` 自校验
- `git commit` 到本分支
- 跑 grep / 读源码

**不可以**：
- 切到其它分支（含 main）
- merge / cherry-pick / rebase
- `git push`
- 改设计文档 / 决议 026 / 任何 docs/
- 改 Stage 6 范围外的源代码（如改 `atoms-to-pm.ts` / `md-to-pm.ts` 物理文件内容 — 本期只删 capability API 公开导出 + 调用方切换，不动这俩物理文件逻辑）
- 操作数据库

### 完成标准

- 8 个 V1-V8 验收全部 PASS
- 单 commit 进 `feature/import-refactor-stage-5B-6` 分支
- 5B 设计 §节 4 Stage 6 字面要求 + 用户在本 prompt §"用户拍板"段拍的拆分方案字面落地
- canvas-text-node 路径继续工作（深路径 import）

完成后向调用方汇报：
- commit hash + 改动文件清单
- V1-V8 各项验收结果
- 实施过程中发现的新问题（含任何"拆 atomsToProseMirror 方案"实施时新发现的耦合点）
- 任何 5B 设计文档与现实情况不一致的发现

---

## Agent 配置建议（给调用方）

- **agent 类型**：`general-purpose`
- **是否后台运行**：可后台。完成时通知
- **预期工作时间**：1.5-2.5 小时（API 删除 + 4 处调用点切换 + 临时桥 + 验收）
