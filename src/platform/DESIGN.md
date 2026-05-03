# src/platform — 详细设计

> v0.1 · 2026-05-03 · 草稿,等用户审阅
>
> 配套:[charter.md](../../docs/00-architecture/charter.md) + [directory-structure.md v0.3](../../docs/00-architecture/directory-structure.md)

---

## 1. 本层范围

平台层是 **L0 应用层 + L1 窗口层** 的实现:

- **L0 应用**:Electron app 生命周期 + 启动入口 + IPC 总线
- **L1 窗口**:BrowserWindow 创建 + 窗口管理(主窗口 / 设置窗口等)

按 charter v0.3 § 1.1 横向分层定义,平台层是其他横向层(L2 Shell / L3 Workspace / L4 Slot / L5 View)的**底座**。

---

## 2. V1 学习总结

### 2.1 V1 入口现状

V1 入口在 [`/Users/wenwu/Documents/VPN-Server/KRIG-Note/src/main/app.ts`](../../docs/99-archive-v1/refactor/00-总纲.md)(282 行)。

#### V1 app.ts 干了什么(逐项盘点)

| 阶段 | V1 做的事 | 应在哪一层 |
|---|---|---|
| 0a | `nativeTheme.themeSource = 'dark'` | L2 Shell(主题相关)|
| 0b | `mediaStore.registerProtocol()` | L0 协议注册(平台层)|
| 1a | `registerNotePlugin / EBookPlugin / WebPlugin / ThoughtPlugin / GraphPlugin` | L4 Slot(插件注册到 Registry)|
| 1b | `registerFrameworkMenus()`(View / Window / Help)| L4 Slot(菜单注册)|
| 2a | `registerIpcHandlers(getMainWindow)` | L0 平台层(IPC 总线)|
| 2b | `setupDividerController(getMainWindow)` | L2 Shell(分隔线控制)|
| 3 | 恢复 / 创建 Workspace | L3 Workspace |
| 4 | `createShell()` | L1 窗口 + L2 Shell(混合)|
| 5 | `menuRegistry.rebuild()` | L4 Slot(菜单 Registry)|
| 6 | `initSurrealDB / initSchema / migrateJsonToSurreal` | 存储层(数据库初始化)|
| 收尾 | `setInterval(persistSession, 30_000)` | L3 Workspace(状态持久化)|
| 收尾 | `app.on('before-quit') → persistSession + shutdownSurrealDB` | L3 + 存储层 |
| 收尾 | `app.on('window-all-closed') / 'activate'` | L0 应用(生命周期)|

**问题**:V1 app.ts 把 L0~L4 + 存储层 6 个层的逻辑全塞在 282 行内,**严重违反分层原则**。

### 2.2 V1 教训(必须避免)

#### 教训 1:入口巨石化

V1 app.ts 是"上帝模块"——什么都做。结果:
- 加新 plugin 要改 app.ts
- 改 Workspace 恢复逻辑要改 app.ts
- 调诊断输出要改 app.ts
- 没有清晰责任,改一处需要担心副作用

**V2 改进**:platform/main/index.ts **只做 L0+L1 责任**——其他层各自有自己的 init 逻辑,通过 Registry 注册。

#### 教训 2:零自我诊断

V1 app.ts 启动只有少数 console.log(`[KRIG] SurrealDB ready`、`[Shell] Active workspace`),**没有结构化诊断**。问题排查靠运气。

**V2 改进**:每层启动时输出 `[Lx] alive | ...` 诊断行。问题时输出 `[Lx] INIT FAILED | reason: ... | next layer WILL NOT START`。

#### 教训 3:plugin import 硬编码

V1 app.ts 顶部硬编码 5 个 plugin import:
```ts
import { register as registerNotePlugin } from '../plugins/note/main/register';
import { register as registerEBookPlugin } from '../plugins/ebook/main/register';
// ...
```

