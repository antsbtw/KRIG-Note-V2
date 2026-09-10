# Module 5 · 工作流模型(以 X 业务为第一个模板)

> 立于 2026-09-09。承接 `Module5-Agent-设计.md`(2026-04,v0.3)。
>
> **本文是设计,不含实现。**
>
> 用户 2026-09-09 拍板三条:
> 1. **Module5 从 X 业务开始** —— X 是第一个真实模板,不是先造通用引擎再找场景
> 2. 编排深度 = ⭐ **可重组步骤**(不做条件分支 / 循环)
> 3. run log **新建独立的工作流库**

---

## 0. ⭐ 起因:用户的原话

> 「对于每一个 view 的功能都应该是一个**工作流**,有**描述**,有**配置**才对,
> 现在每一个 button 都是**黑盒子**,不可配置不可编排业务。」

⚠️ **这不是 UI 表达问题,是结构问题。** 实测盘点(2026-09-09)确认:

> **没有任何地方能看到「这条推文走过哪几步」。**

因为那份数据**根本不存在** —— step 级痕迹只有 `console.log` + 返回值,
而返回值一旦 UI 消费完就丢了。

---

## 1. ⭐⭐ 不要重新发明:九件雏形已经长出来了

盘点最重要的结论:**工作流需要的东西,X 里大半已经有了,只是散着、且只覆盖第一步。**

| 工作流需要 | X 里已有的雏形 | 位置 |
|---|---|---|
| ⭐ step 定义 + 配置持久化 + 手动跑 + 定时跑 + 效果统计 | **`recipe` 整套做过一遍** | `search_recipes` 表 + `search-recipe-repo.ts` + 编辑弹窗 + `lastRunAt`/`intervalMinutes` |
| 资源占用调度(谁占 webview) | `x_ws_role` + `requireWsRole()` **fail loud** | `x-ws-role-repo.ts:104` |
| 并发控制三件套 | `running` 布尔 + `pausedUntil` 让路 + 单例 Set 锁 | `x-campaign-loop.ts:159-167` |
| ⭐ 「部分完成」+ 崩溃自愈 | `judgeNow` 的 `draining`/`remaining` + DB 状态机 + `recoverStuckAiJudging()` | `x-ai-judge.ts:243-293` |
| 输出去重 / 只投递一次 | `x_campaign_reply` 幂等台账(`payload_hash` + `pushed_at`) | `x-schema.ts:453-476` |
| 断点续跑游标 | `x_collect_cursor`(`scope`/`bottom_cursor`/`exhausted`) | `x-schema.ts:276-286` |
| ⭐ **试跑不写库(dry-run)** | `replayReplies` 已是执行器,还返回 precision/recall | `x-timeline-handlers.ts:740` |
| 决策链留痕的**字段范式** | `x_reply_feedback`:输入 / 推理 / 输出 / 人工修正 四段式 | `x-schema.ts:642-693` |
| 跳过原因结构化 | `ReplySkip{tweetId, skipReason, detail}` | `x-reply-types.ts:307-312` |

> ⭐ **recipe 这条最关键**:它已经完整走通了
> 「配置化 + 持久化 + 手动跑 + 定时跑 + 效果回看」。
> **工作流不用发明这个形状,沿用即可 —— 它唯一的问题是只覆盖第一步。**
>
> 这正好印证用户的判断:不是缺设计,是**只有采集那一步照做了**。

### 1.1 ⚠️ 配置藏在常量里(实测)

recipe 里能配的**只有「搜索串怎么拼」和「多久跑一次」**。后续步骤的参数全是硬编码:

| 藏在哪 | 内容 |
|---|---|
| `DEFAULT_JUDGE_CONFIG`(`x-timeline-types.ts:149-165`) | 模型 / `batchSize:25` / `maxWaitMinutes:15` / `concurrency:1` —— **无 DB 持久化、无 UI**,唯一可覆盖的是模型名走环境变量 |
| `x-reply-types.ts:322,328` | `REPLY_CONFIDENCE_FLOOR = 0.6` · `SAME_AUTHOR_COOLDOWN_HOURS = 72` —— **常量** |
| `x-timeline-scan.ts:294` | `maxScrollRounds = 200` |
| `x-timeline-handlers.ts:1046,1059` | prefetch `limit=20` / 超时 `10_000ms` |

