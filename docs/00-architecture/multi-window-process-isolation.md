# 多窗口 · 进程隔离架构（设计中）

> **状态**：🔶 **设计讨论进行中**（2026-07-20 起）。**不开工**。本文是讨论的活载体：
> 讨论一条、收口一条。开放议题标 🔶，已拍板标 ✅，探针待验标 🧪。
> **分支**：`design/multi-window-process-isolation`（设计文档 + 少量探针，不写实现代码）。
> **触发**：从「workspace tab 单渲染进程」迁移到「一窗口一 workspace 多渲染进程」，
> 首要目的是 **进程级故障隔离** —— 底层跑自动化（Gemma4）时，单个执行窗口的崩溃/卡死
> 不拖垮其他窗口。
> **关联**：[[reliability-charter]]（故障必须响/局部/留痕/对账，反静默坍缩——多窗口隔离是同一底座的物理化）。
>
> **🧭 讨论准绳（2026-07-20 用户校正）**：**先做好框架，最后才是具体业务。**
> 多窗口进程隔离是**框架**；Gemma 是将来跑在框架之上的**第一个业务**。框架的正确性
> **不得依赖 Gemma 的形态**（Gemma 尚是设计 v0.3，未实现）。凡是「Gemma 指令怎么对账/
> 超时/重试」这类，属**业务层**，不在本框架文档解决，留待 Gemma 立项时在框架之上处理。
> 框架层只保证一条朴素事实：**任一 window（renderer）崩溃，其他 window + 主进程 + DB 不受影响**——
> 与「谁在指挥它、指挥它干嘛」无关。
>
> **🌟 终局愿景（2026-07-21 用户点破）**：**多窗口是「多终端 B/S 架构」的本机预演。**
> 本设计的北极星不是「多开几个窗口」，而是**为个人知识管理搭 B/S 底座**。多窗口(单机)与
> 多终端(真 B/S)在架构上**同构**——只是把「进程间 IPC」换成「设备间网络」：
> `main 进程→云端 Server`、`DB sidecar→云端 DB`、`Window(renderer)→物理设备(笔电/台式/手机/浏览器)`、
> `IPC 同步→网络同步`、`每窗本地缓存→每终端本地缓存(离线可用)`。
> 所以本轮为多窗口做的决定（DB/Gemma 进程隔离、每窗本地缓存、否决 CRDT 走按角色分治同步、
> 楼长/房客劈开、live query 推送）**全是为 B/S 终局铺路**，彼此自洽非巧合。
> **切分**：多窗口解决**架构层**的 B/S 问题(隔离/缓存/同步协议/冲突处理)；留给多终端的是
> **传输层**问题(网络可靠性/离线队列/断线重连/鉴权)——后者是成熟领域，接口已在 §13「按角色分治」预留。

---

## 零、目标架构（当前共识）

```
┌───────────────────────────────────────────────────────────────┐
│  main 进程（瘦 · 单实例 · 特权中枢）                              │
│    职责仅：窗口生命周期 + IPC broker + 唯一真源协调               │
│    = 对标 Chrome browser 进程 / VSCode main                      │
│  ┌──────────────────┐  ┌───────────────────┐  ┌──────────────┐  │
│  │ SurrealDB sidecar│  │ 同步协调器 ★§13    │  │ Gemma        │  │
│  │ 唯一数据源 Server │←→│ live query 推变更 / │  │ utilityProc  │  │
│  │ 共一 rocksdb 文件 │  │ 先拉后改仲裁 /     │  │ ★拎出 main    │  │
│  │ (独立进程)        │  │ 多人副本裁决        │  │ 易崩自动化    │  │
│  └──────────────────┘  └─────────┬─────────┘  └──────────────┘  │
│    = 对标 VSCode extension host / shared process(皆 utilityProcess)│
└───────────────┬─────────────────┼───────────────────────────────┘
       IPC(双向) │      同步 IPC:拉最新↓ / 推变更↑
   ┌────────────┼─────────────────┼──────────┬───────────────┐
   ▼            ▼                 ▼          ▼               ▼
┌──────────┐ ┌──────────┐    ┌──────────┐
│Window ws-A│ │Window ws-B│    │Window ws-C│   每窗口独立 renderer 进程
│ renderer  │ │ renderer  │    │ renderer  │   崩溃互不影响(Chromium 默认)
│ 自治·本ws │ │ 自治·本ws │    │ 自治·本ws │   window 间不横向通信,经 main
│┌────────┐│ │┌────────┐│    │┌────────┐│
││本地缓存 ││ ││本地缓存 ││    ││本地缓存 ││   ★§13 每窗一份 ws 副本:
││ws副本   ││ ││ws副本   ││    ││ws副本   ││   DB 抖/挂时读缓存不白屏
│└────────┘│ │└────────┘│    │└────────┘│
└──────────┘ └──────────┘    └──────────┘
```

