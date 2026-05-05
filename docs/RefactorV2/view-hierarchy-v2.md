# V2 视图层级定义

> v1.0 · 2026-05-05
>
> 配套:[charter.md v0.4](../00-architecture/charter.md)
>
> V1 视图层级定义见 [docs/00-architecture/view-hierarchy.md](../00-architecture/view-hierarchy.md),保留作历史参考。
> 本文件反映 V2 修正——主要修正:NavSide / Toolbar / Overlays 全部归 Workspace Container,Shell 极轻。

---

## 0. V1 → V2 关键修正(总览)

| 元素 | V1 归属 | V2 归属 | 修正理由 |
|---|---|---|---|
| **WorkspaceBar** | Shell | Shell(同) | Workspace Tab 切换器,所有 Workspace 共享 |
| **NavSide** | **Shell**(全局共享一份) | **Workspace Container**(每个 Workspace 自带) | 每 Workspace 真正隔离;V1 NavSide 全局违反 Workspace 隔离原则 |
| **Toolbar** | View 自带(NoteToolbar / GraphToolbar 各自实现) | **Workspace Container 管式样**;view 注册内容 | 视觉一致性物理保证;view 不写 UI |
| **5 大交互浮层**(ContextMenu / Slash / Handle / FloatingToolbar) | View 自带 | **Workspace Container 管式样**;view 注册内容 | 同上 |
| **通用 Overlay**(帮助 / dialog / 进度等) | Shell.overlays(V1 未真落地) | **Workspace Container.overlays** | 一致性原则,无"全局浮层"特例 |
| **Slot Area**(Left + Divider + Right) | Workspace 内 | Workspace Container 内 | 不变 |
| **能力内部 UI**(画板缩放 / 字号选择等) | View 自带(混在 view 代码里) | **Capability 自带**(view 通过 install 自动获得) | view 不写 UI,实现都在能力 |

---

## 1. V2 6 层模型

```
┌─ L0 Application(Electron app)─────────────────────────────────────┐
│  Application Menu(macOS 原生菜单栏,L0 平台层管理,不在 Window 内)   │
│                                                                      │
│  ┌─ L1 Window(BrowserWindow)─────────────────────────────────────┐  │
│  │                                                                  │  │
│  │  ┌─ L2 Shell(轻量框架)──────────────────────────────────────┐  │  │
│  │  │                                                              │  │  │
│  │  │  WorkspaceBar(顶部 28px,Workspace Tab 切换器)             │  │  │
│  │  │                                                              │  │  │
│  │  │  ┌─ Workspace Container(全屏,挂载当前活跃 Workspace)──┐  │  │  │
│  │  │  │                                                        │  │  │  │
│  │  │  │  ┌─ L3 Workspace 实例(自包含)────────────────────┐  │  │  │  │
│  │  │  │  │                                                    │  │  │  │  │
│  │  │  │  │  NavSide-frame  ┐                                  │  │  │  │  │
│  │  │  │  │  Toolbar-frame  │                                  │  │  │  │  │
│  │  │  │  │  Slot Area      │ ← Workspace Container 提供式样   │  │  │  │  │
│  │  │  │  │    Left Slot ─┐ │   内容由 L4 Registry 注册         │  │  │  │  │
│  │  │  │  │    Divider    │ │                                   │  │  │  │  │
│  │  │  │  │    Right Slot ┘ │                                   │  │  │  │  │
│  │  │  │  │  Overlay frames(ContextMenu/Slash/Handle/...)─┘    │  │  │  │  │
│  │  │  │  │                                                    │  │  │  │  │
│  │  │  │  └────────────────────────────────────────────────────┘  │  │  │  │
│  │  │  │                                                        │  │  │  │
│  │  │  └────────────────────────────────────────────────────────┘  │  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘

L4 Slot(Registry 基础设施,横跨 L0~L5,提供 5 大 Registry + 命令 Registry)
L5 View(L5 几乎不存在 — 仅是 install 列表 + 注册声明)
```

---

## 2. 各层精确定义

### 2.1 L0 Application(应用层)

| 属性 | 值 |
|---|---|
| **定义** | macOS / Windows / Linux 桌面应用 |
| **实现** | Electron app(`src/platform/main/index.ts`) |
| **包含** | Application Menu + Window |

**Application Menu**(L0 平台管理):
- 由 `Menu.setApplicationMenu()` 创建
- macOS 原生菜单栏,不在 Window 内渲染
- 菜单项内容来源:菜单触发时**作用于当前活跃 Workspace**(不是 menu 自己有 view-specific 逻辑)

### 2.2 L1 Window(窗口层)

