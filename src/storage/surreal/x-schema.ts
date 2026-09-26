import { RecordId, type Surreal } from 'surrealdb';

/**
 * X 库(krig_x)schema —— 与笔记库(krig_note_v2)**物理隔离**的独立 database。
 *
 * 设计依据:
 * - docs/10-business-design/x/persistent-tracking-and-profiling.md §4.1(4) — 表结构
 * - docs/00-architecture/data-model-charter.md — 实体优先 / 关系第二性 / 派生可重算
 * - docs/00-architecture/storage-isolation-boundaries.md §7 — 隔离边界
 *
 * ⚠️ 版本号自成序列(1.0.0 起),与笔记库的 1.9.x **完全无关**。
 *    X 库有自己的 schema_version 表,由 migrations/x-runner.ts 驱动。
 *
 * ⚠️ **X 库不进备份** —— backup-store 的 surreal export 只导 krig_note_v2
 *    (backup-store.ts 传 --database ${conn.database},写死单库)。
 *    这是**有意的**,不是漏做:用户 2026-09-01 明确「X 历史数据都可以重新爬取」。
 *    唯一不可再生的 tweet_feedback(人工标注)已在 0 期一次性迁入本库;
 *    若将来它的价值上升到需要备份,再改 backup-store 导两个库。别当 bug 修。
 *
 * DDL 三条铁律(每条都是踩出来的,改本文件前逐条对照):
 * 1. **绝不 DEFINE FIELD id** —— id 是 SurrealDB 内建 record 标识。声明成 TYPE string
 *    后,CREATE(record 型 id)再 UPSERT 同一 id 会触发 readonly 校验失败 → 事务回滚
 *    → 写入**静默失败**。笔记库为此付出过 migration 1.8.6 的代价。
 * 2. **option<T> 写值传 undefined,不传 null** —— SurrealDB 的 NONE ≠ NULL,
 *    option<T> 只认 NONE。SDK 绑定 undefined→NONE、null→NULL(实测)。
 *    repo 里见到 `?? null` 就是 bug;`?? undefined` 才对。
 * 3. **单条 DDL parse error 会导致整段被服务端拒收**,不是只跳过那一条。
 *    典型雷:`option<array> FLEXIBLE` 是 parse error(FLEXIBLE 只吃含 object 的类型);
 *    `TYPE object FLEXIBLE` 语序不可颠倒;`array<object> FLEXIBLE` 不下传到元素。
 *    → migration 跑完必须 curl 问库 `INFO FOR TABLE` 逐字段核对,
 *      **不能以"启动没报错"当验证**。
 */

const X_SCHEMA_1_0_0 = `
-- ⚠️ 必须先显式建库:connect({ database: 'krig_x' }) **不会**创建 database。
-- 冷启动时第一条 DEFINE TABLE 会直接报 "The database 'krig_x' does not exist",
-- 而单条 DDL 失败会让**整段**被服务端拒收 → 一张表都建不出来。
-- (2026-09-01 实测踩到:app 照常启动、krig_x 却始终不存在,
--  因为 main/index.ts 对 initStorage 的 catch 只 console.error。)
DEFINE DATABASE IF NOT EXISTS krig_x;

-- ═══════════════════════════════════════════════════════════════
-- ① 人 —— x_author(唯一真源,无 TTL,只显式删除)
-- ═══════════════════════════════════════════════════════════════
-- 注:first_seen / last_seen / seen_count / accepted_count / replied_count
-- **不放这里** —— 它们是可从 x_tweet 重算的派生属性(总纲原则 3)。
-- 真要慢了再物化成 x_author_stats,标注"可重算可清空"。
DEFINE TABLE IF NOT EXISTS x_author SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS handle         ON x_author TYPE string ASSERT $value != '';
DEFINE FIELD IF NOT EXISTS display_name   ON x_author TYPE option<string>;
DEFINE FIELD IF NOT EXISTS avatar         ON x_author TYPE option<string>;
-- 我对他的态度:人工意志,不可重算,必须持久化
DEFINE FIELD IF NOT EXISTS blocked        ON x_author TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS blocked_at     ON x_author TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS blocked_reason ON x_author TYPE option<string>;
-- 追踪名单(watchlist)。⚠️ 术语:这是本 app 内部的采集清单,**不是 X 的 follow**。
-- 不调 follow API、被追踪者无感知。UI 与代码一律用「追踪」,禁用「关注」。
DEFINE FIELD IF NOT EXISTS watched        ON x_author TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS watched_at     ON x_author TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS watch_source   ON x_author TYPE option<string>;
DEFINE FIELD IF NOT EXISTS watch_depth    ON x_author TYPE int DEFAULT 1;
DEFINE FIELD IF NOT EXISTS is_self        ON x_author TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS note           ON x_author TYPE option<string>;
DEFINE INDEX IF NOT EXISTS idx_author_handle  ON x_author FIELDS handle UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_author_blocked ON x_author FIELDS blocked;
DEFINE INDEX IF NOT EXISTS idx_author_watched ON x_author FIELDS watched;

-- ═══════════════════════════════════════════════════════════════
-- ② 事 —— x_tweet(唯一真源;是否永久取决于 expires_at)
-- ═══════════════════════════════════════════════════════════════
-- 单表模型(方案 Q7):采纳与否是 item 的**属性**,不是分表依据。
-- expires_at 为 NONE = 永久保留(采纳/回复过的);有值 = 到期由 TTL 清理。
-- ⚠️ 必须是 option<datetime> 而非 datetime —— 旧库 tweet_inbox 建成了 datetime,
--    导致"设 NONE 让 TTL 跳过"这条路走不通。新库一开始就建对。
DEFINE TABLE IF NOT EXISTS x_tweet SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS tweet_id            ON x_tweet TYPE string ASSERT $value != '';
DEFINE FIELD IF NOT EXISTS author_handle       ON x_tweet TYPE string;
DEFINE FIELD IF NOT EXISTS text                ON x_tweet TYPE string;
DEFINE FIELD IF NOT EXISTS created_at          ON x_tweet TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS fetched_at          ON x_tweet TYPE datetime;
-- 非空 = 这是一条回复。含被回复者 handle,n 层关系分析直接 GROUP BY 即可算,
-- 先不建任何边表(方案 §4.1(5))。
DEFINE FIELD IF NOT EXISTS in_reply_to         ON x_tweet TYPE option<string>;
DEFINE FIELD IF NOT EXISTS metrics             ON x_tweet TYPE object FLEXIBLE;
DEFINE FIELD IF NOT EXISTS lang                ON x_tweet TYPE option<string>;
DEFINE FIELD IF NOT EXISTS tweet_url           ON x_tweet TYPE option<string>;
-- 发推当时的展示名快照。与 x_author.display_name(当前名,会变)语义不同,两者都要(Q6)。
DEFINE FIELD IF NOT EXISTS author_name_at_post ON x_tweet TYPE option<string>;
DEFINE FIELD IF NOT EXISTS author_avatar       ON x_tweet TYPE option<string>;
-- item 的状态属性
DEFINE FIELD IF NOT EXISTS accepted            ON x_tweet TYPE option<bool>;
DEFINE FIELD IF NOT EXISTS accepted_at         ON x_tweet TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS replied             ON x_tweet TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS replied_at          ON x_tweet TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS reply_text          ON x_tweet TYPE option<string>;
DEFINE FIELD IF NOT EXISTS ai_verdict          ON x_tweet TYPE option<object> FLEXIBLE;
-- 'search' | 'watchlist'。⚠️ watchlist 推文不进 AI 判断队列(不置 pending),
-- 否则刷爆 Gemma 队列、污染待处理收件箱。
DEFINE FIELD IF NOT EXISTS source              ON x_tweet TYPE string;
DEFINE FIELD IF NOT EXISTS expires_at          ON x_tweet TYPE option<datetime>;
-- 运行期字段:SCHEMAFULL 下漏一个就**静默丢弃**,现在补齐比事后加 migration 便宜
DEFINE FIELD IF NOT EXISTS status              ON x_tweet TYPE string;
DEFINE FIELD IF NOT EXISTS filter_score        ON x_tweet TYPE float DEFAULT 0;
DEFINE FIELD IF NOT EXISTS filter_reason       ON x_tweet TYPE option<string>;
DEFINE FIELD IF NOT EXISTS translation         ON x_tweet TYPE option<string>;
DEFINE FIELD IF NOT EXISTS search_recipe       ON x_tweet TYPE option<string>;
DEFINE FIELD IF NOT EXISTS task_id             ON x_tweet TYPE option<string>;
DEFINE FIELD IF NOT EXISTS ws_id               ON x_tweet TYPE option<string>;
-- Q1:存量回填的行标 true,与真实采集区分开
DEFINE FIELD IF NOT EXISTS backfilled          ON x_tweet TYPE bool DEFAULT false;
-- 载荷里带 article 结构 = 长文。⚠️ ≠「拿到正文了」:列表页的长文也是 true,
-- 但只有标题+摘要 —— 正文只在单篇详情页(migration 1.2.7)
DEFINE FIELD IF NOT EXISTS is_article          ON x_tweet TYPE option<bool>;
DEFINE INDEX IF NOT EXISTS idx_tweet_id        ON x_tweet FIELDS tweet_id UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_tweet_status    ON x_tweet FIELDS status;
DEFINE INDEX IF NOT EXISTS idx_tweet_expires   ON x_tweet FIELDS expires_at;
DEFINE INDEX IF NOT EXISTS idx_tweet_author    ON x_tweet FIELDS author_handle;
DEFINE INDEX IF NOT EXISTS idx_tweet_accepted  ON x_tweet FIELDS accepted;
DEFINE INDEX IF NOT EXISTS idx_tweet_is_article ON x_tweet FIELDS is_article;

-- ═══════════════════════════════════════════════════════════════
-- 运行表 —— 0 期原样搬过来,结构不动(重整放 A 期)
-- ═══════════════════════════════════════════════════════════════
-- tweet_inbox / search_recipes:数据不迁(可重爬),只建空表。
-- 字段与笔记库旧表逐字一致 —— 0 期只换连接,不换语义,便于对照回归。

DEFINE TABLE IF NOT EXISTS tweet_inbox SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS tweet_id        ON tweet_inbox TYPE string;
DEFINE FIELD IF NOT EXISTS text            ON tweet_inbox TYPE string;
DEFINE FIELD IF NOT EXISTS author_name     ON tweet_inbox TYPE string;
DEFINE FIELD IF NOT EXISTS author_handle   ON tweet_inbox TYPE string;
DEFINE FIELD IF NOT EXISTS author_avatar   ON tweet_inbox TYPE option<string>;
DEFINE FIELD IF NOT EXISTS tweet_url       ON tweet_inbox TYPE option<string>;
DEFINE FIELD IF NOT EXISTS lang            ON tweet_inbox TYPE option<string>;
DEFINE FIELD IF NOT EXISTS metrics         ON tweet_inbox TYPE object FLEXIBLE;
DEFINE FIELD IF NOT EXISTS fetched_at      ON tweet_inbox TYPE datetime;
DEFINE FIELD IF NOT EXISTS expires_at      ON tweet_inbox TYPE datetime;
DEFINE FIELD IF NOT EXISTS source          ON tweet_inbox TYPE string;
DEFINE FIELD IF NOT EXISTS search_recipe   ON tweet_inbox TYPE option<string>;
DEFINE FIELD IF NOT EXISTS task_id         ON tweet_inbox TYPE option<string>;
DEFINE FIELD IF NOT EXISTS ws_id           ON tweet_inbox TYPE option<string>;
DEFINE FIELD IF NOT EXISTS filter_score    ON tweet_inbox TYPE float;
DEFINE FIELD IF NOT EXISTS filter_reason   ON tweet_inbox TYPE option<string>;
DEFINE FIELD IF NOT EXISTS ai_verdict      ON tweet_inbox TYPE option<object> FLEXIBLE;
DEFINE FIELD IF NOT EXISTS translation     ON tweet_inbox TYPE option<string>;
DEFINE FIELD IF NOT EXISTS status          ON tweet_inbox TYPE string;
DEFINE FIELD IF NOT EXISTS replied_at      ON tweet_inbox TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS reply_draft     ON tweet_inbox TYPE option<string>;
DEFINE INDEX IF NOT EXISTS idx_inbox_tweet_id ON tweet_inbox FIELDS tweet_id UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_inbox_status   ON tweet_inbox FIELDS status;
DEFINE INDEX IF NOT EXISTS idx_inbox_expires  ON tweet_inbox FIELDS expires_at;

DEFINE TABLE IF NOT EXISTS search_recipes SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS recipe_id         ON search_recipes TYPE string;
DEFINE FIELD IF NOT EXISTS name              ON search_recipes TYPE string;
DEFINE FIELD IF NOT EXISTS enabled           ON search_recipes TYPE bool;
DEFINE FIELD IF NOT EXISTS template          ON search_recipes TYPE string;
DEFINE FIELD IF NOT EXISTS keywords          ON search_recipes TYPE array<string>;
DEFINE FIELD IF NOT EXISTS from_accounts     ON search_recipes TYPE array<string>;
DEFINE FIELD IF NOT EXISTS help_signals      ON search_recipes TYPE array<string>;
DEFINE FIELD IF NOT EXISTS min_likes         ON search_recipes TYPE int;
DEFINE FIELD IF NOT EXISTS min_retweets      ON search_recipes TYPE int;
DEFINE FIELD IF NOT EXISTS lang              ON search_recipes TYPE option<string>;
DEFINE FIELD IF NOT EXISTS since_hours       ON search_recipes TYPE int;
DEFINE FIELD IF NOT EXISTS result_type       ON search_recipes TYPE string;
DEFINE FIELD IF NOT EXISTS interval_minutes  ON search_recipes TYPE int;
DEFINE FIELD IF NOT EXISTS last_run_at       ON search_recipes TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS ws_id             ON search_recipes TYPE option<string>;
DEFINE INDEX IF NOT EXISTS idx_recipe_id     ON search_recipes FIELDS recipe_id UNIQUE;

-- tweet_feedback:人工标注(accept/reject)+ Gemma 原判快照。
-- ⚠️ **本表数据不可再生** —— 6900+ 条是 40 天连续人工判断,X 上爬不回来
-- (尤其 reject:"看过并否决"与"从没见过"在 X 上长得一模一样)。
-- 0 期从笔记库整表迁入,字段保持 9 个原样不重整(重整放 A 期)。
DEFINE TABLE IF NOT EXISTS tweet_feedback SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS tweet_id       ON tweet_feedback TYPE string ASSERT $value != NONE;
DEFINE FIELD IF NOT EXISTS text           ON tweet_feedback TYPE string;
DEFINE FIELD IF NOT EXISTS lang           ON tweet_feedback TYPE option<string>;
DEFINE FIELD IF NOT EXISTS author_handle  ON tweet_feedback TYPE string;
DEFINE FIELD IF NOT EXISTS verdict        ON tweet_feedback TYPE string ASSERT $value INSIDE ['accept', 'reject'];
DEFINE FIELD IF NOT EXISTS reason_tag     ON tweet_feedback TYPE option<string>;
DEFINE FIELD IF NOT EXISTS source_recipe  ON tweet_feedback TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created_at     ON tweet_feedback TYPE datetime;
DEFINE FIELD IF NOT EXISTS ai_verdict     ON tweet_feedback TYPE option<object> FLEXIBLE;
DEFINE INDEX IF NOT EXISTS idx_fb_tweet_id ON tweet_feedback FIELDS tweet_id;
DEFINE INDEX IF NOT EXISTS idx_fb_verdict  ON tweet_feedback FIELDS verdict;
DEFINE INDEX IF NOT EXISTS idx_fb_lang     ON tweet_feedback FIELDS lang;
`;

