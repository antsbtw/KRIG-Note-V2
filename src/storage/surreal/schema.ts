import { RecordId, type Surreal } from 'surrealdb';
import { surrealStorage } from './storage';

/**
 * V2 SurrealDB schema 初始化
 * 详 docs/90-archive/refactor-v2/data-model/persistence/surreal-schema.md §2-§3
 *
 * 三张表:
 * - atom            语义层 atom (含 id / createdAt / updatedAt / createdBy / payload)
 * - edge            语义层 edge (含 predicate / subject / object / attrs)
 * - schema_version  迁移版本记录
 *
 * 幂等性:
 * - 所有 DEFINE TABLE / FIELD / INDEX 用 IF NOT EXISTS。
 *   SurrealDB binary 3.0.4 默认 DEFINE 在已存在时报 AlreadyExistsError,
 *   IF NOT EXISTS 让二次执行静默返回 NONE。
 *
 * 注: 本 sub-phase 不实施 EVENT 触发器 (cascade delete), 留到 sub-phase 2 业务接入时
 *     验证 EM6 后实施 (按 surreal-schema.md §4.2)。
 */
const SCHEMA_VERSION_1_0_0 = `
-- atom 表
DEFINE TABLE IF NOT EXISTS atom SCHEMAFULL;
-- 注:绝不 DEFINE FIELD id —— id 是 SurrealDB 内建 record 标识,不是普通字段。
-- 曾把它声明成 'TYPE string'(1.0.0),在 SurrealDB 3.x 下与内建 record id 语义冲突:
-- CREATE(record 型 id)后同事务内再 UPSERT 同一 id 回填(createNote 回填 docHash /
-- updateNote 保存)时,readonly 校验发现 id 从 record 被"改成" string → 抛
-- "Found changed value for field id ... readonly" → 事务回滚 → 新建/保存笔记静默失败。
-- 修正:base schema 不再声明,存量库由 migration 1.8.6 REMOVE FIELD 收口(见 runner)。
DEFINE FIELD IF NOT EXISTS createdAt ON atom TYPE number ASSERT $value > 0;
DEFINE FIELD IF NOT EXISTS updatedAt ON atom TYPE number ASSERT $value >= createdAt;
DEFINE FIELD IF NOT EXISTS createdBy ON atom TYPE string ASSERT $value != "";
DEFINE FIELD IF NOT EXISTS payload ON atom TYPE object ASSERT $value != NONE;
DEFINE FIELD IF NOT EXISTS payload.domain ON atom TYPE string
  ASSERT string::matches($value, '^[a-z][a-z0-9-]*$');
DEFINE FIELD IF NOT EXISTS payload.payload ON atom TYPE any;

-- atom 索引
DEFINE INDEX IF NOT EXISTS atom_domain ON atom FIELDS payload.domain;
DEFINE INDEX IF NOT EXISTS atom_createdBy ON atom FIELDS createdBy;
DEFINE INDEX IF NOT EXISTS atom_createdAt ON atom FIELDS createdAt;
DEFINE INDEX IF NOT EXISTS atom_updatedAt ON atom FIELDS updatedAt;

-- edge 表
DEFINE TABLE IF NOT EXISTS edge SCHEMAFULL;
-- 同 atom:不声明 id 字段(内建 record 标识),避免 3.x readonly 冲突。migration 1.8.6 清存量。
DEFINE FIELD IF NOT EXISTS createdAt ON edge TYPE number ASSERT $value > 0;
DEFINE FIELD IF NOT EXISTS updatedAt ON edge TYPE number ASSERT $value >= createdAt;
DEFINE FIELD IF NOT EXISTS predicate ON edge TYPE string
  ASSERT string::matches($value, '^(user|ai|sys):([a-z][a-zA-Z0-9-]*:)?[a-z][a-zA-Z0-9]*$');
DEFINE FIELD IF NOT EXISTS subject ON edge TYPE object;
DEFINE FIELD IF NOT EXISTS subject.kind ON edge TYPE string ASSERT $value = 'atom';
DEFINE FIELD IF NOT EXISTS subject.atomId ON edge TYPE string;
DEFINE FIELD IF NOT EXISTS object ON edge TYPE object;
DEFINE FIELD IF NOT EXISTS object.kind ON edge TYPE string ASSERT $value INSIDE ['atom', 'literal'];
DEFINE FIELD IF NOT EXISTS object.atomId ON edge TYPE option<string>;
DEFINE FIELD IF NOT EXISTS object.type ON edge TYPE option<string>;
DEFINE FIELD IF NOT EXISTS object.value ON edge TYPE any;
DEFINE FIELD IF NOT EXISTS attrs ON edge TYPE object;
DEFINE FIELD IF NOT EXISTS attrs.createdBy ON edge TYPE string ASSERT $value != "";
DEFINE FIELD IF NOT EXISTS attrs.createdAt ON edge TYPE number;
DEFINE FIELD IF NOT EXISTS attrs.confidence ON edge TYPE option<number> ASSERT $value >= 0 AND $value <= 1;
DEFINE FIELD IF NOT EXISTS attrs.confirmedAt ON edge TYPE option<number>;
DEFINE FIELD IF NOT EXISTS attrs.confirmedBy ON edge TYPE option<string>;
DEFINE FIELD IF NOT EXISTS attrs.rejectedAt ON edge TYPE option<number>;
DEFINE FIELD IF NOT EXISTS attrs.rejectedBy ON edge TYPE option<string>;
DEFINE FIELD IF NOT EXISTS attrs.comment ON edge TYPE option<string>;

-- edge 索引
DEFINE INDEX IF NOT EXISTS edge_predicate ON edge FIELDS predicate;
DEFINE INDEX IF NOT EXISTS edge_subject ON edge FIELDS subject.atomId;
-- edge_object: 全索引,不带 partial WHERE 子句
-- SurrealDB binary 3.0.4 的 DEFINE INDEX 不支持 WHERE (partial index) 语法,
-- 实测 parse 报 "Unexpected token WHERE, expected Eof"。
-- 影响: object.kind='literal' 的边 atomId 为 NULL 也被索引,索引轻微膨胀,
-- 但不影响正确性 (查询时仍按 object.kind='atom' 过滤)。
DEFINE INDEX IF NOT EXISTS edge_object ON edge FIELDS object.atomId;
DEFINE INDEX IF NOT EXISTS edge_createdAt ON edge FIELDS createdAt;
DEFINE INDEX IF NOT EXISTS edge_createdBy ON edge FIELDS attrs.createdBy;
DEFINE INDEX IF NOT EXISTS edge_subject_predicate ON edge FIELDS subject.atomId, predicate;

-- schema_version 表
DEFINE TABLE IF NOT EXISTS schema_version SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS version ON schema_version TYPE string;
DEFINE FIELD IF NOT EXISTS appliedAt ON schema_version TYPE number;
DEFINE FIELD IF NOT EXISTS description ON schema_version TYPE string;
DEFINE INDEX IF NOT EXISTS schema_version_unique ON schema_version FIELDS version UNIQUE;
`;

