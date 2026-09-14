# X 数据获取能力勘查 — 我们究竟能拿到什么

> 立于 2026-09-02。**这是画像设计的前置文档** —— 先搞清底层供给,再谈能构建什么。
>
> 用户定的方法论:
> 「需要你再仔细分析我们从浏览器底层获取到的所有推文的元数据,才能够真正的
>   搞清楚能够做到哪一个地步,**而不是我要求什么,你想什么,怎么实现**。」

---

## 0. 本文档的状态标记

每条结论都标注证据强度,**不许混同**:

| 标记 | 含义 |
|---|---|
| ✅ **实测** | 本机跑过、查过库、看过真实响应 |
| 📖 **有据** | 社区项目代码/文档里写明,未在本机验证 |
| ❓ **待测** | 尚无证据,列出来是为了去测,**不是结论** |
| ❌ **证否** | 曾经这么以为,已被事实推翻(附推翻过程) |

---

## 1. 已被推翻的两个错误结论(留档防复发)

### ❌ 1.1「点赞/转发关系拿不到」

**曾断言**:只能拿到点赞数,拿不到「谁点的」。

**推翻依据**(用户 2026-09-02 截图):X **通知页**明确渲染
`OTun-M liked 2 of your posts`、`哈哈哈哈 liked your reply`、`X reposted`。
**谁做的、对哪条做的,都在页面上。**

**错因**:依据是「推文卡片上只有计数」—— 那只对**时间线页**成立,
却把一个页面的局限当成了整个 X 的局限。
**教训:下结论前把各来源都量一遍,别拿一个页面的观察外推。**

### ❌ 1.2「in_reply_to 全空 = 提取器坏了」

**曾断言**:库里 856 行 `in_reply_to` 全为 NONE,故选择器取错。

**推翻依据**:那 856 行全部来自**关键词配方**(搜 VPN 求助),
返回的本就是原创推 —— **样本里根本没有回复**,字段为空是应然。

**错因**:拿不含该现象的样本论证该现象缺失。
详见 [[feedback-check-sample-contains-phenomenon]]。

---

## 2. 方法二:浏览器底层能拿到什么(本机分析)

### 2.1 四条技术路径(均为本仓已验证可用的机制)

| # | 手段 | 本仓既有实例 | 能拿到的层次 |
|---|---|---|---|
| **A** | DOM 抓取 `executeJavaScript` | `tweet-fetcher/extract-script.ts` | X **渲染后**的可见内容 |
| **B** | **CDP `Network` 捕获响应体** | `ai/interceptor.ts`(抓 Gemini SSE) | X GraphQL **原始 JSON 全量** |
| **C** | Session cookies + 直接请求 | `ytdlp/handlers.ts`(读 YouTube cookies) | 以登录态调 X 自己的接口 |
| **D** | `webRequest` 头部拦截 | `ipc/web-translate-handler.ts` | 请求头(含 auth token) |

> **关键认知**:A(DOM)是 X **渲染之后**的产物,只保留它想显示的部分;
> B/C 拿到的是**渲染之前的全集**。此前所有能力判断都建立在 A 上,
> 这正是把局限误当边界的根源。

### 2.2 ✅ 实测:当前 DOM 路径实际抓到的字段

`extract-script.ts` 全部产出:

| 类别 | 字段 |
|---|---|
| 身份 | `authorHandle` `authorName` `authorAvatar` |
| 内容 | `text` `lang` `media[]`(图/视频) |
| 定位 | `tweetId` `tweetUrl` `createdAt` |
| 计数 | `metrics.likes` `.retweets` `.replies` `.views` |
| 关联 | `quotedTweet`(抓了但**未落库**)、`inReplyTo`(**取法有误**,读的是 socialContext) |

### 2.3 ✅ 实测:落库填充率(860 行,2026-09-02)

```
lang        860/860  100%
metrics     244/860   28%   ← 616 行完全为空
tweet_url   244/860   28%
created_at  216/860   25%
in_reply_to   0/860    0%
```

**616 行是 0 期回填的历史数据,只有正文没有元数据。**
真正抓全的仅近期采集的约 244 行。
→ 现有存量数据**不足以支撑画像**,这是独立于「能抓什么」的另一个问题。

### 2.4 ✅ 实测:GraphQL 原始载荷字段全集(2026-09-02 勘查)

**捕获 29 个响应,发现 1751 个字段路径。**
报告:`userData/x-payload-survey/survey-2026-09-02T10-57-10-226Z.md`(448KB)
原始:同目录 `raw-*.json`(3.2MB,每接口留最大一份,供日后重新分析)

