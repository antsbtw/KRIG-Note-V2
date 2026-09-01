# Phase 2 根治:web view 右键菜单改用主进程原生菜单

> **真因已铁证查清**:web view 的 HTML 右键菜单(`ContextMenuBinding`,`z-index:1000`)一直在正确渲染,但被 Electron `<webview>`(OS 级独立渲染 surface)**视觉盖住**,用户看到的实际是 Chromium 原生菜单 —— 所以之前所有改动(blur / 坐标)都打错目标。诊断 log 实证:`[diag-4] visible=true items=2` 菜单确实渲染,但 z-index 对 webview 无效。
> **解法(用户拍板):改用 Electron 主进程原生菜单(`Menu.popup`)根治。** 原生菜单能盖在 webview 上、点外部自动关、坐标准 —— 两个 bug 一并消失。
> 调研已完成(见本包 §1),采用**路径1(纯主进程 `webContents.on('context-menu')`)**。
> **在 `feat/web-context-menu` 分支继续,不切新分支,不 merge/push。**

---

## 0. 工作纪律

1. cwd 敏感 Bash 必前缀 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`;Read 绝对路径。
2. 只动「文件清单」文件。memory:`feedback_no_fallback_bandaid_fixes`、`feedback_merge_requires_explicit_ok`(commit 可,merge/push 等显式 OK)、`feedback_main_console_not_in_devtools`(主进程 log 在终端 stdout)。
3. sandbox 拦 npm start → 用户跑。typecheck/单测自己跑。命令:typecheck=`npm run typecheck`,test=`npm run test`,lint=`npm run lint`。
4. 做完 STOP 汇报。

---

## 1. 调研结论(已 grep 确认,作为实现依据)

### 1.1 现成基建(全部复用)

- **主进程 webview 接入**:`mainWindow.webContents.on('did-attach-webview', (_e, guest) => ...)` 已有两处范例([src/platform/main/ai/webview-hook.ts:13](src/platform/main/ai/webview-hook.ts#L13)、[src/platform/main/extraction/handlers.ts:134](src/platform/main/extraction/handlers.ts#L134)),都在 [src/platform/main/index.ts:137-140](src/platform/main/index.ts#L137) `createMainWindow` 后注册。**Electron 支持多个 did-attach-webview 监听器**,新增第三个不冲突。
- **这两个钩子收到所有 guest webview**(普通浏览 / AI / 翻译),不按 partition 过滤。**普通浏览 webview 的 partition = `persist:webview`**([src/shared/constants/webview.ts:10](src/shared/constants/webview.ts#L10) `WEBVIEW_PARTITION`);翻译 = `persist:webview-translate`。
- **主进程当前没有任何 `webContents.on('context-menu')` 监听 / `Menu.popup`**(全是首次引入)。`Menu`/`clipboard` 需 `import { Menu, clipboard } from 'electron'`。
- **IPC handler 模式**:每文件导出 `registerXxxHandlers()`,`ipcMain.handle`(invoke)/ `ipcMain.on`(fire-forget);main→renderer 推送用 `win.webContents.send(channel, payload)`。集中注册在 [src/platform/main/ipc/ipc-bus.ts:24](src/platform/main/ipc/ipc-bus.ts#L24) `initIpcBus()`。
- **IPC channel 常量**:[src/shared/ipc/channel-names.ts](src/shared/ipc/channel-names.ts) `IPC_CHANNELS`,命名 `<层>.<动作>`。已有 `WEB_TRANSLATE_FETCH_ELEMENT_JS: 'web-translate.fetch-element-js'`。
- **preload 订阅模式**:[main-window-preload.ts](src/platform/main/preload/main-window-preload.ts) `onXxx(callback): () => void`,内部 `ipcRenderer.on` + 返回取消函数。模板 `onExtractionNoteCreate`(:325)。类型同步加到 [electron-api.d.ts](src/shared/ipc/electron-api.d.ts)。

### 1.2 要迁移的 5 个菜单项(现 [context-menu-integration.ts](src/views/web/context-menu-integration.ts))

| 项 | 动作 | 条件 | 改原生后在哪执行 |
|---|---|---|---|
| 复制链接 | `clipboard.writeText(linkURL)` | linkURL 非空 | **主进程**(Electron clipboard) |
| 复制图片地址 | `clipboard.writeText(srcURL)` | srcURL 非空 | **主进程** |
| 复制选中文字 | `clipboard.writeText(selectionText)` | 有选区 | **主进程** |
| 📖 查词 | `learning.ui.dictionaryPanel.showLookup(text)` | 有选区 | **渲染进程**(learning capability,IPC 回) |
| 🌐 翻译 | `learning.ui.dictionaryPanel.showTranslate(text)` | 有选区 | **渲染进程**(IPC 回) |

**关键约束**:查词/翻译走 `requireCapabilityApi<LearningApi>('learning')`,**只能在渲染进程跑**(操作 React UI 面板)。所以菜单在主进程弹,但这两项点击后必须 IPC 推回渲染进程执行。复制类主进程 `clipboard` 直接做,不用回渲染。

`webContents.on('context-menu', (e, params) => ...)` 的 `params` 自带 `linkURL / srcURL / selectionText / x / y` —— **原生坐标,无需任何 getBoundingClientRect 换算**(这正是根治 bug2 的关键)。

---

## 2. 实现方案(路径1:纯主进程)

### 2.1 新增主进程 hook

新建 `src/platform/main/web-context-menu/handler.ts`,导出 `registerWebContextMenuHook(mainWindow: BrowserWindow): void`:

```
mainWindow.webContents.on('did-attach-webview', (_e, guest) => {
  // 只处理普通浏览 webview(persist:webview),排除翻译(persist:webview-translate)和 AI
  // partition 判定:用 guest.session —— 见下方「partition 过滤」注意
  guest.on('context-menu', (e, params) => {
    // 只在确属普通浏览 webview 时弹(过滤见下)
    const template = [];
    if (params.linkURL) template.push({ label: '复制链接', click: () => clipboard.writeText(params.linkURL) });
    if (params.srcURL)  template.push({ label: '复制图片地址', click: () => clipboard.writeText(params.srcURL) });
    if (params.selectionText) {
      template.push({ label: '复制选中文字', click: () => clipboard.writeText(params.selectionText) });
      template.push({ type: 'separator' });
      template.push({ label: '📖 查词', click: () => mainWindow.webContents.send(IPC_CHANNELS.WEB_CONTEXT_MENU_ACTION, { action: 'lookup', text: params.selectionText }) });
      template.push({ label: '🌐 翻译', click: () => mainWindow.webContents.send(IPC_CHANNELS.WEB_CONTEXT_MENU_ACTION, { action: 'translate', text: params.selectionText }) });
    }
    if (template.length === 0) return;  // 无可用项不弹(让 Chromium 默认?见下「空菜单」)
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: mainWindow });
  });
});
```

- 在 [src/platform/main/index.ts](src/platform/main/index.ts) `createMainWindow` 后注册 `registerWebContextMenuHook(mainWindow)`(对齐 :137/:140 现有两个 hook 的注册位置)。

**partition 过滤(必做)**:三个 did-attach-webview 钩子都收到所有 guest。本 hook **必须只对 `persist:webview` 普通浏览 webview 弹菜单**,否则会和 AI webview / 翻译 webview 抢右键。
- 判定方式:grep 确认 guest 如何区分 partition。`guest.session` 没有直接暴露 partition 字符串,但可参考 extraction hook 的 `isPlatformUrl(url)` / AI hook 的 `detectAIServiceByUrl` 过滤思路。**最稳妥**:检查 guest 关联的 webview 是用哪个 partition attach 的 —— `did-attach-webview` 的 event 或 guest 上能否拿到 partition?grep Electron 类型 + 现有两 hook 怎么做的。若拿不到 partition,退路:用「排除法」—— 若 URL 命中 AI 服务(detectAIServiceByUrl)或是翻译 widget 则不处理。**实现时先 grep 清楚再定,别拍脑袋**。本任务用户已定「只管普通浏览」,翻译/AI 一律不接管。

### 2.2 IPC channel + preload

- [channel-names.ts](src/shared/ipc/channel-names.ts):加 `WEB_CONTEXT_MENU_ACTION: 'web.context-menu-action'`(// main → renderer 推送)。
- [main-window-preload.ts](src/platform/main/preload/main-window-preload.ts):加 `onWebContextMenuAction(callback: (payload: { action: 'lookup'|'translate'; text: string }) => void): () => void`,模板照抄 `onExtractionNoteCreate`。
- [electron-api.d.ts](src/shared/ipc/electron-api.d.ts):同步加类型声明。

### 2.3 渲染进程接收 + 删旧 HTML 菜单逻辑

[context-menu-integration.ts](src/views/web/context-menu-integration.ts):
- **改造 `registerWebContextMenu`**:订阅 `window.electronAPI.onWebContextMenuAction(({action, text}) => { ... })`,收到 `lookup` → `requireCapabilityApi<LearningApi>('learning').ui.dictionaryPanel.showLookup(text)`;`translate` → `.showTranslate(text)`。
- **删除**:`showWebContextMenu` / `getCurrentWebContext` / `attachCloseListeners` / `detachCloseListeners` / `currentContext` 模块状态 / 5 个 `commandRegistry.register('web-view.cm-*')` / `contextMenuRegistry.register([...])` —— 这些 HTML 菜单逻辑全部不再需要(菜单移到主进程)。
- 保留:`registerWebContextMenu` 这个导出名(被 [src/views/web/index.ts](src/views/web/index.ts) 调用),改成内部只做「订阅 IPC action」。

### 2.4 删 Host / WebView 的 context-menu 捕获

- [Host.tsx](src/capabilities/web-rendering/Host.tsx):删 `handleContextMenu`(L178-210,**含 `[web/ctxmenu-diag]` log**)、`wv.addEventListener('context-menu', handleContextMenu)`(约 L256)及对应 removeEventListener、`onContextMenu` prop(L56 接口定义 + 解构 + callbacksRef)。原生菜单后渲染进程不再捕获 webview context-menu 事件。
- [WebView.tsx](src/views/web/WebView.tsx):删传给 `<Host>` 的 `onContextMenu={showWebContextMenu}`(L355)+ 对应 import。
- [webview-types.ts](src/capabilities/web-rendering/webview-types.ts):若 `WebContextMenuPayload` 类型只此一处用,可删(grep 确认无其它引用再删)。

---

## 3. 文件清单

| 文件 | 改动 |
|---|---|
| `src/platform/main/web-context-menu/handler.ts` | **新增** registerWebContextMenuHook(原生菜单 + partition 过滤 + 复制类主进程做 + 查词/翻译 IPC 推送) |
| `src/platform/main/index.ts` | createMainWindow 后注册 hook |
| `src/shared/ipc/channel-names.ts` | 加 WEB_CONTEXT_MENU_ACTION |
| `src/platform/main/preload/main-window-preload.ts` | 加 onWebContextMenuAction |
| `src/shared/ipc/electron-api.d.ts` | 加类型声明 |
| `src/views/web/context-menu-integration.ts` | 改 registerWebContextMenu 为订阅 IPC action;删旧 HTML 菜单逻辑 |
| `src/capabilities/web-rendering/Host.tsx` | 删 handleContextMenu + context-menu 监听 + onContextMenu prop + diag log |
| `src/views/web/WebView.tsx` | 删 onContextMenu 传参 |
| `src/capabilities/web-rendering/webview-types.ts` | 删 WebContextMenuPayload(grep 确认无引用) |

**不动** web-history.ts、ContextMenuBinding / collision hook / useContextMenuTrigger(那是 note/ebook 的,web view 不再用它)。

---

## 4. 已知坑 / 注意

1. **partition 过滤是头号坑**:三个 did-attach 钩子都收到所有 guest，本 hook 必须只认 `persist:webview`。**先 grep 清楚 guest 怎么拿 partition**(看 Electron 版本 40.6 的 did-attach-webview event 签名 + 现有两 hook 怎么区分),拿不到 partition 就用 URL 排除法(非 AI 服务 URL + 非翻译 widget)。宁可保守:实现后在汇报里说清用了哪种判定 + 是否可能误伤 AI/翻译 webview。
2. **空菜单**:右键空白处(无 link/src/selection）template 为空 → 当前设计 return 不弹(此时 Chromium 会显示自己的默认菜单吗?Electron 里 `webContents.on('context-menu')` 监听后**默认行为是否被吞**取决于是否 preventDefault —— grep/查 Electron 文档确认。若监听后默认菜单不出且我们也不弹 = 右键空白无反应,可接受;若仍出默认菜单 = 不一致)。**实现时确认并在汇报说明空白处右键行为**。
3. **clipboard 主进程**:`import { clipboard } from 'electron'` 主进程版,`writeText` 同步,OK。
4. **查词/翻译 IPC 回**:`mainWindow.webContents.send` 推到主窗口渲染进程,渲染侧 learning capability 必须已就绪(view 注册时订阅,正常时序应 OK)。
5. **主进程 log**:调试用 `[web/ctxmenu]` 前缀,在终端 stdout 看(feedback_main_console_not_in_devtools)。
6. **diag log 清理**:Host.tsx 的 `[web/ctxmenu-diag]` 随 handleContextMenu 一起删掉。

---

## 5. 验收(commit 前)

1. typecheck PASS。
2. `npm run test -- web-history` 仍 27/27(不动它,确认没误伤)。
3. lint 改动文件 PASS。
4. 手动复现(给用户跑 npm start,**完全退出重跑**):
   - 右键 webview 内**链接** → 原生菜单出现在**鼠标位置**,有「复制链接」等项。
   - 右键**选中的文字** → 有「复制选中文字 / 📖 查词 / 🌐 翻译」;点查词/翻译 → 渲染进程 dictionaryPanel 正常弹。
   - **点菜单外部 / 别处** → 原生菜单自动关闭(根治 bug3)。
   - 菜单**贴着鼠标**(根治 bug2)。
   - 翻译双栏右栏右键 → 保持现状(本轮不接管,Chromium 默认)。
5. commit(分支 `feat/web-context-menu`,**不 merge/push**),中文动机优先,说明「右键菜单改主进程原生 — 根治 HTML 菜单被 webview OS 层遮挡」,结尾:
   ```
   Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
   ```

---

## 6. 汇报模板

```
Phase 2 原生右键菜单(feat/web-context-menu)完成:

