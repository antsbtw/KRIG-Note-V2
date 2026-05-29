# 阶段 5B 实施 Stage 1-2：schema attrs + STRUCTURAL 收敛 — 任务 Prompt

> 这份 prompt 给独立子会话执行。
> 调用方（用户/总指挥）：把整份文档作为 user message 发给新对话。

---

## 你的身份

你是 KRIG-Note V2 的**实施工程师**。本次任务是把 5B 设计 §节 4 Stage 1-2 字面落地为 TypeScript 代码。

**Agent 类型**：`general-purpose`（**不是 Plan** — Plan 没有 Write/Edit 工具）。

## 上下文（必读，不要在产出里复述）

### 项目根 + 实施分支

- 仓库根：`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
- **实施分支**：`feature/import-refactor-stage-5B-1-2`（基于 main HEAD `25381ba4`）
- 仓库 checkout 当前在 `main`；**你第一步必须 `git checkout feature/import-refactor-stage-5B-1-2`**

### 5A / 5B 已拍板的硬契约（必须字面遵守）

| 拍板项 | 字面 |
|---|---|
| table 是 atom | `attrs.id = ULID`；PM JSON `content = []`（5A） |
| tableRow 不是 atom | row 信息走 `cell.attrs.rowIndex / colIndex`（5A） |
| STRUCTURAL_CONTAINER_TYPES | **5 项** `{tableRow, bulletList, orderedList, taskList, columnList}`（**不含 table**） |
| 三处同步契约 | semantic 单点 export → 五处 import；不允许独立 hardcode |
| 关键原则 | 决议层是契约源头，实施跟决议走 |

### 必读输入文档（必读顺序）

1. **5B 设计**：[`docs/tasks/2026-05-28-stage-5B-import-converter-design.md`](2026-05-28-stage-5B-import-converter-design.md) — 重点 §7.3.1（STRUCTURAL 收敛理由）+ §节 4 Stage 1-2（本期范围）+ §节 6（与 5C 接口）
2. **5A 拍板汇总**：[`docs/tasks/2026-05-28-stage-5A-decision-026-amendment-summary.md`](2026-05-28-stage-5A-decision-026-amendment-summary.md) — 重点 §4（tableCell.attrs schema 增量）+ §6.1（5B Stage 1-2 字面文件清单）
3. **决议 026 修订版**：[`docs/RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md`](../RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md) — 重点 §3.1.2 修订附记（"三处必须保持同步作为契约"）

## 任务

### Stage 1：基础设施

#### S1.1 新建 `src/semantic/types/structural.ts`

文件内容（字面）：

```ts
/**
 * STRUCTURAL_CONTAINER_TYPES — 结构性容器集合(单点 source of truth)
 *
 * 5A 拍板 + 5B §7.3.1 拍板:
 * - 从原 6 项 {table, tableRow, bulletList, orderedList, taskList, columnList}
 *   降为 **5 项** {tableRow, bulletList, orderedList, taskList, columnList}
 * - **不含 `table`**(5A 拍板 table 是 atom)
 * - 集中到 semantic 层单点 export,所有消费方走 import,**不允许独立 hardcode**
 *
 * 五处消费方(2026-05-28 5B Stage 2 收敛后):
 * 1. src/platform/main/note/assemble-pm-doc.ts
 * 2. src/platform/main/note/dissect-pm-doc.ts
 * 3. src/drivers/text-editing-driver/plugins/build-auto-block-id-plugin.ts
 * 4. src/capabilities/text-editing/converters/atoms-to-pm.ts
 * 5. src/platform/main/note/capability-impl.ts (injectIdsForCreate)
 *
 * 未来加新结构性容器(如 grid / flexbox / layout — 决议 026 §13.8 前瞻):
 * 只需改本文件,五处消费方字面自动跟随。
 *
 * **集合内容字面一致是决议 026 §3.1.2 修订附记字面登记的硬契约。**
 */

export const STRUCTURAL_CONTAINER_TYPES = new Set<string>([
  'tableRow',
  'bulletList',
  'orderedList',
  'taskList',
  'columnList',
]);

export type StructuralContainerType =
  | 'tableRow'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'columnList';
