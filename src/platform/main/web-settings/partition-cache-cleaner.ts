/**
 * webview partition 缓存清理(保守档)
 *
 * ## 为什么要有这个
 *
 * per-ws partition 化后(2026-06-11),每个 ws 一个 `persist:webview-<wsId>` session,
 * 各自独立攒 HTTP 缓存。实测 2026-08-31:Partitions/ 共 6.8G,其中 ws-2 单个 2.0G,
 * 而**登录态只占 6.8 MB(0.3%)**,其余 99.7% 是纯缓存。缓存无上限、只增不减。
 *
 * ## 保守档 = 绝不碰登录态
 *
 * Electron 三个 API 的边界(electron.d.ts 实测,v40):
 *
 * | API | 清什么 | 掉登录? |
 * |---|---|---|
 * | `clearCache()` | HTTP 缓存(Cache/ 目录) | 否 |
 * | `clearCodeCaches({})` | JS 编译缓存(Code Cache/) | 否 |
 * | `clearStorageData()` | **不传参 = 全清,含 cookies** | **是** |
 *
 * 本模块只用前两个。`clearStorageData` 留给用户手动触发的「清除浏览数据」
 * (web-settings/handler.ts 的 WEB_CLEAR_STORAGE_DATA),自动清理绝不调它 ——
 * 否则 X / AI / Google 的登录会全掉,是灾难性副作用。
 *
 * Service Worker 的 CacheStorage(ws-2 上 499M)属灰色地带:技术上是缓存,
 * 但需 `clearStorageData({storages:['cachestorage']})` 才能清。保守档**不清**,
 * 代价是少回收 ~0.5G/ws,换取零行为变化。
 *
 * ## 触发时机
 *
 * 启动时跑一次(见 platform/main/index.ts),按体积阈值判断:只有超过
 * PARTITION_CACHE_THRESHOLD_MB 的 partition 才清,小的不动 —— 避免每次启动
 * 都把正常工作的缓存清掉,让冷启动变慢。
 */

import path from 'node:path';
import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { app, session } from 'electron';

/** 超过这个体积才清(MB)。ws-1/ws-2 实测 ~2000M,日常 ws 几十 M 不会被误伤。 */
const PARTITION_CACHE_THRESHOLD_MB = 800;

/** 纯缓存子目录 —— 只统计这些,不把登录态算进阈值。 */
const CACHE_SUBDIRS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnWebGPUCache',
  'DawnGraphiteCache',
  'Shared Dictionary',
] as const;

function partitionsRoot(): string {
  return path.join(app.getPath('userData'), 'Partitions');
}

/** 递归累加目录字节数。目录不存在返回 0(partition 可能没建过某个子目录)。 */
async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0; // 不存在 / 无权限 → 当 0,不阻断整体清理
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      total += await dirSize(full);
    } else if (e.isFile()) {
      try {
        total += (await stat(full)).size;
      } catch {
        // 文件在遍历途中被浏览器删了 —— 正常竞态,跳过
      }
    }
  }
  return total;
}

/** 单个 partition 目录的纯缓存体积(字节)。 */
async function cacheSizeOf(partitionDir: string): Promise<number> {
  let total = 0;
  for (const sub of CACHE_SUBDIRS) {
    total += await dirSize(path.join(partitionDir, sub));
  }
  return total;
}

/**
 * 磁盘目录名 → session partition 名。
 *
 * Electron 把 `persist:webview-ws-2` 存成 `Partitions/webview-ws-2`(去掉 `persist:` 前缀)。
 * 反过来拼回去才能拿到对应 Session。
 */
function partitionNameOf(dirName: string): string {
  return `persist:${dirName}`;
}

export interface CacheCleanResult {
  /** 检查过的 partition 数 */
  scanned: number;
  /** 实际清理的 partition 名单 */
  cleaned: string[];
  /** 回收字节数(清理前的缓存体积合计) */
  freedBytes: number;
}

/**
 * 扫描所有 partition,对超阈值的清 HTTP 缓存 + JS 编译缓存。
 *
 * 不清 cookies / localStorage / IndexedDB / Service Worker —— 登录态零影响。
 */
export async function cleanOversizedPartitionCaches(): Promise<CacheCleanResult> {
  const root = partitionsRoot();
  const result: CacheCleanResult = { scanned: 0, cleaned: [], freedBytes: 0 };

  let dirs: Dirent[];
  try {
    dirs = await readdir(root, { withFileTypes: true });
  } catch {
    return result; // Partitions/ 还没建(全新安装)→ 无事可做
  }

  const thresholdBytes = PARTITION_CACHE_THRESHOLD_MB * 1024 * 1024;

  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    result.scanned += 1;

    const dir = path.join(root, d.name);
    const size = await cacheSizeOf(dir);
    if (size < thresholdBytes) continue;

    const partition = partitionNameOf(d.name);
    const sess = session.fromPartition(partition);
    // 两个都不碰 cookies —— 见文件头表格。
    await sess.clearCache();
    await sess.clearCodeCaches({ urls: [] });

    result.cleaned.push(d.name);
    result.freedBytes += size;
    console.log(
      `[partition-cache] cleaned ${d.name} — ${(size / 1024 / 1024).toFixed(0)} MB(登录态未动)`,
    );
  }

  return result;
}
