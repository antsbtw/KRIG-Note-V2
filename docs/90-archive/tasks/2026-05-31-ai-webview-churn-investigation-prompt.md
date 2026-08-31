# 排查任务：AI webview 高频 attach/destroy 震荡（疑似 SurrealDB WS 断连源头）

## 背景（这是一个纯诊断任务，先不要改代码）

工作目录是 **KRIG-Note-V2**（`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`）。
每个 cwd 敏感命令（git/npm/grep/find）都要 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 &&`，Read 工具一律传绝对路径。V2 是当前开发仓库，V1 仅作参考。

上一轮已修复一个**结果性** bug 并合 main + push（commit `c62c1cf7`，分支 `fix/surreal-reconnect-auth`）：
- 现象：本地 SurrealDB WebSocket（`ws://127.0.0.1:8533/rpc`，明文，非 TLS）断连后 SDK 自动重连，但重连后建立的是匿名会话，原 `connectDB` 只在初始化时一次性 `signin()`/`use()`，不会在重连后重放 → 所有读 RPC（`note.list`/`note.get`/`thought.list`/`folder.list`/`ebook.bookshelf-open` 等）报 `NotAllowedError: Anonymous access not allowed`（code -32002, kind: 'Auth'），NavSide `global-notes` 归零。
- 修法：把鉴权 + ns/db 移进 `db.connect(url, { authentication, namespace, database })`，SDK 会在每次重连时自动复用凭据。见 `src/storage/surreal/client.ts` 的 `connectDB`。

**这轮要查的是「断连源头」——为什么那条本地 WS 会断。** 鉴权修复让系统对断连有韧性，但没消除断连本身。每断一次仍会有短暂数据读取失败窗口，是稳定性 + 性能隐患。

## 日志里的两条线索

运行时日志中反复出现：

1. AI webview 连号递增、频繁 attach 后立即 destroy：
   ```
   [Extraction] did-attach-webview, guest id= 5/6/7...19+
   [ai-webview-hook] did-attach-webview, guest id= ...
   [ai-webview-registry] active claude webview = wc#7
   [SSECapture] Fetch hook installed for claude
   [SSECapture] Artifact postMessage hook installed for Claude
   [ai-webview-registry] claude webview wc#7 destroyed, cleared
   ```
   `wc#` 一路涨到 19+，每个 webContents 挂上拦截钩子后很快又 destroyed。明显有东西在反复创建/销毁 AI webview。

2. 夹杂 TLS 握手失败（**注意：这不是数据库连接**，本地 DB 是明文 ws，这条来自 AI webview 连外部站点）：
   ```
   ERROR:net/socket/ssl_client_socket_impl.cc:916] handshake failed; returned -1, SSL error code 1, net_error -101
   ```
   net_error -101 = CONNECTION_RESET。

## 上一轮的因果推断（待你证实或推翻）

> AI webview 反复 attach/destroy 造成进程内资源震荡 / 主进程繁忙 → 本地 WS 在某时刻被带断或超时 → SDK 重连 → （修复前）丢鉴权 → 全线 NotAllowed。
> SSL 报错是同期 AI webview 自己的网络抖动，是邻居噪声，不是 DB 断连的直接原因。

这是推断，**没有证实**。你的任务是查清真相，不要预设结论。

## 起点锚点（已 grep 确认存在）

- `src/platform/main/ai/webview-registry.ts` — 主进程 webview 注册表；`registerActiveWebview` / `wc.once('destroyed', ...)`（约 L34/L37/L41 打那几条日志）；per-serviceId 单例，"最后 navigate 的胜出"策略。
- `src/platform/main/ai/webview-hook.ts` — `[ai-webview-hook] did-attach-webview` 来源。
- `src/platform/main/extraction/handlers.ts` — `[Extraction] did-attach-webview` 来源。
- `src/platform/main/index.ts` — main window 的 `did-attach-webview` 钩子注册处。
- `src/platform/main/ai/inject-scripts/sse-capture.ts` — `[SSECapture]` 注入。
- `src/views/ai/AIView.tsx` / `src/views/ai/AIToolbar.tsx` — React 侧 `<webview>` 宿主组件（渲染进程）。

## 建议排查方向（自行取舍，先 log 再下结论）

记住项目铁律 `[[feedback_diag_log_before_speculation]]`：跨模块"A 影响 B"类先加 log 复现再说，别只读代码猜。同样 `[[feedback_no_fallback_bandaid_fixes]]`：先定位真因，别加兜底绕过。

1. **谁在创建/销毁 webview**：定位渲染进程 `<webview>` 宿主组件（AIView.tsx）的挂载/卸载触发条件。是不是某个 React 组件在 re-render 循环里反复 mount/unmount webview？是否每次 extraction 都新建一个一次性 webview 然后销毁（设计如此 vs bug）？区分"正常的一次性提取 webview"和"异常的反复重建"。
2. **attach/destroy 是否成对、节奏多快**：在 registry 的 register 和 `destroyed` 回调里加带时间戳的 log，跑一次复现，看 wc# 创建销毁的频率和触发动作（是 idle 时也在涨，还是只在某操作时？）。
3. **本地 WS 断连是否与 webview 震荡时间相关**：在 `src/storage/surreal/client.ts` 给 SDK 连接事件加观测——surrealdb 2.0.3 的 `db.subscribe('disconnected'|'reconnecting'|'connected', ...)`（见 `node_modules/surrealdb/dist/surrealdb.d.ts` ConnectionEvents / SurrealEvents，约 L3271/L3880/L3904）。打出每次 disconnect/reconnect 的时间戳，和 webview destroy 的时间戳对齐，**证实或推翻**"webview 震荡导致 WS 断"这一因果。
4. **main vs renderer console**：记住 `[[feedback_main_console_not_in_devtools]]`——main 进程 log 在 `npm start` 终端 stdout，不在 DevTools；这些 `[ai-webview-*]`/`[Extraction]`/`[storage/surreal]` 全是 main 端，要看终端。复杂诊断 main + renderer 两端都加探针。
5. **SSL -101 的来源**：确认它确实来自 AI webview 外部站点而非别处；如果与 DB 断连无关，明确排除，避免误导。

## 复现方式

`npm start` 起 App。从日志看 webview 震荡在启动后/打开 AI view 时就会发生，不一定要特定操作；先静置观察 idle 时 wc# 是否仍在涨，再叠加打开/切换 AI view、触发一次 AI 提取等操作分别观察。注意性能复测/观察要在干净初始态下（`[[feedback_perf_remeasure_must_clean_baseline]]`）。

## 交付

1. 用 log 证据说清：webview 反复 attach/destroy 的**真实触发源**（哪个组件/哪条代码路径、是 bug 还是设计）。
2. 证实或推翻"webview 震荡 → 本地 WS 断连"的因果（时间戳对齐证据）。
3. 如果是 bug，定位根因后给修复方案（先方案，**改代码/commit/merge/push 都要等用户显式确认**——`[[feedback_merge_requires_explicit_ok]]`，commit ≠ commit+merge）。
4. 如果反复创建是设计如此（一次性提取 webview），说明它和 DB 断连是否真的相关；若不相关，则断连另有源头，继续追。

诊断阶段不要动代码（加临时观测 log 可以，但要标注是临时探针）。
