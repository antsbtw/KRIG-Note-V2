# Phase 4:Web view 独立标签页(tab)+ 弹窗导流进新 tab

> web view 当前只能显示单页面。痛点:点 `target="_blank"` / `window.open` 链接 → Electron 弹独立 BrowserWindow(飞出 workspace,见用户截图)。
> 本 Phase 给 web view 加**内部 tab**(像 Chrome 标签栏),并用 `setWindowOpenHandler` 把弹窗导流进新 tab,根治飞出问题。
> **web tab ≠ workspace tab**:web tab 只存在于 web view 内部(`pluginStates['web']`),workspace tab 是顶层容器(WorkspaceManager)。两层零交集。
> **在 `feat/web-tabs` 分支(已由指挥切好),不切新分支,不 merge/push。**

---

## 0. 工作纪律

1. cwd 敏感 Bash 必前缀 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`;Read 绝对路径。
2. memory:`feedback_no_fallback_bandaid_fixes`、`feedback_merge_requires_explicit_ok`(commit 可,merge/push 等显式 OK)、`feedback_implementation_test_checklist`、`feedback_main_console_not_in_devtools`、`feedback_diag_log_before_speculation`(翻译×tab 串台这类跨实例问题先 log 验证再下结论)。
3. sandbox 拦 npm start → 用户跑(主进程 + webview 改动**必须完全退出重跑**才生效)。typecheck/单测自己跑。命令:typecheck=`npm run typecheck`,test=`npm run test`,lint=`npm run lint`。
4. **这是迄今最大改动**。建议**分两个 commit**:Commit 1 = data-model + tab UI + 多 webview(基础 tab 跑通);Commit 2 = 弹窗导流 + 翻译×tab 共存。每个 commit 前 typecheck + 自测。Commit 1 做完可 STOP 中间汇报让指挥确认再继续 Commit 2(翻译×tab 是最复杂、最易翻车的部分)。
5. 做完 STOP 汇报。

---

## 1. 用户已拍板的设计决策(照此实现,别自由发挥)

| 决策 | 选择 |
|---|---|
| webview 实例策略 | **每 tab 一个 `<webview>` 常驻 + display:none 切换**(切 tab 不丢页面状态,像 Chrome) |
| tab 栏 UI | **单 tab 不显示 tab 栏(跟现在一样干净);≥2 个 tab 才出现独立 tab 栏,在工具栏上方** |
| 工具栏操作(后退/前进/刷新/地址栏/查找/缩放) | 全部**作用于活跃 tab** |
| 快捷键 | **加 ⌘T(新建 tab)/ ⌘W(关闭当前 tab)**;现有 ⌘L/⌘F/⌘R/⌘±/⌘[/⌘] 跳活跃 tab |
| 弹窗(target=_blank / window.open) | **setWindowOpenHandler 导流进新 tab**(根治飞出 workspace) |
| 翻译 × tab | **翻译只对活跃 tab 生效**(任一时刻只有一个 Host 的 SyncDriver active);targetLang 全 tab 共享(不 per-tab) |
| 关最后一个 tab | 回 DEFAULT_URL 单 tab(不让 web view 变空) |

---

## 2. 现状(调研已确认,文件:行号)

### 2.1 单页架构
- [WebView.tsx:347-359](src/views/web/WebView.tsx#L347) — 只有一个 `<Host>`,`ref={hostRef}`,`currentUrl={wsState.currentUrl}`(单 URL)。
- [WebView.tsx:53-59](src/views/web/WebView.tsx#L53) — per-ws state 订阅 `useSyncExternalStore`。[WebView.tsx:62-68](src/views/web/WebView.tsx#L62) — translateMode 订阅。
- toolbar 命令 + 快捷键全走 `hostRef.current?.xxx()`([WebView.tsx:114-235](src/views/web/WebView.tsx#L114))。
- `displayUrl` transient([WebView.tsx:74](src/views/web/WebView.tsx#L74)),由 host `onDisplayUrlChanged` 推。

### 2.2 data-model(改 schema 的命门)
- `STORE_KEY='web'`,写 `pluginStates['web']`。
- `WebWorkspaceState = { currentUrl, targetLang }`([data-model.ts:20-25](src/views/web/data-model.ts#L20)),`PersistedWebWsState = { currentUrl, targetLang? }`([:27-30](src/views/web/data-model.ts#L27))。
- **hydrate cache 稳定引用**([data-model.ts:42-62](src/views/web/data-model.ts#L42)):`wsStateCache: Map<wsId, WebWorkspaceState>`,`getWebWsState` 比 `cached.currentUrl===... && cached.targetLang===...`,**没变返回同一对象**。⚠️ **这是 useSyncExternalStore 不死循环的命门**(getSnapshot 必须返回 `===` 稳定引用,注释 [:34-41](src/views/web/data-model.ts#L34) 明确警告)。

### 2.3 Host.tsx 不变量 + API
- webview tag:[Host.tsx:381-389](src/capabilities/web-rendering/Host.tsx#L381) `tagProps = { ref, src: initialUrlRef.current, partition, allowpopups:'true', className }`。
- **initialUrlRef 不变量**([Host.tsx:87-99](src/capabilities/web-rendering/Host.tsx#L87) + [:377-380](src/capabilities/web-rendering/Host.tsx#L377)):**src 只绑 mount 时锁定的初始 URL,绝不绑 reactive currentUrl**(否则 Chromium 重载循环抖动)。后续 URL 变化走 `useEffect [currentUrl]`([:309-326](src/capabilities/web-rendering/Host.tsx#L309))→ `wv.loadURL`。
- HostHandle API([Host.tsx:329-375](src/capabilities/web-rendering/Host.tsx#L329)):loadURL/goBack/goForward/reload/stop/isLoading/findInPage/stopFindInPage/zoomIn/zoomOut/zoomReset/getZoom。
- **SyncDriver side 写死 'left'**:[Host.tsx:246](src/capabilities/web-rendering/Host.tsx#L246) `new SyncDriver('left', slotBus)`,[:251](src/capabilities/web-rendering/Host.tsx#L251) `slotBus.subscribe('left')`,[:164](src/capabilities/web-rendering/Host.tsx#L164) 发送写死 'left'。slotBus 单例,side 仅 'left'/'right'。

### 2.4 弹窗现状
- `allowpopups:'true'` 在 [Host.tsx:385](src/capabilities/web-rendering/Host.tsx#L385)、translate-host、ai-extraction/Host。
- **全项目 0 处 `setWindowOpenHandler`**。路径:点 target=_blank → guest webContents window-open → allowpopups 允许 → 无 handler → Electron 默认弹独立 BrowserWindow。
- 主进程已有 `did-attach-webview` 拿 guest 的先例:[web-context-menu/handler.ts:64](src/platform/main/web-context-menu/handler.ts#L64),且有 `shouldHandle(guest)` 过滤(排除 AI/翻译 webview)。

### 2.5 IPC 回推模式(复用)
Phase 2 建的 `WEB_CONTEXT_MENU_ACTION` 全链路是现成模板:[handler.ts:92](src/platform/main/web-context-menu/handler.ts#L92) send → preload `onWebContextMenuAction` → [context-menu-integration.ts:20](src/views/web/context-menu-integration.ts#L20) 订阅。弹窗导流的 `WEB_NEW_TAB` 完全同构照抄。

---

## 3. 实现方案

### Commit 1:基础 tab(data-model + UI + 多 webview)

#### 3.1 data-model schema 扩展

`pluginStates['web']` 从 `{ currentUrl, targetLang }` 改为:
```ts
interface WebTab { id: string; url: string; }
interface WebWorkspaceState { tabs: WebTab[]; activeTabId: string; targetLang: string; }
interface PersistedWebWsState { tabs?: WebTab[]; activeTabId?: string; currentUrl?: string; targetLang?: string; }
```

- **迁移**(在 `getWebWsState` hydrate 层):
  - 有 `tabs` → 用之(校验 activeTabId 在 tabs 内,不在则取第一个)。
  - 无 tabs 但有旧 `currentUrl` → 合成单 tab `[{id: genId(), url: currentUrl}]`,activeTabId = 该 id。
  - 都没有 → 单 tab `[{id, url: DEFAULT_URL}]`。
- **id 生成**:用现有 id 工具(grep 项目有没有 `genId`/`nanoid`/`crypto.randomUUID`,优先复用;`crypto.randomUUID()` 渲染进程可用)。
- **⚠️ 重写 hydrate cache 深比**(命门):不能再只比 2 标量。比较:`cached.tabs.length === next.tabs.length && 每个 tab id+url 相等 && activeTabId 相等 && targetLang 相等` → 全等返回 cached 旧引用,否则建新对象存 cache。**这是避免 useSyncExternalStore 死循环的关键,务必正确**。
- **新写入器**(替代 setWebUrl):
  - `setTabUrl(wsId, tabId, url)` — 更新指定 tab 的 url(webview 导航时调,带 tabId)
  - `addTab(wsId, url)` — 加 tab,返回新 tabId(并设为 active)
  - `closeTab(wsId, tabId)` — 删 tab;若删的是 active → 切相邻;若删到空 → 回 DEFAULT_URL 单 tab
  - `setActiveTab(wsId, tabId)`
  - `setWebTargetLang` 保留(targetLang 仍 per-ws 单值)
- `web-commands.ts` 的 `web-view.open-url` 语义:改成"在活跃 tab 打开"(grep 调用方 [web-commands.ts](src/views/web/web-commands.ts) 确认兼容,note→web 跳转走这个)。

#### 3.2 WebView.tsx 多 tab 渲染

- 订阅改为拿 `{ tabs, activeTabId, targetLang }`。
- 渲染:`tabs.map(tab => <Host key={tab.id} ... style={{display: tab.id===activeTabId ? 'flex' : 'none'}} />)` —— **每 tab 一个常驻 Host,display 切换**。`key={tab.id}` 保证 React identity(各 Host 独立 mount,initialUrlRef 不变量自动 per-tab 成立)。
- `hostRef` 改为 `Map<tabId, HostHandle>`(或 ref 回调收集),toolbar 命令路由到 `activeTabId` 对应的 ref。
- 每个 Host 的 `currentUrl` = 该 tab 自己的 url;`onUrlChanged` → `setTabUrl(wsId, tab.id, url)`(带 tabId)。
- transient state(loading/canGoBack/displayUrl 等)**只跟活跃 tab**:非活跃 tab 的 Host 回调要么忽略,要么按 tabId 区分只让活跃 tab 推。简单做法:Host 回调里带 tabId,WebView 只处理 `tabId===activeTabId` 的。
- **tab 栏 UI**:`tabs.length >= 2` 才渲染 tab 栏(决策:单 tab 不显)。tab 栏在 WebToolbar **上方**。新建 `WebTabBar.tsx`(或在 WebView 内联),每 tab 显示 title/url + × 关闭,末尾 `+` 新建。点 tab → setActiveTab。
  - tab title:webview `page-title-updated` 事件可拿标题(Host 可加 onTitleChanged 回调;**可选**,先用 url 的 host 部分当 label 也行,标注简化)。

#### 3.3 快捷键

WebView 现有键盘处理([WebView.tsx:192-235](src/views/web/WebView.tsx#L192))加:
- `⌘T` → `addTab(wsId, DEFAULT_URL)`(新建并切过去)
- `⌘W` → `closeTab(wsId, activeTabId)`(关当前;若只剩 1 tab,关了回 DEFAULT_URL 而非关 view —— 或忽略,二选一,汇报说明)

#### Commit 1 验收点
- 单 tab:UI 跟现在一样(无 tab 栏)。
- ⌘T 开新 tab → 出现 tab 栏,新 tab 显示 DEFAULT_URL。
- 切 tab → 各 tab 保持自己的页面(滚动位置不丢 = 常驻生效)。
- ⌘W 关 tab → 切相邻;关到剩 1 → tab 栏消失。
- 地址栏/后退/前进/刷新/查找/缩放 → 都作用活跃 tab。

**Commit 1 做完 typecheck + 自测 → 可 STOP 中间汇报**(翻译×tab 留 Commit 2)。

---

### Commit 2:弹窗导流 + 翻译×tab 共存

#### 3.4 弹窗导流进新 tab

- 主进程 [web-context-menu/handler.ts](src/platform/main/web-context-menu/handler.ts)(或新建 `web-window-open/handler.ts`,跟它平级注册):在 `did-attach-webview` 里对 guest 调:
  ```ts
  guest.setWindowOpenHandler(({ url }) => {
    if (!shouldHandle(guest)) return { action: 'allow' }; // AI/翻译 webview 弹窗不接管,保持原行为
    mainWindow.webContents.send(IPC_CHANNELS.WEB_NEW_TAB, { url });
    return { action: 'deny' };  // 阻止 Electron 弹独立窗口
  });
  ```
  - **复用 `shouldHandle(guest)`**(handler.ts 现成):只导流普通浏览 webview 的弹窗;AI/翻译的 window-open 保持 `allow`(别破坏它们)。
  - `return { action: 'deny' }` 阻止独立 BrowserWindow,改由 renderer 开 tab。
- IPC:[channel-names.ts](src/shared/ipc/channel-names.ts) 加 `WEB_NEW_TAB: 'web.new-tab'`(main→renderer 推);[preload](src/platform/main/preload/main-window-preload.ts) + [electron-api.d.ts](src/shared/ipc/electron-api.d.ts) 加 `onWebNewTab(cb): () => void`(照抄 onWebContextMenuAction)。
- renderer 订阅(WebView 或 context-menu-integration 同款入口):收到 `{url}` → `addTab(activeWsId, url)`。
  - **坑(§4.5)**:推到 renderer 后要开进"哪个 workspace 的 web view"。用 `workspaceManager.getActiveId()` 拿当前活跃 ws;若该 ws 当前是 web view 则 addTab。多 ws 都装 web view 的边界先按"活跃 ws"处理,汇报说明。

#### 3.5 翻译 × tab 共存(最复杂,先 log 验证再下结论)

**核心约束:任一时刻只有一个 Host 的 SyncDriver 订阅 slotBus 'left'**(否则右栏 NAVIGATE 推给所有 left tab 串台)。

- Host 的 `translateMode` prop 改为传**组合值**:`isTranslateMode && tab.id === activeTabId`。即只有"活跃 tab"且"翻译开启"时该 Host 的 translateMode=true。
  - 非活跃 tab:translateMode=false → Host 的 `useEffect [translateMode]`([Host.tsx:233-305](src/capabilities/web-rendering/Host.tsx#L233))走 destroy 分支,不订阅 'left'。✅ 天然保证单活跃。
- 切 tab 时:旧活跃 tab 的 translateMode false→destroy driver;新活跃 tab true→start driver,向右栏发 REQUEST_URL/NAVIGATE 重新对齐到新 tab URL。
  - **时序坑**:React effect cleanup 顺序 —— 切 tab 触发两个 Host 的 effect,要确保旧 driver destroy 在新 driver start 前(或两者间隔)。80ms poll 窗口内若两个 driver 都活会双发 NAVIGATE。**实现后用 log 验证"快速连切 tab"不串台**(feedback_diag_log_before_speculation)。
- 右栏 TranslateHost **不随切 tab 重建**(否则丢 Google widget):它靠 slotBus NAVIGATE 跟随活跃 tab,initialTargetLangRef 锁定([translate-host.tsx:54](src/capabilities/web-rendering/translate-host.tsx#L54))。切 tab 只是让右栏 NAVIGATE 到新 URL。
- targetLang 全 tab 共享(per-ws 单值),切 tab 不变。

#### Commit 2 验收点
- 点 target=_blank 链接 → 在 web view **新 tab** 打开(不再飞出 workspace 独立窗口)。
- AI webview / 翻译右栏的弹窗 → 行为不变(未被接管)。
- 多 tab 下开翻译 → 只对活跃 tab;切 tab → 右栏跟随新 tab URL,不串台、不重建 widget。
- 快速连切 tab → 翻译不串台(log 验证)。

---

## 4. 关键坑清单

1. **hydrate cache 深比**(§3.1):tabs 逐项比,没变返回旧引用,否则 useSyncExternalStore 死循环。**头号雷区**。
2. **initialUrlRef per-tab**(§2.3):每 tab 独立 Host,src 锁各自初始 URL,**绝不把 activeTab url reactive 绑 src**。
3. **SyncDriver 单活跃**(§3.5):任一时刻只一个 Host 订阅 'left'。靠"translateMode = isTranslateMode && 活跃tab"保证。切 tab 先 destroy 旧再 start 新。
4. **setWindowOpenHandler partition 过滤**(§3.4):复用 shouldHandle,只导流普通浏览弹窗,AI/翻译 return allow 不接管。
5. **WEB_NEW_TAB 归属**(§3.4):推到 renderer 后开进活跃 ws 的 web view(workspaceManager.getActiveId);多 ws 边界汇报说明。
6. **transient state 只跟活跃 tab**(§3.2):非活跃 tab 的 loading/url 回调别污染 toolbar。
7. **关最后一个 tab**:回 DEFAULT_URL 单 tab,不让 view 变空。
8. **targetLang 全 tab 共享**:不 per-tab,避免翻译注入路径更复杂。

---

## 5. 文件清单

| 文件 | 改动 | Commit |
|---|---|---|
| `src/views/web/data-model.ts` | schema→tabs;迁移;重写 cache 深比;新写入器 | 1 |
| `src/views/web/WebView.tsx` | 多 tab 渲染(display 切换);hostRef Map;命令路由活跃 tab;⌘T/⌘W;translateMode 组合值 | 1+2 |
| `src/views/web/WebTabBar.tsx` | **新增** tab 栏 UI(≥2 才显) | 1 |
| `src/views/web/web.css` | tab 栏样式 | 1 |
| `src/views/web/web-commands.ts` | open-url 语义→活跃 tab 打开 | 1 |
| `src/capabilities/web-rendering/Host.tsx` | 基本不改;确认 display:none 下 webview 正常;可选加 onTitleChanged | 1 |
| `src/platform/main/web-context-menu/handler.ts`（或新 hook）| setWindowOpenHandler 导流(复用 shouldHandle) | 2 |
| `src/shared/ipc/channel-names.ts` | 加 WEB_NEW_TAB | 2 |
| `src/platform/main/preload/main-window-preload.ts` + `electron-api.d.ts` | 加 onWebNewTab | 2 |
| `src/views/web/context-menu-integration.ts`(或 WebView)| 订阅 WEB_NEW_TAB → addTab | 2 |
| `tests/views/web/data-model.test.ts` | **新增** 迁移 + cache 深比单测 | 1 |

**不动** web-history.ts、drivers/web-sync-driver 协议(除非确证需要且先汇报)、ContextMenuBinding/trigger。

---

## 6. 不做的事

- ❌ 不碰 WorkspaceManager / workspace tab(web tab 全在 pluginStates['web'])。
- ❌ 不破坏 hydrate cache 稳定引用 / initialUrlRef 不变量。
- ❌ 不改 slotBus side 为复合 key(本期靠"单活跃 tab"约束,不升级协议)。
- ❌ targetLang 不做 per-tab。
- ❌ AI/翻译 webview 的弹窗不接管(只导流普通浏览)。
- ❌ 不 merge/push。

---

## 7. 验收 + 汇报

每 commit 前:typecheck PASS / data-model 新单测 PASS / web-history 27/27 仍过 / lint 改动文件 PASS。
手动复现(给用户跑,**完全退出重跑 npm start**):见 §3 各 commit 验收点。

汇报模板:
```
Phase 4 tab(feat/web-tabs)— Commit N 完成:
一、产出(commit hash)
二、实现要点(data-model 迁移 + cache 深比 / 多 webview display 切换 / 弹窗导流 / 翻译×tab 单活跃)
三、踩坑与实测(尤其翻译×tab 串台 log 验证结果)
四、验收(typecheck/单测/lint)
五、手动复现步骤(完全退出重跑)
六、范围外 / 登记 / 简化项(如 tab title 用 url host)
七、等指挥:Commit 1 后是否继续 Commit 2 / merge/push / 进 Phase 3(下载)
```

---

## 8. Self-Contained Check
- ✅ 用户拍板的 7 项决策(§1)
- ✅ 现状 5 块 + 文件:行号 + 3 大不变量(§2)
- ✅ 两 commit 拆分 + data-model/UI/弹窗/翻译×tab 方案(§3)
- ✅ 8 坑清单(§4)+ 11 文件清单(§5)
- ✅ 不做的事 + 验收 + 汇报(§6-7)

**外部依赖**:用户完全退出重跑 npm start 验证;指挥拍板 Commit 1→2 / merge/push / 进 Phase 3。

---

*Phase 4 实现包 · 2026-05-31 · feat/web-tabs · 多 tab(常驻+display切换)+ 弹窗导流 + 翻译×tab 单活跃 · 迄今最大改动,两 commit 分批*