加新 plugin = 改 app.ts。这违反了 charter § 1.2 注册原则("视图通过 install 列表声明,**不直接 import 实现**")。

**V2 改进**:platform 不直接 import 任何 view / capability。views 自己 import 自己的入口注册到 ViewRegistry,platform 只触发"加载所有注册"。

#### 教训 4:ProseMirror / Three.js 直接 import 越层

V1 plugins/<X>/ 直接 import prosemirror / three / pdfjs 等业务 npm。这是 charter § 1.3 抽象原则的违反。

**V2 改进**:platform 严格不 import 业务 npm。能力封装由 capabilities/ 负责,platform 只通过 IPC 与之通信(必要时)。

#### 教训 5:窗口创建混入 Shell 布局

V1 `createShell()` 函数(531 行)做了 L1(创建 BrowserWindow)+ L2(创建 ToggleView/ShellView/NavSideView/NavResizeView/OverlayView 5 个 WebContentsView)+ L4 加载布局所有事。

**V2 改进**:platform/main/window/ 只创建 BrowserWindow + 监听窗口事件。Shell 视图(L2)由 src/shell/ 自己处理,通过 IPC 注入到主窗口。

#### 教训 6:存储层逻辑泄漏到入口

V1 app.ts 直接 import `initSurrealDB / initSchema / migrateJsonToSurreal`,把存储层启动顺序硬编码在 app.ts 内。

**V2 改进**:platform 只触发"启动所有已注册的服务",存储层自己注册一个启动 hook,platform 不知道是哪个数据库。

---

## 3. V2 platform 子目录设计

```
src/platform/
├── README.md
├── DESIGN.md(本文件)
├── main/                       ← Electron 主进程
│   ├── index.ts                (入口 — app.whenReady + 启动主流程)
│   ├── window/
│   │   ├── main-window.ts      (主 BrowserWindow 创建 + 监听)
│   │   └── (window-manager.ts 后期加,多窗口管理)
│   ├── ipc/
│   │   ├── ipc-bus.ts          (IPC 总线:简化的 emit / on / invoke 封装)
│   │   ├── health-check.ts     (健康检查 IPC handlers)
│   │   └── (ipc-router.ts 后期加,handler 路由集中点)
│   ├── lifecycle/
│   │   ├── boot.ts             (启动 hooks 注册中心 — 各层注册自己的启动逻辑)
│   │   └── shutdown.ts         (退出 hooks)
│   └── diagnostics/
│       ├── L0-alive.ts         (L0 自我诊断信号)
│       ├── L1-alive.ts         (L1 自我诊断信号)
│       └── diagnostics-bus.ts  (诊断输出统一格式)
└── renderer/                   ← Electron renderer 进程
    ├── index.tsx               (React mount 到 #root)
    ├── diagnostics/
    │   └── renderer-alive.ts   (renderer 进程自我诊断)
    └── (mount-helpers/ 等后期加)
```

### 3.1 子模块职责

#### `main/index.ts` — 应用入口

```ts
// 仅做 L0 + L1 责任,不超越
app.whenReady().then(async () => {
  diagnostics.l0Alive();           // [L0] alive | electron app ready
  await mainWindow.create();        // L1 — 创建主窗口
  diagnostics.l1Alive();           // [L1] alive | window created
  ipcBus.init();                   // L0 — IPC 总线
  healthCheck.register();          // L0 — 健康检查 handler

  // L2~L5 自行通过 boot hooks 注册启动逻辑,platform 触发执行
  await boot.runAllHooks();
});
```

#### `main/window/main-window.ts` — 主窗口

仅创建 BrowserWindow,不创建 Shell 视图(那是 L2 src/shell/ 的事)。

```ts
export async function create(): Promise<BrowserWindow> {
  const win = new BrowserWindow({ /* ... */ });
  await win.loadURL(devUrl ?? prodUrl);
  diagnostics.l1Alive(win.id);
  return win;
}
```

#### `main/ipc/ipc-bus.ts` — IPC 总线

