# 任务:把 Web view 从「精简内容浏览器」补成「日常可用浏览器」

> 现状:KRIG-Note-V2 的 Web view 是一个极简 webview 封装(`[← →] [↻] | 地址栏 | [翻译 ▾]`
> + 右键 5 项 + 双栏翻译 + per-ws 记住上次 URL)。相比 Chrome 缺了一大批日常刚需。
> 本任务分 4 个 Phase 逐批补齐,**每批一分支、做完 STOP 汇报、等指挥拍板下一批**。

---

## 0. 角色 / 工作纪律

你是实现 subagent。**strict mode**:

1. **每条 cwd 敏感 Bash(git/npm/grep/find/ls)必前缀 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`**(本仓库历史上 cwd 漂移 16+ 次)。Read 工具一律传**绝对路径**。
2. V2(`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`)是当前开发仓库;**V1 仅作参考**,很多功能 V1 已有,可 grep V1 借鉴实现(但 V2 架构是 capability/driver/view 三层,别照抄 V1 的耦合写法)。
3. **只动本 prompt 各 Phase「文件清单」列的文件**,不擅自重构周边代码。发现非范围 bug → **登记到汇报里**,不擅自修。
4. **memory 必读**(下列 slug 在 `~/.claude` memory 里,按重要性):
   - `feedback_no_fallback_bandaid_fixes` — 修真因不兜底,别加 try/catch 绕过
   - `feedback_merge_requires_explicit_ok` — **commit ≠ commit+merge+push**;merge/push 永远等用户显式 OK
   - `feedback_diag_log_before_speculation` — 跨模块「A 影响 B」先加 log 复现再下结论
   - `feedback_main_console_not_in_devtools` — main 进程 log 在 `npm start` 终端 stdout,不在 DevTools
   - `feedback_implementation_test_checklist` — 实现完的自测清单
5. **sandbox 拦 `npm start` → 报告,用户自己跑**。typecheck / 单测你自己跑。
6. **本任务允许你在功能分支上自行 commit**(用户已授权),但 **merge 到 main / push 必须等显式确认**(纪律 4 的 `feedback_merge_requires_explicit_ok`)。
7. **分阶段**:每个 Phase 一分支,做完 typecheck + 自测 + commit 后 **STOP 汇报**,等指挥拍板才进下一 Phase。不要一口气把 4 个 Phase 全做完。

---

## 1. 背景:当前实现全貌(已 grep 确认)

### 1.1 三层架构(charter)

```
views/web/           ← 业务 UI(组合 + 状态订阅 + 命令注册)
  WebView.tsx        ← 主组件,订阅 per-ws state,持 hostRef
  WebToolbar.tsx     ← 工具栏 UI([← →][↻] | URL bar | [翻译 ▾])
  web-commands.ts    ← commandRegistry 注册('web-view.open-url')
  context-menu-integration.ts ← 右键菜单 5 项
  data-model.ts      ← per-ws 持久化(currentUrl / targetLang)
  index.ts           ← self-register 入口(registerView + 命令 + 右键菜单)
  web.css            ← 样式
  translate-view/    ← 双栏翻译子视图

capabilities/web-rendering/  ← 封装 <webview> tag 生命周期
  Host.tsx           ← 普通 webview,暴露 imperative ref(HostHandle)
  translate-host.tsx ← 翻译右栏(被动)
  webview-types.ts   ← WebviewElement / HostHandle / WebContextMenuPayload
  types.ts           ← WebRenderingApi(capability 对外面孔)
  index.ts           ← capability registry 注册

drivers/web-sync-driver/, drivers/web-translate-driver/  ← 注入引擎(本任务基本不碰)

platform/main/       ← 主进程
  (webview session partition 'persist:webview' 在此被配置;translate session 剥 CSP)

