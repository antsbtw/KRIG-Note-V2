# 阶段 5B 实施 Stage 7（重做版）：按 V2 数据模型规范字面收敛 — 任务 Prompt

> 这份 prompt 给独立子会话执行。
> 调用方（用户/总指挥）：把整份文档作为 user message 发给新对话。

---

## 你的身份

你是 KRIG-Note V2 的**实施工程师**。本次任务**重做** Stage 7 — 上一轮 subagent 的 Stage 7 已被 `git reset` 丢弃，因为它（连同 Stage 5/6 的部分思路）把 V1 遗留的 `AtomInput` 概念提升到 semantic 层冒充 SSOT，**反 V2 数据模型规范**（[`docs/RefactorV2/data-model/README.md`](../RefactorV2/data-model/README.md) §"当前 V2 状态" 字面登记 AtomInput 为"未对齐统一 Atom 定义"的 V1 遗留）。

本期按规范字面**删除 AtomInput 整个概念**，import 路径产**规范形态**（`Atom<'pm'>` + 临时引用边集）。

**Agent 类型**：`general-purpose`（**不是 Plan** — Plan 没有 Write/Edit 工具）。

## 上下文（必读，不要在产出里复述）

### 项目根 + 实施分支

- 仓库根：`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
- **实施分支**：`feature/import-refactor-stage-5B-7-redo`（**用户预先手动 checkout**，你跳过 `git checkout -b`）
- 第一步：`cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && pwd && git remote -v | head -1 && git branch --show-current` 三联守门（必须 V2.git + 7-redo 分支）

### 规范字面（必须遵守，不允许偏离）

[`docs/RefactorV2/data-model/`](../RefactorV2/data-model/) 是 V2 数据模型权威规范。本期实施必须字面对齐以下规范点：

| 规范字面 | 位置 | 本期含义 |
|---|---|---|
| `Atom<D> = { domain: D, payload: AtomPayloadOf<D> }` 是 atom 数据壳 | [`atom/spec.md`](../RefactorV2/data-model/atom/spec.md) §1 + `src/semantic/types/atom.ts` | import 路径输出 atom 集合**必须**字面是 `Atom<'pm'>` 形态，不允许新发明形态 |
| `AtomEntity<D> = Atom<D> + { id, createdAt, updatedAt, createdBy }` 是实体壳 | [`persistence/atom-entity.md`](../RefactorV2/data-model/persistence/atom-entity.md) §1 + `src/semantic/types/atom-entity.ts` | storage 层 putAtom 输出 AtomEntity（已实施） |
| **PE4: atom.id 由 storage 层生成，业务层不允许指定** | [`persistence/spec.md`](../RefactorV2/data-model/persistence/spec.md) §6 PE4 | import 路径**不预设** atom.id；用临时 tmpId 表达 atom 间关系，storage 写入时分配真 ULID |
| `Edge = { predicate, subject: AtomRef, object: EdgeEndpoint, attrs }` | [`relations/spec.md`](../RefactorV2/data-model/relations/spec.md) §2 + `src/semantic/types/edge.ts` | edge 数据壳 |
| `EdgeEntity = Edge + { id, createdAt, updatedAt }` | [`persistence/edge-entity.md`](../RefactorV2/data-model/persistence/edge-entity.md) §1 + `src/semantic/types/edge-entity.ts` | storage 层 putEdge 输出 EdgeEntity |
| edge predicate 三段式 `<source>:<vocabulary>:<edge-name>` | `relations/spec.md` §4.2 | 沿用现有 `user:krig:belongsToNote` / `childOf` / `nextSibling`（已 hardcode 在多处，本期不收敛 — 留独立 sub-phase） |
| L7 block atomization 5 项 STRUCTURAL 跳层规则 | [decision 026](../RefactorV2/data-model/persistence/decisions/026-block-atomization-sub-phase-design.md) §3.1.2 修订附记 + `@semantic/types/structural` 单点 export | import 路径**必须** import 此单点 export，**不允许重定义** |

### 用户拍板（11 条，subagent 严格按字面实施，不允许自由发挥）

#### 拍板 1：`AtomInput` 整个概念物理删除

- 当前 5 处定义/使用：
  - `src/capabilities/text-editing/types.ts:74` — `interface AtomInput`（删）
  - `src/capabilities/text-editing/converters/atoms-to-pm.ts:58` — `interface AtomInput`（改名）
  - `src/capabilities/canvas-text-node/atom-bridge.ts:25 / :54 / :92` — V1 NoteView 兼容用法（改名）
  - `src/views/note/markdown-import.ts:34 + :665-666 + :730-731` — view 临时桥（删，走新路径）
  - `src/views/note/extraction-import.ts:38 + :197` — view 临时桥（删，走新路径）
  - `src/capabilities/content-ingest/types.ts` jsdoc 提及（删 + 改产新形态）

#### 拍板 2：V1 NoteView 兼容形态改名 `V1NoteViewAtom`

`atoms-to-pm.ts:58` 的 `interface AtomInput` **改名为 `V1NoteViewAtom`**，加文档登记：

```ts
/**
 * V1 NoteView 持久化形态 — canvas-text-node 兼容专用,**不在 V2 规范范围**.
 *
 * 上下文(2026-05-29 5B Stage 7 重做):
 *  - V1 NoteView 持久化的 doc 字面是 Array<V1NoteViewAtom>(无 atom domain 概念,
 *    扁平 + parentId 链),canvas-text-node 仍要消费此形态.
 *  - 与 V2 规范定义的 Atom<D> + AtomEntity<D> 不一致(V1 没有 domain 分类).
 *  - 仅 atoms-to-pm.ts(canvas 反向 atom → PM 拼装)+ canvas-text-node/atom-bridge.ts
 *    使用,**禁止其它代码新引用**.
 *  - 未来 V1 数据迁移完成后字面物理删除.
 */
