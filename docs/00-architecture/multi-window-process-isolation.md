# 多窗口 · 进程隔离架构（设计中）

> **状态**：🔶 **设计讨论进行中**（2026-07-20 起）。**不开工**。本文是讨论的活载体：
> 讨论一条、收口一条。开放议题标 🔶，已拍板标 ✅，探针待验标 🧪。
> **分支**：`design/multi-window-process-isolation`（设计文档 + 少量探针，不写实现代码）。
> **触发**：从「workspace tab 单渲染进程」迁移到「一窗口一 workspace 多渲染进程」，
> 首要目的是 **进程级故障隔离** —— 底层跑自动化（Gemma4）时，单个执行窗口的崩溃/卡死
> 不拖垮其他窗口。
> **关联**：[[reliability-charter]]（故障必须响/局部/留痕/对账，反静默坍缩——多窗口隔离是同一底座的物理化）。

---

## 零、目标架构（当前共识）

```
┌─────────────────────────────────────────────────────────┐
│  底层 · 主进程（跨所有 windows，单一实例）                  │
│    · SurrealDB sidecar   ← 唯一数据源，共一个 rocksdb 文件  │
│    · Gemma4 Orchestrator ← 指挥者，指挥各 window 协同做事    │
│    · 事务重试 / OCC 协调                                   │
└───────────────┬─────────────────────────────────────────┘
                │ IPC（双向）
   ┌────────────┼────────────┬───────────────┐
   ▼            ▼            ▼               ▼
Window(ws-A) Window(ws-B) Window(ws-C)   ...
 renderer     renderer     renderer       每窗口独立 renderer 进程
 自治操作      自治操作      自治操作        崩溃互不影响
 本 ws         本 ws         本 ws         window 之间不横向通信
```

**已确认的分层原则**
- ✅ **DB / Gemma4 是底层**，跨所有 windows，主进程单实例。
- ✅ **一窗口 = 一 workspace**（纯净）。彻底移除 workspace tab 栏。
- ✅ **window 内自治**：每个 window 只操作自己那个 workspace。
- ✅ **Gemma 是指挥者**：跨 window 的协同 **经由 Gemma 中枢**，window 之间不横向通信
  （横向通信会破坏隔离）。
- ✅ **Gemma 只指挥 window，不直写 DB**：Gemma 从不碰数据，只发指令；**window 是唯一执行者
  兼唯一 DB 写入者**。→ 每次 DB 变更都可追溯到「哪个 window 在哪个 ws 上做的」，天然契合
  [[reliability-charter]] 的留痕/对账。
- ✅ **底层 DB 共一个文件、共用持久化存储内容**；视图状态持久化是 **每窗口 / 每实例** 新建。

**架构现状（已核实，多窗口的地基已就绪 ~70%）**
- ✅ SurrealDB 已是 **sidecar 独立进程**（`surreal start rocksdb://`，主进程经 `ws://127.0.0.1:8533` 连），
  渲染层从不碰 DB，全走 IPC → 「共享 DB」天然成立，无需抽取。
- ✅ Auth/billing 已是 **主进程单例**，`AUTH_CHANGED` 广播到所有 renderer → 多窗口天然共享。
- ✅ webview partition 已 `persist:webview-${wsId}` 隔离 → 与窗口数无关。
- ✅ 广播已用 `BrowserWindow.getAllWindows().send(...)` → 天然对所有窗口生效（待加 ws 过滤）。

---

## 一、窗口 ↔ workspace 生命周期

### 1.1 ✅ 已定
- 一窗口一 ws。关闭窗口 **按 VSCode 方式**：只关自己这个 window，**除非选择退出 app**。

### 1.2 🔶 待议
- 关 window 时，ws **数据/webview session 如何留存**以便重开？（沿用现有 `close` 不删数据、
  移进 NavSide library 的语义，还是纯多窗口下换新模型？）