shared/constants/webview.ts  ← WEBVIEW_PARTITION / WEBVIEW_TRANSLATE_PARTITION / WEBVIEW_DEFAULT_URL
```

### 1.2 关键既有接口(改动前先读这几个文件确认未漂移)

- **`src/capabilities/web-rendering/webview-types.ts`** — `HostHandle` 当前只有 `loadURL/goBack/goForward/reload/stop/isLoading`;`WebviewElement` 暴露了 `executeJavaScript` 等。**本任务多处要给 HostHandle 加方法**(findInPage / setZoom / openDevTools / capturePage 等),从这里改起。
- **`src/capabilities/web-rendering/Host.tsx`** — webview tag 在 L333-341(`tagProps`,含 `allowpopups: 'true'`);事件绑定在 `setupWebview`(L109);imperative API 在 `useImperativeHandle`(L313)。**注意 L72-86 的 `initialUrlRef` 注释**:webview `src` 是受控 attribute,只读初始 URL,后续 URL 变化走 `useEffect [currentUrl] → wv.loadURL`,否则 Chromium 重载循环抖动。改 Host 时**不要破坏这个不变量**。
- **`src/views/web/WebToolbar.tsx`** — 工具栏 UI;**注意 L116/L124/L136 的 tooltip 写了 `⌘[ / ⌘] / ⌘R` 但没有真键盘监听**(P0 要补真的)。URL 输入逻辑在 `handleUrlKeyDown`(L87),目前只会 `/^https?:\/\//.test(trimmed) ? trimmed : 'https://'+trimmed`——**P0 的地址栏搜索就改这里**。
- **`src/views/web/WebView.tsx`** — `hostRef`(L36)、各 callback handler、`handleNavigate/handleGoBack/...`(L84-95)。新快捷键/缩放/查找的命令式调用走 `hostRef.current?.xxx()`。
- **`src/views/web/data-model.ts`** — per-ws 持久化模式;`STORE_KEY='web'`,写 `ws.pluginStates['web']`,**有 hydrate cache 稳定引用机制(L42,别破坏,否则 useSyncExternalStore 死循环)**。多标签页(Phase 4)要扩这里的 schema。
- **`src/views/web/context-menu-integration.ts`** — 右键菜单注册;命令注册在 `registerWebCommands` 模式,菜单项 `contextMenuRegistry.register([...])`。**注意 L107 注释**:V2 `enabledWhen` 只支持 `'always' | 'has-selection' | 'is-editable'`,linkURL/srcURL 条件用 `always` 显示 + 命令内判空 no-op。
- **`src/shared/constants/webview.ts`** — partition 常量。
- **样式 class 前缀**:`krig-web-toolbar__*` / `krig-web-view__*`,新 UI 沿用。

### 1.3 主进程 session(下载/Phase 3 需要)

webview 用 partition `persist:webview`。下载需要在主进程拿到该 session 的 `will-download` 事件。**先 grep 确认主进程在哪里配置该 session**:

```
cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && \
  grep -rn "persist:webview\|defaultSession\|fromPartition\|session\." src/platform/main/ | grep -v node_modules
```

translate session 已有「剥 CSP」的 main 端处理(见 `shared/constants/webview.ts` 注释),可作为「主进程按 partition 拿 session 装钩子」的现成范例,grep 它定位代码位置。

---

## 2. 四个 Phase(按性价比 / 工程量排序)

> **分支策略**:每 Phase 一分支(从 main 切),命名见各 Phase。做完 commit + STOP 汇报。
> 用户已确认「分阶段,每批一分支」「允许 commit」。

### Phase 1 —— P0 核心(分支 `feat/web-p0-essentials`)

**投入小、体感最强,全是 Electron webview 原生 API。**

#### 1.1 地址栏关键词搜索

`WebToolbar.tsx` `handleUrlKeyDown`(L87)当前:非 `http(s)://` 开头就拼 `https://`。改成:

- 看起来像 URL(含 `.` 且无空格,或 `localhost` / IP / 已有协议)→ 当 URL,补 `https://`
- 否则 → 拼搜索引擎 query:`https://www.google.com/search?q=` + `encodeURIComponent(trimmed)`

判别逻辑建议抽成纯函数放 `views/web/`(如 `omnibox.ts`,导出 `resolveOmniboxInput(raw): string`),**写单测**(`tests/views/web/omnibox.test.ts` 或就近),覆盖:`github.com` → URL、`hello world` → 搜索、`localhost:3000` → URL、`https://x.com` → 原样、`192.168.1.1` → URL、`react hooks` → 搜索。搜索引擎 base 建议提到 `shared/constants/webview.ts` 加 `WEBVIEW_SEARCH_URL`(用 `%s` 占位或拼 query),别 hardcode 散落。