interface V1NoteViewAtom {
  // 字面同原 AtomInput 字段 (id?, type, content?, parentId?, from?, meta?)
}
```

`canvas-text-node/atom-bridge.ts` 内 `AtomInput` 字面改 `V1NoteViewAtom`（含 import + 使用处）。

#### 拍板 3：新规范化中间形态 `PmAtomDraft`

新建 `src/semantic/types/pm-atom-draft.ts`（**不是** `atom-input.ts`；本类型是 import-pipeline 专用，字面只表达"待 storage 分配 id 的 pm atom"，不与 AtomInput 概念混淆）：

```ts
/**
 * PmAtomDraft — import-pipeline 内 pm atom 草稿形态 (5B Stage 7 拍板)
 *
 * 规范依据 (docs/RefactorV2/data-model/persistence/spec.md §6 PE4):
 *   "atom.id 由 storage 层生成,业务层不允许指定"
 *
 * 因此 import 路径(markdownToAtoms / krigBatchToAtoms / 等)产出的 atom 集合
 * **不能预设 atom.id**.但 atom 间嵌套关系(childOf)必须在产出时表达 —
 * 走临时 string id (tmpId).storage 层 putAtom 分配真 ULID 后,
 * createNotesBatch 字面建 tmpId → realId 映射,**改写 parentTmpId 引用为 realId**
 * 后 putEdge 字面持久化 childOf 边.
 *
 * 设计理由:
 *  - payload 字段字面是 `Atom<'pm'>` (规范数据壳),不引入新形态
 *  - tmpId / parentTmpId 是 **draft 阶段专用** 字段,storage 写入后丢弃(不进 storage)
 *  - 与 dissectPmDoc 输出 (DissectResult) 是**两条平行路径**,不混塞:
 *    - dissect: PM editor 端 user-edit 后 → DissectResult (atom.id 已 inject 真 ULID)
 *    - markdownToAtoms / krigBatchToAtoms: 源 → PmAtomDraft[] (tmpId 待 storage 分配)
 *  - 边集表达:childOf 走 parentTmpId 字段隐式表达;
 *             belongsToNote 走 createNotesBatch 字面拼接 (item 内所有 atom → 容器 id);
 *             nextSibling 走 atoms 数组顺序 + parentTmpId 分组隐式表达
 *    (不在 PmAtomDraft 里显式持有边集 — 三类边均由 createNotesBatch 单点合成)
 */

import type { Atom } from './atom';

export interface AtomFrom {
  extractionType?: string;
  pdfPage?: number;
  extractedAt?: number;
}