一、产出(commit hash + 文件数)
二、实现要点
   - 主进程 hook:partition 过滤用了哪种判定(确认不误伤 AI/翻译)
   - 复制类主进程 clipboard / 查词翻译 IPC 回渲染
   - 删了哪些旧 HTML 菜单逻辑(Host/WebView/integration)
三、空白处右键行为(Electron 监听后默认菜单是否还出)—— 实测/查文档结论
四、验收(typecheck/test/lint)
五、手动复现步骤(给用户跑,完全退出重跑 npm start)
六、范围外 / 登记
七、等指挥:merge/push?进 Phase 3?
```

---

## 7. Self-Contained Check

- ✅ 真因(z-index 对 webview 无效,被 OS 层盖住)+ diag 铁证
- ✅ 路径1 方案 + 调研的现成基建(§1)
- ✅ 5 菜单项迁移映射(主进程 clipboard / IPC 回 learning)
- ✅ 9 文件清单 + 新增 hook 骨架(§2-3)
- ✅ partition 过滤头号坑 + 空菜单坑(§4)
- ✅ 验收 + 汇报模板

**外部依赖**:用户完全退出重跑 npm start 验证;用户拍板 merge/push + 进 Phase 3。partition 判定方式实现时现场 grep 定。

---

*Phase 2 原生菜单根治包 · 2026-05-31 · feat/web-context-menu · 路径1 纯主进程 · 真因=HTML 菜单被 webview OS 层遮挡*