/**
 * 1.0.1 —— 回复关系权威字段(2026-09-02)
 *
 * 依据:载荷勘查实测(docs/10-business-design/x/data-acquisition-capability-survey.md §2.4)
 * X 的 GraphQL 响应里 legacy 对象自带完整回复关系:
 *   in_reply_to_status_id_str / in_reply_to_screen_name /
 *   in_reply_to_user_id_str / conversation_id_str
 * 此前从 DOM 猜(连接线像素/idx相邻/正则)的三套判据全部作废。
 *
 * ⚠️ 既有 in_reply_to 字段语义修正:原意是"被回复者 handle 或 URL",
 *    但取自 socialContext(那是「xx 转推了/已置顶」横幅),从未被正确填过
 *    —— 全库 860 行为 0。现改为存**父推 id**,与 in_reply_to_user 分工。
 *    不需要数据迁移:本来就没有一行有值。
 */
const X_SCHEMA_1_0_1 = `
-- 被回复者 handle(归一化:无 @、全小写,与 x_author.handle 同形态)
DEFINE FIELD IF NOT EXISTS in_reply_to_user ON x_tweet TYPE option<string>;
-- 会话根 id —— n 层关系分析靠它 GROUP BY(方案 §4.1(5):先不建边表)
DEFINE FIELD IF NOT EXISTS conversation_id  ON x_tweet TYPE option<string>;
DEFINE INDEX IF NOT EXISTS idx_tweet_in_reply_to   ON x_tweet FIELDS in_reply_to;
DEFINE INDEX IF NOT EXISTS idx_tweet_conversation  ON x_tweet FIELDS conversation_id;
`;

export async function x_migration_1_0_1(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_0_1);

  const now = Date.now();
  await db.query(
    `UPSERT $rid SET
      version = '1.0.1',
      appliedAt = $now,
      description = 'Reply relationship authoritative fields: in_reply_to_user / conversation_id'`,
    { rid: new RecordId('schema_version', '1.0.1'), now },
  );
}

/**
 * 1.0.2 —— handle 形态统一(2026-09-02)
 *
 * 问题:同一张表里两种形态并存 ——
 *   `source='search'` 的 982 行存 '@ylyz61'(带 @、保留大小写,DOM 抓取的历史遗留)
 *   `source='self_reply'` 的 78 行存 'netlab2gfw'(归一化,载荷采集时已过 normalizeHandle)
 * 实测后果:657 个不同取值 → 归一化后只有 656 个人,**已经有一个人被算成两个**
 * (正是本账号:'@NetLab2GFW' vs 'netlab2gfw')。
 * 将来按作者聚合(画像!)会把同一人拆成两条,且**不报错**。
 *
 * 统一到**归一化形态**(无 @、全小写),与 x_author.handle / normalizeHandle() 一致 ——
 * 跨表比对本来就按这个形态做(B 期屏蔽名单、收件箱隐藏过滤都是),
 * 让存储与比对同形态,消除这一层转换。
 *
 * ⚠️ 只改 handle 类字段,不动 author_name_at_post(展示名快照,本就该保留原样)。
 */
const X_SCHEMA_1_0_2 = `
UPDATE x_tweet SET author_handle = string::replace(string::lowercase(author_handle), '@', '')
  WHERE string::starts_with(author_handle, '@') OR author_handle != string::lowercase(author_handle);
UPDATE tweet_feedback SET author_handle = string::replace(string::lowercase(author_handle), '@', '')
  WHERE string::starts_with(author_handle, '@') OR author_handle != string::lowercase(author_handle);
`;

export async function x_migration_1_0_2(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_0_2);

  const now = Date.now();
  await db.query(
    `UPSERT $rid SET
      version = '1.0.2',
      appliedAt = $now,
      description = 'Normalize author_handle across x_tweet / tweet_feedback (strip @, lowercase)'`,
    { rid: new RecordId('schema_version', '1.0.2'), now },
  );
}

/**
 * 1.0.3 —— 采集游标(2026-09-02)
 *
 * 用户定的方向:「其实 X 上有很多标记,你要善于利用。」
 * 实测确认:X 每个 timeline 响应都自带分页游标 ——
 *   content.__typename = 'TimelineTimelineCursor',cursorType = 'Top' | 'Bottom'
 * `Bottom` 就是「下一页从这里继续」的官方标记。
 *
 * 这比我原来的做法好在:
 *  - 不用靠时间戳猜边界(时间戳做锚点必须区分「往新」「往旧」两个方向,
 *    还得让用户选,是把实现细节暴露给用户)
 *  - 游标是 X 自己的续传凭证,天然精确、天然不重复
 *  - 一个按钮即可:有游标就续传,没有就从头 —— 用户不必知道有这回事
 *
 * 表设计遵循数据模型总纲:游标是**可重算的派生状态**(丢了大不了重爬),
 * 与 x_tweet(真源)分开存,清空不影响任何业务数据。
 */
const X_SCHEMA_1_0_3 = `
DEFINE TABLE IF NOT EXISTS x_collect_cursor SCHEMAFULL;
-- 采集范围键:'<handle>:<kind>',如 'netlab2gfw:replies'
DEFINE FIELD IF NOT EXISTS scope        ON x_collect_cursor TYPE string ASSERT $value != '';
-- X 给的 Bottom 游标值 —— 下次从这里继续
DEFINE FIELD IF NOT EXISTS bottom_cursor ON x_collect_cursor TYPE option<string>;
-- 已抓到的最旧时间(展示用:让用户知道挖到哪了)
DEFINE FIELD IF NOT EXISTS oldest_at    ON x_collect_cursor TYPE option<datetime>;
-- 是否已到底(X 不再给新游标)—— 到底后无需再往前挖
DEFINE FIELD IF NOT EXISTS exhausted    ON x_collect_cursor TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS updated_at   ON x_collect_cursor TYPE datetime;
DEFINE INDEX IF NOT EXISTS idx_cursor_scope ON x_collect_cursor FIELDS scope UNIQUE;
`;

export async function x_migration_1_0_3(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_0_3);

  const now = Date.now();
  await db.query(
    `UPSERT $rid SET
      version = '1.0.3',
      appliedAt = $now,
      description = 'Collection cursor table (use X own Bottom cursor for resume)'`,
    { rid: new RecordId('schema_version', '1.0.3'), now },
  );
}

/**
 * 1.0.4 —— 账号基线数字(2026-09-02)
 *
 * 用户点出的关键:「你有发现用户有 post 的总数的吗?**这就是基线**。」
 *
 * `UserByScreenName` 响应里带 `tweet_counts.tweets`(本账号实测 1192)——
 * 我在能力勘查时就抓到并写进了文档,却只当成「画像基底」列了一行,
 * **没意识到它是采集完整度的标尺**。
 *
 * 有了基线,「抓够了没有」从**猜**变成**算**:
 *  - 进度可量化:已抓 N / 基线 M,而不是没有分母的「覆盖 X 天」
 *  - 「到底了」有客观判据:此前靠「X 不再给游标」间接推断,
 *    与「被限流」分不开;有基线就分得开
 *  - 增量可自动对账:基线涨 5、库里也涨 5 = 正常;基线涨了库里没动 = 漏采
 *
 * 这些是**会变的观测值**(会随发推增长),不是派生值,故存在实体上,
 * 并带 counts_at 记录观测时刻 —— 没有时刻的计数无法判断新鲜度。
 */
const X_SCHEMA_1_0_4 = `
-- 发推总数(原创+回复),X 官方计数 —— 采集完整度的分母
DEFINE FIELD IF NOT EXISTS tweet_count     ON x_author TYPE option<int>;
DEFINE FIELD IF NOT EXISTS media_count     ON x_author TYPE option<int>;
DEFINE FIELD IF NOT EXISTS followers_count ON x_author TYPE option<int>;
DEFINE FIELD IF NOT EXISTS following_count ON x_author TYPE option<int>;
-- 该账号的点赞总数(活跃度指标)
DEFINE FIELD IF NOT EXISTS favourites_count ON x_author TYPE option<int>;
-- ⚠️ 计数的观测时刻:没有它就判断不了新鲜度,也做不了「基线涨了多少」的对账
DEFINE FIELD IF NOT EXISTS counts_at       ON x_author TYPE option<datetime>;
-- 账号注册时间(账号年龄 —— 画像基底)
DEFINE FIELD IF NOT EXISTS account_created_at ON x_author TYPE option<datetime>;
`;

export async function x_migration_1_0_4(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_0_4);

  const now = Date.now();
  await db.query(
    `UPSERT $rid SET
      version = '1.0.4',
      appliedAt = $now,
      description = 'Account baseline counts (tweet_count as collection-completeness denominator)'`,
    { rid: new RecordId('schema_version', '1.0.4'), now },
  );
}

/**
 * 1.0.5 —— 取消 TTL,X 推文永久保存(2026-09-02)
 *
 * 用户拍板:「永久保存吧。等容量到了一定的程度,再考虑迁移新的架构。」
 *
 * 背景:原 TTL 设计(A 期)的前提是「没被采纳的推没价值」,7 天后删除。
 * 该前提已被推翻 ——「有些不显示的帖子不见得没有用途,可以用于分析竞争对手。」
 * 被 Gemma 判 skip / 被黑名单过滤掉的推,是竞品分析与 AI 语料的素材,
 * 删掉不可再生。实测当时有 368 行带 TTL,其中 295 行是 skip/filtered_out。
 *
 * ⚠️ A 期教训在前:旧 tweet_inbox 因 TTL 丢过 449 条已采纳推文的正文。
 *    删除是不可逆的,这次把整个 TTL 机制关掉,而不是调长过期时间。
 *
 * 配套代码改动:x-timeline-scan 不再设 expires_at;cleanExpired 改为 no-op。
 */