export interface PmAtomDraft {
  /** 临时 id (string,如 'tmp-0' / 'tmp-1' / ...);本数组内唯一,storage 写入后丢弃 */
  tmpId: string;
  /** 嵌套父 atom 的 tmpId (顶层 atom 字面无此字段);
   *  字面表达 childOf 边,storage 层改写为 realId 后 putEdge */
  parentTmpId?: string;
  /** atom 数据载荷 — 规范字面要求 Atom<'pm'> 形态 (decision 010 + atom/spec.md §1) */
  payload: Atom<'pm'>;
  /** 来源元数据 (透传到 storage 实体壳的 attrs 或 from,未来 sub-phase 决定收敛位置) */
  from?: AtomFrom;
}
```

**`@semantic/types/index.ts` barrel 加 `export * from './pm-atom-draft'`。**

#### 拍板 4：content-ingest API 完全重写

##### 4a. `src/capabilities/content-ingest/types.ts` 完全重写

```ts
/**
 * content-ingest capability 对外类型契约 (5B Stage 7 重做 — 规范字面对齐)
 *
 * 输入: 各源原生格式 (markdown / KRIG_IMPORT JSON / 未来扩展)
 * 输出: PmAtomDraft[] 集合 + warnings
 *
 * **禁止**: 不导出 PM doc / PMNode[] / DriverSerialized / AtomInput 形态.
 *           不调用 noteCap / createNote (capability 边界纪律).
 */

import type { PmAtomDraft, AtomFrom } from '@semantic/types';

export type { PmAtomDraft, AtomFrom } from '@semantic/types';

export interface MarkdownToAtomsOptions {
  /** 强制首块 paragraph 加 attrs.isTitle = true 字面承载 title */
  titleHint?: string;
  from?: Partial<AtomFrom>;
}

export interface MarkdownToAtomsResult {
  atoms: PmAtomDraft[];
  warnings: string[];
}

export interface KrigImportChapter {
  fileName?: string;
  bookName?: string;
  title?: string;
  pageStart?: number;
  pageEnd?: number;
  pages?: Array<{ pageNumber: number; atoms: unknown[] }>;
}

export interface KrigImportBatch {
  type?: string;
  chapters?: KrigImportChapter[];
  bookName?: string;
}

export interface KrigChapterResult {
  title: string;
  bookName: string;
  atoms: PmAtomDraft[];
  warnings: string[];
}

export interface KrigBatchToAtomsResult {
  chapters: KrigChapterResult[];
}

export interface ContentIngestApi {
  markdownToAtoms(md: string, options?: MarkdownToAtomsOptions): Promise<MarkdownToAtomsResult>;
  krigBatchToAtoms(batch: KrigImportBatch): Promise<KrigBatchToAtomsResult>;
}
```

##### 4b. `src/capabilities/content-ingest/index.ts` 同步更新 re-export

##### 4c. `internal/markdown-to-atoms.ts` 重写

字面算法：
1. `markdown` → `markdownToProseMirror(md)`（深路径 import，已在）→ `PMNode[]`（renderer 端已处理 media:// 等）
2. **遍历 PMNode[] 顶层**，每个 node 走 `pmNodeToDraft(node, parentTmpId?, atomCounter)`：
   - 字面跳过 STRUCTURAL_CONTAINER_TYPES（5 项，import from `@semantic/types/structural`）— 其 children 用本 parentTmpId 继续递归
   - 非 STRUCTURAL：分配新 tmpId（`tmp-${counter++}`），produce PmAtomDraft，其 children 递归 with parentTmpId = this draft's tmpId
   - 叶子（content 全 inline）：payload.content 字面原样保留 inline 数组
   - 容器（含 STRUCTURAL + 非 STRUCTURAL 子）：payload.content = `[]`（决议 026 §3.4 字面 — 容器型 atom payload.content 空，关系走 childOf 边）
3. 处理 titleHint：若 atoms[0].payload.type === 'paragraph' 字面在其 attrs 上设 isTitle = true；否则前置一个 paragraph atom（type='paragraph', attrs.isTitle=true, content=[{type:'text', text: titleHint}]）
4. **table 节点字面**：调 `tableAdapter(tablePmNode, tableTmpId)` 拿 cell drafts + parentTmpId 链；tableAdapter 见 4d
5. **每个 draft 字面携 from**：`{ extractionType: 'markdown', extractedAt: Date.now() }`（除非调用方 options.from 覆盖）

**禁止**：本算法**不**复用 `dissectPmDoc`（dissect 是 PM editor 端 user-edit 后专用，与 import 路径平行不混塞）；但**必须**字面 import `STRUCTURAL_CONTAINER_TYPES` from `@semantic/types/structural`（规则 SSOT）。

##### 4d. `internal/table-adapter.ts` 重写

签名：

```ts
import type { PmAtomDraft } from '@semantic/types';

