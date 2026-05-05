# src/workspace — 详细设计

> v0.1 · 2026-05-05 · 草稿,等用户审阅
>
> 配套:[charter.md v0.4 § 1.4 + § 2.2](../../docs/00-architecture/charter.md) + [view-hierarchy-v2.md](../../docs/RefactorV2/view-hierarchy-v2.md) + [src/shell/DESIGN.md v0.3](../shell/DESIGN.md)

---

## 1. 本层范围(L3 — 完整自包含 Workspace)

L3 Workspace 层是 V2 架构的**核心**——按 charter § 1.4,所有应用级 UI(NavSide / Toolbar / 5 大交互浮层 / 通用 Overlay)都归 Workspace Container 管式样。

L3 阶段做 6 件事:

```
src/workspace/
├── workspace-state/         ← Workspace 状态 + WorkspaceManager(纯逻辑层)
├── workspace-instance/      ← 单 Workspace 实例(完整 React 组件树)
│   ├── nav-side-frame/      ← 左侧 NavSide 容器(式样)
│   ├── toolbar-frame/       ← 顶部 Toolbar 容器(式样)
│   ├── slot-area/           ← 中央 Slot 区(Left + Divider + Right)
│   └── overlay-frames/      ← 浮层 mount 点(5 大交互 + 通用)
├── persistence/             ← localStorage 持久化(可平滑迁移到 SurrealDB)
└── diagnostics/             ← L3 自我诊断
```

**L3 阶段完成后,用户能看到**:
- 完整三栏布局(NavSide + Slot Area)
- Toggle 实际可折叠 NavSide
- [+] 创建新 Workspace,Tabs 显示并可切换
- 重启状态恢复(localStorage)
- Workspace 隔离(切 A↔B 时 NavSide 折叠状态独立)
- 4 大 Overlay frame 就位(空,等 L4 Registry 注册内容)

---

## 2. V1 学习总结

### 2.1 V1 现状盘点

V1 Workspace 在 `src/main/workspace/manager.ts`(141 行) + `src/main/workmode/registry.ts`(37 行)。

**V1 manager.ts 核心**(逻辑层,纯数据):
- `Map<id, WorkspaceState>` 实例池
- `create / restore / setActive / getActive / get / getAll / update / close / rename / reorder` API
- 简洁,V2 大体沿用

**V1 WorkMode Registry**:
- 各插件注册 `demo-a Note / demo-b EBook / demo-c Web` 等
- 决定每个 Workspace 的 view 类型

**V1 Workspace 不持有 React 组件**——V1 用 5 个 WebContentsView,通过主进程 setBounds 摆位。React 组件分散在各 plugin。

### 2.2 V1 教训(必须避免)

#### 教训 1:WorkspaceState 散落业务字段

V1 `WorkspaceState` 含:
```ts
{
  id, label, workModeId, navSideVisible, navSideWidth, dividerRatio,
  activeNoteId,             // ← Note 业务字段
  rightActiveNoteId,        // ← Note 业务字段(Right Slot 时)
  expandedFolders,          // ← Note 业务字段
  activeBookId,             // ← EBook 业务字段
  ebookExpandedFolders,     // ← EBook 业务字段
  activeGraphId,            // ← Graph 业务字段
  slotBinding: { left, right },
}
```

**问题**:WorkspaceState 知道每个业务的具体字段名 → 加新业务(如 web)要改 WorkspaceState 类型。这违反"业务隔离"。

V1 memory 已记录此架构债:`project_active_resource_id_arch_debt`。

**V2 改进**:业务字段全走 `pluginStates: Record<string, unknown>`(charter § 1.1 强制规则)。

#### 教训 2:WorkMode 概念污染

V1 WorkMode 在 V2 哲学下是冗余概念(charter § 1.4 "view 是能力组合声明")。

V2 概念清晰化:**取消 WorkMode,用 viewType**(每个 Workspace 当前激活的 view ID)。

#### 教训 3:Workspace 渲染散落

V1 Workspace 是纯数据,React 组件分散在各 plugin(NoteView / GraphView / 等)各自实现。导致 NavSide / Toolbar / 浮层等"应用级 UI"被 view 各自重复实现 → 视觉碎裂。

**V2 改进**(charter § 1.4 落地):
- Workspace 是**完整自包含的 React 组件树**
- NavSide / Toolbar / 浮层 frame 由 Workspace 统一提供式样
- view 通过 Registry 注册内容,Workspace 负责渲染

#### 教训 4:NavSide 全局共享(违反 Workspace 隔离)

