# S1-c 执行 Prompt — capabilities/text-editing + slot/keymap-listener 注入

## 背景

这是多窗口架构治理 step2 第一批（S1-c）。

**目标**：把 `src/capabilities/text-editing/` 和 `src/slot/keymap-registry/keymap-listener.ts` 中的 `workspaceManager.getActiveId()` 调用改成从注入上下文取，彻底去掉这些 L4 能力层对 workspace 全局单例的直接依赖。

**不碰的东西**：
- `views/` 下的文件（S1-a / S1-b 负责）
- `workspaceManager.get(wsId)` 等带参调用——保留

---

## 调用点清单

```
src/capabilities/text-editing/ui/handle-menu/items.tsx:142
src/capabilities/text-editing/ui/handle-menu/HandleFormatSubmenu.tsx:36
src/capabilities/text-editing/ui/link-panel/LinkPanel.tsx:80
src/capabilities/text-editing/ui/color-picker/HandleColorSubmenu.tsx:27
src/capabilities/text-editing/commands/register-pm-commands.ts:42
src/slot/keymap-registry/keymap-listener.ts:44
```

---

## 各调用点改法

### 1. `src/capabilities/text-editing/commands/register-pm-commands.ts`（第 42 行）

```typescript
// 现状（第 38-43 行）
function resolveWsId(): string | null {
  return instanceRegistry.getFocusedInstanceId() ?? workspaceManager.getActiveId();
}
```

这里的 `workspaceManager.getActiveId()` 是 fallback：优先用 focused PM 实例 id，找不到才用 activeId（因为 note-view 中 instanceId = wsId）。

**改法**：这是 L4 能力层内部的实例解析，不走命令 ctx（此文件注册的是 PM 命令，直接调用，非 `commandRegistry.register` 模式）。

最干净的改法是**不改这处**（c2-defer）：这里的语义是「找当前 focused PM 实例的 id，实在找不到才从 active workspace 取」，在多窗口下每 renderer 各自有 workspaceManager，语义已正确。

**本次标注 c2-defer，不改**。

### 2. `src/capabilities/text-editing/ui/handle-menu/HandleFormatSubmenu.tsx`（第 36 行）

```typescript
const instanceId = workspaceManager.getActiveId();
```

这是 React UI 组件，取 instanceId 用于 PM 操作。组件在 WorkspaceInstance 树下，已在 `WorkspaceIdContext.Provider` 内。

**改法**：
```typescript
// 顶部 import 加
import { useWsId } from '@workspace/workspace-instance/WorkspaceIdContext';

// 组件内
const instanceId = useWsId();  // 替换 workspaceManager.getActiveId()
```

确认 `useWsId` 路径：`src/workspace/workspace-instance/WorkspaceIdContext.tsx`（参考 U1-a 已建立的 hook）。

### 3. `src/capabilities/text-editing/ui/link-panel/LinkPanel.tsx`（第 80 行）

同上，React 组件在 Provider 树内。

**改法**：`useWsId()` 替代 `workspaceManager.getActiveId()`。加 import，删 `workspaceManager` 的 import（若该文件只有这一处用到它）。

### 4. `src/capabilities/text-editing/ui/color-picker/HandleColorSubmenu.tsx`（第 27 行）

同上，React 组件。

**改法**：`useWsId()` 替代。

### 5. `src/capabilities/text-editing/ui/handle-menu/items.tsx`（第 142 行）

先读第 138-148 行上下文确认调用形态，再决定改法：
```bash
sed -n '135,150p' src/capabilities/text-editing/ui/handle-menu/items.tsx
```

若是 React 组件内 → `useWsId()`。
若是普通回调函数且有 instanceId 入参 → 直接用传入的 instanceId（note-view 中 instanceId === wsId）。

### 6. `src/slot/keymap-registry/keymap-listener.ts`（第 44 行）

```typescript
// 第 42-48 行（fallbackActiveViewId 函数）
function fallbackActiveViewId(): string | null {
  const wsId = workspaceManager.getActiveId();
  if (!wsId) return null;
  const ws = workspaceManager.get(wsId);
  // ...返回 left slot view id
}
```

这是**全局 keymap 监听器**（slot 层），不在 React 树内，不能用 `useWsId()`。此函数是事件驱动的 fallback 路径（键盘事件找不到目标 view 时才走）。

**c2-defer，暂不改**：多窗口套壳后每 renderer 只有一个 ws，`getActiveId()` 返回的就是本窗口 ws，语义正确。

---

## 本次实际要改的

| 文件 | 改动 |
|------|------|
| `HandleFormatSubmenu.tsx` | `useWsId()` 替代，加 import |
| `LinkPanel.tsx` | `useWsId()` 替代，加 import，删 workspaceManager import（若仅此一处）|
| `HandleColorSubmenu.tsx` | `useWsId()` 替代，加 import |
| `items.tsx` | 读上下文后决定（useWsId 或传参，见上） |

**c2-defer（不改）**：
- `register-pm-commands.ts`（第 42 行）
- `keymap-listener.ts`（第 44 行）

---

## 验收标准

```bash
# 改后这些文件 getActiveId() 应归零
grep -n "workspaceManager\.getActiveId()" \
  src/capabilities/text-editing/ui/handle-menu/HandleFormatSubmenu.tsx \
  src/capabilities/text-editing/ui/link-panel/LinkPanel.tsx \
  src/capabilities/text-editing/ui/color-picker/HandleColorSubmenu.tsx \
  src/capabilities/text-editing/ui/handle-menu/items.tsx

# tsc 编译通过
npx tsc --noEmit
```

**c2-defer 不纳入本次验收**：`register-pm-commands.ts`、`keymap-listener.ts`。

---

## 注意事项

1. `useWsId()` 来自 `@workspace/workspace-instance/WorkspaceIdContext`（U1-a 已建，直接 import）。
2. 改完后删掉不再用的 `workspaceManager` import（若该文件只有 getActiveId() 这一处用到它）。
3. 不改注释中提到 `workspaceManager.getActiveId()` 的说明文字。
4. commit 消息末尾加：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