> **⚠️ 关键修正（2026-07-21，VSCode/Chrome 对标后）**：Gemma **不能塞进 main 进程**。
> 若 Gemma（易崩的自动化）与窗口协调同住 main，**Gemma 崩 = main 崩 = 所有窗口全挂** ——
> 正好毁掉做多窗口的初衷（隔离 Gemma 崩溃）。故 Gemma 拎出 main、住独立 **utilityProcess**
> （DB sidecar 早已是独立进程，天生正确）。详见 §十对标。

**已确认的分层原则**
- ✅ **DB / Gemma4 是底层**，跨所有 windows；但**各住独立进程**，不塞进 main：
  main 进程要**瘦**（只做窗口协调 + IPC broker + 真源协调），DB sidecar 独立、
  Gemma 走 **utilityProcess**。← VSCode/Chrome 对标结论，见 §十。
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

### 1.2 关窗生命周期

**✅ 已定 —— 关窗默认语义 = 归档留存（复用现有 `close`）**
- 关 window = 现有 `close(id)`：`isOpen=false`，**ws 数据 + webview session（`persist:webview-${wsId}`
  登录态）+ 视图状态全留**，移进 NavSide library，可重开原样恢复。→ VSCode 式随手关不丢东西。
- 彻底删 ws 需用户明确另执行 `remove(id)`（真删 + dispose bus）。
- 价值：几乎零新增，把现有「关 tab」语义平移到「关窗口」。close/remove 两套语义现成。

**✅ 已定 —— 最后一个窗口关掉 = 跟随平台惯例**
- **macOS**：关光所有窗口 app **不退**，留 dock，点图标可重开（VSCode/Finder 惯例）。
- **Windows**：关最后一个窗口 = **退出 app**（VSCode-Win 惯例；本 app 正做 Windows 打包）。
- 实现：Electron `window-all-closed` 里 `if (process.platform !== 'darwin') app.quit()` —— 标准模板。

**✅ 已定 —— 开窗/重开 ws 入口（三者并存）**
- **File 菜单 → New Window**：开一个新 ws 窗口（VSCode 式，跨平台标准入口，「开新」）。
- **NavSide library**：已归档（`close` 掉）的 ws 列在此，点一个重开成窗口（「重开旧」，天然位置）。
- **最近列表 Recent**：最近用过的 ws 快速重开（锦上添花，可作后续增量）。

**✅ 已定 —— 新窗口创建**
- `createMainWindow()` → `createWindow(workspaceId?)`。新窗口 = 新实例 + 新视图状态持久化
  （视图状态持久化真源见 §四）。

---

## 二、进程隔离保证（框架层核心，与业务无关）

### 2.1 ✅ 已证 —— 框架只保证这一条
- **任一 window（renderer 进程）崩溃/卡死 → 其他 window + 主进程 + DB 不受影响。**
  这是纯进程隔离属性，**与「谁在指挥它、指挥它干嘛」无关**（用户手滑点崩 vs 某业务跑崩，保证一样）。
- 已证（读 `main-window.ts`）：`webPreferences` 标准配置、**无 `affinity`** → 每 BrowserWindow 独立
  renderer 进程，A 崩 B 活是 Chromium 默认保证，本 app 未破坏。主进程可经 `render-process-gone`
  确定性感知某 renderer 崩溃。
- **框架层到此为止**：崩溃「被隔离」+「主进程能感知」就够了。崩溃之后要不要重启窗口、
  要不要对账某个任务，那是**业务层**的事（见 §二·附）。