const X_SCHEMA_1_0_5 = `
UPDATE x_tweet SET expires_at = NONE WHERE expires_at != NONE;
`;

export async function x_migration_1_0_5(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_0_5);

  const now = Date.now();
  await db.query(
    `UPSERT $rid SET
      version = '1.0.5',
      appliedAt = $now,
      description = 'Disable TTL: keep all X tweets permanently (competitor analysis + AI corpus)'`,
    { rid: new RecordId('schema_version', '1.0.5'), now },
  );
}

export async function x_migration_1_0_0(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_0_0);

  const now = Date.now();
  await db.query(
    `UPSERT $rid SET
      version = '1.0.0',
      appliedAt = $now,
      description = 'X database initial schema: x_author / x_tweet + runtime tables (tweet_inbox / search_recipes / tweet_feedback)'`,
    { rid: new RecordId('schema_version', '1.0.0'), now },
  );
}

/**
 * 1.0.6 —— X per-ws 角色表(2026-09-03)
 *
 * 用户拍板「一个 ws 只干一件事」:定时搜索采集与活动核验分到不同 ws,
 * 各用自己的 X webview,互不打断(详见 shared/types/x-ws-role-types.ts)。
 *
 * 为什么单独建表而不塞进 workspace 实体:角色是 **X 模块的关注点**,
 * workspace 是宿主概念 —— 往宿主实体里塞业务字段会让边界烂掉(总纲原则 1)。
 */
const X_SCHEMA_1_0_6 = `
DEFINE TABLE IF NOT EXISTS x_ws_role SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS ws_id            ON x_ws_role TYPE string ASSERT $value != '';
-- 'search' | 'campaign' | 'idle'
DEFINE FIELD IF NOT EXISTS role             ON x_ws_role TYPE string ASSERT $value != '';
-- campaign 专用:盯哪篇文章(留空=自动识别最新 Article,正式活动应显式钉死)
DEFINE FIELD IF NOT EXISTS article_id       ON x_ws_role TYPE option<string>;
-- campaign 专用:是否由本 ws 承接接口 B(外部触发口),配置决定不写死
DEFINE FIELD IF NOT EXISTS serves_refresh   ON x_ws_role TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS interval_minutes ON x_ws_role TYPE option<int>;
DEFINE FIELD IF NOT EXISTS updated_at       ON x_ws_role TYPE datetime;
DEFINE INDEX IF NOT EXISTS idx_ws_role_ws   ON x_ws_role FIELDS ws_id UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_ws_role_role ON x_ws_role FIELDS role;
`;

export async function x_migration_1_0_6(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_0_6);

  // ⚠️ 存量回填:已在跑的 ws 必须默认 'search',否则升级后角色守卫会把
  // 它们全判成 idle → **定时采集静默全停**,而日志只说「跳过」,像是正常行为。
  // 判据:x_tweet 里出现过的 ws_id 就是在采集的(有实际采集记录才回填,不凭空造)。
  await db.query(`
    LET $seen = (SELECT VALUE ws_id FROM x_tweet WHERE ws_id != NONE GROUP BY ws_id);
    FOR $ws IN $seen {
      IF !(SELECT ws_id FROM x_ws_role WHERE ws_id = $ws)[0] {
        CREATE x_ws_role SET ws_id = $ws, role = 'search',
          serves_refresh = false, updated_at = time::now();
      };
    };
  `);
  await db.query(
    `UPSERT $rid SET version = '1.0.6', appliedAt = $now,
      description = 'X per-ws role table (search / campaign / idle)'`,
    { rid: new RecordId('schema_version', '1.0.6'), now: Date.now() },
  );
}

/**
 * 1.0.7 —— 活动留言表(2026-09-03)
 *
 * 用户定的流程:「① 点击这个推文 ② 往下滚动,获取推文的最新元数据
 *   ③ **元数据入库**,按照数据契约提供服务即可」
 * → 此前只抓+显示,没有 ③。本表就是 ③ 的落点。
 *
 * 为什么不塞进 x_tweet:x_tweet 是「推文实体」,而这里要记的是
 * **「某篇活动文章下的某条留言 + 它的推送状态」** —— 后者是活动流程的状态,
 * 不是推文自身的属性。混进去会让 x_tweet 长出与活动耦合的字段(总纲原则 1)。
 *
 * 幂等键 = 契约 §2.1 的 (article_id, tweet_id):
 * 「同一 (article_id, tweet_id) 重复推送只更新、不新增」。
 */
const X_SCHEMA_1_0_7 = `
DEFINE TABLE IF NOT EXISTS x_campaign_reply SCHEMAFULL;
-- 幂等键的两半
DEFINE FIELD IF NOT EXISTS article_id  ON x_campaign_reply TYPE string ASSERT $value != '';
DEFINE FIELD IF NOT EXISTS tweet_id    ON x_campaign_reply TYPE string ASSERT $value != '';
-- 契约 §2.1 的 item 字段(原样存,推送时零转换)
DEFINE FIELD IF NOT EXISTS kind        ON x_campaign_reply TYPE string;
DEFINE FIELD IF NOT EXISTS x_uid       ON x_campaign_reply TYPE option<string>;
DEFINE FIELD IF NOT EXISTS username    ON x_campaign_reply TYPE string;
DEFINE FIELD IF NOT EXISTS has_media   ON x_campaign_reply TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS created_at  ON x_campaign_reply TYPE datetime;
DEFINE FIELD IF NOT EXISTS in_reply_to_tweet_id ON x_campaign_reply TYPE option<string>;
DEFINE FIELD IF NOT EXISTS text_excerpt ON x_campaign_reply TYPE option<string>;
DEFINE FIELD IF NOT EXISTS deleted     ON x_campaign_reply TYPE bool DEFAULT false;
-- 采集与推送状态(活动流程的状态,不是推文属性)
DEFINE FIELD IF NOT EXISTS first_seen_at ON x_campaign_reply TYPE datetime;
DEFINE FIELD IF NOT EXISTS last_seen_at  ON x_campaign_reply TYPE datetime;
-- 契约 §2.3:未确认成功的批次重启后要重推 → 必须记「推没推成功」
DEFINE FIELD IF NOT EXISTS pushed_at   ON x_campaign_reply TYPE option<datetime>;
-- 字段变化(has_media 由 false 变 true、deleted)后需要重推,故记内容指纹
DEFINE FIELD IF NOT EXISTS payload_hash ON x_campaign_reply TYPE option<string>;
DEFINE INDEX IF NOT EXISTS idx_campaign_key ON x_campaign_reply
  FIELDS article_id, tweet_id UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_campaign_article ON x_campaign_reply FIELDS article_id;
DEFINE INDEX IF NOT EXISTS idx_campaign_pushed ON x_campaign_reply FIELDS pushed_at;
`;

export async function x_migration_1_0_7(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_0_7);
  await db.query(
    `UPSERT $rid SET version = '1.0.7', appliedAt = $now,
      description = 'Campaign reply table (contract idempotency key + push state)'`,
    { rid: new RecordId('schema_version', '1.0.7'), now: Date.now() },
  );
}

/**
 * 1.0.8 —— per-ws 登录账号(2026-09-03)
 *
 * 用户指正:「当前 ws 是登录什么账号,就核实这个 ws 的状态,
 *   而不是跑到一个对应不上的 ws 来核实」。
 *
 * 此前的错误建模:`x_author.is_self` 是**全局唯一**的
 * (setSelfAuthor 会把其它行的 is_self 清掉)。但 X webview 的登录态是
 * **per-ws** 的(partition = persist:webview-${wsId}),两个 ws 可以登不同账号。
 * 后果:第二个 ws 识别账号时会**静默覆盖**第一个,之后所有「我是谁」的查询
 * 都会给出错的那个 —— 而现象只是「抓不到/抓错人」,不报错。
 *
 * 修法:身份归属到 ws。x_author.is_self 保留(兼容旧数据、表示"曾是本人"),
 * 但**权威来源改为本表**:一个 ws 一行,记它登录的是谁。
 */
const X_SCHEMA_1_0_8 = `
DEFINE TABLE IF NOT EXISTS x_ws_account SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS ws_id      ON x_ws_account TYPE string ASSERT $value != '';
-- 该 ws 当前登录的账号(归一化 handle:无 @、小写)
DEFINE FIELD IF NOT EXISTS handle     ON x_ws_account TYPE string ASSERT $value != '';
-- 数字 id(rest_id)—— 契约的 x_uid 用它匹配最稳,handle 会改名
DEFINE FIELD IF NOT EXISTS rest_id    ON x_ws_account TYPE option<string>;
DEFINE FIELD IF NOT EXISTS detected_at ON x_ws_account TYPE datetime;
DEFINE INDEX IF NOT EXISTS idx_ws_account_ws ON x_ws_account FIELDS ws_id UNIQUE;
`;

export async function x_migration_1_0_8(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_0_8);
  await db.query(
    `UPSERT $rid SET version = '1.0.8', appliedAt = $now,
      description = 'Per-ws logged-in account (identity belongs to ws, not global)'`,
    { rid: new RecordId('schema_version', '1.0.8'), now: Date.now() },
  );
}

/**
 * 1.0.9 —— 入向互动(通知页具名名单,2026-09-03)
 *
 * 用户:「应该获取它的元数据:点赞多少次(名单),转发多少次(名单),
 *   回复多少次(名单)。只有能够区别出这些,才能够谈得上更新多少个呀?」
 * 并指出:「这个需要在 notification 中拿到」——**对,已实测验证**。
 *
 * 实测结构(NotificationsTimeline,GraphQL 非 v1.1):
 *   TimelineNotification.notification_icon        ← 行为类型(heart_icon=赞)
 *   TimelineNotification.template.from_users[]    ← **具名操作者**(rest_id + handle)
 *   TimelineNotification.template.target_objects[]← 被操作的推 id
 * 一条「X and 2 others liked」的通知,from_users 确实是 3 个,不是 1 个。
 *
 * ⚠️ 归属到 ws:通知是「别人对**我**」,而「我」是**该 ws 登录的账号**。
 *   多 ws 多账号并存,不记 ws 就分不清是谁收到的。
 */
const X_SCHEMA_1_0_9 = `
DEFINE TABLE IF NOT EXISTS x_interaction SCHEMAFULL;
-- 幂等键三元组:同一通知里同一人对同一条推的同一种行为,只算一条
DEFINE FIELD IF NOT EXISTS kind        ON x_interaction TYPE string;   -- like/retweet/reply/follow/quote/other
DEFINE FIELD IF NOT EXISTS actor_uid   ON x_interaction TYPE string;   -- 操作者 rest_id(稳定,不随改名变)
DEFINE FIELD IF NOT EXISTS target_id   ON x_interaction TYPE string;   -- 被操作的推 id;follow 类为空串
DEFINE FIELD IF NOT EXISTS actor_handle ON x_interaction TYPE option<string>;
-- 接收方:该 ws 登录的账号(通知是「别人对我」,这个「我」是 per-ws 的)
DEFINE FIELD IF NOT EXISTS ws_id       ON x_interaction TYPE string;
DEFINE FIELD IF NOT EXISTS owner_handle ON x_interaction TYPE option<string>;
DEFINE FIELD IF NOT EXISTS notified_at ON x_interaction TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS first_seen_at ON x_interaction TYPE datetime;
DEFINE FIELD IF NOT EXISTS message     ON x_interaction TYPE option<string>;
DEFINE INDEX IF NOT EXISTS idx_interaction_key ON x_interaction
  FIELDS kind, actor_uid, target_id UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_interaction_kind   ON x_interaction FIELDS kind;
DEFINE INDEX IF NOT EXISTS idx_interaction_actor  ON x_interaction FIELDS actor_uid;
DEFINE INDEX IF NOT EXISTS idx_interaction_target ON x_interaction FIELDS target_id;
`;

export async function x_migration_1_0_9(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_0_9);
  await db.query(
    `UPSERT $rid SET version = '1.0.9', appliedAt = $now,
      description = 'Inbound interactions from notifications (named actors)'`,
    { rid: new RecordId('schema_version', '1.0.9'), now: Date.now() },
  );
}

