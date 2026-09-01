# X 持久化留存 · 用户画像 · 屏蔽名单 — 设计方案

> v0.1 · 2026-08-31 · **设计中,未开工**
>
> 关联记忆条目:`project-x-timeline-intelligence`(Phase 1-3a 已验收)、
> `project-x-integration-status`(X 集成总进度)
>
> 相关代码:
> - [x-timeline-scan.ts](../../../src/platform/main/x/x-timeline-scan.ts) — 采集 + 过滤 + 写库
> - [tweet-inbox-repo.ts](../../../src/platform/main/db/tweet-inbox-repo.ts) — 表 CRUD
> - [x-timeline-handlers.ts](../../../src/platform/main/x/x-timeline-handlers.ts) — 采纳/回复 IPC
> - [schema.ts](../../../src/storage/surreal/schema.ts) §tweet_inbox

---

## 0. 需求(用户 2026-08-31 提出)

1. **采纳的推文持久化保留**,不再只留一周
2. **已回复的用户持续追踪做画像**,直到手工删除为止
3. **已采纳的推文标记出来,不重复爬取**
4. **屏蔽名单**:某用户入名单后,其所有推文和回复都不再爬取

---

## 1. 现状体检(实测,非推断)

### 1.1 数据已经在丢

2026-08-31 查库实测:

| 指标 | 数值 |
|---|---|
| `tweet_feedback` 历史采纳(去重) | **607 条** |
| 其中 `tweet_inbox` 里仍存在 | **158 条** |
| **已被 TTL 删掉正文/metrics** | **449 条(74%)** |

`tweet_feedback` 只存 9 个字段(`tweet_id / text / lang / author_handle / verdict / reason_tag / source_recipe / created_at / ai_verdict`),
**没有 metrics、没有 author_name、没有 tweet_url**。所以这 449 条虽然还知道"采纳过",
但推文的互动数据、作者展示名、原链接**已永久丢失**。

> 这不是将来的风险,是已经付出的代价。需求 ① 的紧迫性由此确立。

### 1.2 四条需求对应的代码现状