#### 1.2 真键盘快捷键

现在 tooltip 写了快捷键但**没监听**。在 WebView 容器或全局(看项目有没有统一 keybinding 机制——**先 grep `keybind` / `keydown` / `shortcut` / `useHotkey` 看有没有现成基础设施**,有就复用,没有就在 `WebView.tsx` 容器上 `onKeyDown` 或 `useEffect` 加 `document` listener 并在 web view active 时才生效)。要接的:

| 快捷键 | 动作 | 走哪 |
|---|---|---|
| `⌘[` / `Alt+←` | 后退 | `hostRef.goBack()` |
| `⌘]` / `Alt+→` | 前进 | `hostRef.goForward()` |
| `⌘R` / `F5` | 刷新 | `hostRef.reload()` |
| `⌘L` | focus 地址栏 | 给 URL input 加 ref,`.focus()` + `.select()` |
| `⌘F` | 打开页内查找(见 1.3) | 切查找栏 visible |
| `⌘+` / `⌘-` / `⌘0` | 缩放(见 1.4) | `hostRef.setZoom*` |

**注意**:webview 内部(子 frame)的键盘事件不一定冒泡到宿主 DOM——**这是已知坑**(见 `context-menu-integration.ts` L42 注释「webview 内 DOM 在子 frame 不可达」)。验证:页面 focus 在 webview 内时 `⌘L` 是否还触发。若不触发,需在主进程用 webview 的 `before-input-event`(`webContents.on('before-input-event')`)截获并 IPC 回渲染进程,或用 webview tag 的 `ipc` 通道。**先用最简单的宿主 `onKeyDown` 试,不行再上 before-input-event**,并在汇报里说明实际用了哪条路径。

#### 1.3 页内查找(⌘F)

- `HostHandle` 加 `findInPage(text, opts?)` / `stopFindInPage()`,内部调 webview tag 的 `wv.findInPage(text)` / `wv.stopFindInPage('clearSelection')`,并监听 `found-in-page` 事件拿 `activeMatchOrdinal / matches`。
- `WebViewElement` 接口(webview-types.ts)补上这几个方法签名。
- UI:一个查找栏(`krig-web-view__find-bar`),含输入框、`3/12` 计数、上一个/下一个、关闭。`⌘F` 开,`Esc` 关。下一个/上一个走 `findInPage(text, { forward, findNext: true })`。
- 关闭时 `stopFindInPage('clearSelection')`。

#### 1.4 缩放(⌘+ / ⌘- / ⌘0)

- `HostHandle` 加 `zoomIn() / zoomOut() / zoomReset() / getZoom()`。webview tag 有 `wv.setZoomFactor(f)` / `wv.getZoomFactor()`(或 `setZoomLevel`)。步进建议 0.1,范围 0.5~2.0(`⌘0` 复位 1.0)。
- 工具栏可选加一个小的缩放指示(非 100% 时显示「120%」点一下复位)——**可选,不强制**,优先把快捷键接通。
- 缩放是否 per-ws 持久化?**本期不持久化**(transient,跟 loading 同级),避免动 data-model schema;若要持久留 Phase 4 一起。

#### Phase 1 文件清单

| 文件 | 改动 |
|---|---|
| `src/capabilities/web-rendering/webview-types.ts` | `HostHandle` + `WebviewElement` 加 findInPage/stopFindInPage/setZoomFactor/getZoomFactor 等签名 |
| `src/capabilities/web-rendering/Host.tsx` | imperative API 实现新方法 + 绑 `found-in-page` 事件 |
| `src/views/web/WebToolbar.tsx` | 地址栏搜索逻辑 + URL input ref(给 ⌘L) |
| `src/views/web/WebView.tsx` | 键盘快捷键接线 + 查找栏 state + 缩放调用 |
| `src/views/web/omnibox.ts` | **新增** `resolveOmniboxInput` 纯函数 |
| `src/shared/constants/webview.ts` | `WEBVIEW_SEARCH_URL` |
| `src/views/web/web.css` | 查找栏样式(可能含缩放指示) |
| `tests/.../omnibox.test.ts` | **新增** 单测 |