/**
 * 1.1.0 —— 互动带上「属于哪篇文章」与「带没带图」(2026-09-03)
 *
 * 用户指正:「首先明确是哪一条推文,然后才可以正确匹配这个通知
 *   都有哪些属于这个推文的。你随便抓随便统计可不行。」
 *
 * 此前 x_interaction 只存 target_id,于是只能做**全局汇总**
 * (「点赞 5 条」——散在 4 条不同的推上,没有主语),
 * 无法回答「**这条推文**谁点赞了」。而后者才是活动核验的口径。
 *
 * 解析层其实早已解出这两个字段(target.legacy 里带着),只是没落库 ——
 * 属于「采到了却丢掉」,比没采到更隐蔽。
 */
const X_SCHEMA_1_1_0 = `
DEFINE FIELD IF NOT EXISTS target_conversation_id ON x_interaction TYPE option<string>;
DEFINE FIELD IF NOT EXISTS target_has_media       ON x_interaction TYPE option<bool>;
DEFINE FIELD IF NOT EXISTS target_text            ON x_interaction TYPE option<string>;
DEFINE FIELD IF NOT EXISTS target_created_at      ON x_interaction TYPE option<datetime>;
DEFINE INDEX IF NOT EXISTS idx_interaction_conv ON x_interaction FIELDS target_conversation_id;
`;

export async function x_migration_1_1_0(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_1_0);
  await db.query(
    `UPSERT $rid SET version = '1.1.0', appliedAt = $now,
      description = 'Interaction target metadata (conversation_id + has_media) for per-article verification'`,
    { rid: new RecordId('schema_version', '1.1.0'), now: Date.now() },
  );
}

/**
 * 1.1.1 —— 互动带上「引用了哪条推」(2026-09-03)
 *
 * 用户观察到「转发后文章没有内容,应该只有一个链接」,一句话点破归属漏判:
 * 引用转发某篇文章时,那条推的 conversation_id 是**它自己所在的会话**,
 * 文章的关联藏在 quoted_status_id_str 里。只按 target_id / conversation_id
 * 归属会把整类「引用转发」漏掉 —— 而它恰恰是活动最常见的参与形式。
 */
const X_SCHEMA_1_1_1 = `
DEFINE FIELD IF NOT EXISTS target_quoted_status_id ON x_interaction TYPE option<string>;
DEFINE INDEX IF NOT EXISTS idx_interaction_quoted ON x_interaction FIELDS target_quoted_status_id;
`;

export async function x_migration_1_1_1(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_1_1);
  await db.query(
    `UPSERT $rid SET version = '1.1.1', appliedAt = $now,
      description = 'Interaction quoted_status_id (quote-retweet attribution)'`,
    { rid: new RecordId('schema_version', '1.1.1'), now: Date.now() },
  );
}

/**
 * 1.1.2 —— 回复反馈(学习期,2026-09-05)
 *
 * 用户定的节奏:「先定一个学习期间,它所有的回复都经过我点击后方能发出,
 *   等到一定数量积累后,就可以让它自动回复了。对于无法决定,
 *   或者和前期区别太大的,可以留待判决即可。」
 *
 * 为什么**不**塞进 tweet_feedback:
 *   那张表回答的是「这条推**值不值得回**」(accept/reject);
 *   这张表回答的是「这条**回得对不对**」—— 两个问题。
 *   而且 tweet_feedback 那 6900+ 行是**不可再生资产**(40 天连续人工判断),
 *   不给它加字段冒险。
 *
 * ⭐ 记「AI 原文 vs 用户改成什么」是关键 ——
 *   现在的 accept/reject **记不了「该回,但不该这么回」**。
 *   用户把正文改了一句,这个信息此前直接丢掉。存下来它能回答:
 *   哪类推文总要手动补话、生成质量在涨还是在跌、什么时候能放手自动。
 *
 * 同时它是 in-context learning 的**回流源**:approved 的例子直接当少样本
 * 喂回生成 prompt,模型会越来越像用户的口气 —— 不训练模型、随时可撤。
 */
const X_SCHEMA_1_1_2 = `
DEFINE TABLE IF NOT EXISTS x_reply_feedback SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS tweet_id      ON x_reply_feedback TYPE string ASSERT $value != '';
DEFINE FIELD IF NOT EXISTS tweet_text    ON x_reply_feedback TYPE string;
DEFINE FIELD IF NOT EXISTS lang          ON x_reply_feedback TYPE string;   -- zh | en
-- AI 写的原文;回落模板时是模板正文
DEFINE FIELD IF NOT EXISTS ai_text       ON x_reply_feedback TYPE string;
DEFINE FIELD IF NOT EXISTS source        ON x_reply_feedback TYPE string;   -- generated | template
-- 用户最终填进 X 的正文。与 ai_text 相同 = 原样通过(放手自动的判据)
DEFINE FIELD IF NOT EXISTS final_text    ON x_reply_feedback TYPE string;
DEFINE FIELD IF NOT EXISTS edited        ON x_reply_feedback TYPE bool DEFAULT false;
-- 用户的处置:filled=填入X(默认认可) / dismissed=跳过不回
DEFINE FIELD IF NOT EXISTS action        ON x_reply_feedback TYPE string;
DEFINE FIELD IF NOT EXISTS confidence    ON x_reply_feedback TYPE option<float>;
DEFINE FIELD IF NOT EXISTS ref           ON x_reply_feedback TYPE option<string>;
DEFINE FIELD IF NOT EXISTS ws_id         ON x_reply_feedback TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created_at    ON x_reply_feedback TYPE datetime;
DEFINE INDEX IF NOT EXISTS idx_rfb_tweet   ON x_reply_feedback FIELDS tweet_id;
DEFINE INDEX IF NOT EXISTS idx_rfb_lang    ON x_reply_feedback FIELDS lang;
DEFINE INDEX IF NOT EXISTS idx_rfb_edited  ON x_reply_feedback FIELDS edited;
DEFINE INDEX IF NOT EXISTS idx_rfb_created ON x_reply_feedback FIELDS created_at;
`;

export async function x_migration_1_1_2(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_1_2);
  await db.query(
    `UPSERT $rid SET version = '1.1.2', appliedAt = $now,
      description = 'Reply feedback (learning period: AI text vs user edit)'`,
    { rid: new RecordId('schema_version', '1.1.2'), now: Date.now() },
  );
}

/**
 * 1.1.3 —— 回复推断链留档(2026-09-06)
 *
 * 用户:「每回一条推文,都在逻辑链上做几步分析并记录下来列出来,
 *   这样你才有回归检查的机会……才有回归分析 Gemma4 的执行是否正确的再分析能力。」
 *
 * 此前只记 ai_text/final_text —— 知道「写了什么」,不知道「为什么这么写」。
 * 回错了无法定位:是把推广者看成真实用户?是因由读错?还是因由对但正文答偏?
 *
 * ⚠️ `poster_kind` 是**模型看正文的推断,不是查证过的事实** ——
 * 库里没有账号资料(x_author 36 行、粉丝数字段全空)。查询时别当事实用。
 */
const X_SCHEMA_1_1_3 = `
DEFINE FIELD IF NOT EXISTS poster_kind ON x_reply_feedback TYPE option<string>;
DEFINE FIELD IF NOT EXISTS poster_read ON x_reply_feedback TYPE option<string>;
DEFINE FIELD IF NOT EXISTS trigger     ON x_reply_feedback TYPE option<string>;
DEFINE FIELD IF NOT EXISTS ai_reason   ON x_reply_feedback TYPE option<string>;
DEFINE FIELD IF NOT EXISTS in_thread   ON x_reply_feedback TYPE bool DEFAULT false;
DEFINE INDEX IF NOT EXISTS idx_rfb_poster ON x_reply_feedback FIELDS poster_kind;
`;

export async function x_migration_1_1_3(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_1_3);
  await db.query(
    `UPSERT $rid SET version = '1.1.3', appliedAt = $now,
      description = 'Reply decision trace (poster read / trigger) for regression review'`,
    { rid: new RecordId('schema_version', '1.1.3'), now: Date.now() },
  );
}

/**
 * 1.1.4 —— 回填「见过的人」(2026-09-06)
 *
 * 用户问「凡是爬下来的用户,都保存下来没有删除吧?」—— 一查发现没有:
 *   x_tweet 里有 **3458 个不同作者**,x_author 只有 **36 行**
 *   (34 blocked + 1 is_self + 1 测试残留)。
 * 采集链路从不写人表,只有「对某人采取动作」才建行 ——
 * 设计 §4.1(4) 说 x_author 是「人」的唯一真源,实际它成了动作记录表。
 *
 * 代码侧已修(upsertTweet → registerSeenAuthor),但那只管**将来**;
 * 存量 3400+ 个作者需要这次回填补上,否则历史数据里的人永远没有落点。
 *
 * ⚠️ 只建标识行,**不写任何计数**:seen_count/replied_count 是
 * 第三层可重算属性(设计 §4.1(4) 明确「不放这里」)。
 * ⚠️ 用 INSERT IGNORE 语义:已存在的行(带 blocked/watched 意志)绝不能被覆盖。
 */
export async function x_migration_1_1_4(db: Surreal): Promise<void> {
  // ⚠️ 刻意**不用**纯 SQL 的 `FOR ... IN array::distinct(...)`:
  //    实测(2026-09-06)那条语句对 6762 行的 x_tweet 返回**空响应、
  //    一行也没建、且不报错** —— 典型的静默失败。
  //    改成 GROUP BY 取去重作者(实测 22ms)+ 分批 CREATE,每批留痕。
  const seenRes = await db.query<[Array<{ author_handle: string }>]>(
    `SELECT author_handle FROM x_tweet GROUP BY author_handle`,
  );
  const knownRes = await db.query<[Array<{ handle: string }>]>(
    `SELECT handle FROM x_author`,
  );
  const known = new Set((knownRes?.[0] ?? []).map((r) => r.handle));
  const missing = (seenRes?.[0] ?? [])
    .map((r) => r.author_handle)
    .filter((h) => h && !known.has(h));

  console.log(`[x-migration 1.1.4] 见过 ${seenRes?.[0]?.length ?? 0} 个作者,`
    + `已登记 ${known.size},待回填 ${missing.length}`);

  // 分批:一次性几千条 CREATE 容易撞事务/超时,批量出错也难定位
  const BATCH = 200;
  let done = 0;
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    // ⚠️ 只建标识行,不写任何计数(设计 §4.1(4):那是可重算的第三层属性)
    const stmts = batch.map((_, k) =>
      `CREATE x_author SET handle = $h${k}, blocked = false, watched = false, is_self = false;`
    ).join('\n');
    const params: Record<string, string> = {};
    batch.forEach((h, k) => { params[`h${k}`] = h; });
    await db.query(stmts, params);
    done += batch.length;
  }
  console.log(`[x-migration 1.1.4] 回填完成:新建 ${done} 行`);

  await db.query(
    `UPSERT $rid SET version = '1.1.4', appliedAt = $now,
      description = 'Backfill x_author from x_tweet (people seen but never registered)'`,
    { rid: new RecordId('schema_version', '1.1.4'), now: Date.now() },
  );
}

/**
 * 1.1.5 —— 被回复者 handle 落库(2026-09-06)
 *
 * 用户定的回复链条:「先追踪这个帖子的上一层的内容(确保它和 VPN 相关),
 *   再确认这个用户的活跃度,最后才能拟定出比较好的回复内容」。
 * ① 是**正确性闸门**,但此前完全没做 —— 而且卡在采集层:
 *
 * `x-timeline-scan` 一直在写 `in_reply_to: tweet.inReplyTo`,
 * 但 DOM 提取器取的是 `[data-testid="socialContext"]` ——
 * **那是「xx 转推了/已置顶」横幅,不是回复关系**,所以该字段从未被正确填过。
 * 实测:回复过的 20 条推,父推 id 全空 —— 现象与「它们本来就没有父推」
 * 一模一样,极易被当成事实(我差点就是)。
 *
 * 修法:DOM 层改抓「Replying to @xxx」那一行的 handle(存这个字段),
 * 父推 id 走载荷层(harvester 已有 in_reply_to_status_id_str)。
 */
const X_SCHEMA_1_1_5 = `
-- ⚠️ 写 x_tweet 不是 tweet_inbox:后者是遗留表,全仓读写都走 x_tweet
--    (2026-09-06 实测:x_tweet 有当天采的 112 条,tweet_inbox 停在 5 天前)
DEFINE FIELD IF NOT EXISTS in_reply_to_user ON x_tweet TYPE option<string>;
DEFINE INDEX IF NOT EXISTS idx_tweet_reply_user ON x_tweet FIELDS in_reply_to_user;
`;

export async function x_migration_1_1_5(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_1_5);
  await db.query(
    `UPSERT $rid SET version = '1.1.5', appliedAt = $now,
      description = 'tweet_inbox.in_reply_to_user (reply context for step 1 gate)'`,
    { rid: new RecordId('schema_version', '1.1.5'), now: Date.now() },
  );
}

