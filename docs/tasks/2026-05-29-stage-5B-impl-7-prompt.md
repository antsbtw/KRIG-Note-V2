# 阶段 5B 实施 Stage 7：createNotesBatch API + AtomInput SSOT 收敛 + view 端临时桥永久删除 — 任务 Prompt

> 这份 prompt 给独立子会话执行。
> 调用方（用户/总指挥）：把整份文档作为 user message 发给新对话。

---

## 你的身份

你是 KRIG-Note V2 的**实施工程师**。本次任务是把 5B 设计 §节 4 Stage 7 字面落地为 TypeScript 代码 — 但因为 5B 设计文档内部 §7.1.2 与 §7.5.2 互相矛盾（见下面"用户拍板"），用户已经在本 prompt 里拍了实质性 architectural 决策，你**严格按用户拍板**执行，不要回 §7.5.2 字面方案。

**Agent 类型**：`general-purpose`（**不是 Plan** — Plan 没有 Write/Edit 工具）。

## 上下文（必读，不要在产出里复述）

### 项目根 + 实施分支

- 仓库根：`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
- **实施分支**：`feature/import-refactor-stage-5B-7`（基于 main HEAD，含 Stage 1-6 合入；用户已在主对话手动 checkout 完毕，你跳过 `git checkout -b`）
- 第一步：`cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && pwd && git remote -v | head -1 && git branch --show-current` 三联守门

### 用户在主对话拍板的关键 architectural 决策（必读，覆盖 5B §7.5.2 字面）

**矛盾发现**：5B 设计文档自身 §7.1.2 与 §7.5.2 互相不一致：
- §7.1.2 拍板"atom 与 PM doc 脱钩，import 路径只产 Atom 不产 PM doc"
- §7.5.2 字面写 `createNotesBatch(items: { doc: NoteDocEnvelope, folderId }[])` — batch 接 doc

**用户拍板（选项 B，本 prompt 实施依据）**：

> **batch 接 `Atom[][]`，守 §7.1.2 脱钩原则；noteCap 内部新写 atoms → storage 路径（不走 PM doc → dissect）。**

后果：
1. createNotesBatch 签名改为 items 元素带 `atoms: Atom[]` 而**不是** `doc: NoteDocEnvelope`
2. noteCap 内部新增"atoms → storage"路径（与现有 createNote 的 doc → dissect → storage 平行；createNote 单条 API 仍保留不动）
3. view 端 markdown-import.ts / extraction-import.ts 临时桥（5B Stage 6 加的 `atomsToProseMirror` 回拼）**永久删除** — view 拿 Atom[] 直走 createNotesBatch
4. AtomInput SSOT 必须在本期拍板（noteCap.createNotesBatch 接的 Atom 类型与 content-ingest 产的 Atom 必须**精确同型**）

### AtomInput SSOT 收敛拍板（用户决策，本 prompt 字面规定）

**当前 drift（Stage 5/6 累积）**：
- `src/capabilities/content-ingest/types.ts:44` `interface Atom { id?: string | null; ... }`
- `src/capabilities/text-editing/types.ts:74` `interface AtomInput { id?: string; type; content?; parentId?; from?; meta? }`（无 attrs，无 null id）
- 还有 `views/note/extraction-import.ts` 内 inline shape

**SSOT 拍板**：

| 决定 | 字面 |
|---|---|
| **唯一定义点** | `src/semantic/types/atom-input.ts`（新建文件，与 Stage 1-2 的 `structural.ts` 同款单点 export 模式） |
| **类型名** | `AtomInput`（沿用现有名，便于增量收敛；现有 5 处 inline / `Atom` 全改 import） |
| **形态** | `{ id?: string \| null; type: string; content?: Record<string, unknown>; parentId?: string; from?: AtomFrom; meta?: Record<string, unknown>; attrs?: Record<string, unknown> }` — id 允许 null（inject 占位），加 attrs 字段（content-ingest table-adapter 写入需要） |
| **同 file** | `AtomFrom` 也搬到本文件（content-ingest/types.ts 当前的 `AtomFrom` 字面迁移到 `@semantic/types/atom-input`） |

迁移路径（本期 Stage 7 字面 5 处全收敛）：
1. `src/capabilities/text-editing/types.ts:74` `interface AtomInput` → 改 re-export from `@semantic/types`（沿用 Stage 2 `assemble-pm-doc.ts` 的 re-export 桥模式）
2. `src/capabilities/content-ingest/types.ts:31 + 44` `AtomFrom` / `Atom` → 删除本地定义，改 `export { AtomInput, AtomFrom } from '@semantic/types'`（并把内部所有 `Atom` 改名 `AtomInput`，含 markdown-to-atoms / krig-batch-to-atoms / table-adapter / index.ts）
3. `src/capabilities/text-editing/converters/sanitize-atoms.ts` 已删除（Stage 6），其副本 `src/capabilities/content-ingest/internal/sanitize-atoms.ts` 内 `AtomLike` 同步改为 `AtomInput`（兼容性测试：sanitize 只读 type/parentId/content/from/meta，加 attrs/null id 字段不破坏现有逻辑）
4. `src/capabilities/text-editing/converters/atoms-to-pm.ts` 内的 `AtomInput` 私有类型 → 改 import from `@semantic/types`（这是 canvas-text-node 深路径 import 的目标，确保 cast 不再需要）
5. `src/views/note/extraction-import.ts` 内 `BatchInput` inline `atoms: unknown[]` → 改用 `AtomInput[]`

### 必读输入文档（必读顺序）

1. **5B 设计 §节 4 Stage 7 + §7.5.2**：[`docs/tasks/2026-05-28-stage-5B-import-converter-design.md`](2026-05-28-stage-5B-import-converter-design.md) — 了解 batch API 原意；本期实施不按 §7.5.2 字面，按本 prompt §"用户拍板"
2. **createNote 现有实施**：[`src/platform/main/note/capability-impl.ts:163-278`](../../src/platform/main/note/capability-impl.ts) — 单条 createNote + injectIdsForCreate 算法（**保留不动**）
3. **NOTE_CREATE IPC handler 现状**：[`src/platform/main/note/handlers.ts:43`](../../src/platform/main/note/handlers.ts) — 现有单条 IPC 接线点
4. **note capability API 类型**：[`src/capabilities/note/types.ts`](../../src/capabilities/note/types.ts) — TextEditingApi 同款套路
5. **preload bridge**：[`src/platform/main/preload/main-window-preload.ts:430`](../../src/platform/main/preload/main-window-preload.ts) — IPC_CHANNELS.NOTE_CREATE bridge
6. **storage transaction 接口**：先 grep `storage.transaction(` 看签名
7. **Stage 5/6 临时桥位置**：
   - `src/views/note/markdown-import.ts:38 / :658 / :723`（3 处 Stage 6 临时桥注释）
   - `src/views/note/extraction-import.ts:41`（1 处临时桥注释 + 当前 sanitize/atomsToProseMirror 调用）

## 任务

### S7.1 新建 `src/semantic/types/atom-input.ts`（AtomInput SSOT）

文件内容：

```ts
/**
 * AtomInput — import-pipeline 中间形态 atom (5B Stage 7 SSOT 单点拍板)
 *
 * 拍板背景:
 *  - 5B Stage 5 content-ingest 落地时发现 @semantic/types 的 Atom<D> 是 storage 壳
 *    {domain, payload}, 不是 PM-JSON 形态;Stage 5 临时在 content-ingest/types.ts 本地
 *    定义 Atom + AtomFrom + KrigImportBatch 解决,留 SSOT drift.
 *  - 5B Stage 6 view 临时桥 markdownToAtoms -> atomsToProseMirror 需 `as unknown as AtomInput[]`
 *    双 cast,因 content-ingest.Atom.id (string | null) vs text-editing.AtomInput.id (string)
 *    不兼容.
 *  - 5B Stage 7 字面收敛: 唯一定义点放 @semantic/types/atom-input.ts (与 structural.ts 同款
 *    单点 export 模式);所有消费方 import 此类型.
 *
 * 五处消费方 (2026-05-29 Stage 7 收敛后):
 *  1. src/capabilities/content-ingest/types.ts (改 re-export)
 *  2. src/capabilities/content-ingest/internal/sanitize-atoms.ts (AtomLike -> AtomInput)
 *  3. src/capabilities/text-editing/types.ts (改 re-export)
 *  4. src/capabilities/text-editing/converters/atoms-to-pm.ts (改 import)
 *  5. src/views/note/extraction-import.ts (改 import)
 *
 * 字面规则:
 *  - id 允许 null (inject 占位; capability 层 createNotesBatch 入口字面注入 ULID)
 *  - attrs 字段必须 (content-ingest table-adapter 字面写入 rowIndex/colIndex)
 *  - content 是 PM-JSON 子结构包装 (tiptapContent / 等 — 契约 v2.0 字面;Stage 8 rename pmContent)
 */

export interface AtomFrom {
  extractionType?: string;
  pdfPage?: number;
  extractedAt?: number;
}

export interface AtomInput {
  id?: string | null;
  type: string;
  content?: Record<string, unknown>;
  parentId?: string;
  from?: AtomFrom;
  meta?: Record<string, unknown>;
  attrs?: Record<string, unknown>;
}
```

### S7.2 更新 `src/semantic/types/index.ts` barrel

加一行（沿 structural.ts 模式）：

```ts
export * from './atom-input';
```

### S7.3 五处消费方迁移到 SSOT

#### S7.3.1 `src/capabilities/content-ingest/types.ts`

字面删除本地的 `interface AtomFrom` + `interface Atom`，改 re-export：

```ts
export type { AtomInput, AtomFrom } from '@semantic/types';
```

文件内所有 `Atom` 出现处改为 `AtomInput`（types.ts 内部 + 其它 internal/*.ts 文件 import 此 types 的位置都同步改）。

#### S7.3.2 `src/capabilities/content-ingest/internal/*.ts` 同步改

- `markdown-to-atoms.ts`：`Atom` → `AtomInput`（type alias + 用法）
- `krig-batch-to-atoms.ts`：同上
- `table-adapter.ts`：同上
- `sanitize-atoms.ts`：本地的 `AtomLike` → `AtomInput`（import from `@semantic/types`），删本地 interface 定义

#### S7.3.3 `src/capabilities/content-ingest/index.ts`

re-export 字面：

```ts
export type { AtomInput, AtomFrom, /* 其余 */ } from './types';
```

#### S7.3.4 `src/capabilities/text-editing/types.ts:74`

字面删除本地 `interface AtomInput`，改 re-export：

```ts
export type { AtomInput } from '@semantic/types';
```

#### S7.3.5 `src/capabilities/text-editing/converters/atoms-to-pm.ts`

文件顶部 import 区找到 `AtomInput` 私有类型定义并删除，改 `import type { AtomInput } from '@semantic/types'`。

**关键验证**：canvas-text-node/atom-bridge.ts 调 `atomsToProseMirror({ atoms: AtomInput[] })` 不再需要 `as unknown as` cast — 类型直接对齐。

#### S7.3.6 `src/views/note/extraction-import.ts`

`BatchInput.atoms` 字段 `unknown[]` → `AtomInput[]`（带 import）；其它 inline 类型暂不动。

### S7.4 noteCap 新增 createNotesBatch API（核心算法）

#### S7.4.1 在 `src/capabilities/note/types.ts` 加 batch API 类型

```ts
import type { AtomInput } from '@semantic/types';

