# X 重整 · 06 · 事件表设计(`x_interaction` → `x_event`)

> 立于 2026-09-09。承接 `redesign-03`(三元模型)、`redesign-05`(推文拆分)。
> 用户拍板:**扩,不是拆** —— 表的形状已经对了,改唯一键 + 补数据源。
>
> **本文是设计,不含实现。** 这是 X 数据模型的最后一张表。

---

## 0. 结论:这张表和前两张性质不同

| | `x_author` / `x_tweet` | `x_interaction` |
|---|---|---|
| 病 | **一表多语义** | ⚪ **形状已经对了** |
| 做法 | **拆开** | ⭐ **扩大适用范围 + 改唯一键** |

它的字段(`kind` · `actor_uid` · `target_id` · `notified_at` · `target_*` 快照)
**已经是事件表该有的样子** —— 是 X 通知页载荷的直接投影。

---

## 1. ✅ 全量入库策略已经对了,不要动

**用户 2026-09-03 就定过一次**(`x-notifications.ts:273-279`):

> 「**不要过滤,入库后前端就可以请求了**」……
> 原先在**采集层**就把推荐流丢掉,结果是**丢掉的永远查不回来** ……
> 现在改为:**全部入库**,是不是互动交给**查询层**判断

⭐ **这与 `web/capability-layer/01-contract.md` §13 的「缓存层无条件收下一切」是同一条原则** ——
只是你在这张表上先定了一次。

**代码里的证据**:`isRealInteraction()`(`x-notifications.ts:84-90`)存在,
但 doc 注释明写「**不要拿它在采集层过滤**」,**全仓无调用方** ——
它是被**有意搁置**的过滤器。

> ⚠️ **迁移时不要「顺手启用」它。**

---

## 2. ⚠️ 要改的:唯一键 —— 从「状态去重」变「事件流水」

### 2.1 现状

```sql
idx_interaction_key  FIELDS kind, actor_uid, target_id  UNIQUE
```

**唯一键不含时间,也不含 `ws_id`。** 后果:

| 场景 | 现在 |
|---|---|
| 同一人对同一条推**做两次**(取赞再点赞) | ⚠️ **只有一行** |
| 同一互动在**两个 ws** 下 | ⚠️ **只存一行**,先写的占坑 |

**所以它是「状态去重表」,不是「事件流水」。**
它能回答「他赞过吗」,**回答不了「他什么时候赞的、赞过几次」**。

### 2.2 为什么必须改

`redesign-03` §3 定的三元里,**「事件」的全部价值就在于它是流水**:

> `x_event` 别人对我做的 ← **事实,X 推来的流水**

**证据支持它该是流水**:通知页载荷**自带 `timestamp_ms`**
(`x-notifications.ts:267`)—— X 给的就是一条条带时刻的记录,
现在被去重压成了一行。

### 2.3 改法

```
唯一键:(kind, actor_uid, target_id, notified_at)
```

⚠️ **`ws_id` 要不要进唯一键**:
- 进 → 两个 ws 各存一行(**同一件事记两次**)
- 不进 → 保持现状(先写的占坑,**但另一个 ws 查不到**)

⭐ **倾向:不进唯一键,但保留 `ws_id` 字段记「哪个 ws 先看到的」。**
理由:「他赞了我的推」**是一个客观事实**,不因为我开了两个 ws 就变成两件事
—— 与 `redesign-03` §5「客观 vs 我方」的划分一致。

---

## 3. ⭐ 补数据源:「我对别人」不进事件表,进观察表

### 3.1 现在只有一个数据源

`harvestNotifications` **只吃 URL 含 `Notifications` 的响应**
(`x-notifications.ts:396`)。

**所以只有「别人对我」进得来。**

### 3.2 但「我对别人」的信息是免费自带的

每条推的载荷都挂着(能力勘查文档实测):

```
legacy.favorited     ×33
legacy.retweeted     ×33
legacy.bookmarked    ×33
```

**现在没有任何地方收它。**

### 3.3 ⭐ 它归观察,不归事件

按 `redesign-03` §3 的判据:

| | 载荷给什么 | 归哪 |
|---|---|---|
| 别人对我 | **事件**(带 `timestamp_ms`) | `x_event` |
| **我对别人** | ⚠️ **状态**(`favorited: true`,**无时间**) | ⭐ **`x_tweet_obs`** |

**所以 `x_tweet_obs` 要补三个字段**:

