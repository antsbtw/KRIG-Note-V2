/**
 * localStorage 持久化实现
 *
 * L3 阶段方案(0 npm 依赖):
 * - 浏览器原生 API(Electron renderer 进程支持)
 * - 单一 JSON 字符串
 * - 同步读写(简单)
 *
 * 未来切 SurrealDB 时,实现新的 PersistenceAPI,WorkspaceManager 接口不变。
 */

import type { PersistenceAPI } from './persistence-api';
import type { WorkspaceManagerState } from '../workspace-state/workspace-state';

const STORAGE_KEY = 'krig-v2-workspace-state';

export const localStoragePersistence: PersistenceAPI = {
  load(): WorkspaceManagerState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as WorkspaceManagerState;
    } catch (err) {
      console.warn('[L3] Failed to load workspace state from localStorage:', err);
      return null;
    }
  },

  save(state: WorkspaceManagerState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('[L3] Failed to save workspace state to localStorage:', err);
    }
  },

  clear(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      console.warn('[L3] Failed to clear workspace state from localStorage:', err);
    }
  },
};
