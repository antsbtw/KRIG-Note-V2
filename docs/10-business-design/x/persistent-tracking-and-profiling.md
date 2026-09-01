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
   *(2026-09-01:与 ⑤ 合并为统一的「追踪名单 + 关系层数 n」模型,见 §3)*
3. **已采纳的推文标记出来,不重复爬取**
4. **屏蔽名单**:某用户入名单后,其所有推文和回复都不再爬取
5. **账号追踪名单(watchlist)**:用户按需添加任意账号(**包含自己的账号** ——
   即自己的全部发推与回复),系统追踪该账号所发的**推文和回复**,为其积累画像素材。
   *(2026-08-31 提出,2026-09-01 调整:从「只追踪本账号的回复」泛化为「用户可添加任意账号」)*
   **具体画像怎么做,单独再议** —— 本方案只负责把素材抓全、存住。

> ⚠️ **「追踪名单」≠ X 上的「关注」(follow)**。这是**本 app 内部的一份采集清单**,
> 纯本地概念:
> - **不调用** X 的 follow / unfollow,不改变你在 X 上的社交关系
> - 被追踪的人**不会收到任何通知**,他不知道自己被加进来了
> - 你在 X 上关注了谁,与这份名单**毫无关系**;可以追踪一个没关注的人,
>   也可以不追踪已关注的好友
> - 实现上就是"给这个 handle 建一条 `from:` 搜索配方定期跑",本质是**搜索**,不是社交动作
>
> 命名上一律用「追踪名单 / watchlist」,**避免出现"关注"二字**,防止和 X 的 follow 混淆。
> UI 文案同此约束。

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

### 1.2 五条需求对应的代码现状