interface TableAdapterInput {
  /** table PM node (含 attrs + content) */
  tablePmNode: PmPayload;
  /** table 自身的 tmpId (由 caller markdown-to-atoms 分配) */
  tableTmpId: string;
  /** 新 tmpId 分配器 (caller 传递的递增 counter 引用,字面避免 tmpId 碰撞) */
  allocTmpId: () => string;
  from?: AtomFrom;
}

interface TableAdapterOutput {
  /** table atom draft (payload.type='table', payload.content=[]); */
  tableDraft: PmAtomDraft;
  /** cell drafts (tableCell + tableHeader); parentTmpId 字面指向 tableTmpId */
  cellDrafts: PmAtomDraft[];
}

function tableAdapter(input: TableAdapterInput): TableAdapterOutput;
```

算法：
1. 字面生成 `tableDraft = { tmpId: tableTmpId, payload: { domain:'pm', payload: { type:'table', attrs: tablePmNode.attrs ?? {}, content: [] } }, from }`
2. 字面遍历 `tablePmNode.content`（顶层 tableRow），rowIdx 从 0 起
3. 字面遍历 `tableRow.content`（cells），colIdx 从 0 起
4. 每 cell：`cellDraft = { tmpId: allocTmpId(), parentTmpId: tableTmpId, payload: { domain:'pm', payload: { type: cell.type, attrs: { ...cell.attrs, rowIndex: rowIdx, colIndex: colIdx }, content: cell.content ?? [] } }, from }`
5. **不生成 tableRow draft**（5A 拍板字面 tableRow 不是 atom）
6. 输出 `{ tableDraft, cellDrafts }`

##### 4e. `internal/krig-batch-to-atoms.ts` 重写

字面算法：
1. 遍历 `batch.chapters`
2. 每章字面：
   - 走 sanitize（`@capabilities/content-ingest/internal/sanitize-atoms`，已存在 — 但其 `AtomLike` 类型需要相应更新，见下）
   - 遍历 sanitized atoms，为每个分配 tmpId + 转 PmAtomDraft（payload 字面 `{ domain:'pm', payload: 原 atom (剥 id/parentId 字段) }`）
   - 老 atom.parentId 字面映射到 parentTmpId（建 oldParentId → tmpId 映射）
   - table 字面调 tableAdapter 展开（同 4d）
3. 每 chapter 产 `{ title, bookName, atoms, warnings }`

##### 4f. `internal/sanitize-atoms.ts` 调整

文件保留位置不动，但 `AtomLike` interface 字面**改名为 `LegacyExtractionAtom`** + 加 jsdoc 登记"V1 PDF 提取契约形态，仅 krig-batch-to-atoms 内部使用，规范外"。其它 import 改 import 名。

#### 拍板 5：noteCap API 新增 `createNotesBatch`

##### 5a. `src/capabilities/note/types.ts` 加类型

```ts
import type { PmAtomDraft } from '@semantic/types';

export interface CreateNoteBatchItem {
  atoms: PmAtomDraft[];
  folderId: string | null;
  /** 标题提示;若 atoms[0].payload.payload.attrs.isTitle === true 则字面忽略本字段 */
  titleHint?: string;
  /** 字面 reserved,本期不实施去重 */
  importToken?: string;
}

export interface CreateNoteBatchInput {
  items: CreateNoteBatchItem[];
  broadcastMode?: 'final' | 'progressive-throttle';
  throttleMs?: number;
}

export interface CreateNoteBatchFailure {
  index: number;
  error: string;
  rolledBack: boolean;
}