/**
 * 1.1.6 —— 关系视角与简介落库(2026-09-06)
 *
 * 用户 2026-09-06 一句话点破:「账户关联关系不是在爬下来的数据都有吗?
 *   只是如何触发,什么时候触发而已。」——对。
 * `UserByScreenName` 载荷自带 `relationship_perspectives`
 * (following / followed_by / blocking / blocked_by / muting),**零额外请求**
 * (能力勘查 §2.4 实测)。x-author-profile 早就解析出来了,
 * 但**只在内存里、没落库、也没进判断** —— 又一次「采到了没用上」。
 *
 * ⭐ 为什么值得存:「他关注了我」是判断链条第 ② 步(活跃度/真实性)的**强信号** ——
 * 水军和营销号不会去关注一个小账号,而真实用户看过你的内容才会关注。
 * 这比粉丝数更难伪造。
 *
 * ⚠️ 与 `blocked` 区分:`blocked` 是**我们 app 内部的屏蔽意志**,
 *    `x_blocking` 是**X 上的真实拉黑状态**(我在 X 上拉黑了他)。两码事,别混。
 */
const X_SCHEMA_1_1_6 = `
DEFINE FIELD IF NOT EXISTS follows_me   ON x_author TYPE option<bool>;
DEFINE FIELD IF NOT EXISTS i_follow     ON x_author TYPE option<bool>;
DEFINE FIELD IF NOT EXISTS x_blocking   ON x_author TYPE option<bool>;
DEFINE FIELD IF NOT EXISTS bio          ON x_author TYPE option<string>;
DEFINE FIELD IF NOT EXISTS is_blue_verified ON x_author TYPE option<bool>;
DEFINE INDEX IF NOT EXISTS idx_author_follows_me ON x_author FIELDS follows_me;
`;

export async function x_migration_1_1_6(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_1_6);
  await db.query(
    `UPSERT $rid SET version = '1.1.6', appliedAt = $now,
      description = 'Author relationship perspectives + bio (step 2 activity signals)'`,
    { rid: new RecordId('schema_version', '1.1.6'), now: Date.now() },
  );
}

/**
 * 1.1.7 —— 上文快照(2026-09-06)
 *
 * 用户:「从 Gemma4 的建议名单中获取,因为每一个它建议的,都应该获取上下文。」
 * 上文是①闸门(判「这楼真和 VPN 相关吗」)的输入。
 * 此前只在点开弹窗时现抓,每条现等 10s;存下来后点开即有。
 *
 * ⚠️ 存**快照**而非只存父推 id:父推可能被删或被改,
 *    快照保留我们当时判断的依据(与 author_name_at_post 同思路)。
 */
const X_SCHEMA_1_1_7 = `
-- ⚠️ 同上:只定义在 x_tweet,别往遗留表上加字段
DEFINE FIELD IF NOT EXISTS parent_text       ON x_tweet TYPE option<string>;
DEFINE FIELD IF NOT EXISTS parent_handle     ON x_tweet TYPE option<string>;
DEFINE FIELD IF NOT EXISTS parent_fetched_at ON x_tweet TYPE option<datetime>;
`;

export async function x_migration_1_1_7(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_1_7);
  await db.query(
    `UPSERT $rid SET version = '1.1.7', appliedAt = $now,
      description = 'Parent tweet snapshot (context for step 1 gate)'`,
    { rid: new RecordId('schema_version', '1.1.7'), now: Date.now() },
  );
}

/**
 * 1.1.8 —— ⭐⭐ 任务表(2026-09-14,用户拍板「甲」)
 *
 * > 「我们先做一个 task 的配置面板,未来所有的执行从先在面板配置任务,然后才执行,
 * >   对于两个任务撞车的,不能同时执行。」
 * > 「甲 —— 我喜欢干净,对现有的代码已经难以忍受,搞不清楚哪个是哪个了。」
 *
 * ── 它替代 `search_recipes` ──
 *
 * ⚠️ 关键差别:配方表把 `keywords`/`min_likes`/`lang` **平铺成字段**,
 * 于是加一种新采集方式就得改表结构。任务表把它们收进 `params`(FLEXIBLE),
 * 由 `CollectStrategy.paramsSchema` 定义与校验 ——
 * **加一种策略 = 注册一个,本表一个字段都不用动。**
 *
 * ⚠️⚠️ `params` 必须是 `TYPE object FLEXIBLE`:
 *  · 少了 FLEXIBLE → SCHEMAFULL 下子字段**静默丢弃**(本库踩过,x-schema.ts:101)
 *  · 语序不可颠倒(`FLEXIBLE object` 是 parse error,而**单条 DDL parse error
 *    会让整段被服务端拒收**,现场表现是「表建了一半」)
 *
 * ── 迁移:4 条配方 → 4 个任务 ──
 *
 * ⭐ `task_id` **沿用原 `recipe_id`** —— `x_tweet.search_recipe` 那 11850 行
 * 历史外键才对得上。改 id 就要重写 11850 行,收益只是好看。
 *
 * ⚠️ 老表**不删**(本步只加不改,删在 1c 步):
 * 迁移失败时还能回去看原数据,而且 1b 之前调度器仍可能读它。
 */
const X_SCHEMA_1_1_8 = `
DEFINE TABLE IF NOT EXISTS x_task SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS task_id      ON x_task TYPE string ASSERT $value != '';
DEFINE FIELD IF NOT EXISTS name         ON x_task TYPE string ASSERT $value != '';
DEFINE FIELD IF NOT EXISTS description  ON x_task TYPE option<string>;
-- ⭐ 注册表里的策略 id。故意是 string 不是枚举 —— 写死联合类型 = 注册制退回枚举
DEFINE FIELD IF NOT EXISTS strategy_id  ON x_task TYPE string ASSERT $value != '';
-- ⭐⭐ 策略参数。形状由 paramsSchema 声明,本表不认识内容(加策略零改表的兑现点)
DEFINE FIELD IF NOT EXISTS params       ON x_task TYPE object FLEXIBLE;
DEFINE FIELD IF NOT EXISTS enabled      ON x_task TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS interval_minutes ON x_task TYPE int DEFAULT 30;
DEFINE FIELD IF NOT EXISTS last_run_at  ON x_task TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS ws_id        ON x_task TYPE option<string>;
-- 运行期状态:「跑了没成功」与「没跑」在界面上长得一样,必须分开记
DEFINE FIELD IF NOT EXISTS run_state    ON x_task TYPE option<string>;
DEFINE FIELD IF NOT EXISTS last_error   ON x_task TYPE option<string>;
DEFINE FIELD IF NOT EXISTS last_result  ON x_task TYPE option<object> FLEXIBLE;
DEFINE FIELD IF NOT EXISTS created_at   ON x_task TYPE datetime DEFAULT time::now();
DEFINE INDEX IF NOT EXISTS idx_task_id      ON x_task FIELDS task_id UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_task_enabled ON x_task FIELDS enabled;
`;

export async function x_migration_1_1_8(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_1_8);

  /**
   * ⭐ 把现有配方搬成任务。
   *
   * ⚠️ **幂等**:已存在同 task_id 的跳过 —— migration 可能因上一条失败而重跑,
   * 重复 CREATE 会撞 UNIQUE 索引让整段 DDL 白跑。
   *
   * ⚠️ 参数装配要与 `keywordStrategy.paramsSchema` 的 key **逐字对应**:
   * 拼错一个 key 不会报错,只会让那个参数**静默失效**(如 keywords 丢了就搜空串)。
   * 守卫 `tests/x/task-migration.test.ts` 钉住这组对应关系。
   */
  const existing = await db.query<[Array<{ task_id: string }>]>(
    `SELECT task_id FROM x_task`,
  );
  const have = new Set((existing[0] ?? []).map((r) => r.task_id));

  const recipes = await db.query<[Array<Record<string, unknown>>]>(
    `SELECT * FROM search_recipes`,
  );
  let migrated = 0;
  for (const r of recipes[0] ?? []) {
    const id = String(r.recipe_id ?? '');
    if (!id || have.has(id)) continue;

    // ⚠️ 只装非空值:传 undefined → NONE(option 语义),绝不传 null
    const params: Record<string, unknown> = {};
    if (Array.isArray(r.keywords) && r.keywords.length) params.keywords = r.keywords;
    if (Array.isArray(r.from_accounts) && r.from_accounts.length) params.fromAccounts = r.from_accounts;
    // help_signals 只对 help-wanted 模板有意义(与 keywordStrategy.target 同口径)
    if (r.template === 'help-wanted' && Array.isArray(r.help_signals) && r.help_signals.length) {
      params.helpSignals = r.help_signals;
    }
    if (r.lang) params.lang = String(r.lang);
    if (typeof r.min_likes === 'number' && r.min_likes > 0) params.minLikes = r.min_likes;
    if (typeof r.min_retweets === 'number' && r.min_retweets > 0) params.minRetweets = r.min_retweets;
    if (typeof r.since_hours === 'number') params.sinceHours = r.since_hours;
    if (r.result_type) params.resultType = String(r.result_type);
    if (r.last_run_at) params.lastRunAt = new Date(String(r.last_run_at)).toISOString();

    await db.query(
      `CREATE x_task SET
         task_id = $id, name = $name, description = $desc,
         strategy_id = 'keyword', params = $params,
         enabled = $enabled, interval_minutes = $interval,
         last_run_at = $lastRun, ws_id = $wsId,
         run_state = 'idle', created_at = time::now()`,
      {
        id,
        name: String(r.name ?? id),
        desc: `由配方迁移(template=${String(r.template ?? '?')})`,
        params,
        enabled: r.enabled === true,
        interval: typeof r.interval_minutes === 'number' ? r.interval_minutes : 30,
        lastRun: r.last_run_at ? new Date(String(r.last_run_at)) : undefined,
        wsId: r.ws_id ? String(r.ws_id) : undefined,
      },
    );
    migrated += 1;
  }
  console.log(`[x-schema 1.1.8] 配方 → 任务:迁入 ${migrated} 条`);

  await db.query(
    `UPSERT $rid SET version = '1.1.8', appliedAt = $now,
      description = 'Task table (recipes become tasks; params driven by strategy schema)'`,
    { rid: new RecordId('schema_version', '1.1.8'), now: Date.now() },
  );
}

/**
 * 1.1.9 —— ⭐ 任务归属到 ws(2026-09-14,用户拍板)
 *
 * > 「应该是在哪个窗口配置,就是打开哪个窗口才执行吧?
 * >   任何的配置只是对自己的窗口负责。」
 * > 「先归 ws-2,后面要在 task 窗口配置才对。」
 *
 * ── 为什么必须补这一刀 ──
 *
 * 1.1.8 从配方迁来的四条任务 `ws_id` **全是空**(配方表本来就没填),
 * 而空的语义是「在所有可用 ws 上跑」。实测三个洞:
 *  · 同一批推抓两遍,翻译调两次(刚被 Google 429 限流过)
 *  · `run_state`/`last_result` 被后完成的那个 ws **覆盖**,数字看着正常只是少一半
 *  · ⚠️ webview 租约**挡不住** —— 两个 ws 是两个 pageId,各拿各的
 *
 * ⭐ 归属模型下这些结构上不可能发生。
 *
 * ⚠️ 只补**空值**的行:已经指定过 ws 的不动(幂等,且不覆盖人工设置)。
 */
const X_SCHEMA_1_1_9 = `
UPDATE x_task SET ws_id = 'ws-2' WHERE ws_id = NONE OR ws_id = '';
`;

export async function x_migration_1_1_9(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_1_9);
  const left = await db.query<[Array<{ c: number }>]>(
    `SELECT count() AS c FROM x_task WHERE ws_id = NONE GROUP ALL`,
  );
  const remaining = left[0]?.[0]?.c ?? 0;
  if (remaining > 0) {
    // fail loud:没归属的任务在新模型下**永远不会被执行**(调度器按 ws 查),
    // 而现象是「任务列表里有它,就是不跑」—— 必须现在就吼出来
    throw new Error(
      `[x-schema 1.1.9] 仍有 ${remaining} 个任务没有 ws 归属 —— `
      + '新模型下它们永远不会被执行(调度器按 ws 查任务)。请检查 UPDATE 是否生效。',
    );
  }
  console.log('[x-schema 1.1.9] 任务归属:未指定的已归入 ws-2');

  await db.query(
    `UPSERT $rid SET version = '1.1.9', appliedAt = $now,
      description = 'Tasks belong to a ws (unassigned default to ws-2)'`,
    { rid: new RecordId('schema_version', '1.1.9'), now: Date.now() },
  );
}

