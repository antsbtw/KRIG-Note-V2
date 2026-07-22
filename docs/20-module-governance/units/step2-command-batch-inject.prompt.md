# step2 执行 Prompt — 命令批量注入（getActiveId 归零）

> **分支**：`feat/multi-window-step2`（从 `design/multi-window-process-isolation` 派生）
> **前置已完成**：A2 接口 `registerWsCommand` 已就位（`src/slot/command-registry/register-ws-command.ts`）；所有 view 的 `index.ts` 注册入口已知。

---

## 背景

治理 U1-c1-batch：当前 46 处 `registerWsCommand('xxx', () => workspaceManager.getActiveId(), ...)` 的 getter 是模块级全局取 active wsId。多窗口套壳后每个 renderer 进程只有一个 ws，所以正确做法是**注册时闭包捕获本 renderer 的 wsId**，而不是运行时查全局。

同时有 6 处**非命令**的 `workspaceManager.getActiveId()` 残留（见下表）也在本次一并清掉。

完成后全仓 `grep workspaceManager.getActiveId()` 实际调用（非注释行）应归零。

---

## 需要改的文件和改法

### 一、46 处命令 getter（机械改，全部同一模式）

**现状**：
```typescript
registerWsCommand('note-view.create-note', () => workspaceManager.getActiveId(), (ctx, folderId) => { ... });
```

**目标**：getter 改为返回注册时传入的固定 wsId：
```typescript
registerWsCommand('note-view.create-note', () => wsId, (ctx, folderId) => { ... });
```

每个 register 函数加 `wsId: string` 参数，注册入口（index.ts）传入时已能拿到。

**涉及文件（9 个，共 46 处）**：

| 文件 | 处数 |
|------|------|
| `src/views/note/note-commands.ts` | 13 |
| `src/views/x/x-test-commands.ts` | 8 |
| `src/views/ai/ai-commands.ts` | 6 |
| `src/views/x/x-commands.ts` | 4 |
| `src/views/thought/thought-commands.ts` | 4 |
| `src/views/graph-canvas-view/canvas-commands.ts` | 4 |
| `src/views/ebook/bookshelf-commands.ts` | 4 |
| `src/views/web/web-commands.ts` | 2 |
| `src/views/web/web-bookmark-commands.ts` | 1 |

**改法（以 note-commands.ts 为例）**：

```typescript
// 改前
export function registerNoteCommands(): void {
  registerWsCommand('note-view.create-note', () => workspaceManager.getActiveId(), (ctx, folderId) => { ... });
  registerWsCommand('note-view.delete-active', () => workspaceManager.getActiveId(), (ctx) => { ... });
  // ...
}

// 改后
export function registerNoteCommands(wsId: string): void {
  registerWsCommand('note-view.create-note', () => wsId, (ctx, folderId) => { ... });
  registerWsCommand('note-view.delete-active', () => wsId, (ctx) => { ... });
  // ...
}
```

对应的 **index.ts 调用方**也要传入 wsId。index.ts 里目前是纯副作用（import 即触发），需要改为**函数**，由 renderer/index.tsx 拿到 wsId 后显式调用。

**注意**：`x-test-commands.ts` 除了 8 处 `registerWsCommand` getter，还有 11 处 dnd devtools bridge 里的裸 `workspaceManager.getActiveId()` 回调（第 79-107 行），这些也一并改成闭包捕获的 `wsId`。

---

### 二、6 处非命令残留（逐个说明）

#### 1. `src/views/note/note-navigation-history.ts:85`

```typescript
// 现状
function applyToActiveWs(noteId: string, wsId?: string): void {
  const id = wsId ?? workspaceManager.getActiveId();
  ...
}
```

改为：
```typescript
import { getActiveWorkspaceIdSync } from '@workspace/workspace-instance/use-workspace';

function applyToActiveWs(noteId: string, wsId?: string): void {
  const id = wsId ?? getActiveWorkspaceIdSync();
  ...
}
```

#### 2. `src/capabilities/text-editing/commands/register-pm-commands.ts:42`

```typescript
// 现状（c2-defer，现在做）
return instanceRegistry.getFocusedInstanceId() ?? workspaceManager.getActiveId();
```

改为：
```typescript
import { getActiveWorkspaceIdSync } from '@workspace/workspace-instance/use-workspace';

return instanceRegistry.getFocusedInstanceId() ?? getActiveWorkspaceIdSync();
```

#### 3. `src/capabilities/text-editing/ui/handle-menu/items.tsx:142`

```typescript
// 现状（c2-defer，现在做）
workspaceManager.getActiveId();
```

读取上下文后决定改法（同 register-pm-commands，改为 `getActiveWorkspaceIdSync()`）。若 `workspaceManager` import 因此不再被实际值使用，删除该 import。

#### 4. `src/platform/renderer/index.tsx:72, 88`

```typescript
// 第 72 行 — L3.5 bus 初始化
const _activeId = workspaceManager.getActiveId();
if (_activeId) workspaceManager.getBus(_activeId);

// 第 88 行 — dev 调试桥
get bus() {
  const id = workspaceManager.getActiveId();
  return id ? workspaceManager.getBus(id) : undefined;
}
```

