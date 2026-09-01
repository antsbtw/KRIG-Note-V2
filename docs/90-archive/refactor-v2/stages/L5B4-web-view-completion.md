# L5-B4 Web View(基础形态)阶段完成报告

> 阶段:L5-B4 — web view 基础形态落地,验证 link 跨 view 路由 + 提供 Note↔Web 交互测试床
> 分支:`feature/L5B4-web-view`
> 完成日期:2026-05-06
> 设计文档:[L5B4-web-view-design.md](./L5B4-web-view-design.md)

---

## 1. 阶段定位

L5-B3.4 完成时 link mark / popup 基础设施已就绪,但跨 view 路由没有真实测试场景。
用户决策:**先迁 web view 提供测试床**,后续 Note↔Web 交互(KRIG 业务核心)都依赖此 view。

V1 web 是 ~5800 行大插件(4 变体 + 巨型 IPC + sync driver + 提取 + 翻译 + AI),
本阶段只迁**基础形态**(~700 行):浏网页 + URL bar + 前进后退 + 简化右键菜单。
书签 / 历史 / 翻译 / AI / 提取 / sync driver / web-bridge 全部留 L5-B4.x 后续阶段。

---

## 2. 完成判据(对齐设计 § 5,12 条)

| # | 判据 | 状态 | 验证方式 |
|---|---|---|---|
| 1 | npm run typecheck + lint 全过 | ✅ | 每 commit 验证 |
| 2 | webview tag 在 V2 main-window 启用 | ✅ | platform/main/window/main-window.ts |
| 3 | will-attach-webview 拦截:contextIsolation/nodeIntegration 安全配置 | ✅ | 同上 |
| 4 | ViewSwitcher 显示 Web Tab(🌐) | ✅ | views/web/index.ts navSideTab |
| 5 | 切到 Web Tab 时显示 WebView(默认 google.com) | ✅ | WEBVIEW_DEFAULT_URL |
| 6 | URL bar 输 anthropic.com Enter → 跳转 | ✅ | WebToolbar 自动补 https:// |
| 7 | 返回 / 前进 按钮 | ✅ | canGoBack/canGoForward 实时同步 |
| 8 | 编辑器内点 https:// link → 右栏开 WebView + 设 URL | ✅ | onOpenWebUrl 实现 |
| 9 | per-ws state 持久化 | ✅ | pluginStates['web'].currentUrl |
| 10 | 加书签 ★ 按钮 → navside 书签列表 | ⏸️ **降级**(Q6=A 砍掉,留 viewAPI 阶段) | 见遗留问题 |
| 11 | 右键菜单(简化版):4 项基础操作 | ✅ | 复制链接/图片地址/选中文字 + 翻译 placeholder |
| 12 | console L5 alive 输出 web view 注册 | ✅ | 启动观察 |

**总评**:**通过**(代码侧 11 ✅ + 1 ⏸️ 按设计 Q6=A 主动降级)。

⚠️ 用户视觉验证 ~30 条留 merge 前集中跑(沿用前阶段模式)。

---

## 3. 该阶段实施的具体内容

### 3.1 设计文档(1 篇)

| 文件 | 内容 |
|---|---|
| `stages/L5B4-web-view-design.md` v0.1 | V1 现状盘点(~5800 行复杂度)+ V2 实施范围 + 7 决策点(全 A 拍板)+ 14 项实施清单 + 12 完成判据 |

### 3.2 platform 改动(2 文件)

| 文件 | 改动 |
|---|---|
| `platform/main/window/main-window.ts` | webPreferences.webviewTag: true + will-attach-webview 拦截(安全配置 contextIsolation/nodeIntegration) |
| `shared/constants/webview.ts`(新) | WEBVIEW_PARTITION='persist:webview' + WEBVIEW_DEFAULT_URL='https://www.google.com' |

### 3.3 view 层新增(7 文件)