V1 NavSide 是 Shell 全局组件,所有 Workspace 共享一份。导致:
- 切 Workspace 时,NavSide 状态(展开 / 选中)无法独立
- "Workspace 完全隔离"承诺破

**V2 改进**(view-hierarchy-v2.md § 0):
- NavSide 归 Workspace Container,每个 Workspace 自带
- 切 Workspace = NavSide 实例切换 + 状态独立

### 2.3 V1 可复用的部分

#### WorkspaceManager 核心 API

V1 `create / restore / setActive / get / getAll / update / close / rename / reorder` 设计良好,V2 沿用(去掉散落字段相关参数)。

#### dividerRatio 作 Slot Area 内 Left/Right 比例

V1 用 `dividerRatio: number`(0.5 = 50/50)。V2 沿用。

#### slotBinding(每个 Slot 装什么)

V1 用 `slotBinding: { left: viewId, right: viewId }`。V2 简化(去掉 V1 的 viewType vs viewInstance 复杂,直接 viewId)。

---

## 3. V2 workspace 子目录设计

### 3.1 顶层结构

```
src/workspace/
├── README.md
├── DESIGN.md(本文件)
├── workspace-state/
│   ├── workspace-state.ts          (WorkspaceState 类型定义)
│   ├── workspace-manager.ts        (WorkspaceManager 类 — V1 简化版)
│   ├── plugin-states.ts            (pluginStates 操作 helper)
│   ├── default-state.ts            (createDefaultWorkspaceState 工厂)
│   └── README.md
├── workspace-instance/
│   ├── WorkspaceInstance.tsx       (单 Workspace React 组件树根)
│   ├── nav-side-frame/
│   │   ├── NavSideFrame.tsx        (左侧侧边栏式样容器)
│   │   ├── nav-side-frame.css
│   │   └── README.md
│   ├── toolbar-frame/
│   │   ├── ToolbarFrame.tsx        (顶部工具栏式样容器)
│   │   ├── toolbar-frame.css
│   │   └── README.md
│   ├── slot-area/
│   │   ├── SlotArea.tsx            (中央 Slot 区根)
│   │   ├── LeftSlot.tsx            (左 Slot 容器)
│   │   ├── RightSlot.tsx           (右 Slot 容器)
│   │   ├── ResizableDivider.tsx    (可拖拽分隔线,改 dividerRatio)
│   │   ├── slot-area.css
│   │   └── README.md
│   ├── overlay-frames/
│   │   ├── ContextMenuFrame.tsx    (右键菜单容器,等 L4 注册内容)
│   │   ├── SlashMenuFrame.tsx      (Slash 菜单容器)
│   │   ├── HandleMenuFrame.tsx     (Handle 菜单容器)
│   │   ├── FloatingToolbarFrame.tsx (浮动工具条容器)
│   │   ├── GenericOverlayFrame.tsx  (通用浮层容器)
│   │   ├── overlay-frames.css
│   │   └── README.md
│   └── workspace-instance.css
├── persistence/
│   ├── local-storage.ts            (localStorage 读写)
│   ├── persistence-api.ts          (抽象接口,未来可换 SurrealDB)
│   └── README.md
└── diagnostics/
    └── L3-alive.ts                 (L3 自我诊断,IPC 上报)
```

### 3.2 各子模块职责

#### `workspace-state/workspace-state.ts`

```ts
import type { ViewId } from '@semantic/...'; // 暂用 string

export interface WorkspaceState {
  id: string;                       // 唯一标识(`ws-${counter}`)
  label: string;                    // Tab 显示
  customLabel: boolean;              // 用户自定义标签
  navSideCollapsed: boolean;         // NavSide 折叠状态
  navSideWidth: number | null;       // NavSide 宽度(可拖拽,默认 null = 用默认)
  dividerRatio: number;              // Slot Area Left/Right 比例(0~1)
  slotBinding: {
    left: string | null;             // viewId
    right: string | null;
  };
  pluginStates: Record<string, unknown>;  // 业务字段全在这
  createdAt: number;
}
```

#### `workspace-state/workspace-manager.ts`