改为 `getActiveWorkspaceIdSync()`。

#### 5. `src/views/x/x-commands.ts:177, 195`（dnd callbacks）

```typescript
// 第 177、195 行 — dnd 回调
const wsId = workspaceManager.getActiveId();
```

这两处在 `registerWsCommand` 命令体**内部**（不是 getter），用于 dnd 拖拽落地时取 ws。  
改为 `getActiveWorkspaceIdSync()`（拖拽发生时当前 renderer 的 active ws 就是这个窗口的 ws，语义正确）。

---

### 三、注册入口改造（index.ts → 显式调用）

当前 view 的 index.ts 是**import 即触发**的副作用模式：

```typescript
// src/views/note/index.ts（现状）
registerNoteCommands();   // 无参，模块加载时执行
```

改为：命令注册函数接受 `wsId`，由 renderer/index.tsx 在拿到 wsId 后显式调用。

**src/platform/renderer/index.tsx** 的初始化段（目前约第 72 行附近）改为：

```typescript
import { getActiveWorkspaceIdSync } from '@workspace/workspace-instance/use-workspace';
// 在 view import 之后（view import 只触发 registerView，不再自动注册命令）

// 拿到本 renderer 的 wsId
const rendererWsId = getActiveWorkspaceIdSync();
if (rendererWsId) {
  // 各 view 命令注册，传入固定 wsId
  registerNoteCommands(rendererWsId);
  registerWebCommands(rendererWsId);
  registerWebBookmarkCommands(rendererWsId);
  registerEBookCommands(rendererWsId);
  registerAICommands(rendererWsId);
  registerXCommands(rendererWsId);
  registerXTestCommands(rendererWsId);
  registerGraphCanvasCommands(rendererWsId);
  registerThoughtCommands(rendererWsId);
}
```

**注意**：各 view 的 index.ts import（`import '@views/note'` 等）保留，它们触发 `registerView`、`registerNavSide`、context-menu 等非命令注册，不需要改。只需把命令注册函数**从 index.ts 的模块级调用移出**，让 renderer 显式调用。

**c2-defer 重构（ai-sync + keymap）**：

`ai-sync-integration.ts` 里的 `reconcileForActive`（第 88 行）和 `handleAppendTurn`（第 139 行）都在追「全局 active ws 切换」。多窗口套壳后，每个 renderer 只有一个 ws，`reconcileForActive` 应改为：订阅**本 renderer 的 ws 状态**（传入 wsId 闭包或从 `workspaceManager.get(wsId)` 直接读），而不是 `getActiveId()`。

`registerAISyncIntegration` 函数加 `wsId: string` 参数，内部用闭包 `wsId` 代替 `getActiveId()`。`handleAppendTurn` 的守卫 `activeId !== active.workspaceId` 改为 `wsId !== active.workspaceId`（本 renderer 的 wsId 就是唯一身份）。

`keymap-listener.ts` 的 `fallbackActiveViewId`（第 45 行）：
```typescript
// 改为读本 renderer ws
import { getActiveWorkspaceIdSync } from '@workspace/workspace-instance/use-workspace';

function fallbackActiveViewId(): string | null {
  const wsId = getActiveWorkspaceIdSync();
  if (!wsId) return null;
  const ws = workspaceManager.get(wsId);
  return ws?.slotBinding.left ?? null;
}
```

---

## 验收判据

```bash
# 1. getActiveId 实际调用归零（非注释行）
grep -rn "workspaceManager\.getActiveId()" src --include="*.ts" --include="*.tsx" \
  | grep -v "node_modules" | grep -v "^\s*//" | grep -v "^ \*"
# 期望：0 行

# 2. tsc 通过
npx tsc --noEmit
# 期望：0 错误

# 3. 命令注册函数签名带 wsId
grep -n "export function registerNoteCommands\|export function registerAICommands\|export function registerXCommands" \
  src/views/note/note-commands.ts src/views/ai/ai-commands.ts src/views/x/x-commands.ts
# 期望：每个均含 wsId: string 参数

# 4. renderer/index.tsx 显式传 wsId 调用命令注册
grep -n "registerNoteCommands\|registerAICommands" src/platform/renderer/index.tsx
# 期望：带 rendererWsId 参数的调用
```

---

## 注意事项

1. **不改 `workspaceManager.get()`、`.update()`、`.getBus()`、`.subscribe()`**——这些是合法的「房客 API」，不在本次清零范围。只清 `getActiveId()`。
2. **不改 `registerWsCommand` 函数本身**（`src/slot/command-registry/register-ws-command.ts`）——接口已正确，只改调用方。
3. **各 view 的 index.ts 里非命令注册（registerView、registerNavSide、context-menu 等）保持 import 触发**，不需要改成显式调用。
4. **`workspaceManager` import 若在改完后某文件里不再有实际调用（只剩注释提到），删掉该 import**，避免 tsc 警告或残余依赖。
5. `x-test-commands.ts` 的 devtools bridge（第 79-89 行的 lambda 对象）用的是裸 `workspaceManager.getActiveId()`，改为 `getActiveWorkspaceIdSync()` 即可（devtools 桥也在本 renderer 上下文里，语义完全等价）。
6. commit 消息末尾加：`Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`