| 属性 | 值 |
|---|---|
| **定义** | 应用主窗口 |
| **实现** | `BrowserWindow`(`src/platform/main/window/main-window.ts`) |
| **尺寸** | 默认 1200×800,最小 800×600 |
| **标题栏** | macOS:`hiddenInset`(红绿灯嵌入)|
| **包含** | Shell |

### 2.3 L2 Shell(轻量框架)

V2 的 Shell **极轻**——只做 Workspace Tab 切换 + Workspace 容器挂载,**不管任何 UI 内容**。

| Shell 内部元素 | 说明 |
|---|---|
| **WorkspaceBar** | 顶部 28px,显示所有 Workspace 标签 + [+] 按钮 |
| **Workspace Container** | 全屏容器,挂载当前活跃 Workspace 实例 |

**Shell 不包含**(与 V1 重大差异):
- ❌ NavSide(归 Workspace Container)
- ❌ 任何 Toolbar(归 Workspace Container)
- ❌ 任何 Overlay(归 Workspace Container)

**目录**:`src/shell/`

### 2.4 L3 Workspace(完整自包含实例)

每个 Workspace 是**完整自包含的 React 组件树**——所有应用级 UI 式样都在这里。

```
L3 Workspace 实例
├── nav-side-frame/             ← 左侧 NavSide 容器(式样)
│                                  内容由 navSideRegistry 注册
├── toolbar-frame/              ← 顶部 Toolbar 容器(式样)
│                                  内容由 toolbarRegistry 注册
├── slot-area/                  ← 中央 Slot 区
│   ├── left-slot/              ← 左 Slot
│   ├── divider/                ← 拖拽分隔线(6px)
│   └── right-slot/             ← 右 Slot(可选,双视图模式)
└── overlay-frames/             ← 浮层 mount 点(式样)
    ├── context-menu-frame/     ← ContextMenu 容器
    ├── slash-menu-frame/       ← Slash 菜单容器
    ├── handle-menu-frame/      ← Handle 菜单容器
    ├── floating-toolbar-frame/ ← FloatingToolbar 容器
    └── generic-overlay-frame/  ← 通用浮层(帮助 / dialog 等)
```

**Workspace Container 管式样,Registry 注册内容**(charter § 1.4):
- 所有 frame 提供**统一式样**(view 平等,无 variant)
- Frame 内的具体内容由 view 通过 L4 Registry 注册
- view 不能改 frame 式样,不能要求"个性化式样"

**Workspace 之间完全隔离**:
- 每个 Workspace 实例独立的 NavSide / Toolbar / Overlay 渲染实例
- 切 Workspace 时,旧实例 hide,新实例 show(visibility 切换,状态保留)
- 数据(笔记目录 / 书签等)在能力层共享,**渲染实例独立**

**目录**:`src/workspace/`

### 2.5 L4 Slot(Registry 基础设施)

L4 提供所有 Registry,被各层调用:

| Registry | 作用 |
|---|---|
| **viewTypeRegistry** | 视图类型注册(view 通过 install 列表声明) |
| **capabilityRegistry** | 能力注册(capability 注册自身实例化方法) |
| **commandRegistry** | 命令注册(命令字符串引用实现) |
| **navSideRegistry** | NavSide 内容注册 |
| **toolbarRegistry** | Toolbar 内容注册 |
| **contextMenuRegistry** | ContextMenu 内容注册 |
| **slashRegistry** | Slash 命令注册 |
| **handleRegistry** | Handle 操作注册 |
| **floatingToolbarRegistry** | FloatingToolbar 内容注册 |
| **overlayRegistry** | 通用浮层注册 |

**Registry 默认归当前 Workspace**——不存在 scope 字段,不存在"全局浮层"特例(charter § 1.4)。

**目录**:`src/slot/`

### 2.6 L5 View(能力组合声明)

> **View 不是模块,View 是能力组合的命名引用**(charter § 1.4)。

每个 view 文件极轻(20~50 行),只做:

```ts
// src/views/note/index.ts
import { registerView } from '@slot/view-type-registry';
import { contextMenuRegistry } from '@slot/context-menu-registry';
import { commandRegistry } from '@slot/command-registry';

// 1. 声明能力组合
registerView({
  id: 'note',
  install: ['text-editing', 'history', 'find-replace', 'note-link'],
});

// 2. 注册命令
commandRegistry.register('note.toggle-toc', () => { /* ... */ });

// 3. 注册菜单内容(式样由 Workspace Container 提供)
contextMenuRegistry.register({
  view: 'note',
  items: [
    { id: 'note-toggle-toc', label: 'Toggle TOC', command: 'note.toggle-toc' },
  ],
});
```

