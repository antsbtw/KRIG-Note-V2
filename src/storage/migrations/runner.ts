/**
 * V2 SurrealDB schema migration runner
 *
 * 按 schema_version 表当前版本与已注册迁移列表比较,逐次 up()。
 * 幂等: DEFINE TABLE/FIELD/INDEX 在 SurrealDB 是 idempotent (重复定义不报错)。
 */
import type { Surreal } from 'surrealdb';
import { initSchema, migration_1_1_0 } from '../surreal/schema';

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
