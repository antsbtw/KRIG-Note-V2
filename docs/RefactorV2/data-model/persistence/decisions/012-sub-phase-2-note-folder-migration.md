# Decision 012 — Phase N Sub-phase 2: noteStore + folderStore 迁移

> **Phase**: N（实施 Phase）/ Sub-phase 2
> **状态**: ✅ **已实施完成**（feature/L7-sub2-note-folder-migration 分支,§6.2 全部通过,2026-05-12）
> **设计师 / 审计师**: 本对话（main 分支）
> **实施者**: 新对话（`feature/L7-sub2-note-folder-migration` 分支）
> **决议日期**: 2026-05-12
> **前置依赖**: sub-phase 1 已完成（merge commit `34e3758`）
> **实施总结**: 11 commits(10 主步骤 + 1 集成测试 fixup);§6.2 7 个核心场景全通过

---

## 0. 本文档的执行指南

### 0.1 角色与流程（与 sub-phase 1 同模式）

```
本对话 (main) → 写本文档(设计师)
新对话 (feature/L7-sub2-note-folder-migration) — 独立 session
    ↓ 按本文档执行代码实施
    ↓ 每完成步骤 commit
    ↓ 完成后停下,通知本对话
本对话 (main) → 审计 + 合并 main
```

### 0.2 实施纪律（实施者必须遵守）

1. **严格按本文档执行**，不自行扩展范围。发现遗漏 → 停下汇报，**不自行决定**。
2. **每完成 §5 步骤 commit 一次**。
3. **不动 V1 仓库**（按 `feedback_v2_is_workspace_v1_is_reference`）。所有 Bash 命令前 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...` 显式指定。
4. **不合 main**，留在 `feature/L7-sub2-note-folder-migration` 分支。
5. **完成所有 §5 步骤后停下**，发"L7-sub2-note-folder-migration 实施完成请审计"。
6. **不动其他业务 store**（graphStore / ebookStore / vocabStore / mediaStore / inspectorStore / workspaceStore）—— 本 sub-phase 2 只动 noteStore + folderStore。
7. 涉及 SurrealQL / schema 操作时**已 binary 验证**的标识：本文档涉及的新增 SurrealQL / DEFINE 语句**未在 binary 验证**，实施者需在实际 binary 上 verify，发现 SurrealDB 3.0.4 行为不一致**立即停下汇报**。

### 0.3 本文档为何要冗余复述决议链

跟 decision 011 同理 —— 实施者是独立 session 无上下文。所有关键决议在本文档内复述清楚。

---

## 1. 改造目标（What）

### 1.1 本 sub-phase 的范围

**包含**：
- 新增 `folder` atom domain（按 atom domain 开放注册体系）
- 新建 `src/capabilities/note/` —— 业务级 API（封装 storage 层调用）
- 新建 `src/capabilities/folder/` —— folder 业务 API
- **删除** `src/views/note/note-store.ts` —— 业务从 capability 走
- **删除** `src/views/note/folder-store.ts` —— 同上
- 改 14+ 文件 import noteStore/folderStore 改为 capability API
- noteStore 当前实际未 save 的 bug 同步修复（实测一致性）
- 启动时检测 schema 版本不匹配 → 清空 localStorage（按用户拍板选项 M）
- `user:krig:inFolder` 边语义实施（note → folder / folder → folder 嵌套）

**不包含**：
- ❌ 其他业务 store 迁移（graph / ebook / annotation / vocab / media / inspector / workspace）—— sub-phase 3-4
- ❌ EVENT 触发器 cascade delete —— sub-phase 1 留的 EM6 验证项，本 sub-phase 启动时验证
- ❌ 全文索引 / 物化视图 —— Phase N+

### 1.2 V2 当前状态（实施起点）

V2 当前 noteStore（`src/views/note/note-store.ts` 202 行）：
- 类形态：单例 class，constructor 调 `load()` + `migrateLegacy()`
- 数据：`{ notes: Record<string, Note>, counter: number }`
- 持久化：`localStorage.setItem('krig.notes', JSON.stringify(state))`
- **已知 bug**：早期对话验证 leveldb 里没有 `krig.notes` key —— save 从未真正成功过（原因未深查）
- 消费方：14+ 文件 import `noteStore` 单例

V2 当前 folderStore（`src/views/note/folder-store.ts` 171 行）：
- 同 noteStore 结构，存 `localStorage.getItem('krig.folders')`
- 消费方：6 个文件

Note 接口当前形态：
```ts
interface Note {
  id: string;                  // 'note-${counter}'
  title: string;               // 派生(从 doc 第一段提取)
  doc: DriverSerialized;       // PM doc 序列化
  folderId: string | null;     // 外键
  createdAt: number;
  updatedAt: number;
}
```

Folder 接口当前形态：
```ts
interface Folder {
  id: string;
  title: string;               // 真实业务字段
  parentId: string | null;     // 树形嵌套
  createdAt: number;
  updatedAt: number;
}
```

### 1.3 完成判据（高层）

- `npm start` 跑通
- 新建笔记 / 编辑 / 关闭重启 → 笔记保留 ✓（解决"笔记找不到"bug）
- 文件夹树形结构正确（新建 / 嵌套 / 排序）
- 笔记归属文件夹正确（创建 / 移动 / 跨文件夹）
- typecheck + lint 通过
- `git diff main..feature/L7-sub2-note-folder-migration -- src/views/note/note-store.ts src/views/note/folder-store.ts` 显示文件已删除

详 §6 测试清单。

---

## 2. 改造背景（Why）

### 2.1 为什么先迁 note + folder（不是 graph / ebook）

按 [decision 009 §3.1 sub-phase 2 优先级](009-migration-strategy.md)：

- noteStore 当前实际未 save（最早期对话验证的 bug） —— 迁移同时修 bug
- folderStore 跟 noteStore 紧耦合（folderId 外键），一起迁避免半完成态
- 笔记是 V2 核心功能，迁移完成验证最有意义

### 2.2 走 capability 不直接改 view 的理由

按 [decision 008 §4.0 调用边界](008-storage-layer-interface.md)：

```
┌──────────────────────────────┐
│ View 层 (src/views/note/)    │ ✗ 禁止 import @/storage
│   通过 noteCapability API   │
├──────────────────────────────┤
│ Capability 层               │ ✓ 唯一可调 storage 层
│   src/capabilities/note/    │
│   src/capabilities/folder/  │
├──────────────────────────────┤
│ Storage 层 (sub-phase 1 已落)│
│   src/storage/api.ts        │
└──────────────────────────────┘
```

→ view 改造 = 把 `import { noteStore } from './note-store'` 改为 `import { noteCapability } from '@/capabilities/note'`。

### 2.3 接受的代价

- 当前同步 API（`noteStore.create(...)` 立即返回）变成 **async**（`await noteCapability.createNote(...)`）—— view 层 React 组件需要处理 async 状态
- noteStore 当前用 `useSyncExternalStore` 订阅，**异步迁移后订阅机制要重新设计**（详 §3.4 订阅机制）

---

## 3. 实施目标态（What 具体）

### 3.1 新增 `folder` atom domain

按用户拍板选项 A —— folder 是新 atom domain（atom domain 开放注册体系，无 schema migration）。

**folder domain 定义**（实施者在 `src/semantic/types/atom.ts` 加）：

```ts
/** folder domain — 笔记 / 资源的文件夹容器 */
export interface FolderPayload {
  title: string;            // 文件夹显示名(folder 上是真实业务字段,不像 note title 是派生)
}