**view 文件不包含**:
- ❌ UI 渲染代码(应用级 UI 来自 Workspace Container,能力级 UI 来自 Capability)
- ❌ 业务逻辑(都在 capability 内部)
- ❌ 状态管理(在 Workspace state)

**view 命名约定**(反映能力组合):
- `note` / `graph-canvas` / `ebook-pdf` / `web-browser` / `family-tree` / 等
- 不用 V1 风格的 `NoteView` / `GraphView` / `EBookView` 等

**目录**:`src/views/<view-name>/`

---

## 3. UI 归属对比表

回答"某个 UI 元素归哪一层"。

| UI 元素 | 归属 | 为什么 |
|---|---|---|
| 应用菜单栏(File / Edit / View / Window) | L0 Application | macOS 原生菜单,Electron 应用级 |
| 主窗口红绿灯 / 拖拽区 | L1 Window | BrowserWindow 自身 |
| WorkspaceBar(Tab 切换) | L2 Shell | 所有 Workspace 共享的切换器 |
| NavSide(左导航) | **L3 Workspace** | 每个 Workspace 自带,Workspace 隔离 |
| Toolbar(顶部应用工具) | **L3 Workspace 管式样**;L5 view 注册内容 | 应用级 UI 一致性 |
| ContextMenu / Slash / Handle / FloatingToolbar | **L3 Workspace 管式样**;L5 view 注册内容 | 应用级浮层一致性 |
| 帮助面板 / Dialog / 通用 Overlay | **L3 Workspace 管式样**;L5 view 注册内容 | 不存在"全局浮层"特例 |
| Slot 容器 + Divider | L3 Workspace | Workspace 布局结构 |
| view 在 Slot 内的渲染 | L5 view 通过 install 调用 capability,capability 渲染 | view 是组合,渲染在能力 |
| **画板缩放 / 网格切换 / 视图模式按钮** | **L4 Capability**(canvas-rendering 内部) | 能力 UI 归能力,不归 view |
| Note 字号选择器 / 段落对齐工具 | L4 Capability(text-editing 内部) | 同上 |
| PDF 页码 / 翻页按钮 | L4 Capability(pdf-rendering 内部) | 同上 |
| 用户编辑的文档内容 | 各能力的 createInstance 渲染 | 数据在语义层,渲染在能力 |

---

## 4. 关键差异:V1 vs V2 关于"View"

### V1 思维

```
NoteView = 一个完整业务模块
  ├── NoteEditor.tsx(1100 行 PM 实例化)
  ├── NoteToolbar.tsx(自带工具栏)
  ├── 各种菜单组件
  └── 大量业务逻辑
```

→ View 是**重业务模块**,代码大量在 view 里。

### V2 思维

```
"note" view = 能力组合声明(30 行)
  install: ['text-editing', 'history', 'find-replace', 'note-link']
  注册菜单 / 命令

实际实现都在能力:
  capability.text-editing(PM 封装)
  capability.history(撤销重做)
  capability.find-replace
  capability.note-link
  ...
```

→ View 是**轻声明**,实现在能力。

---

## 5. 为什么这样修正

### V1 NavSide 归 Shell 的问题

V1 view-hierarchy.md § 2.3 说"Shell 的所有组件都是全局的——不随 Workspace 切换而变化",但实际:
- NavSide 内容(笔记目录展开 / 选中)其实**应该是 Workspace 隔离**的
- V1 NavSide 通过"切显示内容"模拟 Workspace 切换,但状态污染

V2 修正:**NavSide 归 Workspace Container**,真正 Workspace 隔离。

### V1 Toolbar 自带的问题

V1 各 view 自己实现 Toolbar(NoteToolbar / GraphToolbar / 各自样式),导致:
- 视觉破碎
- 改主题要改各 view
- 加新 view 时容易做出与已有 view 不一致的 Toolbar

V2 修正:**Toolbar 式样归 Workspace Container**,内容由 Registry 注册。所有 view 视觉一致。

### V1 view 重的问题

V1 NoteView 1100 行 / GraphView 1500+ 行——大量业务逻辑在 view 里。切底层(prosemirror → Lexical)等于改 view。

V2 修正:**view 极轻(30 行)**,实现都在 capability。切底层零成本。

---

## 6. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-05 | v1.0 | 初稿;反映 V2 vs V1 修正(NavSide / Toolbar / Overlays 全归 Workspace Container);明确 6 层模型 + UI 归属对比;V1 view-hierarchy.md 保留作历史参考 |
