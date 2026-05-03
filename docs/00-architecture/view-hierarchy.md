# KRIG 视图层级定义

> **目的**：定义应用中所有层级的概念边界——从窗口到布局到视图，作为所有视图相关开发的基准文档。
> 本文档一旦确定，后续所有代码、设计文档、命名必须与之一致。

---

## 一、全局结构总览

```
┌─ macOS Application ───────────────────────────────────────────────────┐
│  Application Menu (macOS 原生菜单栏)                                   │
│                                                                        │
│  ┌─ Window (BaseWindow) ────────────────────────────────────────────┐  │
│  │                                                                   │  │
│  │  ┌─ Shell ─────────────────────────────────────────────────────┐  │  │
│  │  │                                                              │  │  │
│  │  │  ┌─ NavSidebar ──┐ ┌─ WorkspaceBar (28px) ──────────────┐  │  │  │
│  │  │  │ ┌───────────┐ │ │                                      │  │  │  │
│  │  │  │ │ ModeBar   │ │ │  [Workspace A ×] [Workspace B ×] [+]│  │  │  │
│  │  │  │ │ Note      │ │ │                                      │  │  │  │
│  │  │  │ │ PDF       │ │ └──────────────────────────────────────┘  │  │  │
│  │  │  │ │ Web       │ │                                           │  │  │
│  │  │  │ │ AI        │ │ ┌─ Workspace Area ─────────────────────┐  │  │  │
│  │  │  │ │ Graph     │ │ │                                       │  │  │  │
│  │  │  │ ├───────────┤ │ │  ┌─ Left Slot ──┐ D ┌─ Right Slot ┐  │  │  │  │
│  │  │  │ │ 笔记目录   │ │ │  │ [Toolbar]    │ i │ [Toolbar]   │  │  │  │  │
│  │  │  │ │ 📁 数学    │ │ │  │ ─────────── │ v │ ────────── │  │  │  │  │
│  │  │  │ │ 📁 日记    │ │ │  │             │ i │            │  │  │  │  │
│  │  │  │ │ 📄 Note1  │ │ │  │    View     │ d │   View     │  │  │  │  │
│  │  │  │ │ 📄 Note2  │ │ │  │             │ e │            │  │  │  │  │
│  │  │  │ │           │ │ │  │             │ r │            │  │  │  │  │
│  │  │  │ │           │ │ │  └─────────────┘   └────────────┘  │  │  │  │
│  │  │  │ └───────────┘ │ │                                       │  │  │  │
│  │  │  └───────────────┘ └───────────────────────────────────────┘  │  │  │
│  │  │                                                              │  │  │
│  │  │  ┌─ Overlays (浮层) ────────────────────────────────────┐  │  │  │
│  │  │  │  DocumentListPanel / BookmarkPanel / HistoryPanel      │  │  │  │
│  │  │  │  LogPanel / InputPopup                                 │  │  │  │
│  │  │  └──────────────────────────────────────────────────────┘  │  │  │
│  │  └──────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、六层模型

应用从外到内共 **6 层**：

| 层级 | 名称 | 定义 | 个数 |
|------|------|------|------|
| **L0** | Application | 桌面应用本身 | 1 |
| **L1** | Window | 应用窗口 | 1 |
| **L2** | Shell | 窗口内的固定骨架 | 1 |
| **L3** | Workspace | 独立的 KRIG Note 工作空间 | N |
| **L4** | Slot | Workspace 内的布局位置 | 2/Workspace |
| **L5** | View | 具体的内容视图 | 1~8/Workspace |

---

### 2.1 L0 — Application

| 属性 | 值 |
|------|------|
| **定义** | macOS/Windows/Linux 上运行的桌面应用 |
| **实现** | Electron app（`src/main.ts`） |
| **包含** | Application Menu + Window |

#### Application Menu

macOS 原生菜单栏，由 `Menu.setApplicationMenu()` 创建，不在 Window 内部渲染。

| 菜单 | 内容 |
|------|------|
| **KRIG Note** | 关于、设置、退出 |
| **File** | 新建文档、导入 Markdown |
| **Edit** | 撤销/重做、剪切/复制/粘贴、查找 |
| **View** | 缩放、开发者工具、刷新 |
| **Documents** | 最近文档列表、新建文档 |
| **Window** | 新建工作空间、关闭工作空间、切换工作空间、最小化、缩放 |
| **Help** | （待定） |

**实现文件**：`src/main/menu/registry.ts`

---

### 2.2 L1 — Window

| 属性 | 值 |
|------|------|
| **定义** | 应用的主窗口 |
| **实现** | `BaseWindow`（`src/main/window/shell.ts`） |
| **尺寸** | 默认 1400×900，最小 800×600 |
| **标题栏** | macOS: `hiddenInset`（红绿灯嵌入，28px 预留区域）；其他平台: `default` |
| **包含** | TitleBar Zone + Shell |

---

### 2.3 L2 — Shell

Shell 是窗口内的**固定骨架**。Shell 的所有组件都是**全局的**——不随 Workspace 切换而变化，所有 Workspace 共享同一套 Shell。

```
Shell
  ├── WorkspaceBar     固定在顶部（28px, 管理工作空间标签）
  ├── NavSidebar       固定在左侧（可折叠，含 ModeBar + 笔记目录）
  ├── Workspace Area   中央内容区域（由活跃 Workspace 填充）
  └── Overlays         浮层面板（覆盖在 Workspace Area 之上）