// 更新 AtomPayloadOf<D> 分派
export type AtomPayloadOf<D extends AtomDomain> =
  D extends 'pm'        ? PmPayload :
  D extends 'rdf'       ? RdfPayload :
  D extends 'embedding' ? EmbeddingPayload :
  D extends 'three'     ? ThreePayload :
  D extends 'folder'    ? FolderPayload :   // ← 新增
  unknown;
```

**folder 嵌套用边表达**（不在 payload 里存 parentId）：

```
folder A 嵌套在 folder B 内:
  edge: user:krig:inFolder
  subject: AtomRef(atomId=folder-A-id)
  object: AtomRef(atomId=folder-B-id)
  attrs: { createdBy: 'user-default', createdAt: ... }
```

→ folder 间嵌套 + note 归属 folder **共用同一条边类型** `user:krig:inFolder`。

### 3.2 Note atom 形态

```ts
// AtomEntity<'pm'>
{
  id: ULID,
  createdAt / updatedAt / createdBy: 'user-default',
  payload: {
    domain: 'pm',
    payload: {                    // PmPayload (PM doc root node)
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { isTitle: true }, content: [{ type: 'text', text: 'My Note' }] },
        // ... 后续 block
      ]
    }
  }
}
```

**title 字段处置（按用户拍板选项 P 删除）**：
- 不在 payload 内存 title
- 列表显示时从 `payload.payload.content[0]` 派生（首个 paragraph 第一段文本）
- 派生逻辑放在 `src/capabilities/note/derive-title.ts`

**folderId 字段处置（删除）**：
- Note 不存 folderId
- "笔记归属文件夹" 走 `user:krig:inFolder` 边

### 3.3 `user:krig:inFolder` 边定义

按 [relations/spec.md §1.3 vocabulary](../../relations/spec.md) `krig` 自定义空间：

```ts
{
  predicate: 'user:krig:inFolder',
  subject: AtomRef(atomId=note-or-folder-id),
  object: AtomRef(atomId=folder-id),
  attrs: {
    createdBy: 'user-default',
    createdAt: Date.now(),
  }
}
```

**Cardinality**：
- subject（note / folder）→ object（folder）：**一对一**（一个 note / folder 只能在一个父 folder 内）
- 根级 note / folder：**没有 inFolder 边**（不在任何 folder 内）

**移动语义**：
- 移动 note 到新 folder = 删旧 `inFolder` 边 + 加新 `inFolder` 边
- 用 `storage.transaction()` 原子操作

### 3.4 capability API 设计

#### `src/capabilities/note/index.ts`

```ts
import { storage } from '@/storage';
import type { AtomEntity, PmPayload } from '@/semantic/types';
import { deriveTitle } from './derive-title';

export interface NoteInfo {
  id: string;
  title: string;                  // 派生
  doc: AtomEntity<'pm'>;
  folderId: string | null;        // 派生(从 inFolder 边查)
  createdAt: number;
  updatedAt: number;
}

export const noteCapability = {
  /** 创建新笔记。若指定 folderId,同时建 inFolder 边 */
  async createNote(
    initialDoc?: PmPayload,
    folderId: string | null = null,
  ): Promise<NoteInfo> {
    return storage.transaction(async tx => {
      const atom = await tx.putAtom({
        payload: {
          domain: 'pm',
          payload: initialDoc ?? emptyPmDoc(),
        },
      });
      if (folderId) {
        await tx.putEdge({
          predicate: 'user:krig:inFolder',
          subject: { kind: 'atom', atomId: atom.id },
          object: { kind: 'atom', atomId: folderId },
          attrs: { createdBy: 'user-default', createdAt: Date.now() },
        });
      }
      return atomToNoteInfo(atom, folderId);
    });
  },

  /** 列出所有笔记 */
  async listNotes(): Promise<NoteInfo[]> {
    const atoms = await storage.listAtoms({ domain: 'pm' });
    // 批量查 inFolder 边
    const folderIdByNoteId = await batchGetFolderId(atoms.map(a => a.id));
    return atoms.map(atom => atomToNoteInfo(atom, folderIdByNoteId[atom.id] ?? null));
  },

  /** 读单条笔记(详细 doc) */
  async getNote(id: string): Promise<NoteInfo | null> {
    const atom = await storage.getAtom<'pm'>(id);
    if (!atom) return null;
    const folderId = await getFolderIdForNote(id);
    return atomToNoteInfo(atom, folderId);
  },

  /** 更新笔记 doc */
  async updateNote(id: string, doc: PmPayload): Promise<NoteInfo> {
    const atom = await storage.putAtom<'pm'>({
      id,
      payload: { domain: 'pm', payload: doc },
    });
    const folderId = await getFolderIdForNote(id);
    return atomToNoteInfo(atom, folderId);
  },

  /** 移动笔记到 folder(或根级) */
  async moveNote(noteId: string, newFolderId: string | null): Promise<void> {
    await storage.transaction(async tx => {
      // 删旧 inFolder 边
      const oldEdges = await tx.listEdges({
        predicate: 'user:krig:inFolder',
        subjectAtomId: noteId,
      });
      for (const e of oldEdges) {
        await tx.deleteEdge(e.id);
      }
      // 加新 inFolder 边(若 newFolderId 非 null)
      if (newFolderId) {
        await tx.putEdge({
          predicate: 'user:krig:inFolder',
          subject: { kind: 'atom', atomId: noteId },
          object: { kind: 'atom', atomId: newFolderId },
          attrs: { createdBy: 'user-default', createdAt: Date.now() },
        });
      }
    });
  },

  /** 删除笔记(cascade 删 inFolder 边由 storage 层自动) */
  async deleteNote(id: string): Promise<void> {
    await storage.deleteAtom(id);
  },

  // ── 订阅机制 ──
  /** 订阅笔记变更(任何 putAtom/deleteAtom/inFolder 边变更触发) */
  subscribe(listener: () => void): () => void { ... },
};

