# 里程碑 1 — 框架骨架代码解释

:::callout[NOTE]
**目标**：Workspace + Slot + View 骨架跑通。
一个 Electron 窗口，包含 Toggle + WorkspaceBar + NavSide + Slot Area，验证注册机制和布局系统。
:::

---

:::toggle-heading[## 一、项目结构总览]

```
KRIG-Note/src/
├── main/                     ← Electron main 进程
│   ├── app.ts                ← 应用入口（插件注册 + 生命周期）
│   ├── window/
│   │   └── shell.ts          ← L1 Window（BaseWindow + 多 WebContentsView 布局）
│   │                            包含 toggleView（inline HTML）+ shellView + navSideView
│   ├── workspace/
│   │   └── manager.ts        ← L2 Workspace 状态管理
│   ├── slot/
│   │   └── layout.ts         ← Slot 布局计算（纯函数）
│   ├── view/
│   │   └── registry.ts       ← View 类型注册表 + 实例管理器
│   ├── workmode/
│   │   └── registry.ts       ← WorkMode 注册表
│   ├── ipc/
│   │   └── handlers.ts       ← IPC 路由（Workspace / WorkMode / NavSide）
│   └── preload/
│       ├── shell.ts          ← WorkspaceBar + Toggle 的 API
│       ├── navside.ts        ← NavSide 的 API
│       └── view.ts           ← 通用 View 的 API
├── renderer/
│   ├── shell/
│   │   ├── renderer.tsx      ← WorkspaceBar 入口
│   │   └── WorkspaceBar.tsx  ← WorkspaceBar React 组件
│   └── navside/
│       ├── renderer.tsx      ← NavSide 入口
│       └── NavSide.tsx       ← NavSide React 组件
├── plugins/
│   └── demo/
│       └── renderer.tsx      ← Demo View（空白 View，验证骨架）
└── shared/
    └── types.ts              ← 跨进程共享的类型定义
```

**布局结构**：

```
┌─ toggleView ─┬─ shellView (WorkspaceBar) ─────────────┐
│   ☰ 按钮     │  [Workspace 1 ×]  [+]                  │
├─ navSideView ─┤─ Slot Area（空，待装载 View）──────────┤
│ KRIG Note     │                                        │
│ [A][B][C]     │                                        │
│ ActionBar     │                                        │
│ Search        │                                        │
│ ContentList   │                                        │
└───────────────┴────────────────────────────────────────┘
```

- `toggleView`：左上角固定的 ☰ 按钮（inline HTML，不是独立 renderer）
- `shellView`：WorkspaceBar（Tab 管理）
- `navSideView`：NavSide（导航侧栏）
- Slot Area：空白，等待后续装载 View

:::

:::toggle-heading[## 二、shared/types.ts — 共享类型定义]

### 解决什么问题

main 进程和 renderer 进程是独立的 JavaScript 运行时，它们之间通过 IPC 通信。`types.ts` 定义了双方共享的类型契约，确保通信两端对数据结构的理解一致。

### 核心类型

```typescript
// View 的 4 种基础类型（对应蓝图 view.md §三）
type ViewType = 'note' | 'pdf' | 'web' | 'graph';

// Workspace 的完整状态（对应蓝图 workspace.md §二）
interface WorkspaceState {
  id: WorkspaceId;
  label: string;
  workModeId: string;        // 当前 WorkMode（注册制 id）
  navSideVisible: boolean;
  dividerRatio: number;
  slotBinding: {
    left: ViewInstanceId | null;
    right: ViewInstanceId | null;
  };
}

// View 接口（对应蓝图 view.md §四）
interface ViewInterface {
  create(config: ViewConfig): void;
  show(bounds: Bounds): void;
  hide(): void;
  destroy(): Promise<void>;
  getState(): PersistedViewState;
  restoreState(state: PersistedViewState): void;
  focus(): void;
  blur(): void;
}
```

### IPC 通道常量

所有 IPC 通道名集中在 `IPC` 对象中，避免字符串硬编码散落在代码各处：

```typescript
export const IPC = {
  WORKSPACE_CREATE: 'workspace:create',
  WORKSPACE_SWITCH: 'workspace:switch',
  WORKMODE_SWITCH: 'workmode:switch',
  NAVSIDE_TOGGLE: 'navside:toggle',
  // ...
} as const;
```

### 设计原则关联

- **TypeScript strict 模式**（tech-stack.md §五.4）：类型系统是最基本的"诊断方法"
- **注册制**：`WorkModeRegistration`、`ViewTypeRegistration` 等接口定义了插件注册的契约

:::

:::toggle-heading[## 三、main/app.ts — 应用入口]

### 解决什么问题

定义 Electron 应用的启动流程。这是整个应用的起点。

### 启动流程

```
app.whenReady()
  → 1. registerPlugins()        插件注册（WorkMode）
  → 2. registerIpcHandlers()    IPC 路由
  → 3. workspaceManager.create() 创建默认 Workspace
  → 4. createShell()            创建主窗口
```

### 插件注册区

```typescript
function registerPlugins(): void {
  workModeRegistry.register({
    id: 'demo-a',
    viewType: 'note',
    icon: '📝',
    label: 'Demo A',
    order: 1,
  });
  // ... demo-b, demo-c
}
```

框架不硬编码任何 WorkMode。`registerPlugins()` 是插件的注册入口，当前用 Demo 数据验证机制。未来每个真实插件（Note、PDF、Web）会在这里注册自己的 WorkMode。

### 设计原则关联

- **注册优先**（视图层级定义.md §六.8）：所有功能通过注册机制声明
- **框架与插件分离**（principles.md §五）：app.ts 是框架，registerPlugins 是插件入口

:::

:::toggle-heading[## 四、main/window/shell.ts — 窗口管理]

### 解决什么问题

创建应用的主窗口（Shell），管理内部的 WebContentsView 布局。

### 技术方案

使用 **BaseWindow + WebContentsView** 模式（而非 BrowserWindow）：

- `BaseWindow`：只提供窗口框架，没有自带的 web contents
- `WebContentsView`：独立的 renderer 进程，可以多个并排

当前窗口包含 3 个固定 WebContentsView + N 个动态 View 实例：

**固定 View（框架 UI）**：

| View | 职责 | preload | 加载方式 |
|------|------|---------|---------|
| `toggleView` | 左上角 ☰ 按钮（固定，不随 NavSide 隐藏） | shell.js | inline HTML（data URL） |
| `shellView` | WorkspaceBar（Tab 管理） | shell.js | shell.html（Vite dev server） |
| `navSideView` | NavSide（导航侧栏） | navside.js | navside.html（Vite dev server） |

**动态 View（View 实例池）**：

```typescript
// workModeId → WebContentsView（懒创建）
const viewPool: Map<string, WebContentsView> = new Map();
let activeViewId: string | null = null;
```

每个 WorkMode 对应一个 DemoView 实例。首次切换到某个 WorkMode 时懒创建，之后 show/hide 切换。

### 关键函数

**`createShell()`**：创建 BaseWindow + 3 个固定 WebContentsView，加载 renderer HTML，装载默认 WorkMode 的 View 到 Left Slot。

**`updateLayout()`**：读取当前 Workspace 状态，调用 `calculateLayout()` 计算各 View 的 Bounds，然后 `setBounds()` 更新位置。包括活跃 View 的 bounds。每次窗口 resize 或状态变更时调用。

**`getOrCreateView(workModeId)`**：懒创建 View 实例。检查 viewPool 中是否存在，不存在则创建新的 WebContentsView，加载 DemoView HTML（通过 URL 参数传递 workModeId），加入实例池。

**`switchLeftSlotView(workModeId)`**：切换 Left Slot 显示的 View。隐藏旧 View → 懒创建新 View → 显示新 View → updateLayout。由 IPC handler 的 WORKMODE_SWITCH 调用。

### toggleView 为什么用 inline HTML

Toggle 只是一个按钮，不需要 React 也不需要独立的 Vite dev server。用 `data:text/html` 加载 inline HTML 最简单。它通过 shell preload 暴露的 `shellAPI.toggleNavSide()` 与 main 进程通信。

### 开发中遇到的问题

1. **preload 路径**：electron-forge + vite 构建后，所有文件打平到 `.vite/build/`，preload 路径用 `path.join(__dirname, 'shell.js')` 而非子目录
2. **renderer HTML 位置**：forge 的 vite 插件要求 HTML 入口文件在**项目根目录**，不能放在子目录
3. **dev server URL**：加载时需要拼接 HTML 文件名：`${URL}/shell.html`
4. **BaseWindow vs BrowserWindow**：BaseWindow 没有自带 web contents，需要手动添加 WebContentsView。这比 BrowserWindow 更灵活，适合多 View 并排的场景

### 设计原则关联

- **Window = Shell，1:1**（视图层级定义.md §2.2）
- **Toggle 固定左上角**：不随 NavSide 显隐，收起时仍可点击展开
- **跨平台**（tech-stack.md §五.5）：`titleBarStyle: 'hiddenInset'` 是 macOS 风格，Windows 需要适配

:::

:::toggle-heading[## 五、main/workspace/manager.ts — Workspace 状态管理]

### 解决什么问题

管理所有 Workspace 的创建、切换、关闭、状态更新。Workspace 是逻辑实体，不是 UI 组件。

### 核心 API

```typescript
workspaceManager.create(label?)      // 创建新 Workspace
workspaceManager.setActive(id)       // 切换活跃 Workspace
workspaceManager.getActive()         // 获取当前活跃 Workspace
workspaceManager.update(id, partial) // 更新 Workspace 状态
workspaceManager.close(id)           // 关闭 Workspace
```

### 关键行为

- **至少一个 Workspace**：关闭最后一个时自动创建新的（workspace.md §七.1）
- **默认 WorkMode**：新 Workspace 的 `workModeId` 从 WorkMode 注册表获取 order 最小的
- **状态不可变模式**：`update()` 返回新对象，不修改原对象

### 设计原则关联

- **Workspace 是逻辑实体**（视图层级定义.md §2.3）
- **Workspace 隔离**（workspace.md §七.3）：不同 Workspace 的 View 实例无关联

:::

:::toggle-heading[## 六、main/slot/layout.ts — 布局计算]

### 解决什么问题

根据窗口大小、NavSide 可见性、分割比例，计算所有 UI 区域的精确 Bounds（x, y, width, height）。

### 纯函数设计

```typescript
function calculateLayout(
  windowWidth, windowHeight,
  navSideVisible, hasRightSlot, dividerRatio
): LayoutResult
```

输入是数值，输出是 Bounds 对象。不依赖任何全局状态，便于测试。

### 布局常量

| 常量 | 值 | 说明 |
|------|------|------|
| `NAVSIDE_WIDTH` | 240px | NavSide 展开宽度 |
| `TOP_BAR_HEIGHT` | 36px | WorkspaceBar + Toggle 高度 |
| `TOGGLE_WIDTH` | 40px | Toggle 按钮区域宽度 |
| `DIVIDER_WIDTH` | 1px | 左右 Slot 分割线 |

### 关键逻辑

- Toggle 固定在左上角（0, 0, 40, 36），不随 NavSide 显隐
- NavSide 收起时，WorkspaceBar 从 `TOGGLE_WIDTH`（40px）开始
- NavSide 展开时，WorkspaceBar 从 `NAVSIDE_WIDTH`（240px）开始
- 双 Slot 时，按 `dividerRatio` 分割 Slot Area

### 设计原则关联

- **Slot 是纯布局位置**（视图层级定义.md §2.4）：只计算坐标和尺寸，不关心内容

:::

:::toggle-heading[## 七、main/workmode/registry.ts — WorkMode 注册表]

### 解决什么问题

管理所有已注册的 WorkMode。框架不知道有几种 WorkMode，只提供注册接口。

### 核心 API

```typescript
workModeRegistry.register(registration)  // 插件注册一个 WorkMode
workModeRegistry.getAll()                // 获取所有（按 order 排序）
workModeRegistry.getDefault()            // 获取默认（order 最小的）
```

### 设计原则关联

- **WorkMode 注册制**（workmode.md §一）：框架不硬编码
- 每个 WorkMode = ViewType + variant 的组合

:::

:::toggle-heading[## 八、main/ipc/handlers.ts — IPC 路由]

### 解决什么问题

连接 renderer 进程（WorkspaceBar、NavSide）和 main 进程的状态管理器。

### 通信模式

```
renderer (invoke) ──→ main (handle) ──→ manager 操作
                                              │
                                              ├──→ updateLayout()    重新计算布局
                                              └──→ broadcastState()  广播给所有 renderer
```

1. renderer 通过 `ipcRenderer.invoke()` 发起请求
2. main 的 `ipcMain.handle()` 处理请求，调用 manager
3. 操作完成后：
   - `updateLayout()` 重新计算布局（NavSide 可见性等可能变了）
   - `broadcastWorkspaceState()` 广播新状态给所有 renderer

### 设计原则关联

- **跨 View 通信经过路由**（视图层级定义.md §六.7）：renderer 不直接互相通信

:::

:::toggle-heading[## 九、preload 脚本 — API 暴露]

### 解决什么问题

Electron 的安全模型要求 `contextIsolation: true`，renderer 无法直接访问 Node.js API。preload 脚本通过 `contextBridge.exposeInMainWorld()` 暴露安全的 API。

### 三个 preload

| preload | 暴露的 API | 使用者 |
|---------|-----------|--------|
| `shell.ts` | `window.shellAPI`（Workspace 操作 + NavSide toggle） | WorkspaceBar + Toggle |
| `navside.ts` | `window.navSideAPI`（WorkMode 操作 + 状态监听） | NavSide |
| `view.ts` | `window.viewAPI`（状态监听） | 所有 View 插件 |

### 状态监听模式

每个 preload 都暴露 `onStateChanged(callback)` 方法，返回取消监听的函数：

```typescript
onStateChanged: (callback) => {
  const listener = (_event, state) => callback(state);
  ipcRenderer.on(IPC.WORKSPACE_STATE_CHANGED, listener);
  return () => ipcRenderer.removeListener(...);
}
```

renderer 组件在 `useEffect` 中订阅，cleanup 时取消。

:::

:::toggle-heading[## 十、renderer 组件]

### WorkspaceBar.tsx

**职责**：显示 Workspace Tab 列表，支持创建/切换/关闭 Workspace。

**数据流**：

```
初始化 → shellAPI.listWorkspaces() → setState
用户操作 → shellAPI.xxxWorkspace() → main 处理 → broadcastState → onStateChanged → setState
```

### NavSide.tsx

**职责**：Brand Bar + 横向 ModeBar + ActionBar + Search + ContentList 占位。

**ModeBar**：横向 Tab 排列（图标上 + 文字下），从 `navSideAPI.listWorkModes()` 获取注册的 WorkMode 列表。点击切换调用 `navSideAPI.switchWorkMode(id)`。

### Demo View (plugins/demo/renderer.tsx)

**职责**：验证 View 生命周期和 WorkMode 切换联动。

**WorkMode 感知**：通过 URL search params（`?workModeId=demo-a`）接收当前 WorkMode，显示对应的图标、颜色和说明：

| workModeId | 标题 | 颜色 | 说明 |
|------------|------|------|------|
| demo-a | Note View | 蓝色 | NoteView 插件占位 |
| demo-b | PDF View | 红色 | PDFView 插件占位 |
| demo-c | Web View | 绿色 | WebView 插件占位 |

**View 结构**：每个 DemoView 内部包含 Toolbar（顶部 36px）+ Content（居中显示信息），验证了 view.md 中定义的 View 统一结构。

:::

:::toggle-heading[## 十一、构建配置]

### forge.config.ts

定义了 Electron Forge 的构建入口：

- **build**（main + preload）：4 个入口（app.ts + 3 个 preload）
- **renderer**：3 个独立的 Vite dev server（shell、navside、demo_view）

### vite 配置

每个 renderer 有独立的 vite 配置文件（`.mts` 扩展名），通过 `build.rollupOptions.input` 指定对应的 HTML 入口：

| 配置文件 | HTML 入口 | renderer name |
|---------|----------|---------------|
| `vite.shell.config.mts` | `shell.html` | `shell` |
| `vite.navside.config.mts` | `navside.html` | `navside` |
| `vite.demo-view.config.mts` | `demo-view.html` | `demo_view` |

### 关键经验

1. HTML 入口文件必须在**项目根目录**（forge vite 插件的约束）
2. vite 配置文件必须用 `.mts` 扩展名（ESM 兼容，`.ts` 会报 require ESM 错误）
3. dev server URL 加载时要拼接 HTML 文件名：`${URL}/shell.html`
4. 构建输出打平到 `.vite/build/`，preload 用 `path.join(__dirname, 'xxx.js')`
5. `package.json` 的 `main` 字段必须指向正确的构建输出文件名（`app.js` 而非 `main.js`）

:::

:::toggle-heading[## 十二、当前状态和下一步]

### 已验证

- ✅ BaseWindow + WebContentsView 多进程架构
- ✅ Toggle 固定左上角，点击收起/展开 NavSide
- ✅ WorkMode 注册机制（插件注册 → NavSide ModeBar 显示）
- ✅ Workspace 创建/切换/关闭（"+" 紧跟 Tab）
- ✅ NavSide：Brand Bar（Logo + KRIG）+ 横向 ModeBar + Action Bar（标题 + 操作按钮）
- ✅ 布局计算（纯函数，响应窗口 resize）
- ✅ IPC 双向通信（invoke/handle + 状态广播 + 布局更新）
- ✅ **Left Slot 装载 DemoView**，WorkMode 切换联动
- ✅ **View 懒创建**（首次切换创建，再次切换 show/hide）
- ✅ **Action Bar 随 WorkMode 切换**（标题 + 操作按钮跟着变化）

### 已知限制（待下一步解决）

- ⚠️ 多 Workspace 共享同一个 View 池（应该每 Workspace 独立）
- ⚠️ Workspace 切换时 View 没有跟着切换
- ⚠️ Action Bar 内容硬编码在 NavSide 组件中（应通过注册机制）

### 下一步

- Workspace 隔离（每 Workspace 独立 View 实例池）
- Workspace 切换时 View 跟着切换
- 第二个里程碑规划

:::
