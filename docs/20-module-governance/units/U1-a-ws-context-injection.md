# U1-a · ws 上下文注入链（A1 抽象·地基）

> **单元**：U1 震中依赖注入的**地基第一步**——建立 ws 上下文注入通道。
> **性质**：低风险、照抄现成模式、地基性（U1-b/U1-c 都依赖它）。
> **状态**：🔶 待执行（细化文档 + prompt 已就绪）。

## 一、要做什么

建立 `WorkspaceIdContext + useWsId()`：让「我这个 window 的 wsId」通过 React Context 注入，
供组件取用，替代「伸手抓 `workspaceManager.getActiveId()`」。

**本单元只建通道 + 挂 Provider，不改任何调用点**（调用点改动是 U1-b/U1-c）。→ 可独立验收。

## 二、为什么低风险

- **有现成范本照抄**：`src/slot/workspace-bus/use-workspace-bus.ts` 就是标准
  `createContext + useContext + throw-if-outside` 模式。U1-a 照它建一个 wsId 版即可。
- **Provider 挂载点现成**：`WorkspaceInstance.tsx:60` 已挂 `<WorkspaceBusContext.Provider>`，
  新的 `WorkspaceIdContext.Provider` **套在同一层**，`value={state.id}`（`state.id` = 本 window 的
  ws id，该文件 34/57/65 行已在用）。
- 不删旧东西、不改调用点 → 加法，零破坏。

## 三、精确实现（照抄范本）

**新建** `src/workspace/workspace-context/ws-id-context.ts`（或就近合适目录）：
```ts
import { createContext, useContext } from 'react';

export const WorkspaceIdContext = createContext<string | null>(null);

/** 拿当前 window/workspace 的 wsId — 必须在 Provider 内调用 */
export function useWsId(): string {
  const wsId = useContext(WorkspaceIdContext);
  if (!wsId) {
    throw new Error('[ws] useWsId called outside <WorkspaceIdContext.Provider>');
  }
  return wsId;
}
```

**挂 Provider**（`WorkspaceInstance.tsx`，套在现有 BusContext.Provider 同层，L60 附近）：
```tsx
<WorkspaceIdContext.Provider value={state.id}>
  <WorkspaceBusContext.Provider value={bus}>
    ...
  </WorkspaceBusContext.Provider>
</WorkspaceIdContext.Provider>
```

## 四、验收判据（可独立验收）

- [ ] `WorkspaceIdContext` + `useWsId()` 存在，风格对齐 use-workspace-bus。
- [ ] Provider 挂在 WorkspaceInstance，value = 本 ws 的 `state.id`。
- [ ] **不改任何 getActiveId 调用点**（那是 U1-b/U1-c）。
- [ ] 构建通过；在任一组件里临时调 `useWsId()` 能拿到正确 wsId（冒烟验证后移除临时代码）。
- [ ] 无回归：现有功能不变（纯加法）。

## 五、边界（不做什么）

- ❌ 不改 `useActiveWorkspaceId` 的 10 个消费点（U1-b）。
- ❌ 不改 command handler / 38 个纯函数 getActiveId（U1-c）。
- ❌ 不碰楼长/房客拆分（A3，归多窗口 step2）。