export interface CreateNoteBatchItem {
  atoms: AtomInput[];
  folderId: string | null;
  /** 可选: 调用方提供的 idempotency token (本期不实施去重, 仅 reserved) */
  importToken?: string;
  /** 可选: 标题提示 (markdownToAtoms 已写入 atom[0] isTitle 时可省) */
  titleHint?: string;
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
  notes: NoteInfo[]; // 成功创建的 NoteInfo (顺序与 input.items 对齐, 失败位为 null 待定 - 简单方案: 仅含成功项)
  failures: CreateNoteBatchFailure[];
}
```

加入 `NoteApi` interface 字段：
```ts
createNotesBatch(input: CreateNoteBatchInput): Promise<CreateNoteBatchResult>;
```

#### S7.4.2 在 `src/platform/main/note/capability-impl.ts` 实施 createNotesBatch

**核心算法**（用户拍板路径 — atoms 直写 storage 不经 dissect）：

```ts
import type {
  CreateNoteBatchInput,
  CreateNoteBatchResult,
  CreateNoteBatchFailure,
} from '@capabilities/note/types';

export async function createNotesBatch(
  input: CreateNoteBatchInput,
): Promise<CreateNoteBatchResult> {
  const { items, broadcastMode = 'final' } = input;
  const notes: NoteInfo[] = [];
  const failures: CreateNoteBatchFailure[] = [];

  // 单 transaction 包整批 (5B §7.5.2 字面 all-or-nothing 默认).
  // 边界场景 >500 chunk: 本期不实施 (设计 §7.5.2 字面"留 storage 性能压测决定"),
  // 仅在 console.warn 提示 + 单 tx 试一次.
  if (items.length > 500) {
    console.warn(
      `[note-capability/createNotesBatch] batch size ${items.length} > 500; ` +
        `single-transaction strategy may hit SurrealDB timeout (Stage 7 字面未实施 chunk)`,
    );
  }

  try {
    await storage.transaction(async (tx) => {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          const note = await createSingleNoteFromAtoms(tx, item);
          notes.push(note);
        } catch (err) {
          failures.push({
            index: i,
            error: String(err),
            rolledBack: true, // all-or-nothing 模式整批回滚
          });
          throw err; // 触发 storage.transaction rollback
        }
      }
    });
  } catch (err) {
    // tx rolled back; failures 字面已带 rolledBack:true
    if (failures.length === 0) {
      // 走到这说明是 tx 框架自己 throw (非业务 throw), 字面登记
      failures.push({ index: -1, error: String(err), rolledBack: true });
    }
    return { notes: [], failures };
  }

  // broadcast (本期仅 final 模式; progressive-throttle 字面留 Stage 9 性能压测时实施)
  if (broadcastMode === 'final' && notes.length > 0) {
    broadcastNoteListChanged();
  }

  return { notes, failures };
}
```

#### S7.4.3 实施 `createSingleNoteFromAtoms(tx, item)` (atoms → storage 直写算法)

**字面算法**：

```ts
async function createSingleNoteFromAtoms(
  tx: StorageTransaction,
  item: CreateNoteBatchItem,
): Promise<NoteInfo> {
  // 1. 给所有 atoms 注入 ULID (id null → 新 ULID; 已有 id 保留)
  const atomsWithIds = item.atoms.map(atom =>
    atom.id ? atom : { ...atom, id: generateUlid() }
  );

  // 2. 派生 title (走 atoms[0] isTitle 路径; 若无 isTitle 走 titleHint; 都无走默认空)
  const title = deriveTitleFromAtoms(atomsWithIds, item.titleHint);

  // 3. 创建 container atom
  const containerAtom = await tx.putAtom<'pm'>({
    payload: { domain: NOTE_DOMAIN, payload: containerPayloadWithTitle(title) },
  });

  // 4. hasNoteView marker (沿 createNote 同款)
  const now = Date.now();
  await tx.putEdge({
    predicate: HAS_NOTE_VIEW_PREDICATE,
    subject: { kind: 'atom', atomId: containerAtom.id },
    object: { kind: 'literal', type: 'boolean', value: true },
    attrs: { createdBy: 'user-default', createdAt: now },
  });

  // 5. inFolder 边
  if (item.folderId) {
    await tx.putEdge({
      predicate: IN_FOLDER_PREDICATE,
      subject: { kind: 'atom', atomId: containerAtom.id },
      object: { kind: 'atom', atomId: item.folderId },
      attrs: { createdBy: 'user-default', createdAt: now },
    });
  }

  // 6. 写所有 block atoms + belongsToNote 边
  for (const atom of atomsWithIds) {
    await tx.putAtom<'pm'>({
      id: atom.id!,
      payload: { domain: NOTE_DOMAIN, payload: toAtomPayload(atom) },
    });
    await tx.putEdge({
      predicate: BELONGS_TO_NOTE_PREDICATE,
      subject: { kind: 'atom', atomId: atom.id! },
      object: { kind: 'atom', atomId: containerAtom.id },
      attrs: { createdBy: 'user-default', createdAt: now },
    });
    // childOf 边: 若 atom.parentId 字面存在
    if (atom.parentId) {
      await tx.putEdge({
        predicate: CHILD_OF_PREDICATE,
        subject: { kind: 'atom', atomId: atom.id! },
        object: { kind: 'atom', atomId: atom.parentId },
        attrs: { createdBy: 'user-default', createdAt: now },
      });
    }
  }

  // 7. nextSibling 边: 顶层 atoms (无 parentId) 字面按数组顺序链
  const topLevelIds = atomsWithIds.filter(a => !a.parentId).map(a => a.id!);
  for (let i = 0; i < topLevelIds.length - 1; i++) {
    await tx.putEdge({
      predicate: NEXT_SIBLING_PREDICATE,
      subject: { kind: 'atom', atomId: topLevelIds[i] },
      object: { kind: 'atom', atomId: topLevelIds[i + 1] },
      attrs: { createdBy: 'user-default', createdAt: now },
    });
  }
  // 嵌套 sibling 链 (parentId 相同的 atoms 之间): 按数组顺序分组连接
  const byParent = new Map<string, string[]>();
  for (const a of atomsWithIds) {
    if (!a.parentId) continue;
    if (!byParent.has(a.parentId)) byParent.set(a.parentId, []);
    byParent.get(a.parentId)!.push(a.id!);
  }
  for (const childIds of byParent.values()) {
    for (let i = 0; i < childIds.length - 1; i++) {
      await tx.putEdge({
        predicate: NEXT_SIBLING_PREDICATE,
        subject: { kind: 'atom', atomId: childIds[i] },
        object: { kind: 'atom', atomId: childIds[i + 1] },
        attrs: { createdBy: 'user-default', createdAt: now },
      });
    }
  }

  // 8. 构造 NoteInfo 返回 (走原 createNote 同款 buildNoteInfo)
  return buildNoteInfo(containerAtom.id, title);
}
```

辅助函数：
- `deriveTitleFromAtoms(atoms, titleHint?)`：找 atoms[0]?.attrs?.isTitle 真时取其文本；否则用 titleHint；否则空串。**实施时 grep `deriveTitle` 看现有算法借鉴**。
- `toAtomPayload(atom: AtomInput): PmPayload`：把 AtomInput 转 storage payload 形态（type + attrs + content）。
- `buildNoteInfo(containerId, title)`：构造 NoteInfo（看 createNote 现有走法）。

#### S7.4.4 verifyNotePersisted（5B §7.5.2 字面）

```ts
/**
 * 5B §7.5.2 字面: 抽 N 个刚 create 的 note, listAtoms(belongsToNote) 拿回写库后的
 * atoms, 与 input atoms 比对 atom count + ids 同集合;失败 throw 触发整批 rollback.
 */
