# AI webview 高频 attach/destroy 震荡 — 排查结论（2026-05-31）

> 纯诊断任务。结论用运行时 log 证据支撑。**未改任何业务代码**；仅装了 `[DIAG-TEMP]` 临时探针（6 处，见末尾）。

## TL;DR

1. **webview 反复 attach/destroy 的真实触发源 = Vite dev server 的整页 reload（full page reload）**，不是 React 组件循环、不是 display:none 切换、不是设计上的"一次性提取 webview"。
   - 主窗口 renderer 每发生一次 Vite full reload，Chromium 同刻销毁该页所有 `<webview>` guest（本项目一页固定挂 3 个：ai-view / web-view / translate-view 各一），新页再 attach 3 个全新 guest → `wc#` 每次 reload **+3**。累积就是日志里 `wc#` 一路涨到 19+。
2. **"webview 震荡 → 本地 WS 断连"的因果不成立（已推翻）。** 在我强制触发多轮整页 reload、`wc#` 涨到 #11、7 次 DESTROY 的全过程中，SurrealDB 本地 WS **零断连 / 零重连 / 零 NotAllowed**，全程 `connected`。两者互相独立。
3. SSL handshake -101（CONNECTION_RESET）是 AI webview 连外部站点（claude.ai 等）的网络抖动，**与本地 DB、与 webview 震荡都无直接因果**，是邻居噪声。
4. 因此**断连另有源头**，需要继续追（见"下一步"）。

## 证据：强制复现整页 reload 的完整时间线

`npm start`（dev）起 App，静置稳定后，touch 一个非组件模块（`src/views/ai/data-model.ts`，Vite 无法 HMR 热替 → 触发 full reload）。日志一刀切捕获全链：

```
[main-renderer-nav] did-start-navigation url=http://localhost:5173/   ← 主窗口 renderer 开始重新导航(=reload)
[guest-lifecycle]   DESTROY wc#6 / wc#7 / wc#8                          ← 同一毫秒 3 个 webview guest 全销毁
[renderer-fwd]      [vite] connecting... / [vite] connected.           ← 实锤:这是 Vite full reload
[main-renderer-nav] did-finish-load                                    ← 新页加载完成
[slot-area]         ai-view-pos=hidden left=note-view right=null       ← 新页重新渲染
[guest-lifecycle]   ATTACH wc#9 / wc#10 / wc#11                         ← 3 个全新 guest, wc# +3
```

计数变化：`ATTACH 3→10`、`DESTROY 0→7`、`wc#` 到 `#11`。**每 reload 一次，wc# 稳定 +3。**

WS 探针全程：
```
[surreal-ws] event=connecting → event=connected   （仅启动一次）
disconnect / reconnect / error / NotAllowed 计数 = 0   （含整轮 webview 震荡期间）
```

### 关键鉴别点（为什么能锁定"整页 reload"而非别的）

- 3 个 DESTROY **同一毫秒**触发（如 09:37:10.318/.319/.319）→ 父级 renderer 被整体销毁，不是逐个 webview 各自的 display:none 切换。
- DESTROY 时**没有** `ai-host-render UNMOUNT`、也没有 React re-mount → 不是 React 卸载组件，是 renderer 进程级 teardown（renderer 死掉，它的 console.log 来不及打 UNMOUNT）。
- 紧跟 `did-start-navigation url=http://localhost:5173/` + `[vite] connecting...` → 确认是 Vite 把整页 reload 到 dev server URL。
- CSS 改动（`ai.css` 追加空行）走 HMR 局部热替，**不**触发 reload，**不**销毁 webview（DESTROY=0 验证过）。只有非 HMR-able 模块改动才 full reload。

### 为什么"idle 放着也涨"

