/**
 * x-plan-cache — note→X Article 发布的「中间态」落盘缓存
 *
 * 动机(总指挥 2026-06-14 拍板):note→X 发布链路修 bug 难,根因是**没有可检查的中间态缓存**,
 * 只能靠肉眼看 X 渲染结果反推,每次都「半截验证」。把每次发布算好的 **ArticlePlan**(中间态:
 * title + 有序 steps + warnings)连同「已渲图清单 / 渲图失败」一起落盘成 pretty JSON,
 * 即可离线直接看:某个 block(如紧跟 Mermaid 图后的标题)在 plan 里**到底在不在、格式对不对**
 * —— 一眼分清「规范化阶段(切分/降级)丢的」还是「上传阶段(driver paste)丢的」。
 *
 * 落盘布局(对齐 clip-cache.ts 风格):
 *   <userData>/x-plan-cache/
 *   └── <epochMs>-<noteTitle>.json     — 单次发布一份诊断信封(plan + rendered + failures)
 *
 * 清理策略:保留最近 N 份(默认 20),每次写入后按文件名时间戳(= 字典序)删最旧。
 * 纯 main 侧、fire-and-forget:写盘失败仅 console.warn,绝不阻断发布主路径。
 *
 * 注:plan 在 renderer 侧(api.ts buildDocArticlePlan)生成,经 X_PLAN_CACHE_DUMP IPC
 *   fire-and-forget 送到 main 落盘(同 import-cache 的 dump 模式)。
 */

import { app, ipcMain } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { IPC_CHANNELS } from '@shared/ipc/channel-names';
import type { XPlanCacheEnvelope } from '@shared/ipc/x-types';

// XPlanCacheEnvelope 类型定义在 shared 层(IPC 数据契约,renderer/preload/main 共用);此处 re-export
// 方便 main 侧其它模块就近引用。
export type { XPlanCacheEnvelope } from '@shared/ipc/x-types';

const CACHE_DIR_NAME = 'x-plan-cache';
/** 保留最近 N 份(超出删最旧) */
const MAX_ENTRIES = 20;

function getCacheDir(): string {
  return path.join(app.getPath('userData'), CACHE_DIR_NAME);
}

/** note 标题 → 文件系统安全短名(对齐 clip-cache safeDomain / import-cache sanitizeFsName 风格) */
function safeTitle(title: string | undefined): string {
  const t = (title || 'untitled').replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, '_');
  return t.slice(0, 60) || 'untitled';
}

/**
 * 缓存一次发布的中间态信封(写入后清理至最近 MAX_ENTRIES 份)。
 *
 * @param env    诊断信封(plan + rendered + failures);plan 缺失不写。
 * @param nowMs  时间戳(ms epoch)。
 */
export async function cacheXPlan(
  env: XPlanCacheEnvelope,
  nowMs: number = env.capturedAt || Date.now(),
): Promise<void> {
  if (!env || !env.plan) return;
  const dir = getCacheDir();
  try {
    await fs.mkdir(dir, { recursive: true });
    const filename = `${nowMs}-${safeTitle(env.noteTitle)}.json`;
    const full = path.join(dir, filename);
    await fs.writeFile(full, JSON.stringify(env, null, 2), 'utf-8');
    console.log(`[x/x-plan-cache] cached → ${full}`);
    await pruneOldEntries(dir);
  } catch (err) {
    console.warn('[x/x-plan-cache] cacheXPlan failed:', err);
  }
}

/** 保留最近 MAX_ENTRIES 份 JSON,删更旧的(按文件名前缀时间戳 = 字典序排序)。 */
async function pruneOldEntries(dir: string): Promise<void> {
  try {
    const all = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
    if (all.length <= MAX_ENTRIES) return;
    all.sort(); // `${epochMs}-title.json` 字典序升序 = 时间升序,前面最旧
    const toDelete = all.slice(0, all.length - MAX_ENTRIES);
    await Promise.all(
      toDelete.map((f) => fs.rm(path.join(dir, f), { force: true }).catch(() => { /* ok */ })),
    );
    console.log(`[x/x-plan-cache] pruned ${toDelete.length} old entr${toDelete.length === 1 ? 'y' : 'ies'}`);
  } catch (err) {
    console.warn('[x/x-plan-cache] pruneOldEntries failed:', err);
  }
}

/** 公开缓存目录(供日志 / 未来 UI "打开缓存目录" 用)。 */
export function getXPlanCacheDir(): string {
  return getCacheDir();
}

/** 注册 renderer → main 的中间态落盘 IPC(fire-and-forget,同 import-cache dump 模式)。 */
export function registerXPlanCacheIpc(): void {
  ipcMain.on(IPC_CHANNELS.X_PLAN_CACHE_DUMP, (_e, env: XPlanCacheEnvelope) => {
    void cacheXPlan(env);
  });
}
