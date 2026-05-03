# KRIG 系统模块清单

> **目的**：记录当前系统的完整模块清单和命名现状，作为后续重新设计模块体系的输入。
> **日期**：2026-03-19

---

## 一、模块清单（src/modules/）

共 14 个模块，262 个 TypeScript 文件。

| 模块 | 文件数 | 状态 | 职责 | 命名问题 |
|------|--------|------|------|---------|
| `note` | 96 | 完成 | ProseMirror 编辑器：Block/Container 模型、数学公式、代码块、表格 | — |
| `pdf-llm` | 50 | Phase 2.3 | PDF 阅读器 + AI 文本提取 + 高亮标注 + 思考联动 | 混合了 PDF 阅读和 AI 提取两个职责 |
| `browser` | 31 | 完成 | 双屏翻译浏览器：WebContentsView 管理、页面解析、翻译注入 | 名字太泛，和 WebView 概念冲突 |
| `ai-bridge` | 22 | 完成 | LLM 编排：prompt 管理、提取指令、SSE 响应解析 | 和 `ai-services` 边界模糊 |
| `nav-sidebar` | 15 | 完成 | 导航侧边栏 UI：模式切换、文档树 | — |
| `language-learning` | 10 | 完成 | 间隔重复、词典、编辑器集成 | — |
| `extraction` | 7 | 开发中 | 内容提取管线（Web/PDF 通用） | 和 `web-extraction` 重叠 |
| `web-extraction` | 6 | Phase 2B.3 | AI 网页内容提取和格式化 | 和 `extraction` 重叠 |
| `shared` | 6 | 活跃 | 跨模块类型定义和公共接口 | — |
| `ai-services` | 6 | 活跃 | AI 服务适配器和集成 | 和 `ai-bridge` 边界模糊 |
| `thought` | 6 | Phase 2.3 | 思考/批注存储，关联高亮 | — |
| `document-store` | 4 | 设计中 | 文档持久化层 | — |
| `media-store` | 2 | 计划中 | 媒体资源管理 | — |
| `calendar` | 1 | 计划中 | 日历/时间线 | — |

---

## 二、Electron 入口清单

### 2.1 主进程

| 文件 | 职责 |
|------|------|
| `src/main.ts` | Electron app 生命周期、窗口管理、IPC 注册 |

### 2.2 Preload 脚本（12 个）

| 文件 | 对应 View / 组件 |
|------|-----------------|
| `preload.ts` | 主窗口（Toolbar） |
| `preload-note.ts` | NoteView |
| `preload-browser.ts` | WebView (right，含翻译注入) |
| `preload-pdf-viewer.ts` | PDFView |
| `preload-nav-sidebar.ts` | NavSidebar |
| `preload-thought.ts` | ThoughtView |
| `preload-divider.ts` | Divider |
| `preload-log-panel.ts` | LogPanel |
| `preload-bookmark-panel.ts` | BookmarkPanel |
| `preload-history-panel.ts` | HistoryPanel |
| `preload-input-popup.ts` | InputPopup |
| `preload-document-list-panel.ts` | DocumentListPanel |

### 2.3 Renderer 入口（11 个）

| 文件 | 对应 View / 组件 | Vite 配置 |
|------|-----------------|----------|
| `renderer.tsx` | Toolbar (主窗口) | `vite.renderer.config.mts` |
| `note-renderer.tsx` (via note.html) | NoteView | `vite.note.config.mts` |
| `pdf-viewer` (via pdf-viewer.html) | PDFView | `vite.pdf-viewer.config.mts` |
| `nav-sidebar` (via nav-sidebar.html) | NavSidebar | `vite.nav-sidebar.config.mts` |
| `thought-panel` (via thought-panel.html) | ThoughtView | `vite.thought-panel.config.mts` |
| `log-panel-renderer.tsx` | LogPanel | `vite.log-panel.config.mts` |
| `bookmark-panel-renderer.tsx` | BookmarkPanel | `vite.bookmark-panel.config.mts` |
| `history-panel-renderer.tsx` | HistoryPanel | `vite.history-panel.config.mts` |
| `input-popup-renderer.tsx` | InputPopup | `vite.input-popup.config.mts` |
| `document-list-panel-renderer.tsx` | DocumentListPanel | `vite.document-list-panel.config.mts` |
| `editor-renderer.tsx` | (旧入口，待确认) | — |

### 2.4 HTML 入口（10 个）

