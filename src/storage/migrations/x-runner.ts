/**
 * X 库(krig_x)migration runner —— **独立于笔记库的版本序列**。
 *
 * X 库有自己的 schema_version 表,版本号从 1.0.0 起,与笔记库的 1.9.x 互不干扰:
 * 两条序列各跑各的,一边加 migration 不会惊动另一边(这正是独立 database 的收益之一)。
 *
 * 结构与 runner.ts 刻意保持一致(同样的 fail-loud + rethrow 语义),
 * 版本比较复用 runner.ts 的 compareVersions,不另写一份。
 */
import type { Surreal } from 'surrealdb';
import { compareVersions } from './runner';
import { x_migration_1_0_0, x_migration_1_0_1, x_migration_1_0_2, x_migration_1_0_3, x_migration_1_0_4 } from '../surreal/x-schema';

interface XMigration {
  version: string;
  description: string;
  up: (db: Surreal) => Promise<void>;
}

const X_MIGRATIONS: XMigration[] = [
  {
    version: '1.0.0',
    description: 'X database initial schema (data isolation phase 0)',
    up: x_migration_1_0_0,
  },
  {
    version: '1.0.1',
    description: 'Reply relationship authoritative fields (in_reply_to_user / conversation_id)',
    up: x_migration_1_0_1,
  },
  {
    version: '1.0.2',
    description: 'Normalize author_handle (strip @, lowercase) across x_tweet / tweet_feedback',
    up: x_migration_1_0_2,
  },
  {
    version: '1.0.3',
    description: 'Collection cursor table (resume via X own Bottom cursor)',
    up: x_migration_1_0_3,
  },
  {
    version: '1.0.4',
    description: 'Account baseline counts (tweet_count = collection completeness denominator)',
    up: x_migration_1_0_4,
  },
];

export async function runXMigrations(db: Surreal): Promise<void> {
  let currentVersion = '0.0.0';
  try {
    // ORDER BY 字段必须出现在 SELECT 子句里(SurrealDB 3.0.4),否则 parse error
    // 被 catch 吞掉 → currentVersion 恒 0.0.0 → 每次启动全量重跑(笔记库踩过)。
    const versionRes = await db.query<[Array<{ version: string; appliedAt: number }>]>(
      `SELECT version, appliedAt FROM schema_version ORDER BY appliedAt DESC LIMIT 1`,
    );
    currentVersion = versionRes[0]?.[0]?.version ?? '0.0.0';
  } catch (err) {
    // 冷启动时 X 库连 schema_version 表都没有 —— 属预期。但不静默:
    // 打 warn 露出诊断信息,避免真实的 SQL 错误被当成"冷启动"埋掉。
    console.warn(
      '[storage/x-migrations] schema_version SELECT failed, treating as 0.0.0:',
      err,
    );
  }

  for (const mig of X_MIGRATIONS) {
    if (compareVersions(currentVersion, mig.version) < 0) {
      console.log(`[storage/x-migrations] applying ${mig.version}: ${mig.description}`);
      try {
        await mig.up(db);
      } catch (err) {
        // fail loud + 停在第一个坏 migration(理由同 runner.ts):
        // 单条 DDL parse error 会让**整段**被服务端拒收 —— 现场表现是
        // "表建了一半 / 看着像没跑",而不是一条清晰的报错。先把这行找出来。
        console.error(
          `[storage/x-migrations] ✗ X migration ${mig.version} FAILED — X schema 停在 ${currentVersion},` +
            ` 后续已跳过。先修这条再启动:`,
          err,
        );
        throw err;
      }
    }
  }
}