export interface CreateNoteBatchResult {
  notes: NoteInfo[];
  failures: CreateNoteBatchFailure[];
}
```

加入 `NoteApi`:
```ts
createNotesBatch(input: CreateNoteBatchInput): Promise<CreateNoteBatchResult>;
```

##### 5b. `src/platform/main/note/capability-impl.ts` 新增 `createNotesBatch`

**关键算法字面**：

```ts
export async function createNotesBatch(
  input: CreateNoteBatchInput,
): Promise<CreateNoteBatchResult> {
  const { items, broadcastMode = 'final' } = input;
  const notes: NoteInfo[] = [];
  const failures: CreateNoteBatchFailure[] = [];

  if (items.length > 500) {
    console.warn(
      `[note-capability/createNotesBatch] batch size ${items.length} > 500;` +
        `single-tx may hit SurrealDB timeout (Stage 7 字面未实施 chunk)`,
    );
  }

  try {
    await storage.transaction(async (tx) => {
      for (let i = 0; i < items.length; i++) {
        try {
          const note = await createSingleNoteFromDrafts(tx, items[i]);
          notes.push(note);
        } catch (err) {
          failures.push({ index: i, error: String(err), rolledBack: true });
          throw err;
        }
      }
    });
  } catch (err) {
    if (failures.length === 0) {
      failures.push({ index: -1, error: String(err), rolledBack: true });
    }
    return { notes: [], failures };
  }

  if (broadcastMode === 'final' && notes.length > 0) {
    broadcastNoteListChanged();
  }
  return { notes, failures };
}

/**
 * 单 note 从 PmAtomDraft[] 字面写入 storage.
 *
 * 字面算法 (规范字面对齐 docs/RefactorV2/data-model/persistence/spec.md §6 PE4):
 *  1. createContainer: tx.putAtom 字面创建 container atom (domain='pm', payload empty doc + title)
 *  2. 字面拼 hasNoteView + inFolder 边 (沿 createNote 单条 API 同款)
 *  3. tmpId → realId 字面映射: 遍历 drafts, 每 draft 字面 tx.putAtom (storage 层分配 ULID),
 *     字面记录 tmpId → realId
 *  4. 字面 putEdge 拼 3 类边:
 *     - belongsToNote: 每 draft 的 realId → container.id
 *     - childOf: draft.parentTmpId 字面解析为 realParentId → 字面 putEdge
 *     - nextSibling: 按 atoms 数组顺序 + parentTmpId 分组字面链 (顶层 = parentTmpId undefined,
 *       同 parent 字面是兄弟); 顺序按 drafts 数组原顺序
 *  5. buildNoteInfo 返回 NoteInfo
 *
 * **字面验证**: 算法跑完字面遍历所有 drafts 字面 assert(realIdMap.has(draft.tmpId));
 *   若 parentTmpId 字面无映射 throw (悬空引用,数据坏);
 */
