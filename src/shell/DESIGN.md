# src/shell — 详细设计

> v0.1 · 2026-05-03 · 草稿,等用户审阅
>
> 配套:[charter.md § 2.2 L2 Shell](../../docs/00-architecture/charter.md) + [directory-structure.md v0.3](../../docs/00-architecture/directory-structure.md)

---

## 1. 本层范围

L2 Shell 层提供**三栏布局骨架** + **Slot 容器机制**。

**只做骨架,不挂内容**:
- 三个 Slot(`<LeftSlot>` + `<MainSlot>` + `<RightSlot>`)是空容器
- L4 Slot Registry / L5 视图实例化在后续阶段往 Slot 内挂载
- 本阶段 Slot 内显示占位文字(`Left slot empty` / 等)

**不在本阶段做**:
- ❌ Toggle 折叠按钮(L3 Workspace 状态相关)
- ❌ TopBar / WorkspaceBar(L3 Workspace 切换器)
- ❌ NavSide(L4 NavSide Registry)
- ❌ 视图实例化进 Slot(L4 + L5)

---

## 2. V1 学习总结

### 2.1 V1 Shell 现状盘点

V1 Shell 实现散布在多个文件:
- `src/main/window/shell.ts` 652 行(主进程,创建 5 个 WebContentsView 用 setBounds 摆位)
- `src/main/slot/layout.ts` 100 行(布局算法 — 计算 5 区块 Bounds)
- `src/renderer/shell/renderer.tsx` + `WorkspaceBar.tsx` + `GlobalProgressOverlay.tsx`(WorkspaceBar React 组件)

**5 个区块**(V1 实际架构):
- Toggle(NavSide 折叠按钮)
- WorkspaceBar(顶部栏)
- NavSide(左导航 — 文件树)
- LeftSlot(主内容区,单视图全宽)
- RightSlot + Divider(右侧 — 双视图模式时显示)

**实现方式**:每个区块都是独立 `WebContentsView`(Electron 子视图,有自己的 webContents),通过主进程 `setBounds()` 摆位。

### 2.2 V1 教训(必须避免)

#### 教训 1:多 WebContentsView 过度复杂

V1 用 5 个 WebContentsView 实现一个三栏布局,引入了:
- 5 个独立 renderer 进程(内存翻 5 倍)
- 5 套 preload + IPC 通信
- 跨视图 DOM 事件无法直接传(必须 IPC 中转)
- 主进程必须 `setBounds()` 精确摆位(窗口 resize 时 5 处计算)

**根因**:V1 早期为了"每个区块独立 dev tools 调试"做的决定,但代价过大。

**V2 改进**:用**单一 BrowserWindow + 单 renderer 进程 + React Flexbox 布局**。三栏只是三个 `<div>`,不需要多 WebContentsView。

#### 教训 2:布局计算与 React 渲染脱节

V1 主进程 `calculateLayout()` 计算 Bounds,通过 `setBounds()` 摆 WebContentsView。React 组件不知道布局变化,反向需要主进程 IPC 通知。

**V2 改进**:布局完全在 React Flexbox + CSS 内完成,主进程零参与。窗口 resize → CSS 自动响应,不需要 IPC。

#### 教训 3:Slot 内容耦合

V1 Slot 知道自己挂什么 view(workspace 切换时,主进程切 LeftSlot 的 WebContentsView)。Slot 不"中立"。

**V2 改进**:Slot 是**纯容器**,不知道挂什么。L4 Slot Registry + L5 视图通过 React Children 注入,Slot 自己只管渲染容器边界。

### 2.3 V1 可复用的部分

#### 三栏布局算法的核心思路

V1 `calculateLayout()` 核心思路是**比例分配**:
- 单视图时 LeftSlot 全宽
- 双视图时 LeftSlot + Divider + RightSlot 按 `dividerRatio` 分

V2 沿用这个思路,但用 CSS Flexbox + `flex-grow` 实现,不写 JS 计算。

#### Divider 拖拽算法

V1 `divider.ts` 实现拖拽时更新 `dividerRatio`。V2 沿用思路,但实现为纯 React 组件(mousedown / mousemove / mouseup 处理)。

---

## 3. V2 shell 子目录设计