### 2.2 ✅ 已定 —— window 边界
- 一窗口一 ws；window 间**不横向通信**；跨 window 协同（若某业务需要）经底层中枢，不在 window 之间直连。
- window 是唯一 DB 写入者（所有写过 OCC-重试的 IPC 写路径，见 §五）。

### 二·附　业务层议题（⏸ 暂缓，不在框架文档解决）

> 用户校正：**先做好框架，最后才是具体业务**。以下均属 Gemma（业务，设计 v0.3 未实现）
> 跑在框架之上后自己要解决的可靠性/编排问题，**移出本框架讨论**，留待 Gemma 立项：
>
> - **Gemma 指挥模型**：Gemma 住底层当指挥者、只指挥 window 不直写 DB（方向已倾向，但属业务契约）。
> - **无窗口 ws 的指挥路径**：Gemma 先开后台窗口 vs 只指挥已开窗口。
> - **执行者崩溃的任务级对账**：Gemma 交给某 window 的一批活，window 半路崩 → 编排断在半路的
>   感知/回执/超时/重试/断点续做。← 框架已保证「崩溃被隔离+主进程能感知」，**任务怎么续**是业务层。
>
> 框架层不为这些做设计；框架只须**不阻碍**业务将来实现它们（如：主进程崩溃事件对业务可见、
> IPC 可定向到具体 window）。

---

## 三、底层 → window 数据同步

### 3.1 ✅ 已定 —— 定原则，细节留实现期

**原则**：广播默认**全量正确**、**按 wsId 过滤留作实现期逐 channel 优化**。
- 现状 `getAllWindows().send(全量)` **功能上正确**（每窗口收到后客户端过滤显示自己那份），
  只是**低效**（跨 ws 无谓推送），是**优化项非正确性议题** → 不阻塞多窗口落地。
- 过滤不是统一改动：§六隐患 B 已证广播要**逐 channel 审**（`X_OPEN_TWEET` 已正确定向、
  note 是全量）→ 这种细活对着代码逐 channel 做，不适合现在纸上设计死。
- 刷新契约：**任何**写入者（别窗口的用户 / 将来某业务）改了某 ws 数据，该 ws 窗口须能被动刷新；
  订阅粒度（按 ws / 按 note）实现期定。与写入者是不是 Gemma 无关。

---

## 四、持久化归属

### 4.1 ✅ 已定
- 底层 DB 共一个文件、共用持久化内容。
- 视图状态（每窗口/每实例）**新建独立持久化**。

### 4.2 ✅ 已定 —— 状态拆两类，各归其位（方案 B / B1）

**根因**：现状 workspace 状态 = localStorage 单 blob `krig-v2-workspace-state`（含所有 ws + activeId +
counter）。多窗口下**互相覆盖**——因为 **localStorage 按 origin 隔离、不按窗口**：多窗口加载同一
`index.html` = 同 origin = **共享同一份 localStorage**，都往同一个键写 → last-write-wins。

**拆分**：
| 类别 | 例子 | 归属 | 存法 |
|------|------|------|------|
| **私有视图状态** | 该窗口打开哪篇 note、滚动位置、navSide 宽度、分栏比例 | 本窗口 | **localStorage，key 按 wsId 分**（`viewstate-${wsId}`） |
| **全局 ws 注册表** | 有哪些 ws / label / 归档态(isOpen) / counter | 跨所有窗口 | **搬进 SurrealDB，单一真源** |

**B1 私有隔离原理**：localStorage 抽屉共享无法拆，但**键名带 wsId** 即可——因一窗口一 ws，
`wsId` 就是窗口身份，`viewstate-ws-1` / `viewstate-ws-2` 各写各键，**逻辑隔离、永不互盖**。
呼应 [[ws-instance-isolation-invariant]] 用 wsId 做隔离键。全局大 blob 从 localStorage **移走进 DB**，
本地不再有会被互盖的东西。

**「哪些 ws 有窗口开着 + 每窗口是哪个 ws」的映射**：真源在**主进程窗口注册表**
`Map<windowId, {win, wsId}>`（运行态，见 §六隐患 A）；持久的「有哪些 ws / 归档态」在 DB。
两者职责分开：主进程管「当前谁开着」（运行态，不持久），DB 管「存在哪些 ws」（持久真源）。

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