#### 捕获到的核心接口

| 接口 | 大小 | 供给 |
|---|---|---|
| `NotificationsTimeline` | 560KB | **入向关系(谁赞/回/关注我)** |
| `HomeTimeline` | 257KB | 时间线推文全字段 |
| `UserRepliesTimeline` | 242KB | 我的回复流(= `/with_replies`) |
| `UserOriginalsTimeline` | 135KB | 我的原创推 |
| `UserByScreenName` | 2KB | **账号实体(画像基底)** |

> ✅ **回答 §4.9 存疑项**:当前 x.com 走的是 **GraphQL `NotificationsTimeline`**,
> 不是 twikit 用的 v1.1 `all.json`。→ 实现应对齐 GraphQL 版。

#### ✅ 证实:登录态自身互动状态免费自带

```
...tweet_results.result.legacy.favorited    ×33
...tweet_results.result.legacy.retweeted    ×33
...tweet_results.result.legacy.bookmarked   ×33
```
每条推都有,连 `quoted_status_result`(被引用的推)也各带一份。
**社区调研 §4.6 的说法在我们自己的线上得到证实。**

#### ✅ 证实:回复关系权威字段就在载荷里

```
legacy.conversation_id_str        ×33   会话根
legacy.in_reply_to_status_id_str        父推 id
legacy.in_reply_to_user_id_str          被回复者 id
legacy.in_reply_to_screen_name          被回复者 handle
```
→ **彻底作废**此前从 DOM 猜连接线/idx 相邻/正则匹配的三套判据(§1.2 教训)。

#### ⭐ 通知条目结构(入向关系的真源)

`itemContent.__typename = "TimelineNotification"`:

| 字段 | 内容 |
|---|---|
| `notification_icon` | **动作类型** —— `heart_icon`(点赞)/ `recommendation_icon` / `bell_icon` / `report_icon` |
| `rich_message.text` | 人读文案,如「东大-MCGA 红色信仰🇨🇳 liked your reply」 |
| `template.from_users[]` | **具名操作者数组**(含完整 user 对象) |
| `template.target_objects[]` | 被操作的推文 |
| `timestamp_ms` | 精确时间 |
| `notification_url` | 指向具体推文 |

✅ **证实 twikit 的截断确实有害**:实测 `from_users` 长度分布 `[0,1,3,5]`,
**单条通知最多含 5 个具名操作者**。twikit 只取 `[0]` 会丢掉 4 个。
→ 我们自己实现**必须读整个数组**。

#### ⭐ 账号实体字段(画像基底,`UserByScreenName`)

| 字段 | 实测值(本账号) |
|---|---|
| `core.created_at` | `Tue Jan 13 2026` —— **账号年龄** |
| `relationship_counts` | `{followers: 174, following: 48}` |
| `tweet_counts` | `{tweets: 1192, media_tweets: 79}` |
| `action_counts.favorites_count` | `587` —— **该账号点赞总数** |
| `profile_bio.description` | 简介全文 + entities |
| `location` / `website` / `is_blue_verified` / `verification` | 身份属性 |
| `pinned_items.tweet_ids_str` | 置顶推 |
| **`relationship_perspectives`** | `{following, followed_by, blocking, blocked_by, muting, live_following}` |

→ `relationship_perspectives` = **我与此人的关系,零额外请求**。
   `action_counts.favorites_count` 甚至给出对方的点赞总量(活跃度指标)。

#### 其他值得注意的字段簇(见报告全文)

`views`(浏览量)、`edit_control`(编辑历史)、`note_tweet`(长推全文)、
`article`(长文)、`card`(卡片/投票)、`community_results`、
`birdwatch_pivot`(社区注记)、`grok_*`(AI 分析)、`content_disclosure`(AI 披露)、
`source`(发推客户端)、`entities`(链接/话题/@提及)、`possibly_sensitive`。

---

## 3. 关系类型对照表(当前认知)

> ⚠️ 本表经 §4 调研**二次修正**。我先说「拿不到」(错),再说「通知页能拿到」
> (只对了一半)—— 完整事实要区分**三种主体**,而不是出向/入向两种。