```
src/shell/
├── README.md
├── DESIGN.md(本文件)
├── three-column-layout/
│   ├── ShellLayout.tsx          (三栏布局根组件)
│   ├── LeftSlot.tsx             (左 Slot 容器)
│   ├── MainSlot.tsx             (主 Slot 容器)
│   ├── RightSlot.tsx            (右 Slot 容器)
│   ├── ResizableDivider.tsx     (可拖拽分隔线)
│   ├── shell-layout.css
│   └── README.md
├── slot-system/
│   ├── slot-types.ts            (Slot ID / SlotState 类型)
│   └── README.md
└── diagnostics/
    └── L2-alive.ts              (L2 自我诊断)
```

### 3.1 子模块职责

#### `three-column-layout/ShellLayout.tsx`

```tsx
// 三栏布局根组件
import { LeftSlot } from './LeftSlot';
import { MainSlot } from './MainSlot';
import { RightSlot } from './RightSlot';
import { ResizableDivider } from './ResizableDivider';

export function ShellLayout() {
  const [leftRatio, setLeftRatio] = useState(0.5);
  const [showRight, setShowRight] = useState(true); // L2 阶段默认显示双栏

  return (
    <div className="krig-shell">
      <LeftSlot flex={leftRatio} />
      {showRight && (
        <>
          <ResizableDivider onDrag={(delta) => setLeftRatio(...)} />
          <RightSlot flex={1 - leftRatio} />
        </>
      )}
    </div>
  );
}
```

#### `three-column-layout/{Left,Main,Right}Slot.tsx`

```tsx
// 各 Slot 都是占位组件 — L4/L5 才往里挂内容
export function LeftSlot({ flex }: { flex: number }) {
  return (
    <div className="krig-slot krig-slot-left" style={{ flex }}>
      <div className="krig-slot-placeholder">Left Slot (empty)</div>
    </div>
  );
}
```

注:L2 阶段命名 "MainSlot" 仅作占位 — 实际 V1 是"LeftSlot"(主内容)+ "RightSlot"(可选). 待 L4 阶段定义 Slot Registry 时再确定 slot 命名。

#### `slot-system/slot-types.ts`

```ts
// L2 阶段先定义 Slot ID 类型 + 状态枚举,L4 完整 Slot Registry 时扩展
export type SlotId = 'left' | 'main' | 'right';
export interface SlotState {
  id: SlotId;
  visible: boolean;
}
```

#### `diagnostics/L2-alive.ts`

```ts
// 按 charter § 5.1:[L2] Shell alive | layout: 3-column, slots: ...
import { markAlive } from '@platform/main/diagnostics/diagnostics-bus';

export function reportL2Alive() {
  markAlive('L2', { layout: '3-column', slots: 'left/main/right' });
}
```

注:L2 在 renderer 进程,但 diagnostics-bus 在 main 进程。
**实现方式**:L2 alive 通过 IPC 上报到主进程的 diagnostics-bus。
具体实现:`src/shell/diagnostics/L2-alive.ts` 调 `ipcRenderer.invoke('diagnostics.report-alive', { layer: 'L2', ... })`。

---

## 4. V1 → V2 改进对比表

| 维度 | V1 | V2 |
|---|---|---|
| **架构** | 5 个 WebContentsView 独立进程 | 单 BrowserWindow + React 组件 |
| **布局计算** | 主进程 `calculateLayout()` 100 行 + `setBounds()` 摆位 | CSS Flexbox 自动布局 |
| **Resize 响应** | 窗口 resize → 主进程重算 → IPC 通知 → setBounds | CSS 自动响应,0 JS 介入 |
| **Slot 内容** | 主进程切 WebContentsView | React children 注入(L4+L5 处理) |
| **Divider 拖拽** | 主进程监听 mouse + IPC | React 组件 mousedown/move/up |
| **代码量** | shell.ts 652 + layout.ts 100 + slot/ + 多 preload + 多 css = ~2000+ 行 | 预计 ~250 行(根组件 + 3 Slot + Divider + types + diagnostics) |
| **DevTools** | 5 个独立 dev tools | 1 个 renderer dev tools(+ main 一个) |
| **内存占用** | 5 个 renderer 进程 | 1 个 renderer 进程 |

---

## 5. 调用关系(纵向架构验证)

