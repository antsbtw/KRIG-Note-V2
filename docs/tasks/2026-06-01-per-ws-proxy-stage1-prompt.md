# 阶段1 实现包:partition per-ws 化 + 修复下载/media 回归 + 临时 setProxy

> **这是 per-ws 代理工程「阶段1」的自包含实现包。** 读这份 + 引用的代码位置即可从零执行,不需要前序对话上下文。
> 工作目录 **KRIG-Note-V2**(`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`)。**每条 cwd 敏感 Bash 必前缀** `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`;Read 传绝对路径。
> 分支已切好:**`feat/per-ws-proxy`**(从 main `4cb11838`)。

---

## 0. 工作纪律(铁律,必守)

1. **⚠️ 严禁源码写字面控制字符(NUL `\0`)**——本工程踩过两次把 .ts 写成二进制。每改完一个文件 `file <绝对路径>` 确认输出含 "UTF-8 text"(或 "ASCII text"),不能是 "data"。
2. memory `feedback_merge_requires_explicit_ok`:可 commit,**绝不 merge / push / 切分支**(用户显式 OK 才行)。
3. memory `feedback_main_console_not_in_devtools`:主进程 log 在 `npm start` 终端 stdout,不在 DevTools。
4. memory `feedback_diag_log_before_speculation`:跨 session 问题先加 log 实测,别空想。
5. sandbox 拦 `npm start` → **用户跑验证**。你只跑 typecheck(`npm run typecheck` 或仓库等价命令,先 grep package.json scripts 确认)。
6. 做完 **STOP 汇报**,重点是给用户 spike 回归清单 + console 验证示例,等用户跑。

---

## 1. 这是什么 / 已拍板的全部决策

per-ws 代理工程分三阶段。**本包只做阶段1:把普通浏览 webview 的 partition 从全局 `persist:webview` 改成 per-workspace `persist:webview-${workspaceId}`,并修复因此打破的下载 / media 回归,再加临时 setProxy IPC 供用户验证不同 ws 不同出口。**

| 决策点 | 已定 | 对本包的含义 |
|---|---|---|
| will-download / media:// 注册策略 | **attach 时按 `guest.session` 动态挂,Set 去重** | 见 §3.2 §3.3 |
| 阶段1 验证代理出口 | **加回临时 setProxy IPC**(spike 风格 `spikeSetProxyActive`) | 见 §3.4 |
| ytdlp cookie per-ws | **不在本阶段做,留阶段2** | §3.5 列出原因,本包不碰 ytdlp |
| AI / 翻译 partition | **本阶段不动**(翻译已独立 partition;AI 共用旧 `persist:webview`,留后期) | 见 §3.1 末 |
| 代理类型 | socks5 + http,无认证 | 临时 IPC `setProxy({ proxyRules })` 即可 |

**不做**:代理 UI、节点管理、data-model 存 proxyId、登录态迁移、ytdlp、AI/翻译 partition 同步、socks5 认证。这些是阶段2/3。

---

## 2. 关键架构事实(已调研确认,别重新查)

普通浏览 webview 的 partition 写死在一处,会被一圈主进程钩子消费。已逐一核实四个钩子的真实绑定方式:

