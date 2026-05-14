/**
 * sub-phase 021 clearAll migration (decision 021 §7).
 *
 * 启动时执行一次性 clearAll 重置数据库,清除 sub-phase 021 之前所有 folder atom +
 * 没有 folderForView 边的 note / graph 数据(决议 §0.5 用户拍板"测试数据可重置")。
 *
 * 实施细节(决议 §7.2 + §0.7 第 15 次教训):
 * - StorageAPI 字面无 clearAll method,走 client.ts getDB() 直跑 SurrealQL
 * - 单次 db.query() 承载多语句事务脚本 BEGIN ... COMMIT(不是"单 SQL 语句",
 *   而是"单次 query 调用承载的多语句事务脚本")
 * - sub-phase 3a-tx §3.5.bis 场景 1/3/5 已 binary verify 跨语句原子(decision 020)
 *
 * flag 文件: {userData}/krig-data/migration-021-completed
 * - 存在 → migration 已跑,绝不重跑
 * - 不存在 → 执行 clearAll + 写 flag
 *
 * 调用位置: src/platform/main/index.ts,initStorage() 后 + IPC 业务调用前.
 */

import path from 'node:path';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { app } from 'electron';
import { getDB } from '@storage/surreal/client';

const FLAG_DIR = path.join(app.getPath('userData'), 'krig-data');
const FLAG_PATH = path.join(FLAG_DIR, 'migration-021-completed');

export async function runMigration021IfNeeded(): Promise<void> {
  if (existsSync(FLAG_PATH)) {
    // 已执行,绝不重跑
    return;
  }

  console.warn(
    '[migration/021] sub-phase 021 folder 视图隔离启动 — clearAll 重置数据库\n' +
      '用户拍板:测试数据可重置 (decision 021 §0.5)\n' +
      '现有 folder / note / graph atom + 所有边将被清除',
  );

  // 单次 db.query() 承载的多语句事务脚本 BEGIN ... COMMIT
  // 实证 sub-phase 3a-tx §3.5.bis 场景 1/3/5 跨语句原子 (decision 020)
  const db = getDB();
  try {
    await db.query('BEGIN TRANSACTION; DELETE atom; DELETE edge; COMMIT TRANSACTION;');
  } catch (err) {
    console.error('[migration/021] clearAll 失败,migration 未完成,启动下次仍会重试:', err);
    throw err;
  }

  // 写 flag(目录幂等创建)
  try {
    mkdirSync(FLAG_DIR, { recursive: true });
    writeFileSync(FLAG_PATH, '', 'utf-8');
    console.warn('[migration/021] clearAll 完成,migration-021-completed flag 写入');
  } catch (err) {
    console.error('[migration/021] flag 写入失败,启动下次会重跑 clearAll(幂等):', err);
    throw err;
  }
}
