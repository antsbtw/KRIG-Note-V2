# X 梳理期发现的 bug(只记账,不修)

> 立于 2026-09-09。用户拍板:**先记下来,不急着修** ——
> 它们是「理清楚之后自然会被修掉」的那类,现在单独修会让 diff 混进重构里。
>
> ⚠️ 这些是**为了开始业务梳理、扫了一遍数据流就撞出来的**,
> 不是专门找 bug 找到的 —— 这本身说明了梳理的必要性。

---

## Bug 1 ⭐ AI 判断的失败回退写进死表

**位置**:`src/platform/main/x/x-ai-judge.ts:194` 和 `:209`

```sql
UPDATE tweet_inbox SET status = 'pending' WHERE tweet_id IN $ids
```

**这是活的 SQL,不是注释。** 而 `tweet-inbox-repo.ts:496` 自己写着:

> ⚠️ 只写 x_tweet。`tweet_inbox` 是**遗留表** …… 那张表早已没人维护

**后果**:Ollama 调用失败、或某条推没返回判断时,
「退回 pending 下次重判」这个动作**打在空表上** ——
那条推文实际停在 `ai_judging`,**再也不会被重判**。

**为什么一直没被发现**:启动时 `recoverStuckAiJudging()` 会把卡在
`ai_judging` 的捞回 pending。所以现象是「**要等下次重启才恢复**」,
而不是当场丢数据。

**关联**:记忆 `project-x-tweet-inbox-is-dead-table`
(「名字骗人 + 写进去不报错且永远读不到」)—— 这是该家族的又一例。

---

## Bug 2 配方采纳率统计可能查的是空表

**位置**:`src/platform/main/db/search-recipe-repo.ts:243`

```sql
FROM tweet_inbox
```

同上,`tweet_inbox` 是死表 → **配方统计数字很可能一直是空的**。

⚠️ **未实证**(需查库确认该表是否真的空)。梳理数据流程时一并验。

---

## Bug 3 ⭐ `x_author` 一张表塞了六种语义

**实测**(`x-author-repo.ts` 关键词计数):

| 语义 | 出现次数 |
|---|---|
| `handle`(身份) | 156 |
| `blocked`(屏蔽名单) | 45 |
| `watched`(追踪名单) | 41 |
| `is_self`(我是谁) | 11 |
| `followers`(画像) | 7 |

**「人 / 屏蔽 / 追踪 / 我是谁 / 画像 / X平台关系」六件事挤在一张表**
(第六种是 `follows_me`/`i_follow`/`x_blocking`,见 `redesign-04` §1.1),
且 **7 个模块都在写它** —— 这是「改一处要连带改三处」的结构性原因。

**关联**:
- 记忆 `project-x-self-account-drift`(「我是谁」三来源不同步)——
  病根就在 `is_self` 与 `x_ws_account` 两套并存
- 记忆 `project-data-model-charter` 原则一(实体优先):
  这是「一张表混塞多实体」的活反例

---

## Bug 4 ⭐ `reply_draft` 写进去就被静默丢弃

**位置**:`src/platform/main/db/tweet-inbox-repo.ts:60` 与 `:93`(`INSERT IGNORE` 里写它)

代码在写 `reply_draft`,TS 类型也声明了(`x-timeline-types.ts:133`)——
**但 `x-schema.ts` 里 `x_tweet` 从未定义这个字段。**

表是 `SCHEMAFULL`,按 schema 自己的警告(`x-schema.ts:101`「漏一个就静默丢弃」):

> **这个字段写进去就被丢掉,不报错。**

**反向证据**:schema 定义的 `reply_text`(`x-schema.ts:95`)**全仓无人读写**。
—— 看起来是当初改名时,schema 和代码各改了一半。

⚠️ 只有遗留死表 `tweet_inbox` 有 `reply_draft`(`x-schema.ts:144`)。

**关联**:记忆 `project-x-tweet-inbox-is-dead-table` 家族又一例
(「写进去不报错且永远读不到」)。

---

## Bug 5 ⭐⭐ `metrics` 永远是「第一眼」,不是「最后一眼」