function emptyPmDoc(): PmPayload {
  return { type: 'doc', content: [{ type: 'paragraph', attrs: { isTitle: true }, content: [] }] };
}

function atomToNoteInfo(atom: AtomEntity<'pm'>, folderId: string | null): NoteInfo {
  return {
    id: atom.id,
    title: deriveTitle(atom.payload.payload),
    doc: atom,
    folderId,
    createdAt: atom.createdAt,
    updatedAt: atom.updatedAt,
  };
}

async function getFolderIdForNote(noteId: string): Promise<string | null> {
  const edges = await storage.listEdges({
    predicate: 'user:krig:inFolder',
    subjectAtomId: noteId,
    limit: 1,
  });
  if (edges.length === 0) return null;
  const obj = edges[0].object;
  return obj.kind === 'atom' ? obj.atomId : null;
}

async function batchGetFolderId(noteIds: string[]): Promise<Record<string, string>> {
  // 一次性查所有 inFolder 边,reduce 成 {noteId → folderId}
  const result: Record<string, string> = {};
  for (const noteId of noteIds) {
    const folderId = await getFolderIdForNote(noteId);
    if (folderId) result[noteId] = folderId;
  }
  return result;
}
```

#### `src/capabilities/folder/index.ts`

```ts
export const folderCapability = {
  async createFolder(title: string, parentFolderId: string | null = null): Promise<FolderInfo> { ... },
  async listFolders(): Promise<FolderInfo[]> { ... },
  async getFolder(id: string): Promise<FolderInfo | null> { ... },
  async renameFolder(id: string, newTitle: string): Promise<FolderInfo> { ... },
  async moveFolder(folderId: string, newParentFolderId: string | null): Promise<void> { ... },
  async deleteFolder(id: string): Promise<void> { ... },
  subscribe(listener: () => void): () => void { ... },
};

export interface FolderInfo {
  id: string;
  title: string;
  parentId: string | null;        // 派生(从 inFolder 边查)
  createdAt: number;
  updatedAt: number;
}
```

实施细节跟 note 同模式，按 atom domain `folder` 操作。

### 3.5 订阅机制设计

V2 当前 noteStore 用同步 `subscribe(listener)` + `useSyncExternalStore`。改造后变 async，订阅机制变化：

**方案**：capability 层维护"事件订阅 + 缓存"层：

```ts
class NoteCapability {
  private listeners = new Set<() => void>();
  private cache: NoteInfo[] | null = null;

  // 业务方法内部调 storage 后清缓存 + 通知
  async createNote(...) {
    await storage.putAtom(...);
    this.invalidateCache();
  }

  private invalidateCache() {
    this.cache = null;
    this.listeners.forEach(l => l());
  }

  // view 层用法保持 useSyncExternalStore 兼容
  subscribe(l: () => void) { this.listeners.add(l); return () => this.listeners.delete(l); }
  getSnapshot(): NoteInfo[] | null { return this.cache; }
  async refreshSnapshot(): Promise<void> {
    this.cache = await this.listNotes();
    this.invalidateCache();
  }
}
```

view 层启动时调 `refreshSnapshot()` 拉初始数据，后续 `subscribe + getSnapshot` 沿用现有模式。

详细订阅设计实施者按需调整，**保留 view 层 useSyncExternalStore 兼容性**是关键。

### 3.6 启动时 localStorage 清空逻辑（选项 M）

按用户拍板，启动时检测到 V2 localStorage 有旧 `krig.notes` / `krig.folders` 数据 → 自动清空（V2 测试数据可丢）：

```ts
// src/capabilities/note/migration.ts
export function clearLegacyLocalStorage(): void {
  const removed: string[] = [];
  if (localStorage.getItem('krig.notes')) {
    localStorage.removeItem('krig.notes');
    removed.push('krig.notes');
  }
  if (localStorage.getItem('krig.folders')) {
    localStorage.removeItem('krig.folders');
    removed.push('krig.folders');
  }
  if (removed.length > 0) {
    console.log(`[note-capability] cleared legacy localStorage keys: ${removed.join(', ')} (V2 storage 已切 SurrealDB)`);
  }
}
```

在 noteCapability 模块初始化时调一次（idempotent）。

---

## 4. 受影响的代码清单

### 4.1 新建文件

| 文件 | 用途 |
|---|---|
| `src/semantic/types/atom.ts` | 修改：加 `FolderPayload` + 更新 `AtomPayloadOf<D>` |
| `src/capabilities/note/index.ts` | noteCapability API |
| `src/capabilities/note/derive-title.ts` | 从 PmPayload 派生 title |
| `src/capabilities/note/migration.ts` | 启动时清 legacy localStorage |
| `src/capabilities/folder/index.ts` | folderCapability API |

### 4.2 删除文件

| 文件 | 删除理由 |
|---|---|
| `src/views/note/note-store.ts` | 改走 noteCapability |
| `src/views/note/folder-store.ts` | 改走 folderCapability |

### 4.3 改造文件（14+ 个消费方）

按 sub-phase 1 实施前扫的 `grep -rln "noteStore\|note-store"` + `grep -rln "folderStore\|folder-store"` 结果：

| 文件 | 改动方向 |
|---|---|
| `src/drivers/text-editing-driver/blocks/note-link/node-view.ts` | `noteStore.get(noteId)` → `await noteCapability.getNote(noteId)` |
| `src/drivers/text-editing-driver/blocks/note-link/spec.ts` | 同上 |
| `src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts` | 同上 |
| `src/capabilities/shape-library/substances/registry.ts` | 同上 |
| `src/capabilities/text-editing/converters/atoms-to-pm.ts` | 同上 |
| `src/platform/main/extraction/handlers.ts` | main 进程从 noteCapability 拿数据；改 import 路径（main 可直接 import capability 或 storage 都行） |
| `src/views/L5-alive.ts` | 改新 capability 接口诊断 |
| `src/views/note/NoteView.tsx` | sub state 改 capability + async load |
| `src/views/note/link-click-integration.ts` | 同上 |
| `src/views/note/tree-builder.ts` | 接受 NoteInfo / FolderInfo（接口名变） |
| `src/views/note/nav-side-content.tsx` | 订阅 capability + async load |
| `src/views/note/extraction-import.ts` | 写笔记走 noteCapability.createNote |
| `src/views/note/tree-operations.ts` | 增删改走 capability |
| `src/views/note/data-model.ts` | 同上 |

预计 14 个文件改造。

### 4.4 main 进程改动

`src/platform/main/index.ts` 启动顺序（sub-phase 1 已建好）：
- ✅ `initStorage()` 在 app.whenReady 中已加（sub-phase 1）
- ⏳ sub-phase 2 不需要再改 main，capability 在 renderer 端通过 IPC 调 main 进程 storage

⚠ **注意**：sub-phase 1 `initStorage` 在 main 进程。renderer 端的 capability 怎么调 main 端的 storage？这是个**IPC 设计**关键决议（详 §3 待补 + §8 Open Q）。

### 4.5 不动的文件

- 所有非 noteStore/folderStore 业务 store（graph / ebook / annotation / vocab / media / inspector / workspace）—— sub-phase 3-4
- V1 仓库
- main 分支已 commit 的 docs/

---

## 5. 实施步骤（按顺序执行 + 每步 commit）

### Step 5.0 — 跨进程 IPC 设计验证（前置）

**前置 verify**：storage 当前在 main 进程，capability 在哪？

实施者先 verify：

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
# 看 sub-phase 1 加的 initStorage 在哪个进程
grep -n "initStorage" src/platform/main/index.ts
# 看现有 capability 怎么跨进程通信
ls src/platform/main/preload/
grep -rn "ipcMain.handle\|ipcRenderer.invoke" src/ --include="*.ts" | head -10
```

