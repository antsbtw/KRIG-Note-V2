# X 重整 · 04 · `x_author` 拆分设计

> 立于 2026-09-09。承接 `redesign-03`(三元模型)。
> 用户拍板:**四张表**(`x_person` / `x_person_obs` / `x_social` / `x_stance`)。
>
> **本文是设计,不含实现。** 字段级映射 + 迁移步骤 + 隐式耦合处置。

---

## 0. 为什么先拆这张

| | `x_author` | `x_tweet` | `tweet_feedback` |
|---|---|---|---|
| 行数 | ⭐ **看哪张表**(见 §6.1):`x_person` ~3458 · `x_stance` 仅几十 | 6800+ | 6900+ |
| 病情 | ⭐ **六种语义混一表,7 模块都写** | 三层语义混一行 | 单一职责 |
| 不可再生 | ❌ | ⚠️ 真档案 | ⚠️ **已推翻**(见 `redesign-05` §8) |
| 风险 | **最低** | 中 | ⚪ **不适用**(已定不迁,见 `redesign-05` §8) |

**病最重、风险最低** —— 拆它能验证整套方法,不伤真档案。

---

## 1. 现状:**24 个字段**,分三批长出来,**六种语义**

> 事实来源:核查 `src/storage/surreal/x-schema.ts` 与 `src/platform/main/db/x-author-repo.ts`。

| 批次 | 来源 | 字段 |
|---|---|---|
| **A** | 1.0.0 初始 | `handle` `display_name` `avatar` · `blocked*3` · `watched*4` · `is_self` · `note` |
| **B** | 1.0.4 基线计数 | `tweet_count` `media_count` `followers_count` `following_count` `favourites_count` `counts_at` `account_created_at` |
| **C** | 1.1.6 关系视角 | `follows_me` `i_follow` `x_blocking` `bio` `is_blue_verified` |

### 1.1 ⭐ 批次 C 藏着第六种语义

`follows_me` / `i_follow` / `x_blocking` 是 **X 平台上的社交关系** ——
既不是这个人的属性(它描述的是「我和他」),
也不是我方意志(是 **X 那边的事实**,零额外请求就能从载荷里拿到)。

**所以不是「一表五语义」,是六种。**

---

## 2. 拆成四张

```
x_person       handle · display_name · avatar
               ← 身份。稳定,变化慢

x_person_obs   handle · observed_at · bio · followers_count · following_count
               · tweet_count · media_count · favourites_count
               · is_blue_verified · account_created_at
               ⭐ 一人多条 —— 能看粉丝数变化曲线

x_social       handle · observed_at · follows_me · i_follow · x_blocking
               ⭐ X 平台的客观关系,不是我的决定

x_stance       handle · blocked* · watched* · is_self · note
               ← 我方意志。不可重算,必须持久化
```

### 2.1 为什么 `x_social` 要独立(不并进 `x_stance`)

**它们性质相反**:

| | `x_social` | `x_stance` |
|---|---|---|
| 「他关注了我」 | ⭐ **X 那边的事实** | — |
| 「我屏蔽了他」 | — | ⭐ **我的决定** |
| 来源 | 载荷里读到的 | 人点出来的 |
| 会被覆盖吗 | ✅ 每次采集刷新 | ❌ **只有人能改** |

⚠️ **混在一起的后果**:将来同步 X 关系时**会误伤我的态度字段** ——
一次「刷新关系」把 `blocked` 冲掉,而那是不可再生的人工意志。

### 2.2 为什么 `x_social` 带 `observed_at` 而不是覆盖

和画像同理:`follows_me` 会变。带上观测时刻,**才能回答「他什么时候取关的」**。

> ✅ **决定留全序列**(§7 已定):关系是布尔值、变化次数远少于粉丝数,
> 但**「只留最新」是一条存储端的分支判断** —— 与
> `web/capability-layer/01-contract.md` §13 那条原则同源:
> **拿可靠性换空间,而空间恰是最不稀缺的。**

---

## 3. 字段级映射

| 原字段 | 去向 | 备注 |
|---|---|---|
| `handle` | **四张表都有**(关联键) | ⚠️ 必须 `normalizeHandle` —— UNIQUE 索引逼的 |
| `display_name` `avatar` | `x_person` | |
| `blocked` `blocked_at` `blocked_reason` | `x_stance` | |
| `watched` `watched_at` `watch_source` `watch_depth` | `x_stance` | |
| `is_self` `note` | `x_stance` | ⚪ `is_self` 见 §5.3 |
| `bio` `is_blue_verified` | `x_person_obs` | |
| `followers_count` `following_count` `tweet_count` `media_count` `favourites_count` | `x_person_obs` | |
| `account_created_at` | `x_person_obs` | ⚠️ 它其实不变,但**和画像一起采的**,放一起省事 |
| `counts_at` | → `x_person_obs.observed_at` | ⭐ 从字段变成**主键之一** |
| `follows_me` `i_follow` `x_blocking` | `x_social` | |

### 3.1 ⭐ `counts_at` 的角色转变

**现在**:12 个画像字段共用**一个**时间戳,`saveAuthorCounts` 一次性全量覆盖,
`counts_at = time::now()` **硬编码在 SET 里,调用方传不了**。

**拆后**:`observed_at` 成为 `x_person_obs` 的主键之一 ——
同一个人可以有多条观察,**每条带自己的时刻**。

⚠️ **保留「一次采集拿全」的假设**:12 个字段仍是同一次看到的,
**不做 per-field 观测时刻** —— 因为载荷本来就是一次给全的。

---

## 4. ⚠️ 两个隐式耦合,拆分时必须显式化

### 4.1 ⭐ 追踪一个人会**静默解除屏蔽**

