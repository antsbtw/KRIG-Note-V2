# S3-a 执行 Prompt — 楼长 API 上移主进程（IPC 化）

## 背景与目标

这是多窗口架构治理 step2 核心改动（S3-a）。

**目标**：把 workspaceManager 的「楼长 API」（create/close/remove/open/rename/setActive，以及 getAll/getOpen/activeId 的状态读取）从 renderer 进程上移到主进程，renderer 通过 IPC 委托执行、订阅广播获取状态。

**为什么这样做**：多窗口下每个 renderer 进程各有一份 workspaceManager 单例，互相独立——A 窗口 create() 出来的 ws，B 窗口不知道。楼长必须住在主进程这个唯一协调中枢。

**范围**：
- 新增：主进程楼长、IPC handler、channel 常量、preload 暴露
- 修改：renderer 侧的 hook（use-workspace.ts）+ UI 调用点（WorkspaceTab / AddWorkspaceButton / nav-side-content）
- **不改**：WorkspaceContainer / WorkspaceInstance / WorkspaceBar 的渲染结构（S4 负责）
- **不改**：storage.ts、SurrealDB schema（S3-b 负责）

**持久化过渡方案**：主进程楼长仍用 localStorage 读写（通过 Electron `session` 或启动时从 renderer 拉一次），S3-b 再换 DB。最简方案：**主进程楼长持久化走独立的 JSON 文件**（用 Node.js fs 读写，完全绕开 localStorage 的 renderer-only 限制，且比 DB 简单）。

---

## 一、新增 IPC Channel 常量

**文件**：`src/shared/ipc/channel-names.ts`

在 `IPC_CHANNELS` 对象末尾追加：

```typescript
// ── Workspace 楼长 IPC（S3-a，多窗口）──
// renderer → main（invoke，请求-响应）
WORKSPACE_CREATE:       'workspace.create',
WORKSPACE_CLOSE:        'workspace.close',
WORKSPACE_REMOVE:       'workspace.remove',
WORKSPACE_OPEN:         'workspace.open',
WORKSPACE_RENAME:       'workspace.rename',
WORKSPACE_SET_ACTIVE:   'workspace.set-active',
WORKSPACE_GET_STATE:    'workspace.get-state',
// main → renderer（on，广播）
WORKSPACE_STATE_CHANGED: 'workspace.state-changed',
```

---

## 二、新增主进程楼长

**新建文件**：`src/platform/main/workspace/workspace-manager-main.ts`

这是主进程侧的楼长，维护权威注册表 + 持久化。