```

#### 2.3.1 WorkspaceBar

| 属性 | 值 |
|------|------|
| **位置** | 顶部，NavSidebar 右侧，全宽 |
| **高度** | 28px（与 macOS TitleBar Zone 重叠） |
| **实现** | `WebContentsView` |
| **入口** | `shell.html` → `src/renderer/shell/renderer.tsx` → `WorkspaceBar.tsx` |
| **preload** | `src/main/preload/shell.ts` |
| **z-index** | 2（仅次于 Overlays） |

**WorkspaceBar 内部组件**：

| 组件 | 职责 |
|------|------|
| **SidebarToggle** | 展开折叠的 NavSidebar（仅 NavSidebar 折叠时显示） |
| **WorkspaceLabel × N** | 工作空间标签（标题 + × 关闭按钮） |
| **CreateButton (+)** | 创建新工作空间 |

> **注意**：当前代码中 Toolbar 是一个 48px 高的 WebContentsView，内部同时渲染了 TabBar + ContextBar。
> 在新架构中，WorkspaceBar 只保留工作空间管理功能（28px），工具栏（地址栏、导航按钮、保存状态等）下沉到各 View 内部。

#### 2.3.2 NavSidebar

| 属性 | 值 |
|------|------|
| **位置** | 左侧，全高（从 y=0 到窗口底部） |
| **宽度** | 默认 224px，可拖拽调整（180~400px） |
| **可折叠** | 是（折叠时宽度=0） |
| **实现** | `WebContentsView` |
| **入口** | `navside.html` → `src/renderer/navside/renderer.tsx` → `NavSide.tsx` |
| **preload** | `src/main/preload/navside.ts` |
| **z-index** | 1（最底层固定元素） |

**NavSidebar 内部组件**：

| 区域 | 职责 | 详细定义 |
|------|------|---------|
| **ModeBar** | 工作模式切换按钮，切换当前 Workspace 的工作模式 | — |
| **Panel（注册制）** | `EBookPanel` / `WebPanel` / `AIServicesPanel` 等，通过 `registerNavPanel()` 注册 | — |

#### 2.3.3 Workspace Area

| 属性 | 值 |
|------|------|
| **定义** | Shell 中央的内容区域 |
| **位置** | WorkspaceBar 下方、NavSidebar 右侧 |
| **实现** | 逻辑区域（不是独立的 WebContentsView） |
| **内容** | 由当前活跃的 Workspace 填充 |
Workspace Area 是 `src/main/slot/layout.ts` 计算 bounds 时的参考矩形：
```
areaX = navSidebarWidth
areaY = workspaceBarHeight (28px)
areaWidth = windowWidth - navSidebarWidth
areaHeight = windowHeight - workspaceBarHeight
```

Workspace 内部包含 Left Slot + Divider + Right Slot。Divider（6px 拖拽条）属于 Workspace，不属于 Shell。

#### 2.3.4 Overlays（浮层面板）

Overlay 是覆盖在 Workspace 之上的面板，按需显示/隐藏。同一 `group` 的 Overlay 互斥（只能同时显示一个）。

> **当前状态**：KRIG-Note 暂无独立的 Overlay 面板。浮层功能（如 SlashMenu、FloatingToolbar、ContextMenu）由各 View 内部渲染。

---

### 2.4 L3 — Workspace

| 属性 | 值 |
|------|------|
| **定义** | 独立的 KRIG Note 工作环境。每个 Workspace 完全隔离 |
| **显示** | WorkspaceBar 显示所有 Workspace 标签 |
| **填充区域** | Shell 的 Workspace Area |
| **隔离** | Workspace 之间的 View 实例完全独立，互不影响 |
| **实现** | `WorkspaceState`（持有 View 实例池 + Layout Mode） |
| **管理** | `WorkspaceManager`（`src/main/workspace/manager.ts`） |

```
Workspace 内部结构:
  ├── Layout Mode          当前的 Slot 划分方式（如 'note+thought'）
  ├── View 实例池          已创建的 View 实例（懒创建，每个 View 自带工具栏）
  │     ├── NoteView       (0~2 个，自带 NoteToolbar)
  │     ├── EBookView        (0~2 个，自带 PdfToolbar)
  │     ├── WebView        (0~2 个，自带 WebToolbar)
  │     ├── ThoughtView    (0~1 个)
  │     └── GraphView      (0~1 个，自带 GraphToolbar)
  └── 元数据
        ├── id             唯一标识
        ├── title          显示在 WorkspaceBar 上的标题
        ├── navMode        当前工作模式 (note/ebook/web/ai/graph)
        └── createdAt      创建时间
