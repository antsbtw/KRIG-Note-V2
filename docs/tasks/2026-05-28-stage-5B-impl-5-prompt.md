# 阶段 5B 实施 Stage 5：新建 content-ingest capability 骨架 — 任务 Prompt

> 这份 prompt 给独立子会话执行。
> 调用方（用户/总指挥）：把整份文档作为 user message 发给新对话。

---

## 你的身份

你是 KRIG-Note V2 的**实施工程师**。本次任务是把 5B 设计 §节 4 Stage 5 字面落地为 TypeScript 代码 —— 新建 `content-ingest` capability 骨架，迁入 sanitize-atoms，新增 table-adapter / markdown-to-atoms / krig-batch-to-atoms 三个 internal 模块。

**Agent 类型**：`general-purpose`（**不是 Plan** — Plan 没有 Write/Edit 工具）。

## 上下文（必读，不要在产出里复述）

### 项目根 + 实施分支

- 仓库根：`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
- **实施分支**：`feature/import-refactor-stage-5B-5`（基于 main HEAD `26274c04`，即 Stage 1-4 merge 后的新 main）
- 仓库 checkout 当前在 `main`；**你第一步必须 `git checkout -b feature/import-refactor-stage-5B-5 main`**

### 5B 设计 §节 4 Stage 5 字面要求（必须字面遵守）

| 改动项 | 字面细节 |
|---|---|
| 新建目录 | `src/capabilities/content-ingest/` |
| `types.ts` | 节 3.3 API 契约：`ContentIngestApi { markdownToAtoms / krigBatchToAtoms }` |
| `index.ts` | capability 注册 + slot 名 `content-ingest`，模仿 `src/capabilities/media-storage/index.ts` 末尾的 `capabilityRegistry.register({ id, api })` 套路 |
| `internal/sanitize-atoms.ts` | 从 `src/capabilities/text-editing/converters/sanitize-atoms.ts` **复制**（不删原文件 — 那是 Stage 6 的事），沿原逻辑不动 |
| `internal/table-adapter.ts` | Q1 新模块。Q1 §3 字面签名 + 算法步骤 |
| `internal/markdown-to-atoms.ts` | 包含原 `markdownToProseMirror` 内部使用 + 新 `pmToAtoms` 局部转换（类 dissect 但不写库） |
| `internal/krig-batch-to-atoms.ts` | 包装 sanitizeAtoms + tableAdapter + atoms 归一化 |

### 5B 设计 §节 3.3 ContentIngestApi 字面签名（不允许 drift）

```ts
interface ContentIngestApi {
  markdownToAtoms(md: string, options?: {
    /** 强制首块 isTitle paragraph (markdown-import.ts:492 当前逻辑迁入) */
    titleHint?: string;
    /** from 信息（不指定时 from.extractionType='markdown' + extractedAt=Date.now()） */
    from?: Partial<AtomFrom>;
  }): Promise<{ atoms: Atom[]; warnings: string[] }>;

  krigBatchToAtoms(batch: KrigImportBatch): Promise<{
    chapters: Array<{
      title: string;
      bookName: string;
      atoms: Atom[];
      warnings: string[];
    }>;
  }>;
}
```

**禁止**：本 capability 不允许导出 PM doc / PMNode[] / DriverSerialized 形态的 API（与 5B §7.1.2 脱钩规则一致）。

### Q1 table-adapter 字面契约（5B 节 2 Q1 §2-3）

```ts
interface TableAdapterInput {
  /** 契约 table.content.tiptapContent: PMNode[]，顶层 tableRow */
  tiptapContent: unknown[];
  /** 父 atom id（table 自身的 ULID，给 cell.parentId 用，可选） */
  tableAtomId?: string;
  /** 来源信息（透传到生成的 cell atoms） */
  from?: AtomFrom;
}

interface TableAdapterOutput {
  /** table atom 自身（content=[] + attrs.id 占位 null） */
  tableAtom: Atom;
  /** cell / header atoms（带 attrs.rowIndex / colIndex / id 占位 null） */
  cellAtoms: Atom[];
  /** 边集：cellAtom → tableAtom 的 childOf */
  childOfEdges: Array<{ subjectId: string; objectId: string }>;
}

