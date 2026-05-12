/**
 * V2 SurrealDB schema migration runner
 *
 * 按 schema_version 表当前版本与已注册迁移列表比较,逐次 up()。
 * 幂等: DEFINE TABLE/FIELD/INDEX 在 SurrealDB 是 idempotent (重复定义不报错)。
 */
import type { Surreal } from 'surrealdb';
import { initSchema } from '../surreal/schema';

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
];

export async function runMigrations(db: Surreal): Promise<void> {
  let currentVersion = '0.0.0';
  try {
    const versionRes = await db.query<[Array<{ version: string }>]>(
      `SELECT version FROM schema_version ORDER BY appliedAt DESC LIMIT 1`,
    );
    currentVersion = versionRes[0]?.[0]?.version ?? '0.0.0';
  } catch {
    // schema_version 表还不存在 — 视为 0.0.0,后续 initSchema 会创建它
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
