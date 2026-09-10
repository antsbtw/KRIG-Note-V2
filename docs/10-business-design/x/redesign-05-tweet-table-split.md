# X 重整 · 05 · `x_tweet` 拆分设计

> 立于 2026-09-09。承接 `redesign-04`(`x_author` 拆分,方法已验证)。
> 用户拍板:**「面向对象来分开是正确的做法」** ——
> 结果现在拆,过程等 AI 流程重构时再拆。
>
> **本文是设计,不含实现。**

---

## 0. ⭐ 拆分的判据:面向对象,不是面向字段

用户定的原则:**先问「这是谁在用」,再决定归哪。**

| 判据 | 含义 |
|---|---|
| **对象是谁** | 「一条推文是什么」/「我看到它时是什么样」/「我判了什么」—— 三个不同的对象 |
| **谁在用** | 用户看的 / AI 流程用的 / 采集器用的 |
| **能不能重算** | 事实**可重采** · 观察**不可回溯** · 人工判定**可重做但不会去重做** |

⚠️ **不按字段名分组**,那会把「碰巧都叫 `*_at`」的东西凑一起。

---

## 1. 现状:**32 个唯一字段**(四批共 33 条 DDL,其中 1 条重复),**三种对象混在一行**

> 事实来源:核查 `src/storage/surreal/x-schema.ts` 与三个 repo。

| 批次 | 来源 | 字段数 |
|---|---|---|
| 1.0.0 | 初始 | 27 |
| 1.0.1 | 回复关系 | 2(`in_reply_to_user` `conversation_id`) |
| 1.1.5 | ⚠️ **重复定义** `in_reply_to_user` | 1(与 1.0.1 重复,`IF NOT EXISTS` 使其无害) |
| 1.1.7 | 父推快照 | 3(`parent_text` `parent_handle` `parent_fetched_at`) |

**混在一行的三种对象**:

```
推文事实    tweet_id · author_handle · text · created_at · lang · tweet_url
            in_reply_to · in_reply_to_user · conversation_id
            author_name_at_post · author_avatar · parent_*

观察        metrics                          ⚠️ 见 Bug 5

我方        accepted · accepted_at · replied · replied_at · ai_verdict
            status · filter_score · filter_reason · translation
            search_recipe · task_id · ws_id · source · backfilled · expires_at
```

---

## 2. ⭐⭐ `status` 的归属:拆成两半,只拆一半

核查发现 `status` **有两个消费者,用法完全不同**:

| 消费者 | 怎么用 | 取值 |
|---|---|---|
| **AI 判断流程** | 当**任务队列** | `pending` → `ai_judging` → 完成 |
| **UI** | 切四个视图 | `worth` / `skip` / `filtered_out` |

**证据**:

```
AI 侧(tweet-inbox-repo.ts)
  :146/:168  queryPending    WHERE status='pending'        找待判的
  :184       markAiJudging   SET status='ai_judging'       防重复判
  :209       recoverStuck    SET status='pending' WHERE status='ai_judging'

UI 侧(XInboxView.tsx:30-34)
  待判       status='pending' + replied=false
  Gemma建议  status='worth'  + humanReviewed=false
  漏判抽查   status='skip'   + humanReviewed=false
  已确认     status='worth'  + humanReviewed=true
```

⚠️ **UI 每一条都要配额外条件才用得了** —— 光靠 `status` 分不出来。

### 2.1 三个正交状态被压进一个字段 + 两个旁路布尔

`x-reply-relation-repo.ts:81` 注释明说「**只置 replied,不动 status**」——
所以存在 `replied=true` 但 `status='pending'` 的行,UI 只好写
`status='pending' AND replied=false`。

```
处理进度   pending → ai_judging → 完成     ← 机器的事
判定结果   worth / skip / filtered_out     ← 人看的
回复状态   replied                         ← 旁路布尔
```

### 2.2 ⭐ 决定:结果现在拆,过程留到后面

| | 现在拆? | 为什么 |
|---|---|---|
| **判定结果**(worth/skip) | ✅ **拆** | UI 现在就靠它;拆表时不处理数据没地方放。⚠️ 但**不从 `tweet_feedback` 迁历史**(§8) |
| **处理进度**(`ai_judging`) | ❌ **留在原地** | 它是**流程的临时态**,跟着「AI 判断怎么跑」走。而**那个流程本身有 bug 要修**(Bug 1) |

> ⭐ **现在把 `ai_judging` 固化进新表,等于把一个待改的流程焊死。**

---

## 3. 拆成四张(+ 一处暂不动)