```typescript
/**
 * 主进程楼长 —— WorkspaceManager 主进程侧
 *
 * 职责：ws 的生老病死（create/close/remove/open/rename/setActive）。
 * 持久化：JSON 文件（userData 目录下 workspace-state.json），绕开 localStorage renderer-only 限制。
 * 广播：状态变化后向所有 renderer 窗口广播 WORKSPACE_STATE_CHANGED。
 *
 * S3-b 时换成 SurrealDB 持久化，接口不变。
 */

import path from 'node:path';
import fs from 'node:fs';
import { app, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import {
  createDefaultWorkspaceState,
} from '@workspace/workspace-state/default-state';
import type { WorkspaceState, WorkspaceManagerState } from '@workspace/workspace-state/workspace-state';

// ── 持久化（JSON 文件）──────────────────────────────────────────

function getStatePath(): string {
  return path.join(app.getPath('userData'), 'workspace-state.json');
}

function loadState(): WorkspaceManagerState | null {
  try {
    const raw = fs.readFileSync(getStatePath(), 'utf-8');
    return JSON.parse(raw) as WorkspaceManagerState;
  } catch {
    return null;
  }
}

function saveState(state: WorkspaceManagerState): void {
  try {
    fs.writeFileSync(getStatePath(), JSON.stringify(state), 'utf-8');
  } catch (err) {
    console.error('[workspace-manager-main] saveState failed', err);
  }
}

// ── 状态 ────────────────────────────────────────────────────────

let workspaces = new Map<string, WorkspaceState>();
let activeId: string | null = null;
let counter = 0;

// ── 广播 ────────────────────────────────────────────────────────

function broadcast(): void {
  const state = getFullState();
  saveState(state);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.WORKSPACE_STATE_CHANGED, state);
    }
  }
}

// ── 公共 API ────────────────────────────────────────────────────

export function getFullState(): WorkspaceManagerState {
  return {
    workspaces: Array.from(workspaces.values()),
    activeId,
    counter,
  };
}

export function initWorkspaceManager(): void {
  const saved = loadState();
  if (saved) {
    saved.workspaces.forEach((ws) =>
      workspaces.set(ws.id, { ...ws, isOpen: ws.isOpen ?? true }),
    );
    activeId = saved.activeId;
    counter = saved.counter;
  }
  ensureMinimum();
}

export function wsCreate(label?: string): WorkspaceState {
  const id = `ws-${++counter}`;
  const ws = createDefaultWorkspaceState(id, label ?? `Workspace ${counter}`, !!label);
  workspaces.set(id, ws);
  broadcast();
  return ws;
}

export function wsClose(id: string): void {
  const ws = workspaces.get(id);
  if (!ws || !ws.isOpen) return;
  workspaces.set(id, { ...ws, isOpen: false });
  if (activeId === id) activateAnotherOpen();
  broadcast();
}

export function wsRemove(id: string): void {
  if (!workspaces.has(id)) return;
  workspaces.delete(id);
  if (activeId === id) activateAnotherOpen();
  broadcast();
}

export function wsOpen(id: string): void {
  const ws = workspaces.get(id);
  if (!ws || ws.isOpen) return;
  workspaces.set(id, { ...ws, isOpen: true });
  broadcast();
}

export function wsRename(id: string, label: string): void {
  const ws = workspaces.get(id);
  if (!ws) return;
  workspaces.set(id, { ...ws, label, customLabel: true });
  broadcast();
}

export function wsSetActive(id: string): void {
  if (!workspaces.has(id)) return;
  activeId = id;
  broadcast();
}

// ── 内部工具 ────────────────────────────────────────────────────

function activateAnotherOpen(): void {
  const open = Array.from(workspaces.values()).filter((w) => w.isOpen);
  if (open.length > 0) {
    activeId = open[open.length - 1].id;
  } else if (workspaces.size > 0) {
    // 全收起了，打开第一个
    const first = Array.from(workspaces.values())[0];
    workspaces.set(first.id, { ...first, isOpen: true });
    activeId = first.id;
  } else {
    // 全删了，新建一个
    wsCreate();
  }
}

function ensureMinimum(): void {
  if (workspaces.size === 0) {
    const ws = wsCreate();
    activeId = ws.id;
    return;
  }
  const open = Array.from(workspaces.values()).filter((w) => w.isOpen);
  if (open.length === 0) {
    const first = Array.from(workspaces.values())[0];
    workspaces.set(first.id, { ...first, isOpen: true });
    activeId = first.id;
  } else if (!activeId || !workspaces.get(activeId)?.isOpen) {
    activeId = open[0].id;
  }
}
```

---

## 三、新增 IPC Handler

**新建文件**：`src/platform/main/ipc/workspace-handler.ts`

```typescript
/**
 * Workspace 楼长 IPC handlers（S3-a）
 *
 * renderer 通过 invoke 委托楼长操作；main 执行后广播 state-changed 给所有 renderer。
 */

import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import {
  wsCreate,
  wsClose,
  wsRemove,
  wsOpen,
  wsRename,
  wsSetActive,
  getFullState,
} from '../workspace/workspace-manager-main';

export function registerWorkspaceHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_CREATE, (_event, label?: string) => {
    return wsCreate(label);
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_CLOSE, (_event, id: string) => {
    wsClose(id);
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_REMOVE, (_event, id: string) => {
    wsRemove(id);
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_OPEN, (_event, id: string) => {
    wsOpen(id);
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_RENAME, (_event, id: string, label: string) => {
    wsRename(id, label);
  });

  ipcMain.handle(IPC_CHANNELS.WORKSPACE_SET_ACTIVE, (_event, id: string) => {
    wsSetActive(id);
  });

  // renderer 启动时拉一次全量状态
  ipcMain.handle(IPC_CHANNELS.WORKSPACE_GET_STATE, () => {
    return getFullState();
  });
}
```

**注册到 IPC 总线**：在 `src/platform/main/ipc/ipc-bus.ts` 的 `initIpcBus()` 函数末尾追加：

```typescript
import { registerWorkspaceHandlers } from './workspace-handler';
// ...
export function initIpcBus(): void {
  // ...现有注册...
  registerWorkspaceHandlers();  // ← 追加这行
}
```

**初始化楼长**：在 `src/platform/main/index.ts`（主进程入口）的 `app.whenReady()` 里，`initIpcBus()` 调用之前或之后，加：

