# S3-b 执行 Prompt — Workspace 持久化从 JSON 文件迁 SurrealDB

## 背景与目标

S3-a 建立了楼长 API（主进程管理 ws 生命周期），持久化暂时走 `userData/workspace-state.json`。
S3-b 把持久化换成 SurrealDB（主进程可直接 import `@storage/index`，sidecar 跑在同进程），并做首次启动迁移（把 JSON 文件的已有数据搬进 DB）。

**目标**：
1. 新建 `workspace` 表（schema 1.7.0）
2. `workspace-manager-main.ts` 持久化从 JSON 文件换成 SurrealDB
3. migration_1_7_0：把现有 JSON 文件内容迁入 workspace 表，然后删 JSON 文件
4. 注册迁移到 runner

**不碰**：
- IPC 层（workspace-handler.ts）接口不变
- renderer/use-workspace.ts 不变
- `WorkspaceManagerState` / `WorkspaceState` 类型不变

---

## 一、schema 1.7.0 — workspace 表

**文件**：`src/storage/surreal/schema.ts`

在文件末尾（`migration_1_2_0` 函数之后）追加：

```typescript
/**
 * 1.7.0 schema — workspace 表（S3-b：楼长持久化迁 SurrealDB）
 *
 * workspace 是 Electron 运行态（workspace bar 状态），不是知识图谱语义层，
 * 独立表隔离，不污染 atom/edge 图谱查询。
 *
 * 一行 = 整个 WorkspaceManagerState（单记录快照模式，id 固定为 'current'）：
 * - workspaces: array of WorkspaceState（所有已知 ws）
 * - activeId: string | null
 * - counter: number（自增 id 种子）
 *
 * 选择单记录快照而非逐 ws 行：
 * - ws 数量极少（典型 1-5 个），无需索引查询
 * - 整体原子替换比逐行 upsert 简单，避免孤儿行
 * - 和 JSON 文件语义一比一对齐
 */
const SCHEMA_VERSION_1_7_0 = `
DEFINE TABLE IF NOT EXISTS workspace SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS workspaces ON workspace TYPE array;
DEFINE FIELD IF NOT EXISTS activeId ON workspace TYPE option<string>;
DEFINE FIELD IF NOT EXISTS counter ON workspace TYPE int;
`;

export async function migration_1_7_0(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_7_0);

  const now = Date.now();
  await db.query(
    `UPSERT $rid SET
      version = '1.7.0',
      appliedAt = $now,
      description = 'Add workspace table (S3-b landlord persistence in SurrealDB)'`,
    { rid: new RecordId('schema_version', '1.7.0'), now },
  );
}
```

---

## 二、改 runner.ts — 注册 1.7.0

**文件**：`src/storage/migrations/runner.ts`

1. import 里加 `migration_1_7_0`：
```typescript
import { initSchema, migration_1_1_0, migration_1_2_0, migration_1_3_0,
  migration_1_4_0, migration_1_5_0, migration_1_6_0, migration_1_7_0 } from '../surreal/schema';
```

2. `MIGRATIONS` 数组末尾追加：
```typescript
  {
    version: '1.7.0',
    description: 'Add workspace table (S3-b landlord persistence in SurrealDB)',
    up: migration_1_7_0,
  },
```

---

## 三、迁移脚本 — JSON → SurrealDB（首次启动自动跑）

**新文件**：`src/storage/migrations/073-workspace-json-to-surreal.ts`

> 命名规则沿用现有 `028-block-structure-attrs.ts` 风格（按业务版本编号，非 schema 版本）。