**框架层议题**（本文档要收口的）：

| # | 议题 | 状态 |
|---|------|------|
| 2.1 | 进程隔离保证（崩溃被隔离 + 主进程可感知） | ✅ 读代码已证 |
| 2.2 | window 边界（一窗口一 ws / 不横向通信 / 唯一写入者） | ✅ |
| 1.2 | 关窗生命周期（关窗=归档 / 平台惯例退出 / 三入口） | ✅ 已定 |
| 3.1 | 广播过滤（定原则：全量正确 / 过滤留实现期逐 channel） | ✅ 已定 |
| 4.2 | 持久化真源（私有→localStorage按wsId键 / 注册表→DB） | ✅ 已定（B1） |
| 5.1 | OCC 重试 | ✅ 探针定案：IPC 写路径包退避重试 |

**业务层议题**（⏸ 移出框架，留待 Gemma 立项，见 §二·附）：Gemma 指挥模型 / 无窗口 ws 指挥路径 /
执行者崩溃的任务级对账。框架只须不阻碍其将来实现。

---

## 十、对标 VSCode / Chrome（2026-07-21 研究，引证一手文档）

**结论：本框架 = Chrome / Electron / VSCode 共享的黄金模式**——**一个中央特权进程（唯一真源+特权操作）
+ 多个隔离的可崩 renderer**。方向已被一手文档印证；并据此对架构图做了一处关键修正（Gemma 拎出 main）。

### 10.1 三产品进程模型（引证）

| | 中央特权（单） | 隔离执行（多） | 隔离粒度 | 崩溃隔离 |
|---|---|---|---|---|
| **Chrome** | browser 进程（网络/cookie/GPU/磁盘，renderer 无权直碰） | renderer | **per-site**（scheme+eTLD+1）| 崩→「Aw Snap」单块，browser+他 tab 活 |
| **VSCode** | main（瘦，只管窗口）+ **shared process** | renderer + **extension host** | **per-window** | 扩展崩→只该窗口 ext-host，UI 存活可重启 |
| **本 app** | main（瘦）+ DB sidecar + Gemma utilityProcess | window renderer | **per-window**（一窗口一 ws） | window 崩→只它，main+他窗+DB 活 |

- 三者皆**单实例**（single-instance lock；Chrome 每 profile 一个 browser、VSCode/Electron 一个 main）。
- **本 app 隔离粒度 = VSCode（per-window）**，非 Chrome（per-site）→ **抄 VSCode 骨架**，Chrome per-site 对本 app 是过度设计。

### 10.2 Gemma 必须住独立 utilityProcess（架构图已改）

- **Electron 官方**：`utilityProcess` 就是用来 host「untrusted services, **CPU intensive tasks or crash prone
  components**」——Gemma 自动化正是此类，官方指定，非臆断。
- **VSCode 双范本**：shared process 与 extension host **都已迁进 utilityProcess**；扩展崩只死该窗口
  ext-host、弹「Restart Extension Host」、**UI 存活且重启保留状态** = Gemma 该有的模型。
- **反面教训（VSCode issue #79782）**：一个 ext-host 跑该窗口**所有**扩展 → **无 per-extension 隔离**，
  一个坏扩展拖垮该 host 全部扩展。映射本 app：将来多个自动化任务若共用**一个** Gemma utilityProcess，
  一个崩会连累其他 → **是否 per-task 隔离，是 Gemma 立项时的设计选择，现记一笔勿重蹈**。

### 10.3 唯一真源在中央进程（印证已定决策）

- Chrome 的 cookie jar、Electron 的 `Session`（cookies/cache/proxy，`Process: Main`）皆在中央进程 →
  印证本 app「DB sidecar + ws 注册表当唯一真源」（§四）方向正确。
- 隔离 renderer 的特权操作**经 IPC 委托**回中央（Electron sandbox 官方模型）→ 印证「window 经 IPC 写 DB、
  不直连」（§二）。

