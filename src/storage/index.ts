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
  console.log('[storage] initialized');
}

export async function shutdownStorage(): Promise<void> {
  await shutdownSurrealDBAsync();
}

/** before-quit 同步关闭 (不等子进程退出) */
export function shutdownStorageSync(): void {
  shutdownSurrealDB();
}