async function verifyNotePersisted(
  tx: StorageTransaction,
  noteId: string,
  inputAtoms: AtomInput[],
): Promise<void> {
  const persisted = await tx.listAtoms({ /* belongsToNote = noteId */ });
  if (persisted.length !== inputAtoms.length) {
    throw new Error(
      `[verifyNotePersisted] note ${noteId.slice(-8)}: ` +
        `expected ${inputAtoms.length} atoms, got ${persisted.length}`,
    );
  }
  const persistedIds = new Set(persisted.map(a => a.id));
  for (const a of inputAtoms) {
    if (!a.id || !persistedIds.has(a.id)) {
      throw new Error(
        `[verifyNotePersisted] note ${noteId.slice(-8)}: missing atom ${a.id}`,
      );
    }
  }
}
```

调用点：createNotesBatch tx 内每 5 个 item 抽 1 个调一次（或 N=min(3, items.length) 随机抽）。本期简化为"每 item 都跑一次"（性能可接受 + 验收明确）。

#### S7.4.5 broadcastNoteListChanged

grep `NOTE_LIST_CHANGED` 看现有 createNote 怎么广播，沿用同款（main → renderer broadcast）。

### S7.5 IPC handler + preload bridge

#### S7.5.1 `src/platform/main/note/handlers.ts`

在现有 NOTE_CREATE handler 旁加 NOTE_CREATE_BATCH：

```ts
import { createNotesBatch } from './capability-impl';

