# src/shell — 详细设计

> v0.4 · 2026-05-17 · 草稿,等用户审阅
>
> 配套:[charter.md v0.4 § 1.4 + § 2.2](../../docs/00-architecture/charter.md) + [view-hierarchy-v2.md](../../docs/RefactorV2/view-hierarchy-v2.md)
>
> v0.1 → v0.2:经过深度讨论(2026-05-05),纠正 v0.1 把 NavSide / Toolbar / 浮层归 Shell 的错误。Shell 极轻,只做 WorkspaceBar + Workspace Container 容器。所有应用级 UI(NavSide / Toolbar / 浮层)归 L3 Workspace Container。
>
> v0.2 → v0.3(2026-05-05):明确 WorkspaceBar 内含 NavSide Toggle / Workspace Tabs / [+] 按钮三类控件,Toggle 视觉在 L2 但状态归 L3 WorkspaceState。
>
> v0.3 → v0.4(2026-05-17):新增 **FullscreenOverlay**(`shell/fullscreen-overlay/`)— L2 内与 WorkspaceContainer 并列的"app-scoped 全屏视图槽"。这是 L2 Shell **新增**的第三个 sibling 类目,**不**违反 v0.2/v0.3 的"5 大 view-scoped 浮层全归 L3"原则:fullscreen-overlay 在概念和实现上都跟那 5 大浮层不同(app-scoped vs view-scoped,撑满 viewport vs anchor 弹层,单例顶级模式 vs N 个局部弹层)。详见本文 § 1.2。

---

## 1. 本层范围(L2 Shell — 极轻 + WorkspaceBar 控件 + FullscreenOverlay 槽)

L2 Shell 做三件事:

```
src/shell/
├── workspace-bar/         ← 顶部 28px:NavSide Toggle + Workspace Tabs + [+] 按钮
├── workspace-container/   ← 容器,挂载当前活跃 Workspace 实例
└── fullscreen-overlay/    ← app-scoped 全屏视图槽(v0.4 新增)
```

**Shell 不包含**(与 V1 重大差异,详见 view-hierarchy-v2.md § 0):
- ❌ NavSide(归 L3 Workspace Container,Toggle 控制 L3 状态)
- ❌ Toolbar(归 L3 Workspace Container)
- ❌ **view-scoped 浮层**(ContextMenu / Slash / Handle / FloatingToolbar / view-scoped Popup / 通用 Overlay 全部归 L3)

**Shell 包含的"全屏 overlay"≠ "浮层"**(v0.4 新增辨别):
- 5 大 view-scoped 浮层:在 view 内的 anchor 位置弹局部弹层,服务编辑器局部交互
- fullscreen-overlay:撑满整个 viewport(含 WorkspaceBar 区域),用户视觉离开 Workspace 进入"专注模式"

详见 § 1.2。

### 1.2 FullscreenOverlay vs 5 大 view-scoped 浮层 — 边界辨析

| 维度 | view-scoped 浮层(L3) | fullscreen-overlay(L2) |
|---|---|---|
| **作用域** | 单 view 内 | 跨所有 view + workspace,app 级 |
| **触发** | view 内编辑器(右键 / `/` / hover / 选中) | 任意 view 内业务方主动 `controller.show(id)` |
| **视觉** | anchor 旁的小弹层 | 撑满 viewport(包含 WorkspaceBar 区域) |
| **同时多个** | 是(不同 view 各自的 popup) | **否**(controller 单例) |
| **WorkspaceBar 可见性** | 仍可见 | **隐藏** |
| **关闭语义** | 点外 / Esc / 显式 | Esc / 显式(无"点外") |
| **典型用途** | LinkPanel / ColorPicker / TableMenu | mermaid 全屏编辑 / PDF 全屏阅读 / 画板全屏 / 设置 modal |
| **挂点** | `WorkspaceInstance.OverlayFrames`(L3) | `<App>.FullscreenOverlayContainer`(L2) |