V2 现有跨进程模式（按 sub-phase 1 实施的 `src/storage/` 位置）：

**方案 A**：capability 跟 storage 都在 main 进程，renderer 通过 IPC 调 capability API
- 优点：storage 调用最直接
- 缺点：每个 capability 方法都要写 IPC handler + preload bridge

**方案 B**：capability 在 renderer 端，通过 IPC 调 main 端的 storage
- 优点：业务逻辑在 renderer，跟 view 同进程
- 缺点：每个 storage API 都要包 IPC

**方案 C**：storage 通过 IPC 暴露 main 进程的 storage 给 renderer，capability 在 renderer 端调"已包装过的 storage proxy"
- 优点：业务逻辑在 renderer + storage proxy 是 sub-phase 1 应该已经准备好的（应该有 `src/storage/ipc/` 或类似）

**实施者 verify 当前 sub-phase 1 实际架构后停下汇报**，等设计师批复采用哪个方案。

**commit**: 无（仅 verify）

### Step 5.1 — 创建分支 + 起点验证

```bash
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2
git checkout main
git pull origin main
git checkout -b feature/L7-sub2-note-folder-migration main
git branch --show-current

npm install
npx tsc --noEmit  # 起点 typecheck 通过
npx eslint src/   # 起点 lint 通过(允许 1 pre-existing warning)
```

**commit**: 无

### Step 5.2 — 加 folder atom domain

修改 `src/semantic/types/atom.ts`：

```ts
// 加 FolderPayload 接口
export interface FolderPayload {
  title: string;
}

// 更新 AtomPayloadOf<D>
export type AtomPayloadOf<D extends AtomDomain> =
  D extends 'pm'        ? PmPayload :
  D extends 'rdf'       ? RdfPayload :
  D extends 'embedding' ? EmbeddingPayload :
  D extends 'three'     ? ThreePayload :
  D extends 'folder'    ? FolderPayload :    // ← 新增
  unknown;
```

**验证**：`npx tsc --noEmit` 通过。

**commit**: `feat(L7-sub2-note-folder-migration step 5.2): semantic/types 加 folder domain + FolderPayload`

### Step 5.3 — 启动时清 legacy localStorage

新建 `src/capabilities/note/migration.ts`，按 §3.6 实施。

在 `src/views/L5-alive.ts` 或 capability 初始化路径调用 `clearLegacyLocalStorage()`。

**verify**：
- 启动应用,console 出现 `[note-capability] cleared legacy localStorage keys` 日志（如果有旧数据）
- 或不出现日志（如果原本就没旧数据）

**commit**: `feat(L7-sub2-note-folder-migration step 5.3): clearLegacyLocalStorage 启动时清理`

### Step 5.4 — 实施 folderCapability

新建 `src/capabilities/folder/index.ts`，按 §3.4 设计实施：

- `createFolder(title, parentFolderId)`：putAtom (domain='folder') + putEdge (inFolder)
- `listFolders()`：listAtoms (domain='folder') + 批量查 inFolder 边
- `getFolder(id)`：getAtom
- `renameFolder(id, newTitle)`：putAtom（id 已有 → 更新 payload.title）
- `moveFolder(folderId, newParentFolderId)`：transaction 删旧 inFolder 边 + 加新
- `deleteFolder(id)`：deleteAtom（cascade delete inFolder 边由 storage 自动处理 —— **本 sub-phase 验证 EM6**）
- 订阅机制（subscribe / getSnapshot / refreshSnapshot）

**验证**：单元测试或 console 临时诊断：
- 创建 folder A
- 创建 folder B (parent=A)
- listFolders 返回 2 个 + B.parentId === A.id
- deleteFolder(A) → cascade delete inFolder 边（B 变孤儿，parentId=null）

**EM6 验证**：deleteFolder 时检查 inFolder 边是否自动 cascade delete。若 SurrealDB Embedded EVENT 触发器不支持（按 surreal-schema.md §4.2 留 sub-phase 2 验证），实施者**停下汇报**，等设计师批复用应用层 cascade（capability 内手动删边）替代。

