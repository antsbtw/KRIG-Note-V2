# 交接文档:per-workspace 网络出口(代理)+ Web 设置面板

> **给接手的新对话**:这是一个已经过 spike 验证、所有决策已拍板的大工程的交接包。读这份 + 下面引用的 spike prompt,就能从**阶段1**直接开干,不需要前序对话的上下文。
> 工作目录 **KRIG-Note-V2**(`/Users/wenwu/Documents/VPN-Server/KRIG-Note-V2`)。每条 cwd 敏感 Bash 必 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`,Read 传绝对路径。

---

## 1. 这是什么 / 用户要什么

用户是科学上网重度用户(工作目录 `VPN-Server`,常浏览 BitTorrent/sing-box/z-lib 等)。核心需求:

> **不同的 workspace 走不同的网络出口(代理 / socks5)。** workspace 是严格隔离的网络单元,各配各的出口。

这等价于"浏览器多容器 + 每容器独立代理",对该用户是真实刚需(不是泛泛的"浏览器都有所以要")。

---

## 2. spike 已验证(结论确定,别重新验证)

spike 分支 **`spike/per-ws-proxy`**(commit `f2b856c1`,**保留作参考,不要 merge**)。
spike prompt:[docs/tasks/2026-06-01-spike-per-ws-proxy-prompt.md](./2026-06-01-spike-per-ws-proxy-prompt.md)。

spike 做了最小改动(WebView partition 改 `persist:webview-${workspaceId}` + 临时 setProxy IPC),用户实测回归清单,**结论铁定**:

| 验证项 | 结果 |
|---|---|
| **#2 代理生效** | ✅ socks5 隧道生效 |
| **#3 不同 ws 不同出口** | ✅ **核心目标达成** —— ws1 走大陆隧道、ws2 直连,各自正常互不干扰 |
| **#4 下载** | ❌ **坏** —— 弹了系统保存框但无 NavSide 记录、下载管理失效 |
| **#6 右键菜单** | ❌ **坏** —— 打不开 |
| #5 media 图片 / #7 快捷键 / ytdlp | 预判同样坏(同根因),未逐一实测但确定 |

**spike 的价值:用证据证明了「功能可行且有价值,但 partition per-ws 化会打破一圈绑死单 partition 的主进程钩子」。这正是阶段1 要正向修复的工程量。**

---

## 3. 真因:绑死单 partition 的主进程钩子(阶段1 要改这些)

现有架构把"普通 webview = 唯一的 `persist:webview` session"硬编码进了一圈主进程代码。partition 一旦 per-ws,这些只对旧 partition 生效:

| 钩子 | 文件:行 | 现状 | 改法方向 |
|---|---|---|---|
| 下载 will-download | [web-download/handler.ts:69](src/platform/main/web-download/handler.ts#L69) | `session.fromPartition(WEBVIEW_PARTITION).on('will-download')` 单 session | 改成对每个 ws partition 注册,或 webview attach 时按其 session 动态挂 |
| media:// 协议 | [media-store-impl.ts:386](src/platform/main/media/media-store-impl.ts#L386) | `fromPartition(WEBVIEW_PARTITION).protocol.handle('media')` 单 session | 同上,每个 ws partition 都要注册 media:// |
| shouldHandle(右键/快捷键/弹窗判定) | [web-shared/should-handle.ts](src/platform/main/web-shared/should-handle.ts) | 判定"是否普通浏览"时按 partition 精确比对 / 翻译 session 实例比较 | 改成匹配 `persist:webview-*` 前缀(排除 translate/ai) |
| ytdlp cookie | [ytdlp/handlers.ts:115](src/platform/main/ytdlp/handlers.ts#L115)、[downloader.ts:34](src/platform/main/ytdlp/downloader.ts#L34) | 硬编码 `'persist:webview'` 取 cookies | 按当前 ws partition 取 |

**关键认知**:right-click/快捷键/弹窗导流走 `did-attach-webview` per-guest 挂(不是绑 session),理论上新 guest 仍触发 attach;但 `shouldHandle` 用 partition 判定时把新 partition 判成"非普通浏览"→ 被排除。所以**右键坏的根因在 shouldHandle 的 partition 判定,不在 attach**。

---

## 4. 用户已拍板的全部决策(照此,别重新问)

| 决策点 | 选择 |
|---|---|
| 是否全量做 | **做**(spike 证明值得) |
| 推进方式 | **分阶段,每阶段用户验证**(Phase 4 一口气大改出过白屏,分阶段稳) |
| 代理类型 | **socks5 + http,无认证**(本地 sing-box/clash 监听通常无认证) |
| 代理范围 | workspace 严格隔离 —— 普通浏览 + 翻译 + AI 都走该 ws 出口(翻译/AI partition 也要 per-ws 化,但**可放阶段后期**) |
| 节点管理 | **全局节点列表 + 每 ws 选一个**(节点可复用,改一处生效) |
| Web 设置面板第一版 | **四项**:① 代理(socks5/http,per-ws)② 清除浏览数据(per-ws)③ 默认搜索引擎(全局)④ 默认主页(全局) |
| per-ws vs 全局 | 代理/清数据 **per-ws**;搜索引擎/主页 **全局**;面板标注「本工作区」/「全局」 |
| 登录态副作用 | per-ws partition 会让现有登录态"看不见"(换 partition 目录)。用户**接受**。需考虑迁移(可选"首个 ws 继承旧 persist:webview")或明确告知 |

---

## 5. 三阶段规划

### 阶段1:partition per-ws 化 + 修复回归(地基,最关键)
- WebView partition 改 `persist:webview-${workspaceId}`(spike 已验证可行,[WebView.tsx:572](src/views/web/WebView.tsx#L572) 附近)。
- **修 §3 那一圈钩子**:下载/media/shouldHandle/ytdlp 改成跟随 per-ws partition。
- **验证**:spike 回归清单 11 项全部恢复(下载有记录、右键出菜单、图片显示、快捷键灵)。
- 这阶段**不引入代理 UI**,只把"partition per-ws 化但功能不回归"做扎实。临时验证可沿用 spike 的 console helper 或加临时 setProxy。

### 阶段2:代理数据层 + 正式接入
- 全局代理节点表(socks5://host:port / http://… / direct)+ per-ws 选 proxyId。
- data-model 加 `proxyId`(注意 [data-model.ts](src/views/web/data-model.ts) 的 sourceSignature/hydrate/persist 三处一致,**hydrate cache 稳定引用不变量**,proxyId 是纯持久化字段无随机生成,风险低于 Phase 4 tabs 但必须守住)。
- 正式 setProxy IPC(替换 spike 临时版):ws 创建/切换/改代理时,主进程 `session.fromPartition(per-ws partition).setProxy({proxyRules})`。
- 验证:代理持久化、重启还在、切 ws 出口跟随。

### 阶段3:Web 设置面板 UI
- 入口:用户说"做一个配置界面,未来扩展"。具体入口位置(工具栏图标/NavSide 段/应用菜单)阶段3 时跟用户确认。
- 四项:代理(per-ws)/ 清数据(per-ws)/ 搜索引擎(全局)/ 主页(全局)。
- 搜索引擎全局:现在地址栏搜索写死 Google([WEBVIEW_SEARCH_URL](src/shared/constants/webview.ts) / [omnibox.ts](src/views/web/omnibox.ts)),改成可选。
- 主页全局:现在写死 `WEBVIEW_DEFAULT_URL = google.com`,改成可设。
- 清数据:`session.fromPartition(per-ws).clearStorageData()`。

---

## 6. 必读 memory / 铁律(这工程尤其相关)

- `feedback_merge_requires_explicit_ok` — commit 可,merge/push 等用户显式 OK。
- `feedback_main_console_not_in_devtools` — 主进程 log 在 npm start 终端 stdout。
- `feedback_diag_log_before_speculation` — 跨进程/session 问题先 log 实测。
- **严禁源码写字面控制字符(NUL `\0`)** — 本对话踩过两次把 .ts 写成二进制(sourceSignature 用 \0 分隔符)。写完 `file <路径>` 确认 "UTF-8 text"。
- **useSyncExternalStore 死循环坑** — 改 data-model 加字段,sourceSignature 不能含随机生成值,否则白屏(Phase 4 踩过)。
- `feedback-web-navside-vertical-toggle` — web NavSide 用垂直折叠不用 tab。

---

## 7. 分支状态

- **`feat/per-ws-proxy`**(从 main `4cb11838` 切,当前工作分支,空)— 阶段1 在这上面做。
- **`spike/per-ws-proxy`**(`f2b856c1`)— 探针,保留参考,**不 merge**。
- **main**(`4cb11838` = origin/main)— 含已上线的全部 web 增强(Phase 1-4 + NavSide + 书签 + 下载持久化)。

整个 web 增强的历史 prompt 都在 [docs/tasks/](.) 下(2026-05-31-web-* 和 2026-06-01-web-*),新对话可参考既有套路(实现包格式、subagent 派发方式)。

---

## 8. 新对话第一步

1. 读本交接文档 + spike prompt。
2. 切到 `feat/per-ws-proxy` 分支(已切好)。
3. 开**阶段1**:先调研 §3 那四个钩子的确切改法(grep 每处怎么绑 partition、media:// 协议怎么按 session 注册、shouldHandle 判定逻辑),再写阶段1 实现包派 subagent。
4. 阶段1 做完让用户跑 spike 回归清单验证(11 项恢复),再进阶段2。

**外部依赖**:用户跑 npm start 验证每阶段(sandbox 拦 npm start);用户拍板每阶段 merge/进下一阶段。用户本地代理:socks5 `192.168.1.162:1080`(测试用)。

---

*交接文档 · 2026-06-01 · feat/per-ws-proxy · per-ws 代理 + Web 设置面板 · spike 已验证,分三阶段 · 移交新对话从阶段1 开始*