/**
 * 1.3.0 schema — edge.attrs / atom.payload 改 FLEXIBLE,让 vocabulary 扩展字段合法。
 *
 * 设计文档(docs/90-archive/refactor-v2/data-model/persistence/surreal-schema.md §3.1 line 203)
 * 字面写 "vocabulary-specific 扩展字段不约束([key]: any)",但 1.0.0 实施漏了
 * FLEXIBLE 关键字 → SurrealDB SCHEMAFULL 默认拒绝未声明字段 →
 * thought capability 写 attrs.source / attrs.locator(user:krig:thoughtOf 边的
 * vocabulary 扩展)被 InternalError 'no such field' 拒绝。
 *
 * 同理 atom.payload.payload 改 FLEXIBLE,让各 domain payload 自由扩展(目前
 * payload.payload TYPE any 一刀切允许,但子字段类型校验也没用,改 FLEXIBLE 更明确)。
 *
 * FLEXIBLE 字面语义(SurrealDB 2.x+):预声明字段仍按规则校验,未声明子字段被
 * 允许存储,不报 'no such field' 错。这正是 spec.md §3.3 "vocabulary 可声明
 * 额外 attrs" 字面意图。
 */
const SCHEMA_VERSION_1_3_0 = `
DEFINE FIELD OVERWRITE attrs ON edge TYPE object FLEXIBLE;
DEFINE FIELD OVERWRITE payload ON atom TYPE object FLEXIBLE ASSERT $value != NONE;
`;

/**
 * 1.4.0 schema — intent 表(SP-3 数据层可靠性 intent-log 体系)。
 *
 * intent 是**运维元数据**(不是知识语义),独立表避免污染 atom/listAtoms/图谱查询
 * 与 backup 语义快照。承载"多步/分批写操作"的中断恢复:每批"数据写 + 游标推进"同一
 * 小事务,崩溃后 sweeper 按 cursor 续完/回滚(详 data-layer-reliability-design §3)。
 *
 * 字段:
 * - op:       操作类型('delete-note' | 'delete-folder' | 'delete-batch' | 'import-batch')
 * - targetId: 主目标 id(note id / folder root id;batch 可空,清单在 payload)
 * - status:   'pending' | 'done'(done 后即删行,留作幂等/调试窗口)
 * - cursor:   分批游标(FLEXIBLE:{ deleted, phase, lastOffset, ... } 按 op 不同)
 * - payload:  op 特定数据(FLEXIBLE,可选;batch 的 id 清单 / import 的批次清单)
 * status 索引让 sweeper 走索引扫 pending,O(pending 数) 而非全表。
 */
const SCHEMA_VERSION_1_4_0 = `
DEFINE TABLE IF NOT EXISTS intent SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS op ON intent TYPE string;
DEFINE FIELD IF NOT EXISTS targetId ON intent TYPE option<string>;
DEFINE FIELD IF NOT EXISTS status ON intent TYPE string;
DEFINE FIELD IF NOT EXISTS cursor ON intent TYPE object FLEXIBLE;
DEFINE FIELD IF NOT EXISTS payload ON intent TYPE option<object> FLEXIBLE;
DEFINE FIELD IF NOT EXISTS createdAt ON intent TYPE number;
DEFINE FIELD IF NOT EXISTS updatedAt ON intent TYPE number;
DEFINE INDEX IF NOT EXISTS intent_status ON intent FIELDS status;
`;

/**
 * 1.5.0 schema — Decision 028 Phase 0:block atom 结构属性 noteId 索引。
 *
 * 028 把文档结构(归属/层级/顺序)从边改成 block atom 的 payload.attrs 属性。
 * assemble 改为 `listAtoms({ domain:'pm', noteId })` 一次拉本笔记所有 block atom
 * (替代 belongsToNote 边查询)。该查询走 `payload.payload.attrs.noteId` 谓词,
 * 无索引则全 atom 表扫描(10 万+ block atom)→ 必须建索引。
 *
 * payload 已是 FLEXIBLE(1.3.0),attrs.noteId 是 vocabulary 扩展字段无需 DEFINE FIELD;
 * 直接对嵌套路径建索引(SurrealDB 支持嵌套字段索引)。
 */
const SCHEMA_VERSION_1_5_0 = `
DEFINE INDEX IF NOT EXISTS atom_note_id ON atom FIELDS payload.payload.attrs.noteId;
`;