```
x_tweet          推文事实 —— 谁抓的都一样
                 tweet_id · author_handle · text · created_at · lang · tweet_url
                 in_reply_to · in_reply_to_user · conversation_id
                 author_name_at_post · author_avatar
                 parent_text · parent_handle · parent_fetched_at

x_tweet_obs      ⭐ 观察 —— 某时刻我看到它是什么样
                 tweet_id · observed_at · likes · retweets · replies
                 · quotes · bookmarks · views
                 ⭐ 一条推多条观察 → Bug 5 自然修好

x_my_verdict     ⭐ 判定结果 —— 我判了什么
                 tweet_id · verdict(worth/skip/filtered_out)
                 · judged_by(⭐ machine/human,显式字段)
                 · judged_at · confidence · reason · translation

x_my_action      我做了什么  ⚠️ 见下方术语说明
                 tweet_id · accepted · accepted_at · replied · replied_at

【暂不动】       status 的队列部分(pending/ai_judging)
                 留在原表,等 AI 流程重构时一并处理
```

> ⚠️ **术语澄清**(审查发现,2026-09-09):
> `redesign-03` §3 说「**动作只能推断,不许存成事实**」——
> 那指的是**「我对别人的动作」**(点赞/转发),因为载荷只给 `favorited: true/false`,**没有时间**。
>
> **`x_my_action` 不属于那一类**:`accepted` / `replied` 是
> **我在这个 app 里做的操作**,时刻是我们自己记的,**是确定的事实**。
>
> ⭐ 判据:**动作发生在 X 上 → 只能推断;动作发生在本 app 里 → 是事实。**

### 3.1 ⭐ `judged_by` 显式化:消灭一个「脆的字符串约定」

**现在**:靠 `ai_verdict.reason` 是否以 `human:` 开头区分机器判和人工判。

`tweet-inbox-repo.ts:232-234` **自己承认**:

> 用「reason 以 `human:` 开头」来嗅探人工意图是**脆的(字符串约定会漂)**

**拆后**:`judged_by` 是显式字段,**这个隐患当场消失**。

⚠️ 迁移时要按老约定解析一次(`reason` 开头判断),**之后再不依赖它**。

### 3.2 采集元数据归哪

```
source · search_recipe · task_id · ws_id · backfilled · fetched_at
```

**这些是「我怎么遇到它的」** —— 属「我方」,但和判定无关。

✅ **已定:单独一张 `x_tweet_source`**(§7.1)。

⚠️ 初稿曾以为「每条推只有一次来源」,**错了** ——
**同一条推可能被多条配方采到**。附着在 `x_tweet` 上只存得下第一条,
第二条**静默丢失**(又是 `INSERT IGNORE` 那个形态)。

---

## 4. 拆表顺带解决的三个已记 bug

| Bug | 怎么被解决 |
|---|---|
| **5** `metrics` 永远是第一眼 | ⭐ **进观察表,天然多条带时刻,`INSERT IGNORE` 的问题不存在** |
| **6** TTL 死物 | `expires_at` 全表恒 NONE、无写入路径 → **拆表时直接不带这个字段**;`idx_tweet_expires` 一并删 |
| **8** handle 归一化不一致 | ⭐ **入库即归一化**,查询端不再运行时转换 → 同时修好「吃不到索引、6800 行全表扫」 |

---

## 5. 五个功能逐条验证

| 功能 | 拆后怎么实现 | 风险 |
|---|---|---|
| **AI 判断队列** | ⚪ **不变**(队列状态留在原地) | 无 |
| **UI 四视图** | 查 `x_my_verdict.verdict` + `judged_by` | ⭐ **比现在更清楚**(不再需要 `humanReviewed` 旁路) |
| **「已回复」清场** | 查 `x_my_action.replied` | 低 |
| **配方采纳率统计** | 查 `x_tweet_source` + `x_my_verdict` | ⚠️ Bug 2:现在查的是死表,**拆后才真的能算** |
| **屏蔽过滤** | 子查询改查 `x_stance`(`redesign-04` §4.2) | ⚠️ **写死在 SQL 里,grep 函数名找不到**(未编号,见 `redesign-04` §4.2) |

---

## 6. 迁移步骤

同 `redesign-04`:**先双写 → 后切读 → 最后删**,每步可回退。

### 6.1 ⚠️ 与 `x_author` 拆分的关键差别

| | `x_author` | `x_tweet` |
|---|---|---|
| 行数 | 36 有效 | ⭐ **6800+,真档案** |
| 不可再生 | ❌ | ⚠️ **是**(无 TTL,历史采集的原始记录) |
| 有状态机 | ❌ | ⭐ **有,且在跑** |

**所以多两条约束**:

1. ⭐ **迁移期间 AI 判断流程不能停** —— 双写要覆盖状态流转
2. ⭐ **`INSERT IGNORE` 的语义要保留** —— 重复采集不报错也不覆盖,
   这是采集器的既有依赖(`x-reply-relation-repo.ts:181`)
   ⚠️ 但**观察表相反**:它就是要多条,不能 IGNORE