```typescript
import { initWorkspaceManager } from './workspace/workspace-manager-main';
// ...
app.whenReady().then(async () => {
  initWorkspaceManager();  // ← 主进程楼长初始化
  initIpcBus();
  // ...
});
```

先 grep 确认 `initIpcBus` 在 index.ts 的实际调用位置：
```bash
grep -n "initIpcBus\|whenReady" src/platform/main/index.ts | head -10
```

---

## 四、扩展 Preload

**文件**：`src/platform/main/preload/main-window-preload.ts`

在 `contextBridge.exposeInMainWorld('electronAPI', { ... })` 的对象里追加 workspace 方法组（参照 noteList/noteCreate 等现有 invoke 模式）：

```typescript
// ── Workspace 楼长 IPC（S3-a）──
workspaceCreate(label?: string): Promise<WorkspaceState> {
  return ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_CREATE, label);
},
workspaceClose(id: string): Promise<void> {
  return ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_CLOSE, id);
},
workspaceRemove(id: string): Promise<void> {
  return ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_REMOVE, id);
},
workspaceOpen(id: string): Promise<void> {
  return ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_OPEN, id);
},
workspaceRename(id: string, label: string): Promise<void> {
  return ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_RENAME, id, label);
},
workspaceSetActive(id: string): Promise<void> {
  return ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_SET_ACTIVE, id);
},
workspaceGetState(): Promise<WorkspaceManagerState> {
  return ipcRenderer.invoke(IPC_CHANNELS.WORKSPACE_GET_STATE);
},
/** main → renderer 广播：ws 状态变化（create/close/remove/open/rename/setActive 后）*/
onWorkspaceStateChanged(callback: (state: WorkspaceManagerState) => void): () => void {
  const handler = (_event: unknown, state: WorkspaceManagerState) => callback(state);
  ipcRenderer.on(IPC_CHANNELS.WORKSPACE_STATE_CHANGED, handler);
  return () => ipcRenderer.off(IPC_CHANNELS.WORKSPACE_STATE_CHANGED, handler);
},
```

**注意**：preload 是纯类型文件，`WorkspaceState` / `WorkspaceManagerState` 需要 import（或 inline 写 as unknown 再让调用方 cast）。参照现有做法，preload 里其他 Promise<unknown> 返回类型的处理方式——若现有 API 都返回 `Promise<unknown>`，workspace 系列也返回 `Promise<unknown>`，由 renderer 侧 cast。

---

## 五、新增 Renderer 侧 IPC 桥

**新建文件**：`src/workspace/ipc/workspace-ipc.ts`

封装 renderer 侧对 workspaceManager IPC 的调用，调用方不直接写 `window.electronAPI`：

```typescript
/**
 * Renderer 侧 workspace IPC 桥（S3-a）
 *
 * 封装 electronAPI.workspace* 调用，提供类型安全接口。
 * 调用方：use-workspace-ipc.ts（hook）、WorkspaceTab、AddWorkspaceButton、nav-side-content
 */

import type { WorkspaceState, WorkspaceManagerState } from '../workspace-state/workspace-state';

const api = () => window.electronAPI;

export function ipcWorkspaceCreate(label?: string): Promise<WorkspaceState> {
  return api().workspaceCreate(label) as Promise<WorkspaceState>;
}
export function ipcWorkspaceClose(id: string): Promise<void> {
  return api().workspaceClose(id) as Promise<void>;
}
export function ipcWorkspaceRemove(id: string): Promise<void> {
  return api().workspaceRemove(id) as Promise<void>;
}
export function ipcWorkspaceOpen(id: string): Promise<void> {
  return api().workspaceOpen(id) as Promise<void>;
}
export function ipcWorkspaceRename(id: string, label: string): Promise<void> {
  return api().workspaceRename(id, label) as Promise<void>;
}
export function ipcWorkspaceSetActive(id: string): Promise<void> {
  return api().workspaceSetActive(id) as Promise<void>;
}
export function ipcWorkspaceGetState(): Promise<WorkspaceManagerState> {
  return api().workspaceGetState() as Promise<WorkspaceManagerState>;
}
export function onWorkspaceStateChanged(
  callback: (state: WorkspaceManagerState) => void,
): () => void {
  return api().onWorkspaceStateChanged(callback);
}
```

---

## 六、改造 Renderer 侧 Hook

**文件**：`src/workspace/workspace-instance/use-workspace.ts`

现状是直接订阅 `workspaceManager`（renderer 本地单例）。改为：
1. 模块级维护一份从主进程同步过来的状态快照
2. 订阅 IPC 广播更新快照
3. hook 订阅快照变化而非 workspaceManager

