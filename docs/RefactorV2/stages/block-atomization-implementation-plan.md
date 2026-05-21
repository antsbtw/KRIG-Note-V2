# Block 独立化 sub-phase 实施任务设计 v0.1

> **类型**:实施任务设计(纯文档,不写代码)
> **决议日期**:2026-05-21
> **前置依赖**:
>   - [`decision 025`](../data-model/atom/decisions/025-atom-granularity-current-form-acknowledgment.md) 承接 v1.3 工程妥协
>   - [`decision 026`](../data-model/persistence/decisions/026-block-atomization-sub-phase-design.md) 核心设计拍板
> **设计起点**:[Canvas-As-Note-Migration.md](../../10-business-design/graph/Canvas-As-Note-Migration.md)(V1 时代已有完整草案)
> **实施分支**(待启动):`feature/L7-sub<N>-block-atomization`(N 待 L7 启动包确定下个编号)

---

## 0. 上下文

### 0.1 实施任务设计 vs 决议设计

| 性质 | 决议 026 | 本文档(实施任务设计) |
|---|---|---|
| 解什么 | What + Why | How(分阶段 + 验收门槛 + 测试)|
| 性质 | 语义级拍板 | 工程级任务分解 |
| 改 src/ | 不改 | 不改(本任务也是设计阶段,实施留下个独立分支)|

→ 本文档读完后,用户拍板"启动 / 不启动 / 延后"。

### 0.2 工作目录纪律

V2 = `/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`(每 Bash 调用都 `cd` 显式指定)
V1 仅参考,不动。

### 0.3 实施纪律

沿 [decision 011 / 012 / 022](../data-model/persistence/decisions/) 同模式:

- 严格按本文档执行,不自行扩展范围
- 每完成一个 Stage commit 一次(不合 main)
- 完成全部 Stage 后停下,通知设计师 session 审计
- 涉及 SurrealQL / schema 操作要 binary verify(decision 022 §0.2 模式)
- 严格遵守 [`feedback_decision_grep_verify_complete_propagation`](../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_decision_grep_verify_complete_propagation.md) — 实施前先 grep 6 层传播链
- 严格遵守 [`feedback_pm_internal_attr_write_must_mark_no_history`](../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_pm_internal_attr_write_must_mark_no_history.md) — PM 内部 attr 写入必须 `addToHistory:false`
- 严格遵守 [`feedback_pm_schema_naming`](../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_pm_schema_naming.md) — PM node name 不含短横线
- 严格遵守 [`feedback_strict_compliance_workflow`](../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_strict_compliance_workflow.md)

---

## 1. 分阶段总览(2026-05-21 审计后修订估时)

| Stage | 内容 | 估时(下限-上限)| 主要风险 | 验收门槛 |
|---|---|---|---|---|
| **Stage 1** | PM schema 改造(叶子+叶子级容器加 id 字段)+ appendTransaction id 注入(skipOnChange meta 防御)| 1.5 - 2 天 | 28 blocks 评估 + skipOnChange 实施 | EM1 全 typecheck + 各 block 渲染冒烟 |
| **Stage 2** | note capability 读时拼装(含跨层重建中间 wrapper)+ 写时拆解 + diff + in-memory cache | 2 - 3 天 | diff 算法 + 跨层重建复杂度 | EM2 单 note round-trip 字面相等 |
| **Stage 3** | 三 predicate 字面落地(belongsToNote / nextSibling / childOf 含跨层跳)| 0.5 天 | predicate 命名 / cardinality / 跨层规则 | EM3 relations/spec.md 字面 + cardinality 检查 |
| **Stage 4** | NoteLocator 升级 + thought view 适配 | 1 - 1.5 天 | 约 10 处 NoteLocator 使用点(实施前复 grep 校准)| EM4 thought 锚点深度编辑后不漂移 |
| **Stage 5** | URL 协议演化(getBlockAnchorAt → getBlockIdAt)| 0.5 天 | 旧 URL 兼容 | EM5 旧 URL 点击错误提示,新 URL 字面工作 |
| **Stage 6** | 一次性 migration script(已有 note 拆 atom)+ 备份 round-trip 测试 | 1 - 1.5 天 | 数据丢失风险 | EM6 备份数据 round-trip 通过 |
| **Stage 7** | 典型场景测试(create/edit/split/merge/copy-paste/undo)| 1 天 | id 注入 timing / undo 边界 | EM7 8 个场景全通过 |
| **Stage 8** | 性能压测(1000-block note read/write/cache)+ 不达标处理决策 | 0.5 - 1 天 | 性能不达标 → 留独立 sub-phase | EM8 P95 字面或登记不达标 |
| **Stage 9** | 验收 + 文档反向更新 | 0.5 - 1 天 | — | EM9 三层架构 + 既有 decision 同步 |
| **总计** | | **8.5 - 12 天** | | |

**buffer 来源**:diff 算法 + 跨层重建调试(+1) / migration round-trip 排查(+0.5) / 性能不达标处理(+0.5) / NoteLocator 实际使用点字面校准(+0.5)。

---

## 2. Stage 1 — PM schema 改造 + appendTransaction id 注入

### 2.1 目标

每个 PM block schema 加 `id: { default: null }` attrs;新建 block 时自动注入 ULID。

### 2.2 改动清单