/**
 * 1.2.0 —— ⭐ 删掉死表 `tweet_inbox`(2026-09-14)
 *
 * ── 为什么现在能删 ──
 *
 * 实测(活库):`tweet_inbox` **28 行**,最新一条停在 **2026-09-01**(两周前);
 * 同期 `x_tweet` 有 11900+ 行且持续在写。全仓所有读写(upsertTweet /
 * queryInbox / queryPending / updateVerdict …)**早就走 x_tweet**,
 * repo 文件名叫 `tweet-inbox-repo.ts` 只是历史包袱。
 *
 * ⚠️ 它造成过两个真 bug(都在本次一并修掉):
 *  · **Bug 1**:判断失败回退 `UPDATE tweet_inbox SET status='pending'` 打在空表上
 *    → 推文卡死在 `ai_judging`,**要等下次重启**靠 recoverStuckAiJudging 才捞回来
 *    (今天启动日志「自愈:41 条」就是现场)
 *  · **Bug 2**:配方采纳率 `FROM tweet_inbox` 查空表 → 统计**恒为 0 且不报错**
 *
 * ⭐ 记忆 `project-x-tweet-inbox-is-dead-table` 记的就是这张表:
 * 「名字骗人,写进去不报错且永远读不到,现象是『功能点了没反应』」。
 * **删掉它,这个家族的 bug 就不可能再出现。**
 *
 * ⚠️ 那 28 行不迁:全是 2026-09-01 的采集残留,`x_tweet` 里有同期同源数据
 * (去重键 tweet_id 相同),且用户 2026-09-01 已定「X 历史数据都可以重新爬取」。
 */
const X_SCHEMA_1_2_0 = `
REMOVE TABLE IF EXISTS tweet_inbox;
`;

export async function x_migration_1_2_0(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_2_0);
  console.log('[x-schema 1.2.0] 已删除死表 tweet_inbox');

  await db.query(
    `UPSERT $rid SET version = '1.2.0', appliedAt = $now,
      description = 'Drop dead table tweet_inbox (all reads/writes long since on x_tweet)'`,
    { rid: new RecordId('schema_version', '1.2.0'), now: Date.now() },
  );
}

/**
 * 1.2.1 —— ⭐⭐ 发布闸门(2026-09-15,用户拍板)
 *
 * > 「是否关闭由我来定,不是机器来定,设计好开关就好了。」
 * > 「红线是我来定,不是你来定,撤销它吧。」
 * > 「同样可以自动,开关由我定就行了。」
 *
 * ── 这张表的唯一职责:让「能不能程序点发布」成为**你的配置**,不是我的常量 ──
 *
 * 原先 `x-write.ts` 把「绝不 click」硬写在代码里。那是**我替你定了红线**。
 * 现在改成:闸门关(默认)→ 只定位按钮不点,与今天行为一字不差;
 *          闸门开 → 走 `web.input.tap`。开关只认你手动改。
 *
 * ── 三条不可协商的失效语义(全部回到「关」)──
 *
 * ① `enabled` **DEFAULT false,且代码里永不写 true** —— 只有你手动改。
 *    这不是谨慎,是防「某个分支顺手把它打开了」这类事故:
 *    全仓搜 `enabled = true` 应当**零命中**(守卫会钉死这条)。
 * ② `expires_at` 到期即失效 —— 忘了关也会自己关。长期开着必须是**反复的主动选择**。
 * ③ 超速率 / 连续失败 / 进程重启 —— 一律按关处理(判定在代码层,不改本表)。
 *
 * ── 为什么 scenario × lang 两个维度 ──
 *
 * 中文可能早就够了、英文还差得远(`getReadiness` 就是分语言算的),
 * 而「点赞」和「发带正文的回复」风险差一个数量级。合成一个开关
 * 会让**风险最高的那个**搭上风险最低的那个的便车。
 *
 * ⚠️ 外语那条另有记忆在案(`project-x-multilang-reply-risk`):
 * Gemma 写中文 0 编造,俄语/波斯语会加清单外承诺,而**人读不懂外语
 * = 人工确认这道闸本就失效**。所以非中英语种此表干脆不给行 —— 没有行 = 关。
 *
 * ── x_publish_log:限速记账 + ⭐ 自动样本的唯一来源 ──
 *
 * `getReadiness` 的唯一写入口是 IPC `X_REPLY_FEEDBACK`,由 renderer 在**人操作后**发。
 * 开了自动就没有人 → 没有新行 → `passRate` 冻结在拨开关那天,
 * 而且**永远好看**(封闭集合的均值)。虚高的通过率比没有更坏:它会被当成证据。
 * → 自动发布必须在这里自己留一行,`human_reviewed = false`,让两拨样本可分。
 */
const X_SCHEMA_1_2_1 = `
DEFINE TABLE IF NOT EXISTS x_publish_gate SCHEMAFULL;
-- 'reply' | 'like' | 'bookmark' | 'repost' —— 风险从高到低,不合成一个开关
DEFINE FIELD IF NOT EXISTS scenario    ON x_publish_gate TYPE string ASSERT $value != '';
-- 'zh' | 'en' —— 只开这两种;外语人工确认本就失效,不给行 = 关
DEFINE FIELD IF NOT EXISTS lang        ON x_publish_gate TYPE string ASSERT $value != '';
-- ⭐ 只认人手动改。代码里永不写 true(守卫钉死)
DEFINE FIELD IF NOT EXISTS enabled     ON x_publish_gate TYPE bool DEFAULT false;
-- 每小时上限;超了按关处理,不是排队等下一个钟头
DEFINE FIELD IF NOT EXISTS rate_per_hour ON x_publish_gate TYPE int DEFAULT 0;
-- 到期自动关 —— 忘了关也会自己关
DEFINE FIELD IF NOT EXISTS expires_at  ON x_publish_gate TYPE option<datetime>;
-- 最后一次改动的人读记录,便于回看「谁在什么时候开的」
DEFINE FIELD IF NOT EXISTS note        ON x_publish_gate TYPE option<string>;
DEFINE FIELD IF NOT EXISTS updated_at  ON x_publish_gate TYPE datetime;
DEFINE INDEX IF NOT EXISTS idx_gate_key ON x_publish_gate FIELDS scenario, lang UNIQUE;

DEFINE TABLE IF NOT EXISTS x_publish_log SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS scenario    ON x_publish_log TYPE string ASSERT $value != '';
DEFINE FIELD IF NOT EXISTS lang        ON x_publish_log TYPE string;
DEFINE FIELD IF NOT EXISTS tweet_id    ON x_publish_log TYPE string;
DEFINE FIELD IF NOT EXISTS text        ON x_publish_log TYPE string;
-- ⭐ 分辨「人读过」与「没人读」两拨样本的唯一依据
DEFINE FIELD IF NOT EXISTS human_reviewed ON x_publish_log TYPE bool DEFAULT true;
-- 'ok' | 'failed' —— 连续失败要能被限速器看见
DEFINE FIELD IF NOT EXISTS outcome     ON x_publish_log TYPE string;
DEFINE FIELD IF NOT EXISTS error       ON x_publish_log TYPE option<string>;
DEFINE FIELD IF NOT EXISTS ws_id       ON x_publish_log TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created_at  ON x_publish_log TYPE datetime;
DEFINE INDEX IF NOT EXISTS idx_plog_created  ON x_publish_log FIELDS created_at;
DEFINE INDEX IF NOT EXISTS idx_plog_scenario ON x_publish_log FIELDS scenario;
`;

export async function x_migration_1_2_1(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_2_1);

  /**
   * ⚠️ 不预建任何行 —— **没有行就是关**。
   *
   * 预建 `enabled = false` 的行看着更"完整",但它会让「你从没配过」
   * 和「你配过并关掉了」变得**一模一样**,而这两者在出事复盘时
   * 是完全不同的事实。要开的时候由 UI 建行,那一刻才有 `updated_at`。
   */

  // fail loud:表真的建起来了吗?(DDL 单条 parse error 会让整段被拒收,
  // 而现象是"启动没报错"——本文件头铁律 3 记的就是这个。)
  const info = await db.query<[{ tables?: Record<string, unknown> }]>('INFO FOR DB');
  const tables = info?.[0]?.tables ?? {};
  for (const t of ['x_publish_gate', 'x_publish_log']) {
    if (!(t in tables)) {
      throw new Error(
        `[x-schema 1.2.1] 建表失败:${t} 不在 INFO FOR DB 里 —— `
        + 'DDL 很可能被整段拒收(单条 parse error 会拖垮整段)。闸门表不存在时,'
        + '发布路径会读不到闸门 → 必须现在就吼出来,不能等到运行期。',
      );
    }
  }
  console.log('[x-schema 1.2.1] 发布闸门表已建(无预建行:没有行 = 关)');

  await db.query(
    `UPSERT $rid SET version = '1.2.1', appliedAt = $now,
      description = 'Publish gate (scenario x lang; enabled only ever set by the user)'`,
    { rid: new RecordId('schema_version', '1.2.1'), now: Date.now() },
  );
}

/**
 * 1.2.2 —— ⭐ `x_author.location`(2026-09-18)
 *
 * ── 为什么补这一列 ──
 *
 * 「采人」实测跑通(x.com/otun_myvpn/verified_followers,一次 **241 人**、
 * 223 人有 bio),而载荷里**自带 location**(`core.location.location` 新形态 /
 * `legacy.location` 旧形态)—— 解析器已经解出来了,却**没地方存**。
 *
 * ⚠️ 当时如实标注「采到了但没地方存」而**没有顺手加 migration** ——
 * 顺手改 schema 是另一件事(要版本、要回滚考虑),不该混在采集的改动里。
 * 用户 2026-09-18 明确说「添加吧」,才补这一刀。
 *
 * ── 这个字段值得存吗 ──
 *
 * 值得:判断「这人是不是目标用户」时,地区是**查证过的事实**,
 * 而不是模型看正文的猜测(记忆 project-x-reply-decision-trace 记着
 * 「posterKind 只是模型的猜测非查证事实」)。
 * ⚠️ 但它是**用户自填的自由文本**(可以写「宇宙」「在路上」),
 * 不是经过验证的地理位置 —— 用它做判断时要记得这一点。
 */
const X_SCHEMA_1_2_2 = `
DEFINE FIELD IF NOT EXISTS location ON x_author TYPE option<string>;
`;

export async function x_migration_1_2_2(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_2_2);

  // fail loud:字段真的加上了吗?(单条 DDL parse error 会让整段被拒收,
  // 而现象是「启动没报错」—— 本文件头铁律 3)
  const info = await db.query<[{ tables?: Record<string, unknown> }]>('INFO FOR TABLE x_author');
  const fields = (info?.[0] as { fields?: Record<string, unknown> } | undefined)?.fields ?? {};
  if (!('location' in fields)) {
    throw new Error(
      '[x-schema 1.2.2] location 字段没加上 —— 采到的地区数据会继续无处可存,'
      + '而解析器照样解它,表现为「采了但查不到」。',
    );
  }
  console.log('[x-schema 1.2.2] x_author.location 已添加');

  await db.query(
    `UPSERT $rid SET version = '1.2.2', appliedAt = $now,
      description = 'x_author.location (people harvest carries it, had nowhere to store)'`,
    { rid: new RecordId('schema_version', '1.2.2'), now: Date.now() },
  );
}

/**
 * 1.2.3 —— ⭐⭐ 采集顺序留痕(2026-09-18)
 *
 * ── 为什么需要(用户问全量/增量)──
 *
 * > 「第一次采集要全量,后面再次采集时补充没采的即可,对吗?
 * >   我不知道 x 上的这个列表是按照实现的先后排序的吗?」
 *
 * 增量策略(「遇到采过的就停」)**只在列表按时间倒序时成立** ——
 * 否则新关注的人可能出现在任何位置,不翻到底就不知道漏没漏。
 *
 * ⚠️ 而「X 按什么排序」**没人知道**,也不该猜。用户说得对:
 * 「这个肉眼看不出来的,你要他们的元数据呀。」
 *
 * ⭐ 所以存**采集顺序**:同一次采集里,这个人是第几个出现的。
 * 两次采集一对照就有答案 ——
 *  · 新增的人都排在前面 → 按时间倒序,增量可以「遇到采过的就停」
 *  · 新增的人散落各处   → 不是时间序,每次都得翻到底
 *
 * ⚠️ 载荷里**没有**「什么时候关注的」字段(那是关系元数据,不在 user 对象上),
 * 所以只能靠顺序间接推断 —— 这一点要说清楚,别把推断当事实。
 */
