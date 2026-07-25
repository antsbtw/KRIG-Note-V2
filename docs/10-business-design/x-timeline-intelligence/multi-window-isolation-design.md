# X 时间线 · 指挥者调度 & 多窗口隔离 — 设计文档

> 状态：草案（待总指挥审阅拍板，暂不写码）
> 起因：多窗口/多 ws 并发时，数据与 AI 判断不应混为一谈；更进一步，
>       Gemma 不应被切成 N 个各扫各的孤岛，而应是**能感知全部窗口、能派活、能跨窗口调度**的**指挥者**。
>
> 拍板结论（本文档据此展开）：
> - **配方/任务不绑死窗口** —— 窗口是「执行资源」，任务是「工单」，指挥者按需派活（否则不叫指挥者）
> - **Gemma = 组织**：一个指挥者（Orchestrator）+ 多个执行窗口（工人），分组织架构执行任务
> - **调度智能 = 规则式匹配**（先做）：任务带能力需求 ↔ 窗口带能力标签，硬规则匹配派活；Gemma 只干判断，不花推理去派活
> - **任务可流转多窗口**：一条任务链可跨窗口接力（ws-1 爬 → ws-2 深析 → ws-1 回复）
> - **先 X 专属，架构对齐全 app Orchestrator 底座**（[[project-x-timeline-intelligence]] / Agent 模块 §2.1），将来可上收

---

## 一、概念翻转：从「数据标签」到「工单 + 资源 + 调度」

初版设想把隔离做成静态四元组标签（配方绑 ws、角色绑 ws）。总指挥否决：**绑死 = 退化成 N 个孤岛爬虫，没有「指挥」**。

正确模型是**组织架构**：

```
┌──────────────────────────────────────────────────────────┐
│  X 指挥者 Commander（主进程常驻，全局唯一）                 │
│                                                            │
│  ① 窗口能力注册表 WindowCapabilityRegistry                 │
│       感知：哪些 ws 在线、各自身份与能力                    │
│       ws-1 { online, account:@a, lang:zh, X已登录, webAI:✓}│
│       ws-2 { online, account:@b, lang:en, X已登录, webAI:✓}│
│       （数据源：workspace-manager-main.getFullState()      │
│                 + x-search-scheduler.activeXWcMap）        │
│                                                            │
│  ② 任务工单池 TaskTicket 池（工单不绑窗口，持久化）         │
│       ticket#1 { 阶段链:[爬→判→回], 当前:待爬,             │
│                  需求:lang=zh, recipe:VPN求助-中文 }        │
│       ticket#2 { 当前:待深析, 需求:cap=webAI }             │
│                                                            │
│  ③ 规则调度器 Dispatcher（纯函数，不调 Gemma）             │
│       匹配 ticket.当前阶段.能力需求 ↔ window.能力标签       │
│       → 选中窗口执行本阶段                                  │
│       → 阶段完成，工单流转下一阶段（可换窗口）              │
└──────────────────────────────────────────────────────────┘
        │ 派工（某阶段）
        ▼
   ws-N 执行：爬取 / 判断 / 深析 / 回复
        └─ 判断阶段调 Gemma（callOllama）：
             用「工单指定的判断规范」+「执行窗口的偏好池/身份」
```

**三个角色的职责边界（对齐 Agent 模块 §2.1 四层分离）：**

| 组织角色 | 对应 Agent 模块层 | 职责 | 谁扮演 |
|---------|------------------|------|--------|
| **指挥者** | Orchestrator | 感知窗口、持有工单池、规则派活、驱动工单流转 | 主进程 Commander（新增，纯逻辑） |
| **判断大脑** | Web AI / Gemma | 只在工单「判断阶段」被调用，做价值判断 | Gemma 4 via `callOllama`（已有） |
| **执行窗口** | KRIG 执行层 | 领取工单某阶段，在自己的 X webview 里干活 | ws-N（已有 webview + 分区隔离） |

**关键澄清（回应「角色绑 ws」的修正）：**
- **窗口 ≠ 固定人格**，窗口是**能力资源**（有账号/语言/登录态/webAI 等能力标签）
- **判断规范跟工单/阶段走**，由指挥者在派活时下发给被选中的执行窗口
- 窗口仍持有「偏好池 + 账号身份」，作为**能力的一部分**在判断阶段合并进 prompt
- 即：**工单定「判断标准/任务动作」，窗口出「偏好池/身份/语气」**，二者在判断阶段拼合

