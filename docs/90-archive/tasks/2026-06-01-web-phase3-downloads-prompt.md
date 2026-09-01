# Phase 3:Web view 下载管理

> 给普通浏览 webview(partition `persist:webview`)加下载:点下载链接 → 弹系统保存对话框 → 显示下载进度条 → 完成后「在 Finder 显示」。
> 复用 Phase 2/4 建好的主进程 hook + shouldHandle + IPC 回推基建,但 **will-download 接入方式与前几个 hook 有本质区别(挂 session 一次,非 per-guest)**。
> **在 `feat/web-downloads` 分支(已由指挥切好),不切新分支,不 merge/push。**

---

## 0. 工作纪律

1. cwd 敏感 Bash 必前缀 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`;Read 绝对路径。
2. memory:`feedback_no_fallback_bandaid_fixes`、`feedback_merge_requires_explicit_ok`(commit 可,merge/push 等显式 OK)、`feedback_main_console_not_in_devtools`(主进程 log 看终端 stdout)。
3. **⚠️ 严禁在源码写字面控制字符(NUL `\0` 等)**(前面踩过把 .ts 写成二进制的坑)。写完可用 `file <路径>` 确认是 "UTF-8 text"。
4. sandbox 拦 npm start → 用户跑(**完全退出重跑**,主进程改动)。typecheck/单测自己跑。命令:typecheck=`npm run typecheck`,test=`npm run test`,lint=`npm run lint`。
5. 做完 typecheck + 自测 + commit → STOP 汇报。

---

## 1. 用户已拍板决策

| 决策 | 选择 |
|---|---|
| 保存位置 | **每次弹系统原生保存对话框**(不调 `item.setSavePath()`,Electron 自动弹) |
| 下载 UI | **轻量条**:文件名 + 进度条 + 可取消;完成后变「在 Finder 显示」;挂 toolbar 下方 |
| 暂停/继续 | 本期**不做**(MVP,后续可加) |

---

## 2. 已查清的架构(调研结论,文件:行号)

### 2.1 ⚠️ 头号架构点:will-download 挂 session 一次,绝不 per-guest

- `will-download` 是 **Session 级事件**(`electron.d.ts:12472`,签名 `(event, item, webContents)`),**不是 webContents 级**。
- 前几个 hook(web-context-menu / web-shortcuts)挂在 **guest webContents** 上,走 `did-attach-webview` per-guest。**下载绝不能照搬**:`persist:webview` 是共享 Session 实例(`session.fromPartition` 对同串返回同一实例),若在 `did-attach-webview` 里对 `guest.session` 挂 will-download → **N 个 webview = 同一下载触发 N 次回调**(重复弹保存框、重复推进度)。
- **正确做法**:`createMainWindow` 后,对 `session.fromPartition(WEBVIEW_PARTITION)` **挂一次** will-download(全局单次)。
- 全项目目前 **0 处 will-download 监听**(extraction 走 console-message、ytdlp 只读 cookies),本 hook 是首个,无重复挂风险。

### 2.2 shouldHandle 过滤(必须,排除 AI webview)

- AI webview 与普通浏览**共用 `persist:webview`**(`capabilities/ai-extraction/Host.tsx:192`),所以 AI 触发的下载也会进本 session 的 will-download 回调。**必须过滤**。
- will-download 回调第三参 `webContents` = 发起下载的 webContents。直接 `shouldHandle(webContents)`([web-shared/should-handle.ts](src/platform/main/web-shared/should-handle.ts))→ `detectAIServiceByUrl` 排除 AI;不命中(普通浏览)才接管。
- 翻译 webview 用独立 partition `persist:webview-translate`,不在本 session,天然不受影响。
- 过滤判定:`if (!shouldHandle(webContents)) return;`(放过,不 preventDefault,让 AI 自己处理)。

### 2.3 现成基建(复用)

- `session.fromPartition(WEBVIEW_PARTITION)`:范式见 [ytdlp/handlers.ts:115](src/platform/main/ytdlp/handlers.ts#L115)。`WEBVIEW_PARTITION` 在 [shared/constants/webview.ts:10](src/shared/constants/webview.ts#L10)。
- 主进程 hook 注册位置:[platform/main/index.ts](src/platform/main/index.ts) `createMainWindow` 后(跟 registerWebContextMenuHook / registerWebShortcutsHook 平级)。
- `app.getPath('downloads')`:范式 [ytdlp/downloader.ts:165](src/platform/main/ytdlp/downloader.ts#L165)(本期用不上——不 setSavePath,但 default 文件名可参考)。
- **保存对话框零成本**:will-download 里**不调 `item.setSavePath()`** → Electron 自动弹系统原生保存框。用户取消 → `item.getSavePath()` 空 / done 事件 state='cancelled' → 不推 UI 或推 cancelled。
- IPC 推送模板:`WEB_VIEW_SHORTCUT`/`WEB_NEW_TAB`([channel-names.ts](src/shared/ipc/channel-names.ts) + [main-window-preload.ts:343](src/platform/main/preload/main-window-preload.ts#L343) onXxx + [electron-api.d.ts](src/shared/ipc/electron-api.d.ts))。
- IPC invoke 模板:`ipcMain.handle`([shell-handler.ts:19](src/platform/main/ipc/shell-handler.ts#L19))。
- **「在 Finder 显示」完全现成**:`window.electronAPI.showItemInFolder(filePath)`([main-window-preload.ts:104](src/platform/main/preload/main-window-preload.ts#L104),main 端 [shell-handler.ts:50](src/platform/main/ipc/shell-handler.ts#L50) 含路径校验)。**0 新增**。

### 2.4 DownloadItem API(electron.d.ts 确认存在,Electron 40)

`getFilename()` / `getReceivedBytes()` / `getTotalBytes()` / `getSavePath()` / `getState()`('progressing'|'completed'|'cancelled'|'interrupted') / `cancel()` / `getURL()` / `getMimeType()`;事件 `on('updated', (e, state))` / `on('done', (e, state))`。
**DownloadItem 对象不能跨 IPC 传** → main 端自增分配 `downloadId` + 维护 `Map<id, DownloadItem>`,IPC 只传 id + 元数据。

### 2.5 下载条 UI 位置

- [WebView.tsx](src/views/web/WebView.tsx) 结构(约 L470-567):`div.krig-web-view` 下 WebTabBar → WebToolbar → zoom-badge → WebFindBar → restart-banner → `div.krig-web-view__hosts`。
- **下载条挂在 restart-banner 同层**(toolbar 下、hosts 上),跟 WebFindBar/restart-banner 一致的横条模式,**跨所有 tab 共享一条**(对齐 Chrome 浏览器级下载栏,不按 tab 分组)。
- 无现成 toast 组件(GlobalProgressOverlay 是全屏阻塞式,不适合)。**新建轻量组件 WebDownloadBar.tsx**,CSS 参考 restart-banner 模式。

---

## 3. 实现方案

### 3.1 主进程下载 hook

新建 `src/platform/main/web-download/handler.ts`,导出 `registerWebDownloadHook(mainWindow)`:

```
import { session } from 'electron';
import { WEBVIEW_PARTITION } from '@shared/constants/webview';
import { shouldHandle } from '../web-shared/should-handle';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';