const X_SCHEMA_1_2_3 = `
-- 同一次采集里的序号(0 起)—— 列表顺序的唯一证据
DEFINE FIELD IF NOT EXISTS list_seq      ON x_author TYPE option<int>;
-- 这个序号是哪次采集、哪一页给的(不同页面的顺序不可比)
DEFINE FIELD IF NOT EXISTS list_source   ON x_author TYPE option<string>;
DEFINE FIELD IF NOT EXISTS list_seen_at  ON x_author TYPE option<datetime>;
DEFINE INDEX IF NOT EXISTS idx_author_list_seq ON x_author FIELDS list_source, list_seq;
`;

/**
 * ⭐⭐ **一个人可以同时在多个名单里** —— 用户 2026-09-18 实测暴露。
 *
 * 采完 verifiedFollowers 后,面板上 `x.followers` 从 308 人掉到 **28 人**。
 * 人没丢,是**被改判了**:`list_source` 是单值字段、无条件覆盖,
 * 同一个人再出现在别的名单里,前一个来源就没了。
 *
 * ⚠️ 这是**证据被覆盖**,不是数据丢失,但后果一样严重:
 * 「这个人在不在我的关注者里」这个问题,从此只能回答最后采的那次。
 * 而蓝V关注者本来就是关注者的子集 —— 重叠是常态不是例外。
 *
 * ⭐ `list_source`/`list_seq` 的语义**不改**(仍是「最近一次采集」,
 * 序号只在同一次采集内可比);新增 `list_memberships` **只累加不覆盖**,
 * 回答「他出现在过哪些名单」。两者各司其职,不互相解释。
 */
const X_SCHEMA_1_2_4 = `
-- 出现过的名单(累加,不覆盖)—— 一个人可以既是 followers 又是 verifiedFollowers
DEFINE FIELD IF NOT EXISTS list_memberships ON x_author TYPE option<array<string>>;
DEFINE FIELD IF NOT EXISTS list_memberships.* ON x_author TYPE string;
`;

export async function x_migration_1_2_4(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_2_4);

  const info = await db.query<[{ fields?: Record<string, unknown> }]>('INFO FOR TABLE x_author');
  if (!('list_memberships' in (info?.[0]?.fields ?? {}))) {
    throw new Error(
      '[x-schema 1.2.4] list_memberships 没加上 —— '
      + '同一个人在多个名单里的证据会继续被覆盖。',
    );
  }

  /**
   * ⭐ 存量补齐:已有的 list_source 至少先记进去一条,
   * 否则这个字段对老数据永远是空的,而空和「只在一个名单里」分不开。
   */
  await db.query(
    `UPDATE x_author SET list_memberships = [list_source]
     WHERE list_source != NONE AND list_memberships = NONE`,
  );
  console.log('[x-schema 1.2.4] list_memberships 已添加');

  await db.query(
    `UPSERT $rid SET version = '1.2.4', appliedAt = $now,
      description = 'x_author list_memberships (a person can be in several lists)'`,
    { rid: new RecordId('schema_version', '1.2.4'), now: Date.now() },
  );
}

/**
 * ⭐⭐ **列表快照** —— 每次采集留一份「谁在第几位」,用于两件事:
 *
 * ① **增量采集**:与上次快照求差集 → 新增了谁、谁取关了
 * ② **回答「X 的列表按什么排序」** —— 这个问题 2026-09-18 立项时就提出了,
 *    但 `x_author.list_seq` 是**覆盖写**(只留最近一次),
 *    没有两份快照就永远对照不出来。
 *
 * ⚠️ 与 `x_author.list_seq` 的分工:
 * · `x_author.list_seq` = 「此人**最近一次**排第几」(覆盖,查人用)
 * · 本表           = 「**某次采集**的完整名次表」(不覆盖,对照用)
 *
 * 数据模型总纲:这是**可重算的派生数据**(丢了重采即可),
 * 与 x_author(真源)分开存,清空不影响业务。
 */
const X_SCHEMA_1_2_5 = `
DEFINE TABLE IF NOT EXISTS x_list_snapshot SCHEMAFULL;
-- 哪个列表:'x.followers:OTun_MyVPN'
DEFINE FIELD IF NOT EXISTS scope    ON x_list_snapshot TYPE string ASSERT $value != '';
-- 这一次采集的批次标识(同一次采集的所有行共享)—— 用它分组对照
DEFINE FIELD IF NOT EXISTS run_id   ON x_list_snapshot TYPE string ASSERT $value != '';
-- 归一化 handle(与 x_author.handle 同规格,便于 join)
DEFINE FIELD IF NOT EXISTS handle   ON x_list_snapshot TYPE string ASSERT $value != '';
-- 在这一次采集里排第几(0 起)
DEFINE FIELD IF NOT EXISTS seq      ON x_list_snapshot TYPE int;
DEFINE FIELD IF NOT EXISTS taken_at ON x_list_snapshot TYPE datetime;
-- 同一批次里一个人只占一位
DEFINE INDEX IF NOT EXISTS idx_snap_unique ON x_list_snapshot FIELDS run_id, handle UNIQUE;
-- 按 scope 取最近几批 / 按批次取名次表
DEFINE INDEX IF NOT EXISTS idx_snap_scope  ON x_list_snapshot FIELDS scope, run_id;
`;

export async function x_migration_1_2_5(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_2_5);

  const info = await db.query<[{ fields?: Record<string, unknown> }]>('INFO FOR TABLE x_list_snapshot');
  const fields = info?.[0]?.fields ?? {};
  for (const f of ['scope', 'run_id', 'handle', 'seq']) {
    if (!(f in fields)) {
      throw new Error(
        `[x-schema 1.2.5] ${f} 没加上 —— 列表快照存不下来,`
        + '增量采集与「列表按什么排序」都无从谈起。',
      );
    }
  }
  console.log('[x-schema 1.2.5] 列表快照表已建');

  await db.query(
    `UPSERT $rid SET version = '1.2.5', appliedAt = $now,
      description = 'x_list_snapshot (per-run ordering snapshot for incremental + ordering evidence)'`,
    { rid: new RecordId('schema_version', '1.2.5'), now: Date.now() },
  );
}

/**
 * 1.2.6 —— metrics 的观测时刻(2026-09-22)
 *
 * 用户:「要完整的画像,当然要更新这些数据,我们有时候要从这些数据中寻找规律的。」
 * 并定下基准:「采集是基础,保证数据的完整性,是采集的基本任务。」
 *
 * ── 为什么光有 metrics 不够 ──
 * 实测 2000 条带 views 的推,**采集时距发推的时长**:
 *   最小 0 小时 · 中位 2.8 小时 · 最大 12633 小时(约 18 个月),31% 不足 1 小时。
 * 于是「发出 10 分钟拿到 500 阅读」和「发出半年拿到 500 阅读」
 * 在库里**长得一模一样** —— 要从数字里找规律,这两条根本不能放在一起比。
 *
 * ⭐ x_author 早就做对了(1.0.4 的 counts_at:「没有时刻的计数无法判断新鲜度」),
 * 而 x_tweet 的 metrics 一直没有对应的时刻字段。这里补上,口径一致。
 *
 * ⚠️ 为什么不复用 fetched_at:它是「最后一次碰这行」——
 * text 回灌、字段补全都会更新它,**不专指「这组数字是何时看到的」**。
 * 两者语义不同,合用会让「这组数字多新鲜」再次变成猜的。
 */
const X_SCHEMA_1_2_6 = `
-- metrics 这组数字的观测时刻。⚠️ 与 fetched_at 语义不同:
-- fetched_at = 最后一次碰这行;metrics_at = 这组计数是何时看到的。
DEFINE FIELD IF NOT EXISTS metrics_at ON x_tweet TYPE option<datetime>;
`;

export async function x_migration_1_2_6(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_2_6);
  await db.query(
    `UPSERT $rid SET version = '1.2.6', appliedAt = $now,
      description = 'x_tweet.metrics_at (observation time for metrics — counts without a timestamp are not comparable)'`,
    { rid: new RecordId('schema_version', '1.2.6'), now: Date.now() },
  );
}

/**
 * 1.2.7 —— 「这条是不是长文」(2026-09-22)
 *
 * ── 为什么非加不可 ──
 * 长文正文**只在单篇详情页**的载荷里(2026-09-22 同账号三入口实测:
 * TweetDetail 带正文,UserArticlesTweets / UserOriginalsTimeline 只给标题+摘要)。
 * 于是要「把缺正文的长文逐篇补回来」,第一步就是**找出哪些行是长文**——
 * 而 x_tweet 的 33 列里**没有任何一列**能回答这个问题。
 *
 * ⚠️ 解析器其实**早就算出来了**(HarvestedTweet.isArticle,
 * 判据是载荷里有没有 article_results 结构),只是从来没往下传:
 * 类型没声明 → toRecord 不写 → 库里没有。
 * ⭐ 与 conversation_id 那次(「schema 有、解析有、类型没有」)是**同一形态**,
 * 只是这次缺的是另一头:**解析有、其余三处都没有**。
 *
 * ── 为什么不用长度当判据 ──
 * 实测库里 10056 行,超过 2000 字的只有 3 行。
 * 一篇**正文被摘要顶掉**的长文只有 267 字,和普通推**长得一模一样** ——
 * 长度分不出「短推」和「被截断的长文」,而这恰恰是要找的那一类。
 *
 * ⚠️ 不复用 `backfilled`:那个字段已有语义(存量回填 ≠ 实时采集,637 行在用),
 * 借来表示别的意思会让两边都读不准。
 *
 * ⭐ 存量老行标不上(采的时候没这个字段),只能随后续采集慢慢涨 ——
 * 这与立项定位一致:**不是回填老数据,而是下次采长文时顺手把正文取全。**
 */
const X_SCHEMA_1_2_7 = `
-- 载荷里带 article 结构 = 这是一篇长文(Article)。
-- ⚠️ 与「拿到正文了没有」是两回事:列表页给的长文同样 is_article=true,
--    但正文只有标题+摘要 —— 正是这一类需要逐篇进详情页补全。
DEFINE FIELD IF NOT EXISTS is_article ON x_tweet TYPE option<bool>;
DEFINE INDEX IF NOT EXISTS idx_tweet_is_article ON x_tweet FIELDS is_article;
`;

/**
 * 1.2.8 —— 拟出来的回复草稿落库(2026-09-24)
 *
 * ── 用户拍板 ──
 * > 「落库,这是未来AI学习和优化的环节吧?」
 *
 * ⭐ 对:草稿 + 人改成什么 + 发没发 = **「AI 写的 vs 人要的」差集**,
 *   那才是训练信号。不落库就没有这个差集。
 *
 * ── 为什么非建这张表不可(2026-09-24 编排实跑查实)──
 *
 * 编排报「拟出 6 条草稿」,而库里**一条都查不到**:
 *  · `planReplies` 只**返回**草稿,全仓没有任何地方写进库
 *  · `reply_draft` 字段定义在 **tweet_inbox**(已知死表),
 *    `x_tweet` 上**根本没有** —— 实测往 x_tweet 写它直接报
 *    `Found field 'reply_draft', but no such field exists`,**整条 upsert 失败**
 *  · UI 那条路径把草稿放在 `useState` 里,关掉就没
 * ⭐ 手点「✎拟回复」时人当场看得见,所以这个洞一直没暴露;
 *   编排跑完没人看 → 草稿直接蒸发。
 *
 * ── 与 `x_reply_feedback` 的分工(⚠️ 别混)──
 *
 * | | 这张表 | x_reply_feedback |
 * |---|---|---|
 * | 记什么 | **AI 产出了什么**(流水) | **人最终怎么表态**(结论) |
 * | 何时写 | 拟出来就写 | 人点了「填进X/忽略」才写 |
 * | 有没有人参与 | 没有也照样有行 | 必须有人 |
 *
 * ⚠️ 不复用 x_reply_feedback 加个 pending 态:那张表现有 425 行的语义是
 * 「人的反馈」,混进未表态的行会让旧统计口径(采纳率/edited 率)静默变化。
 *
 * ── 状态流转 ──
 * `pending`(刚拟出) → `filled`(人填进X) / `dismissed`(人否决) / `expired`(没处理)
 * ⚠️ 状态**只增不改语义**:人表态时更新本行 + 照旧写 x_reply_feedback,
 *   两张表**各记各的**,不互相替代。
 */
