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
