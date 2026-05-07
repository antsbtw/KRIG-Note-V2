# L5-B4 Web View 设计文档

> 阶段:L5-B4 — 落 V1 web view(基础形态),提供 Note 与 Web 内容交互的测试床
> 分支:`feature/L5B4-web-view`
> 文档版本:v0.1 草案
> 起草日期:2026-05-06
>
> **状态:草案待用户拍板** — 7 决策点等用户回答

---

## 0. 背景与目标

L5-B3.4 完成时,link mark / popup 基础设施已就绪,但 link 的"跨 view 路由"
没有真实测试场景(V2 当前只有 NoteView 一个 view)。

用户提出:**先迁 web view 提供测试床**,后续 Note↔Web 交互(KRIG 业务核心)
都依赖此 view。

L5-B4 目标:落 web view 的**基础形态**(浏览网页 + URL 输入 + 前进后退 + 书签),
让以下能力可被验证:
1. link 点击 https:// → 路由到 web view(右栏或新 ws)
2. workspace slot 切换:左栏 NoteView + 右栏 WebView
3. ViewSwitcher Tab 加 Web 选项

V1 web 还有的高级功能(extraction / translate / AI / web-bridge 注入 / sync driver)**全部留 L5-B4.x 后续阶段**,本阶段 1:1 行为对齐 V1 基础 WebView。

---

## 1. V1 web view 现状盘点

### 1.1 V1 整体架构(为什么复杂)

V1 web view 是个**多文件多职责**插件:

| 模块 | 行数 | 职责 |
|---|---|---|
| `components/WebView.tsx` | 382 | 基础浏览(`<webview>` tag + URL bar + 书签 + 历史) |
| `components/WebToolbar.tsx` | 139 | 顶部工具栏(返回/前进/刷新/URL bar/书签/翻译/SlotToggle/关闭) |
| `components/AIWebView.tsx` | 1367 | AI 对话变体 + 内容捕获 + 多模型支持 |
| `components/TranslateWebView.tsx` | 171 | 翻译变体 + 双栏对照 |
| `components/ExtractionView.tsx` | 112 | PDF 提取服务变体 |
| `context-menu/*` | ~200 | 右键菜单(选中文字操作 / 链接操作 / 图片操作) |
| `navside/*` | ~400 | 左侧导航(书签 / 历史 / AI services 列表) |
| `main/ipc-handlers.ts` | 1489 | **巨型 IPC handlers**(书签 / 历史 / AI / 翻译 / TTS / 词汇 / 提取 / browser-capability / web-bridge 等) |
| `main/bookmark-store.ts` + `bookmark-surreal-store.ts` | 385 | 书签存储(localStorage + SurrealDB 双栈) |
| `main/history-store.ts` + `history-surreal-store.ts` | 168 | 历史 |
| `main/extraction-handler.ts` | 161 | PDF/页面提取 |
| `main/register.ts` | 120 | 框架注册(workMode / navside / protocol / menu / IPC) |
| `sync/sync-driver.ts` + `sync-protocol.ts` | ~400 | 双栏 sync(左 web 跟右 web 同步导航) |
| `translate/translate-driver.ts` | ~150 | 翻译 driver |
| `renderer.tsx` | 33 | 入口(根据 ?variant 选 4 种 view) |
| `web.css` | ~300 | 样式 |
| **合计 web/** | **~5800 行** | |
| **合计 web-bridge/** | **~7600 行** | 内容注入 / 提取 / 协议(本阶段不迁) |

### 1.2 关键架构特征

1. **独立 BrowserWindow + webview tag**:
   - V1 main window 不开 webviewTag;web 是独立 vite entry(`web.html`),独立 BrowserWindow 启 `webPreferences.webviewTag: true`
   - 进入 web view 是新窗口,不是当前 main window 内的区域
2. **多变体**:同一个 `<webview>` 配 4 套 React 渲染(WebView / TranslateWebView / AIWebView / ExtractionView),走 URL ?variant= 区分
3. **巨量 IPC**:1489 行 ipc-handlers,囊括书签 / 历史 / 学习 / AI / 提取 / 浏览能力等
4. **左右双栏 sync**:左 webview 跟右 webview 通过 sync driver 同步导航(原文+翻译双栏)
5. **content injection**:web-bridge 模块注入 JS 到 webview 抓取内容(SSE 抓取 / DOM 抓取等)

### 1.3 V2 现状(可复用 / 缺失)

| 资源 | V2 现状 | 用途 |
|---|---|---|
| 多窗口架构 | ❌ V2 是单 main window(workspace slot 内分区) | V1 web 是独立 BrowserWindow,V2 无此能力 |
| webview tag 启用 | ❌ main-window 没启 | 用 `<webview>` 必须启 |
| ViewSwitcher | ✅ | 当前只 1 个 view(note),L5-B4 加 web |
| slot 系统 | ✅(left/right) | link 路由到右栏 |
| view 注册中心 | ✅ `viewTypeRegistry` | view 注册标准化 |
| capability 系统 | ✅ 5 个 | web view 也走标准 |
| 书签 / 历史存储 | ❌ | 留 viewAPI 阶段(localStorage 占位)|
| AI / 翻译 / 提取 | ❌ | 留更后期 epic |

---

## 2. 实施范围(Scope)

### 2.1 In-Scope(L5-B4 v1)

#### 2.1.1 web view 基础形态

- `<webview>` Electron tag 嵌网页(默认 https://www.google.com)
- WebToolbar:返回 / 前进 / 刷新 / URL 输入 / 当前 URL 显示
- 加载状态(loading 旋转)
- did-navigate 事件 + canGoBack/canGoForward 状态
- 标题同步(window.title 显在 ViewSwitcher Tab)

#### 2.1.2 platform 改动(必需)

- 在 V2 main-window 启用 `webPreferences.webviewTag: true`
- 拦截 guest webview attach(同 V1 will-attach-webview):安全配置(contextIsolation: true, nodeIntegration: false)
- partition: 'persist:webview' 隔离 webview 跟主 renderer

#### 2.1.3 view 注册

- 新建 `src/views/web/`(view 维度自治)
- view ID: `'web-view'`
- ViewSwitcher Tab(label: 'Web', icon: '🌐')
- WorkspaceState.slotBinding 加 web view 支持

#### 2.1.4 link 路由验证(L5-B3.4 跨 view 测试床落地)

- 编辑器内点 https:// link → 之前直接调 shell.openExternal
- 加新选项:**右栏开 web view**(对齐 V1 心智)
- ⚠️ 涉及 ActiveResourceManager 抽象(V2 暂缺)— 简化方案:slotBinding.right = 'web-view',
  web view 的 URL 通过新增 `webViewUrl` 字段(per-ws)传

#### 2.1.5 书签 / 历史(降级)

- localStorage 简单实现(对齐 V1 noteStore 模式)
- IPC 不补,renderer 直接读 localStorage

### 2.2 Out-of-Scope(明确不做,留 L5-B4.x)

| 项 | 留下阶段 |
|---|---|
| Translate 变体 + sync driver | L5-B4.2 |
| AI 变体(AIWebView) | L5-B4.3 |
| Extraction 变体 | L5-B4.4 |
| web-bridge 注入(SSE 抓取 / 内容提取) | L5-B5 (web-bridge epic) |
| 右键菜单完整版 | L5-B4.x 跟其他 view 统一 |
| Learning 系统(词汇 / TTS) | 独立 learning epic |

---

## 3. 决策点(请用户拍板)

### Q1:多窗口架构 vs 单窗口启 webview tag?

- **A. 单窗口启 webview tag(推荐)**
  - V2 main window 加 `webviewTag: true` + will-attach-webview 拦截
  - WebView 是 React 组件,内嵌 `<webview>` tag,跟 NoteView 同等地位
  - 优点:不破 V2 单窗口架构;实现简单;link 路由直接走 slotBinding 切换
  - 缺点:webview tag 在主 renderer 中,安全性比 V1 多窗口稍弱(主 renderer 崩溃影响 webview)
- B. 多窗口(对齐 V1)
  - 新建 BrowserWindow(独立 web-host 窗口)
  - 优点:完全 1:1 V1 架构,隔离更强
  - 缺点:V2 单窗口设计推翻,平台层大改;workspace slot 跟独立窗口的关系混乱

**推荐 A**(单窗口 + webview tag),最快验证 link 路由 + 不破 V2 设计。

### Q2:link 路由用什么方式开 web view?

L5-B3.4 当前 https:// link 调 shell.openExternal(系统浏览器)。要改:
- **A. 增"右栏开 web view"为主路径(推荐)**:点 link 切 slotBinding.right = 'web-view' + 设 url
  - 增加配置项 `link.preferredWebViewMode: 'right-slot' | 'system'`(默认 right-slot)
- B. 仍调 shell.openExternal,web view 只通过 ViewSwitcher Tab 手动开
  - 不验证跨 view 路由能力

**推荐 A**(直接验证 link 跨 view 路由)

### Q3:per-workspace url state 怎么管?

V2 当前 workspaceState 没有 webViewUrl 字段。
- **A. WorkspaceState.pluginStates['web'] 加 webViewUrl(推荐)**:跟 NoteView pluginStates['note'] 同模式
- B. webViewStore 全局:跨 ws 共享当前 url(怪异)

**推荐 A**

### Q4:ViewSwitcher Tab 标识

- **A. 跟 V1 一致**:label='Web' icon='🌐' order=3(NoteView 是 1)
- B. 自定义

**推荐 A**

### Q5:webview 默认主页

- **A. https://www.google.com(对齐 V1 默认)**
- B. about:blank
- C. 让用户配置

**推荐 A**(简单 + 可改)

### Q6:书签 / 历史功能

- **A. 砍掉(本阶段不做)**:WebToolbar 不显示书签按钮,等 viewAPI 阶段补
- B. localStorage 简单版:能加书签 + 列表 + 删除,无 UI 完善
- **C. localStorage + 简单 UI(推荐)**:加 ★ 按钮,navside 有书签列表,够基础工作流
  - 工作量:~150 行

**推荐 C**(book-mark 是 web 浏览基础体验,砍了用户期待落空)

### Q7:右键菜单

- **A. 砍掉**:webview 内右键就走系统默认
- **B. 简化版(推荐)**:右键含"在新 ws 打开链接 / 复制链接 / 复制图片地址 / 翻译选中文字(留 placeholder)"
  - 工作量:~100 行
- C. 完整对齐 V1

**推荐 B**(基础够用,完整版留后续)

---

## 4. 实施清单(按依赖顺序)

| 顺序 | 项 | 依赖 | 预估改动 |
|---|---|---|---|
| 1 | platform 启用 webviewTag + will-attach-webview 拦截 | 无 | ~50 行 |
| 2 | shared/constants 加 WEBVIEW_PARTITION | 无 | ~5 行 |
| 3 | views/web/index.ts:registerView 注册 'web-view' | 1 | ~30 行 |
| 4 | views/web/WebView.tsx:基础组件(`<webview>` + state) | 3 | ~200 行 |
| 5 | views/web/WebToolbar.tsx:URL bar + 导航按钮 | 4 | ~120 行 |
| 6 | views/web/web.css 样式 | 4 | ~100 行 |
| 7 | views/web/data-model.ts:per-ws state(webViewUrl)| 3 | ~60 行 |
| 8 | NoteView link-click 加"右栏开 web view"分支 | 7 | ~30 行 |
| 9 | views/web/data-model:bookmark + history(localStorage)| 7 | ~150 行 |
| 10 | views/web/navside-content + 书签列表组件 | 9 | ~150 行 |
| 11 | 简化版右键菜单(webview ipc-message + 上下文菜单) | 4 | ~100 行 |
| 12 | test-checklist § 8 web view 审计条目(~50 条) | 全部 | ~80 条 |
| 13 | v2-state-snapshot 更新(L5-B4 完成) | 全部 | 文档 |
| 14 | 阶段完成报告 | 全部 | ~250 行 |

总预估:**~1100 行代码 + ~250 行文档**,约 5-7 个 commit。

---

## 5. 完成判据(对齐 charter § 6.3,12 条)

| # | 判据 | 验证方式 |
|---|---|---|
| 1 | npm run typecheck + lint 全过 | 实施末验证 |
| 2 | webview tag 在 V2 main-window 启用 | DevTools console 不报错 |
| 3 | will-attach-webview 拦截:contextIsolation: true / nodeIntegration: false | 安全配置生效 |
| 4 | ViewSwitcher 显示 Web Tab(🌐) | 视觉 |
| 5 | 切到 Web Tab 时显示 WebView(默认 google.com) | 视觉 |
| 6 | URL bar 输 anthropic.com Enter → 跳转 | 加载 + 标题同步 |
| 7 | 返回 / 前进 按钮 | canGoBack/Forward 控可用 |
| 8 | 编辑器内点 https:// link → 右栏开 WebView + 设 URL | slotBinding.right = 'web-view' + url 同步 |
| 9 | per-ws state 持久化(切 ws 后回来 URL 保留) | localStorage |
| 10 | 加书签 ★ 按钮 → navside 有书签列表(简化版) | 可加 / 可删 / 可点开 |
| 11 | 右键菜单(简化版):4 项基础操作可用 | 视觉 + 行为 |
| 12 | console L5 alive 输出 web view 注册 | 启动观察 |

---

## 6. 风险 + 开放问题

### 6.1 webview tag 启用对现有功能有影响?

- preload 脚本 webview-content.js 需要新建
- partition 'persist:webview' 隔离,Cookie 不共享主 renderer
- 安全模式 will-attach-webview 必须挂(不挂的话 webview 默认无 contextIsolation,危险)

**预案**:platform 改动单独 commit + 可单独回滚;改完手动验证 NoteView 等现有功能无回归。

### 6.2 link 跨 ws routing(V2 暂缺 ActiveResourceManager)

- 当前 link 点 https://...只能开当前 ws 右栏 web view,不能跳到其他 ws
- 跨 ws 跳转留 ActiveResourceManager 抽象后

**预案**:本阶段降级,不挡 link 主功能。完成报告记录。

### 6.3 webview src-doc / file:// / 自定义协议

- V1 web view 主要承载 https://;file:// 走 shell.openPath(本地文件)
- L5-B3.4 link 5 协议路由 file:// 已走 shell.openPath,不进 web view
- 本阶段 web view 只接 http(s)://

### 6.4 SlotToggle / closeSlot 按钮

- V1 WebToolbar 含 SlotToggle(切左右栏单/双栏)+ 关闭按钮
- V2 当前 slot 切换交互未对齐 V1 — 暂砍掉这两个按钮,留 slot UX epic

---

## 7. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-06 | v0.1 草案 | 初稿;V1 web 现状盘点 + 实施范围 + 7 决策点 + 14 项实施清单 + 12 完成判据 |