| 关系 | 我对别人 | 别人对我 | **第三方对第三方** |
|---|---|---|---|
| **点赞** | ✅ 每条推的 `legacy.favorited` | ✅ **通知页具名(已实测)** | ❌ **不可能**(2024-06 移除) |
| **转发** | ✅ `legacy.retweeted` | ✅ 通知页具名 | 📖 `Retweeters`(2026 未实测) |
| **收藏** | ✅ `legacy.bookmarked` + 书签页 | ❌ X 不通知 | ❌ 不可能 |
| **回复** | `/with_replies` + `in_reply_to_status_id_str` | ✅ 通知页 | ✅ `TweetDetail` |
| **关注** | ✅ `following` 透视字段 | ✅ 通知页 + `followed_by` | 📖 `Followers`(限流紧:50/15min) |
| **引用** | ✅ `quoted_status_id_str` | ❓ | ✅ 载荷自带 |

**三点关键结论**:

1. **「我对别人」几乎全部免费** —— `favorited`/`retweeted`/`bookmarked`/
   `following` 都在**每条推的载荷里**,零额外请求。我此前说「出向待测」是低估了。
2. **「别人对我」靠通知页** —— 具名、含被操作的推,是入向关系的唯一真源。
3. **「第三方对第三方」的点赞永久不可得** —— X 2024 年删了这个能力。
   任何依赖「枚举任意推的点赞者」的画像设计**从根上不成立**,
   与我们的技术水平无关。

> 互动权重提示:点赞很轻,回复/引用很重,可据此加权,而非等量齐观。

### 3.1 ✅ 实测:通知页载荷的具名结构(2026-09-03)

用户指出「点赞/转发名单需要在 notification 中拿到」——**对,且已验证**。
`NotificationsTimeline`(GraphQL,非社区文档说的 v1.1 `all.json`)载荷里:

```
TimelineNotification
  ├── notification_icon   ← **行为类型**:heart_icon(赞) / retweet / bell / ...
  ├── rich_message.text   ← 「呀吰吖 and 2 others liked your reply」
  ├── timestamp_ms
  └── template.（TimelineNotificationAggregateUserActions）
      ├── from_users[]    ← **具名操作者**:user_results.result.rest_id + core.screen_name
      └── target_objects[]← **被操作的推**:tweet_results.result.rest_id
```

实测样本(一条「3 人点赞」的通知):`from_users` **确实是 3 个**,
分别给出 rest_id 与 handle;`target_objects` 给出被赞的推文 id。

⚠️ **注意与社区调研的差异**:§4 引的 twikit 用的是 v1.1 REST
(`globalObjects.notifications`),而 x.com 网页端实际调的是 **GraphQL**,
字段路径完全不同(实测 `globalObjects` 为空)。
→ 按 twikit 的 recipe 写解析会全空,必须按上面这个 GraphQL 结构写。
⚠️ twikit 那个「只取 fromUsers[0]」的坑同样要避开 —— 多人聚合时会丢掉其余的人。

---

## 4. 📖 方法一:社区最佳爬虫能拿到什么(2026-09-02 调研)

### 4.1 ⚠️ 最重要的一条:「谁点赞了」这个能力,X 已经删了

**2024-06-12 起,只有推文作者本人能看到谁点赞了自己的推。**
这是**服务端授权规则**,不是反爬 —— 任何爬虫都恢复不了。
`Favoriters` 接口仍在、库里仍有这个方法,但对不是你写的推,返回空。

→ **这直接推翻了我在 §1.1 的"修正"的一半**:
   我说「通知页能拿到谁点赞」是对的,但那**仅限别人点赞我的推**;
   「谁点赞了任意一条推」**做不到**,且与爬虫水平无关。
   设计画像时,「谁跟我互动过」必须围绕**通知页**建,不能围绕 Favoriters。

