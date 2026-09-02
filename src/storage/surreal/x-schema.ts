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
DEFINE INDEX IF NOT EXISTS idx_tweet_id        ON x_tweet FIELDS tweet_id UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_tweet_status    ON x_tweet FIELDS status;
DEFINE INDEX IF NOT EXISTS idx_tweet_expires   ON x_tweet FIELDS expires_at;
DEFINE INDEX IF NOT EXISTS idx_tweet_author    ON x_tweet FIELDS author_handle;
DEFINE INDEX IF NOT EXISTS idx_tweet_accepted  ON x_tweet FIELDS accepted;

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
