# SPIKE:per-workspace 网络出口(代理)回归面验证

> **这是一个 spike(探针),不是功能实现。** 目标:用最小改动验证「partition 从全局 `persist:webview` 改成 per-workspace」会打破哪些现有功能(下载/media/翻译/AI),为"要不要全量做 per-ws 代理"提供决策依据。
> **暴露问题正是 spike 的目的** —— 如果下载失效、图片不显示,那是要发现的结论,不是失败。
> **在 `spike/per-ws-proxy` 分支(已切好)。spike 完可能整个丢弃或重做,所以代码可糙、可加临时 log,不追求生产质量。不 merge/push。**

---

## 0. 工作纪律(spike 特化)

1. cwd 敏感 Bash 必前缀 `cd /Users/wenwu/Documents/VPN-Server/KRIG-Note-V2 && ...`;Read 绝对路径。
2. memory:`feedback_merge_requires_explicit_ok`、`feedback_main_console_not_in_devtools`(主进程 log 终端 stdout)、`feedback_diag_log_before_speculation`。
3. **⚠️ 严禁字面控制字符(NUL)**(踩过)。
4. sandbox 拦 npm start → 用户跑(spike 的核心就是用户跑回归验证)。typecheck 自己跑。
5. **这是 spike**:目标是**最小改动 + 详尽回归清单**,不是把代理功能做完。别做 UI、别做节点管理、别做 data-model 持久化、别做登录态迁移。
6. 做完 STOP 汇报(重点是回归清单 + 让用户跑)。

---

## 1. 用户已拍板

| 项 | 决策 |
|---|---|
| 启动方式 | **先 spike 验回归面**,不全量 |
| 代理类型 | socks5 + http,**无认证**(本地 sing-box/clash 监听通常无认证) |
| 登录态副作用 | 用户**接受**(spike 完切 main 恢复) |

---

## 2. 调研已确认的关键事实

