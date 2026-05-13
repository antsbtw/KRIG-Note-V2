/**
 * Graph 旧磁盘 JSON 清理 (decision 014 §3.6 + §5.7,选项 M)
 *
 * sub-phase 3a-1 切 SurrealDB 后,旧磁盘路径 `userData/krig-data/graph/canvases.json` +
 * `userData/krig-data/graph/documents/{id}.json` 不再使用。启动时检测并清除,
 * 避免老数据残留误导 (按用户拍板选项 M:V2 测试数据可丢)。
 *
 * 调用方:src/platform/main/index.ts 的 initStorage 后 + graph-library-store 任何 IPC 调用前,
 * 在 main 入口幂等执行。
 *
 * ⚠ 决议 §5.7 路径字面要求 src/capabilities/graph-library-store/migration.ts,
 * 但该路径属 renderer 侧 capability 包,无法 import electron / node:fs (sub-phase 1 边界严防);
 * 务实把 impl 放 main (src/platform/main/graph/migration.ts),反向更新登记 (合 main 后做)。
 */

import { app } from 'electron';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

let cleared = false;

export function clearLegacyGraphStorage(): void {
  if (cleared) return;
  cleared = true;
  try {
    const dir = path.join(app.getPath('userData'), 'krig-data', 'graph');
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
      console.log('[graph-library-store] cleared legacy disk storage:', dir);
    }
  } catch (err) {
    console.warn('[graph-library-store] clearLegacyGraphStorage failed:', err);
  }
}
