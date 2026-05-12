/**
 * V2 笔记/文件夹 capability 启动迁移 (decision 012 §3.6)
 *
 * V2 切 SurrealDB 后,renderer 端 localStorage 的 V1 兼容键 'krig.notes' / 'krig.folders'
 * 不再使用。启动时检测并清空,避免老数据残留误导。
 *
 * 按用户拍板选项 M:V2 测试数据可丢,直接清空。
 *
 * 调用方:renderer 端启动路径 (L5-alive 或 capability 初始化路径) 调一次,idempotent。
 */

const LEGACY_KEYS = ['krig.notes', 'krig.folders'] as const;

let cleared = false;

export function clearLegacyLocalStorage(): void {
  if (cleared) return;
  cleared = true;
  if (typeof localStorage === 'undefined') return;
  const removed: string[] = [];
  for (const key of LEGACY_KEYS) {
    if (localStorage.getItem(key) !== null) {
      localStorage.removeItem(key);
      removed.push(key);
    }
  }
  if (removed.length > 0) {
    console.log(
      `[note-capability] cleared legacy localStorage keys: ${removed.join(', ')} (V2 storage 已切 SurrealDB)`,
    );
  }
}
