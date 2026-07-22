# S1-b 执行 Prompt — views/ebook、web、graph、ai、thought、x 命令注入

## 背景

这是多窗口架构治理 step2 第一批（S1-b）。

**目标**：把 `src/views/` 下 ebook / web / graph-canvas-view / ai / thought / x 这几个子目录中所有 `workspaceManager.getActiveId()` 调用，改成从**命令 ctx** 或**辅助函数参数**取 wsId。

**不碰的东西**：
- `views/note/` 下的文件（S1-a 负责）
- `capabilities/` 下的文件（S1-c 负责）
- `slot/` 下的文件（S1-c 负责）
- `workspaceManager.get(wsId)` / `.getBus(wsId)` / `.update(...)` — 保留

---

## 已有的注入基础设施

```typescript
// src/slot/command-registry/register-ws-command.ts
export interface CommandContext { wsId: string; }

export function registerWsCommand(
  id: string,
  getWsId: () => string | null,
  handler: (ctx: CommandContext, ...args: unknown[]) => unknown,
): void
```

改法模式：
```typescript
// 改前
commandRegistry.register('xxx', (arg) => {
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return;
  // ...
});

// 改后
registerWsCommand('xxx', () => workspaceManager.getActiveId(), (ctx, arg) => {
  const wsId = ctx.wsId;
  // ...
});
```

---

## 需要修改的文件和位置

### 1. `src/views/ebook/bookshelf-commands.ts`

第 17 行有一个辅助函数：
```typescript
function getActiveWorkspaceId(): string | null {
  return workspaceManager.getActiveId();
}
```
这个函数被文件内多个 `commandRegistry.register` 的 handler 调用（行号见下面）。

**改法**：把这些 `commandRegistry.register` 改成 `registerWsCommand`，删掉 `getActiveWorkspaceId()` 辅助函数，直接用 `ctx.wsId`。

需要改的命令（先 grep 确认哪些 handler 内部调用了 `getActiveWorkspaceId()`）：
```bash
grep -n "getActiveWorkspaceId" src/views/ebook/bookshelf-commands.ts
```
凡调用 `getActiveWorkspaceId()` 的 handler 都改成 `registerWsCommand`。

确认 import 头部加入 `registerWsCommand`（若未 import）：
```typescript
import { registerWsCommand } from '@slot/command-registry/register-ws-command';
```

### 2. `src/views/ebook/context-menu-content.ts`

第 55、223、260、340、438 行，均在一个文件顶部的辅助函数 `getActiveBookId()` 或各 context-menu item 的 action 回调内调用 `workspaceManager.getActiveId()`。

**改法**：context-menu content 的 action 是回调函数而非命令，不用 `registerWsCommand`。这类回调在**用户触发时**运行，此时 `getActiveId()` 语义上正确（用户正在操作活跃 ws）。

这些调用属于 **c2-defer**（取活跃 ws 的运行时路由逻辑，多窗口套壳后每 renderer 自有 workspaceManager，语义自然正确）。

**本次暂不改**，标注为 c2-defer。

### 3. `src/views/ebook/epub-context-menu-content.ts`

第 76、215、274、312、481 行，同上，context-menu action 回调。**c2-defer，暂不改**。

### 4. `src/views/ebook/AnnotationTypeSubmenu.tsx`

第 34 行在 `getActiveBookId()` 辅助函数内：
```typescript
function getActiveBookId(): string | null {
  const wsId = workspaceManager.getActiveId();
  // ...
}
```
这个函数被 React 组件内的 event handler 调用（点击选择批注类型时）。这是 React 组件事件回调，**c2-defer，暂不改**。

### 5. `src/views/web/web-commands.ts`

第 28、54 行：两处 `commandRegistry.register` handler 内：
```typescript
commandRegistry.register('web-view.open-url', (urlArg) => {
  const wsId = workspaceManager.getActiveId();  // 28行
  // ...
});
commandRegistry.register('web-view.pin-left', () => {
  const wsId = workspaceManager.getActiveId();  // 54行
  // ...
});
```

**改法**：两个命令都改成 `registerWsCommand`，加 import。

### 6. `src/views/web/web-bookmark-commands.ts`

第 26 行有辅助函数：
```typescript
function getActiveWorkspaceId(): string | null {
  return workspaceManager.getActiveId();
}
```
被文件内命令 handler 调用。grep 确认调用位置后，把相关命令改成 `registerWsCommand`，删辅助函数。

### 7. `src/views/web/WebView.tsx`

第 342 行：
```typescript
if (workspaceManager.getActiveId() !== workspaceId) return;
```
这是 React 组件内 IPC 广播守卫（只让活跃 ws 的实例处理广播），`workspaceId` 已从 props/context 注入。**c2-defer，暂不改**（多窗口套壳后每 renderer 只有一个 ws，语义自然正确）。

### 8. `src/views/graph-canvas-view/canvas-commands.ts`

第 29 行有辅助函数：
```typescript
function getActiveWorkspaceId(): string | null {
  return workspaceManager.getActiveId();
}
```

**改法**：grep 确认调用该辅助函数的命令 handler，改成 `registerWsCommand`，删辅助函数。