function tableAdapter(input: TableAdapterInput): TableAdapterOutput;
```

算法步骤（5B Q1 §3 字面）：
1. 遍历 tiptapContent 顶层 tableRow，rowIdx 从 0 起
2. 遍历每 tableRow 的 children（tableCell / tableHeader），colIdx 从 0 起
3. 字面生成 `cellAtom = { id: null (待 inject), type: 'tableCell'|'tableHeader', content: { pmContent: cell.content }, parentId: tableAtomId, from, attrs: { rowIndex, colIndex, colspan, rowspan, colwidth, align, id: null } }`
4. 生成 childOf 边
5. 不再生成 tableRow atom（5A 拍板 tableRow 不是 atom）

**注**：Stage 5 不做反向 pm-to-tiptap 桥（5B Q1 §4 拍板）。

### 必读输入文档（必读顺序）

1. **5B 设计 §节 3 + §节 4 Stage 5**：[`docs/tasks/2026-05-28-stage-5B-import-converter-design.md`](2026-05-28-stage-5B-import-converter-design.md) — 节 3.3 API 契约 / 节 2 Q1 (table-adapter) / 节 4 Stage 5 字面任务清单
2. **5A 拍板汇总**：[`docs/tasks/2026-05-28-stage-5A-decision-026-amendment-summary.md`](2026-05-28-stage-5A-decision-026-amendment-summary.md) — table 是 atom / tableRow 不是 atom 等硬契约
3. **既有 sanitize-atoms.ts 源码**：`src/capabilities/text-editing/converters/sanitize-atoms.ts`（迁入参考；字面复制不改逻辑）
4. **既有 markdownToProseMirror 源码**：`src/capabilities/text-editing/converters/md-to-pm.ts`（参考，了解现有 markdown → PMNode[] 算法；Stage 5 字面**不动** md-to-pm.ts，本期只在 content-ingest 内部 import 它）
5. **既有 capability 骨架范例**：`src/capabilities/media-storage/index.ts` + `src/capabilities/media-storage/types.ts`（最简约的 capability 注册模板）
6. **AtomFrom / Atom / KrigImportBatch 类型定义位置**：先 grep 定位（`grep -rn "interface AtomFrom\|type AtomFrom" src --include='*.ts'` / 同理 Atom / KrigImportBatch），找到后 import；不要自己另起 type alias

## 任务

### S5.1 新建目录骨架

```
src/capabilities/content-ingest/
  ├─ index.ts
  ├─ types.ts
  └─ internal/
      ├─ sanitize-atoms.ts
      ├─ table-adapter.ts
      ├─ markdown-to-atoms.ts
      └─ krig-batch-to-atoms.ts
