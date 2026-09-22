# 立项:长文正文逐篇补全(列表页/主页只给标题+摘要)

> 2026-09-21 立项 → 9-22 上午一度误判「前提被证否」→ **9-22 下午实采证实:立项成立**。
> 由 `docs/handoff/x-page-collection-verification.md`「剩下的活」第一条转来。
>
> ⭐ **现状:方向已确认,未开工。** 详情页(`TweetDetail`)确实给正文,
> 实测同一账号三个入口对照,只有详情页带正文。
>
> ⚠️ 下面「好消息」「实施顺序」几节是立项当天写的,**部分已过时**
> (尤其别照搬 `fetchArticleReplies` 的滚动逻辑,见「代价」一节)。

---

## ✅✅ 立项成立 —— 2026-09-22 实采证实,详情页确实给正文

> ⚠️ **本节推翻了本文档 9-22 上午写的「前提被证否」那一节**(已删)。
> 那次「证否」是**拿备份数据反推**出来的,推错了。这次是**实采**。

### 决定性证据:同一账号 `@0xEgorAI`,三个入口对照

| 入口 | 接口 | 长文 | **带正文** |
|---|---|---|---|
| `x.status`(单篇详情页) | `TweetDetail` / `TweetResultByRestId` | 1 | **1 ✅** |
| `x.articles`(文章标签页) | `UserArticlesTweets` | 4 | 0 |
| `x.profile`(主页) | `UserOriginalsTimeline` | 3 | 0 |

⭐ **同一个账号**跑完三趟,排除了「账号差异」这个变量。
结论很干净:**正文只在详情页的载荷里,列表页和主页都只给标题+摘要。**

留痕在 `userData/x-collect-journal/collect-2026-09-22T12-32-14-715Z-x.status_0xEgorAI.json`。

### ⚠️ 但代价要算清楚:一篇 77 秒

那趟 `x.status` 的真实数字:**采到 1 条,轮数 23,耗时 76.7 秒**。

⚠️ 它是按「详情页看回复」的逻辑在滚(要把回复翻完),而补正文**根本不需要回复**。
所以 77 秒里绝大部分是白滚的。

⭐ 这直接决定了实施方式:
- **不能**照搬 `fetchArticleReplies`(它为「翻完回复」设计)
- 补正文只要**第一个 `TweetDetail` 响应**就够了 —— 正文在首个载荷里,
  拿到就可以停,不必滚
- 按「拿到正文就停」估,单篇应该能压到几秒

### 我在这件事上错了两次,都记下来

1. **9-21**:拿 `/articles` 一个接口的实测,推广成「列表页都这样」,
   又反推「只有详情页才有」—— 两步都没验。
2. **9-22 上午**:看见备份里 `@0xegorai` 的长文是 `source='watchlist'`,
   就断言「正文来自普通时间线」,进而宣布立项前提被证否。
   ⚠️ `source` 是**写死值**(`x-auto-collect.ts:352`),根本推不出接口 ——
   我拿一个证明不了接口的字段去论证接口。

⭐ 两次都是**没有留痕时的猜测**。留痕上线后,一趟实采就定了案。

---

## ~~⭐ 好消息:导航和捕包不用从零搭~~(立项当天写的,方案已作废)

> ⚠️ 下面几节的**前提已被 Spike 证否**(不需要走详情页了)。
> 保留是因为里面对 `x-article-replies.ts` 的**事实核对仍然有效** ——
> 万一将来真要走方案 B(兜底),这些行号和约束照样管用。

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

## ⚠️ 当前库里没有可回填的数据(但**备份里有**)

2026-09-21 22:30 实测:

```
x_tweet 9678 行,text 超过 2000 字的:0 行
```

⚠️ **这句当时写错了两处**,Spike 时查明:
- 16081 字那两条是 **@0xegorai** 的,**不是 @KA594594** 的;
- 它们**没有真的消失** —— 完整躺在 `userData/backups/pending-backup-20260921-204255.json`
  里(2949 行,18 行超 2000 字)。⭐ 正是这个备份让 Spike 不用碰 X 就做完了。
⭐ 所以这个立项**不是「回填老数据」**,而是**「下次采长文时顺手把正文取全」**。
验收也不能靠「库里长文正文覆盖率涨了多少」—— 得**现采一篇、现看字数**。

---

## ~~建议的实施顺序~~(已作废,见顶部 Spike 结论)

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
