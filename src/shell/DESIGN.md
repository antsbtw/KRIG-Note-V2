# src/shell — 详细设计

> v0.2 · 2026-05-05 · 草稿,等用户审阅
>
> 配套:[charter.md v0.4 § 1.4 + § 2.2](../../docs/00-architecture/charter.md) + [view-hierarchy-v2.md](../../docs/RefactorV2/view-hierarchy-v2.md)
>
> v0.1 → v0.2:经过深度讨论(2026-05-05),纠正 v0.1 把 NavSide / Toolbar / 浮层归 Shell 的错误。V2 Shell 极轻,只做 WorkspaceBar + Workspace Container 容器。所有应用级 UI(NavSide / Toolbar / 浮层)归 L3 Workspace Container。

---

## 1. 本层范围(L2 Shell — 极轻)

L2 Shell 只做两件事:

```
src/shell/
├── workspace-bar/       ← 顶部 28px,Workspace Tab 切换器
└── workspace-container/ ← 全屏容器,挂载当前活跃 Workspace 实例
```

**Shell 不包含**(与 V1 重大差异,详见 view-hierarchy-v2.md § 0):
- ❌ NavSide(归 L3 Workspace Container)
- ❌ Toolbar(归 L3 Workspace Container)
- ❌ 任何浮层(ContextMenu / Slash / Handle / FloatingToolbar / 通用 Overlay 全部归 L3)

L2 阶段的 Workspace Container **是空容器**——等 L3 阶段实施 Workspace 实例(NavSide frame + Slot Area + Overlay frames 等)。

---

## 2. V1 学习总结

### 2.1 V1 Shell 现状盘点

V1 Shell 实现散布:
- `src/main/window/shell.ts` 652 行(主进程,创建 5 个 WebContentsView 用 setBounds 摆位)
- `src/main/slot/layout.ts` 100 行(布局算法)
- `src/renderer/shell/`(WorkspaceBar.tsx 等 React 组件)

V1 Shell 包含 5 个区块:
- **Toggle**(NavSide 折叠按钮)
- **WorkspaceBar**(顶部栏)
- **NavSide**(左导航 — 文件树)← V1 错误归属(应在 Workspace)
- **LeftSlot**(主内容区)← V1 在 Workspace,但结构混乱
- **RightSlot + Divider**(右侧 + 分隔)← 同上

### 2.2 V1 教训(必须避免)

#### 教训 1:Shell 太重(职责越界)

V1 Shell 把 NavSide / 5 个 WebContentsView / 布局计算 / Slot 切换全部塞进去。Shell 应该轻,不应该管业务结构。

V2 改进:**Shell 极轻**,只做 Tab 切换 + Workspace 容器挂载。

#### 教训 2:NavSide 归 Shell → Workspace 隔离失败

V1 NavSide 是全局共享的 WebContentsView,Workspace 之间共享 NavSide 状态(展开 / 选中等)。这违反"Workspace 完全隔离"原则。

V2 改进:**NavSide 归 Workspace Container**,每个 Workspace 自己持有 NavSide 实例。

#### 教训 3:多 WebContentsView 过度复杂

V1 用 5 个独立 renderer 进程做布局,内存翻 5 倍 + IPC 通信复杂 + DOM 事件无法直接传。

V2 改进:**单 BrowserWindow + 单 renderer 进程 + React 组件**。所有 UI 是 React 组件树。

#### 教训 4:布局计算与 React 渲染脱节

V1 主进程 `calculateLayout()` 100 行 JS 计算 + `setBounds()` 摆位。React 组件不知道布局变化。

V2 改进:**布局完全由 CSS Flexbox 处理**,主进程零参与。

### 2.3 V1 可复用的部分

#### Workspace Tab 切换的 UX 思路

V1 WorkspaceBar 显示标签 + [+] 按钮,这个 UX 模式 V2 沿用。

#### dev / prod URL 区分套路

V1 的 Vite HMR + 生产构建逻辑 V2 沿用(L0 阶段已落地)。

---

## 3. V2 shell 子目录设计

### 3.1 顶层结构

