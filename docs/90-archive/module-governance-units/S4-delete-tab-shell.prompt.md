# S4 执行 Prompt — 删 Shell Tab 残骸 + WorkspaceContainer 改单 ws 渲染

## 背景与目标

这是多窗口架构治理 step2（S4）。

**前置条件**：S3-a 已完成（楼长 API 走 IPC，WorkspaceTab/AddWorkspaceButton 已改用 IPC invoke）。

**目标**：
1. 删除 tab 模型残骸（WorkspaceBar / WorkspaceTab / AddWorkspaceButton / NavSideToggle）
2. WorkspaceContainer 的 `.map(ws)` → 直接渲染唯一的当前 ws
3. WorkspaceInstance 去掉 `isActive` prop 和 `display:none` 切换
4. NavSideToggle 功能移进 WorkspaceInstance 内部
5. renderer/index.tsx 清理 shell 组件引用

**不碰**：
- `WorkspaceInstance` 内部结构（NavSideFrame / SlotArea / OverlayFrames）
- `workspaceManager` renderer 本地单例（房客 API 还在用）
- `use-workspace.ts` hook（S3-a 已改好）

---

## 一、删除 tab 残骸文件

以下文件**整个删除**（不保留任何内容）：

```
src/shell/workspace-bar/WorkspaceBar.tsx
src/shell/workspace-bar/WorkspaceBar.css（若存在）
src/shell/workspace-bar/WorkspaceTab.tsx
src/shell/workspace-bar/WorkspaceTab.css（若存在）
src/shell/workspace-bar/AddWorkspaceButton.tsx
src/shell/workspace-bar/AddWorkspaceButton.css（若存在）
src/shell/workspace-bar/NavSideToggle.tsx
src/shell/workspace-bar/use-fullscreen.ts（若仅 WorkspaceBar 用）
```

删除前先确认每个文件的 import 情况：
```bash
grep -rn "WorkspaceBar\|WorkspaceTab\|AddWorkspaceButton\|NavSideToggle" \
  src/ --include="*.tsx" --include="*.ts" | grep -v "workspace-bar/"
```
凡有引用的地方，先改掉引用再删文件（避免删后 tsc 报错）。

**`use-fullscreen.ts`**：先确认是否仅 WorkspaceBar 用，若还有其他引用则保留。

---

## 二、改 WorkspaceContainer：`.map()` → 单 ws 渲染

**文件**：`src/shell/workspace-container/WorkspaceContainer.tsx`

### 现状
```tsx
export function WorkspaceContainer() {
  const workspaces = useOpenWorkspaces();
  const activeId = useActiveWorkspaceId();

  return (
    <div className="krig-workspace-container">
      {workspaces.map((ws) => (
        <WorkspaceInstance
          key={ws.id}
          state={ws}
          isActive={ws.id === activeId}
        />
      ))}
    </div>
  );
}
```

### 目标（单 ws 直接渲染）
```tsx
import { useActiveWorkspace } from '@workspace/workspace-instance/use-workspace';
import { WorkspaceInstance } from '@workspace/workspace-instance/WorkspaceInstance';
import './workspace-container.css';

export function WorkspaceContainer() {
  const ws = useActiveWorkspace();

  if (!ws) {
    // 启动时 IPC 状态尚未到达的短暂空窗
    return (
      <div className="krig-workspace-container krig-workspace-container--empty">
        <div className="krig-workspace-container-empty">Loading…</div>
      </div>
    );
  }

  return (
    <div className="krig-workspace-container">
      <WorkspaceInstance state={ws} />
    </div>
  );
}
```

删掉：`useOpenWorkspaces`、`useActiveWorkspaceId` 的 import（若不再用）。

---

## 三、改 WorkspaceInstance：去掉 isActive prop 和 display:none

**文件**：`src/workspace/workspace-instance/WorkspaceInstance.tsx`

### 改动点

1. **删除 `isActive` prop**：
```tsx
// 改前
interface WorkspaceInstanceProps {
  state: WorkspaceState;
  isActive: boolean;
}
export function WorkspaceInstance({ state, isActive }: WorkspaceInstanceProps) {

// 改后
interface WorkspaceInstanceProps {
  state: WorkspaceState;
}
export function WorkspaceInstance({ state }: WorkspaceInstanceProps) {
```

2. **删除 `display:none` 切换**：
```tsx
// 改前
<div
  style={{ display: isActive ? 'flex' : 'none' }}
  ...
>

// 改后
<div
  className="krig-workspace-instance"
  ...
>
```
（CSS 里 `.krig-workspace-instance` 已是 `display: flex`，直接生效。）

3. **NavSideToggle 功能移入**：NavSideToggle 原在 WorkspaceBar，删 bar 后需在 WorkspaceInstance 内提供 toggle 入口。

