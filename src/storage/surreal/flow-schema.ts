import { RecordId, type Surreal } from 'surrealdb';

/**
 * 工作流库(`krig_flow`)schema —— 与笔记库 / X 库**物理隔离**的第三个 database。
 *
 * 设计依据:`docs/10-business-design/agent/Module5-01-workflow-model.md` §6
 * (库名 §6.2、表设计 §6.3、与 `x_event` 的边界 §6.4)
 *
 * ── 为什么独立成库(§6.1)──
 *
 * 执行记录是**审计数据**:只增不改、量大、可整批清理,与笔记本体、
 * 与 X 采集数据的生命周期完全不同。混进任何一个都会让那边的备份/清理策略变形。
 *
 * ── ⚠️ 建库那个坑(与 krig_x 同源,已踩过一次)──
 *
 * `connect({ database })` **不会**创建 database。冷启动时第一条 DEFINE TABLE
 * 会直接报 "The database 'krig_flow' does not exist",而**单条 DDL 失败会让
 * 整段被服务端拒收** → 一张表都建不出来,且现象是「app 照常启动、库却不存在」。
 * 2026-09-01 在 `krig_x` 上实测踩到(`x-schema.ts:34-40` 留有现场)。
 * 所以第一条**必须**是 DEFINE DATABASE。
 *
 * ── 三条 DDL 铁律(照抄 x-schema.ts 文件头,每条都是踩出来的)──
 * 1. **绝不 DEFINE FIELD id** —— id 是内建 record 标识,声明成 string 会让
 *    CREATE 后再 UPSERT 触发 readonly 校验失败 → 写入**静默失败**。
 * 2. **option<T> 写值传 undefined 不传 null** —— NONE ≠ NULL,`?? null` 就是 bug。
 * 3. **单条 parse error 整段被拒收** —— `option<array> FLEXIBLE` 是 parse error;
 *    `TYPE object FLEXIBLE` 语序不可颠倒。跑完必须 `INFO FOR TABLE` 核对,
 *    **不能以「启动没报错」当验证**。
 */