```ts
class WorkspaceManager {
  private workspaces: Map<string, WorkspaceState> = new Map();
  private activeId: string | null = null;
  private counter = 0;
  private listeners: Set<() => void> = new Set();   // 订阅变化

  create(label?: string): WorkspaceState { /* ... */ }
  restore(state: WorkspaceState): WorkspaceState { /* ... */ }
  setActive(id: string): WorkspaceState | undefined { /* ... */ }
  getActive(): WorkspaceState | undefined { /* ... */ }
  getAll(): WorkspaceState[] { /* ... */ }
  update(id: string, partial: Partial<WorkspaceState>): WorkspaceState | undefined { /* ... */ }
  close(id: string): string | null { /* ... */ }
  rename(id: string, label: string): void { /* ... */ }

  // V2 新增:NavSide Toggle 助手
  toggleNavSide(id: string): void {
    const ws = this.get(id);
    if (ws) this.update(id, { navSideCollapsed: !ws.navSideCollapsed });
  }

  // 订阅(让 React 组件感知变化)
  subscribe(listener: () => void): () => void { /* ... */ }

  // 持久化
  loadFromPersistence(): void { /* ... */ }
  saveToPersistence(): void { /* ... */ }
}

export const workspaceManager = new WorkspaceManager();
```

**V2 vs V1 差异**:
- WorkspaceState 字段精简(去散落业务字段,加 navSideCollapsed)
- 加 `subscribe / toggleNavSide / loadFromPersistence / saveToPersistence`
- `useSyncExternalStore` 友好(React 18+ 标准模式)

#### `workspace-state/plugin-states.ts`

```ts
// 帮助函数:操作 pluginStates 字段
export function getPluginState<T>(state: WorkspaceState, plugin: string): T | undefined {
  return state.pluginStates[plugin] as T | undefined;
}

export function setPluginState<T>(state: WorkspaceState, plugin: string, partial: Partial<T>): WorkspaceState {
  return {
    ...state,
    pluginStates: {
      ...state.pluginStates,
      [plugin]: { ...(state.pluginStates[plugin] as object), ...partial },
    },
  };
}
```

L5 view 通过这两个函数读写 pluginStates,例如:
```ts
// views/note/index.ts(未来)
const noteState = getPluginState<NoteState>(workspace, 'note');
workspaceManager.update(workspace.id, {
  pluginStates: setPluginState(workspace, 'note', { activeNoteId: 'abc' }).pluginStates,
});
```

#### `workspace-instance/WorkspaceInstance.tsx`

```tsx
// 单 Workspace 完整 React 组件树
// 接收 WorkspaceState 作 prop,渲染 6 个 frame
import { NavSideFrame } from './nav-side-frame/NavSideFrame';
import { ToolbarFrame } from './toolbar-frame/ToolbarFrame';
import { SlotArea } from './slot-area/SlotArea';
import { OverlayFrames } from './overlay-frames';

export function WorkspaceInstance({ state, isActive }: { state: WorkspaceState; isActive: boolean }) {
  // 非活跃 Workspace 用 visibility hidden 保留状态
  return (
    <div
      className="krig-workspace-instance"
      style={{ display: isActive ? 'flex' : 'none' }}
      data-workspace-id={state.id}
    >
      {!state.navSideCollapsed && <NavSideFrame width={state.navSideWidth} />}
      <div className="krig-workspace-main">
        <ToolbarFrame />
        <SlotArea
          slotBinding={state.slotBinding}
          dividerRatio={state.dividerRatio}
          onDividerChange={(ratio) => workspaceManager.update(state.id, { dividerRatio: ratio })}
        />
      </div>
      <OverlayFrames />
    </div>
  );
}
```

#### `workspace-instance/nav-side-frame/NavSideFrame.tsx`

```tsx
// 左侧 NavSide 容器(式样,内容由 navSideRegistry 注册)
// L3 阶段:占位空容器,等 L4 navSideRegistry 落地
export function NavSideFrame({ width }: { width: number | null }) {
  const w = width ?? 224;  // 默认宽度
  return (
    <div className="krig-nav-side-frame" style={{ width: w }}>
      <div className="krig-nav-side-empty">NavSide (待 L4 Registry 注册内容)</div>
    </div>
  );
}
```

#### `workspace-instance/toolbar-frame/ToolbarFrame.tsx`

```tsx
// 顶部 Toolbar 容器(式样,内容由 toolbarRegistry 注册)
// L3 阶段:占位空容器
export function ToolbarFrame() {
  return (
    <div className="krig-toolbar-frame">
      <div className="krig-toolbar-empty">Toolbar (待 L4)</div>
    </div>
  );
}
```

#### `workspace-instance/slot-area/`

Slot Area 含 Left + Divider + Right。L3 阶段实现:
- LeftSlot / RightSlot 是空容器(等 L5 view mount)
- ResizableDivider 拖拽改 dividerRatio
- 单 Slot 模式(slotBinding.right === null)时 LeftSlot 全宽,无 Divider