/**
 * 1.1.0 schema (decision 014 §3.7) — 加 atom.hasBeenReferenced 单向 flag。
 *
 * 用于 decision 013 §3.5.1 单向 flag 模型:
 * - DEFAULT false,创建 pm atom 时显式 false
 * - 当某 pm atom 被第 2+ 条 hasContent 边引用时,update 为 true (永不复位)
 * - 本 sub-phase (3a-1) 单引用约束下永远不触发置 true,字段先落地占位
 *
 * 字段适用所有 atom (不仅 pm),但目前只有 pm 会被多引用,
 * 其他 domain 此字段恒 false (兜底正确)。
 */
const SCHEMA_VERSION_1_1_0 = `
DEFINE FIELD IF NOT EXISTS hasBeenReferenced ON atom TYPE bool DEFAULT false;
`;

export async function initSchema(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_0_0);

  // UPSERT 避免冷启动重复 CREATE 触发 UNIQUE 冲突;
  // 同时让 description / appliedAt 在每次启动刷新到当前值是 OK 的(数据没业务语义,只是审计追踪)。
  // record id 用 RecordId 绑定 (字面量 schema_version:'1.0.0' 在 SurrealQL 解析点号会被当作浮点而非标识符)。
  await db.query(
    `UPSERT $rid SET
      version = '1.0.0',
      appliedAt = $now,
      description = 'Initial schema (Phase N sub-phase 1)'`,
    { rid: new RecordId('schema_version', '1.0.0'), now: Date.now() },
  );
}

/**
 * 1.1.0 migration up — 加 atom.hasBeenReferenced field (decision 014 §3.7)。
 *
 * 幂等:DEFINE FIELD IF NOT EXISTS,重复执行无副作用。
 */
export async function migration_1_1_0(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_1_0);

  await db.query(
    `UPSERT $rid SET
      version = '1.1.0',
      appliedAt = $now,
      description = 'Add atom.hasBeenReferenced field (Phase N sub-phase 3a-1)'`,
    { rid: new RecordId('schema_version', '1.1.0'), now: Date.now() },
  );
}

/**
 * 1.2.0 migration up — 给 note 形态的 pm atom 加 user:krig:hasNoteView 边
 * (decision 016 §3.6 / sub-phase 3a-2.5)。
 *
 * 判据:pm atom 满足 (1) 未被任何 hasContent 边引用 (object) + (2) 未已有
 * hasNoteView 边 (subject) 时加边。
 *
 * (1) = "不是 graph text-node 的内容 ref 目标" 字面等价于 "noteCapability
 * 创建的 pm atom"(决议 §3.6 阶段性启发式,基于本 sub-phase 时刻 3 个 pm
 * atom 产生点的事实)。
 * (2) 是幂等保护 — 重启重跑后 added=0。
 *
 * 复用 surrealStorage facade 而非手写 SurrealQL,避免与 storage 层查/插边
 * 实施重复;facade 内部 getDB() 懒解析,initSurrealDB() 已先于 runMigrations
 * 完成 (src/storage/index.ts:28-31),调用安全。
 */
/**
 * 1.3.0 migration up — edge.attrs / atom.payload 改 FLEXIBLE
 * (修补 1.0.0 设计文档与 schema 实施分裂)。
 *
 * 幂等:DEFINE FIELD OVERWRITE 重复执行无副作用,SurrealDB 字面替换字段定义。
 * 不影响已有数据(只改 schema 约束,数据形态不变)。
 */
export async function migration_1_3_0(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_3_0);

  const now = Date.now();
  await db.query(
    `UPSERT $rid SET
      version = '1.3.0',
      appliedAt = $now,
      description = 'Make edge.attrs and atom.payload FLEXIBLE (vocabulary extension support)'`,
    { rid: new RecordId('schema_version', '1.3.0'), now },
  );
}

/**
 * 1.4.0 migration up — 建 intent 表(SP-3 数据层可靠性)。
 * 幂等:DEFINE ... IF NOT EXISTS 重复执行无副作用。
 */
export async function migration_1_4_0(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_4_0);

  const now = Date.now();
  await db.query(
    `UPSERT $rid SET
      version = '1.4.0',
      appliedAt = $now,
      description = 'Add intent table (data-layer reliability intent-log)'`,
    { rid: new RecordId('schema_version', '1.4.0'), now },
  );
}

/**
 * 1.5.0 migration up — 建 atom_note_id 索引(Decision 028 Phase 0)。
 * 幂等:DEFINE INDEX IF NOT EXISTS 重复执行无副作用。
 * 现有 atom 表 attrs.noteId 此时多为空(老数据无属性),索引仍合法建立;
 * Phase 0 起新写入的 block atom 带 noteId,即被索引。
 */
export async function migration_1_5_0(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_5_0);

  const now = Date.now();
  await db.query(
    `UPSERT $rid SET
      version = '1.5.0',
      appliedAt = $now,
      description = 'Add atom_note_id index (Decision 028 block structure attrs)'`,
    { rid: new RecordId('schema_version', '1.5.0'), now },
  );
}

/**
 * 1.6.0 migration up — graph text doc 边→属性内联 + 清孤儿 hasContent 边/pm atom
 * (L5-G6c 阶段 A,M2:文档本体零边/属性化;2026-06-22 总指挥拍板)。
 *
 * 背景:旧画板 text-node 的 doc 走 user:krig:hasContent 边 + 独立 pm atom 表达;
 * L5-G6c 改为内联 graph-instance payload.doc。本迁移把存量边/pm 一次性迁回内联,
 * 并清掉孤儿(否则成 cardinality-check 悬空对象 → 持续噪音,违反 R9)。
 *
 * 每条 subject 为 graph-instance atom 的 hasContent 边:
 *   ① 读 pm atom payload → 包成 DriverSerialized 信封写进 instance.payload.doc(若未内联)
 *   ② 删该 hasContent 边
 *   ③ 删孤儿 pm atom(单引用约束 decision 013:迁移后该 pm 不再被任何边引用)
 *
 * graph-scoped:只处理 subject 为 graph-instance 的 hasContent 边(note pm 走 hasNoteView,
 * 不在此列)。幂等:迁移后无 graph-instance 主体的 hasContent 边 → 重跑 added=0。
 * **不删 user:krig:hasContent predicate 本身**(R8:跨能力通用语义边,canonical 见 cardinality-check.ts)。
 */