```
src/platform/renderer/index.tsx (L1 renderer 入口)
    ↓ 当前:渲染占位组件 "L0+L1 alive"
    ↓ L2 完成后:渲染 ShellLayout

src/shell/three-column-layout/ShellLayout.tsx (L2 三栏布局)
    └── LeftSlot / MainSlot / RightSlot (L2 Slot 容器,内容空)
        ↓ L4 完成后:Slot 内容由 SlotRegistry 注入
        ↓ L5 完成后:具体 view 渲染在 Slot 内

src/shell/diagnostics/L2-alive.ts (L2 自诊断)
    ↓ 通过 IPC 上报
src/platform/main/diagnostics/diagnostics-bus.ts (统一诊断输出)
```

**调用方向单向**:L2 → L1 入口 → L0 主进程,无逆向依赖。

---

## 6. L2 阶段实施目标

按 charter § 6.3 完成定义:

### 6.1 完成判据

- [ ] `npm start` 跑得起来(L0 + L1 不回归)
- [ ] 屏幕看到**三栏布局**(三个 Slot 各占一定宽度)
- [ ] **可拖拽分隔线**(鼠标拖动改变 LeftSlot vs RightSlot 宽度比例)
- [ ] 主进程 console 打印 `[L0] alive` + `[L1] alive` + `[L2] alive`
- [ ] L2 alive 通过 IPC 从 renderer 上报到主进程

### 6.2 实施清单

#### shell/three-column-layout/(6 文件)
- `ShellLayout.tsx`(根组件)
- `LeftSlot.tsx` + `MainSlot.tsx` + `RightSlot.tsx`(三个占位 Slot)
- `ResizableDivider.tsx`(可拖拽分隔线)
- `shell-layout.css`

#### shell/slot-system/(2 文件)
- `slot-types.ts`(Slot ID 类型)
- `README.md`

#### shell/diagnostics/(1 文件)
- `L2-alive.ts`(L2 自我诊断,通过 IPC 上报)

#### platform/renderer/index.tsx(修改)
- 移除占位组件 "L0+L1 alive"
- 改为渲染 `<ShellLayout />`

#### shared/ipc/(扩展)
- 新增 channel `diagnostics.report-alive`(让 renderer 上报诊断)

### 6.3 不做的事(L2 范围严格限制)

- ❌ Toggle 折叠按钮(L3)
- ❌ TopBar / WorkspaceBar(L3)
- ❌ NavSide(L4)
- ❌ Slot 内挂载真实 view(L4 + L5)
- ❌ Workspace 状态管理(L3)
- ❌ 引入业务 npm 包

### 6.4 自我诊断输出预期

主进程 console:
```
[L0] alive | electron: 40.9.3, node: ..., platform: darwin, ready: true
[L1] alive | window id: 1, size: 1200x800
[L2] alive | layout: 3-column, slots: left/main/right
```

---

## 7. 与 charter 原则的对照

| charter 原则 | 本设计如何遵守 |
|---|---|
| § 1.1 分层(纵向 4 + 横向 L0~L5)| L2 Shell 仅做布局骨架,不超越 L0/L1 责任,不进 L3 状态 / L4 Slot Registry / L5 视图 |
| § 1.2 注册原则 | L2 不直接 import view 实现;Slot 是空容器,等 L4 Registry 注入 children |
| § 1.3 抽象原则(npm 屏障)| L2 不 import 业务 npm,只用 React + clsx 等纯函数白名单 |
| § 5 自我诊断 | `[L2] alive` 输出 + IPC 上报机制 |
| § 6 节奏规则 | 一层一阶段,L2 完成才进 L3 |

---

## 8. 待拍板

- [ ] L2 阶段是否引入 IPC 上报(让 renderer 诊断进主进程 console)?— 我倾向是,框架性基础设施
- [ ] Slot 命名是 `left/main/right` 还是 `left/right`(V1 风格)?— 我倾向 `left/main/right` 三栏更直观
- [ ] Divider 默认位置(50/50 还是 60/40)?— 我倾向 50/50
- [ ] 三栏配色(深色主题各栏背景色不同便于看出三栏边界)?— 我倾向是

---

## 9. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-03 | v0.1 | 初稿;V1 学习(652 行 shell.ts 等)+ 3 条 V1 教训(多 WebContentsView / 布局计算脱节 / Slot 耦合)+ V2 单 BrowserWindow + React Flexbox 改进 + L2 阶段实施目标 + 4 个待拍板 |
