# 立项:长文正文逐篇补全(`x.articles` 只拿到标题+摘要)

> 2026-09-21 立项,**零代码**。由 `docs/handoff/x-page-collection-verification.md`
> 「剩下的活」第一条转来。
> ⚠️ 动手前先读「先做 Spike」一节 —— **这个立项的前提还没被证实**。

---

## 一句话

`x.articles` 列表页的载荷里**没有正文**(实测 72 条,`content_state` 0 命中),
只有 `title` + `preview_text`。要拿到几千字正文,**得逐篇进详情页**。

---

## 为什么值得做

长文是**自家和竞品的主要内容形态**(OTun-M 的推广文都是长文)。
库里只存标题(7 字)+ 摘要,**检索和 AI 判断都用不上** ——
判断层拿 7 个字决定「值不值得回复」,等于没有输入。

bug ⑥ 已经证明**正文拿到手就是几千到一万六千字**
(`2099916828529082572`:23 字 → 16081 字)。

---

## ⚠️⚠️ 前提还没被证实 —— 先做 Spike,别直接开工

整个立项压在一句话上:**「正文只在单篇页(`TweetDetail`)的载荷里才有」**。

⚠️ 这句话的来源是**列表页的反面推论**(列表页没有 → 猜详情页有),
**不是实测**。我 2026-09-21 找过证据,**没找到**:

| 想验的 | 实际情况 |
|---|---|
| 归档里的 `TweetDetail` 真载荷 | **一份都没有**(`detail-*.json` 留档是 2026-09-06 加的,而 campaign 跑在**另一台 Windows**,Mac 上这目录里没有) |
| `replies-*.json` 里有没有 `content_state` | ⚠️ **问错了对象**:那 8 个文件是**结果摘要**(键是 `handle/rounds/relations/stopReason`),**不是原始载荷**,本来就不可能有 |
| 别的归档里的 `article` 结构 | 9 个(来自 notifications / 时间线),**键集与列表页完全一样**、`content_state` 0 命中 —— 既不能证实也不能证伪详情页 |

⭐ **所以第一步不是写代码,是花十分钟拿一份真的 `TweetDetail` 载荷**:

1. `npm start`,内置浏览器打开**任意一篇长文的详情页**
   (`https://x.com/<handle>/status/<articleId>`)
2. 在 `fetchArticleReplies` 已有的留档处(`x-article-replies.ts` 里
   `x-payload-survey/detail-*.json`)拿到 body,或临时打一行诊断
3. 搜 `content_state` —— **有,这个立项成立;没有,整个方案要换**

⚠️ **没有的话别硬写**。那意味着正文根本不在 GraphQL 载荷里
(可能要读 DOM,或有独立的 article 接口),方案完全不同。
**这正是「别猜结构」那条教训**(bug ⑥ 的正文位置就是靠打真实载荷定位的,不是读代码猜的)。

---

## ⭐ 好消息:导航和捕包**不用从零搭**

`src/platform/main/x/x-article-replies.ts` 的 `fetchArticleReplies` 已经做完了
这个立项的大半基础设施:

| 它已经做的 | 行(2026-09-21 核对) |
|---|---|
| `wc.loadURL('https://x.com/{h}/status/{id}')` 进详情页 | `252` |
| `wc.debugger.attach('1.3')` + `Network.enable` + 抓 `/i/api/graphql/` 响应体 | `245` |
| **只吃 `TweetDetail` 响应**,并把原始 body 留档到 `x-payload-survey/detail-*.json` | `216` |
| 轮询等首个 detail 响应(不再干等 4.5s) | `257` |
| `extractTweetsFrom(JSON.parse(r.body), tweets)` —— **就是带长文解析的那个解析器** | `238` |

⭐⭐ **最关键的一点**:`extractTweetsFrom` 读的是 tweet 对象上的 `o.article`,
而 bug ⑥ 的正文解析就写在那里。**如果详情页把 `content_state` 放在同一层,
那么正文解析已经自动生效了** —— 这个立项可能只剩「跑一趟 + 入库」,
甚至不用碰解析器。

⚠️ 所以 Spike 要同时回答第二个问题:**跑一趟 `fetchArticleReplies` 之后,
`tweets` Map 里那条根推的 `text` 是几个字?** 如果已经是几千字,
剩下的活就只是「把它 upsert 进库」。