```

#### S1.2 更新 `src/semantic/types/index.ts`

加一行 export，让 `@semantic/types` barrel 可以解析这个新模块（如果 barrel 是 `export *` 形式可能已自动覆盖，否则手动加）。**先读现有 `src/semantic/types/index.ts` 确认导出风格**再加。

#### S1.3 `src/drivers/text-editing-driver/blocks/table/spec.ts` 三处 schema 改

**注意**：本文件三处 spec 都有 `parseDOM` / `toDOM`，**新增 attrs 必须同步改 parseDOM/toDOM 才能持久化到 PM doc JSON**（否则 PM schema 默认值生效，但用户 attrs 改动写不回 DOM、复制粘贴丢失）。

##### S1.3.1 `tableNodeSpec`（line 76-85）

**当前**：完全无 attrs 字段。

**新字面**：

```ts
const tableNodeSpec: NodeSpec = {
  content: 'tableRow+',
  group: 'block',
  tableRole: 'table',
  isolating: true,
  attrs: {
    // L7 block atomization (decision 026 §3.1.1 / §4 + 5A 拍板 table 是 atom):
    // table 字面拆 atom, attrs.id 与 atom.id 同步
    // 由 buildAutoBlockIdPlugin appendTransaction 注入 ULID(plugin shouldHaveId
    // 字面看 spec.attrs 是否含 'id', 加完此字段后字面自动覆盖 table)
    id: { default: null },
  },
  parseDOM: [{
    tag: 'table',
    getAttrs(dom) {
      const el = dom as HTMLElement;
      return { id: el.getAttribute('data-id') };
    },
  }],
  toDOM(node) {
    const attrs: Record<string, string> = { class: 'krig-pm-table' };
    const id = node.attrs.id as string | null;
    if (id) attrs['data-id'] = id;
    return ['table', attrs, ['tbody', 0]];
  },
};
```

字面理由（写到代码注释里）：5A §6.1 字面要求 table 是 atom；5B §节 4 Stage 1 改动点 #1 字面登记。

##### S1.3.2 `tableCellSpec` 的 `tableCellNodeSpec`（line 122-151）

**当前 attrs**：`id / colspan / rowspan / colwidth / align / bookAnchor`（6 个字段，line 124-137）。

**新字面**：在 attrs 内**新增** `rowIndex` + `colIndex`：

```ts
attrs: {
  // L7 block atomization (decision 026 §3.1.1 / §4): block atom 稳定 ULID,与 atom.id 同步
  id: { default: null },
  colspan: { default: 1 },
  rowspan: { default: 1 },
  colwidth: { default: null },
  align: { default: null },
  // sub-phase 022: 标注 eBook 时承载定位元数据 (default null, decision 022 §1.3.1)
  // (字面注释保留)
  bookAnchor: { default: null },
  // 5A 拍板 + 5B §节 4 Stage 1 改动点 #2 字面新增:
  // tableRow 不是 atom (5A 拍板), row 边界信息走 cell 自带的 rowIndex / colIndex
  // (0-based 整数). Q2 拍板 dissect 期注入(选项 B);PM editor 内 attrs 字面陈旧
  // 不出 bug, dissect 时重算覆盖.
  rowIndex: { default: 0 },
  colIndex: { default: 0 },
},
```

**parseCellAttrs（line 42-53）必须同步更新**——加 rowIndex / colIndex 字段读取（来源 `data-row-index` / `data-col-index`）。

**cellToDOM（line 55-72）必须同步更新**——序列化 rowIndex / colIndex 到 DOM `data-row-index` / `data-col-index`。

##### S1.3.3 `tableHeaderSpec` 的 `tableHeaderNodeSpec`（line 163-186）

**当前 attrs**：`id / colspan / rowspan / colwidth / align`（5 个字段，line 165-172）— **没有 bookAnchor**（line 132-136 注释明确仅 tableCell 字面 receiver bookAnchor）。

**新字面**：与 tableCellSpec 同款，加 `rowIndex / colIndex`（**不加 bookAnchor**，沿现有惯例）：

```ts
attrs: {
  id: { default: null },
  colspan: { default: 1 },
  rowspan: { default: 1 },
  colwidth: { default: null },
  align: { default: null },
  // 5A 拍板: tableHeader 与 tableCell 同模式拆 atom + 同款 rowIndex/colIndex
  // (rowIndex=0 字面对应表头第 1 行; 5A §13.9 注 1 拍板)
  rowIndex: { default: 0 },
  colIndex: { default: 0 },
},
```

parseDOM / toDOM 同步更新（**复用 tableCellSpec 的 parseCellAttrs / cellToDOM 已经够了**——它们已通过本期改动支持 rowIndex/colIndex，tableHeaderSpec 字面共用同一对工具函数）。

### Stage 2：STRUCTURAL 集合三处同步 + capability inject 收敛

**关键纪律**：本 Stage 五处消费方必须**集合内容字面 1:1 一致**——5A §2.7 + 决议 026 §3.1.2 修订附记字面登记的硬契约。

#### S2.1 `src/platform/main/note/assemble-pm-doc.ts:381`

**当前**（line 381-388）：

```ts
export const STRUCTURAL_CONTAINER_TYPES = new Set<string>([
  'table',
  'tableRow',
  'bulletList',
  'orderedList',
  'taskList',
  'columnList',
]);
```

**新字面**：删除独立定义，改为：

```ts
// 5B §7.3.1 拍板: STRUCTURAL_CONTAINER_TYPES 收敛到 semantic 层单点 export
// (5A 拍板 table 是 atom, 集合从 6 项降为 5 项)
export { STRUCTURAL_CONTAINER_TYPES } from '@semantic/types/structural';
```

字面理由：保留 `export`（不破坏既有 dissect-pm-doc 的 import 链路）；本文件**仅作为 re-export 桥**让 import 路径渐进迁移。

**注意**：现有 `STRUCTURAL_CONTAINER_TYPES` 在本文件还有内部用法吗？grep 自校验后**保留实际功能不变**——只是定义来源换了。

#### S2.2 `src/platform/main/note/dissect-pm-doc.ts:22`

**当前**：

```ts
import { STRUCTURAL_CONTAINER_TYPES } from './assemble-pm-doc';
```

**新字面**：

```ts
import { STRUCTURAL_CONTAINER_TYPES } from '@semantic/types/structural';
```

（直接 import semantic，不经 assemble-pm-doc 中转。）

#### S2.3 `src/drivers/text-editing-driver/plugins/build-auto-block-id-plugin.ts:54`

**当前**（line 54-61）：

```ts
const STRUCTURAL_CONTAINER_TYPES = new Set<string>([
  'table',
  'tableRow',
  'bulletList',
  'orderedList',
  'taskList',
  'columnList',
]);
```

**新字面**：删除独立定义，改为 import：

```ts
import { STRUCTURAL_CONTAINER_TYPES } from '@semantic/types/structural';
```

（放到文件顶部 import 区域；line 54-61 整段定义删除。）

**字面副作用**：line 79 `if (STRUCTURAL_CONTAINER_TYPES.has(node.type.name)) return false;` 字面行为不变——但**注意**：之前集合含 `'table'`，plugin 不给 table 注入 id；现在删了 `'table'`，plugin 会给 table 注入 id（**这是本次决策的正确行为**——table 已是 atom 字面需要 id；schema S1.3.1 已加 `attrs.id` 字段）。

#### S2.4 `src/capabilities/text-editing/converters/atoms-to-pm.ts:557`

**当前**（line 557 附近）：

```ts
const STRUCTURAL_CONTAINER_TYPES = new Set([
  'table',
  'tableRow',
  'bulletList',
  'orderedList',
  'taskList',
  'columnList',
]);
```

**新字面**：删除独立定义，改为 import：

```ts
import { STRUCTURAL_CONTAINER_TYPES } from '@semantic/types/structural';
```

（放到文件顶部 import 区域。）

**5B §节 4 Stage 6 字面规划**：本文件未来会迁移到 `content-ingest` capability；**本 Stage 不迁移**，先就地改 import。Stage 6 实施时移动路径后 import 仍然有效。

#### S2.5 `src/platform/main/note/capability-impl.ts:250-278` `injectIdsForCreate`

**当前**（line 250-278）：函数内部 hardcode `const STRUCTURAL = new Set([...])`（line 251-258）。

**新字面**：删除函数内独立定义，文件顶部 import 区加：

```ts
import { STRUCTURAL_CONTAINER_TYPES } from '@semantic/types/structural';
```

函数内 `STRUCTURAL` 改用 `STRUCTURAL_CONTAINER_TYPES`（统一名）。

**字面副作用**：之前集合含 `'table'`，injectIdsForCreate 不给 table 节点注入 id；现在 table ∈ atom 字面需要 id 注入，行为字面**正确变化**（不出 bug，与 plugin S2.3 同模式）。

### Stage 1-2 验收

**子会话必须做的自验收**（用 Bash + 工具，不依赖 UI）：

#### V1：typecheck 全绿

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "src/main/ipc/handlers.ts\|src/renderer/shell/WorkspaceBar.tsx"
```