```

### S5.2 `internal/sanitize-atoms.ts` — 字面复制

字面执行：

```bash
cp src/capabilities/text-editing/converters/sanitize-atoms.ts src/capabilities/content-ingest/internal/sanitize-atoms.ts
```

然后**只改头部 jsdoc 注释**加一行登记：

```ts
// 2026-05-28 5B Stage 5 字面复制自 src/capabilities/text-editing/converters/sanitize-atoms.ts;
// Stage 6 字面删除 text-editing 内原文件 + 改 view 引用走 content-ingest.
```

**逻辑零改动**（5B §节 4 Stage 5 字面"沿原逻辑"）。所有 import 路径（如 `@semantic/types` 等绝对路径）保持原样；若有相对路径 import 需调整到新位置，则字面调整（不动逻辑）。

### S5.3 `internal/table-adapter.ts` — Q1 字面实施

按上面 §"Q1 table-adapter 字面契约"实施。字面算法步骤 5 步。

**关键字面**：
- 必须 import 现有 ULID 生成器（`@shared/ulid` 的 `generateUlid`）但本期**不调用**（id 占位 null，由 capability 层注入 — 见 5B §7.3.1 五处消费方第 5 项 `injectIdsForCreate`）
- 必须 import `STRUCTURAL_CONTAINER_TYPES` from `@semantic/types/structural`（Stage 1-2 已落地的单点 export）
- 字面**不生成** tableRow atom（5A 拍板）
- 字面**生成** cell atoms（tableCell + tableHeader）+ table atom 自身 + childOf 边
- 字面**注入** `cell.attrs.rowIndex / colIndex / colspan / rowspan / colwidth / align / id:null`
- 字面**注入** `cell.attrs.bookAnchor` 字面**不强制**（保留 V2 spec 现有惯例：tableCell 有 bookAnchor 字段，tableHeader 无 — S1.3.2 / S1.3.3 字面）

### S5.4 `internal/markdown-to-atoms.ts` — 节 3.3 + §7.1.3 字面实施

字面算法（5B §7.1.3 第 4 点字面）：
1. 内部走现有 `markdownToProseMirror`（import from `@capabilities/text-editing/converters/md-to-pm`）出 PMNode[]
2. 字面执行"PM → Atom"局部转换（**对齐 dissect 但不写库**）：
   - 顶层每 block → atom（attrs.id 字面 null 占位）
   - 容器型 block content = []（决议 026 §3.4）
   - 注入 from `{ extractionType: 'markdown', extractedAt: Date.now() }` 替代默认 `'pdf'`
3. 表格节点字面走 `tableAdapter`（S5.3）展开为扁平 cells + childOf 边
4. 输出 `{ atoms: Atom[]; warnings: string[] }`

**关键字面**：
- 字面**复用** Stage 1-4 已落地的 `STRUCTURAL_CONTAINER_TYPES`（5 项，不含 table）
- 字面**不进 PM editor / 不调 noteCap.createNote**（capability 边界纪律）
- 字面**只产 Atom**（不产 PM doc / PMNode[] / DriverSerialized）
- pmToAtoms 局部转换字面**不依赖 main 进程 IPC**（content-ingest 跑在 renderer，Q6 留下 sub-phase；现在按 renderer 视角写，与 markdownToProseMirror 同进程）

### S5.5 `internal/krig-batch-to-atoms.ts` — §7.5.1 + Q1 + sanitize 字面实施

字面算法：
1. 字面 input `KrigImportBatch`（先 grep 定位现有类型 — `grep -rn "KrigImportBatch\|KrigPlatformBatch\|extraction.*[Bb]atch" src --include='*.ts'`）
2. 字面遍历 `batch.chapters`（每章一个 import 单元）
3. 每章字面：
   - 走 `sanitizeAtoms`（8 条容错，决议 §9）
   - table 字面走 `tableAdapter`（S5.3）展开
   - 非 table atom 字面归一化 attrs.id null 占位 + from 透传
4. 输出 `{ chapters: Array<{ title, bookName, atoms, warnings }> }`

**关键字面**：
- 字面**不调** noteCap.createNote（capability 边界纪律 — 那是 Stage 7 createNotesBatch 的事）
- 字面**不走** PM editor / 不产 PM doc
- 字面**兼容** 契约 §4.7 `tiptapContent` 字段名（Stage 8 才 rename pmContent，本期保留字面）

### S5.6 `types.ts` 与 `index.ts`

`types.ts`：

```ts
// 5B Stage 5 — content-ingest capability 对外类型契约
//
// 字面禁止: 不允许导出 PM doc / PMNode[] / DriverSerialized 形态的 API.
// 字面规则: 输出统一为 V2-Atom 集合 + warning 数组.

import type { Atom, AtomFrom } from '@semantic/types';

// KrigImportBatch 字面 import 现有类型(grep 定位); 若不存在 alias 现有形态.
export type { KrigImportBatch } from '<grep 定位>';

export interface MarkdownToAtomsOptions {
  titleHint?: string;
  from?: Partial<AtomFrom>;
}

export interface MarkdownToAtomsResult {
  atoms: Atom[];
  warnings: string[];
}

export interface KrigChapterResult {
  title: string;
  bookName: string;
  atoms: Atom[];
  warnings: string[];
}

export interface KrigBatchToAtomsResult {
  chapters: KrigChapterResult[];
}

export interface ContentIngestApi {
  markdownToAtoms(
    md: string,
    options?: MarkdownToAtomsOptions,
  ): Promise<MarkdownToAtomsResult>;

