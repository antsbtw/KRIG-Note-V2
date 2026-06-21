# Phase 4 Commit 2:web 快捷键整层重做 + 弹窗导流进新 tab + 翻译×tab 单活跃

> 承接 Phase 4 Commit 1(分支 `feat/web-tabs`,commits 82ba23b6 + 35fa35d2 + 063f93b4,白屏已修)。
> Commit 1 实测发现:**⌘T 不生效**,且查清根因 = **整个 web 快捷键层(⌘T/⌘W + Phase 1 的 ⌘L/⌘F/⌘R/⌘±/⌘[⌘])在 webview 内焦点时全失效**(webview 独立进程,键盘事件不冒泡到宿主 onKeyDown)。
> 本 Commit 2 一次性解决三件事,都靠**主进程在 guest webContents 上拦截**(复用 Phase 2 的 `did-attach-webview` + `shouldHandle` + IPC 回推基建)。
> **在 `feat/web-tabs` 分支继续,不切新分支,不 merge/push。**

---

## 0. 工作纪律

1. cwd 敏感 Bash 必前缀 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`;Read 绝对路径。
2. memory:`feedback_no_fallback_bandaid_fixes`、`feedback_merge_requires_explicit_ok`(commit 可,merge/push 等显式 OK)、`feedback_main_console_not_in_devtools`(主进程 log 看终端 stdout)、`feedback_diag_log_before_speculation`(翻译×tab 串台先 log 验证)。
3. sandbox 拦 npm start → 用户跑(**必须完全退出重跑**)。typecheck/单测自己跑。命令:typecheck=`npm run typecheck`,test=`npm run test`,lint=`npm run lint`。
4. **⚠️ 严禁在源码里写字面控制字符(NUL `\0` / `\x01` 等)**。上一轮 sourceSignature 用 `\0` 当分隔符把 .ts 写成二进制文件,踩过坑。要分隔用普通可见字符或结构化数组。
5. 建议拆 3 个 commit:① 快捷键整层(before-input-event)② 弹窗导流 ③ 翻译×tab。每个 commit 前 typecheck + 自测。①②做完可中间汇报,③(翻译×tab 最易翻车)做完单独汇报。
6. 做完 STOP 汇报。

---

## 1. 用户已拍板决策

| 决策 | 选择 |
|---|---|
| 快捷键范围 | **一次性重做整层** —— ⌘T/⌘W + Phase 1 的 ⌘L/⌘F/⌘R/⌘±/⌘[⌘] 全走主进程拦截 |
| ⌘W 冲突 | **⌘W = 关当前 tab,⇧⌘W = 关窗口**(对齐 Chrome) |
| webview 实例 | 每 tab 常驻 + display:none(Commit 1 已实现) |
| 翻译×tab | 翻译只对活跃 tab 生效 |
| 弹窗 | setWindowOpenHandler 导流进新 tab |

---

## 2. 已查清的架构(研究结论,文件:行号)

### 2.1 主进程拦截基建(复用)
- `did-attach-webview` 拿 guest webContents:[web-context-menu/handler.ts:66](src/platform/main/web-context-menu/handler.ts#L66)。已有 `shouldHandle(guest)` 过滤(排除 AI/翻译 webview)。
- **only `webContents.on('before-input-event')` 能在 webview 内焦点时拿到键盘**(全项目 0 处 before-input-event,首次引入)。
- IPC 回推模式现成:`WEB_CONTEXT_MENU_ACTION`([handler.ts:92](src/platform/main/web-context-menu/handler.ts#L92) send → preload `onWebContextMenuAction` [main-window-preload.ts:332](src/platform/main/preload/main-window-preload.ts#L332) → [context-menu-integration.ts:20](src/views/web/context-menu-integration.ts#L20) 订阅)。新 channel 照抄。

### 2.2 关键洞察:活跃 ws 不用主进程知道
- `workspaceManager` 是渲染进程单例,主进程不知道哪个 ws 活跃。
- **但不需要知道**:只有"焦点所在的那个 webview"会收到 before-input-event / window-open。所以主进程只管"焦点 webview 发来了动作 X",渲染进程收到 IPC 后用 `workspaceManager.getActiveId()` 拿当前 ws —— 因为发事件的就是活跃 web view 的 webview,getActiveId 必对。

### 2.3 应用菜单 ⌘W 冲突
- [framework-menus.ts:85](src/platform/main/menu/framework-menus.ts#L85) `{ id:'close', label:'Close Window', command:'window.close', accelerator:'CmdOrCtrl+W' }` → [:21](src/platform/main/menu/framework-menus.ts#L21) `BrowserWindow.getFocusedWindow()?.close()`。
- menu accelerator 是全局的,会跟 web view 的"⌘W 关 tab"抢。**决策:菜单 ⌘W 改成 ⇧⌘W(`CmdOrCtrl+Shift+W`),label 不变 Close Window**;⌘W 让给 web view 关 tab(主进程 before-input-event 拦)。
  - menu-registry 用 `accelerator` 字段([menu-registry.ts:73-83](src/slot/menu-registry/menu-registry.ts#L73))。改 framework-menus.ts:85 的 accelerator 字符串即可。

### 2.4 WebView 现有 handler(IPC 回推后映射到这些)
[WebView.tsx](src/views/web/WebView.tsx)(commit 82ba23b6/063f93b4 后):`handleNavigate`(:159)、`handleGoBack`(:165)、`handleGoForward`(:166)、`handleReload`(:167)、`openFind`(:175)、zoomIn/Out/Reset(:213/217/221)、`focusUrlBar`(:226)、`handleNewTab`(:234)、`handleCloseTab`(:237)。现有 `handleKeyDown`(:253-314,宿主 onKeyDown,webview 焦点下失效)—— **本 Commit 用主进程拦截取代它**。

### 2.5 弹窗现状
- `allowpopups:'true'`([Host.tsx:385](src/capabilities/web-rendering/Host.tsx#L385)),**全项目 0 处 setWindowOpenHandler** → 点 target=_blank 弹独立 BrowserWindow(飞出 workspace,用户痛点)。

### 2.6 翻译×tab(Commit 1 现状)
- Commit 1 兜法:`translateMode` 只在 `tabs.length===1` 时按原 isTranslateMode 传,**多 tab 全传 false**(暂不开翻译)。SyncDriver side 写死 'left'([Host.tsx:246](src/capabilities/web-rendering/Host.tsx#L246)),slotBus 单例。

---

## 3. 实现方案(3 commit)

### Commit A:web 快捷键整层(主进程 before-input-event)

新建 `src/platform/main/web-shortcuts/handler.ts`,导出 `registerWebShortcutsHook(mainWindow)`,跟 registerWebContextMenuHook 平级注册([platform/main/index.ts](src/platform/main/index.ts)):
```
mainWindow.webContents.on('did-attach-webview', (_e, guest) => {
  guest.on('before-input-event', (event, input) => {
    if (!shouldHandle(guest)) return;       // 复用,排除 AI/翻译 webview
    if (input.type !== 'keyDown') return;
    const mod = input.meta || input.control;
    const action = matchShortcut(mod, input.shift, input.key);  // 见下表
    if (!action) return;
    event.preventDefault();                  // 阻止网页收到该键
    mainWindow.webContents.send(IPC_CHANNELS.WEB_VIEW_SHORTCUT, { action });
  });
});
```
- `shouldHandle` 当前在 web-context-menu/handler.ts 内部,若要复用需 export 出来(或抽到 shared helper)。grep 确认后决定 export 还是抽共享。
- 快捷键映射表(action 字符串):

| 键 | action | 渲染进程映射 |
|---|---|---|
| ⌘T | `new-tab` | handleNewTab |
| ⌘W | `close-tab` | handleCloseTab(activeTabId) |
| ⌘L | `focus-url` | focusUrlBar |
| ⌘F | `find` | openFind |
| ⌘R / F5 | `reload` | handleReload |
| ⌘+ / ⌘= | `zoom-in` | zoomIn |
| ⌘- | `zoom-out` | zoomOut |
| ⌘0 | `zoom-reset` | zoomReset |
| ⌘[ / Alt+← | `go-back` | handleGoBack |
| ⌘] / Alt+→ | `go-forward` | handleGoForward |

- IPC:[channel-names.ts](src/shared/ipc/channel-names.ts) 加 `WEB_VIEW_SHORTCUT: 'web.view-shortcut'`(main→renderer 推)。
- preload + electron-api.d.ts 加 `onWebViewShortcut(cb): () => void`(照抄 onWebContextMenuAction)。
- 渲染进程订阅:在 WebView.tsx `useEffect` 里 `onWebViewShortcut(({action}) => dispatch)`,把 action 映射到现有 handler。**注意 closure 新鲜度**:订阅要拿到最新的 activeTabId/handlers(用 ref 或把订阅放在能拿到最新值的地方,别捕获到 stale activeTabId)。
- **删除/保留宿主 onKeyDown**:`handleKeyDown`(WebView.tsx:253-314)在 webview 焦点下失效,但**宿主焦点时(刚切 tab、还没点进网页)它仍有用**。建议**保留宿主 onKeyDown 做"宿主焦点兜底",主进程 before-input-event 做"webview 焦点主力"**,两者都 dispatch 到同一组 handler(幂等)。若怕重复触发,可只保留主进程一路 + 宿主 onKeyDown 仅留 Esc 等不经主进程的。**实现时权衡,汇报说明最终方案**。
- **应用菜单 ⌘W 改 ⇧⌘W**:[framework-menus.ts:85](src/platform/main/menu/framework-menus.ts#L85) accelerator `'CmdOrCtrl+W'` → `'CmdOrCtrl+Shift+W'`。

#### Commit A 验收
- **焦点在网页内(浏览中)按 ⌘T → 新建 tab**(根治主症状)。⌘L/⌘F/⌘R/⌘±/⌘[⌘] 在网页焦点下都生效。
- ⌘W 关当前 tab(不再关窗口);⇧⌘W 关窗口。
- AI/翻译 webview 内这些键不被接管(shouldHandle 过滤)。

### Commit B:弹窗导流进新 tab(你的核心痛点)

主进程 `did-attach-webview` 里对 guest 加(可放进 web-shortcuts/handler.ts 或新 web-window-open/handler.ts):
```
guest.setWindowOpenHandler(({ url }) => {
  if (!shouldHandle(guest)) return { action: 'allow' };  // AI/翻译弹窗不接管
  mainWindow.webContents.send(IPC_CHANNELS.WEB_NEW_TAB, { url });
  return { action: 'deny' };  // 阻止独立 BrowserWindow
});
```
- IPC `WEB_NEW_TAB: 'web.new-tab'` + preload `onWebNewTab` + 渲染订阅 → `addTab(workspaceManager.getActiveId(), url)`。
- **坑**:`getActiveId()` 拿活跃 ws(发弹窗的就是活跃 web view 的 webview,对)。若活跃 ws 当前不是 web view,边界先按"仍 addTab 到该 ws 的 web 状态"或忽略,汇报说明。

#### Commit B 验收
- 点 target=_blank 链接 → **在 web view 新 tab 打开**(不再飞出独立窗口,根治用户痛点)。
- AI webview / 翻译右栏弹窗 → 行为不变。

### Commit C:翻译 × tab 单活跃

- Host 的 `translateMode` prop 改为传 `isTranslateMode && tab.id === activeTabId`(取代 Commit 1 的 `tabs.length===1` 兜法)。即只有"活跃 tab 且翻译开"的 Host translateMode=true。
- 非活跃 tab translateMode=false → Host useEffect 走 destroy 分支不订阅 slotBus 'left'。**任一时刻只一个 Host 订阅 'left',不串台**。
- 切 tab 时:旧活跃 tab translateMode false→destroy driver;新活跃 tab true→start driver,向右栏发 REQUEST_URL/NAVIGATE 对齐新 tab URL。
- 右栏 TranslateHost 不随切 tab 重建(靠 slotBus NAVIGATE 跟随,initialTargetLangRef 锁定 [translate-host.tsx:54](src/capabilities/web-rendering/translate-host.tsx#L54))。
- **时序坑**:切 tab 触发两 Host effect,确保旧 driver destroy 在新 start 前(80ms poll 窗口内两 driver 都活会双发 NAVIGATE)。**实现后用 log 验证"快速连切 tab 不串台"**(feedback_diag_log_before_speculation)。

#### Commit C 验收
- 多 tab 下开翻译 → 只对活跃 tab;翻译按钮在多 tab 下也能用(取消 Commit 1 的"多 tab 不亮"限制)。
- 切 tab → 右栏跟随新 tab URL,不串台、不重建 widget。
- 快速连切 tab → 不串台(log 验证)。

---

## 4. 文件清单

| 文件 | 改动 | Commit |
|---|---|---|
| `src/platform/main/web-shortcuts/handler.ts` | **新增** before-input-event 拦截 + 快捷键映射(+ 可含 setWindowOpenHandler) | A(+B) |
| `src/platform/main/web-context-menu/handler.ts` | export `shouldHandle`(若复用需要) | A |
| `src/platform/main/index.ts` | 注册 registerWebShortcutsHook | A |
| `src/platform/main/menu/framework-menus.ts` | ⌘W → ⇧⌘W(close window accelerator) | A |
| `src/shared/ipc/channel-names.ts` | 加 WEB_VIEW_SHORTCUT + WEB_NEW_TAB | A+B |
| `src/platform/main/preload/main-window-preload.ts` + `electron-api.d.ts` | onWebViewShortcut + onWebNewTab | A+B |
| `src/views/web/WebView.tsx` | 订阅 shortcut/new-tab IPC → dispatch 现有 handler;translateMode 改组合值;宿主 onKeyDown 去留 | A+B+C |
| (可能) `src/platform/main/web-window-open/handler.ts` | 若 setWindowOpenHandler 单独放 | B |

**不动** data-model.ts(Commit 1 已定)、web-history.ts、drivers/web-sync-driver 协议、slotBus side、ContextMenuBinding。

---

## 5. 坑清单

1. **严禁字面控制字符**(NUL 等)写进源码(上轮踩过,文件变二进制)。
2. **IPC 订阅 closure 新鲜度**:onWebViewShortcut 回调别捕获 stale activeTabId/handlers,用 ref 或重订阅。
3. **shouldHandle 过滤**:快捷键 + 弹窗都只接管普通浏览 webview,AI/翻译放过。
4. **SyncDriver 单活跃**:translateMode = isTranslateMode && 活跃tab,切 tab 先 destroy 旧 driver 再 start 新(80ms 窗口双发)。
5. **宿主 onKeyDown 去留**:主进程拦截后,宿主 onKeyDown 可能重复触发,权衡保留(宿主焦点兜底)还是删,汇报说明。
6. **⌘W 冲突**:菜单改 ⇧⌘W 后,确认 ⌘W 真的只走 web view 关 tab(不再关窗口)。
7. **getActiveId 归属**:弹窗/快捷键 IPC 回渲染用 getActiveId,焦点 webview = 活跃 web view,正确。
8. **before-input-event 性能**:每个键都进回调,matchShortcut 要快(早返回非 mod 键)。

---

## 6. 不做的事
- ❌ 不写字面控制字符进源码。
- ❌ 不改 data-model schema(Commit 1 已定)。
- ❌ 不改 slotBus side 为复合 key(靠单活跃约束)。
- ❌ AI/翻译 webview 的快捷键/弹窗不接管。
- ❌ 不 merge/push。

---

## 7. 验收 + 汇报

每 commit 前:typecheck PASS / 现有单测无回归(web-history 27 + data-model 18 + omnibox 15) / lint 改动文件 PASS。
手动复现(给用户,**完全退出重跑 npm start**):§3 各 commit 验收点。

汇报模板:
```
Phase 4 Commit 2(feat/web-tabs)— Commit A/B/C 完成:
一、产出(commit hash)
二、实现要点(before-input-event 映射 / 宿主 onKeyDown 去留 / ⌘W→⇧⌘W / 弹窗导流 / 翻译×tab 单活跃)
三、踩坑与实测(尤其翻译×tab 串台 log 验证、宿主onKeyDown 重复触发处理)
四、验收(typecheck/单测/lint)
五、手动复现步骤(完全退出重跑;重点:网页焦点下按 ⌘T 应生效)
六、范围外/登记
七、等指挥:merge/push?进 Phase 3(下载)?
```

---

## 8. Self-Contained Check
- ✅ 用户 2 决策(整层重做 + ⌘W→⇧⌘W)
- ✅ 根因(webview 焦点下宿主 onKeyDown 失效)+ 主进程拦截基建(§2)
- ✅ 3 commit 方案 + 快捷键映射表 + 弹窗 + 翻译×tab(§3)
- ✅ 8 坑(含字面控制字符禁令)+ 文件清单(§4-5)
- ✅ 验收 + 汇报(§7)

**外部依赖**:用户完全退出重跑 npm start 验证(重点网页焦点下 ⌘T);指挥拍板 merge/push + 进 Phase 3。

---

*Phase 4 Commit 2 · 2026-05-31 · feat/web-tabs · 快捷键整层(before-input-event)+ 弹窗导流 + 翻译×tab 单活跃 · 复用 Phase 2 主进程 IPC 基建*