```typescript
/**
 * 迁移 073：Workspace JSON → SurrealDB（S3-b）
 *
 * 首次启动检查 userData/workspace-state.json 是否存在：
 * - 存在：把内容写进 workspace 表（UPSERT rid='current'），然后删 JSON 文件
 * - 不存在：跳过（首次安装，workspace-manager-main 会在 initWorkspaceManager 里
 *           按正常逻辑从 DB 加载，DB 为空则 ensureMinimum 新建默认 ws）
 *
 * 幂等：JSON 文件删除后再启动跳过；workspace 表 UPSERT 重复执行无副作用。
 */

import path from 'node:path';
import fs from 'node:fs';
import { app } from 'electron';
import { RecordId } from 'surrealdb';
import { getDB } from '@storage/surreal/client';
import type { WorkspaceManagerState } from '@workspace/workspace-state/workspace-state';

const MIGRATION_KEY = 'workspace_json_to_surreal_done';
const WS_RECORD_ID = new RecordId('workspace', 'current');

export async function runMigration073IfNeeded(): Promise<void> {
  const jsonPath = path.join(app.getPath('userData'), 'workspace-state.json');

  if (!fs.existsSync(jsonPath)) {
    // JSON 已删或从未存在，跳过
    return;
  }

  let state: WorkspaceManagerState;
  try {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    state = JSON.parse(raw) as WorkspaceManagerState;
  } catch (err) {
    console.warn('[migration073] workspace-state.json parse failed, skipping:', err);
    return;
  }

  const db = getDB();
  const now = Date.now();
  await db.query(
    `UPSERT $rid SET workspaces = $workspaces, activeId = $activeId, counter = $counter`,
    {
      rid: WS_RECORD_ID,
      workspaces: state.workspaces,
      activeId: state.activeId,
      counter: state.counter,
    },
  );

  // 迁移成功后删 JSON 文件（避免下次启动重复迁入）
  try {
    fs.unlinkSync(jsonPath);
    console.log('[migration073] workspace-state.json migrated to SurrealDB and deleted');
  } catch (err) {
    console.warn('[migration073] failed to delete workspace-state.json:', err);
    // 不阻塞启动，下次启动会再 UPSERT 一次（幂等）
  }
}
```

---

## 四、改 workspace-manager-main.ts — 持久化换 SurrealDB

**文件**：`src/platform/main/workspace/workspace-manager-main.ts`

### 4-1 删 JSON 文件相关代码

删掉以下三个函数（`getStatePath` / `loadState` / `saveState`）和它们用到的 `path` / `fs` import：

```typescript
// 删除这些 import
import path from 'node:path';
import fs from 'node:fs';

// 删除这三个函数
function getStatePath(): string { ... }
function loadState(): WorkspaceManagerState | null { ... }
function saveState(state: WorkspaceManagerState): void { ... }
```

### 4-2 加 SurrealDB 依赖

```typescript
import { RecordId } from 'surrealdb';
import { getDB } from '@storage/surreal/client';
```

### 4-3 改 broadcast()：异步保存到 SurrealDB

```typescript
// 改前
function broadcast(): void {
  const state = getFullState();
  saveState(state);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.WORKSPACE_STATE_CHANGED, state);
    }
  }
}

// 改后（broadcast 改为 async，持久化异步，广播仍同步）
async function broadcast(): Promise<void> {
  const state = getFullState();
  // 持久化（异步，不阻塞广播）
  void persistState(state);
  // 广播（同步）
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.WORKSPACE_STATE_CHANGED, state);
    }
  }
}

async function persistState(state: WorkspaceManagerState): Promise<void> {
  try {
    const db = getDB();
    await db.query(
      `UPSERT $rid SET workspaces = $workspaces, activeId = $activeId, counter = $counter`,
      {
        rid: new RecordId('workspace', 'current'),
        workspaces: state.workspaces,
        activeId: state.activeId,
        counter: state.counter,
      },
    );
  } catch (err) {
    console.error('[workspace-manager-main] persistState failed:', err);
  }
}
```

> 注意：broadcast 改 async 后，调用方不需要 await——广播是"发完即忘"语义，持久化失败只 log，不阻断用户操作。

### 4-4 改 initWorkspaceManager()：从 SurrealDB 加载