最简方案：在 `NavSideFrame` 旁边或内部加一个 toggle 按钮。先检查 NavSideFrame 里有没有现成的 toggle 逻辑：
```bash
grep -n "toggle\|collapsed\|navSideCollapsed" \
  src/workspace/workspace-instance/nav-side-frame/NavSideFrame.tsx
```

若 NavSideFrame 已有 collapse/expand 的 UI 入口（如拖拽边界双击等），则不需要额外加 toggle；若没有，在 `WorkspaceInstance` 的根 div 内，navSideCollapsed 为 true 时渲染一个简单的展开按钮：

```tsx
// WorkspaceInstance 内，NavSideFrame 渲染之前
{state.navSideCollapsed ? (
  <button
    className="krig-navside-expand-btn"
    onClick={() => workspaceManager.toggleNavSide(state.id)}
    title="展开 NavSide"
    aria-label="Toggle NavSide"
  >
    <PanelLeft size={16} />
  </button>
) : (
  <NavSideFrame ... />
)}
```

> 注意：`workspaceManager.toggleNavSide()` 是**房客 API**（修改本 ws 状态），不走 IPC，直接调 renderer 本地 workspaceManager 即可。

---

## 四、改 renderer/index.tsx

**文件**：`src/platform/renderer/index.tsx`

1. **删除 WorkspaceBar import**：
```typescript
// 删这行
import { WorkspaceBar } from '@shell/workspace-bar/WorkspaceBar';
```

2. **删除渲染中的 `<WorkspaceBar />`**：
```tsx
// 改前
<div className="krig-app__workspace-layer" style={workspaceStyle}>
  <WorkspaceBar />
  <WorkspaceContainer />
</div>

// 改后
<div className="krig-app__workspace-layer" style={workspaceStyle}>
  <WorkspaceContainer />
</div>
```

3. **`reportL3Alive` 调用**（第 138 行）：
```typescript
// 改前
reportL3Alive(workspaceManager.count, workspaceManager.getActiveId());

// 改后（activeId 从 IPC 快照取，或暂时传 null）
reportL3Alive(workspaceManager.count, null);
```

4. **第 73-74 行 bus 初始化**（`workspaceManager.getActiveId()` c2-defer 调用）：
```typescript
// 现状
const _activeId = workspaceManager.getActiveId();
if (_activeId) workspaceManager.getBus(_activeId);
```
这是启动时主动预热 bus 的逻辑。S4 阶段多窗口尚未完全套壳，暂时保留，不改。

---

## 五、CSS 清理

删除 WorkspaceBar 的样式（若独立文件存在）：
```bash
ls src/shell/workspace-bar/*.css 2>/dev/null
```
每个 css 文件随对应组件一起删除。

WorkspaceContainer CSS（`workspace-container.css`）**保留**，布局结构不变。

---

## 验收标准

```bash
# 1. tab 残骸文件已删
ls src/shell/workspace-bar/WorkspaceBar.tsx 2>/dev/null && echo "FAIL" || echo "OK"
ls src/shell/workspace-bar/WorkspaceTab.tsx 2>/dev/null && echo "FAIL" || echo "OK"
ls src/shell/workspace-bar/AddWorkspaceButton.tsx 2>/dev/null && echo "FAIL" || echo "OK"
ls src/shell/workspace-bar/NavSideToggle.tsx 2>/dev/null && echo "FAIL" || echo "OK"

# 2. WorkspaceContainer 不再 .map()
grep -n "workspaces\.map\|\.map((ws)" src/shell/workspace-container/WorkspaceContainer.tsx
# 期望：0行

# 3. WorkspaceInstance 不再有 isActive prop 和 display:none
grep -n "isActive\|display.*none" src/workspace/workspace-instance/WorkspaceInstance.tsx
# 期望：0行

# 4. renderer/index.tsx 不再引用 WorkspaceBar
grep -n "WorkspaceBar" src/platform/renderer/index.tsx
# 期望：0行

# 5. tsc 编译通过
npx tsc --noEmit
```

---

## 注意事项

1. **删文件前务必 grep 引用**：每个删掉的组件，先确认全仓没有其他地方 import 它，否则 tsc 会报错。
2. **`use-fullscreen.ts`**：若只被 WorkspaceBar 用，随之删除；若还有其他引用（如 NavSideFrame），保留。
3. **WorkspaceTab CSS**：WorkspaceTab 的样式（`.krig-workspace-tab` 等）随文件删除；确认 WorkspaceInstance / WorkspaceContainer 的样式不依赖这些类名。
4. **NavSideToggle 的功能**：必须保留（用户还需要折叠/展开 NavSide）。若 NavSideFrame 已有内置 toggle UI 则不需要额外加；若没有，按第三节方案在 WorkspaceInstance 里加最简单的 toggle 按钮即可。
5. **不要动 `workspace-bar/` 目录下其他无关文件**（若有的话）。
6. commit 消息末尾加：`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