export async function migration_1_6_0(db: Surreal): Promise<void> {
  const hasContentEdges = await surrealStorage.listEdges({
    predicate: 'user:krig:hasContent',
  });

  let inlined = 0;
  let edgesDeleted = 0;
  let pmDeleted = 0;
  for (const e of hasContentEdges) {
    if (e.subject.kind !== 'atom' || e.object.kind !== 'atom') continue;
    const inst = await surrealStorage.getAtom<'graph-instance'>(e.subject.atomId);
    // graph-scoped:只迁 graph-instance 主体(其余 hasContent 边非本刀范围,跳过)
    if (!inst || inst.payload.domain !== 'graph-instance') continue;

    const instPayload = inst.payload.payload;
    // ① 内联 doc(若尚未内联):读 pm atom payload 包 DriverSerialized 信封
    if (instPayload.doc === undefined) {
      const pmAtom = await surrealStorage.getAtom(e.object.atomId);
      if (pmAtom && pmAtom.payload.domain === 'pm') {
        await surrealStorage.putAtom<'graph-instance'>({
          id: inst.id,
          payload: {
            domain: 'graph-instance',
            payload: {
              ...instPayload,
              doc: {
                format: 'pm-doc-json',
                version: '0.1',
                payload: pmAtom.payload.payload,
              },
            },
          },
        });
        inlined++;
      }
    }
    // ② 删 hasContent 边
    await surrealStorage.deleteEdge(e.id);
    edgesDeleted++;
    // ③ 删孤儿 pm atom(单引用:迁移后不再被任何 hasContent 边引用)
    const pmId = e.object.atomId;
    const remaining = await surrealStorage.listEdges({
      predicate: 'user:krig:hasContent',
      objectAtomId: pmId,
    });
    if (remaining.length === 0) {
      await surrealStorage.deleteAtom(pmId);
      pmDeleted++;
    }
  }
  console.log(
    `[migration 1.6.0] graph doc 边→属性:inlined=${inlined}, hasContent 边删=${edgesDeleted}, 孤儿 pm 删=${pmDeleted}`,
  );

  const now = Date.now();
  await db.query(
    `UPSERT $rid SET
      version = '1.6.0',
      appliedAt = $now,
      description = 'Inline graph text doc into payload + drop orphan hasContent edges/pm atoms (L5-G6c A3/M2)'`,
    { rid: new RecordId('schema_version', '1.6.0'), now },
  );
}

export async function migration_1_2_0(_db: Surreal): Promise<void> {
  const pmAtoms = await surrealStorage.listAtoms({ domain: 'pm' });

  const hasContentEdges = await surrealStorage.listEdges({
    predicate: 'user:krig:hasContent',
  });
  const referencedPmAtomIds = new Set<string>();
  for (const e of hasContentEdges) {
    if (e.object.kind === 'atom') referencedPmAtomIds.add(e.object.atomId);
  }

  const existingHasNoteViewEdges = await surrealStorage.listEdges({
    predicate: 'user:krig:hasNoteView',
  });
  const alreadyHasNoteView = new Set<string>(
    existingHasNoteViewEdges.map((e) => e.subject.atomId),
  );

  let added = 0;
  const now = Date.now();
  for (const atom of pmAtoms) {
    if (referencedPmAtomIds.has(atom.id)) continue;
    if (alreadyHasNoteView.has(atom.id)) continue;
    await surrealStorage.putEdge({
      predicate: 'user:krig:hasNoteView',
      subject: { kind: 'atom', atomId: atom.id },
      object: { kind: 'literal', type: 'boolean', value: true },
      attrs: { createdBy: 'migration-1.2.0', createdAt: now },
    });
    added++;
  }
  console.log(`[migration 1.2.0] added ${added} hasNoteView edges`);

  await _db.query(
    `UPSERT $rid SET
      version = '1.2.0',
      appliedAt = $now,
      description = 'Add hasNoteView edges for note pm atoms (Phase N sub-phase 3a-2.5)'`,
    { rid: new RecordId('schema_version', '1.2.0'), now },
  );
}

/**
 * 1.7.0 schema — workspace 表（S3-b：楼长持久化迁 SurrealDB）
 *
 * workspace 是 Electron 运行态（workspace bar 状态），不是知识图谱语义层，
 * 独立表隔离，不污染 atom/edge 图谱查询。
 *
 * 一行 = 整个 WorkspaceManagerState（单记录快照模式，id 固定为 'current'）：
 * - workspaces: array of WorkspaceState（所有已知 ws）
 * - activeId: string | null
 * - counter: number（自增 id 种子）
 *
 * 选择单记录快照而非逐 ws 行：
 * - ws 数量极少（典型 1-5 个），无需索引查询
 * - 整体原子替换比逐行 upsert 简单，避免孤儿行
 * - 和 JSON 文件语义一比一对齐
 */
// workspace 是运行态快照，SCHEMALESS 避免 WorkspaceState 子字段逐一声明
const SCHEMA_VERSION_1_7_0 = `
DEFINE TABLE IF NOT EXISTS workspace SCHEMALESS;
`;

// 修复 1.7.0 建错了 SCHEMAFULL：用 OVERWRITE 改成 SCHEMALESS
const SCHEMA_VERSION_1_7_1 = `
DEFINE TABLE OVERWRITE workspace SCHEMALESS;
`;