async function createSingleNoteFromDrafts(
  tx: StorageTransaction,
  item: CreateNoteBatchItem,
): Promise<NoteInfo> {
  // 1. container
  const title = deriveTitleFromDrafts(item.atoms, item.titleHint);
  const containerAtom = await tx.putAtom<'pm'>({
    payload: { domain: NOTE_DOMAIN, payload: containerPayloadWithTitle(title) },
  });

  const now = Date.now();

  // 2. hasNoteView + inFolder
  await tx.putEdge({
    predicate: HAS_NOTE_VIEW_PREDICATE,
    subject: { kind: 'atom', atomId: containerAtom.id },
    object: { kind: 'literal', type: 'boolean', value: true },
    attrs: { createdBy: 'user-default', createdAt: now },
  });
  if (item.folderId) {
    await tx.putEdge({
      predicate: IN_FOLDER_PREDICATE,
      subject: { kind: 'atom', atomId: containerAtom.id },
      object: { kind: 'atom', atomId: item.folderId },
      attrs: { createdBy: 'user-default', createdAt: now },
    });
  }

  // 3. atoms 字面写入 + 建 tmpId → realId 映射
  const tmpToReal = new Map<string, string>();
  for (const draft of item.atoms) {
    const entity = await tx.putAtom<'pm'>({
      payload: draft.payload, // 字面 PE4: 不传 id, storage 分配
    });
    tmpToReal.set(draft.tmpId, entity.id);
  }

  // 4. 边集字面合成
  // 4a. belongsToNote: 每 draft → container
  for (const draft of item.atoms) {
    const realId = tmpToReal.get(draft.tmpId)!;
    await tx.putEdge({
      predicate: BELONGS_TO_NOTE_PREDICATE,
      subject: { kind: 'atom', atomId: realId },
      object: { kind: 'atom', atomId: containerAtom.id },
      attrs: { createdBy: 'user-default', createdAt: now },
    });
  }
  // 4b. childOf: draft.parentTmpId 字面解析
  for (const draft of item.atoms) {
    if (!draft.parentTmpId) continue;
    const childRealId = tmpToReal.get(draft.tmpId)!;
    const parentRealId = tmpToReal.get(draft.parentTmpId);
    if (!parentRealId) {
      throw new Error(
        `[createSingleNoteFromDrafts] dangling parentTmpId=${draft.parentTmpId} ` +
          `on draft.tmpId=${draft.tmpId}`,
      );
    }
    await tx.putEdge({
      predicate: CHILD_OF_PREDICATE,
      subject: { kind: 'atom', atomId: childRealId },
      object: { kind: 'atom', atomId: parentRealId },
      attrs: { createdBy: 'user-default', createdAt: now },
    });
  }
  // 4c. nextSibling: 按 atoms 数组顺序 + parentTmpId 分组
  //    顶层 = parentTmpId undefined; 嵌套 = 同 parentTmpId 字面是兄弟.
  //    分组保持原 drafts 数组顺序 (markdownToAtoms 字面深度遍历产出, parent 先于 child).
  const siblingGroups = new Map<string | '__root__', string[]>();
  for (const draft of item.atoms) {
    const key = draft.parentTmpId ?? '__root__';
    if (!siblingGroups.has(key)) siblingGroups.set(key, []);
    siblingGroups.get(key)!.push(tmpToReal.get(draft.tmpId)!);
  }
  for (const realIds of siblingGroups.values()) {
    for (let i = 0; i < realIds.length - 1; i++) {
      await tx.putEdge({
        predicate: NEXT_SIBLING_PREDICATE,
        subject: { kind: 'atom', atomId: realIds[i] },
        object: { kind: 'atom', atomId: realIds[i + 1] },
        attrs: { createdBy: 'user-default', createdAt: now },
      });
    }
  }

  // 5. NoteInfo
  return buildNoteInfo(containerAtom.id, title);
}