  krigBatchToAtoms(
    batch: KrigImportBatch,
  ): Promise<KrigBatchToAtomsResult>;
}
```

`index.ts`：

```ts
/**
 * content-ingest capability — 5B Stage 5 (设计 §7.1.3)
 *
 * 职责: 各源原生格式 (markdown / KRIG_IMPORT JSON / 未来扩展) -> 归一化的 V2-Atom 集合.
 * **禁止** 调 noteCap.createNote / 产 PM doc — 那是上层编排的事 (Stage 7).
 *
 * 共依赖: STRUCTURAL_CONTAINER_TYPES from @semantic/types/structural (5B §7.3.1).
 *
 * Stage 6 待办: 删除 text-editing 内 sanitize-atoms.ts / md-to-pm.ts 的 capability 公开导出,
 *   view 端 (markdown-import.ts / extraction-import.ts) 改走 content-ingest API.
 */

import { capabilityRegistry } from '@slot/capability-registry/capability-registry';
import { markdownToAtoms } from './internal/markdown-to-atoms';
import { krigBatchToAtoms } from './internal/krig-batch-to-atoms';
import type { ContentIngestApi } from './types';

export type { ContentIngestApi, MarkdownToAtomsOptions, MarkdownToAtomsResult, KrigChapterResult, KrigBatchToAtomsResult } from './types';
export { markdownToAtoms } from './internal/markdown-to-atoms';
export { krigBatchToAtoms } from './internal/krig-batch-to-atoms';

const api: ContentIngestApi = { markdownToAtoms, krigBatchToAtoms };

capabilityRegistry.register({
  id: 'content-ingest',
  api,
});
```

### Stage 5 验收

**子会话必须做的自验收**（用 Bash + 工具，不依赖 UI）：

#### V1：typecheck 全绿

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "src/main/ipc/handlers.ts\|src/renderer/shell/WorkspaceBar.tsx"
```

**期望**：0 行错误。两条 grep -v 是 V1 残留遗留无关。

#### V2：目录骨架 6 文件全部就位

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && find src/capabilities/content-ingest -type f
```

**期望**：6 个 .ts 文件（types.ts + index.ts + internal/{sanitize-atoms,table-adapter,markdown-to-atoms,krig-batch-to-atoms}.ts）。

#### V3：API 边界纪律字面验证

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -rn "PMNode\|PmPayload\|noteCap\|createNote\|noteCapability" src/capabilities/content-ingest --include='*.ts'
```

**期望**：
- 含 `PmPayload` 仅在 markdown-to-atoms.ts 内部使用（PM → Atom 局部转换中间表示），**types.ts / index.ts 不导出**
- 完全**不含** `createNote / noteCap / noteCapability`（capability 边界纪律）

#### V4：capability 注册字面验证

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -n "capabilityRegistry.register\|id: 'content-ingest'" src/capabilities/content-ingest/index.ts
```

**期望**：字面命中 `capabilityRegistry.register({ id: 'content-ingest', api })`。

#### V5：sanitize-atoms.ts 是字面复制

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && diff <(tail -n +5 src/capabilities/text-editing/converters/sanitize-atoms.ts) <(tail -n +10 src/capabilities/content-ingest/internal/sanitize-atoms.ts) | head -20
```

**期望**：除去新文件首部追加的字面登记注释外，逻辑字面 1:1（diff 输出为空或仅 header 差异）。

#### V6：text-editing capability 完全未动

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && git diff main -- src/capabilities/text-editing/ | head -10
```

**期望**：空输出（Stage 5 不改 text-editing，那是 Stage 6 的事）。

#### V7：STRUCTURAL_CONTAINER_TYPES 复用单点 export

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -rn "STRUCTURAL_CONTAINER_TYPES\s*=\s*new Set" src/capabilities/content-ingest --include='*.ts'
```