**期望**：0 行错误。两条 grep -v 是 V1 残留遗留无关。

#### V2：STRUCTURAL_CONTAINER_TYPES 全仓 grep 自校验

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -rn "STRUCTURAL_CONTAINER_TYPES\s*=\s*new Set" src --include='*.ts'
```

**期望**：**只有 1 行命中**——`src/semantic/types/structural.ts`。其它独立 `new Set` 定义全部删除。

#### V3：STRUCTURAL import 五处验证

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -rn "from '@semantic/types/structural'\|from \"@semantic/types/structural\"" src --include='*.ts'
```

**期望**：**5 行命中**——assemble-pm-doc / dissect-pm-doc / build-auto-block-id-plugin / atoms-to-pm / capability-impl 各一处。

#### V4：集合内容 1:1 一致

读 `src/semantic/types/structural.ts` 确认集合 5 项 `{tableRow, bulletList, orderedList, taskList, columnList}`，**字面不含 `'table'`**。

#### V5：table schema 字段验证

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -A 5 "const tableNodeSpec" src/drivers/text-editing-driver/blocks/table/spec.ts | head -20
```

**期望**：tableNodeSpec 字面含 `attrs: { id: { default: null } }`。

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -B 2 -A 2 "rowIndex" src/drivers/text-editing-driver/blocks/table/spec.ts
```