function deriveTitleFromDrafts(drafts: PmAtomDraft[], hint?: string): string {
  // 字面: 找 drafts[0] 若是 paragraph + attrs.isTitle = true, 取其 text;
  //       否则用 hint; 否则空串.
  const first = drafts[0];
  if (
    first &&
    first.payload.payload.type === 'paragraph' &&
    (first.payload.payload.attrs as Record<string, unknown>)?.isTitle === true
  ) {
    const content = first.payload.payload.content;
    if (Array.isArray(content) && content[0]?.type === 'text') {
      return String(content[0].text ?? '').trim() || (hint ?? '');
    }
  }
  return hint ?? '';
}
```

**辅助函数**：`broadcastNoteListChanged`（grep 现有 createNote 怎么用，沿同款）/ `buildNoteInfo`（同上）/ predicate 常量（沿 createNote 已 import 的）。

##### 5c. IPC + preload bridge

字面同 5B 设计 §7.5.2 + Stage 5 prompt §S5.5：
- `src/shared/ipc/channel-names.ts` 加 `NOTE_CREATE_BATCH = 'note:create-batch'`
- `src/platform/main/note/handlers.ts` 加 `ipcMain.handle(NOTE_CREATE_BATCH, ...)`
- `src/platform/main/preload/main-window-preload.ts` 加 `noteCreateBatch` bridge
- `src/shared/ipc/electron-api.d.ts` 加字段

#### 拍板 6：view 端切换

##### 6a. `src/views/note/markdown-import.ts`

- 删除 `AtomInput` import + 所有 `atomsToProseMirror` import + 调用
- 删除 line 658 / line 723 "5B Stage 6 临时桥" 注释段 + 周边逻辑
- 删除 line 38 段临时桥注释
- 新逻辑：循环每文件 → `markdownToAtoms({ titleHint: file.name })` 拿 PmAtomDraft[] → 收集 batch items → 末尾 1 次 `createNotesBatch({ items, broadcastMode: 'final' })`
- 失败处理：`result.failures[]` 字面遍历 console.warn + 沿现有 UI 失败提示

##### 6b. `src/views/note/extraction-import.ts`

- 删除 `AtomInput` import + `sanitizeAtoms` / `atomsToProseMirror` 深路径 import + 调用
- 删除 line 41 临时桥注释段
- 删除 `buildAtoms` 函数（原 line 197 起，已被 krigBatchToAtoms 取代）
- 新逻辑：调 `krigBatchToAtoms(batch)` 拿 chapters → 拼 batch items → `createNotesBatch`

#### 拍板 7：dissect-pm-doc.ts 完全不改

dissect 是 PM editor 端 user-edit 后专用算法，与 import 路径**完全平行**。本期**不动**，不抽象、不重构、不复用到 import 路径。共享的只是 `STRUCTURAL_CONTAINER_TYPES` 集合（已在 Stage 1-2 收敛）。

#### 拍板 8：atoms-to-pm.ts 保留 + 改 V1NoteViewAtom

`atoms-to-pm.ts` 是 canvas-text-node V1 反向兼容专用（已 Stage 6 移出 TextEditingApi），文件保留 capability-internal 工具角色。字面改：
- line 58 `interface AtomInput` → `interface V1NoteViewAtom` + jsdoc 登记
- 函数签名 `atomsToProseMirror(input: { atoms: AtomInput[] })` → `{ atoms: V1NoteViewAtom[] }`（调用方 canvas-text-node 已改）

#### 拍板 9：sanitize-atoms.ts 改名内部 type

`content-ingest/internal/sanitize-atoms.ts:AtomLike` → `LegacyExtractionAtom` + jsdoc。

#### 拍板 10：predicate 常量不收敛

`HAS_NOTE_VIEW_PREDICATE / IN_FOLDER_PREDICATE / BELONGS_TO_NOTE_PREDICATE / CHILD_OF_PREDICATE / NEXT_SIBLING_PREDICATE` 等仍按现有 hardcode 散落处用（多处 `'user:krig:xxx'` 字符串）。**本期不抽 SSOT**，留独立 sub-phase。

#### 拍板 11：不实施 `verifyNotePersisted`

5B §7.5.2 字面提的 verify 在 storage transaction 内**不可行**（`StorageTransaction` 字面无 `listAtoms` API），本期跳过。tx 内 `tmpToReal` 字面 assertion + `parentTmpId` 悬空检查 字面提供数据完整性兜底。

## 任务执行顺序（subagent 严格按顺序）

按 11 拍板 + view 切换 实施：

### Step 1：基础设施（拍板 3 + 2 + 8）
- 新建 `src/semantic/types/pm-atom-draft.ts`
- 更新 `src/semantic/types/index.ts` barrel
- 改 `atoms-to-pm.ts` interface 改名 + jsdoc
- 改 `canvas-text-node/atom-bridge.ts` 跟进改名

跑 tsc 自检（如 sandbox 拦截，stop 报告）。

### Step 2：content-ingest 重写（拍板 4）
- `content-ingest/types.ts` 完全重写
- `content-ingest/index.ts` re-export 同步
- `internal/table-adapter.ts` 重写
- `internal/markdown-to-atoms.ts` 重写
- `internal/krig-batch-to-atoms.ts` 重写
- `internal/sanitize-atoms.ts` AtomLike 改名

跑 tsc 自检。

### Step 3：noteCap createNotesBatch（拍板 5）
- `capabilities/note/types.ts` 加类型
- `capabilities/note/index.ts` 加 api 字段
- `platform/main/note/capability-impl.ts` 加 createNotesBatch + createSingleNoteFromDrafts
- `platform/main/note/handlers.ts` 加 IPC handler
- `shared/ipc/channel-names.ts` 加常量
- `platform/main/preload/main-window-preload.ts` 加 bridge
- `shared/ipc/electron-api.d.ts` 加字段

跑 tsc 自检。

### Step 4：view 端切换（拍板 6）
- `views/note/markdown-import.ts` 切换
- `views/note/extraction-import.ts` 切换

跑 tsc 自检。

### Step 5：删除 AtomInput 物理痕迹（拍板 1）
- `text-editing/types.ts:74` 物理删 `interface AtomInput`（确认无任何代码引用）
- 全仓 grep 验证 `AtomInput` 0 命中（除 `PutAtomInput` — 这是 storage 层规范允许的，与本期删除目标不同）

跑 tsc 自检。

## 验收 V1-V8

V1-V8 字面同上一版 prompt，加 V9：

#### V1：typecheck

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "src/main/ipc/handlers.ts\|src/renderer/shell/WorkspaceBar.tsx"
```