### 10.4 一手来源
- Chromium Multi-process Architecture / Site Isolation（chromium.org、process_model_and_site_isolation.md）
- Electron process-model / sandbox / utility-process（electronjs.org）
- VSCode sandbox 博客 / shared-process 源码迁移 / issue #79782（code.visualstudio.com、github.com/microsoft/vscode）

---

## 十一、V2 分层体检 —— 多窗口重构落在哪几层（代码核实）

> **动机**：用多窗口这个「只该影响底层」的改动，反向体检 V2 L0~L5 分层是否真解耦
> （教科书级架构验证：改下层、上层若被牵动，即暴露隐藏耦合）。

### 11.1 V2 真实分层（charter.md §1.1 / view-hierarchy.md §2）

| 层 | 定义 | 目录 | 基数 |
|---|------|------|------|
| L0 | Electron app 生命周期 + IPC bus | `platform/main/index.ts`、`storage/surreal/` | app 内 1 |
| L1 | BrowserWindow 创建/窗口管理 | `platform/main/window/main-window.ts` | **现 1，多窗口→N** |
| L2 | Shell 三栏骨架（**每窗口共享，全局各 1**） | `shell/`（WorkspaceBar/NavSidebar） | **现全局 1** |
| L3 | Workspace 工作环境 + 状态 + 视图池（**app 内 N**） | `workspace/` | **现 app 内 N** |
| L3.5 | 每 ws 事件 bus | `slot/workspace-bus/` | 每 ws 1 |
| L4 | Slot 系统 + 所有 registry | `slot/` | 全局 1 |
| L5 | 具体视图 Note/Web/AI/Graph | `views/` | 每 ws 1~8 |

宪章原则：**「上层调下层，下层不知上层存在」**。

### 11.2 体检结论 —— 两个维度分开看（代码背书）

| 维度 | 结论 |
|------|------|
| **调用方向解耦**（上层调下层，下层不知上层） | ✅ **真解耦**。L4/L5 业务对窗口数无感，多窗口**一行不改** |
| **实例基数解耦**（各层实例数是否独立于窗口数） | ❌ **未解耦**。L2/L3 硬编码了「单窗口一个 Shell 挂 N 个 ws」的 **tab 模型** |

**「用户原判断"改 L0~L1、上层不受影响"→ 对七成」**：对 L4/L5 完全成立；对 L2/L3 **不成立**——
它们的**实例模型要重写**（非业务逻辑）。

### 11.3 单窗口假设的硬编码点（代码实锤）

- **L3**：`workspace-manager.ts:29` `private activeId` —— 「app 内 N 个 ws、一个 active」的 tab 内核。
  多窗口下「全局唯一 active」概念消失（每窗口自有其 ws）。→ 改：单例 activeId 中心 → **窗口注册表**。
- **L2**：`renderer/index.tsx:125-138` `<WorkspaceBar/> + <WorkspaceContainer/>` 单 root 挂一次 →
  **全局单例 Shell** 实锤。→ 改：全局 1 个 Shell → **每窗口 1 个**。
- **L2 tab 物理形态**：`WorkspaceContainer.tsx:32-36` `workspaces.map(ws => <WorkspaceInstance
  isActive={ws.id===activeId}/>)` —— 所有 open ws 同时渲染、非 active 用 `display:none` 藏。
  → 改：`.map` 渲染 N 个 → **单窗口只渲染其 1 个 ws**（无 map/无 activeId/无藏）。

### 11.4 结论：多窗口的真实工作量地图

- **L0~L1**：改动**简单**（加窗口注册表、`createWindow(wsId)`、平台惯例退出）。用户以为的难点，其实轻。
- **L2/L3**：**真正的工作量**在此——**实例基数模型重写**（Shell 全局→每窗、activeId 中心→窗口注册表、
  map 渲染→单 ws）。这不是分层失败，是「为单窗口设计的分层」必有的隐含窗口假设，被多窗口照了出来。
- **L4/L5**：**不动**（真解耦，体检通过）。
- **产出价值**：这次体检把「多窗口改哪几层、L2/L3 具体改什么」钉死，是实施期的精确工作量地图。

---

## 十二、迁移路线与验收基础设施

### 12.0 第 0 步契约 —— 净化后 L2/L3 目标形态（楼长 / 房客）

