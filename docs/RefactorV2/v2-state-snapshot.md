# V2 当前状态盘点(2026-05-06,L5-B3.4 merge 后)

> 用途:V2 重构进展全景视图,为后续阶段决策提供基线参考。
> 对比 [v1-block-migration-checklist.md](./v1-block-migration-checklist.md):本文件含全 view + 全能力维度,不只 block/mark。
> 维护:每完成一个 L 阶段或大 epic,在此追加状态变化。

---

## 1. 已 merge 进 main 的阶段(11 个)

| # | 阶段 | 内容 | merge commit | 日期 |
|---|---|---|---|---|
| 1 | L0 | 平台层启动 | (early) | — |
| 2 | L2 | Shell + Workspace + Tabs | (early) | — |
| 3 | L3 | Workspace State + Instance | (early) | — |
| 4 | L3.5 | Workspace Bus | (early) | — |
| 5 | L4 | Slot Registry | (early) | — |
| 6 | L5-A | NoteView PM 骨架 | (early) | — |
| 7 | L5-B1 | 文件夹树 | (early) | — |
| 8 | L5-B2 | Marks(4) + Undo | (early) | — |
| 9 | L5-B3.1 | 4 大交互(floating-toolbar / slash / handle / context menu) | (early) | — |
| 10 | L5-B3.2 | 6 个 block 类型(bullet/ordered/task/blockquote/codeBlock/hr)+ 修 8 bug | d8773ba | 2026-05-06 |
| 11 | L5-B3.3 | marks 扩展(underline/textStyle/highlight)+ 3 简单 block(hardBreak/callout/toggleList) | 70c039a | 2026-05-06 |
| 12 | L5-B3.4 | link mark 全栈 + popup 基础设施 + ColorPicker 完整 UI | 159548f | 2026-05-06 |
| 13 | L5-B4 | web view 基础形态(webviewTag + WebView + per-ws state + 简化右键菜单 + link 跨 view 路由) | 68cb7c3 | 2026-05-06 |
| 14 | L5-B4.2 | web 双屏同步翻译(slot-bus + sync driver 7 事件 + Google Translate 注入 + 4 语言切换) | (待 merge) | 2026-05-06 |

---

## 2. 当前 V2 能力清单

### 2.1 NoteView(已迁基本完成)

| 能力 | 状态 | 备注 |
|---|---|---|
| 8 个 mark | ✅ 全部 | bold/italic/underline/strike/code/textStyle/highlight/link |
| 12 个 block | ✅ 基本完成 | text-block / bullet/ordered/task list + listItem/taskItem / blockquote / codeBlock(基础)/ horizontalRule / hardBreak / callout / toggleList |
| 4 大交互 | ✅ | floating-toolbar / slash menu / handle menu / context menu |
| Turn Into | ✅ 11 种 | paragraph/h1/h2/h3/bullet/ordered/task/blockquote/code/hr/callout/toggle |
| popup 基础设施 | ✅ | LinkPanel / ColorPickerPanel(slot 维度,跨 view 复用) |
| link 5 协议路由 | ✅ | http/https/file/krig://note/krig://block + 同文档 anchor 滚动 |
| 笔记导航历史栈 | ⚠️ 仅 link 跳转 | NavSide 切笔记不进栈(降级,留后续) |
| Cmd+K LinkPanel | ✅ | 必须有选区 |
| Cmd+[/Cmd+] 历史 | ✅ | |
| 颜色 swatch UI | ✅ 10×2 | 完整 V1 ColorPicker UI |

### 2.2 NavSide

| 能力 | 状态 |
|---|---|
| 文件夹树 | ✅ |
| 笔记列表 | ✅ |
| 排序 | ✅ |
| 拖拽 | ⚠️ NavSide 内拖拽未验证(L5-B1 时落地) |
| 右键菜单 | ✅ |
| 多选 | ✅ |
| 复制粘贴 | ✅ |

### 2.3 5 大 capability

| capability | 状态 |
|---|---|
| selection | ✅ |
| clipboard | ✅(基础) |
| undo-redo | ✅ |
| drag-and-drop | ✅(基础,跨 view 留后续) |
| insertion | ✅ |

### 2.4 platform / IPC

| IPC | 状态 |
|---|---|
| health.* / diagnostics | ✅(L0-L5) |
| window.fullscreen-changed | ✅ |
| shell.open-external / open-path | ✅ L5-B3.4 新增 |
| **其他 viewAPI** | ❌ **完全缺失**(noteList / noteLoad / fileOpenDialog / mediaPutFile 等) |

---

## 3. V1 → V2 待迁移 epic 清单(本文件维护)