**判定原则**:UI 是否在"workspace 内的某个 view 内服务局部操作"→ 是则 L3 浮层。UI 是否"用户进入新的视图模式,临时离开 Workspace"→ 是则 L2 fullscreen-overlay。

### 1.3 FullscreenOverlay 子模块

```
src/shell/fullscreen-overlay/
├── FullscreenOverlayContainer.tsx   ← L2 Shell 入口组件(App 内 sibling)
├── FullscreenOverlayBinding.tsx     ← 订阅 controller,渲染 active overlay
├── fullscreen-overlay.css           ← 基础样式(position:fixed inset:0)
└── README.md                        ← 模块说明 + API 使用示例
```

配套的 **registry / controller** 在 `src/slot/`:
- `src/slot/interaction-registries/fullscreen-overlay-registry/` — registry + types
- `src/slot/triggers/fullscreen-overlay-controller.ts` — show/hide/state

**Workspace 切换语义**:active 时整个 workspace 层(WorkspaceBar + WorkspaceContainer)由 App 入口 `display:none`,WorkspaceBar 上的切 workspace 按钮**用户看不到也点不到**。这是 v0.4 选择的方案 — "Workspace 切换自动关 overlay"和"切 workspace 期间 overlay 状态保留"两个语义的折中:用户主观上**无法**在 overlay 期间切 workspace,所以两难问题不出现。

### WorkspaceBar 内的三类控件

```
┌─ WorkspaceBar(28px)──────────────────────────────────────────────┐
│ [≡] │ [WS-1] [WS-2] [WS-3 ×] [+]                                  │
└────────────────────────────────────────────────────────────────────┘
  ↑      ↑       ↑           ↑
  │      └ Workspace Tabs    └ [+] 新建 Workspace
  └ NavSide Toggle(影响当前活跃 Workspace 的 NavSide)
```

| 控件 | 视觉位置 | UI 实现 | 状态归属 | 触发逻辑 |
|---|---|---|---|---|
| **NavSide Toggle** | L2 WorkspaceBar 左端 | L2 渲染 | **L3 WorkspaceState.navSideCollapsed** | 调当前 Workspace API 切状态 |
| **Workspace Tabs** | L2 WorkspaceBar 中间 | L2 渲染 | L3 WorkspaceManager(列表) | 调 workspaceManager.setActive(id) |
| **[+] 新建按钮** | L2 WorkspaceBar 右端 | L2 渲染 | — | 调 workspaceManager.create() |

**模式**:**L2 提供 UI 入口,L3 处理状态**。L2 不持有任何 Workspace 业务状态。

L2 阶段实施时,WorkspaceManager 还没落地 → 按钮触发**暂时不工作**(L3 接入后生效)。

### Toggle 归属(详细说明)

按 charter § 1.4 "应用级 UI 在 Workspace Container,view 平等,无 variant" 原则审视:

NavSide Toggle 是控制 NavSide 显示/隐藏的开关 → **逻辑上归 NavSide → 归 L3 Workspace**。

但**视觉位置**在 WorkspaceBar 上(顶部栏左端,V1 风格)。

**采用方案 C(折中,工程实践标准)**:
- WorkspaceBar 渲染 Toggle UI(L2 实现)
- Toggle 触发时调 `workspaceManager.toggleNavSide(activeId)`(L3 提供 API)
- Toggle 状态在 `WorkspaceState.navSideCollapsed`(L3 持久化)

**与 charter § 1.4 的关系**:
- 严格说 Toggle UI 也是应用级 UI 一致性的一部分(每个 Workspace 看到的 Toggle 形状一致)
- 但 Toggle 是 WorkspaceBar 的一部分(L2 整体一致),不会因 view 不同而变
- → 不违反 view 平等

### Workspace 隔离的 NavSide 折叠状态

按 view-hierarchy-v2.md "Workspace 真正隔离":
- **每个 Workspace 持有自己的 navSideCollapsed 状态**
- 切 Workspace A → B 时,B 的 NavSide 显示 B 自己的折叠状态(可能与 A 不同)