ipcMain.handle(IPC_CHANNELS.NOTE_CREATE_BATCH, async (_evt, input: CreateNoteBatchInput) => {
  return createNotesBatch(input);
});
```

#### S7.5.2 `src/shared/ipc/channels.ts`（grep 定位实际位置）

加 channel 常量 `NOTE_CREATE_BATCH = 'note:create-batch'`（沿现有命名风格）。

#### S7.5.3 `src/platform/main/preload/main-window-preload.ts`

在现有 NOTE_CREATE bridge 旁加：

```ts
noteCreateBatch: (input: CreateNoteBatchInput) =>
  ipcRenderer.invoke(IPC_CHANNELS.NOTE_CREATE_BATCH, input),
```

#### S7.5.4 `src/shared/ipc/electron-api.d.ts`（grep 定位）

加 `noteCreateBatch` 字段类型。

### S7.6 view 端永久删除临时桥，切换走 createNotesBatch

#### S7.6.1 `src/views/note/markdown-import.ts`

字面删除：
- line 38 + line 658 + line 723 处 "5B Stage 6 临时桥" 注释段
- 所有 `atomsToProseMirror` import 与调用（深路径 import）
- 所有 `tea.markdownToProseMirror` 残留（应已被 Stage 6 删但二次确认）

字面新逻辑：
- markdownToAtoms 拿 `{ atoms, warnings }`
- 不再装 DriverSerialized，不再调 createNote 单条
- 收集为 batch items：`{ atoms, folderId, titleHint: file.name }`
- 末尾批量调 `noteCap().createNotesBatch({ items, broadcastMode: 'final' })`
- 失败处理：result.failures 字面遍历 console.warn + UI 提示（沿 markdown-import 现有失败 UI）

#### S7.6.2 `src/views/note/extraction-import.ts`

类似 S7.6.1：
- 删除深路径 `sanitizeAtoms` + `atomsToProseMirror` import 与调用
- 走 `krigBatchToAtoms(batch)` 拿 chapter atoms
- 批量调 `createNotesBatch({ items: chapters.map(c => ({ atoms: c.atoms, folderId, titleHint: c.title })) })`

### Stage 7 验收

#### V1：typecheck 全绿

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -v "src/main/ipc/handlers.ts\|src/renderer/shell/WorkspaceBar.tsx"
```

