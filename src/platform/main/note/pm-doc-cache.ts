/**
 * pm-doc-cache — L7 block atomization Stage 2 Step 2.4
 *
 * 进程内 in-memory cache:containerId → 上次 assemble / update 的 PmPayload。
 *
 * 实施依据:
 * - decision 026 §8.1 capability 层 in-memory PM-doc 缓存(拍板方案 A)
 * - decision 026 §8.4 cache invalidation 规则:
 *   - 进程生命周期内 capability 自管
 *   - updateNote / deleteNote 同步更新
 *   - 跨进程不在本 sub-phase 范围(单窗口编辑同 note 字面假设)
 * - decision 026 §13.4 LRU eviction 临时默认不加(v1)
 *
 * 关键:
 * - cache key = containerId(同时容纳 note / reading-thought,详 D-10)
 * - cache 值是完整 PmPayload(已重建中间 wrapper),作为下次 diff 的 oldDoc 基准
 * - **不要**把 PmPayload 引用直接外传 —— 调用方修改 cache 内对象会污染基线
 *   (capability 内部一律传 deep-copy 或 freeze)
 */

import type { PmPayload } from '@semantic/types';

class PmDocCache {
  private cache = new Map<string, PmPayload>();

  /** 字面读 — 拿到的引用调用方**不应**直接修改(违反字面会污染下次 diff 基线)*/
  get(containerId: string): PmPayload | undefined {
    return this.cache.get(containerId);
  }

  /** 字面写 — capability 字面在 update / getNote 拼装成功后调一次 */
  set(containerId: string, doc: PmPayload): void {
    this.cache.set(containerId, doc);
  }

  /** deleteNote / 数据库 reset 时字面调 */
  invalidate(containerId: string): void {
    this.cache.delete(containerId);
  }

  /** 字面清空(测试 / migration 用)*/
  clear(): void {
    this.cache.clear();
  }

  /** 字面诊断 — 当前缓存了多少 container(性能 Stage 8 监控用)*/
  size(): number {
    return this.cache.size;
  }
}

export const pmDocCache = new PmDocCache();