```typescript
/**
 * useWorkspace hooks（S3-a 改造）
 *
 * 状态来源：主进程广播的 WorkspaceManagerState 快照（不再直接读 workspaceManager）。
 */

import { useSyncExternalStore } from 'react';
import { onWorkspaceStateChanged, ipcWorkspaceGetState } from '../ipc/workspace-ipc';
import type { WorkspaceState, WorkspaceManagerState } from '../workspace-state/workspace-state';

// ── 模块级快照 ──────────────────────────────────────────────────

let snapshot: WorkspaceManagerState = { workspaces: [], activeId: null, counter: 0 };
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// 订阅主进程广播（模块加载时一次，全局单次）
let initialized = false;
function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  // 拉一次全量状态作为初始值
  void ipcWorkspaceGetState().then((state) => {
    snapshot = state;
    notifyListeners();
  });
  // 订阅广播
  onWorkspaceStateChanged((state) => {
    snapshot = state;
    notifyListeners();
  });
}

// ── 公共 hook ───────────────────────────────────────────────────

export function useWorkspace(id: string | null): WorkspaceState | undefined {
  ensureInit();
  return useSyncExternalStore(
    subscribe,
    () => (id ? snapshot.workspaces.find((w) => w.id === id) : undefined),
  );
}

export function useActiveWorkspace(): WorkspaceState | undefined {
  ensureInit();
  return useSyncExternalStore(
    subscribe,
    () => snapshot.workspaces.find((w) => w.id === snapshot.activeId),
  );
}

export function useAllWorkspaces(): WorkspaceState[] {
  ensureInit();
  return useSyncExternalStore(subscribe, () => snapshot.workspaces);
}

export function useOpenWorkspaces(): WorkspaceState[] {
  ensureInit();
  return useSyncExternalStore(
    subscribe,
    () => snapshot.workspaces.filter((w) => w.isOpen),
  );
}

export function useActiveWorkspaceId(): string | null {
  ensureInit();
  return useSyncExternalStore(subscribe, () => snapshot.activeId);
}
```

---

## 七、改造 Renderer UI 调用点

### WorkspaceTab.tsx

**文件**：`src/shell/workspace-bar/WorkspaceTab.tsx`

将 `workspaceManager.setActive(id)` / `.close(id)` / `.rename(id, name)` 改为 IPC invoke：

```typescript
// 删除 import workspaceManager
// 新增 import
import { ipcWorkspaceSetActive, ipcWorkspaceClose, ipcWorkspaceRename } from '@workspace/ipc/workspace-ipc';

// handleClick
const handleClick = () => {
  if (!editing) void ipcWorkspaceSetActive(id);
};

// handleClose
const handleClose = (e: React.MouseEvent) => {
  e.stopPropagation();
  void ipcWorkspaceClose(id);
};

// commit（重命名提交）
const commit = () => {
  const name = draft.trim();
  if (name) void ipcWorkspaceRename(id, name);
  setEditing(false);
};
```

### AddWorkspaceButton.tsx

**文件**：`src/shell/workspace-bar/AddWorkspaceButton.tsx`

```typescript
// 删除 import workspaceManager
import { ipcWorkspaceCreate } from '@workspace/ipc/workspace-ipc';

// handleClick — 注意：新建后「继承当前 view」的逻辑
// 现状依赖 workspaceManager.getActive()（renderer 本地）读 slotBinding
// 改法：从 hook 快照取（useActiveWorkspace），或在 handleClick 时从 snapshot 读
// 方案：把 AddWorkspaceButton 改成从快照取 activeWs
import { useActiveWorkspace } from '@workspace/workspace-instance/use-workspace';

export function AddWorkspaceButton() {
  const activeWs = useActiveWorkspace();

  const handleClick = () => {
    const currentView = activeWs?.slotBinding.left ?? null;
    void ipcWorkspaceCreate().then((ws) => {
      // 继承 view 的 update 操作：S3-a 阶段暂时仍走 workspaceManager.update()
      // （update 是房客 API，不是楼长 API，本次不上移）
      if (currentView) {
        workspaceManager.update(ws.id, {
          slotBinding: { left: currentView, leftPayload: undefined, right: null, rightPayload: undefined },
        });
      }
      void ipcWorkspaceSetActive(ws.id);
    });
  };
  // ...
}
```

> **注意**：`workspaceManager.update()` 是房客 API（修改 ws 内容，不是 ws 生命周期），本次不上移，仍走 renderer 本地。S4 后重构。

