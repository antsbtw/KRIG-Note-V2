/**
 * V2 SurrealDB schema migration runner
 *
 * 按 schema_version 表当前版本与已注册迁移列表比较,逐次 up()。
 * 幂等: DEFINE TABLE/FIELD/INDEX 在 SurrealDB 是 idempotent (重复定义不报错)。
 */
import type { Surreal } from 'surrealdb';
import { initSchema, migration_1_1_0, migration_1_2_0, migration_1_3_0, migration_1_4_0, migration_1_5_0, migration_1_6_0, migration_1_7_0, migration_1_7_1, migration_1_8_0, migration_1_8_1, migration_1_8_2, migration_1_8_3, migration_1_8_4, migration_1_8_5, migration_1_8_6 } from '../surreal/schema';

interface Migration {
  version: string;
  description: string;
  up: (db: Surreal) => Promise<void>;
}

const MIGRATIONS: Migration[] = [
  {
    version: '1.0.0',
    description: 'Initial schema (Phase N sub-phase 1)',
    up: initSchema,
  },
  {
    version: '1.1.0',
    description: 'Add atom.hasBeenReferenced field (Phase N sub-phase 3a-1)',
    up: migration_1_1_0,
  },
  {
    version: '1.2.0',
    description: 'Add hasNoteView edges for note pm atoms (Phase N sub-phase 3a-2.5)',
    up: migration_1_2_0,
  },
  {
    version: '1.3.0',
    description: 'Make edge.attrs and atom.payload FLEXIBLE (vocabulary extension support)',
    up: migration_1_3_0,
  },
  {
    version: '1.4.0',
    description: 'Add intent table (data-layer reliability intent-log, SP-3)',
    up: migration_1_4_0,
  },
  {
    version: '1.5.0',
    description: 'Add atom_note_id index (Decision 028 block structure attrs)',
    up: migration_1_5_0,
  },
  {
    version: '1.6.0',
    description: 'Inline graph text doc into payload + drop orphan hasContent edges/pm atoms (L5-G6c A3/M2)',
    up: migration_1_6_0,
  },
  {
    version: '1.7.0',
    description: 'Add workspace table (S3-b landlord persistence in SurrealDB)',
    up: migration_1_7_0,
  },
  {
    version: '1.7.1',
    description: 'Fix workspace table: SCHEMAFULL -> SCHEMALESS (WorkspaceState subfields)',
    up: migration_1_7_1,
  },
  {
    version: '1.8.0',
    description: 'Add tweet_inbox + search_recipes tables (X timeline intelligence Phase 1)',
    up: migration_1_8_0,
  },
  {
    version: '1.8.1',
    description: 'Add ws_id field to tweet_inbox and search_recipes (Phase 2 multi-window)',
    up: migration_1_8_1,
  },
  {
    version: '1.8.2',
    description: 'Make tweet_inbox metrics and ai_verdict FLEXIBLE to allow subfields',
    up: migration_1_8_2,
  },
  {
    version: '1.8.3',
    description: 'Add tweet_feedback table for human verdict training data',
    up: migration_1_8_3,
  },
  {
    version: '1.8.4',
    description: 'Add translation field to tweet_inbox for non-Chinese tweets',
    up: migration_1_8_4,
  },
  {
    version: '1.8.5',
    description: 'Add task_id dimension to tweet_inbox',
    up: migration_1_8_5,
  },
  {
    version: '1.8.6',
    description: 'Drop explicit id field on atom/edge (SurrealDB 3.x record-id readonly conflict; fixes silent note create/save failure)',
    up: migration_1_8_6,
  },
];

export async function runMigrations(db: Surreal): Promise<void> {
  let currentVersion = '0.0.0';
  try {
    // SurrealDB 3.0.4 要求 ORDER BY 字段须出现在 SELECT 子句中 (decision 017 §1.2):
    // 原语句 `SELECT version FROM ... ORDER BY appliedAt` 触发 parse error,
    // 被外层 catch 静默吞掉 → currentVersion 永远 0.0.0 → migration 每次启动全跑。
    const versionRes = await db.query<[Array<{ version: string; appliedAt: number }>]>(
      `SELECT version, appliedAt FROM schema_version ORDER BY appliedAt DESC LIMIT 1`,
    );
    currentVersion = versionRes[0]?.[0]?.version ?? '0.0.0';
  } catch (err) {
    // schema_version 表还不存在(冷启动)或查询失败 — 视为 0.0.0,后续 initSchema 会创建它
    // catch 不静默:打 warn 露出诊断信息,避免 SQL 语法错误等真实 bug 被埋(decision 017 §1.2)
    console.warn(
      '[storage/migrations] schema_version SELECT failed, treating as 0.0.0:',
      err,
    );
  }

  for (const mig of MIGRATIONS) {
    if (compareVersions(currentVersion, mig.version) < 0) {
      console.log(`[storage/migrations] applying ${mig.version}: ${mig.description}`);
      await mig.up(db);
    }
  }
}

function compareVersions(a: string, b: string): number {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((aParts[i] ?? 0) !== (bParts[i] ?? 0)) {
      return (aParts[i] ?? 0) - (bParts[i] ?? 0);
    }
  }
  return 0;
}