---

## 7. 已定(2026-09-09)

| # | 决定 | 理由 |
|---|---|---|
| 1 | ✅ **采集元数据单独一张 `x_tweet_source`** | ⭐ **同一条推可能被多条配方采到** —— 附着在 `x_tweet` 上只存得下第一条,第二条**静默丢失**(又是 `INSERT IGNORE` 那个形态) |
| 2 | ✅ **`ai_verdict` 摊平成列**,不保持 FLEXIBLE object | 现在**查不了、统计不了** —— 而「哪条配方产出好」正需要统计它 |
| 3 | ✅ **`translation` 跟 `x_my_verdict` 走** | 判断时用得上,和判定同期产生 |

### 7.1 `x_tweet_source` 的形状

```
x_tweet_source   tweet_id · fetched_at · source · search_recipe
                 · task_id · ws_id · backfilled
                 ⭐ 一条推多条来源(被 N 条配方采到就有 N 行)
```

⚠️ **它和 `x_tweet_obs` 有一处关键差别**:
- `x_tweet_obs` 的主键是 `(tweet_id, observed_at)` —— **时间序列**
- `x_tweet_source` 的主键是 `(tweet_id, search_recipe)` 之类 —— **去重集合**
  (同一条配方重复采到同一条推,**不该记两次**)

### 7.2 摊平 `ai_verdict` 后的列

现在是 FLEXIBLE object `{ worth, confidence, reason }`。摊平到 `x_my_verdict`:

```
verdict      worth / skip / filtered_out     ← 取代 status 的结果部分
judged_by    machine / human                 ⭐ 取代脆的 `human:` 前缀约定
judged_at    datetime
confidence   float                           ← 「漏判抽查」按它升序
reason       string
translation  option<string>
```

⚠️ **迁移时要解析老数据**:`ai_verdict.reason` 以 `human:` 开头 → `judged_by='human'`,
否则 `'machine'`。**解析一次,之后再不依赖这个约定。**

---

## 8. ⭐ `tweet_feedback` 的处置:不迁、不为它设计(2026-09-09 用户拍板)

### 8.1 核查结论(事实)

| 事实 | 证据 |
|---|---|
| 唯一写入是 `INSERT INTO`,**从不 UPDATE/DELETE** | `tweet-inbox-repo.ts:418-422` |
| **同一 tweet_id 允许多行**(索引故意不设 UNIQUE) | `x-schema.ts:181-183`;实证:同一句话一字不差出现 3 次(`x-reply-planner.ts:126`) |
| 它是「**为绕过单行覆盖而存在的补丁**」 | `x-timeline-handlers.ts:285-302`:先抄快照 → 写 feedback → **覆盖 `x_tweet.ai_verdict`** |
| Gemma 原判快照覆盖率仅 **128/6968** | 1.8.7 之前的存量**无法回填**(原判已被覆盖销毁) |
| ⚠️ **X 库不进备份** | `x-schema.ts:13-19`:backup-store 写死只导 `krig_note_v2` |

### 8.2 ⭐ 用户的判断:原来的判断也不一定对

> **「原来的判断也不一定对呢」** ——「**没必要,我们已经在构建新的逻辑了**」

**这个判断有证据支持**:

- 同一条推被标注多次,**结果可能不同** → 标准本来就在漂
- 跨越 **40 天**,中途做过关键词精确率体检(英文噪音降 83%)→ **筛选标准明确变过**
- ⚠️ 由此,**「Gemma 准确 93.8% / 精确 97.3%」严格说是「与当时标注的一致率」**,
  不是客观准确率 —— 分母本身可疑

### 8.3 决定

| 项 | 决定 |
|---|---|
| **迁移** | ❌ **不迁** —— 不为它设计新结构 |
| **备份** | ❌ **不修** —— 它不是不可替代的真源 |
| **推文正文(449 条)** | ⚪ **不搬** —— X 上还有,能补采 |
| **旧表** | 原样留着(唯一写入是 INSERT,不会被写坏),新逻辑不读它 |

> ⭐ **为什么这个决定是对的**:
> `tweet_feedback` 的存在理由是「**主表会被覆盖,所以要冻结快照**」。
> 而新模型里 `x_my_verdict` **天然多条** —— 机器判一行、人工判一行,**谁也不盖谁**。
> **不覆盖,就不需要快照。它的存在理由消失了。**

⚠️ **附带更正**(应传播到其他文档):
`redesign-01` / `redesign-03` / `redesign-04` 里把 `tweet_feedback` 标为
「**不可再生资产,必须带走**」—— 那是**基于「判断是可信的 gold label」这个前提**。
前提被推翻,结论随之作废。

---

## 9. 下一步