#### `workspace-instance/overlay-frames/`

5 个 Overlay frame:
- `ContextMenuFrame`(右键菜单,定位算法)
- `SlashMenuFrame`(Slash 菜单)
- `HandleMenuFrame`(Handle 菜单)
- `FloatingToolbarFrame`(选区上方)
- `GenericOverlayFrame`(通用浮层)

L3 阶段:**5 个 frame 都是空容器**,等 L4 Registry 注册内容时显示。

#### `persistence/`

```ts
// persistence-api.ts — 抽象接口
export interface PersistenceAPI {
  load(): WorkspaceManagerState | null;
  save(state: WorkspaceManagerState): void;
  clear(): void;
}

// local-storage.ts — localStorage 实现
export const localStoragePersistence: PersistenceAPI = {
  load() { /* localStorage.getItem('krig-v2-workspace') */ },
  save(state) { /* localStorage.setItem(...) */ },
  clear() { /* localStorage.removeItem(...) */ },
};
```

未来可在 `persistence/surreal-storage.ts` 加 SurrealDB 实现,WorkspaceManager 接口不变。

#### `diagnostics/L3-alive.ts`

```ts
export function reportL3Alive(workspaceCount: number, activeId: string | null) {
  window.electronAPI.reportAlive({
    layer: 'L3',
    details: {
      workspaces: workspaceCount,
      active: activeId ?? 'none',
    },
  });
}
```

---

## 4. V1 → V2 改进对比表

| 维度 | V1 | V2 |
|---|---|---|
| WorkspaceState | 13 字段(含散落业务字段) | 9 字段(框架字段 + pluginStates 字典) |
| WorkMode 概念 | 存在(workmode/registry) | **取消**,用 viewType |
| Workspace 渲染 | 散落各 plugin,view 自带 | 统一 React 组件树(WorkspaceInstance) |
| NavSide 归属 | Shell 全局共享 | **每个 Workspace 自带**(隔离) |
| Toolbar 归属 | view 自带 | **Workspace Container 管式样**,view 注册内容 |
| 5 大交互浮层 | view 自带 | **Workspace Container 管式样**,view 注册内容 |
| 持久化 | SurrealDB + Session JSON | localStorage(L3 阶段),平滑接口可换 SurrealDB |
| 切 Workspace | 主进程 setBounds 切 WebContentsView | React display 切换(状态保留) |
| 内存占用 | N 个 WebContentsView | 单一 React 组件树,visibility 切换 |

---

## 5. 调用关系(纵向架构验证)

```
src/platform/renderer/index.tsx (L1 renderer 入口)
    ↓ 渲染
<App> = WorkspaceBar + WorkspaceContainer (L2 Shell)
    ↓ WorkspaceContainer mount
<WorkspaceInstance state={...}>×N (L3,每个 Workspace 一个,只显示活跃的)
    ├── NavSideFrame
    ├── ToolbarFrame
    ├── SlotArea(Left + Divider + Right)
    └── OverlayFrames(5 个)

WorkspaceManager (L3 纯逻辑,Map<id, State>)
    ↑ React 通过 useSyncExternalStore 订阅
    ↓ 持久化
PersistenceAPI(localStorage,L3 阶段)
```

---

## 6. L3 阶段实施目标

### 6.1 完成判据(charter § 6.3)

- [ ] `npm start` 跑得起来(L0+L1+L2 不回归)
- [ ] 屏幕看到完整 Workspace 框架:
  - 默认创建 1 个 Workspace
  - WorkspaceBar 显示 1 个 Tab(活跃)
  - 中间区域:NavSide(左 224px 占位)+ Slot Area(Left 全宽,无 Right)
- [ ] Toggle 实际可折叠 NavSide(点击 ≡ → NavSide 消失,再点击 → 显示)
- [ ] [+] 按钮可创建新 Workspace(Tab 增加,自动切到新 Workspace)
- [ ] Tab 点击可切换 Workspace
- [ ] Tab × 关闭 Workspace
- [ ] 重启状态恢复(localStorage 持久化:Workspaces 列表 + activeId + 各 Workspace 状态)
- [ ] Workspace 隔离验证:WS A 折叠 NavSide,切到 WS B 看到 NavSide 展开(各自独立)
- [ ] console 输出 `[L3] alive | workspaces: 1, active: 'ws-1'`
- [ ] 健康检查 IPC `health.L3` 返回 alive

