# L0 Platform 阶段完成报告

> 阶段:L0 平台层(Electron 进程入口) + L1 窗口层
> 分支:`feature/L0-bootstrap`
> 完成日期:2026-05-03

---

## 1. 完成判据核对(charter § 6.3)

| # | 判据 | 状态 | 验证方式 |
|---|---|---|---|
| 1 | npm start 跑得起来 | ✅ | 用户实测 `npm start` → "Launched Electron app" |
| 2 | 用户操作能看到该层功能 | ✅ | 用户截图显示 Electron 主窗口 + 标题栏 "KRIG Note V2" |
| 3 | console 打印 `[Lx] alive` 诊断行 | ✅ | 终端 console 输出: `[L0] alive` + `[L1] alive` |
| 4 | 上一层 alive 行也在 | N/A | L0 是首层 |
| 5 | 健康检查 IPC | ⏸️ | preload 未引入,IPC 接口已实现但 renderer 暂无法调用(L4 阶段引入 preload 后启用) |

**总评**:**通过**(5 条中 4 条 ✅,第 5 条按 § 8 待拍板默认值"preload 不引入"暂留)。

---

## 2. 该层实施的具体内容

### 2.1 工程脚手架(7 文件)

| 文件 | 作用 |
|---|---|
| `package.json` | electron 40 + react 19 + typescript 5.7 + eslint 9 |
| `tsconfig.json` | 9 个 path aliases 对应 9 个第一层目录 |
| `forge.config.ts` | 单 main entry + 单 renderer entry |
| `vite.main.config.mts` | 主进程构建配置(含 9 alias) |
| `vite.renderer.config.mts` | renderer 构建配置(root: src/platform/renderer) |
| `eslint.config.js` | 屏障原则 4+5 层 ESLint 规则 |
| `package-lock.json` | npm install 锁文件 |

### 2.2 L0 平台层(主进程 7 文件)

| 文件 | 作用 |
|---|---|
| `src/platform/main/index.ts` | 应用入口(~30 行,只做 L0+L1 责任) |
| `src/platform/main/window/main-window.ts` | BrowserWindow 创建 + 监听 |
| `src/platform/main/ipc/ipc-bus.ts` | IPC 总线初始化 |
| `src/platform/main/ipc/health-check.ts` | 健康检查 IPC handlers(`health.L0` / `health.L1` / `health.platform`) |
| `src/platform/main/diagnostics/L0-alive.ts` | L0 自我诊断信号 |
| `src/platform/main/diagnostics/L1-alive.ts` | L1 自我诊断信号 |
| `src/platform/main/diagnostics/diagnostics-bus.ts` | 诊断输出统一格式 |

### 2.3 L1 窗口层(renderer 3 文件)

| 文件 | 作用 |
|---|---|
| `src/platform/renderer/index.html` | renderer HTML 入口 |
| `src/platform/renderer/index.tsx` | React mount + L0+L1 alive 占位组件 |
| `src/platform/renderer/diagnostics/renderer-alive.ts` | renderer 进程自我诊断 |

### 2.4 跨进程共享(2 文件,L0 阶段启用)

| 文件 | 作用 |
|---|---|
| `src/shared/ipc/channel-names.ts` | IPC channel 名常量(4 个健康检查 channel) |
| `src/shared/ipc/message-types.ts` | HealthCheckResponse 类型契约 |

### 2.5 引入的 npm 依赖