**期望**：**0 行命中**（content-ingest 走 import，不重复定义 — 与 Stage 2 五处消费方收敛纪律一致）。

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -rn "from '@semantic/types/structural'" src/capabilities/content-ingest --include='*.ts'
```

**期望**：≥1 行命中（table-adapter / markdown-to-atoms 至少一个 import 走 semantic 单点）。

### Commit 纪律

完成全部 S5.1-S5.6 + V1-V7 验收 PASS 后，**单 commit 进 `feature/import-refactor-stage-5B-5` 分支**（你已在此分支）：

- commit message 字面标注："5B Stage 5 implementation — content-ingest capability skeleton + sanitize-atoms migration"
- **不要** push（保留给总指挥）
- **不要** merge 到 main
- 不要 commit 任何与 5B Stage 5 无关的文件（如 docs/tasks/import-progress-ui-prompt.md 这类老 untracked）
- 不要改 text-editing 的任何文件（那是 Stage 6 的事）

## 操作纪律（违反任意一条立刻停手报告）

### cwd 漂移防御

V2 仓库的 harness 多次 Bash 调用之间 cwd 不稳定，会漂到隔壁 V1 仓库 `/Users/wenwu/Documents/VPN-Server/KRIG-Note`（已发生 14+ 次事故）。漂了会读到错代码 / 改错文件。

**每一条 Bash 都必须以 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...` 开头**，不论上一条是什么。

**Read / Edit / Write 工具一律传绝对路径** `/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2/...`，不依赖 cwd。

V1 / V2 区分速判：

| V1 顶层 | V2 顶层 |
|---|---|
| `src/main/`、`src/renderer/`、`src/plugins/` | `src/platform/main/`、`src/views/`、`src/capabilities/`、`src/drivers/`、`src/storage/`、`src/semantic/` |

git log / git status 看到 V1 特征立即停手：
- commit hash 出现 `47015ed8` / `7f47f42f` / 包含 `canvas-m2-polish` / `sticky-color-bar`
- `git remote -v` URL 是 `KRIG-Note.git`（V1）而非 `KRIG-Note-V2.git`（V2）

任何 `git checkout` 之前必须三联守门：

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && pwd && git remote -v | head -1
```

### 实施纪律

**可以**：
- `git checkout -b feature/import-refactor-stage-5B-5 main`（**第一步**就要做）
- 在 `src/capabilities/content-ingest/` 下新建文件
- `cp src/capabilities/text-editing/converters/sanitize-atoms.ts src/capabilities/content-ingest/internal/sanitize-atoms.ts`（字面复制）
- 跑 `npx tsc --noEmit` 自校验
- `git commit` 到 `feature/import-refactor-stage-5B-5` 分支
- 跑 grep / 读源码

**不可以**：
- 切到其它分支（含 main）
- merge / cherry-pick / rebase 到任何其它分支
- `git push`（保留给总指挥）
- 改设计文档 / 决议 026 / 任何 docs/
- 改 `src/capabilities/text-editing/` 任何文件（那是 Stage 6 的事，包括"删除原 sanitize-atoms.ts"也是 Stage 6 做）
- 改 view 端调用方（`src/views/note/markdown-import.ts` / `src/views/note/extraction-import.ts` 等 — 那是 Stage 6）
- 改 Stage 5 范围外的源代码（capability-impl.ts / dissect-pm-doc.ts / assemble-pm-doc.ts 等 — Stage 1-4 已合 main，本期不动）
- 操作数据库

### 完成标准

- 7 个 V1-V7 验收全部 PASS
- 单 commit 进 `feature/import-refactor-stage-5B-5` 分支
- 5B 设计 §节 4 Stage 6 字面依赖已满足（content-ingest capability 已就位可被 import；text-editing 的"导出该删谁"留 Stage 6 做）

完成后向调用方汇报：
- commit hash + 改动文件清单
- V1-V7 各项验收结果（typecheck 0 error / 文件列表 / grep 行数等）
- 实施过程中发现的新问题（如有）
- 任何 5B 设计文档与现实情况不一致的发现（如类型名 / 路径 / API 形态有 drift，必须报告，不要自己猜）

---

## Agent 配置建议（给调用方）

- **agent 类型**：`general-purpose`（**不是 Plan**！Plan 没有 Write/Edit 工具）
- **是否后台运行**：可后台。完成时通知
- **预期工作时间**：1.5-2.5 小时（5 个新文件 + tableAdapter / markdownToAtoms / krigBatchToAtoms 算法实施 + 类型对接 + tsc 验证）