```

#### Workspace 操作

| 操作 | 触发 | 效果 |
|------|------|------|
| **创建** | 点击 WorkspaceBar [+] 或 Cmd+T | 创建新 Workspace 并切换 |
| **切换** | 点击 WorkspaceLabel 或 Cmd+Shift+[/] | hide 旧 Workspace 所有 View + show 新 Workspace 活跃 View |
| **关闭** | 点击 [×] 或 Cmd+W | 保存 dirty 数据 → 销毁所有 View → 切到相邻 Workspace |
| **排序** | 拖拽 WorkspaceLabel | 改变 Workspace 顺序 |

---

### 2.5 L4 — Slot（布局槽位）

| 属性 | 值 |
|------|------|
| **定义** | Workspace 内的布局位置。一个 Slot 容纳一个 View |
| **种类** | Left Slot / Right Slot |
| **职责** | 决定 View 的位置和大小（通过 `setBounds`） |
| **约束** | 一个 Slot 同一时间只能放一个 View |

> **Slot 不是 View。** Slot 是"放 View 的位置"，View 是"放进去的内容"。

#### Layout Mode（布局模式）

Layout Mode 决定 Workspace 如何划分为 Slot，以及每个 Slot 放什么 View。

**命名规则**：`{leftView}+{rightView}` 或 `{view}-only`

**一等公民组合**（UI 直接支持，高频使用）：

| Layout Mode | Left Slot | Right Slot | 场景 | NavMode |
|-------------|-----------|------------|------|---------|
| `note-only` | NoteView | — | 专注写作 | note |
| `note+thought` | NoteView | ThoughtView | 编辑 + 批注 | note |
| `note+web` | NoteView | WebView | 编辑 + 网页/AI | note |
| `note+ebook` | NoteView | EBookView | 编辑 + PDF 参考 | note |
| `ebook-only` | EBookView | — | 专注阅读 | ebook |
| `ebook+note` | EBookView | NoteView | 电子书提取到笔记 | ebook |
| `ebook+thought` | EBookView | ThoughtView | 电子书 + 批注 | ebook |
| `ebook+web` | EBookView | WebView | 电子书 + AI 对话 | ebook |
| `web-only` | WebView | — | 全屏浏览 | web |
| `web+web` | WebView | WebView | 左右翻译对照 | web |
| `web+note` | WebView | NoteView | 浏览 + 记录 | web |

**二等公民组合**（可通过拖拽/快捷键触发，低频）：

| Layout Mode | Left Slot | Right Slot | 场景 |
|-------------|-----------|------------|------|
| `note+note` | NoteView | NoteView | 左右对照编辑 |
| `note+graph` | NoteView | GraphView | 编辑 + 图谱 |
| `graph-only` | GraphView | — | 图谱探索 |
| `thought-only` | ThoughtView | — | 全屏批注 |
| `ebook+ebook` | EBookView | EBookView | 左右对照阅读 |
| `web+graph` | WebView | GraphView | AI + 图谱 |

#### Slot 尺寸计算

```
Single Slot (xxx-only):
  slot.x      = workspaceX
  slot.y      = workspaceY
  slot.width   = workspaceWidth
  slot.height  = workspaceHeight

Dual Slot (xxx+yyy):
  leftSlot.x       = workspaceX
  leftSlot.width    = (workspaceWidth - dividerWidth) × splitRatio

  divider.x        = leftSlot.x + leftSlot.width

  rightSlot.x      = divider.x + dividerWidth
  rightSlot.width   = workspaceWidth - leftSlot.width - dividerWidth

  splitRatio 范围: 0.25 ~ 0.75 (可拖拽 Divider 调整)