**期望**：tableCellNodeSpec / tableHeaderNodeSpec 都字面含 `rowIndex: { default: 0 }` + `colIndex: { default: 0 }`。

#### V6：parseDOM/toDOM 同步

读 spec.ts 确认 parseCellAttrs / cellToDOM 已字面加 `rowIndex` / `colIndex` 读写（DOM data-row-index / data-col-index）。**tableNodeSpec 的 parseDOM/toDOM 字面加 id 读写（data-id）**。

### Commit 纪律

完成全部 Stage 1-2 + V1-V6 验收 PASS 后，**单 commit 进 `feature/import-refactor-stage-5B-1-2` 分支**（你已在此分支）：

- commit message 字面标注："5B Stage 1-2 implementation — STRUCTURAL set converged to semantic + table schema attrs"
- **不要** push（保留给总指挥）
- **不要** merge 到 main
- 不要 commit 任何与 5B Stage 1-2 无关的文件（如 docs/tasks/import-progress-ui-prompt.md 这类老 untracked）

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
- `git checkout feature/import-refactor-stage-5B-1-2`（**第一步**就要做）
- 修改 src/ 源代码（仅 Stage 1-2 范围内的文件）
- 新建 `src/semantic/types/structural.ts`
- 跑 `npx tsc --noEmit` 自校验
- `git commit` 到 `feature/import-refactor-stage-5B-1-2` 分支
- 跑 grep / 读源码

**不可以**：
- 切到其它分支（含 main）
- merge / cherry-pick / rebase 到任何其它分支
- `git push`（保留给总指挥）
- 改设计文档 / 决议 026 / 任何 docs/
- 改 Stage 1-2 范围外的源代码（如 5B Stage 3+ 的 dissect rowIndex 注入算法 / Stage 4 wrapTableCells 重构等——本期不动）
- 操作数据库

### 完成标准

- 6 个 V1-V6 验收全部 PASS
- 单 commit 进 `feature/import-refactor-stage-5B-1-2` 分支
- 5C 设计 §6.1 字面依赖（`@semantic/types/structural.ts` 单点 export）已满足，5C 可启动

完成后向调用方汇报：
- commit hash + 改动文件清单
- V1-V6 各项验收结果（typecheck 0 error / grep 行数 / spec.ts 字段验证截图等）
- 实施过程中发现的新问题（如有）

---

## Agent 配置建议（给调用方）

- **agent 类型**：`general-purpose`（**不是 Plan**！Plan 没有 Write/Edit 工具）
- **是否后台运行**：可后台。完成时通知
- **预期工作时间**：1-1.5 小时（schema 改 + 5 处 import 重定向 + tsc 验证）