**commit**: `feat(L7-sub2-note-folder-migration step 5.4): folderCapability + EM6 cascade delete 验证`

### Step 5.5 — 实施 noteCapability

新建 `src/capabilities/note/index.ts` + `src/capabilities/note/derive-title.ts`，按 §3.4 实施。

`derive-title.ts` 实施：

```ts
import type { PmPayload } from '@/semantic/types';

export function deriveTitle(pmDoc: PmPayload): string {
  // PM doc root: { type: 'doc', content: [block...] }
  const firstBlock = pmDoc.content?.[0];
  if (!firstBlock) return '未命名';
  // 第一个 block 通常是 isTitle paragraph 或 普通 paragraph
  const text = extractInlineText(firstBlock);
  return text.trim() || '未命名';
}

function extractInlineText(node: PmPayload): string {
  if (node.type === 'text') return node.text ?? '';
  if (!node.content) return '';
  return node.content.map(extractInlineText).join('');
}
```

**验证**：单元测试 derive-title 函数 vs 几个典型 doc。

**commit**: `feat(L7-sub2-note-folder-migration step 5.5): noteCapability + deriveTitle`

### Step 5.6 — 改造 driver / capability 层消费方（4 个文件）

按 §4.3 改造：

- `src/drivers/text-editing-driver/blocks/note-link/node-view.ts`
- `src/drivers/text-editing-driver/blocks/note-link/spec.ts`
- `src/drivers/text-editing-driver/plugins/build-link-click-plugin.ts`
- `src/capabilities/shape-library/substances/registry.ts`
- `src/capabilities/text-editing/converters/atoms-to-pm.ts`

每处 `noteStore.get(id)` / `noteStore.getAll()` / 等改为 await noteCapability 对应方法。

**注意**：driver / capability 层可同步 await（不在 React 渲染路径）。

**commit**: `feat(L7-sub2-note-folder-migration step 5.6): driver/capability 层 noteStore 消费方迁移到 noteCapability`

### Step 5.7 — 改造 platform/main 进程消费方（1 个文件）

按 §4.3 改造 `src/platform/main/extraction/handlers.ts`：

main 进程可以直接 import noteCapability（capability 层允许跨进程调）—— 或如果 capability 在 renderer 端走 IPC，main 端按 Step 5.0 验证结果调整。

**commit**: `feat(L7-sub2-note-folder-migration step 5.7): platform/main 消费方迁移`

### Step 5.8 — 改造 view 层消费方（9 个文件）