- 普通浏览 partition 写死:[WebView.tsx:572](src/views/web/WebView.tsx#L572) `partition={WEBVIEW_PARTITION}`(常量,跨所有 ws 共用 `persist:webview`)。
- Host **partition-agnostic**:[Host.tsx:55](src/capabilities/web-rendering/Host.tsx#L55) partition 是 props,改 WebView 一行即可 per-ws。
- setProxy 是 session 级:`session.fromPartition(p).setProxy({ proxyRules: 'socks5://host:port' })`(electron.d.ts 确认)。
- **隐藏坑(spike 要验证的核心)**:主进程一圈钩子写死绑 `persist:webview` 单 session,partition per-ws 后这些只对旧 partition 生效:
  - 下载:[web-download/handler.ts:69](src/platform/main/web-download/handler.ts#L69) `session.fromPartition(WEBVIEW_PARTITION).on('will-download')`
  - media:// 协议:[media-store-impl.ts:386](src/platform/main/media/media-store-impl.ts#L386)
  - ytdlp、shouldHandle 等
- AI webview 共用 `persist:webview`([ai-extraction/Host.tsx:192](src/capabilities/ai-extraction/Host.tsx#L192));翻译走独立 `persist:webview-translate`。

---

## 3. spike 要做的(最小两件 + 诊断)

### 3.1 partition 改 per-workspace

[WebView.tsx:572](src/views/web/WebView.tsx#L572)(grep 确认行号):
```tsx
// spike:partition 从全局常量改 per-ws,验证回归面
partition={`persist:webview-${workspaceId}`}
```
- 这是 spike 的核心改动。其它 webview(翻译/AI)**先不动**(观察它们是否受影响)。

### 3.2 临时 setProxy IPC(socks5/http 无认证)

加一个**临时**的 IPC,让用户能给当前 ws 的 partition 设代理验证出口:
- 主进程 handler:`ipcMain.handle('spike.set-proxy', (e, { workspaceId, rules }) => session.fromPartition(`persist:webview-${workspaceId}`).setProxy({ proxyRules: rules }))`。`rules` 形如 `'socks5://127.0.0.1:1080'` 或 `'http://127.0.0.1:8080'`,空字符串/`'direct://'` = 直连。
- preload 暴露 `spikeSetProxy({workspaceId, rules})`(临时,electron-api.d.ts 加临时声明)。
- **不做 UI**:用户在 DevTools console 调 `window.electronAPI.spikeSetProxy({workspaceId:'<id>', rules:'socks5://127.0.0.1:1080'})` 验证即可。**在汇报里给用户准确的 console 调用示例**(包括怎么拿 workspaceId —— grep workspaceManager.getActiveId 或让用户从某处取)。
  - 简化:可以加个临时 `spikeSetProxyActive(rules)` 自动取活跃 ws id,用户只传 rules,更好测。
- 主进程加 log `[spike-proxy] set ws=.. rules=..` 确认调用到。

### 3.3 诊断 log(可选,帮用户看清)

- partition 实际值:WebView mount 时 log `[spike] ws=.. partition=persist:webview-..`,确认每个 ws 拿到不同 partition。

---

## 4. 回归清单(spike 的真正产出 —— 给用户逐项跑)

spike 的价值在这张清单。subagent 在汇报里列出,用户 `npm start`(完全退出重跑)逐项验证,**记录每项 OK / 坏**:

| # | 验证项 | 怎么测 | 关注 |
|---|---|---|---|
| 1 | **多 ws 不同 partition** | 开 2 个 workspace,都切 web view,看 console `[spike]` log partition 不同 | 基础前提 |
| 2 | **代理生效** | console 调 spikeSetProxy 设 socks5 本地代理 → 访问 ipinfo.io / 看 IP 变没变 | 核心功能 |
| 3 | **不同 ws 不同出口** | ws1 设代理 A、ws2 设代理 B(或直连)→ 各自访问 ipinfo.io,IP 不同 | 核心目标 |
| 4 | **⚠️ 下载** | 新 partition 的 web view 里下载文件 → 还能下载吗?NavSide 下载段还显示吗? | **最可能坏** |
| 5 | **⚠️ media 图片** | 网页图片正常显示吗?(media:// 协议可能只绑旧 partition) | **可能坏** |
| 6 | **右键菜单** | 新 partition webview 右键 → 原生菜单还出吗?(shouldHandle 判定) | 可能坏 |
| 7 | **快捷键** | ⌘T/⌘L/⌘F 等还生效吗?(before-input-event 绑 session?) | 可能坏 |
| 8 | **弹窗导流** | target=_blank 还导流进新 tab 吗? | 可能坏 |
| 9 | **翻译双栏** | 翻译还正常吗?(独立 partition,理论不受影响,验证) | 应 OK |
| 10 | **AI webview** | AI 服务(claude.ai 等)还能用吗?(共用旧 partition,验证是否受影响) | 应 OK 但验 |
| 11 | **书签/历史/tab** | 这些功能还正常吗? | 应 OK |

**每项标 OK / 坏 + 现象**,这就是 spike 结论。

---

## 5. 文件清单(spike,尽量少)

| 文件 | 改动 |
|---|---|
| `src/views/web/WebView.tsx` | partition 改 per-ws(1 行)+ 可选诊断 log |
| `src/platform/main/...`(临时 spike handler) | spike.set-proxy IPC handler |
| `src/platform/main/preload/main-window-preload.ts` + `electron-api.d.ts` | spikeSetProxy(临时) |
| `src/shared/ipc/channel-names.ts` | spike channel(临时) |

**不做**:代理 UI、节点管理、data-model 存配置、登录态迁移、AI/翻译 partition 同步、socks5 认证。这些等 spike 结论再说。

---

## 6. 不做的事
- ❌ 不做完整代理功能(UI/持久化/节点管理)。
- ❌ 不改 AI/翻译 partition(观察它们是否受影响)。
- ❌ 不处理登录态迁移(用户接受 spike 期间副作用)。
- ❌ 不追求生产质量(spike 代码可糙、可临时 log)。
- ❌ 不写字面控制字符。
- ❌ 不 merge/push。

---

## 7. 汇报(spike 重点是回归清单)

```
SPIKE per-ws 代理(spike/per-ws-proxy)完成:
一、改动(WebView partition per-ws + 临时 setProxy IPC,commit hash)
二、怎么测代理:console 调用示例(spikeSetProxy 的准确用法 + 怎么拿 ws id)
三、回归清单(§4 11 项)—— 请用户逐项跑,标 OK/坏
四、预判:哪几项最可能坏(下载/media/右键),为什么
五、typecheck 结果
六、等用户跑完回归清单 → 据结果决定:全量做 / 调整方案 / 放弃
```

---

## 8. Self-Contained Check
- ✅ spike 性质(探针,暴露回归是目的)
- ✅ 调研关键事实 + 隐藏坑(§2)
- ✅ 最小改动 2 件 + 诊断(§3)
- ✅ **11 项回归清单(spike 真正产出)**(§4)
- ✅ 不做的事(§6)

**外部依赖**:用户 npm start 逐项跑回归清单(spike 核心);据结果决定全量/调整/放弃。spike 完切 main 恢复登录态。

---

*SPIKE · 2026-06-01 · spike/per-ws-proxy · partition per-ws 回归面验证 · 探针非实现,暴露回归是目的*
