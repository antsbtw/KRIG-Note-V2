/**
 * ClientIdentity — 设备唯一身份
 *
 * clientId 存 localStorage key='krig.clientId'，app 首次启动时生成，此后永久保留。
 * 供多窗口 / 多终端 merge 引擎标注"最后编辑者"。
 *
 * 规范：docs/00-architecture/multi-window-sync-spec.md §3.1
 */

import { generateUlid } from '@shared/ulid';

const LOCAL_STORAGE_KEY = 'krig.clientId';

let _cachedClientId: string | null = null;

/**
 * 读取（或初始化）当前设备的 clientId。
 * 仅在 renderer 进程（有 localStorage）调用。
 */
export function getClientId(): string {
  if (_cachedClientId) return _cachedClientId;
  const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (stored) {
    _cachedClientId = stored;
    return stored;
  }
  const id = generateUlid();
  localStorage.setItem(LOCAL_STORAGE_KEY, id);
  _cachedClientId = id;
  return id;
}
