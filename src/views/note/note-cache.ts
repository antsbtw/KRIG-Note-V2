/**
 * note-cache — view 层私有 sync 缓存 (decision 012 设计师批复 L2)
 *
 * 用途:
 * driver 的 LinkClickHandler.resolveNoteTitle 是 sync API (PM transaction commit
 * 路径不能 await),但 noteCap().getNote/listNotes 是 async (IPC roundtrip)。
 * 本文件维护 view 层 module-scope 缓存,启动时拉一次 + 订阅 onListChanged
 * 增量更新;sync 查询永不 await。
 *
 * 边界纪律 (设计师批复 L2):
 * ✓ cache 在 view 层 (本文件)
 * ✗ 不在 capability 层 (污染 V2 既有"capability 全 async"惯例)
 * ✗ 不在 driver 层 (driver 不知 noteCapability)
 *
 * 启动 race 处理:
 * - resolveNoteTitle 在 cache refresh 完成前调用 → 返回 null
 * - NodeView 切"未找到"态 (L5-B3.12 已支持)
 * - cache 拉到后 noteCapability 广播 onListChanged → cache 更新 → 后续渲染恢复
 *
 * 删除一致性:
 * noteCap().deleteNote 触发 onListChanged → cache refresh,自动清掉。
 */

import { requireCapabilityApi } from '@slot/capability-registry/get-capability-api';
import type { NoteCapabilityApi, NoteInfo } from '@capabilities/note/types';

function noteCap(): NoteCapabilityApi {
  return requireCapabilityApi<NoteCapabilityApi>('note');
}

let cache = new Map<string, { id: string; title: string }>();
let started = false;
let unsubscribe: (() => void) | null = null;

export function startNoteCache(): void {
  if (started) return;
  started = true;
  // 启动时拉一次
  void refresh();
  // 订阅后续变更 — onListChanged 推送增量 list,本地直接重建 Map
  unsubscribe = noteCap().onListChanged((list) => {
    rebuildCache(list);
  });
}

/** 主要给测试 / hot-reload 用,生产路径不调 */
export function stopNoteCache(): void {
  if (!started) return;
  unsubscribe?.();
  unsubscribe = null;
  started = false;
  cache = new Map();
}

async function refresh(): Promise<void> {
  try {
    const notes = await noteCap().listNotes();
    rebuildCache(notes);
  } catch (err) {
    console.warn('[note-cache] refresh failed:', err);
  }
}

function rebuildCache(notes: NoteInfo[]): void {
  cache = new Map(notes.map((n) => [n.id, { id: n.id, title: n.title }]));
}

export function getNoteTitle(noteId: string): string | null {
  return cache.get(noteId)?.title ?? null;
}

/** sync 诊断用 — 启动 cache 未就绪时返 0 (L5-alive 同步路径) */
export function getCachedNoteCount(): number {
  return cache.size;
}