| 文件 | 行数 | 职责 |
|---|---|---|
| `views/web/index.ts` | 23 | registerView 'web-view' + navSideTab + registerWebContextMenu |
| `views/web/WebView.tsx` | ~165 | `<webview>` tag + WebToolbar + 事件绑定(did-navigate / loading / context-menu) + per-ws state 同步 |
| `views/web/WebToolbar.tsx` | 95 | 后退/前进/刷新 + URL bar(Enter 自动补 https://) |
| `views/web/web.css` | ~90 | 布局 + toolbar + URL input |
| `views/web/data-model.ts` | 50 | per-ws state hydrate + setWebUrl 写 pluginStates['web'] |
| `views/web/context-menu-integration.ts` | 115 | showWebContextMenu / 4 命令 / 4 菜单项注册 |

### 3.4 跨 view 路由集成(2 文件改)

| 文件 | 改动 |
|---|---|
| `drivers/text-editing-driver/plugins/build-link-click-plugin.ts` | LinkClickHandler 接口扩 onOpenWebUrl?(view 注入);http(s) 分支:onOpenWebUrl 优先,否则退化 shell.openExternal |
| `views/note/link-click-integration.ts` | 实现 onOpenWebUrl:setWebUrl + slotBinding.right = 'web-view' |

### 3.5 renderer 入口

| 文件 | 改动 |
|---|---|
| `platform/renderer/index.tsx` | import '@views/web'(self-register 触发) |

### 3.6 文档(3 篇)

| 文件 | 改动 |
|---|---|
| `test-checklist.md` § 8 | ~30 条审计条目(8.1 platform / 8.2 ViewSwitcher / 8.3 URL / 8.4 前进后退 / 8.5 持久化 / 8.6 link 路由 / 8.7 右键菜单 / 8.8 不回归) |
| `v2-state-snapshot.md` | 加 L5-B4 状态;web view 从"⏸️ 候选"→"✅ 已迁基础形态" |
| 本完成报告 | — |

---

## 4. 阶段中遇到 / 解决的问题

### 4.1 多窗口架构冲突 — V1 web 是独立 BrowserWindow

V1 web 是独立 vite entry(`web.html`)+ 独立 BrowserWindow(启 `webviewTag: true`),
进入 web view 是新窗口。V2 是单 main window 设计。

**决策(Q1=A)**:不破 V2 单窗口架构,在 main window 启 webviewTag,
WebView 是 React 组件,内嵌 `<webview>` tag。优点:实现简单 + 跟 NoteView 同等地位;
缺点:webview tag 在主 renderer 中,主 renderer 崩溃影响 webview。

### 4.2 webview tag 的 React 类型问题

webview 是 Electron 自定义元素,TS 不识别 partition / allowpopups 等属性。
V1 用 webviewRef + native HTMLElement 处理。

**修法**:`'webview' as unknown as React.ComponentType<typeof props>` cast,
传 props 时 TypeScript 接受。这是 Electron 官方文档同款做法。

### 4.3 cross-driver 解耦:driver 不能 import view

L5-B3.4 已建立 LinkClickHandler 接口模式(view 注入,driver 调用),本阶段加 onOpenWebUrl
延续此模式 — driver 不知道"http(s) 链接怎么处理",由 view 决定走右栏还是系统浏览器。

向后兼容:onOpenWebUrl 可选,view 不实现退化为 shell.openExternal(L5-B3.4 行为)。

### 4.4 ContextMenuItem.enabledWhen 不够细

V2 当前 enabledWhen 只支持 `'always' | 'has-selection' | 'is-editable'`,
不能区分"linkURL 非空"/"srcURL 非空"。

**降级**:复制链接 / 复制图片地址用 enabledWhen='always'(始终显示),
命令 handler 内部判空 no-op。后续可扩 enabledWhen 加 `'has-link-url' / 'has-src-url'` 类型。

### 4.5 V2 BrowserWindow vs V1 多 entry

V1 vite forge 配置含多个 entry(main / preload / shell renderer / web renderer / overlay
renderer / navside renderer),复杂度高。V2 platform/DESIGN.md § 218 提到 V2 简化:
单 entry。本阶段 web view 自然延续单 entry,webview tag 在主 renderer 内嵌。

### 4.6 link 跨 ws 路由仍降级

L5-B3.4 时 link 跳转限于当前 ws 切左栏(rightActiveNoteId 字段缺,等 ActiveResourceManager)。
本阶段 onOpenWebUrl 同样降级:点 https:// 切**当前 ws 右栏**。跨 ws 跳转留后续。

---

## 5. V1 → V2 对齐验证

| 维度 | V1 | V2 落地 | 对齐度 |
|---|---|---|---|
| `<webview>` tag 嵌网页 | ✅ | 同 ✅ | ✅ |
| 工具栏 URL bar | ✅ | 同 ✅(简化布局) | ✅ |
| 前进/后退/刷新按钮 | ✅ | 同 ✅ | ✅ |
| URL 自动补 https:// | ✅ | 同 ✅ | ✅ |
| per-ws state 持久化 | ✅ pluginStates | 同 ✅(localStorage) | ✅ |
| **书签 / 历史** | ✅ 完整 + SurrealDB | ❌ Q6=A 砍 | ⏸️ 留 viewAPI 阶段 |
| **翻译 / AI / 提取变体** | ✅ 全套 | ❌ 砍 | ⏸️ L5-B4.2/3/4 |
| **sync driver(双栏同步)** | ✅ | ❌ 砍 | ⏸️ L5-B4.2 |
| **web-bridge 注入** | ✅ ~7600 行 | ❌ 砍 | ⏸️ L5-B5 epic |
| 右键菜单 | ✅ 完整版 | ⚠️ 简化 4 项 | ⚠️ 基础够用 |
| link 跨 view 路由验证 | (V1 走 viewAPI.onWebOpenInRightSlot) | ✅ 通过 onOpenWebUrl 接口 | ✅ |

---

## 6. 遗留问题 / 未来阶段

### 6.1 书签 / 历史(viewAPI 阶段)

V2 没有 SurrealDB / fileOpenDialog 等 IPC,书签只能 localStorage。Q6=A 决定本阶段不做。
后续 viewAPI 阶段补 IPC 时一起做。

### 6.2 翻译 / AI / 提取变体(L5-B4.2/3/4)

V1 web view 4 变体(基本/translate/AI/extraction)只迁了基本,其他 3 变体留独立 sub-stage。
预估每个变体 ~500-1500 行。

### 6.3 web-bridge 内容注入(L5-B5)

V1 web-bridge ~7600 行处理 SSE 抓取 / DOM 抓取 / 协议路由,KRIG 业务核心(AI 工作流 / 内容提取),
独立大 epic。

### 6.4 跨 ws 跳转 + 真右栏 routing(等 ActiveResourceManager)

同 L5-B3.4 的遗留问题:目前 link 切**当前 ws** 右栏,不能跨 ws 跳转。

### 6.5 ContextMenuItem.enabledWhen 扩展

加 'has-link-url' / 'has-src-url' 类型,让"复制链接"/"复制图片地址"在 linkURL/srcURL
非空时才显示(对齐 V1)。本阶段用 'always' + 命令 handler 判空 no-op 降级。

### 6.6 ViewSwitcher Tab 标题动态显示

V1 web tab 显示当前页 title(如"GitHub - X")。本阶段 ViewSwitcher Tab 固定显"Web 🌐"。
后续 ViewSwitcher 增强阶段考虑。

---

## 7. 下一阶段衔接

按 v2-state-snapshot 优先级,可选方向:

| 选项 | 内容 | 价值 | 工作量 |
|---|---|---|---|
| **L5-B4 用户视觉验证** | 跑 ~30 条审计 | 高(发现 bug) | 取决于 |
| **L5-B4.2 web translate 变体** | 迁 V1 sync driver + TranslateWebView | 中 | ~500 行 |
| **ActiveResourceManager 抽象** | 解锁真右栏 routing | 高 | 中 |
| **viewAPI IPC 阶段** | fileOpenDialog 等,解锁 audio/video/file-block + 书签 IPC | 中-高 | 中-大 |
| **L5-B5 web-bridge** | 内容注入 / SSE 抓取(KRIG 业务核心)| 极高 | 大(~7600 行) |
| **简单 block 第二批** | page-anchor / file-link / tweet-block 等 | 中 | 中 |

---

## 8. 修订记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-05-06 | v1.0 | 阶段完成报告;14 项工作单元(全 ✅ + Q6=A 主动降级);4 commits ~700 行代码 + ~600 行文档 |
