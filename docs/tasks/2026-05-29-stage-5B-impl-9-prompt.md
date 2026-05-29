# 阶段 5B 实施 Stage 9：vitest 测试基础设施 + 测试场景 + 性能压测 — 任务 Prompt

> 这份 prompt 给新会话执行。直接把整份文档作为 user message 发给新对话即可。
> 这份 prompt 完全 self-contained — 新对话没有 5A/5B/Stage 1-8 上下文。

---

## 0. 你的身份 + 总目标

你是 KRIG-Note V2 的**测试工程师**。本次任务是把 5B 设计 §节 4 Stage 9 字面落地：

1. 在 V2 仓库**从零建立** vitest 测试基础设施（V2 当前**没有任何测试** — 0 vitest / 0 jest / 0 spec.ts）
2. 写**单元测试**覆盖 5B Stage 1-7 redo 字面新增/重写的 5 个核心算法
3. 写**集成测试**覆盖 5A §6.3 + 5B §节 4 字面共 10 个场景中**6 个可自动化**的（场景 1 / 6 / 7 / 8 / 9 + Stage 6 view bridge round-trip）
4. 写**性能基准**：markdown 1000 篇 batch import + listNotes cold-start

**纪律核心**：subagent 不允许改 src/ 任何文件。如果发现 src/ bug，**只在汇报里登记，不修**。修留下一个分支 / 下一次会话。

**Agent 类型**：`general-purpose`（**不是 Plan** — Plan 没有 Write/Edit 工具）

---

## 1. 必读上下文（前置背景 — 不要在产出里复述）

### 1.1 项目根 + 分支

