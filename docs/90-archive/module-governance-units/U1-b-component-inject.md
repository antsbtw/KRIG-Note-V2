# U1-b · 组件类消费点改注入（views nav-side）

> **单元**：U1 依赖注入第二步——组件里 `useActiveWorkspaceId()` → `useWsId()`（消费 U1-a 建的注入链）。
> **前置**：U1-a 已交付（commit 0741b78d，WorkspaceIdContext + useWsId 就绪）。
> **状态**：🔶 prompt 就绪待执行。

## ⚠️ 关键：10 个点分两类，只改一类（grep 排查得出，2026-07-21）

**第一类：shell 层 3 个点 —— ❌ 不改（会 throw 崩溃）**
- `shell/workspace-container/WorkspaceContainer.tsx:19`
- `shell/workspace-bar/WorkspaceBar.tsx:24`
- `shell/workspace-bar/NavSideToggle.tsx:17`
- **为何不改**：① 它们用 activeId 是为「高亮哪个 tab / disabled 按钮」= **tab 模型语义**，正是要拔掉
  的东西，归 U3/多窗口删 shell。② 它们在 WorkspaceInstance **外层**，不在 `WorkspaceIdContext.Provider`
  内 → 调 `useWsId()` 会**直接 throw**。

**第二类：views 的 nav-side-content —— ✅ U1-b 战场**
- `views/note/nav-side-content.tsx:32`、`views/ebook/nav-side-content.tsx:78`、
  `views/web/nav-side-content.tsx:174`、`views/graph-canvas-view/nav-side-content.tsx:69`、
  `views/ai/nav-side-content.tsx:35`
- 在 WorkspaceInstance **内层**（NavSideFrame 内）→ 在 Provider 内，`useWsId()` 正常工作。

## null 分支处理（第二类的语义变化）

原 `const wsId = useActiveWorkspaceId()` 返回 `string | null`，故有 `if (!wsId) return null` 防御。
改 `useWsId()` 后 wsId **恒有值**（组件必在 Provider 内），这些 null 分支成**死代码**。
- **处理**：可删死分支，但**逐个确认**——只删「因 wsId 为空而 return/guard」的分支，
  不误删别的逻辑（如 `if (!wsId || !ws)` 里的 `!ws` 部分要保留）。
- 保守做法：先只替换 hook、保留 null 分支（wsId 恒真则分支不触发，无害），死代码清理留后续。
  → **本单元建议保守：只换 hook，null 分支原样留（无害），不冒险删**。

## 验收判据

- [ ] 第二类 5 个 views nav-side：`useActiveWorkspaceId()` → `useWsId()`，import 相应调整。
- [ ] **第一类 shell 3 个点：一行未动**（grep 确认仍是 useActiveWorkspaceId）。
- [ ] tsc 通过；`grep useActiveWorkspaceId src/views/` 归零（views 层清干净）。
- [ ] shell 层 useActiveWorkspaceId 仍在（3 处）。
- [ ] 运行冒烟：各 view 的 nav-side 正常渲染、能操作数据。

## 边界（不做）

- ❌ 不碰 shell 3 个点（U3/多窗口）。
- ❌ 不删 null 死分支（保守，留后续）。
- ❌ 不碰 command 纯函数 getActiveId（U1-c）。