按 charter § 5.3 健康检查 IPC + § 4.1 诊断信号 IPC 设计:

```ts
export const ipcBus = {
  init() {
    diagnostics.l0Alive();
    // 注册框架级 IPC channel(健康检查 / 诊断查询等)
  },
  registerHandler(channel: string, handler: HandlerFn) { /* ... */ },
};
```

#### `main/lifecycle/boot.ts` — 启动 hooks

各层通过 `boot.registerHook('storage', initStorage)` 注册启动逻辑,platform 触发 `runAllHooks` 按依赖序执行。这取代 V1 的"app.ts 硬编码 6 个步骤"。

#### `main/diagnostics/` — 自我诊断

按 charter § 5 自我诊断规范,每层启动时输出格式化诊断行:

```
[L0] Platform alive | window: 1, ipc: ready
[L1] Window alive | main BrowserWindow created (id=1)
```

#### `renderer/index.tsx` — Renderer 入口

```tsx
// 仅做 renderer mount + 触发 L2 Shell 加载
import { ShellLayout } from '@shell/three-column-layout/ShellLayout';

const root = createRoot(document.getElementById('root')!);
root.render(<ShellLayout />);
diagnostics.rendererAlive();
```

---

## 4. V1 → V2 改进对比表

| 维度 | V1(教训) | V2(改进) |
|---|---|---|
| **入口大小** | app.ts 282 行,什么都做 | main/index.ts ~30 行,**只做 L0+L1 责任**,其他通过 boot hooks |
| **Plugin 注册** | 硬编码 5 个 plugin import | views 自注册,platform 不知道有哪些 view |
| **窗口创建** | createShell() 创建 5 个 WebContentsView(L1+L2 混合)| main-window.ts 只创建主 BrowserWindow,Shell 视图由 src/shell/ 注入 |
| **IPC 处理** | registerIpcHandlers 一个函数注册所有 channel | 各层自己注册 IPC handler,platform 提供 ipc-bus 总线 |
| **自我诊断** | 零结构化诊断 | 每层启动 `[Lx] alive` + 失败 `[Lx] INIT FAILED` |
| **健康检查** | 无 | `ipc.invoke('health.L0')` 等 IPC 查询接口 |
| **启动顺序** | app.ts 硬编码 6 步骤 | boot hooks 注册机制,各层声明依赖,自动序列化执行 |
| **存储初始化** | initSurrealDB / initSchema / migrate 在 app.ts 直接调 | 存储层注册 boot hook,platform 不知道是哪个数据库 |
| **Workspace 恢复** | app.ts 内 30 行恢复逻辑 | L3 src/workspace/ 自己处理,通过 boot hook 注入 |
| **Menu 注册** | app.ts 内 100 行 menu 定义 | L4 src/slot/ 处理菜单 Registry,platform 不知道菜单内容 |

---

## 5. V1 可复制的部分

### 5.1 forge.config.ts 多 entry 思路

V1 forge.config 用 vite 多 entry(main / preload / shell renderer / navside renderer / overlay renderer)。**V2 简化**:
- main entry:`src/platform/main/index.ts`
- renderer entry:`src/platform/renderer/index.tsx`
- preload entry:延后到需要时(暂时不引入 preload 复杂性)

### 5.2 Electron API 封装套路

V1 `BrowserWindow` 配置(titleBarStyle / hiddenInset / trafficLightPosition / backgroundColor)V2 可直接复用。

### 5.3 dev / prod URL 区分

V1 用 vite 的 `MAIN_WINDOW_VITE_DEV_SERVER_URL` 区分 dev / prod 加载方式,V2 沿用。

### 5.4 进程退出处理

V1 `before-quit` / `window-all-closed` / `activate` 三个 lifecycle hook 处理 V2 沿用,但内部逻辑只调 boot hooks。

---

## 6. L0 阶段实施目标

按 charter § 6.3 完成定义:

### 6.1 完成判据