```

---

### 2.6 L5 — View（内容视图）

View 是最底层的内容单元。每个 View 实例是一个独立的 `WebContentsView`。

```
View（5 种类型）
  ├── NoteView      笔记编辑器 (ProseMirror)
  ├── EBookView     电子书阅读器 (PDF/EPUB/DjVu/CBZ)
  ├── WebView       Web 浏览器 (Chromium, 含 AI 服务 + browser-capability)
  ├── ThoughtView   思考面板
  └── GraphView     知识图谱 (WebGL2)    [未实现]
```

---

## 三、View 详细定义

### 3.1 NoteView — 笔记编辑器

| 属性 | 值 |
|------|------|
| **类型标识** | `ViewType = 'note'` |
| **职责** | ProseMirror 富文本编辑器。创建、编辑、查看笔记文档 |
| **入口** | `note.html` → `src/plugins/note/components/NoteView.tsx` |
| **preload** | `src/main/preload/view.ts`（统一 View preload） |
| **API** | `window.viewAPI` |
| **IPC 前缀** | `IPC.NOTE_*`（`src/shared/types.ts`） |
| **每 Workspace 上限** | 2（Left + Right Slot 各一个） |

**核心状态**（View 内部持有，不外泄）：

| 状态 | 说明 | 持久化 |
|------|------|--------|
| 文档 ID | 当前打开的文档标识 | DocumentStore |
| 文档内容 | Atom[] → ProseMirror Doc | DocumentStore |
| undo/redo 历史 | ProseMirror Transaction 历史 | 不持久化 |
| 光标位置 | Selection | 不持久化 |
| 滚动位置 | scrollTop | 不持久化 |
| Thought 关联 | 文档内的 thought anchor | Document JSON |

**IPC 通道**：

| 通道 | 方向 | 用途 |
|------|------|------|
| `note:open-document` | main → note | 加载已有文档 |
| `note:new-document` | main → note | 创建空白文档 |
| `note:save-request` | main → note | 请求保存 |
| `note:load-extracted-content` | main → note | 加载提取内容（替换） |
| `note:append-extracted-content` | main → note | 追加提取内容 |
| `note:state-changed` | note → main | 通知标题/保存状态变化 |
| `note:navigate-to` | note → main | 打开链接到系统浏览器 |
| `note:send-to-ai` | note → main | 发送选中内容到 AI |
| `note:ai-anchor-thought` | main → note | 标记 AI 思考锚点 |
| `note:toggle-width` | main → note | 切换全宽 |
| `note:load-tutorial` | main → note | 加载教程文档 |
| `note:import-clipboard` | note → main | 导入剪贴板 Markdown |
| `note:close` | note ↔ main | 关闭编辑器 |

### 3.2 EBookView — 电子书阅读器

| 属性 | 值 |
|------|------|
| **类型标识** | `ViewType = 'ebook'` |
| **职责** | 电子书阅读（PDF/EPUB/DjVu/CBZ）、书签、进度记录 |
| **入口** | `ebook.html` → `src/plugins/ebook/` |
| **preload** | `src/main/preload/view.ts`（统一 View preload） |
| **API** | `window.viewAPI` |
| **IPC 前缀** | `IPC.EBOOK_*` / `IPC.BOOKSHELF_*`（`src/shared/types.ts`） |
| **每 Workspace 上限** | 2 |
| **支持格式** | PDF（FixedPage）、EPUB（Reflowable）、DjVu、CBZ |

**核心状态**：

| 状态 | 说明 | 持久化 |
|------|------|--------|
| 电子书文件路径 | 当前打开的电子书 | BookshelfStore |
| 当前页码/CFI | 阅读位置 | BookshelfStore（progress） |
| 缩放级别 | 页面缩放 | 不持久化 |
| 书签数据 | 页面书签 | BookshelfStore |

**渲染模式**：

| 格式 | 渲染模式 | 实现 |
|------|---------|------|
| PDF / DjVu / CBZ | FixedPage（Canvas） | `src/plugins/ebook/renderers/pdf/` |
| EPUB | Reflowable（HTML） | `src/plugins/ebook/renderers/epub/` |

### 3.3 WebView — Web 浏览器

| 属性 | 值 |
|------|------|
| **类型标识** | `ViewType = 'web'` |
| **职责** | 通用 Web 浏览器，加载任意 URL，包括 AI 服务 |
| **入口** | `web.html` → `src/plugins/web/components/` |
| **preload** | `src/main/preload/view.ts`（统一 View preload）+ `src/main/preload/web-content.ts`（网页注入） |
| **API** | `window.viewAPI` |
| **IPC 前缀** | `IPC.WEB_*`（`src/shared/types.ts`） |
| **每 Workspace 上限** | 2 |

> **AI 不是独立的 View 类型。** ChatGPT/Claude/Gemini 是加载了特定 URL 的 WebView。
> AI 的特殊行为（对话提取、Artifact 下载等）由 `src/plugins/browser-capability/` 插件层实现，不改变 View 身份。

**核心状态**：

| 状态 | 说明 | 持久化 |
|------|------|--------|
| 当前 URL | 页面地址 | 不持久化 |
| 导航历史 | back/forward 栈 | 不持久化 |
| DOM 状态 | 表单值、滚动位置 | 不持久化 |
| SSE 会话 | AI 响应流数据 | 不持久化 |

**IPC 通道**（导航/浏览相关）：

| 通道 | 方向 | 用途 |
|------|------|------|
| `navigate` | main → web | 导航到 URL |
| `go-back` / `go-forward` | main → web | 前进/后退 |
| `url-changed` | web → main | URL 变化通知 |
| `page-title-updated` | web → main | 页面标题变化 |

### 3.4 ThoughtView — 思考面板

| 属性 | 值 |
|------|------|
| **类型标识** | `ViewType = 'thought'` |
| **职责** | 显示和编辑 Thought（思考/批注），关联到 NoteView Block 或 EBookView 高亮 |
| **入口** | `thought.html` → `src/plugins/thought/` |
| **preload** | `src/main/preload/view.ts`（统一 View preload） |
| **API** | `window.viewAPI` |
| **IPC 前缀** | `IPC.THOUGHT_*`（`src/shared/types.ts`） |
| **每 Workspace 上限** | 1 |

**核心状态**：

| 状态 | 说明 | 持久化 |
|------|------|--------|
| Thought 列表 | 当前上下文的所有 thought | Note: Document JSON; PDF: PDFHighlightStore |
| 选中 Thought | 当前聚焦的 thought | 不持久化 |
| 滚动位置 | 面板滚动 | 不持久化 |

**IPC 通道**：

| 通道 | 方向 | 用途 |
|------|------|------|
| `thought:create` | main → thought | 创建新 thought |
| `thought:load` | main → thought | 加载 thought 列表 |
| `thought:activate` | main → thought | 聚焦指定 thought |
| `thought:delete` | thought → main | 删除 thought |
| `thought:update` | thought → main | 更新 thought 内容 |
| `thought:scroll-to-anchor` | thought → main → note/ebook | 滚动到源锚点 |
| `thought:content-changed` | thought → main | 内容变化（触发保存） |
| `thought:get-all` | main ↔ thought | 获取所有 thought |
| `thought:toggle-fullscreen` | thought → main | 切换全屏 |
| `thought:scroll-sync` | thought → main | 同步可见 thought ID |

### 3.5 GraphView — 知识图谱 [未实现]

| 属性 | 值 |
|------|------|
| **类型标识** | `ViewType = 'graph'` |
| **职责** | 自建 WebGL2 渲染引擎，知识图谱可视化与交互 |
| **入口** | 待创建 |
| **preload** | `src/main/preload/view.ts`（统一 View preload） |
| **API** | `window.viewAPI` |
| **IPC 前缀** | `IPC.GRAPH_*`（待定义） |
| **每 Workspace 上限** | 1 |
| **详细设计** | `docs/模块4：统一渲染架构设计方案.md` |

---

## 四、View 之间的通信关系

View 之间不直接通信。所有跨 View 通信都经过 **main 进程路由**。

```
NoteView ──IPC──→ main ──IPC──→ ThoughtView    (创建/加载 thought)
EBookView  ──IPC──→ main ──IPC──→ ThoughtView    (创建/加载 thought)
EBookView  ──IPC──→ main ──IPC──→ NoteView       (提取内容到笔记)
WebView  ──IPC──→ main ──IPC──→ NoteView       (提取内容到笔记)
NoteView ──IPC──→ main ──IPC──→ WebView        (发送到 AI)
ThoughtView ──IPC──→ main ──IPC──→ NoteView    (滚动到锚点)
ThoughtView ──IPC──→ main ──IPC──→ EBookView     (滚动到高亮)
```

### 4.1 主要通信模式

| 模式 | 源 View | 目标 View | 数据流 | 触发方式 |
|------|---------|----------|--------|---------|
| **内容提取** | WebView / EBookView | NoteView | Atom[] (提取的结构化内容) | 用户选择区域 → AI 提取 |
| **思考联动** | NoteView / EBookView | ThoughtView | Thought 对象 | 用户创建批注 |
| **锚点跳转** | ThoughtView | NoteView / EBookView | thoughtId + anchorType | 用户点击 thought |
| **AI 对话** | NoteView | WebView (AI) | Markdown 文本 | 用户发送选中内容 |

### 4.2 IPC 路由规则

| 方向 | 路由方式 |
|------|---------|
| main → 活跃 View | `view.webContents.send(...)` |
| View → main | `ipcMain.on/handle`，通过 `event.sender.id` 路由 |
| View → 同 Workspace 的另一个 View | `viewAPI.sendToOtherSlot(message)` → main 路由 → 对端 `VIEW_MESSAGE_RECEIVE` |
| main → 所有 View | 广播 |

---

## 五、Workspace 与 View 的生命周期

### 5.1 View 实例池

每个 Workspace 拥有自己的 View 实例池。View 懒创建，Workspace 关闭时全部销毁。

```
Workspace A (Layout: note+thought):
  View 实例池:
    ├── NoteView-A1    ← 活跃, Left Slot
    ├── ThoughtView-A1 ← 活跃, Right Slot
    ├── EBookView-A1     ← 已创建但隐藏（之前打开过 PDF）
    └── WebView        ← 未创建（从未使用过 Web 模式）