### nav-side-content.tsx（views/web/）

**文件**：`src/views/web/nav-side-content.tsx`

将 `workspaceManager.open(id)` / `.setActive(id)` / `.rename(editingId, name)` / `.remove(menu.id)` 改为 IPC invoke：

```typescript
import {
  ipcWorkspaceOpen,
  ipcWorkspaceSetActive,
  ipcWorkspaceRename,
  ipcWorkspaceRemove,
} from '@workspace/ipc/workspace-ipc';

// 点击工作空间项
void ipcWorkspaceOpen(id);
void ipcWorkspaceSetActive(id);

// 重命名提交
if (name) void ipcWorkspaceRename(editingId, name);

// 右键删除
onClick: () => void ipcWorkspaceRemove(menu.id),
```

---

## 八、改造 renderer/index.tsx 初始化

**文件**：`src/platform/renderer/index.tsx`

删除 localStorage 持久化初始化，改为等待 IPC 状态：

```typescript
// 删除这三行
// workspaceManager.setPersistence(localStoragePersistence);
// workspaceManager.loadFromPersistence();
// workspaceManager.ensureMinimum();

// 删除 localStoragePersistence import
```

use-workspace.ts 里的 `ensureInit()` 会在首次 hook 调用时自动拉一次全量状态，无需在 index.tsx 显式初始化。

---

## 九、验收标准

执行完毕后，验收方亲自 grep：

```bash
# 1. WorkspaceTab/AddWorkspaceButton 不再 import workspaceManager
grep -n "from.*workspace-manager" \
  src/shell/workspace-bar/WorkspaceTab.tsx \
  src/shell/workspace-bar/AddWorkspaceButton.tsx
# 期望：0行

# 2. nav-side-content 楼长直调已消失
grep -n "workspaceManager\.open\|workspaceManager\.setActive\|workspaceManager\.rename\|workspaceManager\.remove" \
  src/views/web/nav-side-content.tsx
# 期望：0行

# 3. WorkspaceTab/AddWorkspaceButton 楼长直调已消失
grep -n "workspaceManager\.create\|workspaceManager\.close\|workspaceManager\.setActive\|workspaceManager\.rename" \
  src/shell/workspace-bar/WorkspaceTab.tsx \
  src/shell/workspace-bar/AddWorkspaceButton.tsx
# 期望：0行

# 4. renderer/index.tsx 删掉了 loadFromPersistence/setPersistence
grep -n "loadFromPersistence\|setPersistence\|localStoragePersistence" \
  src/platform/renderer/index.tsx
# 期望：0行

# 5. 主进程楼长文件存在
ls src/platform/main/workspace/workspace-manager-main.ts
# 期望：文件存在

# 6. IPC handler 注册到总线
grep -n "registerWorkspaceHandlers" src/platform/main/ipc/ipc-bus.ts
# 期望：≥1行

# 7. channel 常量已加
grep -n "WORKSPACE_CREATE\|WORKSPACE_STATE_CHANGED" src/shared/ipc/channel-names.ts
# 期望：≥2行

# 8. tsc 编译通过
npx tsc --noEmit
```

---

## 注意事项

1. **`workspaceManager.update()` 不在本次范围**：这是房客 API（改 ws 内容，非 ws 生命周期），AddWorkspaceButton 里继承 view 的 update 调用**暂时保留**，不改。

2. **`workspaceManager` renderer 侧单例暂时保留**：还有 `update()` / `getBus()` / `get()` 等房客 API 在用，不能删。只是楼长 API 的调用点改走 IPC。

3. **preload 类型问题**：preload 不能 import 业务类型（会打进 renderer bundle）。`WorkspaceManagerState` 可以 inline 写 `Promise<unknown>` 返回类型，由调用方 cast——参照现有 `noteList(): Promise<unknown>` 的做法。

4. **初始化时序**：renderer 首次渲染时 `snapshot` 是空数组，`useOpenWorkspaces()` 返回 `[]`，WorkspaceContainer 会走到「No workspace」空状态。`ipcWorkspaceGetState()` 的 Promise resolve 后 snapshot 更新，触发重渲。这是正常的异步初始化，等同于 SPA 加载数据。

5. **主进程 `initWorkspaceManager()` 调用时机**：必须在 `createMainWindow()` 之前，否则 renderer 加载后立即调 `WORKSPACE_GET_STATE` 时主进程楼长尚未初始化。

6. commit 消息末尾加：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