export async function migration_1_7_0(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_7_0);

  const now = Date.now();
  await db.query(
    `UPSERT $rid SET
      version = '1.7.0',
      appliedAt = $now,
      description = 'Add workspace table (S3-b landlord persistence in SurrealDB)'`,
    { rid: new RecordId('schema_version', '1.7.0'), now },
  );
}

export async function migration_1_7_1(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_7_1);

  const now = Date.now();
  await db.query(
    `UPSERT $rid SET
      version = '1.7.1',
      appliedAt = $now,
      description = 'Fix workspace table: SCHEMAFULL -> SCHEMALESS (WorkspaceState subfields)'`,
    { rid: new RecordId('schema_version', '1.7.1'), now },
  );
}

// ── 1.8.0：X 时间线智能筛选（Phase 1）——————————————————————————————————————
// tweet_inbox：推文收件箱（采集 → 过滤 → AI 判断 → 回复追踪）
// search_recipes：搜索配方（关键词/账号/时间窗/互动阈值组合）
const SCHEMA_VERSION_1_8_0 = `
-- tweet_inbox
DEFINE TABLE IF NOT EXISTS tweet_inbox SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS tweet_id        ON tweet_inbox TYPE string;
DEFINE FIELD IF NOT EXISTS text            ON tweet_inbox TYPE string;
DEFINE FIELD IF NOT EXISTS author_name     ON tweet_inbox TYPE string;
DEFINE FIELD IF NOT EXISTS author_handle   ON tweet_inbox TYPE string;
DEFINE FIELD IF NOT EXISTS author_avatar   ON tweet_inbox TYPE option<string>;
DEFINE FIELD IF NOT EXISTS tweet_url       ON tweet_inbox TYPE option<string>;
DEFINE FIELD IF NOT EXISTS lang            ON tweet_inbox TYPE option<string>;
DEFINE FIELD IF NOT EXISTS metrics         ON tweet_inbox TYPE object;
DEFINE FIELD IF NOT EXISTS fetched_at      ON tweet_inbox TYPE datetime;
DEFINE FIELD IF NOT EXISTS expires_at      ON tweet_inbox TYPE datetime;
DEFINE FIELD IF NOT EXISTS source          ON tweet_inbox TYPE string;
DEFINE FIELD IF NOT EXISTS search_recipe   ON tweet_inbox TYPE option<string>;
DEFINE FIELD IF NOT EXISTS filter_score    ON tweet_inbox TYPE float;
DEFINE FIELD IF NOT EXISTS filter_reason   ON tweet_inbox TYPE option<string>;
DEFINE FIELD IF NOT EXISTS ai_verdict      ON tweet_inbox TYPE option<object>;
DEFINE FIELD IF NOT EXISTS status          ON tweet_inbox TYPE string;
DEFINE FIELD IF NOT EXISTS replied_at      ON tweet_inbox TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS reply_draft     ON tweet_inbox TYPE option<string>;
DEFINE INDEX IF NOT EXISTS idx_tweet_id    ON tweet_inbox FIELDS tweet_id UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_status      ON tweet_inbox FIELDS status;
DEFINE INDEX IF NOT EXISTS idx_expires     ON tweet_inbox FIELDS expires_at;

-- search_recipes
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
DEFINE INDEX IF NOT EXISTS idx_recipe_id     ON search_recipes FIELDS recipe_id UNIQUE;
`;

export async function migration_1_8_0(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_8_0);

  const now = Date.now();
  await db.query(
    `UPSERT $rid SET
      version = '1.8.0',
      appliedAt = $now,
      description = 'Add tweet_inbox + search_recipes tables (X timeline intelligence Phase 1)'`,
    { rid: new RecordId('schema_version', '1.8.0'), now },
  );
}

const SCHEMA_VERSION_1_8_1 = `
DEFINE FIELD IF NOT EXISTS ws_id ON tweet_inbox TYPE option<string>;
DEFINE FIELD IF NOT EXISTS ws_id ON search_recipes TYPE option<string>;
`;

export async function migration_1_8_1(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_8_1);
  const now = Date.now();
  await db.query(
    `UPSERT $rid SET version = '1.8.1', appliedAt = $now,
     description = 'Add ws_id field to tweet_inbox and search_recipes'`,
    { rid: new RecordId('schema_version', '1.8.1'), now },
  );
}

const SCHEMA_VERSION_1_8_2 = `
DEFINE FIELD OVERWRITE metrics    ON tweet_inbox TYPE object FLEXIBLE;
DEFINE FIELD OVERWRITE ai_verdict ON tweet_inbox TYPE option<object> FLEXIBLE;
`;

export async function migration_1_8_2(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_8_2);
  const now = Date.now();
  await db.query(
    `UPSERT $rid SET version = '1.8.2', appliedAt = $now,
     description = 'Make tweet_inbox metrics and ai_verdict FLEXIBLE to allow subfields'`,
    { rid: new RecordId('schema_version', '1.8.2'), now },
  );
}

const SCHEMA_VERSION_1_8_3 = `
DEFINE TABLE IF NOT EXISTS tweet_feedback SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS tweet_id       ON tweet_feedback TYPE string ASSERT $value != NONE;
DEFINE FIELD IF NOT EXISTS text           ON tweet_feedback TYPE string;
DEFINE FIELD IF NOT EXISTS lang           ON tweet_feedback TYPE option<string>;
DEFINE FIELD IF NOT EXISTS author_handle  ON tweet_feedback TYPE string;
DEFINE FIELD IF NOT EXISTS verdict        ON tweet_feedback TYPE string ASSERT $value INSIDE ['accept', 'reject'];
DEFINE FIELD IF NOT EXISTS reason_tag     ON tweet_feedback TYPE option<string>;
DEFINE FIELD IF NOT EXISTS source_recipe  ON tweet_feedback TYPE option<string>;
DEFINE FIELD IF NOT EXISTS created_at     ON tweet_feedback TYPE datetime;
DEFINE INDEX IF NOT EXISTS idx_fb_tweet_id ON tweet_feedback FIELDS tweet_id;
DEFINE INDEX IF NOT EXISTS idx_fb_verdict  ON tweet_feedback FIELDS verdict;
DEFINE INDEX IF NOT EXISTS idx_fb_lang     ON tweet_feedback FIELDS lang;
`;