---

### Phase 2 —— 右键菜单补全(分支 `feat/web-context-menu`)

跟 `context-menu-integration.ts` 现有模式同款(命令注册 + `contextMenuRegistry.register`)。补:

- **「在新标签页打开链接」**(条件 linkURL 非空)——**依赖 Phase 4 多标签**;若 Phase 4 还没做,先实现成「在右栏 web view 打开」或先占位 disabled,**在汇报里标注依赖**。
- **「在默认浏览器打开链接」**(条件 linkURL 非空)——走主进程 `shell.openExternal`(grep 项目有没有现成 IPC/`electronAPI` 通道,如 `window.electronAPI.openExternal`;没有就在 preload + main 加一个最小 channel)。
- **「复制图片」**(把图片本身放剪贴板,区别于现有「复制图片地址」)——可选,Electron `clipboard.writeImage` 需主进程,工程量稍大,**可降级为只保留地址版**。
- 现有 5 项(复制链接/图片地址/选中文字、查词、翻译)保持不动。

> **注意 L107 约束**:`enabledWhen` 只支持 `always/has-selection/is-editable`,link/src 条件用 `always` + 命令内判空。

#### Phase 2 文件清单

| 文件 | 改动 |
|---|---|
| `src/views/web/context-menu-integration.ts` | 加新命令 + 菜单项 |
| (可能) `src/platform/main/` + preload | `shell.openExternal` / `clipboard.writeImage` 的 IPC channel(grep 确认是否已有) |
| (可能) `src/shared/ipc/channel-names.ts` | 新 channel 常量(若需新 IPC) |

---

### Phase 3 —— 下载管理(分支 `feat/web-downloads`)

**主进程驱动。** webview partition `persist:webview` 的 session 上监听 `will-download`。

- 主进程:`session.fromPartition('persist:webview').on('will-download', (e, item) => ...)`。
  - 给默认保存路径(用 Electron `dialog.showSaveDialog` 让用户选,或落到系统 Downloads 目录——**优先弹保存对话框**,符合浏览器直觉)。
  - 监听 `item.on('updated')`(进度 `receivedBytes/totalBytes`)、`item.on('done')`(完成/失败/取消)。
  - 通过 IPC 把下载事件(start/progress/done)推给渲染进程。
- 渲染进程:一个轻量下载提示 UI(可以是 web view 顶部/底部的临时条,或一个下拉列表)。**MVP 够用即可**:开始下载提示一行、完成后给「在 Finder 中显示」(`shell.showItemInFolder`)。不要求做完整的 Chrome 下载页。
- **先 grep 主进程现有 session/IPC 装配位置**(§1.3),复用 translate session 剥 CSP 那套「按 partition 拿 session 装钩子」的代码位置和模式。

> 主进程 log 走 `npm start` 终端 stdout(`feedback_main_console_not_in_devtools`),调试下载用带前缀的 log(如 `[web/download]`)。

#### Phase 3 文件清单(以 grep 实际结构为准)

| 文件 | 改动 |
|---|---|
| `src/platform/main/...`(web/download 模块,新增) | `will-download` 监听 + 进度/完成 IPC 推送 + 保存对话框 |
| preload / `electronAPI` | 订阅下载事件 + showItemInFolder channel |
| `src/shared/ipc/channel-names.ts` | 下载相关 channel 常量 |
| `src/views/web/`(新增下载 UI 组件) | 下载提示条 + 订阅 |
| `src/views/web/web.css` | 下载条样式 |

---

### Phase 4 —— 多标签页(分支 `feat/web-tabs`)

**工程量最大,改 data-model + WorkspaceState。最后做。**

核心改动:per-ws 从「单 `currentUrl`」改为「tab 列表 + activeTabId」。