| 文件 | 对应 |
|------|------|
| `index.html` | Toolbar |
| `note.html` | NoteView |
| `pdf-viewer.html` | PDFView |
| `nav-sidebar.html` | NavSidebar |
| `thought-panel.html` | ThoughtView |
| `log-panel.html` | LogPanel |
| `bookmark-panel.html` | BookmarkPanel |
| `history-panel.html` | HistoryPanel |
| `input-popup.html` | InputPopup |
| `document-list-panel.html` | DocumentListPanel |

---

## 三、browser/core 内部清单

`browser/core/` 是当前系统的中枢，管理所有视图的创建、布局、IPC、Tab：

| 文件 | 职责 |
|------|------|
| `view-factory.ts` | 创建所有 WebContentsView（当前一次性创建 13 个 view） |
| `layout-manager.ts` | 控制所有 view 的可见性和 bounds |
| `layout-bounds.ts` | 根据 ViewMode 计算每个 view 的矩形区域 |
| `tab-manager.ts` | Tab 创建/切换/关闭 + WorkspaceSnapshot |
| `workspace-snapshot.ts` | Tab 状态快照定义 |
| `ipc-registry.ts` | IPC handler 集中注册 |
| `navigation-controller.ts` | Web 导航（loadURL, back, forward） |
| `sync-engine.ts` | 左右 WebView 的 DOM 同步 |
| `document-list-controller.ts` | 文档列表 CRUD |
| `menu-builder.ts` | macOS Application Menu 构建 |
| `save-manager.ts` | 统一保存管理 |
| `settings.ts` | 用户设置持久化 |
| `input-popup-controller.ts` | 翻译弹窗控制 |

---

## 四、docs/ 文档清单

### 4.1 系统级设计

| 文档 | 职责 |
|------|------|
| `视图层级定义.md` | 视图层级概念定义（L0-L5） |
| `Tab独立隔离架构设计.md` | Tab 隔离实施方案 |
| `Tab多工作空间设计规格-v2.md` | 旧版 Tab 设计（已被取代） |
| `系统模块清单.md` | 本文档 |
| `technical-architecture.md` | 技术架构概述 |
| `project-status-report.md` | 项目状态和路线图 |
| `module-boundary-analysis.md` | 模块耦合分析 |

### 4.2 模块设计

| 文档 | 对应模块 |
|------|---------|
| `模块1-双屏翻译浏览器核心模块设计方案.md` | browser |
| `模块2-Phase1实施方案.md` | Phase 1 实施 |
| `模块3：知识图谱系统设计方案.md` | 知识图谱（计划中） |
| `模块4：统一渲染架构设计方案.md` | GraphView 渲染引擎（计划中） |
| `language-learning/字典生词本设计方案.md` | language-learning |
| `内容提取模块边界设计.md` | extraction |
| `AI 网页内容提取系统.md` | web-extraction |
| `AI网页提取方法.md` | web-extraction |

### 4.3 子模块设计

| 目录 | 内容 |
|------|------|
| `docs/editor/` | 编辑器 Block 类型、操作定义、测试文档 |
| `docs/Tiptap/` | ProseMirror 测试文档规范 |
| `docs/pdf/` | PDF 提取、高亮、标注规格 |
| `docs/web-extraction/` | Web 内容提取管线 |
| `docs/Navsidebar/` | 导航侧边栏设计 |
| `docs/Toolbar/` | 工具栏设计 |
| `docs/comment module/` | 评论模块设计 |
| `docs/重构UI/` | UI 重构方案 |
| `docs/iterations/` | 迭代追踪 |

---

## 五、已识别的命名问题

| 现状 | 问题 | 影响 |
|------|------|------|
| `leftView` / `rightView` | 用物理位置命名，不表达内容语义 | Layout 和 View 概念耦合 |
| `pdfViewerView` | 冗余的 `Viewer` | 命名不一致 |
| `browser` 模块 | 太泛，和 WebView 概念冲突 | 模块边界不清 |
| `pdf-llm` 模块 | 混合 PDF 阅读和 AI 提取 | 职责不清 |
| `ai-bridge` vs `ai-services` | 两个 AI 相关模块边界模糊 | 功能重叠 |
| `extraction` vs `web-extraction` | 两个提取模块重叠 | 功能重叠 |
| `ViewMode` 类型 | 混合 Layout 和 View 的概念 | 类型膨胀，命名歧义 |
| `'split'` / `'left-only'` / `'note'` | ViewMode 值不表达内容语义 | 代码可读性差 |