> 不在 v1-block-migration-checklist.md(那个只管 block/mark 维度)。

### 3.1 大 epic — 整 view(从无到有)

| epic | V1 代码量 | 优先级 | 依赖 | 备注 |
|---|---|---|---|---|
| **web view 基础形态**(WebView + WebToolbar + 简化右键菜单)| ~700 行迁(L5-B4)| ✅ 已迁(本批) | electron `<webview>` tag(已启) | link 跨 view 路由验证落地;书签/历史/翻译/AI 留 L5-B4.x |
| **web-bridge**(注入 + extraction + 协议)| ~7600 行(web-bridge/) | 中 | web view | 比 web view 更复杂,Note 内容提取 / AI 工作流依赖 |
| ebook view | 未统计 | 中 | PDF / EPUB 渲染 | KRIG 业务 |
| graph view(canvas) | 未统计 | 低-中 | three.js 等 | KRIG 知识图谱 view |
| thought view | 未统计 | 低 | NoteView variant | NoteView 变体,代码复用度高 |
| ai-note-bridge | 未统计 | 中 | NoteView + LLM API | AI 集成 |
| browser-capability | 未统计 | 中 | 跨 view 浏览器抽象 |  |

### 3.2 平台 / 基础设施 epic

| epic | 优先级 | 阻塞 | 备注 |
|---|---|---|---|
| **viewAPI IPC 阶段**(fileOpenDialog / mediaPutFile / pathInfo 等)| **中** | 解锁:audio/video/file-block 迁移 / LinkPanel 文件 Tab / ebook 导入 | 通用基础设施 |
| **ActiveResourceManager 抽象**(集中管理 activeNoteId / rightActiveNoteId / activeBookId)| 中 | 解锁:link 跨 ws + 真右栏 routing | V2 故意暂缺 |
| **storage 层迁移**(localStorage → SurrealDB) | 低-中 | 数据规模大时 | V1 用 SurrealDB |
| **学习系统**(learning) | 低 | KRIG 业务 | V1 有 |
| **ProseMirror codeBlock 全量(CodeMirror 6)** | ⏸️ 阻塞 | 等用户 CodeMirror 6 计划 | 占位分支 feature/L5B3.3-code-block-migration |

### 3.3 中小 epic — block/mark 维度的剩余

详见 [v1-block-migration-checklist.md](./v1-block-migration-checklist.md)。
关键剩余:image / note-link / external-ref / page-anchor / file-link / column-list /
audio / video / file-block / math-block / table 等。

---

## 4. 推荐下一步候选(按"价值 + 可行性"排序)

| 选项 | 内容 | 价值 | 工作量 | 阻塞? |
|---|---|---|---|---|
| **A. L5-B4 web view 迁移** | 整 view 落地,提供 link 跨 view 测试床 | ⭐⭐⭐⭐⭐ | 中-大(~3000 行核心 + ~2800 行选迁) | 无(electron `<webview>`) |
| B. ActiveResourceManager 抽象 | 解锁 link 跨 ws / 真右栏 routing | ⭐⭐⭐⭐ | 中 | 无 |
| C. viewAPI IPC 阶段 | 解锁 audio/video/file-block / LinkPanel 文件 Tab | ⭐⭐⭐ | 中-大 | 无 |
| D. 简单 block 第二批 | page-anchor / file-link / tweet-block / html-block / frame-block | ⭐⭐ | 中 | 无 |
| E. 中等 block 第一批 | image / note-link / external-ref | ⭐⭐⭐ | 中-大 | 部分依赖 viewAPI |

**当前用户选择(2026-05-06):A — L5-B4 web view 迁移**
理由:为 Note 与 web 内容交互的未来 epic 提供测试床;link 跨 view 路由可以借此真实验证

**已落地(2026-05-06):L5-B4 web view 基础形态**
- platform 启 webviewTag + 安全拦截
- WebView + WebToolbar + per-ws state(google.com 默认主页)
- link 跨 view 路由生效(NoteView 内点 https:// → 当前 ws 右栏 web view)
- 简化版右键菜单 4 项
- 7 commits ~700 行代码

---

## 5. 修订记录

| 日期 | 改动 |
|---|---|
| 2026-05-06 | 初稿;L5-B3.4 merge 后状态盘点;V1 → V2 epic 全景清单;下一步候选 A 拍板 |
| 2026-05-06 | L5-B4 web view 基础形态完成;link 跨 view 路由验证落地 |
| 2026-05-06 | L5-B4.2 web 双屏同步翻译完成;slot-bus(免 IPC)+ sync driver + Google Translate |
