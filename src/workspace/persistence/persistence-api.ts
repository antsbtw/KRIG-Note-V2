/**
 * 持久化抽象接口
 *
 * 当前实现:localStorage(local-storage.ts)
 * 未来可换:SurrealDB / IPC + 主进程文件
 *
 * 接口稳定 → 切实现时 WorkspaceManager 不变。
 */

import type { WorkspaceManagerState } from '../workspace-state/workspace-state';

export interface PersistenceAPI {
  /** 加载状态(未持久化时返回 null)*/
  load(): WorkspaceManagerState | null;
  /** 保存状态(覆盖式)*/
  save(state: WorkspaceManagerState): void;
  /** 清除持久化 */
  clear(): void;
}
