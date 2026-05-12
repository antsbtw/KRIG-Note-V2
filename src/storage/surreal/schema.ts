import { RecordId, type Surreal } from 'surrealdb';

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