> 深解的地基：先定「净化后 L2/L3 长什么样」，它决定新框架接口。核心 = 把现在**一人干两份活**的
> workspace-manager **劈成两个角色**（比喻：楼长 vs 房客）。

**心智模型**：现在的 workspace-manager = 一个大厅（窗口）里的「标签管理员」，管 N 个标签、记 activeId。
多窗口后世界变成「N 个独立房间、每间一个工作台」→ 管理员裂成两人：

```
╔═══════════════════════════════════════════════════════════════╗
║ 🏢 楼长 = 最高指挥官（底层·主进程·全楼独一份·跨所有窗口）          ║
║   握「全局 ws 注册表」——唯一知道"有哪些 ws"的人                   ║
║   create / close / remove / rename / list                     ║
║   真源在 DB(§4.2),运行态映射在主进程窗口注册表                    ║
╚══════════▲══════════════════════════════▲════════════════════╝
           │ IPC 房客→楼长               │ IPC 楼长→房客
           │ 请开新ws/归档我             │ 你的ws变了,刷新
   ┌───────┴──────┐   ┌───────┴──────┐   ┌───────┴──────┐
   ▼ 🚪房客(1号窗) ▼   ▼ 🚪房客(2号窗) ▼   ▼ 🚪房客(3号窗) ▼
   ws-A               ws-B               ws-C
   只握「我这一个ws」:  ws / bus / toggleNavSide() / subscribe()
   ❌ 拿不到: activeId / getAll() / getOpen()  ← 物理上不存在
   独立 renderer,崩了不碰别人
```

**三份清单**（基于真实 API 面 `workspace-manager.ts` 核实）：

**① 楼长 API（上移底层 = 主进程 + DB 注册表）** —— ws 的生老病死
| API | 语义 |
|-----|------|
| `create(label?)` | 开一个新 ws + 新窗口 |
| `close(id)` | 归档某 ws（关窗，数据留 DB） |
| `remove(id)` | 彻底删某 ws |
| `rename(id, label)` | 改名 |
| `list()` / `getAll` / `getOpen` | 列所有 ws（给 NavSide library / Recent）——**只有楼长有全局视图** |
| `restore` `open` `ensureMinimum` `loadFromPersistence` | 启动恢复 / 重开归档 ws |

**② 房客 API（留窗内，语义收窄成"我这一个 ws"，去掉 id 参数）**
| API | 净化后 |
|-----|--------|
| `get(id)` → `ws` | 就我这个 ws，无需 id |
| `getBus(id)` → `bus` | 我这个 ws 的 bus |
| `toggleNavSide` `setNavSideCollapsed` | 我这个 ws 的 navSide，无需 id |
| `subscribe` | 订阅我这个 ws 的变化 |

**③ 拔掉（单窗口假设，净化后物理消失）** —— 残留引用将**编译报错**，解耦不完整当场现形
- `activeId` / `getActive` / `getActiveId` / `setActive` —— 「全局唯一 active」概念多窗口下不存在
- `count` / 渲染层的 `getAll`/`getOpen` 遍历 —— 「app 内 N 个 ws 的集合视图」从渲染层消失
- `WorkspaceContainer` 的 `.map(ws)` + `display:none` —— tab 物理形态删除，单窗口只渲染其 1 个 ws

**④ IPC 契约（房客 ↔ 楼长，替代原来的进程内直调）**
- 房客 → 楼长：`请求新建 ws 窗口` / `归档我自己(close)` / `删除我(remove)` / `查所有 ws(给 library)`
- 楼长 → 房客：`你的 ws 数据变了→刷新`（§3.1 广播）/ `窗口生命周期事件`

**契约要点**：净化后「所有 ws 的集合视图」这一概念**从渲染层彻底消失**，窗口里的代码**物理上拿不到别的 ws**
→ 落实「隔离从约定变成物理不可能」（§12.2 头号风险的正解）。这也是新框架(§12.1 步骤2)的接口依据。

---

### 12.1 迁移路线 —— 深解 · 分支兜底（用户拍板）

- **深解**：把 L2/L3 的单窗口假设（`activeId` / `.map(ws)` / Shell 全局单例）**连根拔掉**，
  重写成「每窗口一个 Shell、一个 ws、无 active 概念」的纯净形态。**不留死代码、不搞双模式。**