| 需求 | 现状 | 位置 |
|---|---|---|
| ① 采纳持久化 | `expires_at` 写入时无条件 `now + 7d`;采纳只改 `status`,**不碰 `expires_at`** → 采纳完照删 | [x-timeline-scan.ts:178](../../../src/platform/main/x/x-timeline-scan.ts#L178)、[x-timeline-handlers.ts:171](../../../src/platform/main/x/x-timeline-handlers.ts#L171) |
| ② 回复用户追踪 | `markReplied` 只在 inbox 打 `status='replied'`,7 天后整行消失。实测 `replied_at IS NOT NONE` = **0 条**,历史回复一条不剩。**且无 author 维度的表** | [tweet-inbox-repo.ts:163](../../../src/platform/main/db/tweet-inbox-repo.ts#L163) |
| ③ 不重复爬 | 去重靠 `getTweetIdSet()`,**该函数忽略传入的 `dedupeWindowHours`**(参数名 `_windowHours`,函数体全表扫 inbox)→ 去重范围 = inbox 存活范围 = **7 天**。7 天前采纳过的,今天当新推文重爬 | [tweet-inbox-repo.ts:80](../../../src/platform/main/db/tweet-inbox-repo.ts#L80) |
| ④ 屏蔽名单 | **机制已有但无来源**:`applyFilter` 里有 `accountBlacklist` 判断([x-timeline-scan.ts:69](../../../src/platform/main/x/x-timeline-scan.ts#L69)),但它来自 `DEFAULT_FILTER_CONFIG` 且**硬编码为 `[]`**、不落库、无 UI —— 调度器直接 `const filterConfig = DEFAULT_FILTER_CONFIG`([x-search-scheduler.ts:55](../../../src/platform/main/x/x-search-scheduler.ts#L55))。所以是"有开关没接线" | [x-timeline-scan.ts:69](../../../src/platform/main/x/x-timeline-scan.ts#L69) |
| ⑤ 回复追踪 | **回复动作本身不落任何库**。见 §1.3 | [x-write.ts:208](../../../src/platform/main/x/x-write.ts#L208) |

### 1.3 需求 ⑤ 的现状:抓得到,但没存

需求从「追踪本账号的回复」泛化成「追踪任意指定账号的推文+回复」后,
关键问题变成:**现有采集链路能不能抓到某账号的全部发言(含回复)?**

实测三个结论:

**(a) `from:` 搜索已支持** —— `buildSearchUrl` 已有 `fromAccounts` → `from:xxx`
([x-timeline-scan.ts:37](../../../src/platform/main/x/x-timeline-scan.ts#L37)),
`SearchRecipe.fromAccounts` 也已落库。所以"追某个账号"这件事,**配方层已经能表达**。

**(b) 但 `from:` 默认不含回复** —— X 搜索的既定行为:`from:xxx` 只返回原创推,
回复要额外加 `include:replies`(或用 `to:` / `filter:replies` 组合)。
当前 `buildSearchUrl` **没有这个开关** → 按现状建配方只能追到该账号的原创推,**回复抓不到**。
这是需求 ⑤ 的主要缺口。

**(c) 抓取脚本其实已经取了关键字段,只是被丢掉** —— 这是个好消息:
`TWEET_SCRAPE_FN_BODY` 已经提取 `createdAt`(推文发布时间)和 `inReplyTo`(回复上下文链接)
([extract-script.ts:75](../../../src/platform/main/tweet-fetcher/extract-script.ts#L75)、
[:147](../../../src/platform/main/tweet-fetcher/extract-script.ts#L147)),
但 `x-timeline-scan.ts` 组装 `TweetInboxRecord` 时**没把这两个字段带上**,
`tweet_inbox` 表也没有对应列 → 信息在内存里存在过,落库时丢弃。

> 所以需求 ⑤ 的成本比想象低:**不需要新的抓取能力,只需要**
> ① 给 `buildSearchUrl` 加 `include:replies` 开关;② 让这两个字段落库。

### 1.3.1 关于「本账号」的特殊性

用户明确要求 watchlist **包含自己的账号**。这带来一个此前方案没有的能力:
自己的发推和回复,可以和别人的一样,**统一走搜索采集**,不依赖
「`pasteReply` 时顺手记一笔」这种脆弱路径。

对比两条路:

| 路径 | 覆盖面 | 可靠性 |
|---|---|---|
| `pasteReply` 埋点 | 只覆盖**通过本 app 发的**回复 | 且无从知道用户是否真的点了发布(红线:绝不程序点发布) |
| **watchlist 搜 `from:自己 include:replies`** | 覆盖**所有**发言,含手机上、网页上发的 | 抓到即事实 —— 搜索结果里存在 = 确实发布了 |

**后者完胜。** 它绕开了原方案 §3.2 ⑤ 里"无法确认是否真的发布"的死结:
不用推断,直接观察结果。

### 1.4 画像的数据底子

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

## 3. ②⑤ 合并:统一为「追踪名单 + 关系层数 n」

用户 2026-09-01 提出:需求 ② 和 ⑤ 能否合并为「追踪指定用户的 n 层关系
(含推文和回复),n=2 起步,未来可扩大」。

**结论:可以合并,但要把 n 的语义钉死** —— 否则"层"是个很容易各说各话的词。

### 3.1 合并的依据

两条需求的差别只是**「谁进名单」**,追踪机制完全相同:

| | 谁进名单 | 追踪什么 |
|---|---|---|
| 需求 ② | 我回复过的人(**自动**入列) | 他的推文和回复 |
| 需求 ⑤ | 用户手动添加的人 | 他的推文和回复 |

**「追踪什么」是同一件事** —— 都是 `from:<handle> include:replies`。
差别仅在入列方式(自动 vs 手动),这正好是 `x_author` 上的一个来源字段能表达的。

所以合并成一个模型:**`x_author.watched=true` 的都追踪**,
再加 `watch_source` 记录"怎么进来的":

```
watch_source  option<string>   'manual' 手动添加 | 'replied' 因我回复过而自动入列
                               | 'expanded' 因关系扩展而入列(n≥2)
watch_depth   int DEFAULT 0    该账号处在第几层(见 2.1.2)
```

> 需求 ② 的"直到手工删除为止"由此天然满足:自动入列的和手动加的一样,
> 只有显式移出才停止追踪。

### 3.2 n 的语义定义(关键)

"n 层关系"必须先说清**边是什么、从哪个点出发**,否则 n=2 可以指三四种不同的东西。

**定义**:以**种子账号**(seed,n=0 层)为起点,沿**互动边**扩展。

| 层 | 含义 | 来源 |
|---|---|---|
| **n=0** | 种子:我自己(`is_self`)+ 用户手动添加的账号 | manual |
| **n=1** | 与种子**直接互动**过的人 | ① 我回复过的人(需求 ②)② 种子回复过的人 ③ 回复过种子的人 |
| **n=2** | 与 n=1 账号直接互动过的人 | 同上规则再走一跳 |

**边从哪来** —— 不需要额外爬取,现有数据就能推导:

- `in_reply_to` 是一个 `https://x.com/<handle>/status/<id>` 形式的 URL
  ([实测](../../../src/platform/main/tweet-fetcher/extract-script.ts#L147),
  URL 格式已验证),**从中直接解析出被回复者的 handle**
- 于是每抓到一条回复,就得到一条边:`author_handle --回复--> in_reply_to 的 handle`

所以关系图是**采集的副产品**,不是新增爬取任务。

### 3.3 但 n≥2 有个必须正视的问题:爆炸

X 上一条热门推可能有上千条回复。若无条件把"回复过 n=1 账号的人"全部纳入 n=2,
名单会在几轮内膨胀到数千账号 —— 而每个被追踪账号都要跑 `from:` 搜索。

**实测参照**:当前 40 天里,仅"我采纳过的作者"就有 **404 个**。
若把这 404 个全设为 n=1 并向外扩一层,n=2 规模极可能上万。

因此 **n≥2 必须带准入门槛**,不能是纯粹的图遍历。候选门槛:

| 门槛 | 说明 |
|---|---|
| 互动次数 | 与上一层账号互动 ≥ k 次才入列(一次性路人不算关系) |
| 我的态度 | 只从"我采纳过/回复过"的账号向外扩,不从泛泛抓到的账号扩 |
| 人工确认 | n≥2 的候选进"待确认"池,由用户点选晋级,不自动追踪 |
| 名额上限 | 追踪总数硬上限(如 200),满了停止自动扩展并告警 |

**建议**:**n=1 自动,n≥2 只产生候选、需人工确认**。
这样既满足"关系可扩展",又不会让采集任务失控。

### 3.4 分期上的处理

合并后**不改变分期顺序**,只是把 ② 的实现方式换成"自动入列 + `watch_depth=1`":

- B' 期:先做 n=0(手动)+ n=1(自动入列),这已覆盖需求 ②⑤ 的全部字面要求
- **n≥2 单独一期**,等 n=1 跑一段时间、看清真实规模后再定门槛

> ⚠️ 数据模型现在就把 `watch_depth` 留好,避免将来加字段回填。
> 但**扩展逻辑不预先实现** —— 门槛怎么定,得看真实数据说话。

---

## 4. 方案

### 4.1 数据模型:两张新表

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

#### `x_author` — 作者画像 + 屏蔽名单 + 追踪名单

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
blocked          bool DEFAULT false 需求 ④:屏蔽,不再爬
blocked_at       option<datetime>
blocked_reason   option<string>
watched          bool DEFAULT false 需求 ②⑤:本地追踪名单(与 blocked 互斥)
watched_at       option<datetime>
watch_source     option<string>     'manual' | 'replied' | 'expanded'(见 §3.1)
watch_depth      int DEFAULT 0      关系层数 n:0=种子 1=直接互动 …(见 §3.2)
is_self          bool DEFAULT false 是否本人账号
note             option<string>     人工备注(画像的手写部分)
```

- **无 TTL**,只有显式删除
- 索引:`handle` UNIQUE、`blocked`(过滤时取黑名单)、`watched`(调度时取追踪名单)

#### watchlist 不新建表 —— 复用 `x_author` + `search_recipes`

需求 ⑤ 初看要一张"追踪名单表",但拆开看,它需要的两样东西**已有归属**:

| 要素 | 落在哪 | 理由 |
|---|---|---|
| "追踪谁" | `x_author.watched: bool` | 和 `blocked` 完全对称 —— 都是"对这个 handle 的长期态度" |
| "怎么抓" | `search_recipes` 里一条 `from:` 配方 | 采集调度已有的机制,不该另起炉灶 |

所以 `x_author` 加两个字段:

```
watched      bool DEFAULT false   需求 ⑤:是否追踪此账号
watched_at   option<datetime>
is_self      bool DEFAULT false   是否本人账号(自己的号也进 watchlist)
```

> **`watched` 与 `blocked` 互斥**:同一 handle 不该既追踪又屏蔽。
> 写入时校验,不靠调用方自觉。

被追踪账号的推文/回复,**照常进 `tweet_inbox` → 采纳/回复时进 `tweet_archive`**。
但 watchlist 抓来的推文有个特殊性:它们是**画像素材**,不是"待处理收件箱条目",
不该混进 AI 判断队列刷屏 —— 见 §4.2 ⑤ 的 `source` 区分。

### 4.2 五条需求的落地路径

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

**不新增过滤逻辑,而是给已有的 `accountBlacklist` 接上数据源** ——
机制已经在 [x-timeline-scan.ts:69](../../../src/platform/main/x/x-timeline-scan.ts#L69),缺的是"谁来填这个数组"。

- 扫描前从 `x_author WHERE blocked = true` 取 handle 列表,注入 `filterConfig.accountBlacklist`
  (和 `seenIds` 同样的预加载模式,不要每条推文查库)
- 复用现有的 `reason: 'account_blacklist'`,不新造 reason 值
- 屏蔽动作发生时,顺带清掉该 handle 在 `tweet_inbox` 里的**存量 pending**(否则名单加了,
  收件箱里他的旧推文还在)
- 需求原文说"所有推文**和回复**都不再爬取" —— 当前采集只走搜索页抓推文,
  没有单独的"抓回复"链路。若将来有,黑名单判断要同样覆盖

#### ⑤ 账号追踪名单(watchlist)

**核心思路:不新造采集链路,把 watchlist 变成一条自动维护的 `from:` 配方。**

**(a) `buildSearchUrl` 加 `includeReplies` 开关**(§1.3 (b) 的缺口)

```
if (recipe.includeReplies) parts.push('include:replies');
```

`SearchRecipe` 加 `includeReplies?: boolean`。这是需求 ⑤ 唯一必须的采集侧改动。

> ⚠️ **待实机验证**:X 搜索语法对 `include:replies` 的支持时有变化,
> 也有用 `filter:replies` / `to:` 的写法。**实施前必须实机 spike 确认哪个真的有效**,
> 不能照文档假设(参照 X selector 屡次改版的教训)。

**(b) 让 `createdAt` / `inReplyTo` 落库**(§1.3 (c) 的缺口)

`tweet_inbox` + `tweet_archive` 各加两列:

```
created_at    option<datetime>   推文自身的发布时间(区别于 fetched_at 抓取时间)
in_reply_to   option<string>     回复上下文链接;非空 = 这是一条回复
```

- 抓取脚本已经提取,只是组装 record 时漏了 —— **改 3 行的事**
- `created_at` 对画像是刚需:没有它只能按"我们抓到的时刻"排序,时序分析会失真
- `in_reply_to` 让"推文 vs 回复"可区分 —— 需求 ⑤ 明确要"推文和回复"都追

**(c) watchlist → 配方的映射**

两种做法:

| 方案 | 做法 | 评价 |
|---|---|---|
| **A. 单条聚合配方**(推荐) | 所有 `watched` 账号合成一条配方:`(from:a OR from:b) include:replies` | X 搜索原生支持 OR;一次扫描覆盖全部追踪对象,省配额。**但账号多了 URL 会超长** —— 需分批(建议每批 ≤ 10 个 handle) |
| B. 每账号一条配方 | 加一个账号建一条 recipe | 调度粒度细、单账号可单独禁用;但配方数量随追踪账号数线性增长,调度器压力大 |

**取 A + 分批**。

**(d) watchlist 推文不进 AI 判断队列**

被追踪账号的推文是**画像素材**,不是"值不值得回复"的候选。若混进 `status='pending'`,
会把 Gemma 判断队列刷爆,也污染收件箱。

做法:watchlist 采集写库时 `source='watchlist'`(现有 `source` 字段,当前恒为 `'search'`),
且 `status` 直接置为终态(不进 pending)。UI 上单独一个"追踪动态"视图看,
与"待处理收件箱"分开。

**(e) 自己的账号**

`is_self=true` 的 handle 同样走上面的链路 —— 自己发的推和回复被 `from:自己 include:replies`
抓回来。这**比在 `pasteReply` 埋点更可靠**(见 §1.3.1):
覆盖手机/网页发的,且"搜到了"本身就证明"确实发布了",绕开原方案的确认死结。

> 因此**原设计里的 `reply_log` 表取消** —— 它要解决的"我回复过谁 + 是否真发布",
> watchlist 用观察结果直接回答,不需要推断层。

**(f) UI:追踪名单是一份可增删的本地清单**

用户对这份名单的操作面(具体视觉待设计,此处只定语义):

| 动作 | 入口 | 说明 |
|---|---|---|
| 加入追踪 | 推文卡片右键 / 追踪名单页的"添加"输入框 | 输入 `@handle` 即可,**不校验此人是否被 X 关注**,也不校验是否互关 |
| 移出追踪 | 追踪名单页 | 移出后停止采集;**已抓到的历史数据保留**(对齐 Q2 对屏蔽的处理口径) |
| 标记为本人账号 | 追踪名单页 | `is_self=true`,用于"我的发言"视图与他人区分 |
| 查看追踪动态 | 独立视图 | 按 handle 分组,展示其推文/回复;与"待处理收件箱"分开 |

措辞约束:界面上称**"追踪"/"追踪名单"**,不用"关注"/"订阅"。
加入时若该 handle 已在屏蔽名单,应提示冲突而非静默覆盖(两者互斥)。

---

## 5. 未决问题(需用户拍板)

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

### Q3. 画像的形态 —— 用户已明确「单独再议」

用户 2026-09-01 明确:**画像具体怎么做单独考虑**,本方案只负责把素材抓全、存住。

因此本方案对画像只做**最低承诺**:`x_author` 上的计数字段(seen/accepted/replied)
+ `note` 人工备注 + 明细可按 `author_handle` 回查 `tweet_archive`。

话题聚合、Gemma 整体评价、互动时间线等**不在本方案范围**,待单独立项。
但设计上留好接口:`created_at` / `in_reply_to` / `lang` / `metrics` 都落库,
将来做任何形态的画像都不必回头补数据。

### Q4. `tweet_archive` 会长多大?

按当前节奏(日均采纳 ~16 条 + 回复):**一年约 6000 行,文本量 < 5 MB**。
磁盘上完全不是问题(前置的磁盘排查已确认 X 数据一年仅 5 MB 量级)。

### Q5. watchlist 的抓取频率与深度?

被追踪账号的推文/回复要多久抓一次、往回追多远?

- **频率**:复用 `SearchRecipe.intervalMinutes`。但追踪对象活跃度差异大,
  统一间隔可能过密(浪费)或过疏(漏推)
- **深度**:`sinceHours` 默认 24。新加入 watchlist 的账号,要不要一次性回溯抓取历史?
  (X 搜索能翻多远受限,且翻页成本高)

*建议*:先用统一间隔 + 只抓增量(不回溯历史),跑一段时间看漏没漏,再调。
避免一上来做复杂的自适应调度。

---

## 6. 影响面 / 风险

| 项 | 说明 |
|---|---|
| Schema migration | 新增两表 + 给 tweet_inbox 加 created_at / in_reply_to 两列,走 `migration_1_9_x`。**教训**:`option<array>` 是 parse error、DDL 单条失败会拒收整段(见记忆 `project-surreal-flexible-parse-error`) |
| option 字段写值 | 写 `option<T>` 必须传 `undefined` **不能传 `null`**(见记忆 `project-surreal-none-vs-null`) |
| 去重范围扩大 | `inbox ∪ archive` 后集合持续增长。当前量级(万级)全量 SELECT 无压力;**十万级以上需改索引查询**,届时再优化,现在不预先设计 |
| 归档写失败 | 必须 fail loud —— 采纳动作要么整体成功要么报错,不能出现"UI 显示已采纳但没归档" |
| 已有 `ws_id`/`task_id` | 这两个字段**已由后续 migration 补进 schema**([schema.ts:508](../../../src/storage/surreal/schema.ts#L508)、[:577](../../../src/storage/surreal/schema.ts#L577)),实测 4152 行有值。归档表照抄时别漏 |

---

## 7. 分期建议

| 期 | 内容 | 价值 |
|---|---|---|
| **A** | `tweet_archive` 表 + 采纳/回复时归档 + 去重并入 archive | **止血**:从今天起不再丢数据、不再重复爬(需求 ①③) |
| **A'** | `tweet_inbox`/`archive` 加 `created_at` + `in_reply_to` 两列并落库 | 3 行改动,但决定了后续能不能区分"推文 vs 回复"、能不能按真实发布时间排序。**越早做,积累的数据越完整** |
| **B** | `x_author` 表 + 屏蔽名单接上数据源 + 屏蔽 UI | 需求 ④,独立可验收 |
| **B'** | watchlist:`include:replies` 开关(先 spike)+ 聚合配方 + 追踪名单 UI | 需求 ⑤。依赖 B 的 `x_author` 表 |
| **C** | 画像聚合 + UI 呈现 + 存量回填 | 需求 ②。**画像具体形态用户说单独再议**,本期只保证素材齐备 |

A / A' 期最紧急 —— **每多等一天就多丢一天的采纳正文和回复记录**。

---

## 8. 下一步

本文档仅为方案,**未开工**。待用户对 §5 的 Q1~Q5 拍板后再进入实施。
