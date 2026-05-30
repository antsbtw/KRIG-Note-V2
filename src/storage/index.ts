/**
 * V2 storage 主入口
 *
 * 调用边界 (decision 008 §4.0):
 * - View 层禁止 import @storage
 * - Capability / Platform 层可 import
 * - 业务层通过 capability API 间接访问
 */
import { initSurrealDB, shutdownSurrealDB, shutdownSurrealDBAsync, getDB } from './surreal/client';
import { runMigrations } from './migrations/runner';
import { surrealStorage } from './surreal/storage';
import { runCardinalityCheck } from './health/cardinality-check';
import { sweepPendingIntents } from './intent-log';

export type {
  StorageAPI,
  StorageOptions,
  PutAtomInput,
  PutAtomInputUnsafe,
  AtomFilter,
  PutEdgeInput,
  EdgeFilter,
  SubgraphQuery,
  SubgraphResult,
  StorageTransaction,
} from './api';

export const storage = surrealStorage;

export async function initStorage(): Promise<void> {
  await initSurrealDB();
  await runMigrations(getDB());
  // SP-3 sweeper:扫未完成 intent 续完/回滚。在 migrations 后(intent 表已建)、
  // cardinality-check 前(半状态可能正是 cardinality 误判源,先清半状态)。
  // 各 op resolver 由 capability 在 initIpcBus 阶段(initStorage 之前)注册;未注册的
  // op sweeper 会 log 跳过不阻塞启动(详 design §3.4)。
  await sweepPendingIntents();
  // P0a-bis K3+K4:cardinality 一对一约束 self-check + keep-latest 自愈
  // (在 runMigrations 后,任何业务 IPC 调用前)
  await runCardinalityCheck(surrealStorage);
  console.log('[storage] initialized');
}

export async function shutdownStorage(): Promise<void> {
  await shutdownSurrealDBAsync();
}

/** before-quit 同步关闭 (不等子进程退出) */
export function shutdownStorageSync(): void {
  shutdownSurrealDB();
}