| 改动 | 位置 | 字面 |
|---|---|---|
| 28 blocks 目录评估 + 叶子&叶子级容器加 id 字段 | `src/drivers/text-editing-driver/blocks/*/spec.ts`(28 个目录,按 decision 026 §3.1 拆分清单字面执行)| `attrs: { id: { default: null }, ... }`;**结构性容器(table/tableRow/3 list 容器/columnList)不加** |
| 6 媒体 block 旧 atomId 字段 → id | `src/drivers/text-editing-driver/blocks/{image,audioBlock,videoBlock,htmlBlock,tweetBlock,mathVisual}/spec.ts` | 字面 rename(migration 处理存量数据)|
| appendTransaction id 注入 plugin | `src/drivers/text-editing-driver/plugins/auto-block-id-plugin.ts`(新)| 扫描 newDoc,无 id 的 block → 注入 ULID,**`addToHistory: false` + `setMeta('skipOnChange', true)`** 防御冷启动 N atom 写入 race |
| Host onChange handler 过滤 skipOnChange | `src/drivers/text-editing-driver/Host.tsx` 或 `editor-view-builder.ts` 的 dispatchTransaction 后 | 字面检查 `tr.getMeta('skipOnChange')` → true 则不调 onChange |
| 注册 plugin | `src/drivers/text-editing-driver/editor-view-builder.ts` | 加入 plugins 数组 |
| toDOM / parseDOM 同步 | 各 block spec.ts | id 字段不需要 toDOM(纯 schema),parseDOM 保留兼容 |

### 2.3 实施 Step

#### Step 1.1 — 创建分支 + 起点验证

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
git checkout -b feature/L7-sub<N>-block-atomization main
npm run typecheck  # 起点全绿
npm run lint
git log --oneline -5
```

#### Step 1.2 — 28 blocks 评估 + 按 decision 026 §3.1 拆分清单加 id 字段

字面工作:遍历 28 个 block 目录 `src/drivers/text-editing-driver/blocks/*/spec.ts`,按 decision 026 §3.1.1 / §3.1.2 拆分清单字面加或不加:

**加 `id: { default: null }`(叶子 + 叶子级容器)**:
- paragraph / heading / horizontalRule / hardBreak
- codeBlock / mathBlock / mathVisual
- image / fileBlock / fileLink / audioBlock / videoBlock / htmlBlock / tweetBlock
- externalRef
- listItem / taskItem
- tableCell / tableHeader
- callout
- blockquote(叶子级容器)
- column
- toggleList
- unknown

**不加 id 字段(结构性容器)**:
- table(根容器)
- tableRow(中间层)
- bulletList / orderedList / taskList(列表根容器)
- columnList(多列根容器)

**注 1**:tableHeader 字面与 tableCell 同模式加 id(decision 026 §3.1.2 注 1),实施时 verify PM schema 关系无矛盾。

**注 2**:noteLink(group='inline')不加 id,sub-phase 范围外。

Commit:`feat(block-atom): add id attrs to leaf and leaf-level container blocks per decision 026 §3.1`

#### Step 1.3 — 6 媒体 block 字段统一

字面:把 `image`/`audioBlock`/`videoBlock`/`htmlBlock`/`tweetBlock`/`mathVisual` 的 `atomId` 字段重命名为 `id`(default null 不变)。

⚠ migration 在 Stage 6 一起做(旧数据的 atomId 字段值要迁到 id)。

Commit:`refactor(block-atom): rename atomId → id in 6 media blocks`

#### Step 1.4 — auto-block-id-plugin(含 skipOnChange meta 防御)

创建 `src/drivers/text-editing-driver/plugins/auto-block-id-plugin.ts`:

```ts
import { Plugin, PluginKey } from 'prosemirror-state';
import { generateId } from '@semantic/id';

export const autoBlockIdKey = new PluginKey('auto-block-id');

/**
 * 按 decision 026 §3.1 拍板,只为"叶子 + 叶子级容器"注入 id。
 * 结构性容器(table / tableRow / bulletList / orderedList / taskList / columnList)不注入。
 */
const STRUCTURAL_CONTAINER_TYPES = new Set([
  'table',
  'tableRow',
  'bulletList',
  'orderedList',
  'taskList',
  'columnList',
]);

function shouldHaveId(node) {
  if (node.type.spec.group !== 'block') return false;
  if (STRUCTURAL_CONTAINER_TYPES.has(node.type.name)) return false;
  return true;
}

export const autoBlockIdPlugin = () => new Plugin({
  key: autoBlockIdKey,
  appendTransaction(transactions, oldState, newState) {
    let tr = newState.tr;
    let modified = false;
    newState.doc.descendants((node, pos) => {
      if (shouldHaveId(node) && !node.attrs.id) {
        tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: generateId() });
        modified = true;
      }
    });
    if (modified) {
      // 1. 不进 history(沿 feedback_pm_internal_attr_write_must_mark_no_history)
      tr = tr.setMeta('addToHistory', false);
      // 2. 防御冷启动 race:旧 doc 装载完 appendTransaction 自动注入会触发 N atom 写入
      //    (审计 §3.5);Host onChange handler 检查 skipOnChange meta → 不发 IPC
      //    Stage 6 migration 已主体注入;本 plugin 仅防御漏 block(idempotent)
      tr = tr.setMeta('skipOnChange', true);
      return tr;
    }
    return null;
  },
});
```

**Host onChange handler 字面同步改动**:

```ts
// editor-view-builder.ts 或 Host.tsx dispatchTransaction 处
dispatchTransaction(tr) {
  // ...existing dispatch logic...
  newState = view.state.apply(tr);
  view.updateState(newState);

  // 检查 skipOnChange — Stage 1.4 防御逻辑
  if (tr.getMeta('skipOnChange') === true) {
    return;  // 不调 onChange,不发 IPC
  }

  onChange(serialize(newState.doc));
}
```

**字面承接拍板**(decision 026 §12.2 表第 6 行):审计 AskUserQuestion 5 拍板防御方案。

Commit:`feat(block-atom): add auto-block-id plugin with skipOnChange race defense`

#### Step 1.5 — 注册 plugin

`src/drivers/text-editing-driver/editor-view-builder.ts`:

```ts
import { autoBlockIdPlugin } from './plugins/auto-block-id-plugin';