**期望**：0 行错误。

#### V2：AtomInput SSOT 单点 export

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -rn "^export interface AtomInput\|^interface AtomInput" src --include='*.ts'
```

**期望**：仅 `src/semantic/types/atom-input.ts` 1 行命中。

#### V3：AtomInput 五处消费方走 import

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -rn "from '@semantic/types'" src --include='*.ts' | grep -v "node_modules" | xargs -I {} echo {} | grep -i atom
```

**期望**：≥5 行（content-ingest types/internal*4、text-editing types、atoms-to-pm、extraction-import 等）。可改用更简单 grep 验证：

```bash
grep -rn "AtomInput" src/capabilities/content-ingest src/capabilities/text-editing src/views/note --include='*.ts' | head
```

#### V4：createNotesBatch API 已加

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -n "createNotesBatch" src/capabilities/note/types.ts src/platform/main/note/capability-impl.ts src/platform/main/note/handlers.ts
```

**期望**：三文件都命中。

#### V5：IPC + preload bridge

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -rn "NOTE_CREATE_BATCH\|noteCreateBatch" src/shared src/platform/main/preload --include='*.ts'
```

**期望**：channels.ts 含 const，preload 含 bridge，electron-api.d.ts 含字段。

#### V6：view 端临时桥已删

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -n "5B Stage 6 临时桥\|atomsToProseMirror" src/views/note/markdown-import.ts src/views/note/extraction-import.ts
```

**期望**：0 命中。

#### V7：view 端走 createNotesBatch

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -n "createNotesBatch" src/views/note/markdown-import.ts src/views/note/extraction-import.ts
```