### 9. `src/views/ai/ai-commands.ts`

第 30、42、53、71、196、260 行，全在 `commandRegistry.register` handler 内。

**改法**：逐个改成 `registerWsCommand`。注意 `ai-view.close-right-slot`（第 52 行）和其他命令的改法：
```typescript
// 改前
commandRegistry.register('ai-view.switch-service', (idArg) => {
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return;
  // ...
});

// 改后
registerWsCommand('ai-view.switch-service', () => workspaceManager.getActiveId(), (ctx, idArg) => {
  const wsId = ctx.wsId;
  // ...
});
```

加 `registerWsCommand` import。

### 10. `src/views/thought/note-bridge.ts`

第 71 行（在 `buildDiffHandler` 返回的回调内）和第 96 行（在 `setThoughtAnchorHandler.onAnchorClick` 回调内）。

两处都是**事件回调**（不是命令注册），语义是"事件触发时取活跃 ws"。**c2-defer，暂不改**。

### 11. `src/views/thought/command-impl/scroll-to-source.ts`

第 24 行：在 `scrollToSource(thoughtId)` 函数内：
```typescript
export async function scrollToSource(thoughtId: string): Promise<void> {
  const wsId = workspaceManager.getActiveId();
```

这是一个被命令 handler 调用的工具函数，本身不注册命令。

**改法**：给函数加 `wsId` 参数：
```typescript
export async function scrollToSource(thoughtId: string, wsId: string): Promise<void> {
  // 删掉内部 getActiveId()
```
然后找调用方（grep `scrollToSource`），在调用方传入 wsId（调用方若是命令 handler，wsId 来自 ctx）。

### 12. `src/views/thought/command-impl/add-from-note.ts`

第 42 行：在 `addThoughtFromNote()` 函数内。**改法同上**：加 wsId 参数，调用方传入。

### 13. `src/views/thought/command-impl/add-from-pdf-annotation.ts`

第 19 行。**改法同上**：加 wsId 参数。

### 14. `src/views/thought/command-impl/ask-ai.ts`

第 39 行。**改法同上**：加 wsId 参数。

> **注意**：thought 的命令 handler 在哪里注册？先 grep `scrollToSource\|addThoughtFromNote\|askAiFromNote\|addThoughtFromPdf` 找到注册位置，在那里改成 `registerWsCommand` 并把 `ctx.wsId` 传给这些工具函数。

### 15. `src/views/x/x-commands.ts`

第 77、106、178 行，全在 `commandRegistry.register` handler 内。**改法**：改成 `registerWsCommand`。

### 16. `src/views/x/x-test-commands.ts`

第 47、96、111 行，全在命令 handler 内。**改法**：改成 `registerWsCommand`（注意这是测试命令文件，改法同正式命令）。

### 17. `src/views/x/send-to-x.ts`

第 135、255、437 行：这是工具函数文件（非命令注册），函数被 x-commands.ts 调用。

**改法**：给相关函数加 `wsId` 参数，调用方（x-commands.ts，改后用 ctx.wsId）传入。先 grep 确认：
```bash
grep -n "export.*function\|^function" src/views/x/send-to-x.ts | head -20
grep -n "getActiveId" src/views/x/send-to-x.ts
```
找到含 `getActiveId` 的函数，加 wsId 参数，调用方（x-commands.ts）传入。

---

## 验收标准

执行完毕后，验收方会亲自 grep：

```bash
# 本批次改完后，以下文件中 getActiveId() 应归零（实际调用，排除注释）
grep -n "workspaceManager\.getActiveId()" \
  src/views/ebook/bookshelf-commands.ts \
  src/views/web/web-commands.ts \
  src/views/web/web-bookmark-commands.ts \
  src/views/graph-canvas-view/canvas-commands.ts \
  src/views/ai/ai-commands.ts \
  src/views/thought/command-impl/scroll-to-source.ts \
  src/views/thought/command-impl/add-from-note.ts \
  src/views/thought/command-impl/add-from-pdf-annotation.ts \
  src/views/thought/command-impl/ask-ai.ts \
  src/views/x/x-commands.ts \
  src/views/x/x-test-commands.ts \
  src/views/x/send-to-x.ts
# 期望：0 行实际调用

# tsc 编译通过
npx tsc --noEmit
```

**c2-defer 暂不改**（不纳入本次验收）：
- `ebook/context-menu-content.ts`、`epub-context-menu-content.ts`、`AnnotationTypeSubmenu.tsx`
- `web/WebView.tsx`
- `thought/note-bridge.ts`

---

## 注意事项

1. 改 `commandRegistry.register` → `registerWsCommand` 时，handler 多一个首参 `ctx`，原有参数顺序后移一位。
2. 辅助函数 `getActiveWorkspaceId()` 出现在多个文件（bookshelf-commands, web-bookmark-commands, canvas-commands），**删掉该函数本身**，不留死代码。
3. thought 的工具函数（scroll-to-source 等）加 wsId 参数后，**一定要找到调用方**（在 thought 命令注册文件里）一并改，否则 tsc 会报错。
4. 不要改注释里提到 `getActiveId()` 的文字，只改实际调用代码。
5. commit 消息末尾加：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