```
src/shell/
├── README.md
├── DESIGN.md(本文件)
├── workspace-bar/
│   ├── WorkspaceBar.tsx           (顶部 28px Tab 切换器)
│   ├── WorkspaceTab.tsx            (单个 Tab 组件)
│   ├── workspace-bar.css
│   └── README.md
├── workspace-container/
│   ├── WorkspaceContainer.tsx     (全屏容器,根据 active workspace 切显示)
│   ├── workspace-container.css
│   └── README.md
└── diagnostics/
    └── L2-alive.ts                 (L2 自我诊断,通过 IPC 上报)
```

### 3.2 各子模块职责

#### `workspace-bar/`

**作用**:渲染顶部 28px Tab 切换器,显示所有 Workspace 标签 + [+]。

**接口**:
- 数据来源:WorkspaceManager(L3)— 但 L2 阶段 WorkspaceManager 还没落地,**L2 阶段 WorkspaceBar 显示空**(无 Workspace 标签)
- 切 Workspace:点击 Tab → 调 WorkspaceManager.setActive()(L3 阶段实现)

**L2 阶段实现**:
```tsx
// 简化版,无 WorkspaceManager 依赖
export function WorkspaceBar() {
  // L2 阶段:静态空 Tab 列表(等 L3 接入)
  return (
    <div className="krig-workspace-bar">
      <div className="krig-workspace-bar-empty">Workspace Bar (待 L3 实施)</div>
      <button className="krig-add-workspace">+</button>
    </div>
  );
}
```

**L3 阶段升级**:接入 WorkspaceManager,显示真实 Workspace 列表。

#### `workspace-container/`

**作用**:全屏容器,挂载当前活跃 Workspace 实例。

**接口**:
- 接收 prop `activeWorkspaceId`(L3 提供)
- 内部根据 ID 找到对应 Workspace 实例并 mount

**L2 阶段实现**:
```tsx
// 简化版,L3 阶段才接入 Workspace 实例
export function WorkspaceContainer() {
  return (
    <div className="krig-workspace-container">
      <div className="krig-workspace-container-empty">
        Workspace Container (待 L3 挂载 Workspace 实例)
      </div>
    </div>
  );
}
```

**L3 阶段升级**:从 WorkspaceManager 拿活跃 Workspace,mount 对应 Workspace React 组件树。

#### `diagnostics/L2-alive.ts`

**作用**:L2 启动后通过 IPC 上报 alive 信号到主进程 diagnostics-bus。

```ts
// 通过 IPC 调主进程的 diagnostics.report-alive channel
import { IPC_CHANNELS } from '@shared/ipc/channel-names';

export function reportL2Alive() {
  // L2 在 renderer 进程,通过 IPC 上报到主进程
  // 实现方式:依赖 L0 阶段已建的 diagnostics-bus + 新增 IPC channel
}
```

**注**:L0 阶段没建"renderer 上报诊断"的 IPC channel。L2 阶段需扩展 shared/ipc/。

---

## 4. V1 → V2 改进对比表

| 维度 | V1 | V2 |
|---|---|---|
| **架构** | 5 个 WebContentsView 独立进程 | 单 BrowserWindow + 单 renderer + React 组件 |
| **Shell 职责** | NavSide + Toolbar + 5 区块布局 + Slot 切换 + 状态恢复 | **只做 Tab 切换 + Workspace 容器挂载** |
| **NavSide 归属** | Shell(全局共享) | **Workspace Container**(每 Workspace 自带) |
| **Toolbar 归属** | View 自带 | **Workspace Container 管式样,view 注册内容** |
| **浮层归属** | View 自带 / Shell.overlays(空) | **Workspace Container 管式样,view 注册内容** |
| **布局计算** | 主进程 calculateLayout 100 行 + setBounds | CSS Flexbox 自动响应 |
| **代码量** | shell.ts 652 + layout.ts 100 + slot/ + 多 preload + 多 css ≈ 2000+ 行 | shell/ 预计 ~150 行 |
| **DevTools** | 5 个独立 dev tools | 1 个 renderer dev tools |
| **内存占用** | 5 个 renderer 进程 | 1 个 renderer 进程 |
| **加新 Workspace** | 涉及多 WebContentsView 创建 + 切 setBounds | React 组件 mount/hide |