const plugins = [
  // ...existing plugins
  autoBlockIdPlugin(),  // 必须早于 collab/history,确保 history transaction 不触发再注入
];
```

Commit:`feat(block-atom): register auto-block-id plugin in editor view`

#### Step 1.6 — typecheck + lint + 冒烟

```bash
npm run typecheck
npm run lint
npm start
# 手动测:
# - 新建 note → 输入文字 → 控制台打印 doc.toJSON() → 确认每 block 都有 attrs.id (ULID 字面)
# - 创建 list-item / table-cell / callout → 嵌套 block 也有 id
# - 旧 note 打开(无 id 的旧 doc) → appendTransaction 自动给所有 block 注入 id
```

Commit:`docs(block-atom): stage 1 smoke test report`(verify-only,无代码)

### 2.4 验收(EM1)

- ✅ `npm run typecheck` 全绿
- ✅ `npm run lint` 全绿
- ✅ 新建 note 后所有 block 都有 attrs.id
- ✅ 旧 doc 打开后自动注入 id(无 id → ULID)
- ✅ undo/redo 不触发 id 重复注入(test:输入 → undo → redo,id 字面不变)

### 2.5 风险

| 风险 | 缓解 |
|---|---|
| 注入时机不对(history transaction 触发再注入)| `addToHistory: false`,plugin order 提前 |
| 部分 block 的 attrs.id 与现有字段冲突 | 6 媒体 block 已有 atomId 字段是占位字符串,字面 rename 即可;其他 block 字面未占用 id 字段 |

---

## 3. Stage 2 — note capability 读时拼装 + 写时拆解 + in-memory cache(含跨层中间 wrapper 重建)

### 3.1 目标

`note/capability-impl.ts` 改造:
- `createNote` → 创建 note 容器 atom(空 payload doc)+ 一个默认 paragraph block atom + 边
- `getNote` → 拼装(listAtoms by belongsToNote + 拓扑排序 + childOf 展开 + **跨层中间 wrapper 重建**)
- `updateNote` → diff + 拆解 + 增量 atom/edge 写入
- `deleteNote` → 级联删 belongsToNote 子 atom

**跨层中间 wrapper 重建**(decision 026 §6.1 字面拍板):

storage 中只有拆 atom 的层(叶子 + 叶子级容器),tableRow / bulletList 等结构性容器**无 atom**。拼装时 capability 层需在 PM tree 中重新插入这些中间 wrapper:

- `tableCell.childOf → table atom` → 拼装时需重建 `table > tableRow > tableCell` 三层嵌套(按行号 / 顺序推断)
- `listItem.childOf → callout atom` → 拼装时需重建 `callout > bulletList > listItem`(根据 listItem 的 attrs 推断 list type)
- `column.childOf → note 容器` → 拼装时需重建 `columnList > column`

实施细节:用 PM schema 的 `nodeFromJSON` + 代码内置规则;复杂场景 fallback 到 PM schema autofill。

### 3.2 改动清单

| 改动 | 位置 |
|---|---|
| 拼装函数 | `src/platform/main/note/assemble-pm-doc.ts`(新) |
| 拆解函数 | `src/platform/main/note/dissect-pm-doc.ts`(新) |
| diff 函数 | `src/platform/main/note/diff-block-tree.ts`(新) |
| in-memory cache | `src/platform/main/note/pm-doc-cache.ts`(新) |
| capability-impl 重写 | `src/platform/main/note/capability-impl.ts` |
| envelope 不动 | `src/platform/main/note/envelope.ts` |

### 3.3 实施 Step

#### Step 2.1 — 拼装函数 assemble-pm-doc

```ts
// 伪代码
export async function assemblePmDoc(noteAtomId: string): Promise<PmPayload> {
  // 1. listAtoms by belongsToNote = noteAtomId
  const blockEdges = await storage.listEdges({
    predicate: 'user:krig:belongsToNote',
    objectAtomId: noteAtomId
  });
  const blockIds = blockEdges.map(e => e.subject.atomId);
  const blockAtoms = await Promise.all(blockIds.map(id => storage.getAtom<'pm'>(id)));

  // 2. listEdges nextSibling for 拓扑排序
  const nextEdges = await storage.listEdges({
    predicate: 'user:krig:nextSibling',
    // filter subjects 在 blockIds 内
  });
  const order = topologicalSort(blockIds, nextEdges);

  // 3. listEdges childOf for 嵌套展开
  const childEdges = await storage.listEdges({
    predicate: 'user:krig:childOf',
    // filter subjects 在 blockIds 内
  });
  // 把每个容器 block 的 content[] 用 childOf 关联展开

  // 4. 输出完整 PmPayload(type:'doc', content: [...])
  return assembleFromBlocks(order, blockAtoms, childEdges);
}
```

#### Step 2.2 — 拆解函数 dissect-pm-doc

```ts
// 伪代码
export function dissectPmDoc(noteAtomId: string, doc: PmPayload): {
  blocks: Array<{ id: string; payload: PmPayload }>;
  edges: Array<{ predicate: string; subjectId: string; objectId: string }>;
} {
  const blocks: ... = [];
  const edges: ... = [];

  let prevTopLevelId: string | null = null;
  doc.content.forEach((node, idx) => {
    const id = node.attrs?.id;  // appendTransaction 保证有 id
    blocks.push({ id, payload: simplifyForStorage(node) });  // 容器 block 的 content 设空数组
    edges.push({ predicate: 'belongsToNote', subjectId: id, objectId: noteAtomId });
    if (prevTopLevelId) {
      edges.push({ predicate: 'nextSibling', subjectId: prevTopLevelId, objectId: id });
    }
    if (isContainer(node)) {
      // 递归把子 block 也拆出,加 childOf 边
      walkContainerChildren(node, id, blocks, edges);
    }
    prevTopLevelId = id;
  });

  return { blocks, edges };
}
```

#### Step 2.3 — diff 算法

输入 oldDoc / newDoc,输出 added / modified / removed / edge-changes。

```ts
// 伪代码
function diffBlockTree(oldDoc, newDoc) {
  const oldBlocks = collectBlocks(oldDoc);  // Map<id, blockPayload>
  const newBlocks = collectBlocks(newDoc);

  const added: Block[] = [];
  const modified: Block[] = [];
  const removed: string[] = [];

  newBlocks.forEach((blk, id) => {
    if (!oldBlocks.has(id)) added.push(blk);
    else if (!deepEqual(blk, oldBlocks.get(id))) modified.push(blk);
  });
  oldBlocks.forEach((blk, id) => {
    if (!newBlocks.has(id)) removed.push(id);
  });

  // edge diff: 算 nextSibling / childOf 链表前后差异
  const edgeDiff = diffEdges(oldDoc, newDoc);

  return { added, modified, removed, edgeDiff };
}
```

#### Step 2.4 — in-memory cache

```ts
// src/platform/main/note/pm-doc-cache.ts
class PmDocCache {
  private cache = new Map<string, PmPayload>();