export async function migration_1_8_3(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_8_3);
  const now = Date.now();
  await db.query(
    `UPSERT $rid SET version = '1.8.3', appliedAt = $now,
     description = 'Add tweet_feedback table for human verdict training data'`,
    { rid: new RecordId('schema_version', '1.8.3'), now },
  );
}

const SCHEMA_VERSION_1_8_4 = `
DEFINE FIELD IF NOT EXISTS translation ON tweet_inbox TYPE option<string>;
`;

export async function migration_1_8_4(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_8_4);
  const now = Date.now();
  await db.query(
    `UPSERT $rid SET version = '1.8.4', appliedAt = $now,
     description = 'Add translation field to tweet_inbox for non-Chinese tweets'`,
    { rid: new RecordId('schema_version', '1.8.4'), now },
  );
}

const SCHEMA_VERSION_1_8_5 = `
DEFINE FIELD IF NOT EXISTS task_id ON tweet_inbox TYPE option<string>;
DEFINE INDEX IF NOT EXISTS idx_task ON tweet_inbox FIELDS task_id;
`;

export async function migration_1_8_5(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_8_5);
  const now = Date.now();
  await db.query(
    `UPSERT $rid SET version = '1.8.5', appliedAt = $now,
     description = 'Add task_id dimension to tweet_inbox'`,
    { rid: new RecordId('schema_version', '1.8.5'), now },
  );
}

/**
 * 1.8.6 migration up — 删除 atom / edge 表的显式 `id` 字段声明(readonly 回归根治)。
 *
 * 背景:1.0.0 base schema 曾 `DEFINE FIELD id ON atom/edge TYPE string`,把 SurrealDB
 * 内建 record 标识当普通字段声明。SurrealDB 3.x(本机 binary 3.0.4)下这会导致:
 * CREATE 一条记录(id 为 record 型)后,同一事务内再 UPSERT 同一 id(createNote 回填
 * docVersion/docHash;updateNote 每次保存回写 container / modified block),readonly 校验
 * 发现 id 从 record "变成" string,抛
 *   `Found changed value for field id, with record atom:xxx, but field is readonly`
 * → 整个事务回滚 → **新建笔记 / 保存笔记静默失败**(用户侧「点新建完全没反应」)。
 *
 * 修正:`REMOVE FIELD id` 后,id 回归纯内建 record 标识,CREATE+UPSERT 同事务不再冲突。
 * 幂等 / 数据安全已离线验证(REMOVE FIELD 仅去约束,record id 与全部字段数据不变):
 *   - REMOVE FIELD IF EXISTS 重复执行无副作用;
 *   - 存量 atom/edge 的 id 与 payload 完整保留(SELECT * 仍返回 id)。
 * normalizeAtomEntity/normalizeEdgeEntity 从 row.id(内建标识)派生 id,不依赖此字段声明。
 */
const SCHEMA_VERSION_1_8_6 = `
REMOVE FIELD IF EXISTS id ON atom;
REMOVE FIELD IF EXISTS id ON edge;
`;

export async function migration_1_8_6(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_8_6);
  const now = Date.now();
  await db.query(
    `UPSERT $rid SET version = '1.8.6', appliedAt = $now,
     description = 'Drop explicit id field on atom/edge (SurrealDB 3.x record-id readonly conflict; fixes silent note create/save failure)'`,
    { rid: new RecordId('schema_version', '1.8.6'), now },
  );
}

/**
 * 1.8.7 — tweet_feedback 加 ai_verdict 快照字段。
 *
 * 背景:Gemma 的判断只落在 tweet_inbox.ai_verdict,但 (a) X_SUBMIT_FEEDBACK 标注时会用
 * 人工判定(reason='human:*')覆盖它,(b) tweet_inbox 有 7 天 TTL。两者叠加导致
 * 「Gemma 当时怎么判的」在标注后即永久丢失,人工 vs AI 的准确率对账无从算起。
 * 此字段在标注写入 tweet_feedback 时抄录 Gemma 原始判断(human:* 覆盖态不抄),永久保存。
 * 存量 feedback 无法回填(原始判断已被覆盖销毁),只对新标注生效。
 */
const SCHEMA_VERSION_1_8_7 = `
DEFINE FIELD IF NOT EXISTS ai_verdict ON tweet_feedback TYPE option<object> FLEXIBLE;
`;

export async function migration_1_8_7(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_8_7);
  const now = Date.now();
  await db.query(
    `UPSERT $rid SET version = '1.8.7', appliedAt = $now,
     description = 'Add ai_verdict snapshot to tweet_feedback (preserve Gemma original verdict for accuracy accounting)'`,
    { rid: new RecordId('schema_version', '1.8.7'), now },
  );
}

