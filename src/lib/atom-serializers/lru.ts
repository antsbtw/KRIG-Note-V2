/**
 * 简单 LRU 缓存：基于 JS Map 的插入顺序特性。
 *
 * 操作：
 * - get: 命中时刷新到末尾（最近使用），未命中返回 undefined
 * - set: 已存在则更新并刷新，否则插入末尾；超容量淘汰队首
 * - delete / clear: 清理
 *
 * 不做命中率统计、不做 TTL；spec § 5.1 要求的指标在外部聚合。
 */
export class LruCache<K, V> {
  private map = new Map<K, V>();

  hits = 0;
  misses = 0;

  constructor(public readonly capacity: number) {}

  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) {
      this.misses++;
      return undefined;
    }
    // 刷新到末尾
    this.map.delete(key);
    this.map.set(key, v);
    this.hits++;
    return v;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      // 淘汰队首（最久未用）
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
    this.hits = 0;
    this.misses = 0;
  }

  get size(): number {
    return this.map.size;
  }

  hitRate(): number {
    const total = this.hits + this.misses;
    return total === 0 ? 0 : this.hits / total;
  }

  /** 遍历淘汰回调（如有需要清理 value 的副作用，比如 dispose 几何） */
  *values(): IterableIterator<V> {
    yield* this.map.values();
  }
}