Workspace B (Layout: ebook+note):
  View 实例池:
    ├── EBookView-B1     ← 活跃, Left Slot
    ├── NoteView-B1    ← 活跃, Right Slot
    └── ThoughtView-B1 ← 已创建但隐藏
```

### 5.2 View 实例上限

| View 类型 | 每 Workspace 最多 | 说明 |
|-----------|-------------|------|
| NoteView | 2 | Left + Right Slot 各一个（对照编辑） |
| EBookView | 2 | Left + Right Slot 各一个 |
| WebView | 2 | Left + Right Slot 各一个 |
| ThoughtView | 1 | 跟随当前上下文 |
| GraphView | 1 | 通常只需一个 |

极端上限：2+2+2+1+1 = **8 个/Workspace**（实际不会全部创建）。

### 5.3 生命周期事件

```
View 创建 ── 用户首次切到需要该 View 的 Layout Mode
              → TabContainer.noteView getter (懒创建)
              → new WebContentsView({ preload: ... })
              → loadURL(html)
              → mainWindow.contentView.addChildView()
              → onViewCreated 钩子（注册事件监听、SaveManager 等）

View 隐藏 ── 切换 Layout Mode 或切换 Workspace
              → setVisible(false)
              → setBounds({ x: -9999, y: -9999, width: 0, height: 0 })
              → View 内部状态完整保留

