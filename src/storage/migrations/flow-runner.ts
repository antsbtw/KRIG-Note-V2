/**
 * 工作流库(`krig_flow`)migration runner —— 与笔记库 / X 库各自独立的第三套。
 *
 * ⚠️ 版本号自成序列(1.0.0 起),与另两个库**完全无关**。
 * 每个库有自己的 `schema_version` 表。
 */

import type { Surreal } from 'surrealdb';
import { compareVersions } from './runner';
import { flow_migration_1_0_0 } from '../surreal/flow-schema';

interface FlowMigration {
  version: string;
  description: string;
  up: (db: Surreal) => Promise<void>;
}

const FLOW_MIGRATIONS: FlowMigration[] = [
  {
    version: '1.0.0',
    description: 'Flow execution records (run + step, with caller provenance)',
    up: flow_migration_1_0_0,
  },
];

export async function runFlowMigrations(db: Surreal): Promise<void> {
  let currentVersion = '0.0.0';
  try {
    // ⚠️ ORDER BY 的字段必须出现在 SELECT 子句里(SurrealDB 3.0.4),否则 parse error
    // 被 catch 吞掉 → currentVersion 恒 0.0.0 → 每次启动全量重跑(笔记库踩过)。
    const versionRes = await db.query<[Array<{ version: string; appliedAt: number }>]>(
      `SELECT version, appliedAt FROM schema_version ORDER BY appliedAt DESC LIMIT 1`,
    );
    currentVersion = versionRes[0]?.[0]?.version ?? '0.0.0';
  } catch (err) {
    // 冷启动时连 schema_version 表都没有 —— 属预期。但不静默:
    // 打 warn 露出诊断信息,避免真实的 SQL 错误被当成"冷启动"埋掉。
    console.warn(
      '[storage/flow-migrations] schema_version SELECT failed, treating as 0.0.0:',
      err,
    );
  }

  for (const mig of FLOW_MIGRATIONS) {
    if (compareVersions(currentVersion, mig.version) < 0) {
      console.log(`[storage/flow-migrations] applying ${mig.version}: ${mig.description}`);
      try {
        await mig.up(db);
      } catch (err) {
        // fail loud + 停在第一个坏 migration:单条 DDL parse error 会让**整段**
        // 被服务端拒收 —— 现场表现是「表建了一半 / 看着像没跑」,不是清晰报错。
        console.error(
          `[storage/flow-migrations] ✗ flow migration ${mig.version} FAILED —— `
          + `schema 停在 ${currentVersion},后续已跳过。先修这条再启动:`,
          err,
        );
        throw err;
      }
    }
  }
}