const X_SCHEMA_1_2_8 = `
DEFINE TABLE IF NOT EXISTS x_reply_draft SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS tweet_id    ON x_reply_draft TYPE string ASSERT $value != '';
-- 拟稿当时的推文正文快照 —— ⚠️ 不 join x_tweet:那边有 TTL,过期后回看就没上下文了
DEFINE FIELD IF NOT EXISTS tweet_text  ON x_reply_draft TYPE string;
DEFINE FIELD IF NOT EXISTS author_handle ON x_reply_draft TYPE option<string>;
DEFINE FIELD IF NOT EXISTS lang        ON x_reply_draft TYPE string;   -- zh | en
-- AI 写的正文(回落模板时是模板正文)
DEFINE FIELD IF NOT EXISTS ai_text     ON x_reply_draft TYPE string;
DEFINE FIELD IF NOT EXISTS source      ON x_reply_draft TYPE string;   -- generated | template
DEFINE FIELD IF NOT EXISTS confidence  ON x_reply_draft TYPE option<float>;
-- ⭐ 推断链留档 —— 「为什么这么写」,回归分析要用
DEFINE FIELD IF NOT EXISTS poster_kind ON x_reply_draft TYPE option<string>;
DEFINE FIELD IF NOT EXISTS poster_read ON x_reply_draft TYPE option<string>;
DEFINE FIELD IF NOT EXISTS trigger     ON x_reply_draft TYPE option<string>;
DEFINE FIELD IF NOT EXISTS ai_reason   ON x_reply_draft TYPE option<string>;
DEFINE FIELD IF NOT EXISTS in_thread   ON x_reply_draft TYPE option<bool>;
-- pending | filled | dismissed | expired
DEFINE FIELD IF NOT EXISTS status      ON x_reply_draft TYPE string DEFAULT 'pending';
-- ⭐ 哪次编排拟的 —— 没有它就说不清「这批草稿是哪一跑的产物」
DEFINE FIELD IF NOT EXISTS run_id      ON x_reply_draft TYPE option<string>;
DEFINE FIELD IF NOT EXISTS ref         ON x_reply_draft TYPE option<string>;
DEFINE FIELD IF NOT EXISTS ws_id       ON x_reply_draft TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created_at  ON x_reply_draft TYPE datetime;
DEFINE FIELD IF NOT EXISTS resolved_at ON x_reply_draft TYPE option<datetime>;
-- ⚠️ 同一条推可能被多次拟稿(重跑/改配方),所以**不做 tweet_id 唯一索引**
DEFINE INDEX IF NOT EXISTS idx_rdft_tweet   ON x_reply_draft FIELDS tweet_id;
DEFINE INDEX IF NOT EXISTS idx_rdft_status  ON x_reply_draft FIELDS status;
DEFINE INDEX IF NOT EXISTS idx_rdft_run     ON x_reply_draft FIELDS run_id;
DEFINE INDEX IF NOT EXISTS idx_rdft_created ON x_reply_draft FIELDS created_at;
`;

/**
 * 1.2.9 —— 否决原因(2026-09-24)
 *
 * ── 用户拍板「新的学习方法」的第一层 ──
 * > 「我是第一次接触学习,你的建议是什么请给出理由」→ 选了「① 否决时问原因」
 *
 * ── 为什么先做这一层(实测数据支撑)──
 *
 * `x_reply_feedback` 425 行里:
 *  · `action='filled'` **424** 条,`dismissed` **1** 条
 *  · `edited` **425/425 全是 false** —— 人一字没改
 *
 * ⭐ 也就是说现在的学习信号只有「采用/否决」两态,而且**几乎全是采用** ——
 *   模型只知道「这些被接受了」,**学不到「哪里不好」**。
 *
 * ⭐⭐ 正因为否决只占 1/425,**每一条否决都金贵**;
 *   而问一句「为什么不用」的成本,一年也就几十次 —— 收益/成本比最高。
 *
 * ⚠️ **只在否决时问**:采用是常态(424/425),弹窗会打断人的正常节奏。
 *
 * ── 取值 ──
 * off_topic(答非所问) / too_salesy(太硬广) / wrong_tone(语气不对)
 * / factual_error(事实错误) / should_not_reply(不该回这条) / other
 * ⚠️ 用**枚举不用自由文本**:自由文本统计不了,而这层的目的正是「统计出规律」。
 *   `other` 配一个可选的自由说明,兜住枚举没覆盖的。
 */
const X_SCHEMA_1_2_9 = `
-- 否决原因 —— ⚠️ 只有 action='dismissed' 时才有值
DEFINE FIELD IF NOT EXISTS dismiss_reason ON x_reply_feedback TYPE option<string>;
-- other 时的自由说明(枚举没覆盖的情况)
DEFINE FIELD IF NOT EXISTS dismiss_note   ON x_reply_feedback TYPE option<string>;
DEFINE INDEX IF NOT EXISTS idx_rfb_dismiss ON x_reply_feedback FIELDS dismiss_reason;
`;

/**
 * 1.2.10 —— 产品事实清单可编辑(2026-09-26)
 *
 * ── 用户拍板 ──
 * > 「这个需要增加，而且产品描述给好格式，我要及时更新的。」
 *
 * ⚠️ 事实清单原来写死在 `src/shared/types/x-reply-facts.ts` 的 `PRODUCT_FACTS` 里,
 * 改一次要**重新编译打包** —— 产品调整了(试用 7 天改 14 天之类)用户自己改不了。
 *
 * ⭐ 落库 + 应用内面板编辑,改完当场生效。
 *
 * ⚠️⚠️ **单行表**(`x_product_facts:current`):这是**一份**对外口径,
 * 不是每个 ws 一份 —— 产品事实与 workspace 无关(同 `x_author` 不带 ws_id 的道理)。
 *
 * ⭐ 带 `updated_at`:改过什么、什么时候改的要查得到。
 * ⚠️ 代码里的 `PRODUCT_FACTS` **保留为默认值**:库里没有行时回落到它,
 * 这样新装的 app 开箱就有一份能用的口径,而不是空清单
 * (空清单会让模型**无约束自由发挥** —— 比写死还危险)。
 */
const X_SCHEMA_1_2_10 = `
DEFINE TABLE IF NOT EXISTS x_product_facts SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS product_name    ON x_product_facts TYPE string;
-- 服务方向 —— ⚠️ 双向,别只写一边(2026-09-07 用户订正过一次)
DEFINE FIELD IF NOT EXISTS direction       ON x_product_facts TYPE string;
DEFINE FIELD IF NOT EXISTS trial           ON x_product_facts TYPE string;
DEFINE FIELD IF NOT EXISTS platforms       ON x_product_facts TYPE string;
DEFINE FIELD IF NOT EXISTS account_sharing ON x_product_facts TYPE string;
DEFINE FIELD IF NOT EXISTS payment_note    ON x_product_facts TYPE string;
-- 禁止提及 —— 显式列出比「不要瞎说」有效得多(实测)
DEFINE FIELD IF NOT EXISTS forbidden       ON x_product_facts TYPE array<string>;
DEFINE FIELD IF NOT EXISTS updated_at      ON x_product_facts TYPE datetime;
`;

/**
 * 1.2.11 —— 学习环节的地基:语境快照 + 建议原文 + 人改了什么(2026-09-26)
 *
 * ── 用户拍板 ──
 * > 「用户确定并发送，数据记录并进入学习环节」
 * > 「记录下来的目的是未来人工点评和优化。」
 * > 「后期用户可以对已经发送的数据继续点评纠正，这样迭代工作。」
 *
 * ── ⚠️ 为什么非有不可 ──
 *
 * 只存「人最终发了什么」**教不了任何人**:模型学不到
 * 「在这种语境下该这么答」,只能学到「照抄这句话」。
 * ⭐ 真正的训练信号是**差集**:AI 当时看到什么 → 写了什么 → 人改成什么。
 * 缺任何一环,这条记录的价值就掉一大截。
 *
 * ⚠️ 本仓已经踩过同形的坑(`project-x-reply-decision-trace`):
 * 推断链记了,但回头做回归分析时发现**依据不足**。
 *
 * ── 字段 ──
 * · `context_snapshot` —— ⭐⭐ 拟稿当时看到的 bio + 上文。
 *   ⚠️ **必须快照不能 join**:`x_tweet` 有 TTL,过期后回看就没有语境了。
 * · `advice_raw`       —— Claude 给的建议原文(人改之前的)
 * · `user_edit_diff`   —— ⭐ 人改了什么。**diff 本身就是最强学习信号**,
 *   不用人额外打字说明。
 * · `review_note`      —— 可选的「为什么这么改」
 * · `reviewed_at`      —— ⚠️ **可多次更新**:已发送的仍可回头改点评
 *   (用户明确要求「后期可以对已经发送的数据继续点评纠正」)。
 *   ⭐ 所以学习不是「攒够就毕业」,是一直开着的。
 *
 * ⚠️ 全部 `option<>`:9 条存量草稿没有这些值,不能让它们变成非法行。
 */
const X_SCHEMA_1_2_11 = `
-- ⭐⭐ 拟稿当时的全部语境 —— 快照,不 join(x_tweet 有 TTL)
DEFINE FIELD IF NOT EXISTS context_snapshot ON x_reply_draft TYPE option<object> FLEXIBLE;
-- Claude/模型给的建议原文(人改之前)
DEFINE FIELD IF NOT EXISTS advice_raw       ON x_reply_draft TYPE option<string>;
-- ⭐ 人把它改成了什么 —— 最强学习信号,不用人额外打字
DEFINE FIELD IF NOT EXISTS user_edit_diff   ON x_reply_draft TYPE option<string>;
-- 可选的「为什么这么改」
DEFINE FIELD IF NOT EXISTS review_note      ON x_reply_draft TYPE option<string>;
-- ⚠️ 可多次更新:已发送的仍可回头改点评
DEFINE FIELD IF NOT EXISTS reviewed_at      ON x_reply_draft TYPE option<datetime>;
-- 人点评过几次 —— 「改过几轮」本身是信号
DEFINE FIELD IF NOT EXISTS review_count     ON x_reply_draft TYPE option<int>;
DEFINE INDEX IF NOT EXISTS idx_draft_reviewed ON x_reply_draft FIELDS reviewed_at;
`;

export async function x_migration_1_2_11(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_2_11);
  await db.query(
    `UPSERT $rid SET version = '1.2.11', appliedAt = $now,
      description = 'x_reply_draft context/advice/diff (the learning signal: what AI saw, wrote, and how the human changed it)'`,
    { rid: new RecordId('schema_version', '1.2.11'), now: Date.now() },
  );
}

export async function x_migration_1_2_10(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_2_10);
  await db.query(
    `UPSERT $rid SET version = '1.2.10', appliedAt = $now,
      description = 'x_product_facts (editable product facts — the only source models may cite)'`,
    { rid: new RecordId('schema_version', '1.2.10'), now: Date.now() },
  );
}

export async function x_migration_1_2_9(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_2_9);
  await db.query(
    `UPSERT $rid SET version = '1.2.9', appliedAt = $now,
      description = 'x_reply_feedback.dismiss_reason (why the human rejected — the scarce signal)'`,
    { rid: new RecordId('schema_version', '1.2.9'), now: Date.now() },
  );
}

export async function x_migration_1_2_8(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_2_8);
  await db.query(
    `UPSERT $rid SET version = '1.2.8', appliedAt = $now,
      description = 'x_reply_draft (AI drafts persisted — training signal for reply quality)'`,
    { rid: new RecordId('schema_version', '1.2.8'), now: Date.now() },
  );
}

export async function x_migration_1_2_7(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_2_7);
  await db.query(
    `UPSERT $rid SET version = '1.2.7', appliedAt = $now,
      description = 'x_tweet.is_article (long-form flag — article bodies live only on the detail page)'`,
    { rid: new RecordId('schema_version', '1.2.7'), now: Date.now() },
  );
}

export async function x_migration_1_2_3(db: Surreal): Promise<void> {
  await db.query(X_SCHEMA_1_2_3);

  const info = await db.query<[{ fields?: Record<string, unknown> }]>('INFO FOR TABLE x_author');
  const fields = info?.[0]?.fields ?? {};
  for (const f of ['list_seq', 'list_source', 'list_seen_at']) {
    if (!(f in fields)) {
      throw new Error(
        `[x-schema 1.2.3] ${f} 没加上 —— 采集顺序存不下来,`
        + '「列表按什么排序」这个问题就永远只能靠猜。',
      );
    }
  }
  console.log('[x-schema 1.2.3] 采集顺序字段已添加');

  await db.query(
    `UPSERT $rid SET version = '1.2.3', appliedAt = $now,
      description = 'x_author list_seq/list_source (evidence for list ordering)'`,
    { rid: new RecordId('schema_version', '1.2.3'), now: Date.now() },
  );
}