---

## 5. L2 阶段实施目标

按 charter § 6.3 完成定义:

### 5.1 完成判据

- [ ] `npm start` 跑得起来(L0+L1 不回归)
- [ ] 屏幕看到**顶部 WorkspaceBar 占位** + **下方 Workspace Container 占位**
- [ ] 主进程 console 打印 `[L0] alive` + `[L1] alive` + `[L2] alive`
- [ ] L2 alive 通过 IPC 从 renderer 上报到主进程

### 5.2 实施清单

#### shell/workspace-bar/(3 文件)
- `WorkspaceBar.tsx`(占位 Tab 列表)
- `workspace-bar.css`
- `README.md`

#### shell/workspace-container/(3 文件)
- `WorkspaceContainer.tsx`(占位容器)
- `workspace-container.css`
- `README.md`

#### shell/diagnostics/(1 文件)
- `L2-alive.ts`(L2 自我诊断,通过 IPC 上报)

#### shared/ipc/(扩展)
- 新增 channel `diagnostics.report-alive`(让 renderer 上报诊断)
- 主进程 ipc-bus 增加该 handler,接收并转发给 diagnostics-bus

#### platform/main/diagnostics/diagnostics-bus.ts(扩展)
- 接收 IPC channel 转发,调用 markAlive

#### platform/renderer/index.tsx(修改)
- 移除 L0+L1 alive 占位组件
- 改为渲染 `<App />` → 内部:
  ```tsx
  <div>
    <WorkspaceBar />
    <WorkspaceContainer />
  </div>
  ```

### 5.3 不做的事(严格 L2 范围)

- ❌ NavSide 实现(L3)
- ❌ Toolbar 实现(L3)
- ❌ 任何浮层 frame 实现(L3)
- ❌ Slot Area 实现(L3 Workspace 内)
- ❌ Workspace Manager(L3)
- ❌ Workspace 状态(L3)
- ❌ Application Menu(留给 L4 Slot 阶段做 menuRegistry 后)
- ❌ 任何业务 npm 包

### 5.4 自我诊断输出预期

主进程 console:
```
[L0] alive | electron: 40.9.3, node: 24.14.1, platform: darwin, ready: true
[L1] alive | window id: 1, size: 1200x800
[L2] alive | shell rendered, workspace-bar + workspace-container
```

---

## 6. 与 charter 原则的对照

| charter 原则 | 本设计如何遵守 |
|---|---|
| § 1.1 分层(纵向 4 + 横向 L0~L5)| L2 Shell 仅做框架 + 容器,不超越职责 |
| § 1.2 注册原则 | L2 不直接 import view 实现 |
| § 1.3 抽象原则(npm 屏障)| L2 不 import 业务 npm,只用 react 等纯函数白名单 |
| **§ 1.4 视图与实现归属** | **Shell 不管 NavSide / Toolbar / 浮层,这些归 L3 Workspace Container 管式样** |
| § 5 自我诊断 | `[L2] alive` IPC 上报机制 |
| § 6 节奏规则 | L2 完成才进 L3,不细拆 |

---

## 7. 待拍板

- [ ] L2 阶段是否引入"renderer → main IPC 上报诊断"机制?— 我倾向是,框架性基础设施
- [ ] WorkspaceBar 占位文字 — 显示什么?(我倾向 "Workspace Bar (待 L3)")
- [ ] Workspace Container 占位文字 — 显示什么?(我倾向 "Workspace Container (待 L3)")
- [ ] 顶部 WorkspaceBar 与底部 Workspace Container 之间是否需要分隔线?
- [ ] L2 阶段是否引入 React Router / Zustand / 等状态库?— 我倾向不引入(L2 占位无需复杂状态)

---

## 8. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-03 | v0.1 | 初稿;V1 学习 + 三栏布局思路 — **被 v0.2 完全推翻** |
| 2026-05-05 | v0.2 | 完全重写;反映"NavSide / Toolbar / 浮层全归 L3 Workspace Container"修正;Shell 只做 WorkspaceBar + Workspace Container 容器极简版;子目录从 three-column-layout 改为 workspace-bar / workspace-container |