- `data-model.ts`:`PersistedWebWsState` 从 `{ currentUrl, targetLang }` 扩成 `{ tabs: WebTab[], activeTabId: string, targetLang }`(`WebTab = { id, url, title }`)。**保留向后兼容**:hydrate 时若旧数据只有 `currentUrl`,迁移成单 tab。**保住 hydrate cache 稳定引用机制(L42),否则 useSyncExternalStore 死循环。**
- UI:WebToolbar 上方或下方加 tab 栏(`krig-web-toolbar__tabs` 或 `krig-web-view__tabs`),每 tab 显示 title + 关闭 ×,`+` 新建 tab。
- webview 实例策略:**关键决策点**——是「每 tab 一个 `<webview>` 常驻(切 tab 显隐)」还是「单 webview 切 tab 时 loadURL」?
  - 多 webview 常驻:切 tab 不丢页面状态/滚动位置,但内存涨、多个 SyncDriver 要管。
  - 单 webview loadURL:省内存,但切 tab 丢页面状态。
  - **建议先做「多 webview 常驻 + display:none 切换」**(更像真浏览器),但**这是 design 决策,做之前先在汇报里给方案 + 取舍让指挥拍板**,或直接在 prompt 里默认多 webview 常驻并说明理由。
- 翻译双栏模式与 tab 的交互:当前 `slotBinding.right === 'web-translate-view'` 是 per-ws。多 tab 后翻译跟「当前 active tab」走。**这块复杂,先把基础 tab 跑通,翻译×tab 的边界 case 单列汇报**。
- 命令 `web-view.open-url`(web-commands.ts)语义:从「设 currentUrl」改成「在 active tab 打开」或「新建 tab 打开」?**保持现有 caller 兼容**(grep `web-view.open-url` 的调用方),默认「active tab 打开」。

#### Phase 4 文件清单

| 文件 | 改动 |
|---|---|
| `src/views/web/data-model.ts` | schema 扩 tabs + 向后兼容迁移 + 保 hydrate cache |
| `src/views/web/WebView.tsx` | 多 tab 渲染 + active 切换 + 多 hostRef 管理 |
| `src/views/web/WebToolbar.tsx` 或新 `WebTabBar.tsx` | tab 栏 UI |
| `src/views/web/web-commands.ts` | `open-url` 语义适配 tab |
| `src/capabilities/web-rendering/Host.tsx` | 若多 webview 常驻,确认多实例 + SyncDriver 不互相干扰 |
| `src/views/web/web.css` | tab 栏样式 |
| (可能) `tests/...` | data-model 迁移单测 |

---

## 3. 每 Phase 通用验收(自测清单)

参 `feedback_implementation_test_checklist`。每 Phase commit 前:

1. **typecheck 全过**:`cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && npm run typecheck`(或项目实际的 type 命令,先 grep `package.json` 的 scripts 确认命令名)。
2. **相关单测过**:`npm run test -- <相关文件>`(Phase 1 的 omnibox、Phase 4 的 data-model 迁移)。
3. **lint 过**(若项目有):`npm run lint`。
4. **手动复现说明**:列出本 Phase 该怎么手动验(因为 sandbox 拦 `npm start`,你写步骤,用户跑)。例:Phase 1「输入 `react hooks` 回车应跳 Google 搜索;⌘F 出查找栏;⌘+ 放大页面」。
5. **commit**(本 Phase 分支上,**不 merge 不 push**),message 用项目风格(中文、动机优先),结尾带:
   ```
   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   ```

---

## 4. 不做的事

- ❌ **不要**碰 `drivers/web-sync-driver` / `web-translate-driver` 的内部协议(除非 Phase 4 多 webview 常驻确实需要,且先汇报)。
- ❌ **不要**破坏 `Host.tsx` 的 `initialUrlRef` 不变量(L72-86,src 只读初始 URL)——会导致 Chromium 重载抖动。
- ❌ **不要**破坏 `data-model.ts` 的 hydrate cache 稳定引用(L42)——会 useSyncExternalStore 死循环。
- ❌ **不要**用 try/catch 兜底绕过真问题(`feedback_no_fallback_bandaid_fixes`)。
- ❌ **不要** merge 到 main / push(`feedback_merge_requires_explicit_ok`)。commit 可以,merge/push 等显式 OK。
- ❌ **不要**一口气做完 4 个 Phase——每 Phase STOP 汇报等拍板。
- ❌ 范围外的「打印 / 隐私无痕 / 密码管理 / 广告拦截 / 阅读模式 / 整页截图 / 书签 / 完整历史」**本任务不做**(未来 epic)。书签/历史尤其要等多标签 data-model 落地后再设计。