**期望**：两 view 文件各 ≥1 命中。

#### V8：canvas-text-node 不再需要 cast

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && grep -n "as unknown as AtomInput\|as AtomInput" src/capabilities/canvas-text-node/atom-bridge.ts
```

**期望**：0 命中（SSOT 收敛后类型直接对齐）。

### Commit 纪律

**多 commit 推荐**（拆三段以便回滚）：
- Commit 1：S7.1 + S7.2 + S7.3 全部（AtomInput SSOT + 五处收敛）— msg "5B Stage 7a — AtomInput SSOT to @semantic/types + 5-site convergence"
- Commit 2：S7.4 + S7.5（createNotesBatch API + IPC handler）— msg "5B Stage 7b — createNotesBatch capability API + IPC handler"
- Commit 3：S7.6（view 端切换 + 临时桥删除）— msg "5B Stage 7c — view migration to createNotesBatch + remove Stage 6 bridges"

每段 commit 前**先跑** typecheck 确认绿（不要 chain 失败 commit）。

- **不要** push
- **不要** merge 到 main
- 不要 commit 任何与 5B Stage 7 无关的文件（如 `docs/tasks/import-progress-ui-prompt.md`）

## 操作纪律（违反任意一条立刻停手报告）

### cwd 漂移防御

V2 cwd 漂移 15 次事故。**每一条 Bash 都必须 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`**。Read / Edit / Write 一律传绝对路径。