/**
 * 1.8.8 — 邮箱模块 阶段 1:IMAP 只读同步的三张表。
 *
 * 设计见 docs/10-business-design/mail/module-design.md。要点:
 *
 * - **mail_account** per-ws(带 ws_id),与 webview partition `persist:webview-${ws}` 对齐
 *   —— 工作 ws 登公司邮箱、个人 ws 登私人邮箱,两边身份必须一致。
 *   ⚠️ **密码不在这张表**:走 safeStorage 加密落盘(复用 auth-store 的现成方案),
 *   DB 里只存连接参数。任何时候都不该在 SurrealDB 里看到明文/密文凭据。
 *
 * - **mail** 全局表 + account_id 外键(而非 per-ws 分表):默认按当前 ws 的账号过滤,
 *   但保留「跨 ws 全局搜邮件」的可能。UNIQUE(account_id, mailbox, uid) 是去重主键 ——
 *   IMAP UID 在单个 mailbox 内唯一且递增,这是增量同步的基石。
 *
 * - **mail_sync_state** 每 (account, mailbox) 一行游标。
 *   ⚠️ uid_validity 是**正确性关键**:IMAP 服务端重建 mailbox 时会换发 UIDVALIDITY,
 *   此时旧 UID 全部失效且可能重号。不校验就会张冠李戴(把新邮件当成已同步过的跳过,
 *   或把不同邮件写进同一条记录)。变化时必须丢弃游标全量重来。
 *
 * 铁律:绝不 DEFINE FIELD id(见本文件 §1.0.0 注释,SurrealDB 3.x readonly 冲突)。
 */
const SCHEMA_VERSION_1_8_8 = `
DEFINE TABLE IF NOT EXISTS mail_account SCHEMAFULL;
-- 业务 id(ULID),不用内建 record id —— 见 1.8.6 的 readonly 教训。
-- SCHEMAFULL 表里凡是代码会写/会查的字段都必须显式 DEFINE,漏了就是隐性依赖。
DEFINE FIELD IF NOT EXISTS account_id ON mail_account TYPE string ASSERT $value != NONE;
DEFINE FIELD IF NOT EXISTS ws_id       ON mail_account TYPE string ASSERT $value != NONE;
DEFINE FIELD IF NOT EXISTS service_id  ON mail_account TYPE string;
DEFINE FIELD IF NOT EXISTS email       ON mail_account TYPE string ASSERT $value != NONE;
DEFINE FIELD IF NOT EXISTS imap_host   ON mail_account TYPE string;
DEFINE FIELD IF NOT EXISTS imap_port   ON mail_account TYPE int;
DEFINE FIELD IF NOT EXISTS imap_secure ON mail_account TYPE bool;
DEFINE FIELD IF NOT EXISTS smtp_host   ON mail_account TYPE option<string>;
DEFINE FIELD IF NOT EXISTS smtp_port   ON mail_account TYPE option<int>;
DEFINE FIELD IF NOT EXISTS enabled     ON mail_account TYPE bool;
DEFINE FIELD IF NOT EXISTS created_at  ON mail_account TYPE datetime;
DEFINE INDEX IF NOT EXISTS idx_ma_id    ON mail_account FIELDS account_id UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_ma_ws    ON mail_account FIELDS ws_id;
DEFINE INDEX IF NOT EXISTS idx_ma_email ON mail_account FIELDS ws_id, email UNIQUE;

DEFINE TABLE IF NOT EXISTS mail SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS mail_id     ON mail TYPE string ASSERT $value != NONE;
DEFINE FIELD IF NOT EXISTS account_id  ON mail TYPE string ASSERT $value != NONE;
DEFINE FIELD IF NOT EXISTS mailbox     ON mail TYPE string;
DEFINE FIELD IF NOT EXISTS uid         ON mail TYPE int;
DEFINE FIELD IF NOT EXISTS message_id  ON mail TYPE option<string>;
DEFINE FIELD IF NOT EXISTS thread_key  ON mail TYPE option<string>;
DEFINE FIELD IF NOT EXISTS subject     ON mail TYPE string;
DEFINE FIELD IF NOT EXISTS from_addr   ON mail TYPE string;
DEFINE FIELD IF NOT EXISTS from_name   ON mail TYPE option<string>;
DEFINE FIELD IF NOT EXISTS to_addrs    ON mail TYPE array<string>;
DEFINE FIELD IF NOT EXISTS cc_addrs    ON mail TYPE option<array<string>>;
DEFINE FIELD IF NOT EXISTS date        ON mail TYPE datetime;
DEFINE FIELD IF NOT EXISTS body_text   ON mail TYPE option<string>;
DEFINE FIELD IF NOT EXISTS body_html   ON mail TYPE option<string>;
DEFINE FIELD IF NOT EXISTS snippet     ON mail TYPE string;
DEFINE FIELD IF NOT EXISTS flags       ON mail TYPE array<string>;
DEFINE FIELD IF NOT EXISTS has_attach  ON mail TYPE bool;
-- ⚠️ 必须写 array<object> 而非裸 array:SurrealDB 3.x 的 FLEXIBLE 只接受
-- 「类型里含 object」的字段,option<array> FLEXIBLE 是 **parse error**。
-- parse error 会让整段 DDL 被拒(不是只跳过这一条)→ mail / mail_sync_state
-- 两张表一张都建不出来,而 migration 又被 index.ts 的 catch 降级成 console.error,
-- 表现就是「migration 看着没跑」。2026-08-27 排查烧了整轮,别再改回裸 array。
DEFINE FIELD IF NOT EXISTS attachments ON mail TYPE option<array<object>> FLEXIBLE;
-- ⚠️ 数组**元素**要单独放行:DEFINE FIELD attachments 会自动派生一条
-- attachments.* TYPE object,它**不继承父字段的 FLEXIBLE**,于是元素变成严格
-- object,附件带 cid 就报 Found field 'attachments[0].cid', but no such field exists。
-- 又因为自动派生的那条已占位,DEFINE FIELD IF NOT EXISTS attachments.* 会被静默
-- 跳过(IF NOT EXISTS 认为它存在)—— 必须先 REMOVE 再 DEFINE,顺序不能反。
REMOVE FIELD IF EXISTS attachments.* ON mail;
DEFINE FIELD attachments.* ON mail TYPE object FLEXIBLE;
DEFINE FIELD IF NOT EXISTS archived_note_id ON mail TYPE option<string>;
DEFINE FIELD IF NOT EXISTS synced_at   ON mail TYPE datetime;
DEFINE INDEX IF NOT EXISTS idx_mail_id       ON mail FIELDS mail_id UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_mail_acct_uid ON mail FIELDS account_id, mailbox, uid UNIQUE;
DEFINE INDEX IF NOT EXISTS idx_mail_msgid    ON mail FIELDS message_id;
DEFINE INDEX IF NOT EXISTS idx_mail_date     ON mail FIELDS date;
DEFINE INDEX IF NOT EXISTS idx_mail_thread   ON mail FIELDS thread_key;
DEFINE INDEX IF NOT EXISTS idx_mail_account  ON mail FIELDS account_id;

DEFINE TABLE IF NOT EXISTS mail_sync_state SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS account_id    ON mail_sync_state TYPE string ASSERT $value != NONE;
DEFINE FIELD IF NOT EXISTS mailbox       ON mail_sync_state TYPE string;
DEFINE FIELD IF NOT EXISTS uid_validity  ON mail_sync_state TYPE int;
DEFINE FIELD IF NOT EXISTS last_seen_uid ON mail_sync_state TYPE int;
DEFINE FIELD IF NOT EXISTS last_sync_at  ON mail_sync_state TYPE datetime;
DEFINE INDEX IF NOT EXISTS idx_mss ON mail_sync_state FIELDS account_id, mailbox UNIQUE;
`;