| 需求 | 现状 | 位置 |
|---|---|---|
| ① 采纳持久化 | `expires_at` 写入时无条件 `now + 7d`;采纳只改 `status`,**不碰 `expires_at`** → 采纳完照删 | [x-timeline-scan.ts:178](../../../src/platform/main/x/x-timeline-scan.ts#L178)、[x-timeline-handlers.ts:171](../../../src/platform/main/x/x-timeline-handlers.ts#L171) |
| ② 回复用户追踪 | `markReplied` 只在 inbox 打 `status='replied'`,7 天后整行消失。实测 `replied_at IS NOT NONE` = **0 条**,历史回复一条不剩。**且无 author 维度的表** | [tweet-inbox-repo.ts:163](../../../src/platform/main/db/tweet-inbox-repo.ts#L163) |
| ③ 不重复爬 | 去重靠 `getTweetIdSet()`,**该函数忽略传入的 `dedupeWindowHours`**(参数名 `_windowHours`,函数体全表扫 inbox)→ 去重范围 = inbox 存活范围 = **7 天**。7 天前采纳过的,今天当新推文重爬 | [tweet-inbox-repo.ts:80](../../../src/platform/main/db/tweet-inbox-repo.ts#L80) |
| ④ 屏蔽名单 | `applyFilter` 无 handle 黑名单路径,**完全没有** | [x-timeline-scan.ts](../../../src/platform/main/x/x-timeline-scan.ts) |

### 1.3 画像的数据底子

- 采纳 633 行,涉及 **404 个不同作者**;头部作者采纳 7~10 次
- 说明:互动是**长尾**的,画像价值在"少数高频互动者"这一小撮上
- `tweet_feedback` 保留 40 天完整无断档(7-23 起),是唯一的长期档案

---

## 2. 设计原则

1. **归档与工作台分离** —— `tweet_inbox` 保持"最近一周工作台"的定位(TTL 是特性不是 bug,
   它防止收件箱无限膨胀);持久数据进独立的归档表。
2. **画像与屏蔽同源** —— 二者都是"以 handle 为单位的长期记忆",不该拆成两张表。
3. **删除是显式的** —— 需求 ② 说"直到手工删除为止",所以画像表**无 TTL、无自动清理**。
4. **fail loud** —— 归档写失败必须报错,不能静默吞掉(否则又是"看着成功实际没有")。

---

## 3. 方案

### 3.1 数据模型:两张新表

#### `tweet_archive` — 采纳/回复推文的永久档案

字段**照抄 `tweet_inbox` 全集**(含 metrics / author_name / tweet_url / ai_verdict),
额外加归档语义字段:

```
archived_at   datetime        归档时刻
archive_kind  string          'accepted' | 'replied'  —— 为何进档
replied_at    option<datetime>
reply_text    option<string>  实际回复内容(现在没存,画像要用)
```

- **无 `expires_at`**,TTL 的 `DELETE ... WHERE expires_at < now()` 天然够不着
- `tweet_id` UNIQUE 索引
- 索引:`author_handle`(画像聚合)、`archived_at`(时序)

#### `x_author` — 作者画像 + 屏蔽名单

主键 `handle`。**画像和屏蔽合表**,因为都是"关于这个人的长期记忆":

```
handle           string  UNIQUE     @xxx
display_name     option<string>     最近一次见到的展示名
avatar           option<string>
first_seen       datetime
last_seen        datetime
seen_count       int                累计爬到过几条
accepted_count   int                累计采纳几条
replied_count    int                累计回复几次
last_replied_at  option<datetime>
blocked          bool DEFAULT false 需求 ④
blocked_at       option<datetime>
blocked_reason   option<string>
note             option<string>     人工备注(画像的手写部分)
```

- **无 TTL**,只有显式删除
- 索引:`handle` UNIQUE、`blocked`(过滤时快速取黑名单)

### 3.2 四条需求的落地路径

#### ① 采纳持久化

**关键约束(实测)**:`expires_at` 当前是 `TYPE datetime`,**不是 `option<datetime>`**
([schema.ts:462](../../../src/storage/surreal/schema.ts#L462))。所以"采纳时把 `expires_at` 设成 NONE
让 TTL 跳过"这条路**走不通** —— 会撞类型断言。

两个可选实现:

| 方案 | 做法 | 评价 |
|---|---|---|
| **A. 归档表**(推荐) | 采纳时把整行 copy 进 `tweet_archive`,inbox 那行照常过期 | 职责清晰;inbox 保持"工作台"语义不膨胀;代价是一次 copy |
| B. 改 `expires_at` 为 option | migration 改类型 + 采纳时设 NONE | 少一张表,但 inbox 会混进永久行,"收件箱"语义被污染;且改 SCHEMAFULL 字段类型要走 REMOVE + DEFINE(见记忆条目 `project-surreal-flexible-parse-error` 的教训) |

**取 A。**

#### ② 回复用户追踪 + 画像

- `markReplied` 时:归档整行进 `tweet_archive`(`archive_kind='replied'`)+ upsert `x_author`
  (`replied_count += 1`、`last_replied_at`)
- **顺带补上现在缺失的 `reply_text`** —— 画像要看"我跟他聊了什么",光有 `replied_at` 没用
- 画像页从 `x_author` 读聚合,明细回 `tweet_archive` 按 `author_handle` 查

#### ③ 不重复爬

改 `getTweetIdSet()`:去重集合从 `inbox` 改为 **`inbox ∪ archive`**。

顺带修掉那个**参数被忽略的 bug**(`_windowHours` 收了不用)—— 要么真正实现窗口语义,
要么把参数删掉。**倾向删参数**:既然归档表是永久的,"窗口"这个概念本身就不再成立,
留着只会误导。

UI 侧:inbox 列表对"曾采纳过"的推文显示标记(查 archive 命中即标)。

#### ④ 屏蔽名单

- `applyFilter` 增加一路:`author_handle ∈ blockedSet` → `pass=false, reason='blocked'`
- 扫描开始前一次性加载 `blockedSet`(和 `seenIds` 同样的预加载模式),不要每条推文查库
- 屏蔽动作发生时,顺带清掉该 handle 在 `tweet_inbox` 里的**存量 pending**(否则名单加了,
  收件箱里他的旧推文还在)

---

## 4. 未决问题(需用户拍板)

### Q1. 存量 449 条已丢正文的采纳,要不要回填进 `tweet_archive`?

`tweet_feedback` 里还留着 `text` 和 `author_handle`(缺 metrics/url/author_name)。

- **回填**:画像有 40 天完整底子,404 个作者的互动史立刻可用;代价是这批行的 metrics 为空
- **不回填**:archive 从今天起干净一致,但画像前 40 天是空白

*倾向回填* —— 画像关心的是"我跟谁互动过",有 text + handle 就够用;metrics 缺失可以标记为
`backfilled: true` 以示区分。

### Q2. 屏蔽用户时,其历史数据如何处理?

需求原文是"所有推文和回复都不再爬取"。但**已归档的**那些:

- **留着**(倾向):画像和统计需要历史;"不再爬取"约束的是未来,不是抹除过去
- **一并删除**:彻底干净,但会让采纳率等统计数字回溯性变动

### Q3. 画像要做到什么程度?

当前设计只做**计数型画像**(seen/accepted/replied 次数 + 人工备注)。是否需要:

- 语言分布、话题标签聚合?
- Gemma 对该作者的整体评价?
- 互动时间线可视化?

*建议先只做计数 + 备注*,等真用起来再看缺什么 —— 避免设计过度。

### Q4. `tweet_archive` 会长多大?

按当前节奏(日均采纳 ~16 条 + 回复):**一年约 6000 行,文本量 < 5 MB**。
磁盘上完全不是问题(前置的磁盘排查已确认 X 数据一年仅 5 MB 量级)。

---

## 5. 影响面 / 风险

| 项 | 说明 |
|---|---|
| Schema migration | 新增两表,走 `migration_1_9_x`。**教训**:`option<array>` 是 parse error、DDL 单条失败会拒收整段(见记忆 `project-surreal-flexible-parse-error`) |
| option 字段写值 | 写 `option<T>` 必须传 `undefined` **不能传 `null`**(见记忆 `project-surreal-none-vs-null`) |
| 去重范围扩大 | `inbox ∪ archive` 后集合持续增长。当前量级(万级)全量 SELECT 无压力;**十万级以上需改索引查询**,届时再优化,现在不预先设计 |
| 归档写失败 | 必须 fail loud —— 采纳动作要么整体成功要么报错,不能出现"UI 显示已采纳但没归档" |
| 已有 `ws_id`/`task_id` | 这两个字段**已由后续 migration 补进 schema**([schema.ts:508](../../../src/storage/surreal/schema.ts#L508)、[:577](../../../src/storage/surreal/schema.ts#L577)),实测 4152 行有值。归档表照抄时别漏 |

---

## 6. 分期建议

| 期 | 内容 | 价值 |
|---|---|---|
| **A** | `tweet_archive` 表 + 采纳/回复时归档 + 去重并入 archive | **止血**:从今天起不再丢数据、不再重复爬(需求 ①③) |
| **B** | `x_author` 表 + 屏蔽名单接进 `applyFilter` | 需求 ④,独立可验收 |
| **C** | 画像聚合 + UI 呈现 + 存量回填 | 需求 ②,依赖 A/B 的数据积累 |

A 期最紧急 —— **每多等一天就多丢一天的采纳正文**。

---

## 7. 下一步

本文档仅为方案,**未开工**。待用户对 §4 的 Q1~Q3 拍板后再进入实施。