> **整条链上唯一可配的是第一步的查询条件,后面全是硬编码。**
> 这就是「不可配置」的字面证据。

---

## 2. 真正要新建的只有五样

盘点确认这五样**完全不存在**,不是散着而是没有:

| # | 缺什么 | 现状 |
|---|---|---|
| 1 | ⭐ **执行记录表**(step 级 run log) | 只有 console;`x_event` 仅有设计文档,`src/` 零命中 |
| 2 | ⭐ **统一的 step 返回契约** | 7 个入口 **7 种形状**,只有 `{success, error?}` 是共识 |
| 3 | **跨重启的任务队列** | `drainingWs` / `pendingAccumulated` / `watch` 全是模块级内存变量,**进程一退全丢** |
| 4 | **统一 scheduler 抽象** | 5 处各写 `setInterval`,启停纪律靠注释保证 |
| 5 | ⭐ **step 之间的显式编排** | 串联全靠隐式:`runRecipe` 里 fire-and-forget 调 `runJudgeBatch`(`x-timeline-handlers.ts:88`)、调度器靠 `accumulatePending` 计数触发 |

---

## 3. ⭐⭐ 与「发布闸门」的对齐(必须先解决的冲突)

`Module5-Agent-设计.md` §5 的 **Level 0-3** 与
`web/capability-layer/01-contract.md` §7.1 的 **发布闸门**(2026-09-09 立)
看起来撞车。实测核对两份文档后:**它们管的是不同的东西,是两层,不是矛盾。**

| | Module5 Level | 发布闸门 |
|---|---|---|
| 管什么 | **这个动作允许不允许做** | **做完的东西能不能自动发出去** |
| 判据 | 操作类型 + 域名白名单 | 可撤回性 + 四个量化条件 |
| 落点 | 传给 automation 层当**执行约束** | **X 业务层**的发布前一道闸 |
| 性质 | **静态**(模板定义时就定了) | **运行期状态**(达标即可开) |

### 3.1 ⭐ 对齐规则(一句话)

> **Level 决定「这步能不能自动跑」;闸门决定「跑出来的东西能不能自动发出去」。
> 取交集,不取并集。**

这与 Module5 §5.2 自己写的原则一致:

> 「取交集,不取并集 —— 模板的 `allowed_domains` 不能突破全局白名单,只能进一步收窄。」

**发布闸门就是又一道收窄**,加进这个交集即可,**不用改 Level 模型**。

### 3.2 X 拟回复的落点

| 动作 | Level | 闸门 | 结果 |
|---|---|---|---|
| 生成回复草稿(写进 KRIG 内部,可撤回) | Level 1 放行 | 不适用 | ✅ **自动跑** |
| 点发布按钮(不可撤回) | —— | ⚠️ **四条一条没达标 → 关** | ❌ **人工** |

⭐ **这与现在代码的实际行为完全一致** ——「只填不发」(记忆 `project-x-auto-reply-impl`)。
**新模型没有放松任何现有约束。**

### 3.3 ⚠️ Module5 §5.1 有一处措辞要改

Level 2 的例子写着「**在外部平台发布内容**」,暗示 Level 2 就能半自动发。
**这在闸门下不成立** —— Level 再高也不能绕过闸门。

> **修正措辞**:Level 2 = 「涉及外部写入或不可逆操作,**关键节点需用户介入**」;
> 发布类动作**另受闸门约束**,闸门未开时 Level 2 也不自动发。

---

## 4. 工作流模型(编排深度 = 可重组步骤)

### 4.1 ⭐ 为什么「可重组」是恰当的一档

用户 2026-09-09 在三档里选了中间档。**这一档是真正的分界线**:

> **只要步骤之间的数据契约定死,重组就是自由的;
> 一旦加条件分支,就得发明表达式语言 —— 那是另一个量级。**

| 档 | 要什么 | 本轮 |
|---|---|---|
| 看得见 + 参数可调 | 描述 + 配置 + 留痕 | ✅ 含 |
| ⭐ **可重组步骤** | ⭐ **步骤间数据契约** | ✅ **本轮目标** |
| 条件 + 循环 | 表达式语言 / 分支 / 重试策略 | ❌ **不做** |

⚠️ **不做条件分支**是明确的范围裁定,不是遗漏。真需要时再立项。

### 4.2 沿用 Module5 §4.2 的 `Template`,不发明新结构

Module5 的 `Template` **逐条命中**用户今天的要求:

| 用户要的 | Module5 已有 |
|---|---|
| 有**描述** | `description` + 每步 `id`/`type` |
| 有**配置** | `variables`(定义 + 默认值)、`level`、`allowed_domains` |
| 可**编排** | `steps[]` —— 有序数组,**天然可重组** |
| 不是黑盒 | 每步 `input`/`output`/`validation`;整体 `success_criteria`/`fallback` |

> ⭐ Module5 §7 直接就叫「**可解释性原则**」,并定义了 `ExecutionRecord`。
> **用户今天说的「不要黑盒」,自己 5 个月前就写下来了。**
> 问题不是设计缺失,是 **X 业务独立长出来,没走这套**。

### 4.3 ⚠️ 要补的:统一 step 返回契约

现状 7 个入口 7 种形状。**直接沿用 `web` 能力层已定的三态**(`01-contract.md` §8),
不发明第八种:

```
Ok<T>          做了且完整
Degraded<T>    ⭐ 做了但不完整   missing: string[]
Failed         没做成            reason / retryable
```

⭐ **X 现有的「部分完成」正好全落在 `Degraded`**:

| 现有形态 | 归属 |
|---|---|
| `judgeNow` 的 `{draining:true, remaining:N}` | `Degraded`,`missing=['还有 N 条未判']` |
| `prefetchContext` 的 `{missed, remaining}` | `Degraded` |
| `harvestNotifications` 的 `problems[]` | `Degraded`,`missing=problems` |
| `planReplies` 的 `skips[]` | ⚠️ **不是 Degraded** —— 见下 |

> ⚠️ **`skips[]` 不算部分失败**:「这条不该回复」是**正确的业务判定**,不是缺陷。
> 它是 `Ok` 的一部分内容,不是 `missing`。
> **误判成 Degraded 会让「工作正常」看起来像「跑坏了」。**

### 4.4 ⭐ 步骤的输入有两个来源(2026-09-09 补,由 02 号文档逼出)

初稿只考虑「上一步的产物」。用户给出五步业务线后发现**不够**:

```
输入来源 A:上一步的产物          collect → ingest → filter
输入来源 B:⭐ 历史执行的产物      第5步的标注 → 回流到第3步的 few-shot
```

⚠️ **来源 B 不违反 §4.1「不做循环」**:

| | 定义 | 本轮 |
|---|---|---|
| **循环** | 一次执行**内部**反复跑 | ❌ 不做 |
| ⭐ **回路** | **跨执行**的数据流:这次的标注改变**下次**的过滤 | ✅ 做 |

仍然是有向的步骤序列,只是有一步的输入来自历史 —— **不需要表达式语言,不需要分支**。

> 落地实例见 `Module5-02-x-pipeline.md` §0.1 与 §3.3。

### 4.5 步骤间的数据契约(可重组的前提)

⭐ **重组之所以可能,是因为每步声明自己吃什么、吐什么**,而不是靠调用顺序的默契。

现状的反例(实测):`startScan` 里有段注释记着 —— 配方列表只在挂载时读过一次,
用户 2026-09-07 撞上「新建了『回国需求』却仍跑成老配方」。

> ⭐ **如果「跑配方」是个有声明输入的工作流步骤,这个 bug 结构上不存在** ——
> 输入是什么在契约里写着,而不是靠 React state 恰好新不新。

---

## 5. 第一个模板:X「采集 → 判断 → 拟回复」

用户 2026-09-09 选定。**完整主链,覆盖三类步骤,一次验证全部抽象。**

> ⚠️ **本节随后被 `Module5-02-x-pipeline.md` 一般化**(2026-09-09 同日):
> 用户给出的五步(策略 → 获取 → 过滤 → 处理 → 复核)是**模板的形状**,
> 第 1 步的策略可插拔(关键词 / 常规浏览 / 盯推 / 盯人),第 4 步有四种动作。
> **本节这条链是它在「关键词策略 + 回复动作」下的一个特例。**
> 设计以 02 号文档为准。

### 5.1 步骤分解