按 §4.3 改造 views/note/* 全部文件。

**关键改造点**：

- **同步 useSyncExternalStore 改 async**：
  ```tsx
  // 旧
  const notes = useSyncExternalStore(noteStore.subscribe, noteStore.getAll);

  // 新(分两步:订阅 + async refresh)
  const notes = useSyncExternalStore(
    noteCapability.subscribe,
    () => noteCapability.getSnapshot(),  // 同步读 cached snapshot
  );
  useEffect(() => {
    noteCapability.refreshSnapshot();   // 启动时拉一次
  }, []);
  ```

- **创建笔记从同步变 async**：
  ```tsx
  // 旧
  const id = noteStore.create(emptyDoc, '未命名', folderId);

  // 新
  const note = await noteCapability.createNote(emptyDoc, folderId);
  ```

- **NoteView 加载笔记 async**：
  ```tsx
  const [activeNote, setActiveNote] = useState<NoteInfo | null>(null);
  useEffect(() => {
    if (activeNoteId) {
      noteCapability.getNote(activeNoteId).then(setActiveNote);
    }
  }, [activeNoteId]);
  ```

**commit**: `feat(L7-sub2-note-folder-migration step 5.8): view 层 noteStore/folderStore 消费方迁移`

### Step 5.9 — 删除 note-store.ts + folder-store.ts

```bash
rm src/views/note/note-store.ts
rm src/views/note/folder-store.ts
```

**验证**：`npx tsc --noEmit` 应无 import 错误（所有消费方已在 Step 5.6-5.8 改造完）。

**commit**: `chore(L7-sub2-note-folder-migration step 5.9): 删除 note-store.ts + folder-store.ts`

### Step 5.10 — typecheck + lint

```bash
npx tsc --noEmit
npx eslint src/
```

修复任何报错。

**commit**: `chore(L7-sub2-note-folder-migration step 5.10): typecheck + lint pass`

### Step 5.11 — npm start 集成验证

按 §6 测试清单跑：

1. 应用启动成功
2. 新建笔记 / 编辑文本 / 关闭应用 / 重启 → 笔记保留 ✓（验证持久化生效，解决"笔记找不到"bug）
3. 新建文件夹 / 嵌套 / 拖移笔记 → 树形正确
4. 删除文件夹 → 子项处置正确（cascade vs 移出）

**EM 验证**：
- EM5 崩溃率：连续操作 30+ 次（创建 / 编辑 / 删除）无崩溃
- EM6 cascade delete：步骤 5.4 已验证（如失败应已停下汇报）

**commit**: `chore(L7-sub2-note-folder-migration step 5.11): EM5/EM6 + 集成测试通过`

### Step 5.12 — 更新 README.md

更新 `src/capabilities/note/README.md` + `src/capabilities/folder/README.md`（新建）。

**commit**: `docs(L7-sub2-note-folder-migration step 5.12): capability README 更新`

### Step 5.13 — 完成报告

发消息：

```
L7-sub2-note-folder-migration 实施完成请审计

分支: feature/L7-sub2-note-folder-migration
共 X commits

测试报告:
- typecheck: ✓
- eslint: ✓ (1 pre-existing warning)
- §6.x 测试清单结果...
- EM5/EM6 验证结果...
- (含 step 5.0 IPC 设计采纳方案)

未实施部分:
- 其他业务 store 迁移 (sub-phase 3-4)

等审计师批复。
```

---

## 6. 测试清单

### 6.1 静态检查

| 序号 | 操作 | 期望 |
|---|---|---|
| 6.1.1 | `npx tsc --noEmit` | 0 errors |
| 6.1.2 | `npx eslint src/` | 0 errors（允许 1 pre-existing warning） |

### 6.2 业务功能（核心）

| 序号 | 操作 | 期望 |
|---|---|---|
| 6.2.1 | 启动应用 | 主窗口出现，console `[L0]-[L5] alive` 全出现 |
| 6.2.2 | 新建笔记 → 编辑标题 + 几段文字 → 关闭应用 → 重启 | 笔记内容保留 ✓ |
| 6.2.3 | 新建多个笔记 + 文件夹 → 关闭重启 | 全部保留 |
| 6.2.4 | 笔记拖移到 folder | 树形显示正确 |
| 6.2.5 | folder 嵌套（folder A → folder B） | 树形正确 |
| 6.2.6 | 删除 folder（含子项） | 删除行为符合 EM6 验证结果（cascade or 应用层 cascade） |

### 6.3 EM 验证

| 序号 | 操作 | 期望 |
|---|---|---|
| 6.3.1 | EM5 崩溃率：连续操作 30+ 次 | 0 次崩溃 |
| 6.3.2 | EM6 cascade delete | step 5.4 验证 |

### 6.4 反向 grep 验证

| 序号 | 操作 | 期望 |
|---|---|---|
| 6.4.1 | `grep -rn "@/storage" src/views/` | 0 处 |
| 6.4.2 | `grep -rn "noteStore\|note-store" src/` 在 src 内 | 仅在测试 / 注释 / capability 内部，无业务消费方残留 |
| 6.4.3 | `grep -rn "folderStore\|folder-store" src/` | 同上 |
| 6.4.4 | `git diff main --name-only` 应含 | `src/views/note/note-store.ts` 删除 + `src/views/note/folder-store.ts` 删除 |

### 6.5 测试报告模板

完整模板（参考 sub-phase 1 §6.8）。

---

## 7. 审计验收标准

### 7.1 代码合规审计

- commit 序列完整（约 12-14 个）
- view 层 0 处 import @/storage
- noteStore / folderStore 删除完成
- 14+ 文件 import 全部迁移

### 7.2 实施细节审计

- folder domain 加入 AtomPayloadOf<D>
- noteCapability 11 个方法（按 §3.4）+ folderCapability 7 个方法
- IPC 设计按 Step 5.0 采纳方案实施

### 7.3 行为审计

实测核心测试（启动 / 新建 / 重启 / 拖移 / 删除）通过。

### 7.4 通过后流程

合 main + push + 反向更新 decision 009 §3.1 sub-phase 2 标 ✅ 完成。

---

## 8. Open Questions

| 编号 | 问题 | 临时默认 / 应对 |
|---|---|---|
| Q1 | step 5.0 IPC 设计采纳 A/B/C 方案 | ✅ 实施采纳方案 A:capability 居 main + 业务级 IPC + preload bridge + renderer alias |
| Q2 | EM6 cascade delete 验证（SurrealDB EVENT 触发器） | ✅ sub-phase 1 storage 应用层 cascade 已落,本 sub-phase Path Y 删 folder UI 验证通过 |
| Q3 | noteCapability subscribe 机制粒度 | 暂全表订阅（任何变更通知全部 view），未来视性能加细粒度 |
| Q4 | title 派生性能 —— listNotes 时每个 note 都派生 title 是否慢？ | 1000 个以下笔记可接受（实测）。> 1000 时考虑物化视图（Phase N+） |
| Q5 | note-link plugin 当前用 noteStore 同步 `getNote(id)`，迁 async 后 PM nodeView 怎么处理？ | ✅ 设计师批复 L2:view 层私有 sync cache (`src/views/note/note-cache.ts`),订阅 `onListChanged` 增量更新 |
| Q6 | atom domain 注册表是否需要新加 'folder' 显式注册（vs 自动接受任意 string） | ✅ spec.md `AtomDomain = string` 开放注册,无需显式 register |
| Q7 | Path Y 删 folder 误删保护(确认弹窗 / 回收站) | 留 sub-phase 3+ 独立 decision,本 sub-phase Path Y 直删(对齐 macOS Finder)|
| **Q-tx** | **storage.transaction() 实际无真事务** | ✅ **已解决 sub-phase 3a-tx**([decision 020](020-sub-phase-3a-tx-true-atomicity.md),2026-05-13)— SDK 2.x `beginTransaction()` 原生支持真原子性,§3.5.bis binary verify + §7 故障注入 23 项 PASS,5 个调用站点透明受益。SDK 版本绑定纪律详 [SDK-version-binding-policy.md](../SDK-version-binding-policy.md)。 |

---

## 9. 决议链

### 9.1 与已 commit 规范文档的关系

- [`decision 008 §4.0`](008-storage-layer-interface.md) — view 不直连 storage 决议
- [`decision 009 §3.1`](009-migration-strategy.md) — sub-phase 2 范围
- [`decision 010`](010-multi-user-multi-device.md) — createdBy 默认 user-default
- [`atom-entity.md`](../atom-entity.md) — AtomEntity 实体壳
- [`atom/spec.md`](../../atom/spec.md) — folder 作为新 domain
- [`relations/spec.md`](../../relations/spec.md) — `user:krig:inFolder` 边定义
- [`surreal-schema.md`](../surreal-schema.md) — atom + edge 表 schema

### 9.2 设计纪律备忘

按 sub-phase 1 经验，本文档 SurrealQL / schema 操作**未在 binary 验证**。实施者执行 step 5.4 时如遇 SurrealDB 3.0.4 行为不一致**立即停下汇报**。

---

## 10. 反向更新清单（审计通过后做）

1. `decision 009 §3.1 sub-phase 2` 标 ✅ 完成 + commit hash
2. `decision 012` 顶部状态 → ✅ 已实施完成 + merge commit hash
3. `data-model/README.md` Phase N sub-phase 2 完成段
4. （视实施实际情况）反向更新 atom domain 列表加 `folder` 条目

---

## 11. 风险与回滚

### 11.1 风险

| 风险 | 概率 | 影响 |
|---|---|---|
| EM6 cascade delete 失败 | 中 | 降级应用层 cascade（capability 手动删边）|
| IPC 设计采纳后实施复杂度 | 中 | step 5.0 verify 后决议 |
| View 层 useSyncExternalStore async 改造引入 UI bug | 中 | step 5.8 谨慎实施，依赖 EM5 + 集成测试覆盖 |
| title 派生性能问题 | 低 | 实测验证，> 1000 笔记时启用物化视图 |

### 11.2 回滚

```bash
git checkout main
git branch -D feature/L7-sub2-note-folder-migration
```

main 不受影响。

---

## 附录 A — 与设计师对话的关键节点

| 节点 | 实施者动作 |
|---|---|
| Step 5.0 IPC 设计 verify | 停下汇报 sub-phase 1 实际架构，等设计师批复 A/B/C |
| Step 5.4 EM6 验证失败 | 停下汇报，等设计师批复降级方案 |
| 任何 SurrealQL / schema 行为偏离文档 | 停下汇报 |
| 14 个消费方改造期间发现额外消费点 | 停下汇报 |
| 完成 step 5.13 | 发"L7-sub2-note-folder-migration 实施完成请审计" + 测试报告 |

---

*Decision 012 完整版结束。预估实施工程量 3-5 天。*

---

## 12. 实施实际情况(2026-05-12 反向更新)

### 12.1 commits 序列(共 11 个)

| Step | Commit | 内容 |
|---|---|---|
| 5.2 | `9c5ae22` | semantic/types 加 folder domain + FolderPayload |
| 5.3 | `c5200a3` | clearLegacyLocalStorage 启动时清理 |
| 5.4 | `20d4eca` | folderCapability main 端 + IPC handlers (后于 5.8 fixup 为 Path Y) |
| 5.5 | `4b1f4c4` | noteCapability main 端 + deriveTitle + envelope wrap/unwrap |
| 5.5b | `e6245cb` | preload bridge + electron-api.d.ts + renderer alias |
| 5.6 | `b8d92d7` | driver/capability 层 5 文件注释更新 |
| 5.7 | `9220286` | platform/main extraction 注释更新 |
| 5.8 | `d68d7ff` | view 层 17 文件迁移 (§4.3 原列 14 + 补入 3) + Step 5.4 Path Y fixup |
| 5.9 | `cc4573f` | 删除 note-store.ts + folder-store.ts |
| 5.12 | `8b766f5` | capability DESIGN 文档 |
| 5.11* | `7d828a6` | **fix: storage.transaction 退化为无事务直调 (X3a)** — 集成测试暴露 |

### 12.2 与原文档的偏离登记

#### 偏离 1: §4.3 消费方清单从 14 扩到 17

**原文档**: 列 14 个文件
**实际**: 17 个文件

**补入的 3 个**:
- `src/views/note/link-panel/LinkPanel.tsx` — 实施者发现的额外 import
- `src/views/note/note-link-search/NoteLinkSearchPanel.tsx` — 实施者发现的额外 import
- `src/views/note/note-commands.ts` — `data-model.ts` 改 async 的连锁反应,5 处 commandRegistry caller 用 `void (async => {})()` 包装

**根因**: 设计师初始 grep 只覆盖直接 `noteStore` import,漏了传递依赖(data-model 改 async → 调用方需 await/包装)。

**未来 sub-phase 模板教训**: §4.3 消费方 grep 必须追传递依赖,不仅是直接 import。

#### 偏离 2: §3.4 createNote payload 形态(路径 Y)

**原文档**: `payload.payload = { type: 'doc', content: [...] }` (裸 PmPayload)
**实际**: atom 存裸 PmPayload + capability 边界 wrap/unwrap DriverSerialized 信封

**位置**: `src/platform/main/note/envelope.ts` (wrap/unwrap),`src/platform/main/note/capability-impl.ts` (转换边界)

**根因**: V2 既有 noteStore 用 DriverSerialized 信封,view↔capability 接口必须保留信封;atom 层保持框架无关性(Phase 1 规范)。

#### 偏离 3: §3.5 订阅机制(L2 view 层 sync cache)

**原文档**: capability 层维护 cache + subscribe/getSnapshot/refreshSnapshot 三件套(useSyncExternalStore 兼容)
**实际**: 
- capability 层仅 async + `onListChanged` 推送(纯 async)
- view 层私有 sync cache(`src/views/note/note-cache.ts`)给 driver `resolveNoteTitle` 守约
- React 组件用 hooks(`src/views/note/use-notes-folders.ts` 的 `useAllNotes` / `useAllFolders`)拿数据

**根因**: 设计师批复 L2 — driver plugin handler sync 约束是 driver 层需求,不应污染 capability 层"全 async"惯例(V2 ebook/learning capability 已 verify 此惯例)。

#### 偏离 4: §3.4 deleteFolder 业务契约(Path Y)

**原文档**: 未明确定义,V1/V2 现状是"删 folder + 子 folder,内含笔记移到根级"
**实际**: Path Y — 删 folder 递归删子 folder + 内含所有笔记(对齐 macOS Finder)

**位置**: `src/platform/main/folder/capability-impl.ts:142-220` `deleteFolder` + `collectFolderSubtree` + `collectNotesInFolders`

**风险登记**: 误删 folder = 丢笔记。配套保护(确认弹窗 / 回收站)留 sub-phase 3+(Q7)。

#### 偏离 5: Step 5.4 EM6 验证时机

**原文档**: Step 5.4 验证 SurrealDB EVENT 触发器 cascade delete
**实际**: sub-phase 1 storage 应用层 cascade 已落,EM6 EVENT 触发器验证被吸收。本 sub-phase Step 5.11 UI 集成测试验证应用层 cascade 行为(Path Y 删 folder 后无幽灵 inFolder 边)。

#### 偏离 6 (X3a 集成测试暴露): storage.transaction() 退化

**问题**: SurrealDB Sidecar WebSocket 协议下,`BEGIN/COMMIT` 必须聚合在单段 SQL 内,跨 `db.query()` 拆开发送 → BEGIN 立即被隐式提交 → COMMIT 报 `Cannot COMMIT without starting a transaction`。

**触发**: sub-phase 1 测试路径全是单语句,未走 transaction()。sub-phase 2 `createNote/createFolder/moveNote/moveFolder/deleteFolder` 首次走 transaction,集成测试暴露(commit `7d828a6` 修)。

**修复(X3a 用户拍板)**: `transaction(fn)` 退化为直调 `fn`,无原子性。

**后果**: 单机单用户场景并发概率极低,业务可接受。

**~~遗留~~**: ~~Q-tx 留 sub-phase 3+ 评估 SDK 原生 transaction API 或应用层补偿模式。~~ ✅ **已解决 sub-phase 3a-tx** ([decision 020](020-sub-phase-3a-tx-true-atomicity.md),2026-05-13)— 走 SDK 2.x `beginTransaction()` 原生路径,binary verify + 故障注入测试全 PASS。

### 12.3 §6.2 UI 集成测试结果

| 序号 | 操作 | 结果 |
|---|---|---|
| 6.2.1 | 启动应用 | ✅ 通过 — `[storage] initialized` + `[L0-L5] alive` 全齐 |
| 6.2.2 | 持久化核心(创建 → 关闭重启 → 内容保留) | ✅ 通过 |
| 6.2.3 | 多笔记 + 文件夹持久化 | ✅ 通过 |
| 6.2.4 | 笔记拖移到 folder | ✅ 通过 |
| 6.2.5 | folder 嵌套 | ✅ 通过 |
| 6.2.6 | Path Y 删 folder 递归 | ✅ 通过 — folder X / folder Y / note D / note E 全消失 |
| 6.2.7 | 跨 view 广播 | ✅ 通过 |

EM5(连续 30+ 操作无崩溃)+ EM6(cascade)随核心测试一并通过。

### 12.4 审计结论

**代码层**: 静态校验全通过(typecheck 0 error / lint 0 error / view 0 直引 storage / 17 文件迁移完整 / noteStore + folderStore 已删)。

**行为层**: §6.2 UI 集成测试全通过(含 X3a 修复后)。

**审计判定**: ✅ **通过**,可合 main。

### 12.5 后续 sub-phase 反向扩展(2026-05-12 由 sub-phase 3a-1 触发)

sub-phase 3a-1 实施时发现 **sub-phase 2 `deleteFolder` cascade scope 不支持 graph-canvas**(原 `collectNotesInFolders` 字面只 cascade `payload.domain === 'pm'`),需要扩展白名单支持 graph-canvas。

**反向扩展内容**:
- `collectNotesInFolders` → `collectResourcesInFolders`(函数 + 内部变量改名)
- 判断条件 `payload.domain === 'pm'` → `['pm', 'graph-canvas'].includes(domain)`
- 返回字段 `deletedNotes` → `deletedResources`(类型扩展,语义不变)
- 实施 commit: `5764aab` (sub-phase 3a-1 step 5.6.bis)

**纪律登记**:
- 主对话设计师**未在 sub-phase 2 实施时预留扩展点**,sub-phase 3a-1 实施时被迫扩展(违反 sub-phase 3a-1 §0.2.7 字面"不动 folder 模块",但符合实质"不改 Path Y 语义契约")
- 详 decision 014 §12.2 偏离 5 + decision 013 §0.5 设计师纪律第 4 次累积
- 未来 sub-phase 3b ebook 接入时,白名单加 `'ebook'`(每加一个内容 domain,显式约束)

**对 sub-phase 2 测试结果的影响**: 无。原 §6.2.6 Path Y 测试场景行为不变(folder 内含 note 全部清),只是扩展后多支持 folder 内含 graph-canvas 的 cascade。

### 12.6 后续 sub-phase 反向扩展 — note 形态升级(2026-05-13 由 sub-phase 3a-2.5 触发)

sub-phase 2 字面拍板 "**pm atom = note**"(本决议 §3.2 路径 Y);sub-phase 3a-1 引入 graph text-node 也走 pm atom domain(decision 014 §3.4)+ `hasContent` 边,**pm domain 不再唯一对应 note** — 但 sub-phase 3a-1 实施时未改 noteCapability,导致 `listNotes()` 字面 `storage.listAtoms({ domain: 'pm' })` 误列 graph text-node 内容(P0d binary verify 2026-05-13 期间用户截图实证 `"123-abc*abc"` 误列)。

**修复**:[decision 016](016-sub-phase-3a-2.5-note-form-upgrade.md) sub-phase 3a-2.5 — note 形态从 "pm atom = note" 升级到 "**pm atom + `user:krig:hasNoteView` 边 = note**"。

**形态对比**:

```
sub-phase 2(本决议):
  note         = pm atom (domain='pm')
  listNotes()  = listAtoms({ domain:'pm' })

sub-phase 3a-1(P0d 落地后):
  note         = pm atom (domain='pm')
  graph text   = pm atom (domain='pm') + hasContent 边
  listNotes()  = listAtoms({ domain:'pm' })  ← bug:误列 graph text-node

sub-phase 3a-2.5(本扩展):
  note         = pm atom (domain='pm') + hasNoteView 边 (subject=该 atom)
  graph text   = pm atom (domain='pm') + hasContent 边 (subject=graph-instance)
  listNotes()  = listEdges({ predicate:'user:krig:hasNoteView' }) → getAtom 批读
                 ← 严格区分,完全隔离
```

**实施 commits**(详 [decision 016 §12.1](016-sub-phase-3a-2.5-note-form-upgrade.md)):
- `21ac1d2` Step 5.2:注册 hasNoteView 边类型
- `56a8304` Step 5.3:schema 1.2.0 migration 给现有 pm atom 加 hasNoteView 边(幂等)
- `535ca2e` Step 5.4:noteCapability 4 函数改造(createNote/listNotes/getNote/deleteNote)
- `f145384` Step 5.7:DESIGN.md v0.1 → v0.2 形态升级文档化

**对 sub-phase 2 测试结果的影响**: 无。

- §6.2 全部 8 场景行为不变(create / list / get / delete / move 等 API 字面契约保留)
- atom payload 形态完全不变(payload domain='pm' + payload=PmPayload)
- view ↔ capability 边界 NoteInfo 字面不变
- 新增的是 atom 之外的边(hasNoteView 边),独立于 atom 本体

**纪律登记**:

- 主对话设计师**未在 sub-phase 2 实施时预留 "未来 pm atom 可能被多 view 复用" 的扩展点**;sub-phase 3a-1 引入 graph text-node 时直接复用 pm domain 未升级 noteCapability,P0d binary verify 期间被用户截图实证发现 listNotes 误列 bug
- decision 013 §3.5.1.bis 单引用约束已字面预告 "未来 pm atom 跨 view 复用",但 sub-phase 3a-1 实施时没同步落地 hasNoteView 边
- sub-phase 3a-2.5 设计 hasNoteView 边时已显式预留 "未来 pm atom 多 view 复用"(decision 016 §3.2),不再重复此错