- 仓库根：`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
- **实施分支**：`test/stage-9-test-infrastructure`（用户手动 checkout 完毕，你跳过 `git checkout -b`）
- 第一步：`cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && pwd && git remote -v | head -1 && git branch --show-current` 三联守门（必须 V2.git + test/stage-9-test-infrastructure 分支）

### 1.2 V2 项目结构关键事实

| 层 | 路径 | 用途 |
|---|---|---|
| semantic | `src/semantic/types/` | atom / edge / atom-entity / edge-entity / structural / pm-atom-draft SSOT |
| storage | `src/storage/` | StorageAPI 接口 + SurrealDB 实现（sidecar 模式）|
| capability | `src/capabilities/note` `content-ingest` `text-editing` 等 | 业务能力封装 |
| platform main | `src/platform/main/note/` | createNote/createNotesBatch/dissect/assemble/handlers 等 |
| views | `src/views/note/` | NoteView + markdown-import + extraction-import 等 |

### 1.3 测试目标代码的实际公开 API（必读）

**算法 5 个（单元测对象）**：

| API | 位置 | 入口形态 | 输出形态 |
|---|---|---|---|
| `dissectPmDoc(containerId, doc): DissectResult` | `src/platform/main/note/dissect-pm-doc.ts:235` | PmPayload (doc) | `{ blocks, belongsEdges, nextSiblingEdges, childOfEdges }` |
| `assemblePmDoc(containerId): Promise<PmPayload \| null>` | `src/platform/main/note/assemble-pm-doc.ts:195` | containerId | PmPayload（依赖 storage 单例）|
| `tableAdapter(input): TableAdapterOutput` | `src/capabilities/content-ingest/internal/table-adapter.ts:52` | `{ tablePmNode, tableTmpId, allocTmpId, from? }` | `{ tableDraft, cellDrafts }` |
| `markdownToAtoms(md, options?): Promise<{ atoms, warnings }>` | `src/capabilities/content-ingest/internal/markdown-to-atoms.ts:47` | markdown string | `{ atoms: PmAtomDraft[], warnings }` |
| `createNotesBatch(input): Promise<CreateNoteBatchResult>` | `src/platform/main/note/capability-impl.ts` | `{ items: [{atoms, folderId, titleHint?}], broadcastMode? }` | `{ notes: NoteInfo[], failures }` |

类型定义看这些文件 + `src/semantic/types/pm-atom-draft.ts`。

### 1.4 storage 是单例 — 测试要 mock

`assemblePmDoc` / `createNotesBatch` 字面依赖 `import { storage } from '@storage/index'`（单例）。

`storage` 实例的形态是 `StorageAPI`（`src/storage/api.ts:21`）。**用户拍板：单元测 + 集成测 + 压测全部用 in-memory mock 实现 StorageAPI / StorageTransaction**（不起 SurrealDB sidecar，跑得快，并行可靠）。

mock 实现要满足的方法集**字面看 src/storage/api.ts 字面**：必须包含 `transaction / putAtom / getAtom / deleteAtom / listAtoms / putEdge / getEdge / deleteEdge / listEdges / listEdgesBy*` 等。**全集字面 grep 一遍 `storage\.[a-zA-Z]*\(` 在 src/platform/main/ + src/capabilities/ 下，作为 mock 必须实现的方法清单**。**未在生产代码中调用的方法可暂不实现**（mock 内可 throw `not implemented in test mock`）。

### 1.5 5A §6.3 字面 7 + 5B §节 4 字面 3 = 10 测试场景对照

| # | 场景 | 5B Stage 9 实施方式（用户拍板）|
|---|---|---|
| 1 | 新建 note → 插入 GFM 表格 → 保存 → 重启 → 打开 | ✅ 自动化（dissect → assemble round-trip 验 cells 顺序）|
| 2 | 编辑 cell B2 内容 → 保存 → 重启 → 打开 | ❌ 跳过（需要 PM editor 交互；UI 类）|
| 3 | 表格内删行 → 保存 → 重启 | ❌ 跳过（同上）|
| 4 | 表格内插行 → 保存 → 重启 | ❌ 跳过（同上）|
| 5 | 拖动整张表 | ❌ 跳过（未来 feature）|
| 6 | KRIG_IMPORT → atoms → createNote → dissect | ✅ 自动化（`krigBatchToAtoms` + `createNotesBatch` round-trip）|
| 7 | markdown → md-to-pm → createNote → dissect | ✅ 自动化（`markdownToAtoms` + `createNotesBatch` round-trip）|
| 8 | markdown 1000 篇目录批量 → 性能基线 | ✅ 自动化（vitest bench）|
| 9 | KRIG_IMPORT 5 chapter batch all-or-nothing 回滚 | ✅ 自动化（mock storage tx 抛错验 rollback）|
| 10 | 第三方 plugin 兼容性（表格内 paste / split cell / merge cell） | ❌ 跳过（DOM 交互 + prosemirror-tables，留下一 sub-phase）|

**6 个自动化场景**字面是上表标 ✅ 的：1 / 6 / 7 / 8 / 9 + 额外加 **场景 11 markdown ↔ batch ↔ assemble 整链 round-trip**（不在 5A/5B 设计字面但是验证 Stage 7 redo 整链正确性的最直接测试 — 5B Stage 7 redo 字面"atoms 直写 storage"的端到端验证）。

### 1.6 5B Stage 1-8 字面已落地的内容（背景）

| Stage | 落地 |
|---|---|
| 1-2 | `@semantic/types/structural.ts` 5 项 STRUCTURAL（**不含 'table'**）+ table NodeSpec.attrs.id + tableCell/Header.rowIndex/colIndex schema 字段 |
| 3 | dissect 期给 tableRow grandchildren 注入 `attrs.rowIndex / colIndex` |
| 4 | `STRUCTURAL_REBUILD_RULES` 注册式（list / taskList / columnList）+ `assembleTable` 按 rowIndex/colIndex 分组重建 |
| 5-6 | content-ingest capability 骨架 + view 端切换 |
| 7 redo | `PmAtomDraft` SSOT（`@semantic/types/pm-atom-draft.ts`）+ `createNotesBatch` 字面 atoms 直写 storage（tmpId → realId 映射 + 3 类边 putEdge）+ AtomInput 物理删 |
| 8 | 契约 v2.1（rename tiptapContent → pmContent）+ sanitize 兼容兜底 |

### 1.7 V1 残留 typecheck 错误（必读）

`npx tsc --noEmit -p tsconfig.json` 跑全仓字面会出 V1 老错误：
- `src/main/ipc/handlers.ts`
- `src/renderer/shell/WorkspaceBar.tsx`（WebkitAppRegion 等）

**这两个文件字面是 V1 残留，与 Stage 9 完全无关**。验收 V1 typecheck 字面命令是：

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "src/main/ipc/handlers.ts\|src/renderer/shell/WorkspaceBar.tsx"
```

期望 grep 后 0 行错误。

---

## 2. 任务（按 Step 1-7 顺序）

### Step 1: vitest 基础设施

**1.1 安装 vitest + 相关依赖**

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npm install --save-dev vitest @vitest/ui
```

注：sandbox 可能拦 npm install。若拦，停下来请总指挥跑。

**1.2 新建 `vitest.config.ts`** 在仓库根：

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.bench.ts'],
    setupFiles: ['./tests/setup.ts'],
    // bench 与普通 test 分开运行
    benchmark: {
      include: ['tests/**/*.bench.ts'],
    },
  },
  resolve: {
    alias: {
      '@views':        path.resolve(__dirname, 'src/views'),
      '@capabilities': path.resolve(__dirname, 'src/capabilities'),
      '@drivers':      path.resolve(__dirname, 'src/drivers'),
      '@semantic':     path.resolve(__dirname, 'src/semantic'),
      '@storage':      path.resolve(__dirname, 'src/storage'),
      '@platform':     path.resolve(__dirname, 'src/platform'),
      '@shell':        path.resolve(__dirname, 'src/shell'),
      '@workspace':    path.resolve(__dirname, 'src/workspace'),
      '@slot':         path.resolve(__dirname, 'src/slot'),
      '@shared':       path.resolve(__dirname, 'src/shared'),
    },
  },
});
```

path alias 字面**复刻 tsconfig.json paths 字面**（注：`@semantic/types/*` 等深路径会通过 alias `@semantic` 自动解析）。

**1.3 `package.json` scripts 加 3 条**：

```json
"test": "vitest run",
"test:watch": "vitest",
"bench": "vitest bench --run"
```

字面在现有 typecheck / lint 行下追加。

**1.4 新建 `tests/` 目录结构骨架**：

```
tests/
  ├─ setup.ts                                # 全局 setup（storage mock 注入）
  ├─ mocks/
  │   └─ storage-mock.ts                     # in-memory StorageAPI 实现
  ├─ semantic/
  │   └─ structural.test.ts                  # STRUCTURAL_CONTAINER_TYPES 5 项验证
  ├─ platform/main/note/
  │   ├─ dissect-pm-doc.test.ts              # dissect 算法单元测
  │   └─ assemble-pm-doc.test.ts             # assemble 算法单元测（含 assembleTable）
  ├─ capabilities/content-ingest/
  │   ├─ table-adapter.test.ts               # tableAdapter 算法
  │   └─ markdown-to-atoms.test.ts           # markdownToAtoms 算法
  ├─ capabilities/note/
  │   └─ create-notes-batch.test.ts          # createNotesBatch 算法
  ├─ scenarios/
  │   ├─ scenario-1-table-roundtrip.test.ts  # 场景 1
  │   ├─ scenario-6-krig-import.test.ts      # 场景 6
  │   ├─ scenario-7-markdown-table.test.ts   # 场景 7
  │   ├─ scenario-9-rollback.test.ts         # 场景 9
  │   └─ scenario-11-full-roundtrip.test.ts  # 场景 11（markdown → batch → assemble 整链）
  └─ bench/
      └─ markdown-1000-notes.bench.ts        # 场景 8（性能基线）
```

**1.5 `tests/setup.ts`** 字面在每个 test 前注入 storage mock：

```ts
import { beforeEach, vi } from 'vitest';
import { createMockStorage } from './mocks/storage-mock';

beforeEach(() => {
  // 给 @storage/index 字面替换 storage 单例
  vi.mock('@storage/index', () => {
    const mock = createMockStorage();
    return {
      storage: mock,
      initSurrealDB: vi.fn(),
      shutdownSurrealDB: vi.fn(),
      shutdownSurrealDBAsync: vi.fn(),
      getDB: vi.fn(),
    };
  });
});
```

**注意**：vitest mock 字面 hoisted，可能需要 module level `vi.mock` 而不是 beforeEach 内。字面按 vitest 文档调整 — 关键是**每个测试拿到的 storage 是独立 fresh in-memory 实例**。

### Step 2: in-memory storage mock

**`tests/mocks/storage-mock.ts`**：

字面**先 grep 出所有 storage 方法调用清单**：

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -rn "storage\.[a-zA-Z]\+\|tx\.[a-zA-Z]\+" src/platform/main src/capabilities --include='*.ts' | grep -oE "(storage|tx)\.[a-zA-Z]+" | sort -u
```

按 grep 结果实现 StorageAPI + StorageTransaction interface。**最小 mock 要求**：

- `transaction(fn)`：起一个事务 ctx，fn 抛错时回滚（清掉本 tx 字面写入的数据）
- `putAtom({ id?, payload }): AtomEntity`：id 为空字面生成 mock ULID（如 `mock-ulid-${counter++}`），id 存在则 UPSERT；返回 entity 含 id/createdAt/updatedAt
- `getAtom(id): AtomEntity | null`
- `deleteAtom(id)`
- `listAtoms(filter): AtomEntity[]`：支持按 domain 过滤
- `putEdge(input): EdgeEntity`
- `getEdge(id)` / `deleteEdge(id)` / `listEdges(filter)`：filter 支持 `predicate / subjectAtomId / objectAtomId`

数据用 `Map<string, AtomEntity>` + `Map<string, EdgeEntity>` 简单存。

实现完后**字面在 mock 顶部加 jsdoc 登记**："**仅 Stage 9 测试用 in-memory 实现，不能用于生产**"。

### Step 3: 单元测试（按文件顺序）

#### 3.1 `tests/semantic/structural.test.ts`

字面验证：
- `STRUCTURAL_CONTAINER_TYPES` 字面包含 `'tableRow' / 'bulletList' / 'orderedList' / 'taskList' / 'columnList'` 5 项
- 字面**不**含 `'table'`（5A 拍板）

#### 3.2 `tests/platform/main/note/dissect-pm-doc.test.ts`

测试用例：

1. **空 doc** → 0 blocks / 0 edges
2. **顶层 3 paragraph (无嵌套)** → 3 block atoms + 3 belongsToNote + 2 nextSibling + 0 childOf
3. **嵌套 list（bulletList > listItem > paragraph）** → 字面跳层 → listItem 顶层（无 childOf）+ paragraph.childOf → listItem
4. **table（5A 拍板）** → 字面 table 自身 1 atom + tableRow 跳层 0 atom + 每 cell 1 atom + cell.childOf → table（**跨过 tableRow**）+ cell.attrs.rowIndex / colIndex 字面注入正确
5. **缺 attrs.id 抛错**（plugin 字面未跑场景）

每用例字面构造 PmPayload 输入 → call `dissectPmDoc('container-id', input)` → 字面 assert 输出 `result.blocks` / `result.belongsEdges` / `result.nextSiblingEdges` / `result.childOfEdges`。

#### 3.3 `tests/platform/main/note/assemble-pm-doc.test.ts`

测试用例：

1. **空 container（无 blocks）** → 字面 PmPayload `{ type: 'doc', content: [] }`
2. **list round-trip**（写入 listItem + paragraph + childOf 边 → assemble → 重建 bulletList wrapper）
3. **table round-trip**（写入 table atom + cells + childOf 边 + cell.attrs.rowIndex/colIndex → assemble → 重建 tableRow wrappers，按 rowIndex 排序，行内按 colIndex 排序）
4. **assembleTable 容错**：rowIndex 缺失字面 fallback 0；同 (row, col) 重复字面 warn + 保留首条

assemble 字面是 async（依赖 mock storage），所以测试用 `await assemblePmDoc(containerId)`，**先用 mock storage 字面 putAtom + putEdge 准备数据**再 assemble。

#### 3.4 `tests/capabilities/content-ingest/table-adapter.test.ts`

测试用例：

1. **3 行 3 列 table** → 1 tableDraft + 9 cellDrafts + 每 cellDraft.parentTmpId = tableTmpId + rowIndex/colIndex 字面正确（0/0, 0/1, 0/2, 1/0, ...）
2. **tableHeader 混合**（首行 header + 后续 cell） → header drafts 也有 rowIndex/colIndex（Q4 字面单一 namespace）
3. **空 table** → 字面只产 tableDraft，cellDrafts = []
4. **tableTmpId 透传**（caller 传的 tmpId 字面就是 tableDraft.tmpId）

#### 3.5 `tests/capabilities/content-ingest/markdown-to-atoms.test.ts`

测试用例：

1. **`# heading\n\nparagraph`** → 2 drafts（heading + paragraph）+ 顶层 parentTmpId undefined
2. **GFM 表格 3×3** → 1 table draft + 9 cell drafts + cell.parentTmpId = table.tmpId
3. **bulletList 嵌套**（`- item1\n  - nested`） → listItem drafts + parentTmpId 链字面正确（嵌套 listItem.parentTmpId → 外层 listItem）+ STRUCTURAL bulletList 字面**不产 draft**
4. **callout / blockquote 子内容**（Stage 7 redo 重写后字面应该保留嵌套）→ paragraph.parentTmpId → callout draft
5. **titleHint 注入**：调用时传 `{ titleHint: 'Test' }` → atoms[0] 字面是 paragraph + `attrs.isTitle: true` + content 含 'Test'
6. **空 markdown** → 至少产出 1 个空 paragraph（兜底）

#### 3.6 `tests/capabilities/note/create-notes-batch.test.ts`

测试用例（全部用 mock storage）：

1. **单 item 单 atom** → 1 container + 1 block + 2 边（hasNoteView + belongsToNote）+ NoteInfo 返回正确
2. **多 item all-or-nothing**：3 items 第 2 个抛错 → tx rollback → notes.length=0 + failures 字面 3 条
3. **tmpId → realId 映射**：含 parentTmpId 链 → 字面验证 childOf 边的 subject/object 都是 realId（不是 tmpId）
4. **dangling parentTmpId**：item.atoms 含 parentTmpId 指向不存在的 tmpId → 字面抛 "dangling parentTmpId" 错
5. **nextSibling 链**：单 item 顶层 3 atoms → 字面 2 条 nextSibling 边（A→B / B→C）；含嵌套时按 parentTmpId 分组拉链
6. **broadcast 'final' 模式**：默认 final，全部完成后字面 1 次 broadcast（**mock broadcastNoteListChanged 字面计数**；用 vi.spyOn）

### Step 4: 集成测试（场景）

#### 4.1 `tests/scenarios/scenario-1-table-roundtrip.test.ts`

字面：构造一个含 3×3 表格的 PmPayload → `dissectPmDoc` → mock storage 字面写入 → `assemblePmDoc` → 字面 assert 重建出来的 PM doc 与原 doc 字面 deep equal（**rowIndex/colIndex 保留，cells 顺序正确**）。

#### 4.2 `tests/scenarios/scenario-6-krig-import.test.ts`

字面：构造 KRIG_IMPORT batch（参考 `src/views/note/extraction-import.ts` 内 ChapterInput 字面结构 + 契约 v2 §4.7 字面 table 嵌套形态）→ `krigBatchToAtoms(batch)` 字面 → `createNotesBatch` 字面 → 字面 verify storage 写入正确（1 table atom + N cell atoms + childOf 边 + rowIndex/colIndex）。

#### 4.3 `tests/scenarios/scenario-7-markdown-table.test.ts`

字面：markdown 字符串含 GFM 表格 → `markdownToAtoms` → `createNotesBatch` → 字面 verify。

#### 4.4 `tests/scenarios/scenario-9-rollback.test.ts`

字面：mock storage transaction 在第 3 个 item 字面抛错 → 验整批 rollback：
- `result.notes.length === 0`
- `result.failures` 含字面 `{ index: 2, rolledBack: true }` 等
- mock storage 内字面 0 atom 写入（前 2 个 item 也字面回滚）

#### 4.5 `tests/scenarios/scenario-11-full-roundtrip.test.ts`

字面端到端：markdown → `markdownToAtoms` → `createNotesBatch` → `assemblePmDoc` → 字面与原 markdown 解析出的 PM doc deep equal（这是 5B Stage 7 redo 整链的最直接验证）。

### Step 5: 性能压测

`tests/bench/markdown-1000-notes.bench.ts`：

```ts
import { bench, describe } from 'vitest';
import { markdownToAtoms } from '@capabilities/content-ingest/internal/markdown-to-atoms';
import { createNotesBatch } from '@platform/main/note/capability-impl';

const SAMPLE_MD = `# Test\n\nparagraph 1\n\nparagraph 2`;

describe('Stage 8 markdown 1000 batch', () => {
  bench('markdownToAtoms 1000', async () => {
    for (let i = 0; i < 1000; i++) {
      await markdownToAtoms(`${SAMPLE_MD} #${i}`, { titleHint: `Note ${i}` });
    }
  }, { iterations: 1 });

  bench('createNotesBatch 1000 in single tx', async () => {
    const items = await Promise.all(
      Array.from({ length: 1000 }, async (_, i) => {
        const { atoms } = await markdownToAtoms(`${SAMPLE_MD} #${i}`, { titleHint: `Note ${i}` });
        return { atoms, folderId: null, titleHint: `Note ${i}` };
      })
    );
    await createNotesBatch({ items, broadcastMode: 'final' });
  }, { iterations: 1 });

  // 字面 listNotes cold-start：先 batch 写 1000，然后 listNotes 算时长
  bench('listNotes after 1000 notes', async () => {
    // 字面 setup 在 beforeAll
  });
});
```

**注**：vitest bench 字面把 throughput / 延迟字面打印到 stdout。汇报时**包含**这些数字（不要只说"跑过了"）。

### Step 6: 验收（V1-V10）

#### V1: typecheck 全绿

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "src/main/ipc/handlers.ts\|src/renderer/shell/WorkspaceBar.tsx"
```

**期望**：0 行（注意 V1 残留 grep 字面排除）。

#### V2: `npm run test` 全绿

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npm run test
```

**期望**：所有 unit + scenario 测试 PASS。

#### V3: 测试文件清单全部存在

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && find tests -type f -name "*.ts" | sort
```

**期望**：含 setup.ts / mocks/storage-mock.ts + 6 unit + 5 scenario + 1 bench = 14 个 .ts 文件。

#### V4: vitest config + scripts 就位

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && cat vitest.config.ts | head && grep -E '"test"|"bench"' package.json
```

**期望**：vitest.config.ts 存在 + package.json scripts 含 test / test:watch / bench。

#### V5: storage mock 不漏方法

跑 npm test 时不应字面出现 "not implemented in test mock" 警告/错误。

#### V6: 单元测代码覆盖关键 API

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -l "dissectPmDoc\|assemblePmDoc\|tableAdapter\|markdownToAtoms\|createNotesBatch" tests --include='*.ts' -r | wc -l
```

**期望** ≥ 5（5 个核心 API 各有专属 test 文件）。

#### V7: 6 场景全跑通

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ls tests/scenarios/ && npm run test -- tests/scenarios/
```

**期望**：5 个 scenario 测试文件全 PASS（场景 1 / 6 / 7 / 9 / 11；场景 8 在 bench/）。

#### V8: 性能基准跑过且打印数字

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npm run bench
```

**期望**：跑完且 stdout 字面含 `ops/sec` 或 `ms` 数字。在汇报里**包含**：
- `markdownToAtoms 1000` 总时长 + 平均/篇
- `createNotesBatch 1000 in single tx` 总时长
- `listNotes after 1000 notes` 时长

#### V9: src/ 完全未动

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && git diff main -- src/ | head -5
```

**期望**：完全空（user 拍板 subagent 字面不许改 src/）。

#### V10: 仅在 commit 中包含的字面改动

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && git diff main --stat
```

**期望**：只见 `package.json` / `package-lock.json` / `vitest.config.ts` / `tests/**` 的字面改动。**不允许**字面任何 `src/` / `docs/` 改动（除本 prompt 文档可保留 untracked）。

### Step 7: Commit 纪律

完成全部 Step 1-6 + V1-V10 验收 PASS 后，**按拆 4 commit**：

- **commit 7a**：vitest 基础设施（install deps + vitest.config.ts + package.json scripts + tests/setup.ts + tests/mocks/storage-mock.ts）
- **commit 7b**：单元测试（tests/semantic + tests/platform + tests/capabilities — 6 个 .test.ts）
- **commit 7c**：集成测试（tests/scenarios — 5 个 scenario .test.ts）
- **commit 7d**：性能压测（tests/bench/markdown-1000-notes.bench.ts）

每段 commit 前 typecheck 必须 0 错。如 sandbox 拦截 tsc 或 commit，stop 报告让总指挥介入。

- **不要** push
- **不要** merge 到 main
- **不要** commit `docs/tasks/2026-05-29-stage-5B-impl-7-prompt.md` / `docs/tasks/import-progress-ui-prompt.md` 这类老 untracked
- 可以 commit 本 prompt 文档 `docs/tasks/2026-05-29-stage-5B-impl-9-prompt.md`（与 commit 7a 同 commit）

---

## 3. 操作纪律（违反任意一条立刻停手报告）

### 3.1 cwd 漂移防御

V2 cwd 漂移已 15 次事故记录（含 git stash 引发 V1 conflict 烂摊子、git push 险 force push V1 main）。

**每一条 Bash 都必须 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`**。Read / Edit / Write 一律传绝对路径 `/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2/...`。

三联守门：

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && pwd && git remote -v | head -1 && git branch --show-current
```

V1 / V2 速判：
- V1 顶层有 `src/main/`、`src/renderer/`、`src/plugins/`
- V2 顶层有 `src/platform/main/`、`src/views/`、`src/capabilities/`、`src/drivers/`、`src/storage/`、`src/semantic/`
- V1 main 字面 hash `47015ed8` / `7f47f42f`
- `git remote -v` URL：V2 是 `KRIG-Note-V2.git`；V1 是 `KRIG-Note.git`

### 3.2 sandbox 限制（已知）

harness sandbox 可能拦截：
- `npm install` — 装 vitest 时
- `npx vitest` / `npm run test` — 跑 vitest 时
- `npx tsc --noEmit` — typecheck 时
- `git add` / `git commit` — commit 时

**遇到拦截不要走 `--dangerouslyDisableSandbox`**，停下来汇报让总指挥介入。

Stage 5 / 6 / 7 / 7-redo 都遇到过。每次拦截就在汇报里写"sandbox blocked X, need user intervention"。

### 3.3 实施纪律（严格）

**可以**：
- 在 `test/stage-9-test-infrastructure` 分支上改 `package.json` / `package-lock.json` / 新建 `vitest.config.ts` / 在 `tests/` 下新建任何文件
- `npm install` 装 vitest 相关 dev deps
- `npx tsc --noEmit` 跑 typecheck
- `npm run test` / `npm run bench` 跑测试
- 拆 4 commit 进本分支

**严禁（用户拍板）**：
- ❌ 改 **`src/` 任何文件** — 即使你发现 Stage 1-8 落地代码 bug。**bug 只在汇报里登记，不修改**
- ❌ 改任何 docs/（除本 prompt 文档可 commit）
- ❌ 切其它分支（含 main）
- ❌ merge / cherry-pick / rebase
- ❌ `git push`
- ❌ 操作数据库
- ❌ 走 `--dangerouslyDisableSandbox`

### 3.4 完成标准

- 10 个 V1-V10 验收全部 PASS
- 4 个 commit 在 `test/stage-9-test-infrastructure` 分支
- V2 第一次有可跑的 `npm run test` + `npm run bench`

完成后向调用方汇报：

- 4 个 commit hash + 改动文件清单
- V1-V10 各项验收结果
- **V8 性能数字字面包含**（不只是"跑过了"）
- 实施过程中发现的 src/ bug（如有，只列出文件:行号 + 描述，**不修**）
- 任何 5B 设计文档与现实情况不一致的发现
- 任何因 vitest 限制 / mock storage 模型偏差导致测试与"真生产路径"不字面一致的发现

---

## 4. Agent 配置建议（给调用方）

- **agent 类型**：`general-purpose`（**不是 Plan** — Plan 没 Write/Edit 工具）
- **后台运行**：可后台。完成时通知
- **预期工作时间**：3-5 小时（vitest 安装 + 单元 6 + 场景 5 + bench 1 + 验收）

---

## 5. 已知风险（subagent 必读）

1. **vitest mock @storage/index 字面坑**：vitest mock 是 hoisted 的，beforeEach 内 `vi.mock` 不会按预期生效；字面用 module-level `vi.mock` 或 `vi.doMock` 配 lazy import。

2. **createNotesBatch 字面调 `broadcastNoteListChanged`**（main 端字面调 webContents.send）：测试环境没 BrowserWindow → 字面会抛 / silent fail。**字面 mock broadcastNoteListChanged 为 spyable noop**（**严禁改 src/**；通过 vitest module mock 字面替换）。

3. **assemblePmDoc 内字面调 `storage.listEdges`**：mock storage 必须实现 listEdges 含过滤参数（predicate / objectAtomId）。先 grep 字面调用形态。

4. **payload domain 字面**：测试构造 atom 字面 `{ domain: 'pm', payload: {...} }`，否则 typecheck 字面报错。

5. **markdownToAtoms 内字面 import `markdownToProseMirror` from text-editing/converters/md-to-pm**：该函数字面**依赖 mediaPutBase64**（base64 → media://），测试环境字面没 electronAPI → markdown 含 image 字面会抛。**测试样本字面用纯文本 markdown / 不含 base64 image**，或 mock electronAPI。

6. **typecheck pathway**：tsconfig.json 字面 `include: ["src/**/*"]`，tests/ 字面**不在 include 内**。要让 tsc 看到 tests/ 需要单独 tsconfig.test.json 或字面加 include。**字面建议**：tests/ 走 vitest 自带的 tsx 编译（不用 tsc），所以**主 tsconfig 字面不改**。V1 typecheck 只跑 src/。

7. **package-lock.json 字面会变大** — 装 vitest 字面会改 package-lock.json。这是预期，正常 commit。

---

*Stage 9 实施 Prompt · 2026-05-29 · self-contained · 用户拍板：mock storage + 严禁改 src/ + 6 自动化场景 + bench*