  get(noteId: string): PmPayload | undefined { return this.cache.get(noteId); }
  set(noteId: string, doc: PmPayload): void { this.cache.set(noteId, doc); }
  invalidate(noteId: string): void { this.cache.delete(noteId); }
}
export const pmDocCache = new PmDocCache();
```

注:本 sub-phase v1 不加 LRU eviction(decision 026 §13.4 临时默认)。

#### Step 2.5 — capability-impl 重写

```ts
export async function createNote(initialDoc, folderId) {
  return storage.transaction(async (tx) => {
    // 1. 创建 note 容器 atom(payload = empty doc)
    const noteAtom = await tx.putAtom<'pm'>({
      payload: { domain: 'pm', payload: { type: 'doc', content: [] } }
    });
    // 2. 创建一个默认 paragraph block atom
    const paraId = generateId();
    const paraAtom = await tx.putAtom<'pm'>({
      payload: { domain: 'pm', payload: { type: 'paragraph', attrs: { id: paraId, isTitle: true }, content: [] } }
    });
    // 3. 加边:hasNoteView(note 容器) + inFolder + belongsToNote(para → note) + nextSibling(none)
    await tx.putEdge({ predicate: 'user:krig:hasNoteView', ... });
    if (folderId) await tx.putEdge({ predicate: 'user:krig:inFolder', ... });
    await tx.putEdge({ predicate: 'user:krig:belongsToNote', subject: paraAtom.id, object: noteAtom.id });
    // 4. 返回组装好的 NoteInfo
    const doc = await assemblePmDoc(noteAtom.id);
    pmDocCache.set(noteAtom.id, doc);
    return atomToNoteInfo(noteAtom, folderId, doc);
  });
}

export async function getNote(id) {
  const cached = pmDocCache.get(id);
  if (cached) {
    // ... return note from cache
  }
  const noteAtom = await storage.getAtom<'pm'>(id);
  if (!noteAtom) return null;
  // 校验 hasNoteView 边(沿 decision 016 §3.4)
  const noteViewEdges = await storage.listEdges({ predicate: 'user:krig:hasNoteView', subjectAtomId: id, limit: 1 });
  if (noteViewEdges.length === 0) return null;
  // 拼装 PM doc
  const doc = await assemblePmDoc(id);
  pmDocCache.set(id, doc);
  const folderId = await getFolderIdForNote(id);
  return atomToNoteInfo(noteAtom, folderId, doc);
}

export async function updateNote(id, newDocEnv) {
  const newDoc = unwrapPmDoc(newDocEnv);
  const oldDoc = pmDocCache.get(id) ?? await assemblePmDoc(id);
  const diff = diffBlockTree(oldDoc, newDoc);

  await storage.transaction(async (tx) => {
    for (const a of diff.added)    await tx.putAtom({ ... });
    for (const m of diff.modified) await tx.putAtom({ id: m.id, ... });
    for (const r of diff.removed)  await tx.deleteAtom(r);
    for (const e of diff.edgeDiff.added)   await tx.putEdge({ ... });
    for (const e of diff.edgeDiff.removed) await tx.deleteEdge(e);
  });

  pmDocCache.set(id, newDoc);
  return atomToNoteInfo(...);
}