---

## 5. 已知坑 / 风险

1. **webview 子 frame 键盘事件不冒泡到宿主**(Phase 1.2)——`⌘L`/`⌘F` 在页面 focus 在 webview 内时可能不触发。可能要上主进程 `before-input-event`。先试简单路径,汇报实际方案。
2. **`allowpopups: 'true'` 已开**(Host.tsx L337)——Phase 2/4 处理新窗口/链接时,注意现有 popup 行为(目前没有 `setWindowOpenHandler`,popup 落哪要 grep 确认)。
3. **下载 session 按 partition 拿**(Phase 3)——`persist:webview` 是 webview 的,不是主 renderer 的 `defaultSession`,别拿错 session 导致 `will-download` 不触发。
4. **多 webview 常驻的 SyncDriver**(Phase 4)——当前 SyncDriver side 写死 `'left'`(Host.tsx L230),多 tab 各自的 webview 都创建 driver 会撞 slot-bus。需确认隔离策略,**做之前汇报**。
5. **翻译 × tab 交互**(Phase 4)——`slotBinding.right` per-ws,多 tab 后翻译跟谁走,边界 case 多。
6. **commit message 别带 Date.now / 假数据**——性能/计数类如实写,没测就说没测。

---

## 6. 汇报模板(每 Phase 完成时)

```
Phase N(<分支名>)完成:

一、产出(M commit)
   <commit hash + 一句话>

二、实现要点
   <关键改动 file:line + 做法,特别是踩坑后实际用的方案
    如 Phase 1 键盘事件最终走宿主 onKeyDown / before-input-event>

三、验收
   typecheck: PASS / 失败详情
   单测:     <omnibox / data-model 等> PASS
   lint:      PASS / N/A

四、手动复现步骤(给用户跑,sandbox 拦了 npm start)
   1. <步骤> → 期望 <现象>
   ...

五、范围外发现 / 登记的非范围 bug
   <如有>

六、本 Phase 的设计决策(尤其 Phase 4 的 webview 实例策略 / tab×翻译)
   <做了什么取舍,为什么>

七、等指挥拍板:
   - 是否 merge 本分支 / push(等显式 OK)
   - 是否进 Phase N+1
```

---

## 7. Self-Contained Check

- ✅ 当前实现全貌 + 三层架构(§1.1)
- ✅ 8 个关键文件锚点 + 行号 + 不变量警告(§1.2)
- ✅ 主进程 session grep 起点(§1.3)
- ✅ 4 Phase × 文件清单 × 分支名(§2)
- ✅ 每 Phase 验收清单(§3)
- ✅ 不做的事(§4)
- ✅ 6 类已知坑(§5)
- ✅ 汇报模板(§6)

**外部依赖**:
- 用户每 Phase 切分支(或允许 subagent 自切,sandbox 拦就报)
- 用户跑 `npm start` 做手动复现(sandbox 拦自动启动)
- 用户拍板每 Phase 的 merge/push + 是否进下一 Phase
- Phase 4 webview 实例策略 / tab×翻译 边界,做前汇报让指挥拍板

**新对话第一步**:读本 prompt + §1.2 列的 8 个文件确认未漂移 + grep `package.json` scripts 确认 typecheck/test/lint 命令名 → 切 `feat/web-p0-essentials` → 开 Phase 1。

---

## 附录 A — Phase 1 收尾追加(2026-05-31,指挥拍板后)

> Phase 1 主体 + 地址栏全选 + 轻量历史补全已落(commit `8c0b5467`,分支 `feat/web-p0-essentials`,**未 merge**)。
> 本追加是 Phase 1 **收尾的最后一项**:历史「过滤后再记」。做完此项 + 用户手动验收通过,Phase 1 才算完成,再进 Phase 2。
> **仍在 `feat/web-p0-essentials` 分支上做,不切新分支,不 merge/push。**

### A.1 背景:当前 recordVisit 噪音