---

## 已知约束(踩过的坑,别重走)

1. ⚠️ **`fetchArticleReplies` 是 campaign 专用的,别直接借用**。
   它 `resolveAnyXWebContents`(无人值守)、只用 `role='campaign'` 的 ws
   (用户 2026-09-03 拍板「一个 ws 只干一件事」),而且**跑在另一台 Windows 机器上**。
   补正文是**采集侧**的活,要走采集侧的 ws 和 wcId,
   **不要把两条线缠在一起**(否则现象是「活动偶尔抓不到」,极难定位)。
   → 正确做法:把「进详情页 + 捕 TweetDetail」这段**抽成共用底座**,两边各自调用。

2. ⚠️ **不要复用 `harvestTimeline` 去翻详情页**。
   2026-09-03 实测踩过:「翻到 42 条 → 属于本文章 0 条」,日期空洞跨 48 天 ——
   时间线滚动器会一路滚进推荐流。详情页要的是 `TweetDetail`,不是长途滚动。

3. ✅ **`upsertTweet` 会更新 `text`** —— 已核对:`ON DUPLICATE KEY UPDATE`
   子句里有 `text = $text`,所以「重采同一篇、把摘要换成正文」**落得进去**。
   ⚠️ 但它**只**更新采集该负责的字段(`accepted`/`ai_verdict`/`translation`
   是人工与 AI 填的,覆盖不可逆)。加任何新字段要**登记四处**
   (schema / 类型 / toRecord / **写库 SQL 的 SET+参数两处**)。

4. ⚠️ **内容少的页面滚不动就采不到**,这是机制不是 bug。
   逐篇采是**点名取单篇**,不靠滚动,所以反而绕开了这个坑。

5. ⚠️ **别加 `source: 'articles'`** 除非真要加 —— 现在 `source` 只有四个真实取值
   (`search`/`watchlist`/`self_post`/`self_reply`),
   而 `self_post`/`self_reply` 曾经「真在写却不在类型里」(绕过类型拼 SQL)。
   加新取值前 **grep 实际写入点**。

---

## ⚠️ 当前库里没有可回填的数据

2026-09-21 22:30 实测:

```
x_tweet 9678 行,text 超过 2000 字的:0 行
```

`@KA594594` 那 72 条长文(含 16081 字那两条)**已被另一条线的人工清理删掉**。
⭐ 所以这个立项**不是「回填老数据」**,而是**「下次采长文时顺手把正文取全」**。
验收也不能靠「库里长文正文覆盖率涨了多少」—— 得**现采一篇、现看字数**。

---

## 建议的实施顺序

| 步 | 事 | 判据 |
|---|---|---|
| 0 | **Spike:拿一份真 `TweetDetail` 载荷,搜 `content_state`** | 有/没有 —— 决定这个立项成不成立 |
| 1 | 同一份载荷喂给现成的 `extractTweetsFrom`,看根推 `text` 字数 | 几千字 = 解析器不用改 |
| 2 | 抽「进详情页 + 捕 TweetDetail」共用底座,采集侧与 campaign 各自调 | campaign 那条线回归不变 |
| 3 | 列表页采到 N 篇长文 → 逐篇进详情页补正文 → upsert | **现采一篇,库里字数从摘要长度涨到几千** |
| 4 | 守卫:真实载荷驱动 + **注入违规验证能变红** | 掐掉执行路径也要红(`void 0 && f()` 能让 `toMatch` 全绿) |

⚠️ 第 3 步要考虑**节流**:逐篇进详情页 = 每篇一次导航,
72 篇就是 72 次。别一口气打完(X 会限流),也别把它塞进现有采集的同一轮里。

---

## 相关文件

| 文件 | 作用 |
|---|---|
| `src/platform/main/x/x-article-replies.ts` | **要复用的底座**(详情页导航 + TweetDetail 捕包 + 留档) |
| `src/platform/main/x/x-timeline-harvester.ts` | `extractTweetsFrom` / 长文正文解析(`articleBody`) |
| `src/platform/main/db/tweet-inbox-repo.ts` | `upsertTweet`(只更新采集字段) |
| `tests/x/article-body-not-lost.test.ts` | 长文正文守卫(11 条,真实载荷驱动) |
| `docs/handoff/x-page-collection-verification.md` | 采集验证全貌 + 七个 bug |