- **兜底靠 git 分支**：main 上旧 tab 架构随时可回退 → 设计分支里可大胆深解，中间跑不起来不要紧，
  成了验证过再整体合并。**不需要「旧架构解耦期还活着」的双模式复杂性。**
- **步骤（用户「先解耦后建框架」定序）**：
  0. 定「净化后 L2/L3 目标形态」（每窗 Shell / 无 activeId / 单 ws 渲染的契约）
  1. **解耦 L2/L3**（拔单窗假设，深解）
  2. 建新多窗口框架（L0~L1'，接口照净化后的 L2/L3）
  3. 迁 L4/L5 入新框架，旧架构退场

### 12.2 头号风险 = 解耦不完整 → 长期技术债（用户点出）

- 深解重写有隐蔽陷阱：**残留的单窗口假设在「只开一个窗口」时表现得和正确的一模一样**，
  开第二个窗口才暴露 → 债已埋进地基。呼应 [[ws-instance-isolation-invariant]] 那个 bug 家族
  （ws 隔离不干净→多 ws 盲提 / 一次事件被 N 实例消费）。
- **不能靠「我觉得解耦干净了」**（[[dont-guess-look-at-real-data]]）→ 需**可执行的完整性判据**。

### 12.3 验收基础设施（用户提出，一等公民贯穿迁移）

**两件事合成一套「注入故障 + 观测健康」验证系统：**

**① 分层持续 health 心跳**（升级现有 `reportLxAlive`）
- 现状（已核实）：`reportLxAlive` 是**启动报一次**（`renderer/index.tsx:140-144` / `main/index.ts:110` /
  `main-window.ts:99`），链路 renderer→`electronAPI.reportAlive`（preload）→IPC→主进程
  `diagnostics-handler.ts` **已通**；payload 带 `layer` 但**无 windowId**。
- 升级（实现期，改动小，链路现成）：
  a. payload 加 **windowId** → 多窗口下能看出「3 号窗口的 L3 哑了」。
  b. 「启动一次」→ **持续心跳**（按 `(windowId, layer)` 定期报活）。
  c. 主进程汇聚成健康看板：哪个窗口、哪层、活/哑。

**② 关模块隔离测试 = 解耦完整性的判据**（用户核心洞见）
- **判据**：真解耦 ⟺ **强行关/杀掉模块 A，模块 B 的 health 心跳毫发无损**。
  运行期物理事实，无法造假（同 OCC 探针的「不争论，杀给你看」路子；也是 Chrome/VSCode 验证
  进程隔离的方法，此处从「进程级」推广到「模块级」）。
- **可执行验收**：关掉/杀掉 { 某窗口 renderer / 某 view / Gemma utilityProcess / DB sidecar } →
  断言其他模块 health 心跳不受影响；断言失败 = 定位到具体哪层有隐藏耦合。
- **立为迁移验收门槛**：每完成一步解耦，跑一遍关模块隔离测试，绿了才算「这步真解耦」。

**闭环**：`关闭模块A（注入故障）→ 看各层 health log（观测）→ B 心跳在=解耦完整✅ / B 心跳停=有隐藏耦合❌且定位到层`。
→ 不靠祈祷解耦干净，**主动杀模块逼债现形**，直接回应「解耦不完整→技术债」这一头号风险。

---

## 十三、数据缓存层 + 同步策略（2026-07-21 讨论，用户主导推导）

> **动机（用户提出）**：在 DB 层与 window 层之间加一层数据缓存，剥离二者紧耦合——
> **不会因 DB 出问题所有窗口都挂**（DB 是当前架构最大未隔离单点：所有窗口共享唯一 sidecar）。
> 附带益处：前端渲染不一致时可拿缓存快速初筛。

### 13.1 缓存层定位 = B/S 架构（用户定调）

- 每窗口 = 瘦客户端（Browser 端），持本地缓存 = 本地数据副本；DB sidecar = 服务端（Server）。
- 窗口不直接依赖 DB 活着 → **DB 抖/重启/短时挂，窗口读缓存、写暂存，不集体白屏**。契合
  [[reliability-charter]]：把 DB 故障从「全局坍缩」降级为「局部可恢复」。