export async function migration_1_8_8(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_8_8);
  const now = Date.now();
  await db.query(
    `UPSERT $rid SET version = '1.8.8', appliedAt = $now,
     description = 'Mail module phase 1: mail_account / mail / mail_sync_state (IMAP read-only sync)'`,
    { rid: new RecordId('schema_version', '1.8.8'), now },
  );
}

/**
 * 1.8.9 — 修 mail.attachments 的数组元素约束(承接 1.8.8)。
 *
 * 1.8.8 里 `attachments` 声明成 `option<array<object>> FLEXIBLE`,看似够了,
 * 实则 SurrealDB 会为它自动派生一条 `attachments.* TYPE object`,
 * 而**这条派生字段不继承 FLEXIBLE** —— 数组元素于是是严格 object,
 * 任何未声明的子字段都写不进去:
 *
 *   Found field 'attachments[0].cid', but no such field exists for table 'mail'
 *
 * (`cid` 是内联图片的 Content-ID,Gmail 的图文邮件几乎必带,所以是必现而非边缘。)
 *
 * 坑中坑:自动派生的那条已经占位,`DEFINE FIELD IF NOT EXISTS attachments.*`
 * 会被**静默跳过**(IF NOT EXISTS 认为字段已存在),看着跑了其实没生效。
 * 必须 `REMOVE FIELD` 再 `DEFINE`。
 *
 * 已实测五种形态全通过:带 cid / 不带 cid / 多个附件 / 空数组 / NONE。
 */
const SCHEMA_VERSION_1_8_9 = `
REMOVE FIELD IF EXISTS attachments.* ON mail;
DEFINE FIELD attachments.* ON mail TYPE object FLEXIBLE;
`;

export async function migration_1_8_9(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_8_9);
  const now = Date.now();
  await db.query(
    `UPSERT $rid SET version = '1.8.9', appliedAt = $now,
     description = 'Fix mail.attachments element constraint (attachments.* must be FLEXIBLE; auto-derived one is not)'`,
    { rid: new RecordId('schema_version', '1.8.9'), now },
  );
}

/**
 * 1.9.0 — mail_sync_state 加 backfill_uid(向下回填游标)。
 *
 * 起因(2026-08-28 真机):收件箱 1341 封,同步只拿到 201 封就再也不动了。
 *
 * 根因是两个各自合理的决策叠加成了死角:
 *   1. fetchSince 超过单次上限时取**最新的** N 封(首次同步用户要看最近的,合理)
 *   2. syncMailbox 把游标推进到**实际拉到的**最大 UID(防的是按 uidNext 推进
 *      导致丢数据,也合理)
 * 于是首次同步拿了 UID 2921-3120,游标推到 3120 —— 而 2810 以前的 1140 封
 * 被跳过了,之后每次只查 `3121:*`,**那批邮件永远不会再被拉到**(静默丢数据)。
 *
 * 修法:游标从「一个水位」变成「一个区间」——
 *   - last_seen_uid:已同步到的**最大** UID,向上追新邮件
 *   - backfill_uid: 已回填到的**最小** UID,向下补历史;降到 1 表示触底
 * 同步时先追新、再回填,两头收敛,最终覆盖整个 mailbox。
 *
 * 默认值取 0 表示「尚未开始回填」,首次同步时由 mail-sync 初始化成本批最小 UID。
 */
const SCHEMA_VERSION_1_9_0 = `
DEFINE FIELD IF NOT EXISTS backfill_uid ON mail_sync_state TYPE int DEFAULT 0;
`;

export async function migration_1_9_0(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_9_0);
  // 已有行补上默认值(DEFAULT 只作用于新写入,存量行需显式回填)
  await db.query(`UPDATE mail_sync_state SET backfill_uid = 0 WHERE backfill_uid = NONE`);
  const now = Date.now();
  await db.query(
    `UPSERT $rid SET version = '1.9.0', appliedAt = $now,
     description = 'Add backfill_uid to mail_sync_state (downward backfill cursor; fixes older mail unreachable)'`,
    { rid: new RecordId('schema_version', '1.9.0'), now },
  );
}