---

## 二、当前态基线（事实）

### 2.1 可复用地基（不用重造）
- **`callOllama`** 共享客户端已建：`src/platform/main/local-llm/ollama-client.ts`（Gemma 调用统一入口，`OllamaCallOptions` 支持 json_object/超时/温度）
- **窗口能力数据源已有**：`workspace-manager-main.getFullState()` 返回全部 `WorkspaceState`（id/label/proxyId/userAgent/partition/pluginStates），持久化于 SurrealDB `workspace:current`
- **活跃窗口探测已有**：`x-search-scheduler.activeXWcMap: Map<wsId,wcId>`（哪些 ws 有活跃 X webview）
- **注册表工厂可仿**：`web-service-base/webview-registry-base.ts` 的 `createWebviewServiceRegistry`
- **数据隔离半成品**：`tweet_inbox` 有 `ws_id`(1.8.1) + `search_recipe`(1.8.0)；IPC 全线已穿 wsId

### 2.2 底座蓝图已设计（对齐它，别另起炉灶）
Agent 模块 `docs/10-business-design/agent/Module5-Agent-设计.md` 已定义（尚未落代码）：
- **WorkingMemory**（task_id / original_intent / matched_template / current_step / execution_history / attempt_count …）→ 我们的 **TaskTicket** 直接对齐此结构
- **ExecutionRecord**（step_id / type / input / output / timestamp / success）→ 工单每阶段执行留痕
- **4 级自动化**（Level 0 全自动只读 → Level 3 用户驱动）→ 决定每阶段是否需人工确认
- **模板 step.type**（`orchestrator | web_ai | krig_tool | browser | user_confirm`）→ 工单阶段类型词表

### 2.3 破口 & 缺口（需改/需建）

| # | 缺口 | 位置 | 性质 |
|---|------|------|------|
| B1 | AI judge 跨 ws 混批：`queryPending(limit)` 无 ws 过滤 + 全局计数器 | `x-ai-judge.ts:150`、`x-search-scheduler.ts:33` | 正确性（阶段A先止血） |
| B2 | judge 单例硬编码 prompt，无「判断规范可下发」 | `x-ai-judge.ts:11-42` | 角色化前提 |
| B3 | few-shot 池全局；`tweet_feedback` 表缺 `ws_id` 列 | `tweet-inbox-repo.ts:200`、`schema.ts:532` | 偏好池隔离前提 |
| B4 | **无指挥者 / 工单 / 调度器 / 能力注册表** —— 全新建 | 新建 | 核心 |
| B5 | 工单需跨窗口流转 → **必须持久化**（新表 `x_tasks`） | 新建 | 「流转多窗口」的硬成本 |
| B6 | 配方全局、调度器对每个 ws 跑全部 enabled → 无「按需派活」 | `search-recipe-repo.ts:129`、`x-search-scheduler.ts:62` | 被指挥者取代 |
| B7 | Review Queue 缺按 (recipe / task / 工单) 切片 | `tweet-inbox-repo.ts:116` | 可用性 |

---

## 三、数据模型

### 3.1 窗口能力（WindowCapability）
指挥者启动时 + 窗口上下线时刷新，内存态，数据源见 §2.1。

```typescript
interface WindowCapability {
  wsId: string;
  online: boolean;            // 有活跃 X webview（查 activeXWcMap）
  wcId: number | null;
  account?: string;          // X 账号 handle（从登录态/ws 元数据）
  lang?: string;             // 该窗口身份语言 zh/en（来自 WorkspaceState）
  caps: XCapability[];       // ['x-crawl','x-reply','web-ai',...] 能力标签
  fewShotPoolKey: string;    // 偏好池归属键（= wsId，接 tweet_feedback.ws_id）
}
type XCapability = 'x-crawl' | 'x-reply' | 'web-ai-deep' | ...;
```

### 3.2 任务工单（TaskTicket）—— 对齐 Agent 模块 WorkingMemory
**持久化到 SurrealDB 新表 `x_tasks`**（B5：跨窗口流转必须落库，重启/关窗不丢）。