`recordVisit` 接在 [WebView.tsx:109](src/views/web/WebView.tsx#L109) 的 `handleUrlChanged`(= Host 的 `onUrlChanged` callback)。
现有过滤只有 [web-history.ts:92](src/views/web/web-history.ts#L92) 的 `!url || url === 'about:blank'`。

问题(指挥已确认要「过滤后再记」):
- **非 http(s)**(data: / file: / blob: 等)被记进历史
- **搜索结果页**(`google.com/search?q=...`)被记 → 每次搜索都污染补全候选
- **SPA 碎片**:Host 的 `handleDidNavigateInPage` 复用了 `handleDidNavigate`(Host.tsx,两个事件合并成同一个 `onUrlChanged`),**所以 `did-navigate-in-page` 也会喂历史** → google 翻页、SPA 路由每跳一次记一条

### A.2 过滤规则(落进 web-history.ts,优先纯函数)

在 `recordVisit`(或抽一个 `shouldRecord(url): boolean` 纯函数)里加:

1. **只记 `http://` / `https://`** —— 其它 scheme(about:/data:/file:/blob:)一律跳过。
2. **跳过搜索结果页** —— URL 命中 `WEBVIEW_SEARCH_URL`(Phase 1 已加的常量)的 host+path 前缀(如 `www.google.com/search`)就不记。建议从 `WEBVIEW_SEARCH_URL` 解析出 host+pathname 做前缀比对,**别 hardcode `google.com/search`**(搜索引擎常量可能改)。
3. **保留现有去重 + visitCount 累加 + 上限 500**(mergeVisit 不动)。

> 第 1、2 条纯看 URL 字符串即可判,**全部收在 `web-history.ts` 纯函数里**(`shouldRecord`),不动 Host / capability 接口。给 `shouldRecord` 补单测(scheme 各类 + 搜索页命中/不命中)。

### A.3 SPA 碎片(did-navigate-in-page)处理 —— 两选一,选轻的

第 3 条「SPA 碎片不喂历史」需要区分 `did-navigate` vs `did-navigate-in-page`,但 Host 当前把两者合并。**两个方案,默认选 (a) 不动 capability 接口**:

- **(a) 默认:不区分事件,靠去重兜底。** 不改 Host。SPA 同 URL 变化经 mergeVisit 去重(同 url 只累加 visitCount),碎片噪音被去重大幅吸收。简单、不动接口。**若实测 google 翻页仍产生大量不同 URL 候选**(query 变了算不同 URL),再上 (b)。
- **(b) 备选:Host 给 onUrlChanged 加来源标记。** 改 `onUrlChanged?(url, source: 'navigate' | 'in-page')`(capability 接口变更),WebView 只在 `source === 'navigate'` 时 recordVisit。**这是 capability 接口改动,做前在汇报里说明**,因为它动了 web-rendering 对外面孔。

**先做 (a),在汇报里说明是否够用**;不够再拍板 (b)。

### A.4 收尾验收(连同主体一起给用户跑)

typecheck + `shouldRecord` 新单测过后,**Phase 1 收尾 commit**(仍不 merge/push),然后等用户手动验收**全部** Phase 1 项:

1. 地址栏首次点击全选 → 再点光标插入
2. 历史下拉候选 + ↑↓ 高亮 + 回车/点击跳转 + Esc 关
3. 关 app 重开历史仍在
4. **搜索结果页 / about:blank 不进历史候选**(本追加新增项:搜几次再看补全里有没有 `/search?q=` 条目)
5. **第 7 步关键项:焦点在 webview 内时 ⌘L / ⌘F 是否触发**(prompt §5 坑 1)——若失效需上 `before-input-event`,这决定 Phase 1 是否真完成

### A.5 Phase 1 收尾文件清单

| 文件 | 改动 |
|---|---|
| `src/views/web/web-history.ts` | `shouldRecord` 纯函数(scheme + 搜索页过滤)+ recordVisit 接入 |
| `tests/.../web-history.test.ts` | append `shouldRecord` 单测 |
| (仅方案 b 才动) `src/capabilities/web-rendering/webview-types.ts` + `Host.tsx` + `WebView.tsx` | onUrlChanged 加 source 标记 |

---

*Prompt 文档 · 2026-05-31 · Web view 补齐 Chrome 常用功能 · 4 Phase 分批 · 总指挥拟*
*附录 A · Phase 1 收尾(历史过滤)· 指挥拍板后追加*