let nextId = 1;
const active = new Map<number, Electron.DownloadItem>();

export function registerWebDownloadHook(mainWindow) {
  const sess = session.fromPartition(WEBVIEW_PARTITION);
  sess.on('will-download', (_event, item, webContents) => {
    if (!shouldHandle(webContents)) return;   // 排除 AI webview
    // 不调 item.setSavePath() → Electron 自动弹系统保存对话框
    const id = nextId++;
    active.set(id, item);
    const send = (type, extra) => mainWindow.webContents.send(IPC_CHANNELS.WEB_DOWNLOAD_EVENT, {
      type, id, filename: item.getFilename(), ...extra,
    });
    send('started', { total: item.getTotalBytes() });
    item.on('updated', (_e, state) => {
      send('progress', { received: item.getReceivedBytes(), total: item.getTotalBytes(), state });
    });
    item.on('done', (_e, state) => {
      send('done', { state, savePath: state === 'completed' ? item.getSavePath() : '' });
      active.delete(id);
    });
  });
}
```

- invoke handler(取消):`ipcMain.handle(IPC_CHANNELS.WEB_DOWNLOAD_ACTION, (_e, { id, action }) => { const it = active.get(id); if (it && action==='cancel') it.cancel(); })`。放本 hook 或 ipc-bus 注册处,跟现有 ipcMain.handle 模式一致。
- 在 [platform/main/index.ts](src/platform/main/index.ts) createMainWindow 后注册 `registerWebDownloadHook(mainWindow)`。

### 3.2 IPC channel + preload

- [channel-names.ts](src/shared/ipc/channel-names.ts):加 `WEB_DOWNLOAD_EVENT: 'web.download-event'`(main→renderer 推)+ `WEB_DOWNLOAD_ACTION: 'web.download-action'`(invoke)。
- [main-window-preload.ts](src/platform/main/preload/main-window-preload.ts):加 `onWebDownloadEvent(cb): () => void`(照抄 onWebViewShortcut)+ `webDownloadAction(payload): Promise<void>`(照抄 invoke)。
- [electron-api.d.ts](src/shared/ipc/electron-api.d.ts):加两个声明。事件 payload 类型:`{ type:'started'|'progress'|'done', id:number, filename:string, received?:number, total?:number, state?:string, savePath?:string }`。

### 3.3 下载条 UI

新建 `src/views/web/WebDownloadBar.tsx`:
- 组件内 `useState` 维护下载列表 `Map<id, DownloadInfo>` 或数组;`useEffect` 订阅 `window.electronAPI.onWebDownloadEvent`,按 type 更新:
  - `started` → 加一条(filename, total, received=0, status='progressing')
  - `progress` → 更新 received/total
  - `done` → state==='completed' 标完成存 savePath;cancelled/interrupted 标失败(或移除)
- 每条显示:文件名 + 进度(received/total,算百分比;total 未知=0 时显示"下载中…")+ 操作:
  - progressing → 「取消」按钮(调 `webDownloadAction({id, action:'cancel'})`)
  - completed → 「在 Finder 显示」按钮(调 `showItemInFolder(savePath)`)+ 「×」关掉这条
- 列表空 → 不渲染(条不显示)。
- 挂在 [WebView.tsx](src/views/web/WebView.tsx) 的 restart-banner 同层(toolbar 下、hosts 上)。订阅放 WebDownloadBar 内部即可(它常驻渲染,不随 tab 切换卸载——确认它在 WebView 里是否每次 render 都在;若 WebView 卸载会丢订阅,但 web view 通常常驻)。
- CSS 加到 [web.css](src/views/web/web.css),参考 `krig-web-view__restart-banner` 模式(横条、深色、flex)。

---

## 4. 坑清单

1. **will-download 挂 session 一次,不 per-guest**(§2.1)—— 头号坑,照搬 did-attach-webview 会 N 倍触发。
2. **shouldHandle 过滤 AI**(§2.2)—— AI 与普通浏览共用 persist:webview,不过滤会误抓 AI 下载。
3. **严禁字面控制字符**写进源码。
4. **DownloadItem 不跨 IPC** —— 用 id + Map 中转。
5. **getTotalBytes 可能为 0**(未知大小,如 chunked)—— 进度条要处理 total=0(显示"下载中…"不显百分比)。
6. **取消/中断**:done 事件 state 可能是 cancelled/interrupted,UI 别当完成处理(不给"在 Finder 显示")。
7. **savePath 仅 completed 有效**:用户在系统保存框点取消 → 通常触发 done state='cancelled',savePath 空。
8. **多 tab**:下载跨所有 tab 共享一条下载栏(不按 tab 分组),webContents.id 可带但 UI 不必用。

---

## 5. 文件清单

| 文件 | 改动 |
|---|---|
| `src/platform/main/web-download/handler.ts` | **新增** registerWebDownloadHook(will-download 挂 session 一次 + shouldHandle 过滤 + 进度/完成推送 + cancel invoke) |
| `src/platform/main/index.ts` | createMainWindow 后注册 hook |
| `src/shared/ipc/channel-names.ts` | 加 WEB_DOWNLOAD_EVENT + WEB_DOWNLOAD_ACTION |
| `src/platform/main/preload/main-window-preload.ts` + `electron-api.d.ts` | onWebDownloadEvent + webDownloadAction |
| `src/views/web/WebDownloadBar.tsx` | **新增** 下载条 UI |
| `src/views/web/WebView.tsx` | 挂 WebDownloadBar(restart-banner 同层) |
| `src/views/web/web.css` | 下载条样式 |

**复用 0 改**:web-shared/should-handle.ts、shell-handler.ts 的 showItemInFolder。
**不动**:data-model.ts、web-history.ts、其他 hook、drivers。

---

## 6. 不做的事
- ❌ 不调 item.setSavePath()(让 Electron 自动弹保存框)。
- ❌ 不做暂停/继续(MVP)。
- ❌ 不做完整 Chrome 下载管理页(只轻量条)。
- ❌ 不按 tab 分组下载(共享一条栏)。
- ❌ 不写字面控制字符。
- ❌ 不 merge/push。

---

## 7. 验收 + 汇报

commit 前:typecheck PASS / 现有单测无回归(web-history 27 + data-model 18 + omnibox 15) / lint 改动文件 PASS / 所有改动文件 `file` 确认是 UTF-8 text(无 null 字节)。

手动复现(给用户,**完全退出重跑 npm start**):
1. 普通浏览 webview 里点一个下载链接(如某个 .zip/.pdf 直链)→ 弹系统保存对话框 → 选位置 → 下载条出现,显示文件名 + 进度。
2. 下载完成 → 条变「在 Finder 显示」→ 点击 → Finder 高亮该文件。
3. 下载中点「取消」→ 下载停止,条消失/标取消。
4. 在 AI webview(claude.ai 等)里触发下载 → **不被本下载条接管**(走 Chromium 默认,shouldHandle 过滤生效)。

汇报模板:
```
Phase 3 下载(feat/web-downloads)完成:
一、产出(commit hash + 文件数)
二、实现要点(will-download 挂 session 一次 / shouldHandle 过滤 / 保存框自动弹 / 进度推送 / 下载条 UI / showItemInFolder 复用)
三、坑处理(N 倍触发怎么避免、total=0、cancelled 处理)
四、验收(typecheck/单测/lint/file 确认无 null 字节)
五、手动复现步骤(完全退出重跑)
六、范围外/登记
七、等指挥:merge/push?(Phase 3 是最后一个 Phase,做完 web 四阶段全收口)
```

---

## 8. Self-Contained Check
- ✅ 用户 3 决策(保存框每次弹 / 轻量条 / 不做暂停)
- ✅ 头号架构点(挂 session 一次)+ shouldHandle 过滤 + DownloadItem API(§2)
- ✅ hook + IPC + UI 方案 + 代码骨架(§3)
- ✅ 8 坑 + 文件清单(§4-5)
- ✅ 验收 + 汇报(§7)

**外部依赖**:用户完全退出重跑 npm start 验证(下载真实文件);指挥拍板 merge/push。

---

*Phase 3 下载管理 · 2026-06-01 · feat/web-downloads · will-download 挂 session 一次 + shouldHandle 过滤 + 轻量下载条 · 复用 Phase 2/4 基建*