```typescript
interface TaskTicket {
  taskId: string;                    // ULID（对齐 WorkingMemory.task_id）
  intent: string;                    // 人读意图，如「捕捉中文VPN求助并回复」
  recipe?: string;                   // 用哪个配方爬（可选）
  stages: TaskStage[];               // 阶段链
  currentStage: number;              // 当前阶段索引（对齐 current_step）
  status: 'queued'|'running'|'waiting_user'|'done'|'failed';
  history: ExecutionRecord[];        // 每阶段执行留痕（对齐 execution_history）
  attemptCount: number;
  createdAt: string; updatedAt: string;
}

interface TaskStage {
  kind: 'crawl'|'judge'|'deep-analysis'|'reply';   // 对齐 step.type 词表
  requires: StageRequirement;        // 能力需求（供 Dispatcher 匹配）
  judgeSpec?: JudgeSpec;             // kind=judge 时：下发的判断规范（B2）
  level: 0|1|2|3;                    // 自动化级别（对齐 Agent §5.1）
  assignedWs?: string;               // 本阶段被派到哪个窗口（流转时可变）
  result?: unknown;
}

interface StageRequirement {
  cap: XCapability;                  // 必需能力
  lang?: string;                     // 语言需求（如求助帖判断需 zh 号）
  preferWs?: string;                 // 软偏好（如回复希望回到原爬窗口）
}

interface JudgeSpec {               // 工单下发的「判断标准」，替代硬编码 SYSTEM_PROMPT
  task: 'judge-value'|...;           // 判断动作模板（正交于窗口）
  promptHead: string;                // 任务指令头
  outputSchema: 'AIVerdict'|...;
}
```

### 3.3 每条推文的归属标签（数据分类维度，回应「不能混为一谈」）
`tweet_inbox` 每条推文打**四维标签**，Review Queue 可按任意维度切片：

| 维度 | 现状 | 作用 |
|------|------|------|
| `ws_id` | ✅ 有 | 哪个窗口执行采集/判断 |
| `search_recipe` | ✅ 有 | 哪个配方爬来 |
| `task_id` | ❌ **新增** | 属于哪个工单（跨窗口链的归属） |
| `status` | ✅ 有 | 处理到哪步 |

---

## 四、调度流程（规则式，Gemma 不参与派活）

```
指挥者主循环（复用现有 60s 轮询节奏）：
  1. 刷新 WindowCapabilityRegistry（getFullState + activeXWcMap）
  2. 扫 x_tasks 中 status=queued/running 的工单
  3. 对每个工单的 currentStage：
       req = stage.requires
       candidates = 窗口注册表.filter(w => w.online && w.caps⊇req.cap
                                        && (!req.lang || w.lang==req.lang))
       若 req.preferWs 在 candidates → 选它，否则取第一个
       若无 candidate → 工单挂起等待（fail loud 记录「无可用窗口」，不静默）
  4. 派活：在选中窗口 wcId 上执行该 stage
       - crawl        → scanRecipe（现有）
       - judge        → callOllama，prompt = stage.judgeSpec + 窗口偏好池
       - deep-analysis→ 注入 web AI（现有 x-deep-analysis）
       - reply        → 填充 XSendConfirmPanel（现有，红线：人工确认发布）
  5. 阶段成功 → 追加 ExecutionRecord，currentStage++，可换窗口继续
     阶段失败 → attemptCount++，超限标 failed（fail loud）
```

**判断阶段的角色化合并（核心，解 B2/B3）：**
```
systemPrompt = buildPrompt(
   stage.judgeSpec.promptHead,          // 工单定：判断什么、输出什么
   window.identity(account,lang),       // 窗口出：身份/语气/语言
   queryFeedbackSamples({ wsId, ... })  // 窗口出：该 ws 的 few-shot 偏好池（B3）
)
callOllama({ model, messages:[system, tweetBatch], responseFormat:'json_object' })
```
- 物理仍是**单 Ollama 实例串行**（`concurrency:1` 不变，避免显存争抢）
- 角色化只体现在**每次拼不同 prompt + 喂不同偏好池**，不新建推理通道

---

## 五、改动清单（分层，不写码，仅定位与形状）

### Layer 0 · 类型与 schema
- `x-timeline-types.ts`：新增 `WindowCapability` / `TaskTicket` / `TaskStage` / `JudgeSpec` / `XCapability`；`TweetInboxRecord` 加 `task_id?`
- `schema.ts`（续 1.8.x 新迁移）：
  - 新表 `x_tasks`（工单持久化，B5）
  - `tweet_inbox` 加 `task_id` + 索引
  - `tweet_feedback` **补 `ws_id`**（B3）