实现:WorkspaceState.navSideCollapsed 是 Workspace 实例的字段(L3)。

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
│   ├── WorkspaceBar.tsx           (顶部 28px 容器,布局 Toggle + Tabs + [+])
│   ├── NavSideToggle.tsx           (左端 ≡ 按钮,触发 L3 toggleNavSide)
│   ├── WorkspaceTab.tsx            (中间 — 单个 Tab 组件,可关闭)
│   ├── AddWorkspaceButton.tsx     (右端 [+] 按钮)
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

**作用**:渲染顶部 28px,含 NavSide Toggle / Workspace Tabs / [+] 三类控件。

**接口**:
- 数据来源:WorkspaceManager(L3,L2 阶段未落地 → 显示占位)
- Toggle 触发:调 `workspaceManager.toggleNavSide(activeId)`(L3 实现)
- 切 Workspace:调 `workspaceManager.setActive(id)`(L3 实现)
- 新建 Workspace:调 `workspaceManager.create()`(L3 实现)

**L2 阶段实现**(占位 — 触发暂不工作):
```tsx
export function WorkspaceBar() {
  return (
    <div className="krig-workspace-bar">
      <NavSideToggle />               {/* L2 阶段:占位按钮,触发不工作 */}
      <div className="krig-workspace-tabs">
        {/* L2 阶段:占位"Workspace Bar (待 L3)" */}
        <div className="krig-tabs-empty">Workspace Bar (待 L3)</div>
      </div>
      <AddWorkspaceButton />          {/* L2 阶段:占位 [+],触发不工作 */}
    </div>
  );
}
```

**L3 阶段升级**:接入 WorkspaceManager,Toggle / Tabs / [+] 全部生效。

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

#### shell/workspace-bar/(6 文件)
- `WorkspaceBar.tsx`(顶部 28px 容器,布局 3 类控件)
- `NavSideToggle.tsx`(左端 ≡ 按钮 — 占位,触发暂不工作)
- `WorkspaceTab.tsx`(中间 Tab 组件 — L2 阶段不渲染,等 L3)
- `AddWorkspaceButton.tsx`(右端 [+] 按钮 — 占位,触发暂不工作)
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

- [ ] L2 阶段是否引入"renderer → main IPC 上报诊断"机制?— 默认是
- [ ] WorkspaceBar 占位文字 — 默认 "Workspace Bar (待 L3)"
- [ ] Workspace Container 占位文字 — 默认 "Workspace Container (待 L3)"
- [ ] 顶部 WorkspaceBar 与底部 Workspace Container 之间是否需要分隔线?— 默认是
- [ ] L2 阶段是否引入 React Router / Zustand / 等状态库?— 默认不引入
- [ ] NavSide Toggle 图标用什么?— 默认 `≡`(三横线 / hamburger)
- [ ] [+] 按钮图标 — 默认 `+`(简单加号)

---

## 8. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-03 | v0.1 | 初稿;V1 学习 + 三栏布局思路 — **被 v0.2 完全推翻** |
| 2026-05-05 | v0.2 | 完全重写;反映"NavSide / Toolbar / 浮层全归 L3 Workspace Container"修正;Shell 只做 WorkspaceBar + Workspace Container 容器极简版;子目录从 three-column-layout 改为 workspace-bar / workspace-container |
| 2026-05-05 | v0.3 | 修正 v0.2 漏掉的 WorkspaceBar 内控件;明确 WorkspaceBar 含 NavSide Toggle / Workspace Tabs / [+] 三类控件(方案 C 折中:UI 在 L2,状态归 L3 WorkspaceState.navSideCollapsed);加 NavSideToggle.tsx + AddWorkspaceButton.tsx 实施清单 |
| 2026-05-17 | v0.4 | 新增 FullscreenOverlay 子模块(L2 第三个 sibling);定义 v0.2/v0.3 "浮层全归 L3"原则的精确边界 — 5 大 view-scoped 浮层归 L3,app-scoped 全屏视图归 L2 新槽;典型场景 mermaid/PDF/画板/设置 modal 全部归 L2 这一槽;active 时 workspace 层 display:none(避免 workspace 切换语义两难) |