**比原先以为的更糟。** 原判断是「只记最后一次看到的值」,实测:

| 事实 | 证据 |
|---|---|
| 两条写入路径**都是 `INSERT IGNORE`** | `tweet-inbox-repo.ts:33` · `x-reply-relation-repo.ts:183` |
| 重复采集**既不报错也不覆盖** | `x-reply-relation-repo.ts:181` 注释明说 |
| **全仓没有任何 UPDATE 会刷新 metrics** | `saveReplyRelations`(:113-116)只 UPDATE 关系三字段 |

> ⭐ **存的是首次入库那一刻的值,此后永不更新。**
> 一条推被采集时可能刚发出来(0 赞),之后火了到 500 赞 —— **库里永远是 0。**

**而它恰恰是最易变的字段**,却缺少时效性声明 ——
对比同文件对别的字段有明确快照声明:
`author_name_at_post`(`x-schema.ts:87`「发推当时的展示名快照…与当前名语义不同」)、
`parent_text`(`tweet-inbox-repo.ts:492-493`)。

**处置**:⭐ **拆表时自然修好** —— metrics 进 `x_tweet_obs`(观察表),
天然多条、带 `observed_at`,`INSERT IGNORE` 的问题自动消失。

---

## Bug 6 TTL 机制整体停用,留下三处死物

2026-09-02 用户拍板永久保存后,migration 1.0.5 停用了 TTL
(`x-schema.ts:347-378`,一次性把当时 368 行带 TTL 的全清成 NONE)。

**但留下三处死物**:

| 死物 | 证据 |
|---|---|
| `cleanExpired()` **函数体只有 `return;`** | `tweet-inbox-repo.ts:390-393`(保留是为不拆调用链 + 留痕,:378-382) |
| **调用点仍在跑**(每 24h + 启动各一次) | `x-search-scheduler.ts:239` · `:245` |
| `idx_tweet_expires` 是**死索引** | `x-schema.ts:113`;`expires_at` 全表恒 NONE、**无写入非 NONE 的路径** |

⚪ **无害但是噪音**。拆表时一并清理。

---

## Bug 7 ⚠️ 注释在替一段坏代码作证

`tweet-inbox-repo.ts:203-206` 的注释宣称:

> Ollama 调用失败也会显式退回 pending(x-ai-judge.ts)

**而 Bug 1 已证实:那两行写的是死表 `tweet_inbox`,退不回去。**

⭐ **这比 Bug 1 本身更值得记**:注释成了那段坏代码的**背书** ——
读代码的人看到注释就不会去核实,于是 bug 被注释保护了起来。

> 关联记忆 `feedback-verify-guard-can-fail` 的近亲:
> **文档/注释里的断言,和守卫一样需要被验证。**

---

## Bug 8 `author_handle` 归一化两处写法不一致(性能 + 正确性)

| 位置 | 写法 |
|---|---|
| `tweet-inbox-repo.ts:316` | ⚠️ **运行时归一化**:`string::replace(string::lowercase(author_handle), '@', '')` |
| `x-author-repo.ts:507` / `:544` | ❌ **没有归一化** |

**两个后果**:

1. ⚠️ **性能**:前者**吃不到 `idx_tweet_author` 索引** ——
   6800 行上每次查询都是全表扫 + 每行字符串运算
2. ⚠️ **正确性**:后者不归一化,`@Foo` 与 `foo` 会被当成两个人

**关联**:记忆 `project-x-handle-normalize`(「写入端与比对端必须共用 `normalizeHandle()`,
漂移 = 屏蔽恒不命中且不报错」)—— **这条记忆记的病,又复发了一次。**

⭐ **拆表时正好一并解决**:入库即归一化,查询端不再做运行时转换。

---

## 处置

| | |
|---|---|
| **现在** | 只记账,不修 |
| **何时修** | ⭐ **Bug 5 / 6 / 8 拆 `x_tweet` 时自然解决**;Bug 1/2/4/7 需单独处理 |
| **⚠️ 注意** | Bug 1 有**实际用户影响**(推文卡住要等重启)。若梳理周期拉长,可单独提前修 —— 但要独立 commit,不混进重构 |