export async function deleteNote(id) {
  pmDocCache.invalidate(id);
  // 级联删:storage.deleteAtom 已应用层级联,但要确保 belongsToNote 子 atom 也删
  // 字面方案:先 listEdges by belongsToNote.object=id → 拿到所有子 atom → deleteAtom each
  const blockEdges = await storage.listEdges({
    predicate: 'user:krig:belongsToNote', objectAtomId: id
  });
  await storage.transaction(async (tx) => {
    for (const edge of blockEdges) {
      await tx.deleteAtom(edge.subject.atomId);
    }
    // 删 note 容器 atom + hasNoteView / inFolder 边(级联)
    await tx.deleteAtom(id);
  });
  return { cascadedEdges: ... };
}
```

#### Step 2.6 — typecheck + lint + 单 note round-trip 测试

```bash
npm run typecheck && npm run lint
# 单元测试:
# 1. 创建 note → typecheck NoteInfo.doc 字面有内容
# 2. updateNote(doc with 3 blocks) → getNote → 字面相等
# 3. updateNote(doc with 3 blocks + 1 added) → diff 算法 added 字面 = 1
```

Commit 序列:
- `feat(block-atom): add assemble-pm-doc / dissect-pm-doc functions`
- `feat(block-atom): add diff-block-tree algorithm`
- `feat(block-atom): add pm-doc-cache`
- `refactor(block-atom): rewrite note capability with block atom model`

### 3.4 验收(EM2)

- ✅ typecheck + lint 全绿
- ✅ 创建 note → getNote 字面相等
- ✅ updateNote round-trip 字面相等(同一 doc 调 update,storage 状态不变,diff 算法应识别 added/modified/removed 均 0)
- ✅ 1000-block doc 拼装 < 100ms(若慢留 Stage 8 优化)

---

## 4. Stage 3 — 三 predicate 字面落地

### 4.1 改动清单

| 改动 | 位置 |
|---|---|
| 加 3 predicate 到 relations vocab 登记 | `docs/RefactorV2/data-model/relations/spec.md` §10 |
| capability 内部使用 string literal | 已在 Stage 2 字面使用 |
| L2 cardinality 检查 | `src/storage/migration/cardinality-check.ts`(沿 decision 022 模式) |

### 4.2 实施 Step

#### Step 3.1 — relations/spec.md 字面登记

文档追加 3 行 predicate(沿 decision 022 §5.9 模式):

```
| user:krig:belongsToNote | block atom → note atom 容器 | 每 block 1 条 outgoing |
| user:krig:nextSibling | block atom → block atom(下一个) | 每 atom ≤1 outgoing + ≤1 incoming |
| user:krig:childOf | 嵌套 block 之子 → 父 | 每 atom ≤1 outgoing |
```

#### Step 3.2 — cardinality 检查(L2 扫描)

参考 decision 022 §5.9 模式:扫描 storage 内边,检测:

- 每 block atom outgoing belongsToNote = 1(0 或 >1 报错)
- 每 block atom outgoing nextSibling ≤ 1
- 每 block atom incoming nextSibling ≤ 1
- 每 block atom outgoing childOf ≤ 1

Commit:`feat(block-atom): register 3 new predicates + L2 cardinality check`

### 4.3 验收(EM3)

- ✅ relations/spec.md §10 字面有 3 行
- ✅ cardinality 检查 npm script 通过

---

## 5. Stage 4 — NoteLocator 升级 + thought view 适配

### 5.1 改动清单

| 改动 | 位置 |
|---|---|
| NoteLocator 类型升级 | `src/shared/ipc/thought-types.ts:57` |
| 约 10 处 NoteLocator 使用点字面同步(2026-05-21 grep,实施前复 grep 校准)| grep 找到的所有引用 |
| thought 锚点解析逻辑 | `src/views/thought/anchor-resolver.ts`(新或改)|
| thought UI 跳转 | 走 blockId(via attrs.id 查 PM node) |

### 5.2 NoteLocator 新形态

```ts
export interface NoteLocator {
  /** 块 ID(block atom 的 ULID),取代旧的 pmPos + 冗余 text */
  blockId: string;
  /** sub-position 偏移(可选,inline 级标注用)*/
  offset?: { from: number; to: number };
}
```

字面对比旧形态(thought-types.ts:57-64):

```ts
// 旧
export interface NoteLocator {
  pmPos: number;
  anchorType: 'inline' | 'block' | 'node';
  text: string;
}
```

迁移路径:
- 已有 thought NoteLocator(pmPos / text)→ Stage 6 migration script 转换为 blockId
- 转换算法:读 thought 对应 note 的旧 doc,定位 pmPos 处的 block → 取其新注入的 attrs.id → 替换 NoteLocator.blockId

### 5.3 实施 Step

#### Step 4.1 — 类型定义升级

`thought-types.ts` 改 NoteLocator 字面,加注释引用本决议。

Commit:`refactor(block-atom): upgrade NoteLocator to blockId model`

#### Step 4.2 — 约 10 处使用点字面同步(实施前复 grep)

grep 出全部使用点:

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
grep -rn "NoteLocator\|pmPos" src/ 2>/dev/null
# 2026-05-21 grep 字面 18 行(含 thought-types.ts 自身定义);
# 实际使用点约 10 处。实施前必须复 grep 验证当前数字。
```

逐一字面修改。

Commit 多次(每文件一 commit 或聚合)。

#### Step 4.3 — thought view 跳转逻辑

`src/views/thought/anchor-resolver.ts`(新或改):

```ts
export function resolveNoteLocator(noteId: string, locator: NoteLocator) {
  // 1. 拿当前 note 的 PM doc(via getNote)
  // 2. 在 doc 中找 attrs.id === locator.blockId 的 node
  // 3. 返回 node 的当前 pos(用于 scroll / highlight)
}
```