三联守门：

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && pwd && git remote -v | head -1 && git branch --show-current
```

### Sandbox 限制（已知）

harness sandbox 可能拦截 `tsc` / `git add` / `git commit`。遇到拦截**不要**走 `--dangerouslyDisableSandbox`，停下来汇报让总指挥介入。前 2 个 Stage 都遇到过。

### 实施纪律

**可以**：
- 在 `feature/import-refactor-stage-5B-7` 分支修改 src/
- 跑 `npx tsc --noEmit` 自校验（可能拦截）
- 分 3 段 commit
- 跑 grep / 读源码

**不可以**：
- 切到其它分支
- merge / cherry-pick / rebase
- `git push`
- 改设计文档 / 决议 026 / 任何 docs/（除本 prompt 文档）
- 改 Stage 7 范围外的源代码（如改 createNote 单条 API、改 dissect/assemble 算法、改画板路径）
- 操作数据库 / 跑 migration

### 完成标准

- 8 个 V1-V8 验收全部 PASS（V1 typecheck 若 sandbox 拦，让总指挥跑）
- 3 个 commit 全在 `feature/import-refactor-stage-5B-7` 分支
- 5B 设计 §节 4 Stage 7 字面 + 用户拍板的 batch=Atom[][] + AtomInput SSOT 字面落地
- 旧 createNote 单条 API 字面保留不动（兼容 paste / ebook 标注路径）

完成后向调用方汇报：
- 3 个 commit hash + 改动文件清单
- V1-V8 各项验收结果
- 实施过程中发现的新问题（含任何"atoms 直写 storage"算法触及但未在本 prompt 列出的边角 case）
- 任何 5B 设计文档与现实情况不一致的发现

---

## Agent 配置建议（给调用方）

- **agent 类型**：`general-purpose`
- **是否后台运行**：可后台。完成时通知
- **预期工作时间**：3-4 小时（SSOT 收敛 6 处 + createNotesBatch 算法 + IPC + view 切换 + 验收）
