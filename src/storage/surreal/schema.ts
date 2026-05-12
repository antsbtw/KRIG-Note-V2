import type { Surreal } from 'surrealdb';

/**
 * V2 SurrealDB schema 初始化
 * 详 docs/RefactorV2/data-model/persistence/surreal-schema.md §2-§3
 *
 * 三张表:
 * - atom            语义层 atom (含 id / createdAt / updatedAt / createdBy / payload)
 * - edge            语义层 edge (含 predicate / subject / object / attrs)
 * - schema_version  迁移版本记录
 *
 * 注: 本 sub-phase 不实施 EVENT 触发器 (cascade delete), 留到 sub-phase 2 业务接入时
 *     验证 EM6 后实施 (按 surreal-schema.md §4.2)。
 */
const SCHEMA_VERSION_1_0_0 = `
-- atom 表
DEFINE TABLE atom SCHEMAFULL;
DEFINE FIELD id ON atom TYPE string ASSERT $value != NONE;
DEFINE FIELD createdAt ON atom TYPE number ASSERT $value > 0;
DEFINE FIELD updatedAt ON atom TYPE number ASSERT $value >= createdAt;
DEFINE FIELD createdBy ON atom TYPE string ASSERT $value != "";
DEFINE FIELD payload ON atom TYPE object ASSERT $value != NONE;
DEFINE FIELD payload.domain ON atom TYPE string
  ASSERT string::matches($value, '^[a-z][a-z0-9-]*$');
DEFINE FIELD payload.payload ON atom TYPE any;

-- atom 索引
DEFINE INDEX atom_domain ON atom FIELDS payload.domain;
DEFINE INDEX atom_createdBy ON atom FIELDS createdBy;
DEFINE INDEX atom_createdAt ON atom FIELDS createdAt;
DEFINE INDEX atom_updatedAt ON atom FIELDS updatedAt;

-- edge 表
DEFINE TABLE edge SCHEMAFULL;
DEFINE FIELD id ON edge TYPE string ASSERT $value != NONE;
DEFINE FIELD createdAt ON edge TYPE number ASSERT $value > 0;
DEFINE FIELD updatedAt ON edge TYPE number ASSERT $value >= createdAt;
DEFINE FIELD predicate ON edge TYPE string
  ASSERT string::matches($value, '^(user|ai|sys):([a-z][a-zA-Z0-9-]*:)?[a-z][a-zA-Z0-9]*$');
DEFINE FIELD subject ON edge TYPE object;
DEFINE FIELD subject.kind ON edge TYPE string ASSERT $value = 'atom';
DEFINE FIELD subject.atomId ON edge TYPE string;
DEFINE FIELD object ON edge TYPE object;
DEFINE FIELD object.kind ON edge TYPE string ASSERT $value INSIDE ['atom', 'literal'];
DEFINE FIELD object.atomId ON edge TYPE option<string>;
DEFINE FIELD object.type ON edge TYPE option<string>;
DEFINE FIELD object.value ON edge TYPE any;
DEFINE FIELD attrs ON edge TYPE object;
DEFINE FIELD attrs.createdBy ON edge TYPE string ASSERT $value != "";
DEFINE FIELD attrs.createdAt ON edge TYPE number;
DEFINE FIELD attrs.confidence ON edge TYPE option<number> ASSERT $value >= 0 AND $value <= 1;
DEFINE FIELD attrs.confirmedAt ON edge TYPE option<number>;
DEFINE FIELD attrs.confirmedBy ON edge TYPE option<string>;
DEFINE FIELD attrs.rejectedAt ON edge TYPE option<number>;
DEFINE FIELD attrs.rejectedBy ON edge TYPE option<string>;
DEFINE FIELD attrs.comment ON edge TYPE option<string>;

-- edge 索引
DEFINE INDEX edge_predicate ON edge FIELDS predicate;
DEFINE INDEX edge_subject ON edge FIELDS subject.atomId;
DEFINE INDEX edge_object ON edge FIELDS object.atomId WHERE object.kind = 'atom';
DEFINE INDEX edge_createdAt ON edge FIELDS createdAt;
DEFINE INDEX edge_createdBy ON edge FIELDS attrs.createdBy;
DEFINE INDEX edge_subject_predicate ON edge FIELDS subject.atomId, predicate;

-- schema_version 表
DEFINE TABLE schema_version SCHEMAFULL;
DEFINE FIELD version ON schema_version TYPE string;
DEFINE FIELD appliedAt ON schema_version TYPE number;
DEFINE FIELD description ON schema_version TYPE string;
DEFINE INDEX schema_version_unique ON schema_version FIELDS version UNIQUE;
`;

export async function initSchema(db: Surreal): Promise<void> {
  await db.query(SCHEMA_VERSION_1_0_0);

  await db.query(
    `CREATE schema_version SET
      version = '1.0.0',
      appliedAt = $now,
      description = 'Initial schema (Phase N sub-phase 1)'`,
    { now: Date.now() },
  );
}