View 显示 ── 切换回包含该 View 的 Layout Mode / Workspace
              → setVisible(true)
              → setBounds(slot 计算的矩形)
              → 无需重新加载内容

View 销毁 ── Workspace 关闭
              → 保存 dirty 数据（SaveManager）
              → onViewDestroying 钩子（清理事件监听）
              → mainWindow.contentView.removeChildView()
              → webContents.close()（释放 renderer 进程）
```

---

## 六、与当前代码的映射

### 6.1 旧 ViewMode → 新 Layout Mode

| 当前 ViewMode | 新 Layout Mode | Left Slot | Right Slot |
|--------------|----------------|-----------|------------|
| `'note-only'` | `note-only` | NoteView | — |
| `'note'` | `web+note` | WebView | NoteView |
| `'note-thought'` | `note+thought` | NoteView | ThoughtView |
| `'note-thought-only'` | `thought-only` | ThoughtView | — |
| `'note-ai'` | `note+web` | NoteView | WebView (AI) |
| `'left-only'` | `web-only` | WebView | — |
| `'split'` | `web+web` | WebView | WebView |
| `'right-only'` | `web-only` | — | WebView |
| `'pdf'` | `ebook+note` | EBookView | NoteView |
| `'pdf-only'` | `ebook-only` | EBookView | — |
| `'pdf-thought'` | `ebook+thought` | EBookView | ThoughtView |
| `'pdf-thought-only'` | `thought-only` | ThoughtView | — |
| `'pdf-ai'` | `ebook+web` | EBookView | WebView (AI) |
| `'pdf-fullscreen'` | `ebook-only` | EBookView (全屏) | — |
| `'ai-note'` | `web+note` | WebView (AI) | NoteView |
| `'ai-web'` | `web+web` | WebView (AI) | WebView |
| `'ai-graph'` | `web+graph` | WebView (AI) | GraphView |

### 6.2 旧命名 → 新命名

| 旧命名 | 层级 | 问题 | 新命名 |
|--------|------|------|--------|
| `leftView` | L5 | 用位置命名 | `webView`（按内容类型） |
| `rightView` | L5 | 用位置命名 | `webView`（按内容类型） |
| `pdfViewerView` | L5 | 冗余 `Viewer` | `ebookView` |
| `ViewMode` | L4 | 混合 Layout + View | `LayoutMode` |
| `'split'` | L4 | 不表达内容 | `'web+web'` |
| `'left-only'` | L4 | 用位置命名 | `'web-only'` |
| `'note'` | L4 | 歧义 | `'web+note'` |
| `ViewSet` | L2 | 扁平混合全局/per-workspace | `GlobalViews` + `TabContainer` |
| `ViewRefs` | L2 | 同上 | 同上 |

### 6.3 当前文件 → 层级归属

| 当前文件 | 职责 | 层级归属 |
|---------|------|---------|
| `src/main/window/shell.ts` | 窗口创建 + View 管理 | L1 Window + L2 Shell |
| `src/main/slot/layout.ts` | Slot 尺寸计算 | L4 Slot |
| `src/main/slot/divider.ts` | 分割线拖拽 | L4 Slot |
| `src/main/workspace/manager.ts` | Workspace 状态管理 | L3 Workspace |
| `src/main/ipc/handlers.ts` | IPC 集中注册 | 跨层 |
| `src/main/workmode/registry.ts` | 工作模式注册 | L3 Workspace |
| `src/main/view/registry.ts` | View 类型注册 | L5 View |
| `src/main/protocol/registry.ts` | 协议注册 | L5 View 间通信 |

---

## 七、完整实例注册表

系统中所有 `WebContentsView` 实例的完整清单：

### 7.1 全局实例（Shell 层，每种只有 1 个）

| 实例 | 层级 | 入口 HTML | preload |
|------|------|----------|---------|
| WorkspaceBar | L2 Shell | `shell.html` | `src/main/preload/shell.ts` |
| NavSide | L2 Shell | `navside.html` | `src/main/preload/navside.ts` |
| Divider | L2 Shell | inline | `src/main/preload/divider.ts` |

**全局实例总数：3 个**

### 7.2 Per-Workspace 实例（View 层，每 Workspace 按需创建）

| 实例 | 层级 | 入口 | preload | 每 Workspace 上限 |
|------|------|------|---------|-----------|
| NoteView | L5 View | `note.html` | `src/main/preload/view.ts` | 2 |
| EBookView | L5 View | `ebook.html` | `src/main/preload/view.ts` | 2 |
| WebView | L5 View | `web.html` | `src/main/preload/view.ts` | 2 |
| ThoughtView | L5 View | `thought.html` | `src/main/preload/view.ts` | 1 |
| GraphView | L5 View | 待创建 | `src/main/preload/view.ts` | 1 |

> **统一 preload**：所有 View 共享 `src/main/preload/view.ts`，暴露 `window.viewAPI`。

**Per-Workspace 实例上限：8 个/Workspace**

### 7.3 总实例数

| 场景 | 全局 | Per-Workspace | 总计 |
|------|------|---------|------|
| 1 Workspace（最少） | 3 | 2 | 5 |
| 1 Workspace（典型） | 3 | 3~4 | 6~7 |
| 5 Workspace（典型） | 3 | 15~20 | 18~23 |
| 10 Workspace（上限） | 3 | 30~50 | 33~53 |

---

## 八、命名规范

### 8.1 类型定义

```typescript
/** L5 — View 类型 */
type ViewType = 'note' | 'ebook' | 'web' | 'thought' | 'graph';

