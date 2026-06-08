import { RecordId, type Surreal } from 'surrealdb';
import { surrealStorage } from './storage';

/**
 * V2 SurrealDB schema 初始化
 * 详 docs/RefactorV2/data-model/persistence/surreal-schema.md §2-§3
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
DEFINE FIELD IF NOT EXISTS id ON atom TYPE string ASSERT $value != NONE;
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
DEFINE FIELD IF NOT EXISTS id ON edge TYPE string ASSERT $value != NONE;
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
 * 设计文档(docs/RefactorV2/data-model/persistence/surreal-schema.md §3.1 line 203)
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