| # | step | `type` | 现有实现 | 可配置项(⭐ = 现在藏在常量里) |
|---|---|---|---|---|
| 1 | 采集 | `browser` | `runRecipe` → `scanRecipe()` | keywords / fromAccounts / lang / since / resultType(✅ 已可配)<br>⭐ `maxScrollRounds` |
| 2 | 入库漏斗 | `orchestrator` | `DEFAULT_FILTER_CONFIG` | ⭐ `dedupeWindowHours` / 黑名单 / `requireKeywords` |
| 3 | AI 判断 | `orchestrator` | `judgeNow` → `runJudgeBatch` | ⭐ 模型 / `batchSize` / `maxWaitMinutes` / `concurrency` |
| 4 | 补上下文 | `browser` | `prefetchContext` | ⭐ `limit` / 超时 |
| 5 | 补画像 | `browser` | `prefetchProfiles` | ⭐ `limit` |
| 6 | 拟回复 | `orchestrator` | `planReplies` | ⭐ `REPLY_CONFIDENCE_FLOOR` / `SAME_AUTHOR_COOLDOWN_HOURS` |
| 7 | 人工确认 | `user_confirm` | 现有 ✎ 拟回复 UI | 🚦 **闸门**:当前恒为人工 |

> ⭐ **第 7 步是 `user_confirm` 而不是 `browser`** —— 这是 §3.2 对齐规则的直接落地。

### 5.2 ⚠️ 这条链上真实存在的顺序依赖

⭐ **步骤 4/5 必须在 3 之后**:补上下文/画像只对 `status='worth'` 的推文做
(`prefetchContext` 默认 `status='worth'`)。**判断没跑,就没有 worth。**

> ⚠️ **「可重组」不等于「任意排列都合法」。**
> 契约要能表达这种依赖(step 声明自己吃什么),
> 而不是靠人记住 —— **那正是现在的病**。

### 5.3 ⭐ 记忆里已定的一条业务顺序,必须体现

记忆 `project-x-reply-chain-order`(用户定):

> **先看上文确认真 VPN 相关 → 再看活跃度 → 才拟回复。**

⚠️ 而实测「①是正确性闸门但**完全没做**」—— 卡在采集层
(`x-extract-tweet` 的 `inReplyTo` 只声明从没赋值)。

> **工作流模型让这个缺口变得可见**:step 之间的依赖一旦声明出来,
> 「上文这一步压根没产出数据」就是**结构性可查**的,
> 而不是像现在这样藏在 20 条父推 id 全空里。

---

## 6. 执行记录:新建独立工作流库

用户 2026-09-09 拍板:**新建独立的工作流库**,不埋进 `krig_x`。

**理由(用户视角)**:Module5 是**跨模块**的 —— 将来 Note / 图谱 / 邮件都会接入。
一开始就独立,避免将来从 X 库里拆。

### 6.1 ⚠️ 代价与解法(必须写明,不留暗坑)

**代价**:实测 SurrealDB **不支持跨 database 单语句查询**
(记忆 `project-data-model-charter`)。
所以「这条推文走过哪几步」= 跨库,**要两次查询在应用层拼**。

**解法**(不靠单语句 join):

| 做法 | 说明 |
|---|---|
| run log 里存 `subject_ref` | 形如 `x_tweet:<id>` 的**字符串引用**,不是 SurrealDB record link |
| 查询分两步 | ① 在工作流库按 `subject_ref` 查出步骤流水 ② 需要推文详情时再查 `krig_x` |
| **不做跨库外键** | 跨库引用**没有约束保证**,断了也不会报错 —— 按可靠性纲领,这种「看着有关系其实没有」最坏 |

> ⚠️ 实测已知:**USE DB 切换下 LET 变量存活**(记忆同上)——
> 但那是同一连接内的变量,**不是跨库 join**。别把它误当成 join 可用。

### 6.2 库名与建库坑

命名沿用惯例 `krig_<模块>`:**`krig_flow`**。

⚠️ **必须显式 `DEFINE DATABASE IF NOT EXISTS krig_flow`** ——
`connect({ database })` **不会**创建 database。
2026-09-01 在 `krig_x` 上实测踩过:app 照常启动、库却始终不存在
(`x-schema.ts:35-40` 留有记录)。

### 6.3 表设计(草案,待细化)

沿用 `x_reply_feedback` 已验证的**四段式**(输入 / 推理 / 输出 / 人工修正):

```
flow_template     模板定义(steps[] / variables / level / allowed_domains)
flow_run          一次执行(template_id / 触发方式 / 起止 / 总态)
flow_step_run     ⭐ 每步一行:step_id / type / input / output /
                  reasoning / status(ok|degraded|failed) / missing[] /
                  ts / duration_ms / subject_ref
```