Commit:`feat(block-atom): thought anchor resolution via blockId`

### 5.4 验收(EM4,2026-05-21 审计后字面澄清)

- ✅ 创建 thought 标注 note 段 A(attrs.id = X)
- ✅ 在 note 头部插入 100 个 paragraph(A 的 PM pos 下移但 **attrs.id 字面不变**,X 保留)
- ✅ thought NoteLocator.blockId = X(不变);thought 列表点击 → 按 X 查找 PM node → 精确滚到段 A(不漂移)
- ✅ 对比:旧 NoteLocator(pmPos + text)在同样场景下漂移失败 — 本测试验证新模型的根治性

---

## 6. Stage 5 — URL 协议演化

### 6.1 改动清单

| 改动 | 位置 |
|---|---|
| `getBlockAnchorAt` → `getBlockIdAt` | [`api.ts:823`](../../../src/drivers/text-editing-driver/api.ts#L823) |
| `scrollToBlockAnchor` 新格式解析 | [`build-link-click-plugin.ts:73`](../../../src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts#L73) |
| URL 路由 | [`build-link-click-plugin.ts:162`](../../../src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts#L162) |
| 旧 URL 错误提示 UI | `src/capabilities/text-editing/ui/error-toast/...`(新或复用) |
| LinkPanel 显示 | [`LinkPanel.tsx`](../../../src/capabilities/text-editing/ui/link-panel/LinkPanel.tsx) |
| note-commands(Copy Link) | [`note-commands.ts`](../../../src/views/note/note-commands.ts) |

### 6.2 实施 Step

#### Step 5.1 — getBlockIdAt 新实现

```ts
// api.ts
getBlockIdAt(instanceId, pos) {
  const inst = instanceRegistry.get(instanceId);
  if (!inst) return null;
  const $pos = inst.view.state.doc.resolve(pos);
  // 找最近的 group='block' 父节点
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d);
    if (node.type.spec.group === 'block' && node.attrs.id) {
      return node.attrs.id;
    }
  }
  return null;
}
```

#### Step 5.2 — scrollToBlockAnchor 升级

```ts
export function scrollToBlockAnchor(view, blockId, opts) {
  let targetPos = -1;
  view.state.doc.descendants((node, pos) => {
    if (node.attrs?.id === blockId) {
      targetPos = pos;
      return false;
    }
    return true;
  });
  if (targetPos < 0) {
    console.warn(`scrollToBlockAnchor: block ${blockId} not found`);
    return;
  }
  // scroll + flash 高亮
  ...
}
```

#### Step 5.3 — 旧 URL 错误提示

URL 路由处:检测 anchor 含 `:` 或不是 ULID 格式 → 弹 toast "链接已失效,请重新复制"。

#### Step 5.4 — note-commands Copy Link

字面改 `note-commands.ts` 的 Copy Link 命令:用 `getBlockIdAt` 替代 `getBlockAnchorAt`,URL 字面 `krig://block/<noteId>/<blockId>`。

Commit:`feat(block-atom): URL protocol evolution (block id replaces idx+text)`

### 6.3 验收(EM5)

- ✅ 新建 note → 选某 block → Copy Link → URL 字面是 `krig://block/<noteId>/<ULID>`
- ✅ 点击新 URL → 滚到目标 block
- ✅ 点击旧 URL(`krig://block/x/12:hello`)→ Toast "链接已失效"
- ✅ 用户编辑 note 后,新 URL 仍工作

---

## 7. Stage 6 — 一次性 migration script

### 7.1 目标

把已有 note 数据(整篇 PM doc 1 atom)拆成 block-level atom + 边集合。

### 7.2 实施 Step

#### Step 6.1 — schema version bump

```ts
// src/storage/migration/migrations/1-3-0-block-atomization.ts
export const migrationV1_3_0 = {
  version: '1.3.0',
  up: async (storage) => {
    // 1. 列出所有 hasNoteView 边的 subject(全部 note atom)
    const noteEdges = await storage.listEdges({ predicate: 'user:krig:hasNoteView' });

    for (const edge of noteEdges) {
      const noteId = edge.subject.atomId;
      const noteAtom = await storage.getAtom<'pm'>(noteId);
      if (!noteAtom) continue;

      const oldDoc = noteAtom.payload.payload;  // type:'doc', content:[...]

      // 2. 给每 block 注入 id(walk doc + setNodeAttr)— 用 PM helper 模拟
      const newDocWithIds = injectIdsToDoc(oldDoc);

      // 3. 拆解 + 写边(用 Stage 2 的 dissectPmDoc 函数)
      const { blocks, edges } = dissectPmDoc(noteId, newDocWithIds);

      // 4. transaction:
      await storage.transaction(async (tx) => {
        // a. 把 note atom 的 payload 清空(变成 note 容器,content:[])
        await tx.putAtom({ id: noteId, payload: { domain: 'pm', payload: { type: 'doc', content: [] } } });
        // b. 写所有 block atom
        for (const b of blocks) await tx.putAtom({ id: b.id, payload: { domain: 'pm', payload: b.payload } });
        // c. 写所有边
        for (const e of edges) await tx.putEdge({ ... });
      });
    }

    // 5. 同步处理 6 媒体 block 的 atomId → id 字段 rename(在 injectIdsToDoc 内)
    // 6. thought NoteLocator 升级:pmPos+text → blockId(在另一个 migration step)
  },
};
```

#### Step 6.2 — 添加注册到 migration runner

`src/storage/migration/index.ts` 注册 migrationV1_3_0。

#### Step 6.3 — thought NoteLocator 数据迁移

读 thought 数据,对每个 NoteLocator:
- 用旧 pmPos 在迁移前的 old doc 内定位 block(已有 attrs.id 通过 injectIdsToDoc 注入)
- 把 NoteLocator.pmPos / text 字段替换为 blockId

#### Step 6.4 — 备份数据 round-trip 测试

```bash
# 1. 拷一份生产 leveldb 到测试目录
# 2. 跑 migration
# 3. 启动 app → getNote each → 字面渲染等价(diff 旧 vs 新文本内容)
# 4. 失败 → 修 migration → 重跑
```

Commit:`feat(block-atom): migration v1.3.0 block atomization`

### 7.3 验收(EM6)

- ✅ 备份数据跑 migration 成功(无 throw)
- ✅ 跑完后 listNotes 数量字面相同
- ✅ 每篇 note getNote 字面文本等价(text content 相同;PM tree 结构相同)
- ✅ 所有 thought NoteLocator 已升级
- ✅ 失败回滚机制:migration 异常 → schema version 不 bump,下次启动重试

---

## 8. Stage 7 — 典型场景测试

### 8.1 测试场景清单(8 个)

| 编号 | 场景 | 期望 |
|---|---|---|
| T1 | 创建 note → 输入 3 paragraph → 关闭重开 | 每 paragraph 有稳定 ULID;内容字面保留 |
| T2 | 已有 note 顶部插入 100 paragraph | 原段 attrs.id 字面不变;新段每个新 ULID |
| T3 | 在 paragraph 中间 Enter 拆分 | 上半保留原 id;下半新 ULID |
| T4 | Backspace 合并两 paragraph | 保留上方 id;下方 atom storage 已删 |
| T5 | Cmd+C 一 block + Cmd+V 三次 | 三副本各自新 ULID(原 block id 不变)|
| T6 | undo split | 拆出的下半 id 字面消失;上半恢复原内容 |
| T7 | 创建 callout + 内部 paragraph | callout atom + 内 paragraph atom(childOf 边)|
| T8 | thought 标注 → 编辑 note 上方 → thought 跳转 | 滚到原段(不漂移)|

### 8.2 实施

每个场景写 manual test step(沿决议 022 §6.2 测试报告模板),代码改动**已在前几个 Stage 完成**,本 Stage 仅 verify 不 commit。

verify 完毕产出 `block-atomization-test-report.md`(放 `docs/RefactorV2/notes/`)。

### 8.3 验收(EM7)

- ✅ 8 个场景全通过
- ✅ 测试报告字面记录每场景观察 + storage 状态(atom 数量 / 边数量)

---

## 9. Stage 8 — 性能压测

### 9.1 测试场景

| 场景 | 期望 |
|---|---|
| 1000-block note `getNote` cold(无 cache)| P95 < 200ms |
| 1000-block note `getNote` warm(cache hit)| P95 < 5ms |
| 1000-block note `updateNote`(single char edit) | P95 < 50ms |
| 1000-block note `updateNote`(整篇替换) | P95 < 1s |
| `listNotes`(100 notes)| 不退化(对齐 decision 016 3-query) |

### 9.2 实施

写 perf benchmark 脚本 `tests/perf/block-atomization.ts`(或 manual cli)。

跑 5 次取 P95。

如不达标:
- cold getNote 慢 → 考虑 listAtoms / listEdges 批量查询接口(留独立 sub-phase)
- updateNote 慢 → diff 算法优化(留独立 sub-phase)
- 不在本 sub-phase 范围深入优化

### 9.3 验收(EM8)

- ✅ 5 项指标全过(或字面登记不达标的项 + 留独立优化 sub-phase)

---

## 10. Stage 9 — 验收 + 文档反向更新

### 10.1 文档反向更新清单

| 文档 | 字面追加 / 修订 |
|---|---|
| [`atom/spec.md §2.5`](../data-model/atom/spec.md) | V2 当前实现对齐说明同步:block 拆 atom 已完成 |
| [`decision 012 §3.2`](../data-model/persistence/decisions/012-sub-phase-2-note-folder-migration.md) | 加历史注释:"路径 Y: pm atom = note" 已由 decision 026 升级 |
| [`decision 016 §1.3`](../data-model/persistence/decisions/016-sub-phase-3a-2.5-note-form-upgrade.md) | hasNoteView 边语义保留(挂 note 容器 atom) |
| [`decision 022 §3.2`](../data-model/persistence/decisions/022-sub-phase-022-ebook-thought-migration.md) | "decision 030+ 大架构升级" 引用注销,改指 decision 026 |
| [three-layer.md §2.4](../../00-architecture/three-layer.md) | 追加 "V2 通过 decision 025 / 026 完成 v1.3 工程妥协承接 + block 独立化实施" |
| [three-layer.md §6.4](../../00-architecture/three-layer.md) | 追加 "V2 落地选择 'block = atom' 同表模型" |
| [three-layer.md §8](../../00-architecture/three-layer.md) | 追加 2026-XX-XX block 独立化完成行 |
| `relations/spec.md §10` | 已 Stage 3 加 3 predicate |
| README.md(项目根)| Release Note 字面公告旧 URL 失效 |

### 10.2 memory 更新

新建 memory 文件 `project_block_atomization_done.md`(沿决议 021 / 022 完成模式)。

### 10.3 验收(EM9)

- ✅ 所有反向文档同步
- ✅ memory 更新
- ✅ 完成报告字面登记(包含每 Stage 验收记录)

---

## 11. 分支策略

按 [`feedback_branch_module_boundary`](../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_branch_module_boundary.md):

- **一个 feature 分支 `feature/L7-sub<N>-block-atomization`** 承载本 sub-phase 全部 9 个 Stage
- 中途多次 commit 但**不合 main**(沿决议 021 / 022 同模式)
- 全部 9 Stage 完成 + 验收报告通过 + 用户拍板 → 合 main
- 合 main commit message:`Merge sub-phase <N> — block atomization (Stage 1-9 全通过)`

---

## 12. 回滚预案

### 12.1 阶段内回滚

每个 Stage 内 commit 失败 → `git reset --hard HEAD~1`(本地操作)
typecheck 失败 → 修复或回退该 Stage

### 12.2 完整 sub-phase 回滚

如果 Stage 6 migration 后发现致命问题:
- migration 设计为 idempotent;schema version 仅在全部成功后 bump
- 失败的 migration 不 bump version,下次启动重试
- 备份数据 round-trip 测试在 migration 上线前必须通过

如果 sub-phase 整体决定撤回:
- `git revert <merge-commit>` 在 main 上反向(沿 V2 既有规范)
- 用户数据已 migration 的:**不可自动回滚**(本决议字面接受这个不变约束)— 因此 Stage 6 备份测试是硬门槛

---

## 13. 测试策略

### 13.1 现有测试模式

V2 当前测试覆盖:
- 主要靠 manual smoke test(沿 decision 011-024 模式)
- typecheck / lint 卡死 CI
- 没有强自动化测试(测试沿 V2 现状)

### 13.2 新增测试范围

| 测试类型 | 字面 |
|---|---|
| Round-trip 测试 | createNote → updateNote → getNote → 字面相等 |
| 性能基准测试 | Stage 8 |
| Migration 备份测试 | Stage 6 |
| Manual smoke test | Stage 7 8 场景 |

### 13.3 不在本 sub-phase 范围

- ❌ 完整 unit test 覆盖率(留独立 sub-phase)
- ❌ E2E 测试自动化
- ❌ 性能优化(若 Stage 8 不达标,字面留独立 sub-phase)

---

## 14. 完成判据

- ✅ Stage 1-9 全部 EM 通过
- ✅ 8 个测试场景通过
- ✅ 性能 5 项指标过(或字面登记不达标项)
- ✅ 文档反向更新完成
- ✅ memory 字面登记完成
- ✅ feature 分支合 main 完成
- ✅ Release Note 字面公告旧 URL 失效

---

## 15. Open Questions(实施前需用户拍板)

继承 [decision 026 §13](../data-model/persistence/decisions/026-block-atomization-sub-phase-design.md) 的 5 个 Open Question,本文档**不重述**。实施者读决议 026 §13 + 本文档 §15(本节为空,留扩展)。

---

## 16. 决策留痕

### 16.1 第一轮(实施计划初稿,2026-05-21)

| 决策 | 结论 | 日期 |
|---|---|---|
| 分 9 个 Stage 实施 | 采纳 | 2026-05-21 |
| 总估时 8.5 天(初稿) | **审计后修订为 8.5-12 天**(详 §1)| 2026-05-21 |
| 一个 feature 分支承载全部 Stage | 采纳(沿 [feedback_branch_module_boundary](../../../.claude/projects/-Users-wenwu-Documents-VPN-Server-KRIG-Note/memory/feedback_branch_module_boundary.md))| 2026-05-21 |
| 备份数据 round-trip 测试为 Stage 6 硬门槛 | 采纳 | 2026-05-21 |
| 性能优化留独立 sub-phase(若 Stage 8 不达标)| 采纳 | 2026-05-21 |
| 完整 unit test 覆盖率不在本 sub-phase 范围 | 采纳 | 2026-05-21 |

### 16.2 审计后修订(2026-05-21 同日)

| 决策 | 修订前 | 修订后 | 字面位置 |
|---|---|---|---|
| 总估时 | 8.5 天 | **8.5-12 天区间**(30-40% buffer)| §1 |
| Step 1.2 范围 | "24+ blocks 加 id" | **28 blocks 评估;按 decision 026 §3.1 拆分清单分别加/不加** | §2.3 Step 1.2 |
| Step 1.4 plugin | 仅 `addToHistory: false` | **追加 `setMeta('skipOnChange', true)` + Host onChange handler 过滤**(防御冷启动 race)| §2.3 Step 1.4 |
| Stage 2 拼装规则 | 仅"拓扑排序 + childOf 展开" | **追加跨层中间 wrapper 重建(decision 026 §6.1 规则)** | §3.1 / §3.3 Step 2.1 |
| Stage 4 EM4 描述 | "A 在 doc 下移 100 位" | **"A 的 PM pos 下移但 attrs.id 字面不变"** | §5.4 |
| Step 4.2 NoteLocator 数字 | 18 处 | **约 10 处(实施前复 grep 校准)** | §5.3 |

---

## 17. 后续工作

实施任务设计文档完成 + 用户拍板 → 启动 `feature/L7-sub<N>-block-atomization` 分支:
- 实施者(独立 session)读 decision 025 + decision 026 + 本文档全文
- 按 Stage 顺序执行
- 每 Stage 通过 EM 后 commit
- 全部完成停下报告

---

*Block Atomization Implementation Plan · v0.1 · 2026-05-21*
