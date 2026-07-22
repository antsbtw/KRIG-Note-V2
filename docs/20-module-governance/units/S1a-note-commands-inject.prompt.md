# S1-a 执行 Prompt — views/note/ 命令注入（getActiveId → ctx.wsId）

## 背景

这是多窗口架构治理 step2 第一批（S1-a）。

**目标**：把 `src/views/note/` 下所有 `workspaceManager.getActiveId()` 调用，改成从**命令 ctx** 或**已有 workspaceId 参数**取 wsId，彻底去掉这些调用点对全局单例的直接依赖。

**不碰的东西**（超出本批次范围，不要动）：
- `capabilities/` 下的文件
- `slot/` 下的文件
- `views/` 下除 `note/` 以外的文件
- `workspaceManager.get(wsId)` / `workspaceManager.getBus(wsId)` / `workspaceManager.update(...)` — 这些**保留**，只改 `getActiveId()`

---

## 已有的注入基础设施（不需要新建，直接使用）

### registerWsCommand（命令注入）
```typescript
// src/slot/command-registry/register-ws-command.ts
export interface CommandContext { wsId: string; }

export function registerWsCommand(
  id: string,
  getWsId: () => string | null,
  handler: (ctx: CommandContext, ...args: unknown[]) => unknown,
): void
```

### 已有范本（note-view.create-note 已改好，照抄结构）
```typescript
// 改前
commandRegistry.register('note-view.create-note', (folderId) => {
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return;
  // ...
});

// 改后（已在代码中）
registerWsCommand('note-view.create-note', () => workspaceManager.getActiveId(), (ctx, folderId) => {
  const wsId = ctx.wsId;
  // ...
});
```

---

## 需要修改的文件和具体位置

### 文件 1：`src/views/note/note-commands.ts`

以下命令用 `commandRegistry.register` + 内部 `workspaceManager.getActiveId()`，全部改成 `registerWsCommand`：

**改法一览**（每个 `commandRegistry.register('xxx', ...)` → `registerWsCommand('xxx', () => workspaceManager.getActiveId(), (ctx, ...) => { const wsId = ctx.wsId; ... })`）：

| 命令 | 行号 | 改法 |
|------|------|------|
| `note-view.delete-active` | 117 | → registerWsCommand，handler 第一参 ctx，`const wsId = ctx.wsId` |
| `note-view.set-active` | 132 | → registerWsCommand，`noteId` 从第二参来，`const wsId = ctx.wsId` |
| `note-view.set-active-in-right` | 150 | → registerWsCommand |
| `note-view.create-folder` | 166 | → registerWsCommand |
| `note-view.copy-by-tree-id` | 189 | → registerWsCommand |
| `note-view.paste` | 197 | → registerWsCommand |
| `note-view.sort-cycle-title` | 206 | → registerWsCommand |
| `note-view.sort-cycle-date` | 213 | → registerWsCommand |
| `note-view.close-view` | 325 | → registerWsCommand |
| `note-view.open-right-slot` | 353 | → registerWsCommand |
| `note-view.append-ai-turn` | 378 | → registerWsCommand |
| `note-view.append-pm-nodes` | 411 | → registerWsCommand |

**`resolveInstanceId` 函数（第 76-81 行）**：
```typescript
// 改前
function resolveInstanceId(): string | null {
  return (
    requireCapabilityApi<TextEditingApi>('text-editing')
      .instanceRegistry.getFocusedInstanceId() ?? workspaceManager.getActiveId()
  );
}
```
改成接收 wsId 参数：
```typescript
function resolveInstanceId(wsId?: string): string | null {
  return (
    requireCapabilityApi<TextEditingApi>('text-editing')
      .instanceRegistry.getFocusedInstanceId() ?? wsId ?? null
  );
}
```
凡调用 `resolveInstanceId()` 的命令（`withInstance` 调用点）**不需要**改成 registerWsCommand，因为这些命令（slash-insert-*、toggle-toc、handle-copy-block-link 等）操作的是 PM 实例而非 wsId，instanceRegistry.getFocusedInstanceId() 已经是正确来源。`wsId` 参数可选，fallback 仍合理。

### 文件 2：`src/views/note/link-click-integration.ts`

**第 46、56、80 行**：全在 `registerLinkClickIntegration()` 内，此函数在应用启动时注册回调（非命令，无法用 registerWsCommand）。

改法：**不注入 ctx，而是在调用时实时取**——这三处已经是最晚取（在事件回调里），改成接收 `workspaceId` 参数的方式不适用，此处**保持现状**。

等待：这三处是「c2-defer」性质的调用点（回调运行时取活跃 ws），多窗口 step2 整体完成后（每 renderer 自己那份 workspaceManager 已经正确返回本窗口 ws），语义上自然正确，**暂不改**。注意：文件中第 80 行在 `registerLinkClickIntegration` 函数末尾，也是运行时取，同样暂不改。

### 文件 3：`src/views/note/ai-sync-integration.ts`

**第 87、137 行**：两处都在内部函数 `reconcileForActive()` 和 `handleAppendTurn()` 里，是「监听活跃 ws 变化」的逻辑，语义上就是「当前活跃 ws」，不是命令注入的场景。