- **每窗口一份**（非主进程共享一份）：各窗口只有自己 ws 的数据，关窗不影响别人，数据模型简单好调试。

### 13.2 ⚠️ 纠正一个错误推导（留痕以防重犯）

- 曾误推：「一 ws 一窗」→「各窗口数据不相交」→「独占写者、无冲突」。**错**。
- 真相：workspace 是**工作视图**，**不是数据分区**。同一份数据（同一 note/folder）**可被多窗口并发读写**
  → **多副本写冲突真实存在**，躲不掉。与 [[note-update-occ-conflict]] 同源，只是冲突从 DB-OCC
  上移到缓存副本一致性。

### 13.3 为什么**否决 CRDT**（用户质疑 CRDT 完美性，成立）

- CRDT 的全部复杂度只买一个能力：**离线 + 无中央 的自动字符级合并**。
- **CRDT 也不完美**：撞同一处时它同样得靠规则（时间戳等）瞎选 → 一方意图仍丢，只是「确定地丢」
  而非随机；且合并可能产出语义诡异结果。它只保证「副本收敛」，**不保证「结果是用户想要的」**。
- **CRDT 反而违背可靠性纲领**：撞车时它**静默按规则选一个**（掩盖冲突）；而纲领要「故障必须响、
  反静默坍缩」。→ 对「不丢、要响」的诉求，CRDT 不如「交给人」。
- **代价巨大**：要重构 note 数据模型成 CRDT 结构（捅到 L 语义层，[[decision-028-impl]] 的 atom/block
  要大改）、引擎集成、量级陡增。对**个人知识库**是过度工程。
- **CRDT 唯一不可替代处**：多人**实时、同时、不同处**编辑要**丝滑无锁无弹窗**（Google Docs 级）。
  用户确认真实目标 = 个人多设备、几乎不真并发 → **不满足 CRDT 必要条件**。

### 13.4 ✅ 最终方案：按**角色**分治（用户主导设计）

> 核心哲学（用户点破）：**撞车不该机器判断，系统职责是「忠实暴露冲突给有资格解决的人」**。
> = Git 模型（检测冲突→标记→人解决），支撑全球协作而**从不用 CRDT**。

| 角色 | 场景 | 机制 | 撞车会发生吗 |
|------|------|------|------|
| **同一登录用户** | 个人多窗口/多设备 | **先拉后改**（read-latest-before-write）：改前把最新改动同步过来，在最新基础上改；OCC 版本号兜底 | **几乎不会**（同一人不会同时敲同一处，时间错开）→ live query 让 B 窗口在动手前已同步 A 的改动 → **冲突消灭在发生之前，全程无感** |
| **多人协作** | 不同用户 | **新建副本 + 展示差异 + 各自选定**（不合并、不机器判）= 分支/冲突副本模式 | 会（真两人可并发）→ 交给人裁决 |

**为什么这是最优解**：
- **简单**：复用现有 —— SurrealDB **live query**（推变更实现「先拉」）、**OCC 版本**（[[note-update-occ-conflict]]
  探针已验退避可收敛，作存前核对）、**block 稳定 id**（[[table-cell-block-id]] 等已修，作冲突定位）、
  **登录身份**（[[auth-billing-architecture]] V3 SaaS，多人副本靠它区分谁是谁）。全是已有地基，无重构。
- **诚实**：多人撞车交人裁决，不静默丢 → 符合 [[reliability-charter]]。
- **人性**：同一用户「先拉后改」让撞车根本不发生，比「撞了弹窗」更高一层。
- **不埋债**：将来若真要多人实时协同，副本模式可演进，接口不排斥升级。

### 13.5 依赖与待办

- 多人「新建副本」**依赖登录身份体系**（[[auth-billing-architecture]]）——知道 A 是 A、B 是 B 才能分副本。
- 缓存冷启动/故障恢复（新窗口开 ws 时缓存空，需从 Server 拉一次；DB 此刻挂则新窗口开不出内容——
  此故障缓存救不了，待兜底设计）。
- 「先拉后改」的具体触发点（编辑前 or 存入前 or 两者）、live query 订阅粒度 → 实现期定。