/** L4 — 布局模式（{left}+{right} 或 {view}-only） */
type LayoutMode =
  | 'note-only' | 'ebook-only' | 'web-only' | 'graph-only' | 'thought-only'
  | `${ViewType}+${ViewType}`;

/** L4 — Slot 位置 */
type SlotSide = 'left' | 'right';

/** L2 — NavSidebar 模式 */
type NavMode = 'note' | 'ebook' | 'web' | 'ai' | 'graph';
```

### 8.2 变量命名规范

| 概念 | 变量名 | 说明 |
|------|--------|------|
| NoteView 实例 | `noteView` | — |
| EBookView 实例 | `ebookView` | 不是 `pdfViewerView` |
| WebView 实例 | `webView` | 不是 `leftView` / `rightView` |
| ThoughtView 实例 | `thoughtView` | — |
| GraphView 实例 | `graphView` | — |
| Workspace 管理器 | `workspaceManager` | `src/main/workspace/manager.ts` |
| 活跃 Workspace | `workspaceManager.getActive()` | — |
| 布局模式 | `layoutMode` | 不是 `viewMode` |

### 8.3 IPC 通道命名规范

| View | 通道前缀 | 定义位置 |
|------|---------|---------|
| NoteView | `note:` | `IPC.NOTE_*`（`src/shared/types.ts`） |
| EBookView | `ebook:` / `bookshelf:` | `IPC.EBOOK_*` / `IPC.BOOKSHELF_*` |
| WebView | `web:` | `IPC.WEB_*` |
| ThoughtView | `thought:` | `IPC.THOUGHT_*` |
| GraphView | `graph:` | 待定义 |
| 全局/Shell | `workspace:` / `slot:` / `navside:` | `IPC.WORKSPACE_*` / `IPC.SLOT_*` / `IPC.NAVSIDE_*` |

> **统一定义**：所有 IPC 通道在 `src/shared/types.ts` 的 `IPC` 常量对象中统一定义。

---

## 九、架构约束（不变量）

1. **View = 独立进程**：每个 View 实例是一个独立的 `WebContentsView`，拥有独立的 renderer 进程。View 之间只能通过 main 进程 IPC 通信。

2. **Workspace 隔离**：不同 Workspace 的 View 实例之间没有任何直接关联。切换 Workspace 只改变可见性（show/hide），不改变任何 View 的内部状态。

3. **工具栏属于 View**：每个 View 内部自带工具栏（NoteToolbar、PdfToolbar、WebToolbar 等），在 View 内部渲染。Workspace 和 Shell 不管理工具栏。

3. **Layout 与 View 解耦**：Slot（L4）只管位置和大小，不关心里面放什么 View（L5）。任何 View 类型可以放到任何 Slot。

4. **Shell 不持有 per-workspace View 引用**：Toolbar、NavSidebar 等 Shell 组件（L2）不直接引用任何 per-workspace View（L5）。它们通过 `WorkspaceManager` 获取活跃 Workspace 的 View。

5. **View 懒创建**：View 实例在首次需要时才创建。Workspace 刚创建时可以没有任何 View 实例。

6. **View 生命周期绑定 Workspace**：View 随 Workspace 创建（懒创建），随 Workspace 关闭而销毁。不存在脱离 Workspace 独立存在的 View。

7. **IPC 路由可追溯**：每条 IPC 消息必须能追溯到来源 Workspace（通过 `event.sender.id` → `tabs.findTabByWebContentsId()`）。

---

## 十、层级关系图

```
L0  Application
     │
     ├── Application Menu (macOS 原生菜单: File/Edit/View/Documents/Window)
     │
     └── L1  Window (BaseWindow 1400×900)
              │
              ├── TitleBar Zone (28px, macOS 红绿灯)
              │
              └── L2  Shell
                       │
                       ├── Toolbar [WebContentsView]
                       │     ├── WorkspaceBar (工作空间标签列表)
                       │     ├── AddressBar (URL 输入)
                       │     ├── NavigationButtons (← → ↻)
                       │     ├── ModelSelector (ChatGPT/Claude/Gemini)
                       │     ├── ZoomControl (缩放)
                       │     └── SaveStatus (保存状态)
                       │
                       ├── NavSidebar [WebContentsView, 224px, 可折叠]
                       │     ├── ModeSwitch (Note/PDF/Web/AI/Graph 图标)
                       │     └── DocumentTree (笔记文件夹 + 文档列表)
                       │
                       ├── Divider [WebContentsView, 6px]
                       │
                       ├── Workspace (逻辑区域, 非 View)
                       │     │
                       │     ├── L3  Workspace A (活跃)
                       │     │        ├── LayoutMode: 'note+thought'
                       │     │        │
                       │     │        ├── L4  Left Slot ──→ L5 NoteView-A1
                       │     │        └── L4  Right Slot ─→ L5 ThoughtView-A1
                       │     │
                       │     │        (隐藏的 View: EBookView-A1)
                       │     │
                       │     ├── L3  Workspace B (隐藏)
                       │     │        ├── LayoutMode: 'ebook+note'
                       │     │        ├── L4  Left Slot ──→ L5 EBookView-B1
                       │     │        └── L4  Right Slot ─→ L5 NoteView-B1
                       │     │
                       │     └── L3  Workspace C (隐藏) ...
```

---

## 十一、与其他文档的关系

| 文档 | 关系 |
|------|------|
| `docs/系统模块清单.md` | 系统全貌清单，记录当前代码和命名现状 |
| `docs/分层原则符合性评估报告-2026-04-21.md` | 分层原则评估，指出越层问题 |
| `docs/note/Schema-Reference.md` | NoteView (L5) 内部的 Block Schema 参考 |
| `docs/block/` | NoteView (L5) 各 Block 类型的设计文档 |
| `docs/web/browser-capability/` | WebView (L5) 的 AI 提取能力层设计 |
| `docs/Ai-Design/KRIG-Atom体系设计文档.md` | 跨 View 的数据模型 |
| `CLAUDE.md` | 开发规范和分支策略 |