- **最后一个 window 关掉** → app 退出，还是留后台？（macOS 惯例 vs Windows 惯例，本 app 要 Windows 打包）
- **重开一个已关的 ws** 从哪进入？（无 tab 栏后的入口：File 菜单 / NavSide library / 最近列表）
- 新窗口创建：`createMainWindow()` → `createWindow(workspaceId?)`。新窗口 = 新实例 + 新视图状态持久化。

---

## 二、Gemma 指挥模型（头号议题）

### 2.1 ✅ 已定
- Gemma 住底层（主进程），是 **指挥者**，通过 IPC 指挥各 window 在其 ws 上执行操作。
- **Gemma 只指挥、不直写 DB**：window 是唯一执行者兼唯一写入者（见 §零）。

### 2.2 🔶 待议 —— 无窗口 ws 的指挥路径
- 推论（由「只指挥 window」必然导出）：**要操作的 ws 必须先有窗口**（否则无执行者）。
  - (a) **Gemma 先开后台执行窗口**：需要时自动开一个该 ws 的窗口（可隐藏/最小化作后台执行器），
    完事再决定留不留。Gemma 能自主编排任意 ws，不受用户当前开了哪些窗口限制。
    代价：多一类「后台窗口」生命周期要管。
  - (b) **只能指挥已开窗口**：没开的 ws Gemma 管不了（或请求用户先开）。模型最简、无隐藏窗口，
    但 Gemma 编排能力受用户当前窗口布局限制。
  - → 先不定，待讨论 Gemma 未来形态后拍。

### 2.3 🔶 前置必答 —— 执行者崩溃的对账（不可延到实施期）
- **反向张力**：多窗口保护了「别的 window 不被牵连」，但 **没保护「Gemma 交给某 window 的那批活本身」**——
  那批活的可靠性完全押在那一个 window 的存活上。
- 若 Gemma 正指挥 ws-B 的 window 做一长串操作、window 中途崩溃 → **编排断在半路**。
  若无感知/对账，Gemma 会「以为发出去就成了」→ **静默坍缩 / 谎报成功**，正是 [[reliability-charter]] 要防的。
- 待定：window 执行的 **确认回执 / 心跳 / 超时**；崩溃后 Gemma 的 **重开→重试 or 上报** 策略；
  一批操作的 **幂等/断点续做** 语义。

### 2.4 🔶 待议
- window 之间不横向通信 ✅ —— 需确认：「本 window 内 view 协作」是否也 **尽量限制在本 window 内**？
  （你倾向如此，待定死）

---

## 三、底层 → window 数据同步

### 3.1 🔶 待议
- 现状 `getAllWindows().send(全量 note list)` —— 多窗口下要不要 **按 wsId 过滤**，只推给关心该 ws 的窗口？
- Gemma 改了 ws-B 的数据，ws-B 的 window 如何 **被动刷新**（订阅粒度：按 ws？按 note？）

---

## 四、持久化归属

### 4.1 ✅ 已定
- 底层 DB 共一个文件、共用持久化内容。
- 视图状态（每窗口/每实例）**新建独立持久化**。

### 4.2 🔶 待议
- 现状 workspace 状态 = localStorage 单 blob `krig-v2-workspace-state`（含所有 ws + activeId）。
  多窗口下 **last-write-wins 互相覆盖**。
  - 搬去 SurrealDB（memory 里本有此决定）？还是每窗口作用域 key？
  - 「哪些 ws 有开着的窗口 + 每窗口是哪个 ws」的映射存哪？谁是真源（主进程 or DB）？

---

## 五、OCC / 事务重试（前置必修）

### 5.1 ✅ 已定（探针实测，2026-07-20）
- 🧪 **探针结论**：2 writer（各独立连接、各自串行）并发写同一记录 ×200，实测：
  | | 成功率 | Resource busy | 最大重试深度 | 耗时 |
  |---|---|---|---|---|
  | 无重试（现状） | 95.5% | **18 次冲突（4.5% 写丢弃）** | — | 48ms |
  | 指数退避重试 | **100%** | 0 | **仅 1** | 91ms |