- [ ] `npm start` 跑得起来
- [ ] 屏幕看到一个 Electron 主窗口(空白页或 "L0+L1 alive" 占位)
- [ ] 主进程 console 打印 `[L0] Platform alive` + `[L1] Window alive`
- [ ] renderer console 打印 `[Renderer] alive`
- [ ] `ipc.invoke('health.L0')` 返回 `{ alive: true, since: <ts>, errors: [] }`(可在 DevTools 测试)

### 6.2 实施清单

#### 工程脚手架
- `package.json` — 最小依赖(electron + electron-forge + vite + typescript + react)
- `tsconfig.json` — 含 9 个 path alias
- `forge.config.ts` — 单 main entry + 单 renderer entry
- `vite.main.config.ts` + `vite.renderer.config.ts`
- `eslint.config.js` — 屏障规则(按 directory-structure § 4)
- `.gitignore` 已就位

#### platform/main/
- `index.ts`(入口)
- `window/main-window.ts`(主窗口)
- `ipc/ipc-bus.ts`(IPC 总线)
- `ipc/health-check.ts`(健康检查 handlers)
- `lifecycle/boot.ts`(启动 hooks 中心)
- `diagnostics/L0-alive.ts` + `L1-alive.ts` + `diagnostics-bus.ts`

#### platform/renderer/
- `index.tsx`(React mount,渲染一个临时 "L0+L1 alive" 占位组件)
- `diagnostics/renderer-alive.ts`

### 6.3 不做的事(L0 范围严格限制)

- ❌ 不创建 Shell 视图(L2 阶段做)
- ❌ 不创建 NavSide / Companion 等(L4 / L2 阶段做)
- ❌ 不接 SurrealDB(存储层后期加)
- ❌ 不写 Workspace 状态(L3 阶段做)
- ❌ 不写 menu(L4 阶段做)
- ❌ 不引入业务 npm 包(prosemirror / three / pdfjs / 等)

### 6.4 自我诊断输出预期

主进程 console:
```
[L0] Platform alive | electron version: 38.2.x, node version: 22.20.x
[L1] Window alive | main window created (id=1, size=1200x800)
```

renderer console(DevTools):
```
[Renderer] alive | renderer process started
```

健康检查 IPC(在 renderer DevTools 测试):
```js
> await window.electronAPI.health('L0')
{ alive: true, since: 1704067200000, errors: [] }
```

---

## 7. 与 charter 原则的对照

| charter 原则 | 本设计如何遵守 |
|---|---|
| § 1.1 分层原则(纵向 4 + 横向 L0~L5)| platform 仅含 L0+L1,L2~L5 通过 boot hooks 注入,不超越 |
| § 1.2 注册原则 | platform 不直接 import view/capability,通过 ViewRegistry / boot hooks 解耦 |
| § 1.3 抽象原则(npm 屏障)| platform 不 import 任何业务 npm 包,严格屏障 |
| § 5 自我诊断规范 | 每层启动诊断 + 健康检查 IPC + 失败信号都按规范输出 |
| § 6 节奏规则 | L0 阶段就只做 L0+L1,完成才进 L2 |

---

## 8. 待拍板

- [ ] preload 是否在 L0 阶段引入?(我倾向不引入,L4 真需要时再加)
- [ ] 主窗口是否引入 React?(我倾向最简——renderer 端就是一个 React app,渲染 ShellLayout 占位)
- [ ] 健康检查 IPC 的 channel 命名约定(`health.L0` 还是 `health:L0` 还是别的?)
- [ ] 自我诊断是否同时写日志文件?(还是仅 console)

---

## 9. 修订记录

| 日期 | 版本 | 内容 | 作者 |
|---|---|---|---|
| 2026-05-03 | v0.1 | 初稿;V1 学习 + 教训分析 + V2 子目录设计 + 6 个改进点对比 + L0 阶段实施目标 + charter 原则对照 | wenwu + Claude |