改法：**暂不改**（c2-defer，与 link-click 同性质，多窗口套壳后自然正确）。

### 文件 4：`src/views/note/note-navigation-history.ts`

**第 85 行**：在 `applyToActiveWs(noteId)` 内。

```typescript
// 改前
function applyToActiveWs(noteId: string): void {
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return;
  setActiveNote(wsId, noteId);
}
```

改法：`applyToActiveWs` 加 `wsId` 参数，调用方传入。找到调用 `applyToActiveWs` 的地方，确认传入 wsId（先 grep 调用点）。若调用方已有 wsId 则直传；若无则通过 workspaceManager.getActiveId() 在调用方取（推迟一层，但本文件内此函数的调用方在同一文件，搜第 80 行附近）。

### 文件 5：`src/views/note/toolbar-content.tsx`

**第 33 行**：在 `NoteToolbarTitle` 组件 `useSyncExternalStore` 的 getSnapshot 里：
```typescript
() => workspaceManager.getActiveId(),
```

这是 React 组件，已在 `WorkspaceIdContext.Provider` 内（WorkspaceInstance 挂了 Provider）。

改法：
```typescript
// 在组件顶部加
const wsId = useWsId();  // import { useWsId } from '@workspace/workspace-instance/WorkspaceIdContext'
// 然后 useSyncExternalStore 改为
(cb) => workspaceManager.subscribe(cb),
() => wsId,   // 直接返回已注入的 wsId
```
同时 `getActiveId()` 那行整个 `useSyncExternalStore` 用 `wsId` 替代。

### 文件 6：`src/views/note/ask-ai-popup/AskAIPanel.tsx`

**第 109 行**：在事件回调内 `const wsId = workspaceManager.getActiveId()`。

这是 React 组件，在 Provider 内。改法同 toolbar-content：组件顶部 `const wsId = useWsId()`，第 109 行直接用 `wsId`。

### 文件 7：`src/views/note/note-open-popup/NoteOpenPopup.tsx`

**第 58 行**：同上，React 组件在 Provider 内。改法：`useWsId()` 替代。

### 文件 8：`src/views/note/use-markdown-import.ts`

**第 38 行**：
```typescript
if (workspaceManager.getActiveId() !== workspaceId) return;
```
`workspaceId` 已通过函数参数传入（见第 31 行 `useMarkdownImport(workspaceId: string)`），`getActiveId()` 在这里是运行时取「当前活跃 ws」来与本实例的 workspaceId 对比（路由守卫：只让活跃 ws 的实例处理广播）。

多窗口套壳后每个 renderer 只有一个 ws，这个对比永远为 true，但**语义上是正确的防并发逻辑**，暂不改（c2-defer）。

### 文件 9：`src/views/note/use-extraction-import.ts`

**第 26 行**：同 use-markdown-import，同样是路由守卫，暂不改（c2-defer）。

---

## 总结：本批次实际要改的

| 文件 | 改动类型 | 处数 |
|------|---------|------|
| `note-commands.ts` | 12 个 commandRegistry.register → registerWsCommand | ~12 |
| `note-commands.ts` | `resolveInstanceId` 加 wsId 参数 | 1 |
| `toolbar-content.tsx` | useWsId() 替代 getActiveId() | 1 |
| `ask-ai-popup/AskAIPanel.tsx` | useWsId() 替代 getActiveId() | 1 |
| `note-open-popup/NoteOpenPopup.tsx` | useWsId() 替代 getActiveId() | 1 |
| `note-navigation-history.ts` | applyToActiveWs 加 wsId 参数 | 1 |

**暂不改（c2-defer）**：link-click-integration.ts (3处)、ai-sync-integration.ts (2处)、use-markdown-import.ts (1处)、use-extraction-import.ts (1处)

---

## 验收标准

执行完毕后，验收方（总指挥）会亲自 grep：

```bash
# 本批次改完后，以下文件中 getActiveId() 应归零（实际调用行，排除注释）
grep -n "workspaceManager\.getActiveId()" \
  src/views/note/note-commands.ts \
  src/views/note/toolbar-content.tsx \
  src/views/note/ask-ai-popup/AskAIPanel.tsx \
  src/views/note/note-open-popup/NoteOpenPopup.tsx \
  src/views/note/note-navigation-history.ts
# 期望：0 行实际调用

# tsc 编译通过
npx tsc --noEmit
```

暂不改的文件（c2-defer）不纳入本次验收范围。

---

## 注意事项

1. **不要改文件头部注释**中提到 `workspaceManager.getActiveId()` 的说明文字，只改实际代码调用。
2. **不要动** `workspaceManager.get(wsId)` / `.getBus(wsId)` / `.update(wsId, ...)` 这类有 id 参数的调用。
3. `registerWsCommand` 的第二参 `getWsId` 写法统一为 `() => workspaceManager.getActiveId()`（后续多窗口套壳时会把这里换成窗口注入的 wsId，现在先保持语义不变）。
4. 改 `commandRegistry.register` → `registerWsCommand` 时，确认 import 已加 `registerWsCommand`（文件顶部已有，直接用）。
5. commit 消息末尾加：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