- 纯净 idle（无文件改动）我连跑两轮各 ~100s / 60s，**零震荡、零 reload**，系统完全稳定。
- 但 dev 模式下 full reload 不只由"手动改文件"触发。Vite 还会在**首次发现新的需要预构建的依赖（懒加载 chunk）时自动 "new dependencies optimized → full reload"**。本项目 capability / view 大量走懒加载 import，用户在会话里开不同 view / 触发不同 capability 时，Vite 陆续发现新依赖 → 自动整页 reload → 每次 webview +3。
- 我有一轮启动就自发 reload 了一次（3 个 webview 启动后 ~1s 全销毁），就是这种"启动期自动 full reload"。**它是间歇的、时序相关的**，所以不是每次启动都出现，但在真实使用会话里会反复出现 → 累积到 19+。
- 注意:**这是 dev/`npm start` 才有的 Vite 行为。打包后的生产构建没有 dev server、不会 full reload，此现象消失。**

## 回答交付清单

1. **真实触发源**：Vite dev server full page reload（主要由 dev 期依赖再预构建 / 非 HMR-able 改动触发）。代码路径：`main-window.ts` 只 `loadURL(devServerURL)` 一次，reload 由 renderer 内 Vite 客户端发起；SlotArea 扁平列表一页固定 3 个 `<webview>`，整页 reload 时 Chromium 连带销毁全部 guest。**属 dev 环境工具行为，不是 KRIG 业务 bug。**
2. **因果证实/推翻**：**推翻**。webview 震荡期间本地 WS 全程 connected，零断连。时间戳对齐证据见上。
3. **是 bug 还是设计**：webview 反复重建是 dev 工具（Vite full reload）的副作用，不是 KRIG 主动设计的"一次性提取 webview"，也不是 React 渲染循环 bug。生产构建不复现。**不需要为它加业务修复**（若想减少 dev 期 AI webview 重载抖动，可考虑把 AI webview session 状态做持久化/恢复，但这是优化非修 bug）。
4. **断连源头仍未知**：既然 webview 震荡不是断连的因，上一轮观察到的 `NotAllowed`/`global-notes 归零`（已由 `c62c1cf7` 的鉴权重连修复兜住）背后的**真实断连触发**仍需独立排查。

## 下一步（追真实断连源头，需用户复现配合）

本轮干净环境**没有自发断连**，断连可能需要特定条件触发。建议保留 `[surreal-ws]` 探针，让用户在**实际会遇到 NavSide 归零的操作序列**下复现，拿到 `[DIAG-TEMP][surreal-ws] event=disconnect/reconnect` 的时间戳，再对齐当时在做什么（大数据量读写？长时间 idle 后系统休眠唤醒？备份/恢复？切换 workspace？）。候选源头：
- 系统休眠/唤醒导致 WS idle 超时断开（macOS App Nap / 网络栈挂起）。
- 某条重型 query（大 note 读、批量导入）阻塞 WS 心跳触发超时。
- surreal sidecar 进程被孤儿清理逻辑或 OOM 重启。

## `[DIAG-TEMP]` 临时探针清单（确认结论后请清除）

| 文件 | 探针 |
|------|------|
| `src/storage/surreal/client.ts` | `db.subscribe(connecting/connected/reconnecting/disconnected/error)` 时间戳 |
| `src/platform/main/ai/webview-registry.ts` | REGISTER / DESTROYED 时间戳 + URL |
| `src/platform/main/ai/webview-hook.ts` | 每个 guest 的 ATTACH / NAVIGATE / DESTROY 全量生命周期 |
| `src/platform/main/index.ts` | renderer console 转发（`[DIAG-TEMP]`/`[vite]`/reload）+ 主窗口 did-start-navigation/did-finish-load/render-process-gone |
| `src/capabilities/ai-extraction/Host.tsx` | Host MOUNT/UNMOUNT + `<webview>` ref ATTACH-NODE/DETACH-NODE |
| `src/workspace/workspace-instance/slot-area/SlotArea.tsx` | ai-view slot 位置 + slotBinding |

全部以 `[DIAG-TEMP]` 前缀标注，`grep -rn DIAG-TEMP src/` 可一次定位清除。无功能性改动。