### 6.2 实施清单(预估 ~30 文件)

#### workspace-state/(4 文件)
- workspace-state.ts(类型)
- workspace-manager.ts(管理类)
- plugin-states.ts(helper)
- default-state.ts(工厂)

#### workspace-instance/(15 文件)
- WorkspaceInstance.tsx
- workspace-instance.css
- nav-side-frame/(3 文件)
- toolbar-frame/(3 文件)
- slot-area/(5 文件:SlotArea/LeftSlot/RightSlot/ResizableDivider/css)
- overlay-frames/(7 文件:5 frame + index + css)

#### persistence/(3 文件)
- local-storage.ts
- persistence-api.ts
- README.md

#### diagnostics/(1 文件)
- L3-alive.ts

#### shell/workspace-bar/(3 文件修改 — 接入 WorkspaceManager)
- WorkspaceBar.tsx(渲染真实 Tabs from manager)
- NavSideToggle.tsx(触发 toggleNavSide)
- AddWorkspaceButton.tsx(触发 create)
- WorkspaceTab.tsx(已存在,接入 setActive / close)

#### platform/renderer/index.tsx(修改)
- mount WorkspaceContainer 改为渲染所有 WorkspaceInstance(visibility 切换)

#### shell/workspace-container/WorkspaceContainer.tsx(修改)
- 从 manager 拿所有 Workspaces,渲染 WorkspaceInstance×N

#### shared/ipc + L0(扩展)
- 加 health.L3 channel
- 加 IPC channel,如有需要

### 6.3 不做的事(L3 范围严格)

- ❌ 5 大交互 Overlay 内容(L4 Registry 才注册)
- ❌ Toolbar 内容(L4)
- ❌ NavSide 内容(L4)
- ❌ 任何具体 view(L5)
- ❌ 任何能力(capabilities/,L4+L5)
- ❌ 业务 npm 包

### 6.4 自我诊断输出预期

```
[L0] alive | electron: 40.9.3, ...
[L1] alive | window id: 1, size: 1200x800
[L2] alive | shell: rendered, ...
[L3] alive | workspaces: 1, active: 'ws-1'
```

---

## 7. 与 charter 原则的对照

| charter 原则 | L3 如何遵守 |
|---|---|
| § 1.1 分层(纵向 4 + 横向 L0~L5) | L3 仅做 Workspace 状态 + 实例,不超越 L4 / L5 |
| § 1.2 注册原则 | L3 不直接 import view 实现,通过 ViewTypeRegistry / 各 frame Registry 间接 |
| § 1.3 抽象原则(npm 屏障) | L3 不 import 业务 npm,只用 react / lucide-react / clsx 等白名单 |
| **§ 1.4 视图与实现归属** | **L3 实现 Workspace Container 管式样**(NavSide / Toolbar / Slot / 5 大交互浮层 / 通用 Overlay 的式样容器);view 平等 + 无 variant + 内容由 L4 Registry 注册 |
| § 5 自我诊断 | `[L3] alive` IPC 上报 |
| § 6 节奏规则 | 一阶段做完(选项 A 严格)+ 不留技术债 |

---

## 8. 待拍板

- [ ] WorkspaceManager 是否暴露给主进程 IPC?
   - 当前设计:WorkspaceManager 在 renderer 进程内(单页应用风格),持久化通过 localStorage
   - 替代:WorkspaceManager 在主进程,renderer 通过 IPC 操作(V1 风格)
   - 我倾向:**renderer 内**(单页应用 + localStorage,与 V2 单 BrowserWindow 架构一致)
- [ ] localStorage key 命名 — 默认 `krig-v2-workspace-state`?
- [ ] 默认创建 1 个 Workspace 的 label — 默认 "Workspace 1"?
- [ ] Tab 关闭最后一个 Workspace 时 — V1 是"自动创建一个新的",V2 是否沿用?(我倾向**沿用** — 至少保留 1 个)
- [ ] NavSide 默认宽度 — V1 是 224px,V2 沿用?
- [ ] dividerRatio 拖拽限制 — V1 是 0.2~0.8,V2 沿用?

---

## 9. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-05 | v0.1 | 初稿;V1 学习(manager.ts 141 行 + workmode/registry.ts 37 行)+ 4 条 V1 教训(散落字段 / WorkMode 污染 / 渲染散落 / NavSide 全局)+ V2 子目录设计(workspace-state / workspace-instance / persistence / diagnostics)+ 30 文件实施清单 + 6 个待拍板 |