`x-author-repo.ts:341`,`watchAuthor` 的 SET 语句:

```sql
watched = true, watched_at = time::now(), watch_source = $src,
watch_depth = $depth, note = $note,
blocked = false, blocked_at = NONE, blocked_reason = NONE   -- ⚠️ 顺手清屏蔽
```

**追踪 = 追踪 + 解除屏蔽**,而调用方不知道自己做了第二件事。

**处置**:
- 这个语义**大概率是对的**(追踪与屏蔽逻辑互斥)
- 但拆表后**必须显式写**:「写 watch + 删 block」是两个动作
- ⭐ **拆表会让它当场暴露** —— 写不出来就说明这耦合本不该有

### 4.2 ⚠️ 过滤条件**写死在 SQL 字符串里**,不走 repo

`tweet-inbox-repo.ts:316`:

```sql
(SELECT VALUE handle FROM x_author WHERE blocked = true OR is_self = true)
```

**它不是调 repo 函数,是拼在查询里的子查询。**

⚠️ **拆表时最容易漏的就是它** —— grep 函数名找不到,只有 grep 表名才能发现。

---

## 5. 五个原有功能逐条验证(用户要的「按原来需要的功能」)

| 功能 | 拆后怎么实现 | 风险 |
|---|---|---|
| **屏蔽名单** | 查 `x_stance.blocked` | 低 |
| **追踪名单** | 查 `x_stance.watched` | ⚠️ §4.1 那个隐式清 blocked 要显式化 |
| **「我是谁」** | `x_stance.is_self` | ⚪ 见 §5.3 |
| **画像 + 7 天新鲜度** | 查 `x_person_obs` **最新一条**的 `observed_at` | 低 |
| **采集时过滤** | 改 §4.2 那个子查询 | ⚠️ **写死在 SQL 里** |

### 5.1 「7 天新鲜度」拆后怎么算

**现在**:`Date.now() - countsAt < PROFILE_STALE_HOURS(7天)`
**拆后**:取 `x_person_obs` 该 handle 的 **`observed_at` 最大的一条**,同样比较

⚠️ 查询从「读一行」变成「取最新一条」—— **需要索引** `(handle, observed_at DESC)`。

### 5.2 采集完整度基线怎么算

`x-timeline-handlers.ts:462` 用 `tweet_count` 当基线。
拆后同样取最新一条观察。

### 5.3 ⚪ `is_self` 是残留,建议随拆分清理

记忆 `project-x-self-account-drift` 记着:
**「我是谁」的权威源已改为 `x_ws_account`**,`is_self` 是全局单例,
**多 ws 会互相覆盖**(`x-timeline-handlers.ts:390` 注释已指出)。

**建议**:拆分时 `is_self` 进 `x_stance` **但标为 deprecated**,
读取一律走 `x_ws_account` —— **不在本次拆分里删,避免一次动太多**。

---

## 6. 迁移步骤(建议)

> ⚠️ 原则:**先双写,后切读,最后删** —— 任何一步都可回退。

| 步 | 做什么 | 可回退? |
|---|---|---|
| 1 | 建四张新表 + 索引,**不接任何调用方** | ✅ 纯新增 |
| 2 | 迁移脚本:`x_author` 一行 → 四张表各一行(画像空的就不建 obs 行) | ✅ 旧表还在 |
| 3 | repo 层**双写**:新旧表都写 | ✅ |
| 4 | 读切到新表,**逐个功能验**(§5 那五条) | ✅ 双写还在 |
| 5 | 停双写,旧表保留一段时间 | ⚠️ |
| 6 | 删 `x_author` | ❌ |

### 6.1 数据量现实

- `x_author` 回填后 ~3458 行,但**画像字段近乎全空**
- → `x_person` ~3458 行,`x_person_obs` **只有被 `harvestAuthorProfile` 采过的那几个人**
- → `x_stance` 只有 34 blocked + watched 那些 + 1 is_self

⭐ **两个数都对,指的不是同一张表** —— 迁移脚本要按各自规模设计:

| 新表 | 行数 | 迁移方式 |
|---|---|---|
| `x_person` | **~3458** | 批处理(基本是空壳:handle + 可能的 display_name/avatar) |
| `x_person_obs` | **个位数~几十** | 只有被 `harvestAuthorProfile` 采过的人有值 |
| `x_social` | 同上 | 同 1.1.6 之后采过的 |
| `x_stance` | **~几十**(34 blocked + watched + 1 is_self) | ⭐ **这些才是有内容的数据** |

⚠️ 「36 行」是 migration 1.1.4 回填**之前**的数字;回填后 `x_author` 涨到 ~3458,
**但只建标识行、不写任何计数**(`x-schema.ts:722-723`)—— 画像字段仍近乎全空。

---

## 7. 已定(2026-09-09)

| # | 决定 | 理由 |
|---|---|---|
| 1 | ✅ **四张表**:`x_person` / `x_person_obs` / `x_social` / `x_stance` | 六种语义归四类 |
| 2 | ✅ **`x_social` 留全序列**(与 `x_person_obs` 一致) | 量小;与「不加分支判断」同源 |
| 3 | ✅ **`x_person` 的 `display_name`/`avatar` 覆盖即可**,不建序列 | 只用于显示。⚠️ 将来要「他改过几次名」再补 |
| 4 | ✅ `is_self` 标 deprecated 但**本次不删** | 权威源已是 `x_ws_account`;一次动太多易出事 |

---

## 8. 下一步

本次是**纯设计**。实现要等接线阶段(那时才动现有文件)。

**下一张表**:`x_tweet` 拆分 —— 6800 行真档案,方法在本表验证过再动。