来源:[WaPo](https://www.washingtonpost.com/technology/2024/06/12/twitter-likes-hidden-private-x/) ·
[NPR](https://www.npr.org/2024/06/13/nx-s1-5004515/x-likes-hide-users-elon-musk)

### 4.2 项目健康度(GitHub API 实查,2026-09-02)

| 项目 | 最后提交 | 状态 |
|---|---|---|
| [twscrape](https://github.com/vladkens/twscrape) | 2026-08-28 | **最健康**,可作基准 |
| [twifork](https://github.com/PawiX25/twifork)(twikit 分支) | 2026-08-31 | **最活跃** |
| [d60/twikit](https://github.com/d60/twikit) 上游 | 代码停在 2025-04 | **实质停更** |
| [the-convocation/twitter-scraper](https://github.com/the-convocation/twitter-scraper) | 2026-04-01 | 半活跃,**唯一 TS/Node** |
| [twitter-openapi](https://github.com/fa0311/twitter-openapi) | 2026-05-20 | **schema 参考,当前有效** |
| [Nitter](https://github.com/zedeus/nitter) | — | **已归档** —— X 于 2026-08 发 C&D |
| [snscrape](https://github.com/JustAnotherArchivist/snscrape) | 2023-11 | **已死** |

### 4.3 具名关系:谁能拿到

| 关系 | 具名可得? | 途径 |
|---|---|---|
| 谁点赞了**任意**推 | ❌ **不可能**(2024-06 移除) | — |
| 谁点赞了**我的**推 | ✅ | **仅通知页** |
| 谁转发了 | ✅ | `Retweeters` |
| 谁回复了 | ✅ | `TweetDetail`(回复带完整作者对象) |
| 关注者 / 关注中 | ✅ | `Followers` / `Following` |
| 通知 | ✅ | 见 4.4 |

### 4.4 通知页的载荷结构(这是入向关系的真源)

twikit 走的是 **v1.1 REST** 而非 GraphQL:
`https://x.com/i/api/2/notifications/all.json`

响应结构 `globalObjects.{users,tweets,notifications}`,每条通知带:
```
notification.template.aggregateUserActionsV1
  ├── fromUsers      ← 具名点赞者数组
  └── targetObjects  ← 被操作的推文
```

⚠️ **twikit 的解析是有损的**:只取 `fromUsers[0]` 和 `targetObjects[0]`。
「12 人点赞了你的推」它丢掉 11 个。**我们自己实现要读整个数组。**

另有较新的 GraphQL `NotificationsTimeline` 操作(twikit 未用)。
**当前 x.com 网页版实际调哪个?未确认** —— 正是我们的载荷勘查要测的。

### 4.5 GraphQL 操作名(名稳定,queryId 会轮换)

```
Favoriters / Retweeters / Followers / Following / TweetDetail
UserTweets / UserTweetsAndReplies / SearchTimeline / Likes
TweetResultByRestId / UserMedia / NotificationsTimeline
HomeTimeline / Bookmarks / FollowersYouKnow
```
路径 `https://x.com/i/api/graphql/{queryId}/{OperationName}`。
**queryId 每 2-4 周轮换,不能写死** —— 应从 X 的 JS bundle 运行时提取,
或(我们的做法)直接拦截观察。

### 4.6 ⭐ 登录态 webview 的独有优势(schema 实证)

`legacy` 对象的**必填**字段里包含三个布尔位:
**`favorited` / `retweeted` / `bookmarked`** —— 反映**当前登录用户自己**的互动状态。
另有 `core.user_results.result` 的 `UserResultRelationshipPerspectives`:
`following` / `followed_by` / `blocking` / `blocked_by`。

→ **每条推文都免费附带「我是否赞过/转过/收藏过/关注了作者」,零额外请求。**
   这是我们这套架构**强于所有社区库**的地方,也直接回答了
   §3 表里「出向点赞/收藏」那几个 ❓:**能拿到,就在每条推的载荷里。**

其他要点:
- `views` = `{count: string, state}` —— `count` 是**字符串**,
  且 state 为 `Enabled` 时**没有数字**,不能假设字段存在
- `note_tweet`(长推):`legacy.full_text` 会被**截断**,
  真正全文在 `note_tweet.note_tweet_results.result.text`
- `legacy` 还有 `conversation_id_str` / `in_reply_to_status_id_str` /
  `in_reply_to_user_id_str` —— **回复关系的权威字段就在这里**,
  根本不需要从 DOM 猜连接线(见 §1.2 教训)

### 4.7 限流(单账号,15 分钟窗口;来源单一未经实测,存疑)

| 端点 | 限额 |
|---|---|
| `Favoriters` `Retweeters` `Following` `Bookmarks` | 500 |
| **`Followers`** | **50** |
| **`SearchTimeline`** | **50** |
| `notifications/*.json` | 180 |

⚠️ 来源为 twifork 的 ratelimits.md,**未注明测量方法与日期**;
且博客流传的「search 500/15min」与之矛盾。**两者都别信,自己测。**

### 4.8 鉴权

所有可用工具都要求**登录态 cookies(`auth_token` + `ct0`)**,
guest token 已基本无用;twifork 称密码登录端点已被 X 撤除。
→ **这恰好契合我们的架构**:登录态 webview 本来就持有这些 cookie,
  且拦截浏览器自身流量可**绕过 `x-client-transaction-id` 头的生成**
  —— 那正是 2026 年两个 twikit 分支存在的原因(库最常见的崩溃点)。

### 4.9 调研未能证实的(不许当结论用)

- `Retweeters` 在 2026 是否仍返回完整数据 —— 无 2026 实测来源
- `Favoriters` 对**自己的**推是否返回数据 —— 规则说作者可见,但
  未见来源确认 GraphQL 端点(而非 UI)遵守此规则。**一次请求即可自测**
- ~~当前 x.com 实际调 v1.1 还是 GraphQL 通知接口~~ → ✅ **已实测:GraphQL
  `NotificationsTimeline`**(见 §2.4),实现应对齐 GraphQL 版
- 精确限流数字(见 4.7)

---

## 5. 结论:能做到哪一步

§2(本机实测)与 §4(社区调研)已交叉印证完毕。**能力边界现在是清楚的:**

### 5.1 能拿到(已证实)

- **推文全字段**:正文(含长推 `note_tweet` 全文)、时间、语言、
  媒体、`entities`、浏览量、编辑历史、发推客户端、卡片/投票
- **我与每条推的关系**:`favorited` / `retweeted` / `bookmarked` —— 零额外请求
- **我与每个人的关系**:`following` / `followed_by` / `blocking` / `muting`
- **回复关系**:`conversation_id_str` + `in_reply_to_*` 权威字段
- **入向互动**:通知页具名 —— 谁赞了我、谁回了我(单条最多 5 个具名操作者)
- **账号实体**:注册时间、粉丝/关注数、发推数、点赞总数、简介、置顶推

### 5.2 拿不到(硬边界,与技术水平无关)

- **谁点赞了任意一条推**(非我本人的)—— X 于 2024-06 移除,服务端授权规则
- **他人的收藏** —— 从不公开

### 5.3 待实测(有疑问,别当结论)

- `Retweeters` 在 2026 是否仍返回完整数据
- 精确限流(§4.7 来源单一且与博客矛盾)
- 时间线滚动的懒加载封顶(B′ 诊断跑到 60 轮只覆盖 3.2 天,未到底)

### 5.4 一个独立问题:存量数据不足

现有 860 行里 616 行是 0 期回填,**只有正文没有元数据**(§2.3)。
画像要历史纵深,就得**重爬**这部分 —— 这是独立于「能抓什么」的工作量。

---

## 6. 业务目标(用户 2026-09-02 口述,画像的需求来源)

> 记录在此是为了**让能力清单有服务对象** —— 画像本身需要迭代,但目标先定下来。

**主线**:在 X 上找到**需要买 VPN 的人**,回复他们,跟踪点击,
再按「买了 / 没买」分流做进一步画像。

| 人群 | 目标 | 需要的数据能力 |
|---|---|---|
| **潜在客户** | 找到→回复→跟踪点击 | 搜索采集(已有)、回复关系、链接点击归因 |
| **已购买** | 促其**转发**我们的推 | 谁转发了(`retweeted` / 通知页)、历史互动记录 |
| **未购买** | 促其转化 | 互动历史、是否读过/回过、活跃度 |

**后续玩法**:不定期活动 —— 点赞/转发/关注/评价/问卷 → 换积分或流量包。
→ 这要求能**核验**用户是否真做了这些动作:
   - 点赞我的推 → ✅ 通知页 `heart_icon` + `from_users` 具名
   - 转发 → ✅ 通知页 / `Retweeters`(待实测)
   - 关注 → ✅ 通知页 + `relationship_perspectives.followed_by`
   - 评价/问卷 → 走官网 web,不在 X 侧

**最终形态**:X 侧采集 + 官方 API 特有能力 + 自家官网 web 页,三者结合。

### 6.1 这对能力清单的意义

按上述目标回看 §5,**优先级排序**:

1. **回复关系**(最高)—— 主线的第一环:回复了谁、他回没回我
2. **入向互动具名**(高)—— 活动核验与转发促成都依赖它
3. **账号实体字段**(中)—— 分流画像的基底(活跃度/粉丝量/账号年龄)
4. 链接点击归因 —— **不在 X 能力范围内**,需官网侧埋点(`ref=tw_NetLa...`
   参数已在用,见通知页样本),与本文档的采集能力是两条线

---

## 7. 下一步

**先做回复关系**(用户 2026-09-02 拍板)。理由见 §6.1:它是主线第一环,
且权威字段已在载荷里(§2.4),不需要再做任何探索性工作。

画像形态**留待迭代**,不在本轮设计。

---

## 附:相关文档

- [持久化留存/追踪名单/屏蔽名单设计方案](persistent-tracking-and-profiling.md)
- [数据模型总纲](../../00-architecture/data-model-charter.md) — 实体优先/关系第二性/派生可重算
- [B/B'/C 期交接](HANDOFF-phaseB-onward.prompt.md)
