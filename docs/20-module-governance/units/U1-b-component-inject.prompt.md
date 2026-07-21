# 执行 Prompt · U1-b · views nav-side 改注入

> 复制给新对话执行。自包含。

## 任务

在 KRIG-Note-V2 里，把 **views 层 nav-side 组件**的 `useActiveWorkspaceId()` 替换成 `useWsId()`
（前一任务 U1-a 已建好 `useWsId`，见 `src/workspace/workspace-context/ws-id-context.ts`）。
这是「全局单例 → 依赖注入」治理的一步。

## ⚠️ 只改这 5 个文件（views 层），别的一律不碰

改这 5 处 `useActiveWorkspaceId()` → `useWsId()`：
1. `src/views/note/nav-side-content.tsx`（约 L13 import、L32 调用）
2. `src/views/ebook/nav-side-content.tsx`（约 L26 import、L78 调用）
3. `src/views/web/nav-side-content.tsx`（约 L21 import、L174 调用）
4. `src/views/graph-canvas-view/nav-side-content.tsx`（约 L32 import、L69 调用）
5. `src/views/ai/nav-side-content.tsx`（约 L15 import、L35 调用）

**每个文件**：
- import 改为 `import { useWsId } from '@workspace/workspace-context/ws-id-context'`
  （从原 `use-workspace` 的 import 里移除 `useActiveWorkspaceId`，若该行还 import 别的 hook 则保留它们）。
- 调用 `const wsId = useActiveWorkspaceId()` → `const wsId = useWsId()`。

## 🚫 绝对不要动这 3 个 shell 文件（改了会崩溃）

- `src/shell/workspace-container/WorkspaceContainer.tsx`
- `src/shell/workspace-bar/WorkspaceBar.tsx`
- `src/shell/workspace-bar/NavSideToggle.tsx`

它们在 Provider 外层，调 `useWsId()` 会 throw。它们保留 `useActiveWorkspaceId()` 不动。

## 🚫 别删 null 分支

有些文件有 `if (!wsId) return null` 或 `if (!wsId || !ws)`。**保留原样，不要删**。
（`useWsId` 恒返回非空，这些分支变成不触发的死代码，无害；清理是后续任务。）改 hook 后
TypeScript 可能提示 `wsId` 类型从 `string|null` 变 `string`——这是预期的，不用改分支逻辑。

## 验收（自检 + 报告）

1. tsc/build 通过。
2. `grep -rn useActiveWorkspaceId src/views/` → **归零**（views 层清干净）。
3. `grep -rn useActiveWorkspaceId src/shell/` → **仍有 3 处**（未动，正确）。
4. `git diff --stat` → 只含上述 5 个 views 文件。
5. 报告：改了哪 5 个文件、两个 grep 的结果、tsc 结果。

## 完成后

回报「U1-b 完成」+ 两个 grep 结果。不要做 U1-c，不要碰 shell，不要删死分支。