```typescript
export async function initWorkspaceManager(): Promise<void> {
  const saved = await loadStateFromDB();
  if (saved) {
    saved.workspaces.forEach((ws) =>
      workspaces.set(ws.id, { ...ws, isOpen: ws.isOpen ?? true }),
    );
    activeId = saved.activeId;
    counter = saved.counter;
  }
  ensureMinimum();
}

async function loadStateFromDB(): Promise<WorkspaceManagerState | null> {
  try {
    const db = getDB();
    const result = await db.query<[Array<WorkspaceManagerState>]>(
      `SELECT * FROM $rid LIMIT 1`,
      { rid: new RecordId('workspace', 'current') },
    );
    return result[0]?.[0] ?? null;
  } catch (err) {
    console.warn('[workspace-manager-main] loadStateFromDB failed:', err);
    return null;
  }
}
```

> `initWorkspaceManager` 签名从 `(): void` 改为 `(): Promise<void>`。
> 调用方 `src/platform/main/index.ts` 已有 await，无需其他改动。

### 4-5 检查 wsCreate 中的 broadcast 调用

`broadcast()` 改为 async 后，所有调用处加 `void`（fire-and-forget，不 await）：

```typescript
// wsCreate
workspaces.set(id, ws);
void broadcast();   // 加 void

// wsClose
workspaces.set(id, { ...ws, isOpen: false });
if (activeId === id) activateAnotherOpen();
void broadcast();

// wsRemove
workspaces.delete(id);
if (activeId === id) activateAnotherOpen();
void broadcast();

// wsOpen
workspaces.set(id, { ...ws, isOpen: true });
void broadcast();

// wsRename
workspaces.set(id, { ...ws, label, customLabel: true });
void broadcast();

// wsSetActive
activeId = id;
void broadcast();
```

---

## 五、注册 migration073 到 main/index.ts

**文件**：`src/platform/main/index.ts`

在现有 migration imports 下面加一行：
```typescript
import { runMigration073IfNeeded } from '@storage/migrations/073-workspace-json-to-surreal';
```

在 `initStorage()` 调用完之后、`initWorkspaceManager()` 调用之前，插入：
```typescript
await runMigration073IfNeeded();
```

---

## 验收标准

```bash
# 1. workspace-manager-main.ts 不再有 JSON 文件操作
grep -n "readFileSync\|writeFileSync\|workspace-state.json\|getStatePath\|loadState\b\|saveState\b" \
  src/platform/main/workspace/workspace-manager-main.ts
# 期望：0 行

# 2. workspace-manager-main.ts 有 SurrealDB 调用
grep -n "getDB\|RecordId\|workspace.*current" \
  src/platform/main/workspace/workspace-manager-main.ts
# 期望：有行

# 3. schema.ts 有 1.7.0
grep -n "1.7.0\|workspace.*SCHEMAFULL" src/storage/surreal/schema.ts
# 期望：有行

# 4. runner.ts 注册了 1.7.0
grep -n "1.7.0" src/storage/migrations/runner.ts
# 期望：有行

# 5. migration073 文件存在
ls src/storage/migrations/073-workspace-json-to-surreal.ts && echo "OK"

# 6. tsc 编译通过
npx tsc --noEmit
```

---

## 注意事项

1. **`initWorkspaceManager` 必须在 `initStorage` 之后调用**（DB 必须已 ready），`main/index.ts` 现有顺序已满足，不要改顺序。
2. **migration073 必须在 `initStorage`（schema 1.7.0 建表）之后、`initWorkspaceManager`（从 DB 读）之前**——顺序必须是：initStorage → migration073 → initWorkspaceManager。
3. **`broadcast` 改 async 但调用方用 `void`**：wsCreate/wsClose/wsRemove/wsOpen/wsRename/wsSetActive 都是同步函数，broadcast fire-and-forget 即可，不阻塞用户操作。
4. **`ensureMinimum` 内部调用 `wsCreate`**，wsCreate 里调 `void broadcast()`，链路都是 void，不需要改 ensureMinimum 签名。
5. **DB 冷启动 workspace 为空**（从未有 JSON 文件的新安装）：loadStateFromDB 返回 null → ensureMinimum 新建默认 ws → `void broadcast()` 异步写入 DB，无问题。
6. commit 消息末尾加：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