### Layer 1 · 存储查询层
- `tweet-inbox-repo.ts`：`queryPending(limit, wsId)`（B1）；`queryInbox` 加 `searchRecipe?`/`taskId?` 过滤（B7）；`queryFeedbackSamples` 加 `wsId?`（B3）
- 新 `x-task-repo.ts`：`x_tasks` CRUD（对齐现有 repo 模式）

### Layer 2 · 指挥者（新建，核心）
- 新 `src/platform/main/x/x-commander.ts`：
  - `WindowCapabilityRegistry`（复用 getFullState + activeXWcMap，仿 webview-registry-base）
  - `Dispatcher`（纯函数规则匹配，§四）
  - 主循环（取代现有 `x-search-scheduler.runEnabledRecipes` 的「每 ws 跑全部配方」逻辑，B6）
- `x-ai-judge.ts`：硬编码 SYSTEM_PROMPT → `buildPrompt(judgeSpec, windowIdentity, fewShot)`（B2）；`runJudgeBatch` 接 wsId + judgeSpec

### Layer 3 · IPC & UI
- `x-timeline-handlers.ts`：`X_INBOX_QUERY` 加 recipe/task 过滤透传；新增工单读写通道（创建工单 / 查工单进度）
- `XInboxPanel.tsx`：左侧过滤栏加「配方 / 任务 / 工单」切片器；（可选）工单看板视图

---

## 六、待总指挥拍板的决策点

| # | 问题 | 候选 | 建议 |
|---|------|------|------|
| **D1** | 工单谁创建？ | A. 用户在面板手动建工单（选配方+阶段链）<br>B. 由 enabled 配方自动生成常驻工单 | A 先做（可控），B 后加 |
| **D2** | 阶段链初期做几段？ | A. 只做 `crawl→judge`（打通调度骨架）<br>B. 全链 `crawl→judge→deep→reply` | A 先验证「派活+流转」，reply/deep 复用现有能力后接 |
| **D3** | task 判断动作初期几个？ | A. 只 `judge-value`，架构留口<br>B. 多个 | A |
| **D4** | `tweet_feedback` 缺的 ws_id 历史数据 | A. 新列默认 null = 全局公共池所有 ws 可用<br>B. 按 source_recipe 反推 | A（简单无损） |
| **D5** | 指挥者与 Agent 模块 Orchestrator 的关系 | A. X 先自建，命名/结构对齐 WorkingMemory，将来上收<br>B. 等 Agent 模块先落 | A（已拍「先 X 专属对齐底座」） |

---

## 七、建议实施顺序（文档过审后）

> 遵铁律：失败 fail loud 不静默（[[fail-loud-no-fallback]]）；删共用边先 grep（[[grep-shared-edge-before-delete]]）；派活无窗口/判断失败都要留痕对账（[[project-reliability-charter]]）。

- **阶段 A · 正确性止血（小，先做，独立可上）**：B1 —— `queryPending` 加 wsId + 计数器 per-ws，止住跨 ws 混批
- **阶段 B · 数据分类维度（小，零风险）**：B7 + `task_id` 字段 —— Review Queue 能按 recipe/task/工单切片
- **阶段 C · 指挥者骨架（中，核心）**：B4/B5/B6 —— 能力注册表 + `x_tasks` 持久化 + 规则调度器 + `crawl→judge` 双阶段流转（D2-A）
- **阶段 D · AI 角色化（中）**：B2/B3 —— judgeSpec 下发 + few-shot per-ws + `tweet_feedback` 补 ws_id
- **阶段 E · 全链（按需）**：接 deep-analysis / reply 阶段，工单看板 UI

---

## 八、与既有纲领的关系
- [[project-multi-window-process-isolation]]：多窗口按角色分治 —— 这里升级为「指挥者派活 + 窗口作资源」
- [[project-module-boundary-governance]]：隔离维度贯穿全层，X 指挥者是 task-level orchestration 第一个落地样板
- [[project-x-timeline-intelligence]]：本文是其 Phase 3b（few-shot 注入）的架构前置；few-shot 必先 ws 隔离才谈得上按窗口注入
- Agent 模块 §2.1/§2.3/§5.1：TaskTicket/ExecutionRecord/Level 概念对齐，为将来上收 Orchestrator 底座铺路