| 钩子 | 文件:行 | 绑定方式 | per-ws 后是否坏 | 本包改不改 |
|---|---|---|---|---|
| **下载** will-download | [web-download/handler.ts:69](src/platform/main/web-download/handler.ts#L69) | **session 级**:`session.fromPartition(WEBVIEW_PARTITION).on('will-download')` 挂一次 | **坏** — 新 ws partition 是不同 session,没挂 will-download | ✅ 改 |
| **media://** 协议 | [media-store-impl.ts:386](src/platform/main/media/media-store-impl.ts#L386) | **session 级**:`fromPartition(WEBVIEW_PARTITION).protocol.handle('media')` | **坏** — 新 session 没注册 media:// 协议 → 图片 ERR | ✅ 改 |
| **右键菜单** | [web-context-menu/handler.ts:47](src/platform/main/web-context-menu/handler.ts#L47) | **per-guest attach**:`did-attach-webview` → `guest.on('context-menu')`,用 `shouldHandle(guest)` 过滤 | **逻辑上不该坏**(不绑 session)— 见 §3.6 | ❌ 不改,只复核 |
| **快捷键 / 弹窗导流** | [web-shortcuts/handler.ts:120](src/platform/main/web-shortcuts/handler.ts#L120) | **per-guest attach**:`did-attach-webview` → `guest.on('before-input-event')` + `setWindowOpenHandler`,`shouldHandle` 过滤 | 同上,不该坏 | ❌ 不改,只复核 |
| ytdlp cookie | [ytdlp/handlers.ts:115](src/platform/main/ytdlp/handlers.ts#L115)、[ytdlp/downloader.ts:34](src/platform/main/ytdlp/downloader.ts#L34) | 硬编码 `'persist:webview'` 取 cookies | 取错 session 的 cookies | ❌ 留阶段2 |

**`shouldHandle` 真实逻辑**([web-shared/should-handle.ts:27](src/platform/main/web-shared/should-handle.ts#L27)):**默认 true(接管),只排除两类** —— ① 翻译 webview(`guest.session === fromPartition('persist:webview-translate')` 实例比较)② AI webview(`detectAIServiceByUrl(guest.getURL())` 命中)。**它没有正向比对 `persist:webview`**,所以新 partition `persist:webview-${wsId}` 默认仍判 true(接管)→ **理论上右键/快捷键不该坏**。故本包 **不改 shouldHandle**,只在汇报里请用户复核右键。

**partition 写死位置(只改这一处的常量传入,不改 Host)**:
- [WebView.tsx:572](src/views/web/WebView.tsx#L572):`partition={WEBVIEW_PARTITION}` ← 改这里。
- [Host.tsx](src/capabilities/web-rendering/Host.tsx) partition 是 props,**partition-agnostic,不动**。
- AI Host [ai-extraction/Host.tsx:192](src/capabilities/ai-extraction/Host.tsx#L192) 仍用 `WEBVIEW_PARTITION`,**不动**(AI 留旧 partition,本阶段不同步)。

**主进程不知道活跃 ws**:workspace 状态在 renderer 的 `workspaceManager`,主进程没有 active-ws 概念。所以 §3.4 的临时 setProxy 用 renderer 传 workspaceId(或活跃 ws id 由 renderer 取)。

下载历史 store [web-download/download-store.ts](src/platform/main/web-download/download-store.ts) 是**全局 id-keyed**(非 per-ws),不动。

---

## 3. 要做的事(逐项)

### 3.1 partition per-ws 化(1 行)

[WebView.tsx:572](src/views/web/WebView.tsx#L572):
```tsx
partition={`persist:webview-${workspaceId}`}
```
- `workspaceId` 是 `WebView({ workspaceId })` 的 prop,已在作用域内([WebView.tsx:56](src/views/web/WebView.tsx#L56))。
- 模板字符串里 **不能有 NUL**,正常反引号即可。
- 删掉 [WebView.tsx:33](src/views/web/WebView.tsx#L33) 对 `WEBVIEW_PARTITION` 的 import(若改后不再用;`WEBVIEW_DEFAULT_URL` 仍用,保留)。改完跑 typecheck 确认无 unused。
- **可选诊断 log**:WebView mount(`useEffect(() => {...}, [workspaceId])`)log `console.log('[per-ws] ws=', workspaceId, 'partition=persist:webview-' + workspaceId)`,帮用户确认每个 ws 拿到不同 partition。这是诊断 log,留着无妨。

### 3.2 下载 will-download:改 session 级单挂 → attach 时按 guest.session 动态挂

现状 [web-download/handler.ts](src/platform/main/web-download/handler.ts):`registerWebDownloadHook(mainWindow)` 在 index.ts 调一次,对 `fromPartition(WEBVIEW_PARTITION)` 挂一次 will-download。

**改法**:will-download 仍是 **session 级事件**(`(event, item, webContents)`),不能挂 guest webContents(否则共享 session 的 N 个 guest 会 N 倍触发——见原文件头注释的警告)。正确做法是**按 session 实例去重挂**:

1. 加模块级 `const wiredDownloadSessions = new Set<Electron.Session>()`(WeakSet 更佳防泄漏,但 Set 也可;用 WeakSet 需注意不可迭代,这里只 `.has`/`.add`,WeakSet 够用——**用 `WeakSet<Electron.Session>`**)。
2. 把「对某个 session 挂 will-download」抽成函数 `wireDownloadForSession(session, mainWindow)`:若 `wiredDownloadSessions.has(session)` 直接 return;否则 `add` 后挂 will-download(逻辑体照搬现有 §handler.ts:86-146 那段,**完全不变**,包括 `shouldHandle` 过滤、不 setSavePath、started/progress/done、落盘 broadcast)。
3. `registerWebDownloadHook(mainWindow)` 保留:
   - cancel invoke handler(`actionHandlerRegistered` 那段)保持只注册一次。
   - **新增**:在这里挂 `mainWindow.webContents.on('did-attach-webview', (_e, guest) => wireDownloadForSession(guest.session, mainWindow))`。这样每个 ws 的 webview 首次 attach 时,其 session 被挂上 will-download(去重保证同 session 只挂一次)。
   - 兼容:也对 `session.fromPartition(WEBVIEW_PARTITION)`(旧 AI 共用 partition)调一次 `wireDownloadForSession`,确保 AI partition 仍有 will-download(AI 的下载本来就被 shouldHandle 排除,但挂着无害且保持行为一致)。**可选**,主要靠 attach 动态挂。

**关键不变量**:同一 session 只挂一次 will-download(WeakSet 去重),否则重复弹保存框 / 重复推进度。`nextId` / `active` Map / 落盘逻辑全部保持模块级单例不变。

### 3.3 media:// 协议:每个 ws session 首次出现时注册一次

现状 [media-store-impl.ts:363-387](src/platform/main/media/media-store-impl.ts#L363) `registerProtocol()`:对 default session + `fromPartition(WEBVIEW_PARTITION)` 各注册一次 `protocol.handle('media', handler)`。`registerProtocol()` 在 index.ts createMainWindow **之前**调([index.ts:124](src/platform/main/index.ts#L124))。

**问题**:per-ws 后,新 ws 的 session 没注册 media:// → webview 里图片(media:// 链接)ERR_UNKNOWN_URL_SCHEME。

**改法**:
1. 把 handler 抽成实例字段或闭包能复用的引用(现在 handler 是 `registerProtocol` 内局部 `const handler`,把它提成可被另一个方法引用——例如存到 `this._mediaHandler` 或抽成私有方法 `private buildMediaHandler()` 返回同一函数)。
2. 加 `private wiredMediaSessions = new WeakSet<Electron.Session>()`(default + 旧 partition 在 `registerProtocol` 里仍立即注册,可顺手 add 进 set 防重复)。
3. 加公共方法 `registerMediaForSession(session: Electron.Session): void`:`if (this.wiredMediaSessions.has(session)) return; this.wiredMediaSessions.add(session); session.protocol.handle('media', this._mediaHandler)`。
4. **在哪调**:与下载同源——在主进程 `did-attach-webview` 钩子里,对 `guest.session` 调 `mediaStore.registerMediaForSession(guest.session)`。**但 mediaStore 是 platform/main/media 的单例,index.ts 已 import**(grep `mediaStore` 确认导出名与引入路径)。最干净的挂点:**在 §3.2 的 `registerWebDownloadHook` 的 did-attach-webview 回调里一并调**,或在 index.ts 单独加一个 did-attach-webview 钩子。**推荐**:index.ts 加一个小钩子 `mainWindow.webContents.on('did-attach-webview', (_e, guest) => mediaStore.registerMediaForSession(guest.session))`,紧挨现有 hook 注册区([index.ts:140-153](src/platform/main/index.ts#L140))。
   - ⚠️ **时序**:`protocol.handle` 必须在该 session 加载 media:// **之前**注册。`did-attach-webview` 在 guest attach 时触发,**早于** guest 内页面发起 media:// 请求(页面还没开始加载),时序安全。若担心,可在钩子里同步调(protocol.handle 是同步的)。

**关键**:default session + 旧 `persist:webview` 的注册保持(别破坏主 renderer 内嵌 media:// 与 AI partition)。新增的只是「按 guest.session 补注册」。

### 3.4 临时 setProxy IPC(spike 风格,验证用,阶段2 会替换)

加一个**临时** IPC 让用户在 DevTools console 给当前 ws partition 设代理,验证不同 ws 不同出口:

1. **channel 名**:[channel-names.ts](src/shared/ipc/channel-names.ts) 加 `WEB_SET_PROXY: 'web:set-proxy'`(grep 文件看现有命名风格对齐;这个是正式名,阶段2 会复用,**不叫 spike**)。
2. **主进程 handler**(放 web-download/handlers.ts 附近,或新建 `src/platform/main/web-proxy/handler.ts` + 在 index.ts 注册——**推荐新建 web-proxy/handler.ts**,阶段2 代理逻辑就长这,目录先占位):
   ```ts
   ipcMain.handle(IPC_CHANNELS.WEB_SET_PROXY, async (_e, { workspaceId, rules }: { workspaceId: string; rules: string }) => {
     const partition = `persist:webview-${workspaceId}`;
     const sess = session.fromPartition(partition);
     // 空 / 'direct://' → 直连;否则 proxyRules
     await sess.setProxy(rules && rules !== 'direct://' ? { proxyRules: rules } : { mode: 'direct' });
     console.log('[per-ws-proxy] set ws=', workspaceId, 'partition=', partition, 'rules=', rules || '(direct)');
   });
   ```
   - 在 index.ts hook 注册区调 `registerWebProxyHandler()`(无参或传 mainWindow,看是否需要)。
3. **preload** [main-window-preload.ts](src/platform/main/preload/main-window-preload.ts):暴露 `setWebProxy: ({ workspaceId, rules }) => ipcRenderer.invoke(IPC_CHANNELS.WEB_SET_PROXY, { workspaceId, rules })`(grep 看现有 electronAPI 暴露风格对齐)。
4. **d.ts** [electron-api.d.ts](最可能在 src 下,grep `electronAPI` 找声明文件):加 `setWebProxy(args: { workspaceId: string; rules: string }): Promise<void>` 声明。
5. **便利方法(可选但推荐,好测)**:再暴露一个 `setWebProxyActive(rules: string)` —— 但主进程不知活跃 ws,所以这个便利方法放 **renderer 侧**更合适;或在汇报里直接给用户「怎么拿 workspaceId」的 console 取法(grep `workspaceManager` 看 renderer 怎么取活跃 ws id,在汇报里给准确示例,如 `window.<某全局>` 或让用户从 UI 取)。**至少保证汇报里有可直接粘贴的 console 调用示例。**

⚠️ 这是验证用临时 IPC,但 channel/handler/preload 用正式命名(`web:set-proxy` / `setWebProxy`),阶段2 直接复用,不用清理。

### 3.5 ytdlp:本阶段不碰(记录原因)

[ytdlp/handlers.ts:115](src/platform/main/ytdlp/handlers.ts#L115)、[ytdlp/downloader.ts:34](src/platform/main/ytdlp/downloader.ts#L34) 硬编码 `'persist:webview'` 取 cookies。改 per-ws 需给 `ytdlpDownload`/`ytdlpCheckYoutubeCookies` IPC 加传 partition 参数(改 capability API + preload + d.ts 多处签名)。**留阶段2**(那时 per-ws proxyId 管线已就绪,一并改干净)。本包**不动 ytdlp**。

### 3.6 右键 / 快捷键:不改,只复核

§2 已论证 `shouldHandle` 默认 true 不排除新 partition,右键/快捷键挂 per-guest attach 不绑 session,**理论上不该坏**。spike 报告右键坏,根因待实测。本包**不预改**——在汇报里请用户复核右键/快捷键。**若用户复核后仍坏**,再按 `feedback_diag_log_before_speculation` 加 log 诊断(那是后续修复,不在本包)。

---

## 4. 文件清单

| 文件 | 改动 |
|---|---|
| `src/views/web/WebView.tsx` | partition 改 `persist:webview-${workspaceId}`(§3.1)+ 可选诊断 log + 清理 unused import |
| `src/platform/main/web-download/handler.ts` | will-download 改按 guest.session WeakSet 去重动态挂(§3.2) |
| `src/platform/main/media/media-store-impl.ts` | 加 `registerMediaForSession(session)` + WeakSet 去重(§3.3) |
| `src/platform/main/web-proxy/handler.ts`(新建) | 临时 setProxy IPC handler(§3.4) |
| `src/shared/ipc/channel-names.ts` | 加 `WEB_SET_PROXY`(§3.4) |
| `src/platform/main/preload/main-window-preload.ts` | 暴露 `setWebProxy`(§3.4) |
| `src/*/electron-api.d.ts`(grep 定位) | `setWebProxy` 声明(§3.4) |
| `src/platform/main/index.ts` | 注册 web-proxy handler + did-attach-webview 调 `registerMediaForSession`(§3.3/§3.4) |

**不动**:Host.tsx、ai-extraction/Host.tsx、should-handle.ts、web-context-menu、web-shortcuts、ytdlp/*、download-store.ts、webview.ts 常量。

---

## 5. 验证

1. **你跑**:typecheck（先 grep package.json 确认命令,如 `npm run typecheck` / `tsc --noEmit`),0 error。
2. **每个改完的文件** `file <绝对路径>` 确认 UTF-8 text(防 NUL)。
3. **用户跑** `npm start`(完全退出重启)逐项跑 spike 回归清单(§6),标 OK/坏。

---

## 6. 给用户的 spike 回归清单(汇报里列出,用户逐项跑)

| # | 验证项 | 怎么测 | 预期 |
|---|---|---|---|
| 1 | 多 ws 不同 partition | 开 2 个 workspace 都切 web view,看终端 `[per-ws]` log partition 不同 | OK(基础) |
| 2 | 代理生效 | console 调 setWebProxy 设 socks5 `192.168.1.162:1080` → 访问 ipinfo.io 看 IP 变 | OK |
| 3 | **不同 ws 不同出口**(核心目标) | ws1 设代理、ws2 直连 → 各访问 ipinfo.io,IP 不同 | OK |
| 4 | **下载**(本包修的) | 新 partition web view 下载文件 → 弹保存框 + NavSide 下载段有记录 + 可取消/Finder 显示 | **OK(修好了)** |
| 5 | **media 图片**(本包修的) | 网页图片正常显示(media:// 协议) | **OK(修好了)** |
| 6 | 右键菜单 | 新 partition webview 右键 → 原生菜单出(复制链接/查词等) | 应 OK(未改,复核) |
| 7 | 快捷键 | ⌘T/⌘L/⌘F/⌘W 等生效 | 应 OK(未改,复核) |
| 8 | 弹窗导流 | target=_blank 导流进新 tab(不飞独立窗口) | 应 OK(未改,复核) |
| 9 | 翻译双栏 | 翻译正常(独立 partition) | OK |
| 10 | AI webview | AI 服务(claude.ai 等)能用(共用旧 partition) | OK |
| 11 | 书签/历史/tab | 这些功能正常 | OK |

**console 验证示例**(汇报里给准确版,含怎么拿 workspaceId):
```js
// 取当前活跃 ws id 的方法 grep workspaceManager 后在汇报给准确写法
window.electronAPI.setWebProxy({ workspaceId: '<活跃ws id>', rules: 'socks5://192.168.1.162:1080' })
window.electronAPI.setWebProxy({ workspaceId: '<另一ws id>', rules: 'direct://' }) // 直连
```

---

## 7. 汇报格式

```
阶段1(feat/per-ws-proxy)完成:
一、改动逐项(partition per-ws + 下载 WeakSet 动态挂 + media registerMediaForSession + 临时 setProxy IPC),关键 commit hash(若已 commit)
二、怎么测代理:console setWebProxy 准确调用示例 + 怎么拿活跃 ws id(grep 后给准确写法)
三、spike 回归清单(§6 11 项)—— 请用户逐项跑标 OK/坏,重点 #4 下载 / #5 图片 是否修好,#6/#7 右键快捷键复核
四、typecheck 结果 + 每个文件 file 命令确认 UTF-8
五、ytdlp 留阶段2 的说明(§3.5)
六、等用户跑完回归 → 据结果决定进阶段2 / 修残留(如右键若仍坏需诊断)
```

**不 commit 除非顺手(可 commit 到 feat/per-ws-proxy,绝不 merge/push)。** 做完 STOP,等用户跑回归。

---

*阶段1 实现包 · 2026-06-01 · feat/per-ws-proxy · partition per-ws + 修下载/media + 临时 setProxy · ytdlp/UI/持久化留阶段2/3*
