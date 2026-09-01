# 执行 Prompt · U1-a · ws 上下文注入链

> 复制以下内容给新对话执行。任务自包含，无需回读治理全过程。

---

## 任务

在 KRIG-Note-V2（Electron 笔记 app）里，建立一个 **ws 上下文注入通道**：`WorkspaceIdContext` +
`useWsId()` hook，并在 `WorkspaceInstance` 挂上 Provider。这是「把全局单例 workspaceManager 改成依赖
注入」这项架构治理的**地基第一步**——**本任务只建通道 + 挂 Provider，不改任何现有调用点**。

## 背景（一句话）

现在很多组件用 `useActiveWorkspaceId()` / `workspaceManager.getActiveId()` 抓「当前活跃 workspace」。
多窗口/模块化治理要改成「每个 window 注入自己的 wsId」。本任务先把注入通道建好，后续任务才改调用点。

## 精确步骤

1. **照抄现成范本**：`src/slot/workspace-bus/use-workspace-bus.ts` 是一个标准
   `createContext + useContext + throw-if-outside` 模式。**照它的风格**建新文件
   `src/workspace/workspace-context/ws-id-context.ts`（目录可按项目习惯微调）：
   ```ts
   import { createContext, useContext } from 'react';
   export const WorkspaceIdContext = createContext<string | null>(null);
   export function useWsId(): string {
     const wsId = useContext(WorkspaceIdContext);
     if (!wsId) throw new Error('[ws] useWsId called outside <WorkspaceIdContext.Provider>');
     return wsId;
   }
   ```

2. **挂 Provider**：在 `src/workspace/workspace-instance/WorkspaceInstance.tsx`，现有
   `<WorkspaceBusContext.Provider value={bus}>`（约 L60）**外面套一层**：
   ```tsx
   <WorkspaceIdContext.Provider value={state.id}>
     <WorkspaceBusContext.Provider value={bus}>
       ...原有内容...
     </WorkspaceBusContext.Provider>
   </WorkspaceIdContext.Provider>
   ```
   `state.id` 是本 WorkspaceInstance 的 workspace id（该文件已在 L34/57/65 使用 `state.id`）。

## 严格边界（不要做）

- ❌ 不要改 `useActiveWorkspaceId` 的任何消费点（下一个任务做）。
- ❌ 不要改任何 `workspaceManager.getActiveId()` 调用（下一个任务做）。
- ❌ 不要删除 `useActiveWorkspaceId` 或 `getActiveId`（还在用）。
- ❌ 不碰主进程 / 楼长房客拆分。
- **这是纯加法。改动应该很小（1 个新文件 + WorkspaceInstance 几行）。**

## 验收（自检 + 报告）

1. 构建通过（项目的 build/tsc 命令）。
2. `WorkspaceIdContext` + `useWsId()` 存在，风格对齐 use-workspace-bus。
3. Provider 挂在 WorkspaceInstance，`value={state.id}`。
4. **冒烟验证**：在任一已渲染的组件里临时 `const id = useWsId(); console.log(id)`，确认拿到正确
   wsId，验证后**移除临时代码**。
5. 确认没动任何 getActiveId 调用点（`git diff` 应只含新文件 + WorkspaceInstance）。
6. 报告：改了哪些文件、验收结果、有无意外。

## 完成后

回报「U1-a 完成」+ git diff 摘要。不要顺手做 U1-b/U1-c。