| 包 | 版本 | 理由 |
|---|---|---|
| electron | ^40.6.0 | 平台底座 |
| react | ^19.2.0 | renderer UI 框架 |
| react-dom | ^19.2.0 | React DOM mount |
| @electron-forge/* | ^7.11.1 | 打包 + dev 工具链 |
| @vitejs/plugin-react | ^5.2.0 | vite + React 集成 |
| typescript | ^5.7.0 | 类型系统 |
| vite | ^5.4.21 | 构建工具 |
| eslint | ^9.20.0 | 屏障原则强制 |
| @typescript-eslint/* | ^8.20.0 | ESLint 解析 ts |

**0 处业务 npm 依赖**(prosemirror / three / pdfjs 等都没引入,符合 L0 范围严格限定)。

---

## 3. 自我诊断输出样本

### 3.1 主进程终端 console

```
[L0] alive | electron: 40.9.3, node: 24.14.1, platform: darwin, ready: true
[L1] alive | window id: 1, size: 1200x800
```

### 3.2 renderer DevTools console(预期)

```
[Renderer] alive | renderer process started
```

### 3.3 健康检查 IPC(已实现,等 L4 preload 引入后激活)

实现位置:`src/platform/main/ipc/health-check.ts`

预期返回:
```js
ipc.invoke('health.L0')
// → { alive: true, since: 1730620870000, errors: [], details: { electron: '40.9.3', ... } }
```

---

## 4. 用户验证记录

### 4.1 验证步骤

1. `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`
2. `npm install`
3. `npm start`
4. 观察:
   - 终端 console 是否打印 `[L0] alive` + `[L1] alive`
   - Electron 主窗口是否打开
   - 窗口标题栏是否显示 "KRIG Note V2"

### 4.2 实际效果

- ✅ 终端正确输出 L0 + L1 诊断行
- ✅ Electron 主窗口打开(1200x800,深色背景)
- ✅ 窗口标题栏显示 "KRIG Note V2"
- ⚠️ 应用菜单显示 "Electron"(Electron 默认菜单,L4 阶段建 menuRegistry 后替换)
- ⚠️ 启动过程中遇到两个 bug,已修复:
  - Bug 1:`main` 字段路径错误(.vite/build/main.js → .vite/build/index.js)
  - Bug 2:`type: module` 与 forge-vite CJS 输出冲突,移除

### 4.3 用户拍板

**通过**(2026-05-03)。

---

## 5. 下一层(L1)的衔接条件

L1 窗口层的"窗口创建"逻辑已在本阶段顺带完成(主窗口 1 个)。**完整 L1 阶段**(若有需要)可后续单独实施:

- 多窗口管理(设置窗口 / 子窗口)
- 窗口生命周期高级管理(最小化 / 最大化 / 关闭策略)
- 窗口位置 / 尺寸持久化

**当前状态**:本阶段同时完成 L0 + L1 最小集。可直接进入 L2 阶段(Shell 三栏布局)。

---

## 6. 遗留问题 / 待优化项

### 6.1 dev 模式应用菜单显示 "Electron"

**现象**:macOS dev 模式下,应用菜单栏显示 "Electron",File / Edit / View / Window 都是 Electron 默认空壳。

**原因**:V2 当前没调 `Menu.setApplicationMenu(...)`,Electron 自动套用默认菜单。

**处理**:**留 L4 Slot 阶段处理**(charter § 6.2 一层一阶段不细拆)。届时建 `src/slot/menu-registry/`,L5 视图自注册菜单项,L0 入口加 `menuRegistry.rebuild()` 触发。

**用户拍板**:接受(Q3 同意)。

### 6.2 健康检查 IPC 在 renderer 不可用

**现象**:`window.electronAPI?.health?.('L0')` 在 DevTools 调用会失败(无 preload bridge)。

**原因**:L0 阶段按 DESIGN § 8.1 默认值"preload 不引入"。

**处理**:**留 L4 阶段引入 preload 后启用**。届时 renderer 可主动查健康状态。

### 6.3 应用图标显示为 Electron 默认图标

**现象**:dev 模式 dock / 任务栏显示 Electron 默认原子图标,不是 V2 自己的图标。

**原因**:`forge.config.ts` `packagerConfig.icon` 字段未设置(也没有 V2 自己的图标资源)。

**处理**:留打包阶段处理。

### 6.4 representedObject 警告

**现象**:终端偶发输出:
```
2026-05-03 12:41:31.768 Electron[22681:293266] representedObject is not a WeakPtrToElectronMenuModelAsNSObject
```

**原因**:Electron 默认菜单在某些 macOS 操作时的内部警告。

**处理**:与 V2 代码无关,L4 替换默认菜单后自然消失。

---

## 7. V1 → V2 改进对比验证

按 [src/platform/DESIGN.md § 4](../../../src/platform/DESIGN.md) 的 10 维度改进对比:

| 维度 | V1 | V2 实际 | 验证 |
|---|---|---|---|
| 入口大小 | app.ts 282 行 | index.ts ~30 行 | ✅ 实际 33 行 |
| Plugin 注册 | 硬编码 5 个 import | 0 处 view 直接 import | ✅ |
| 窗口创建 | createShell 5 个 WebContentsView 混合 | main-window.ts 单 BrowserWindow | ✅ |
| 自我诊断 | 零结构化 | 每层 `[Lx] alive` | ✅ |
| 健康检查 | 无 | IPC 接口已实现(等 preload 启用) | ✅ |
| 启动顺序 | 硬编码 6 步 | L0 入口 3 步(reportL0Alive / initIpcBus / createMainWindow) | ✅ |
| ProseMirror 越层 | 直接 import | 0 处 npm 业务包 | ✅ ESLint 屏障 |
| 存储层泄漏 | initSurrealDB 在 app.ts | L0 不接 SurrealDB | ✅ |

---

## 8. 提交清单

| Commit | 说明 |
|---|---|
| `f9ca6f8` | feat(L0-bootstrap): L0 平台层 + L1 窗口层最小实现(19 文件) |
| `81ddc1a` | fix(L0-bootstrap): 修复 npm start 启动错误(main 字段 + type:module) |

---

## 9. 进入 L2 阶段的前置条件

L0 完成后:
- ✅ Electron 主进程可启动
- ✅ 主窗口可显示
- ✅ renderer 进程可加载(React 已 mount)
- ✅ 自我诊断框架就位(可扩展 L2~L5 自我诊断)
- ✅ 健康检查 IPC 接口就位(等 L4 preload 启用)
- ✅ ESLint 屏障规则就位

**下一阶段建议**:L2 Shell(三栏布局 + Slot 容器)。

理由:
- L1 窗口层最小集已完成,可直接进 L2
- L2 Shell 是用户感知最强的下一步(从"占位组件"变成"三栏布局")
- L3/L4 是状态 / 注册基础设施,不直接渲染 UI,放在 L2 之后更自然

实施分支建议:`feature/L2-shell-three-column`。