- **定案**：不需要重方案（写串行化队列 / 单写入者都**不必**）。
  **在 IPC handler 写路径包一层指数退避重试即可** —— 收敛 100%、最大只重试 1 次、耗时几乎不增。
- **多窗口放大效应被证为「可控」**：并发写冲突真实存在（无重试丢 4.5%），朴素退避即压平；
  Gemma 高频写叠加也在同一机制覆盖内。
- 关联 memory：note.update OCC 冲突（原标「先不修，架构统观」）→ 本案给出轻量解，可随多窗口一并落地。
- 落点：`storage.ts:532` 现明说「OCC 不在本 sub-phase 处理」→ 改为写路径统一包重试。
- （探针脚本一次性，已验完即删。）

---

## 六、渲染层单例（轻问题，记一笔）

- navSide / capability / keymap registry 是 renderer 全局单例，多 renderer 各自重跑注册。
- 同进程内幂等即可（`if (已注册) return` 守卫）。低风险，实施期处理。

---

## 七、Change 1：垂直服务切换 rail（独立排期）

- ✅ 认可：与本案无强依赖。可夹在「删 tab 栏、动 shell 布局」那步一起做，或完全独立排期。
- 视觉草案（icon-only vs icon+label）待选。

---

## 八、探针清单（🧪 用真实数据验，验完即删）

1. **崩溃隔离** — ✅ **读代码已结论，不必单独跑**。
   `main-window.ts` 的 `webPreferences` 为标准配置（`contextIsolation:true` / `nodeIntegration:false` /
   **无 `affinity`**）→ 每 BrowserWindow 独立 renderer 进程，A 崩 B 活是 Chromium 默认保证，本 app 未破坏。
   真正风险不在「隔离成不成立」，而在 §6.x 三个单窗口写死点（见下）。
2. **并发写 OCC** — 🧪 **仍需真跑**（并发冲突形态读代码看不出）。
   双 renderer 并发高频写同一 sidecar，观察 `Transaction conflict: Resource busy` 频率与形态。→ 定 §五 重试策略。

### 侦察发现（读 `src/platform/main/window/main-window.ts`）
- **隐患 A**：`mainWindow` 是**模块级单例**（L19/98/108），`createMainWindow` 每次覆写、`getMainWindow` 只返回
  最后一个、`closed` 里 `mainWindow=null` 会误清别的窗口。→ 多窗口第一改：单例 → **窗口注册表**
  `Map<windowId, {win, wsId}>`。「新窗口建新实例」落到窗口层就是这个。
- **隐患 B（好消息）**：`X_OPEN_TWEET_REQUEST` 用 `win.webContents.send`（L67-69）**已正确定向到发起窗口**，
  非全量扇出。→ 确认 §3 广播是「**逐 channel 审发给谁**」，不是一刀切；note 全量广播才需加 ws 过滤。
- **隐患 C（好消息）**：`will-attach-webview`（L47）挂在 `win.webContents` 上，**每窗口各挂一份** →
  webview 安全配置多窗口下天然每窗口生效，无碍。

---

## 九、开放决策清单（收口追踪）

| # | 议题 | 状态 |
|---|------|------|
| 1.2 | 关窗留存 / 最后窗口 / 重开入口 | 🔶 |
| 2.2 | 无窗口 ws 的指挥路径（a 后台窗口 / b 只指挥已开） | 🔶 |
| 2.3 | 执行者崩溃的对账/回执/重试 | 🔶 **前置必答** |
| 2.4 | window 内 view 协作是否限本窗口 | 🔶 |
| 3.1 | 广播按 ws 过滤 + 被动刷新粒度 | 🔶 |
| 4.2 | workspace 状态搬 DB or 窗口 key；映射真源 | 🔶 |
| 5.1 | OCC 重试 | ✅ 探针定案：IPC 写路径包退避重试 |
