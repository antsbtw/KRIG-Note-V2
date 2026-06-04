/**
 * clip-cache — 网页剪藏 Defuddle 原始结果落盘缓存
 *
 * 动机(用户建议):Defuddle 吐出的 markdown 是黑盒,inline 链接/加粗/列表偶有被当
 * 纯文本残留等格式问题,靠一闪而过的 console 难定位。把每次剪藏的**完整 FullPageResult**
 * 落盘成 JSON,可离线反复观察真实格式来调优 import-pipeline。
 *
 * 落盘布局:
 *   <userData>/web-clip-cache/
 *   └── <epochMs>-<domain>.json     — 单次剪藏一份完整 FullPageResult
 *
 * 清理策略(用户拍板):保留最近 N 份(默认 20),每次写入后按文件名时间戳排序删最旧。
 * 文件名前缀 epochMs 保证字典序 = 时间序。
 *
 * 纯 main 侧、fire-and-forget:写盘失败仅 console.warn,绝不阻断剪藏主路径。
 */

import { app } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FullPageResult } from './types';

const CACHE_DIR_NAME = 'web-clip-cache';
/** 保留最近 N 份(超出删最旧) */
const MAX_ENTRIES = 20;

function getCacheDir(): string {
  return path.join(app.getPath('userData'), CACHE_DIR_NAME);
}

/** domain → 文件系统安全短名(对齐 import-cache sanitizeFsName 风格) */
function safeDomain(domain: string | undefined): string {
  const d = (domain || 'unknown').replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, '_');
  return d.slice(0, 60) || 'unknown';
}

/**
 * 缓存一次剪藏的完整 FullPageResult(写入后清理至最近 MAX_ENTRIES 份)。
 *
 * @param result    captureFullPage 产物;null(抓取失败)不写。
 * @param nowMs     时间戳(ms epoch)— main 侧 Date.now() 由调用方传或本函数取。
 */
export async function cacheClipResult(
  result: FullPageResult | null,
  nowMs: number = Date.now(),
): Promise<void> {
  if (!result) return;
  const dir = getCacheDir();
  try {
    await fs.mkdir(dir, { recursive: true });
    const filename = `${nowMs}-${safeDomain(result.domain)}.json`;
    await fs.writeFile(path.join(dir, filename), JSON.stringify(result, null, 2), 'utf-8');
    console.log(`[content-extraction/clip-cache] cached → ${path.join(dir, filename)}`);
    await pruneOldEntries(dir);
  } catch (err) {
    console.warn('[content-extraction/clip-cache] cacheClipResult failed:', err);
  }
}

/** 保留最近 MAX_ENTRIES 份 JSON,删更旧的(按文件名前缀时间戳 = 字典序排序)。 */
async function pruneOldEntries(dir: string): Promise<void> {
  try {
    const all = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
    if (all.length <= MAX_ENTRIES) return;
    // 文件名 `${epochMs}-domain.json`,字典序升序 = 时间升序,前面的最旧
    all.sort();
    const toDelete = all.slice(0, all.length - MAX_ENTRIES);
    await Promise.all(
      toDelete.map((f) => fs.rm(path.join(dir, f), { force: true }).catch(() => { /* ok */ })),
    );
    console.log(`[content-extraction/clip-cache] pruned ${toDelete.length} old entr${toDelete.length === 1 ? 'y' : 'ies'}`);
  } catch (err) {
    console.warn('[content-extraction/clip-cache] pruneOldEntries failed:', err);
  }
}

/** 公开缓存目录(供日志 / 未来 UI "打开缓存目录" 用)。 */
export function getClipCacheDir(): string {
  return getCacheDir();
}