```
x_tweet_obs   tweet_id · observed_at
              · likes · retweets · replies · quotes · bookmarks · views
              ⭐ · i_favorited · i_retweeted · i_bookmarked
```

⭐ **这很自然** —— 它们本来就在**同一个载荷**里:
「这条推有多少赞」和「我赞没赞」是同一眼看到的。

> ⚠️ **由观察推断出的「我什么时候赞的」是分析结果**,
> 不可存成 `x_event` 假装确定(`redesign-03` §3.2)。

---

## 4. ⚠️ 顺带发现:判定与落库两套标准

`x-campaign-loop.ts:73-75` 的 bug 复盘注释:

> `x_interaction` 也有这条,唯独 `x_campaign_reply` 收不到 ——
> **判定与落库用了两套标准**

**同一件事在两个地方各判一次,判据漂了就静默丢数据。**

⭐ **新模型天然缓解**:`x_event` 全量入库,
campaign 的收窄**只在查询层做**(`verifyListForArticle`)——
**判定只有一处,落库没有判定。**

---

## 5. `kind` 的现状(不改,但要知道)

**7 个取值,两条推导路径,值集不重叠**:

| 路径 | 来源 | 产出 |
|---|---|---|
| A `iconToKind` | `notification_icon` + 文案兜底 | like / retweet / follow / reply / quote / mention / **other** |
| B `TimelineTweet` | `in_reply_to_screen_name` / `quoted_status_id_str` | **只有** reply / quote |

⚠️ **两处已知的不确定**:

1. `retweet` 的 icon 判据**未实机验证**(`x-notifications.ts:69-72` 标着「📖 未实测」)
2. `recommendation_icon`(推荐流)**占实测样本 16 条里的 13 条**,
   被归入 `other` 并全量入库

⚠️ **下游消费不一致**(事实,不是本次要改的):
`verifyListForArticle` 只认 4 种、`interactionsForTarget` 只认 3 种、
`interactionsToContractItems` 只认 2 种、UI 认全 7 种。

> `follow` / `mention` / `other` **入库但除了计数无人读**。

---

## 6. 迁移

⭐ **比前两张简单得多** —— 只改唯一键 + 加字段,**不拆表、不搬数据**。

| 步 | 做什么 | 风险 |
|---|---|---|
| 1 | 改唯一键加 `notified_at` | ⚠️ **老行 `notified_at` 可能为空**(`option<datetime>`)—— 空值怎么参与唯一键要定 |
| 2 | `x_tweet_obs` 加三个 `i_*` 字段 | 低(纯新增) |
| 3 | 采集端开始收 `favorited/retweeted/bookmarked` | 低 |
| 4 | (可选)表改名 `x_interaction` → `x_event` | ⚪ 纯改名,可最后做 |

### 6.1 ⚠️ 老行 `notified_at` 为空怎么办

`notified_at` 是 `option<datetime>` —— **老行可能没有时间**。

加进唯一键后,一批 `notified_at = NONE` 的行会**互相冲突**。

**待定**:用 `first_seen_at`(必填)兜底?还是老行保持去重语义、新行才是流水?

---

## 7. 已定 / 待定

### 已定(2026-09-09)

| # | 决定 |
|---|---|
| 1 | ✅ **扩不拆** —— 形状已经对了 |
| 2 | ✅ **保留全量入库**(用户 2026-09-03 已定,不要顺手启用 `isRealInteraction`) |
| 3 | ✅ **唯一键加时间** —— 从状态去重变事件流水 |
| 4 | ✅ **`ws_id` 不进唯一键** —— 客观事实不因多 ws 变成两件事 |
| 5 | ✅ **「我对别人」进 `x_tweet_obs`**,不进事件表 |

### 待定

1. §6.1 老行 `notified_at` 为空怎么处理
2. `kind` 下游消费不一致(4/3/2/7 种)—— 要不要统一
3. `retweet` 的 icon 判据未实测 —— 要不要专门验一次

---

## 8. ⭐ X 数据模型至此完整

| 原表 | 去向 |
|---|---|
| `x_author` | → `x_person` / `x_person_obs` / `x_social` / `x_stance`(`redesign-04`) |
| `x_tweet` | → `x_tweet` / `x_tweet_obs` / `x_my_verdict` / `x_my_action` / `x_tweet_source`(`redesign-05`) |
| `tweet_feedback` | → ⚪ **不迁**(`redesign-05` §8) |
| `x_interaction` | → `x_event`(**本文**:扩不拆) |

**三元(人 / 推文 / 事件)+ 两类我方视角(观察 / 关系)全部落地。**