期望 0 行。

#### V2：PmAtomDraft SSOT 单点

```bash
grep -rn "^export interface PmAtomDraft\|^interface PmAtomDraft" src --include='*.ts'
```

期望仅 `src/semantic/types/pm-atom-draft.ts` 1 行。

#### V3：AtomInput 全仓清零（除 PutAtomInput）

```bash
grep -rn "\bAtomInput\b" src --include='*.ts' --include='*.tsx' | grep -v "PutAtomInput"
```

期望 0 命中。

#### V4：V1NoteViewAtom 替换就位

```bash
grep -rn "V1NoteViewAtom" src --include='*.ts'
```

期望 ≥3 命中（atoms-to-pm.ts 定义 + 1-2 处 canvas-text-node 使用）。

#### V5：content-ingest 产 PmAtomDraft

```bash
grep -n "PmAtomDraft" src/capabilities/content-ingest --include='*.ts' -r
```

期望 ≥5 命中（types.ts + 4 个 internal 文件）。

#### V6：createNotesBatch API 三文件接线

```bash
grep -n "createNotesBatch" src/capabilities/note/types.ts src/platform/main/note/capability-impl.ts src/platform/main/note/handlers.ts
```

期望三文件均命中。

#### V7：IPC + preload + d.ts

```bash
grep -n "NOTE_CREATE_BATCH\|noteCreateBatch" src/shared/ipc/channel-names.ts src/platform/main/preload/main-window-preload.ts src/shared/ipc/electron-api.d.ts
```

期望均命中。

#### V8：view 端无 atomsToProseMirror / AtomInput / 临时桥

```bash
grep -n "atomsToProseMirror\|AtomInput\|5B Stage 6 临时桥" src/views/note/markdown-import.ts src/views/note/extraction-import.ts
```

期望 0 命中。

#### V9：view 端走 createNotesBatch

```bash
grep -n "createNotesBatch" src/views/note/markdown-import.ts src/views/note/extraction-import.ts
```

期望两文件各 ≥1 命中。

## Commit 纪律

按 5 step 拆 5 commit:
- `5B Stage 7 redo a — PmAtomDraft SSOT + V1NoteViewAtom rename (规范字面对齐)`
- `5B Stage 7 redo b — content-ingest rewritten to PmAtomDraft output`
- `5B Stage 7 redo c — noteCap.createNotesBatch + IPC handler`
- `5B Stage 7 redo d — view migration markdown-import + extraction-import`
- `5B Stage 7 redo e — physical deletion of AtomInput interface`

每段 commit 前 tsc 必须 0 错。如 sandbox 拦截 tsc 或 commit，stop 报告让总指挥介入。

- **不 push**
- **不 merge**
- **不改 docs/**（除本 prompt 文档可保留 untracked）
- **不改 Stage 7 范围外**（dissect-pm-doc / assemble-pm-doc / Stage 1-4 schema 全不动）
- **不操作数据库 / migration**

## 操作纪律

- cwd 漂移防御：每 Bash `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`；Read/Edit/Write 一律绝对路径
- 三联守门首条：`cd /V2 && pwd && git remote -v | head -1 && git branch --show-current`
- sandbox 限制：tsc / git add / git commit 可能被拦；**不走 `--dangerouslyDisableSandbox`**；stop 报告
- 不切其它分支、不 merge / rebase / push

## 完成标准

- 9 个 V1-V9 验收全部 PASS
- 5 个 commit 在 `feature/import-refactor-stage-5B-7-redo` 分支
- V2 数据模型规范字面对齐（atom/spec.md / persistence/spec.md / decision 026）

完成后向调用方汇报：
- 5 个 commit hash + 改动文件清单
- V1-V9 各项验收结果
- 实施过程中发现的新问题（含任何"规范字面对齐"实施时新发现的耦合点）
- 任何 5B 设计文档或本 prompt 与现实情况不一致的发现

---

## Agent 配置建议（给调用方）

- **agent 类型**：`general-purpose`
- **是否后台运行**：可后台。完成时通知
- **预期工作时间**：4-6 小时（11 拍板字面落地 + 5 commit 链 + 验收）