const FLOW_SCHEMA_1_0_0 = `
-- ⚠️ 必须第一条:connect({ database }) 不建库,缺这行则整段 DDL 全被拒收
DEFINE DATABASE IF NOT EXISTS krig_flow;

-- ═══════════════════════════════════════════════════════════════
-- ① flow_run —— 一次执行
-- ═══════════════════════════════════════════════════════════════
DEFINE TABLE IF NOT EXISTS flow_run SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS run_id       ON flow_run TYPE string ASSERT $value != '';
-- 跑的是哪条链。⚠️ 现在还没有 flow_template 表,先记名字;将来建了模板表再关联
DEFINE FIELD IF NOT EXISTS flow_name    ON flow_run TYPE string ASSERT $value != '';
-- ⭐ 谁让它跑的 —— 'human' | 'schedule' | 'chain'(上一步触发)
--    这是「追溯能力」的起点:没有它,记录里全是没有来历的孤儿
DEFINE FIELD IF NOT EXISTS trigger      ON flow_run TYPE string ASSERT $value != '';
-- 发起者的细节(人点的是哪个按钮 / 哪个定时任务 / 哪条上游 run_id)
DEFINE FIELD IF NOT EXISTS trigger_ref  ON flow_run TYPE option<string>;
-- ⭐ 这次执行是**为谁**跑的(handle / tweet_id)—— 「从推文反查判过没」靠它
DEFINE FIELD IF NOT EXISTS subject_kind ON flow_run TYPE option<string>;
DEFINE FIELD IF NOT EXISTS subject_ref  ON flow_run TYPE option<string>;
DEFINE FIELD IF NOT EXISTS ws_id        ON flow_run TYPE option<string>;
-- 'running' | 'ok' | 'degraded' | 'failed' —— running 是为了「跑一半崩了」也有记录
DEFINE FIELD IF NOT EXISTS status       ON flow_run TYPE string DEFAULT 'running';
DEFINE FIELD IF NOT EXISTS started_at   ON flow_run TYPE datetime;
DEFINE FIELD IF NOT EXISTS ended_at     ON flow_run TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS duration_ms  ON flow_run TYPE option<int>;
DEFINE FIELD IF NOT EXISTS error        ON flow_run TYPE option<string>;
DEFINE INDEX IF NOT EXISTS idx_run_id      ON flow_run FIELDS run_id UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_run_started ON flow_run FIELDS started_at;
DEFINE INDEX IF NOT EXISTS idx_run_subject ON flow_run FIELDS subject_ref;
DEFINE INDEX IF NOT EXISTS idx_run_flow    ON flow_run FIELDS flow_name;

-- ═══════════════════════════════════════════════════════════════
-- ② flow_step_run —— ⭐ 每步一行
-- ═══════════════════════════════════════════════════════════════
DEFINE TABLE IF NOT EXISTS flow_step_run SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS run_id      ON flow_step_run TYPE string ASSERT $value != '';
-- 第几步(从 1 起)—— 靠它排序,不靠 created_at(同毫秒会乱)
DEFINE FIELD IF NOT EXISTS seq         ON flow_step_run TYPE int;
DEFINE FIELD IF NOT EXISTS step_id     ON flow_step_run TYPE string ASSERT $value != '';
-- 能力分类:'fetch'(取数) | 'judge'(判决) | 'act'(动作) | 'write'(写回) | 'human'(人决)
DEFINE FIELD IF NOT EXISTS step_type   ON flow_step_run TYPE string;
-- 具体调用了哪个能力(goto / execute / inventory …)
DEFINE FIELD IF NOT EXISTS capability  ON flow_step_run TYPE option<string>;
DEFINE FIELD IF NOT EXISTS input       ON flow_step_run TYPE option<object> FLEXIBLE;
DEFINE FIELD IF NOT EXISTS output      ON flow_step_run TYPE option<object> FLEXIBLE;
/**
 * ⭐⭐ 三态 + 两种「没跑」:
 *   'ok' | 'degraded' | 'failed'  —— 跑了
 *   'skipped'                     —— 条件不满足,没跑
 *   'rejected'                    —— 被规则拒绝(如域名不在白名单)
 *
 * ⚠️ 设计 §6.3 明确:**必须记「被跳过 / 被拒绝」的步骤**,不只记成功的。
 * 只记成功的话,「为什么没发生」永远查不出来 —— 而那恰恰是最常问的问题。
 */
DEFINE FIELD IF NOT EXISTS status      ON flow_step_run TYPE string;
-- degraded 时缺了什么(卷宗附件没取到的名单)
DEFINE FIELD IF NOT EXISTS missing     ON flow_step_run TYPE option<array<string>>;
-- ⭐ 为什么:失败原因 / 跳过原因 / 拒绝原因 —— 三种都往这里写
DEFINE FIELD IF NOT EXISTS reasoning   ON flow_step_run TYPE option<string>;
-- 这一步是为谁跑的(可与 run 的 subject 不同:一条 run 可能逐个处理多个对象)
DEFINE FIELD IF NOT EXISTS subject_ref ON flow_step_run TYPE option<string>;
DEFINE FIELD IF NOT EXISTS duration_ms ON flow_step_run TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS created_at  ON flow_step_run TYPE datetime;
DEFINE INDEX IF NOT EXISTS idx_step_run     ON flow_step_run FIELDS run_id;
DEFINE INDEX IF NOT EXISTS idx_step_subject ON flow_step_run FIELDS subject_ref;
DEFINE INDEX IF NOT EXISTS idx_step_cap     ON flow_step_run FIELDS capability;
DEFINE INDEX IF NOT EXISTS idx_step_created ON flow_step_run FIELDS created_at;
`;

export async function flow_migration_1_0_0(db: Surreal): Promise<void> {
  await db.query(FLOW_SCHEMA_1_0_0);

  /**
   * fail loud:表真的建起来了吗?
   *
   * ⚠️ 单条 DDL parse error 会让**整段**被拒收,而现象是「启动没报错」——
   * 文件头铁律 3 记的就是这个。这里主动问一次库。
   * ⚠️ SDK 的 query() 已拆掉 result 外壳,所以是 `info[0].tables`
   * (实测口径,见记忆 project-surreal-sdk-vs-http-shape:
   *  HTTP /sql 才有 result 外壳,拿 curl 的形状写 SDK 代码会写反)。
   */
  const info = await db.query<[{ tables?: Record<string, unknown> }]>('INFO FOR DB');
  const tables = info?.[0]?.tables ?? {};
  for (const t of ['flow_run', 'flow_step_run']) {
    if (!(t in tables)) {
      throw new Error(
        `[flow-schema 1.0.0] 建表失败:${t} 不在 INFO FOR DB 里 —— `
        + 'DDL 很可能被整段拒收。没有执行记录表,所有调用都会变成无来历的孤儿,'
        + '「谁让它跑的」事后补不回来 —— 必须现在就吼出来。',
      );
    }
  }
  console.log('[flow-schema 1.0.0] 执行记录表已建(flow_run / flow_step_run)');

  await db.query(
    `UPSERT $rid SET version = '1.0.0', appliedAt = $now,
      description = 'Flow execution records (run + step, with caller provenance)'`,
    { rid: new RecordId('schema_version', '1.0.0'), now: Date.now() },
  );
}