⚠️ **`flow_step_run` 必须记「被跳过 / 被拒绝」的步骤**,不只记成功的。
Module5 §7 已有先例:

> 「被拒绝的操作也记录 …… `reasoning: "REJECTED: domain not in allowed_domains"`」

### 6.4 ⭐ 与 `x_event` 的边界(按用户方法论划)

用户方法论:**先问「这是谁在用」,再决定归哪。**

| | `x_event`(`redesign-06`) | `flow_step_run`(本文) |
|---|---|---|
| 记什么 | **别人对我做的**(赞 / 转 / 回) | **我方系统跑了什么** |
| 数据源 | X 通知页载荷(外部事实) | 我们自己的执行器 |
| 谁在用 | X 业务分析 | 工作流审计 / 排查 |

> ⭐ **两张表,不是一张。** Module5 §7 早有同源划分:
> `ai_conversation`(用户可见内容) vs `task_execution`(决策过程审计)。

---

## 7. ⚠️ 界面:不要照搬 `XInboxView`

用户 2026-09-09:右栏「**不方便也不好用**」,要彻底改造。

**根源实测**:`XInboxView.tsx` **2199 行**,七个子视图靠 `view === 'xxx'`
**整屏互斥切换**,每个都要 `onBack` 退回去 —— **看一个必须关掉另一个**。

> ⚠️ **照搬会生出第二个 2199 行。**

**工作流界面的最低要求**(由本文模型直接推出):

| 要求 | 来自 |
|---|---|
| 看得见 steps 顺序与每步描述 | 用户原话「有描述」 |
| 每步参数可改并持久化 | 用户原话「有配置」;§1.1 那批常量要浮上来 |
| 能重组 steps | 用户选的编排档 |
| 每次执行可回看每步的输入/输出/耗时/为什么跳过 | §6.3 `flow_step_run` |
| ⭐ **能 dry-run** | `replayReplies` 已证明这个形态有用(还给 precision/recall) |

---

## 8. 范围裁定(本文明确不做)

| 不做 | 理由 |
|---|---|
| 条件分支 / 循环 | 用户选「可重组步骤」档;要它就得发明表达式语言 |
| 跨重启任务队列 | §2-3 缺,但独立立项;先让**单次执行**可见可查 |
| 统一 scheduler 抽象 | §2-4 缺,同上;5 处 `setInterval` 现有启停纪律是对的,不急着抽 |
| 把 Note / 图谱 / 邮件接进来 | **X 是第一个模板**,先用真需求逼出正确抽象 |
| 改 Level 0-3 模型 | §3 已证明它与闸门是两层,不冲突;只改 §5.1 一处措辞 |

---

## 9. 待确认(下一轮)

```
□  flow_template 是否复用 search_recipes,还是新表 + 迁移(recipe 是它的特例)
□  steps[] 的 input/output 变量绑定语法(Module5 用 {{var}} 插值,是否沿用)
□  dry-run 的通用形态(replayReplies 是特例,怎么抽)
□  界面形态(与观察窗三方案一并定:浮窗 / 全浮窗 / 底部抽屉)
□  §1.1 那批硬编码常量,哪些浮成模板变量、哪些留常量
□  Module5 §9 待设计十条里,本文覆盖了几条、还剩几条
```

---

## 10. 与其他文档的关系

| 文档 | 关系 |
|---|---|
| `Module5-Agent-设计.md` | **母文档**。本文是它的第一个落地模板,沿用 `Template`/`ExecutionRecord` |
| `web/capability-layer/01-contract.md` | 三态契约(§4.3)、发布闸门(§3)来自这里。⚠️ **工作流是应用层,不进底座** |
| `x/redesign-06-event-table.md` | §6.4 划清边界:`x_event` 记外部事实,`flow_step_run` 记我方执行 |
| `00-architecture/reliability-charter.md` | 「故障必须响 / 留痕 / 对账」是本文 run log 的上位依据 |
| ⭐ `Module5-02-x-pipeline.md` | **本文的第一个落地业务线**(策略→获取→过滤→处理→复核五步)。§4.4 的「输入来自历史」就是被它逼出来的 |

> ⚠️ **底座边界不变**(`01-contract.md` §2):
> `web.page` / `web.input` 永远是原语(`tap` / `type` / `scrollUntil`)。
> **工作流站在原语之上,是应用层的编排,不下沉进底座。**
