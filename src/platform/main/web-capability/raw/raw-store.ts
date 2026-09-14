/**
 * L-raw 仓库 —— 存得住、查得回、清得掉、不撑爆(`01-contract.md` §13)
 *
 * ── 分层:纯逻辑与落盘分离(仿 `trace/recorder.ts` 的 `TraceSink`)──
 *
 * 本文件是**纯逻辑**:零 `fs`、零 `electron`,可完全单测。
 * 真正的磁盘读写由可插拔的 `RawSink` 承担,接线时接真 fs(`wiring/`)。
 * 守卫 `page-boundary-guard.test.ts` 扫本层禁 electron —— 这个分层正是它要的。
 *
 * ⚠️ **代价说明白**:没接 sink 时,记录只在内存里,**进程一关就没** ——
 * 那正是现状(`net/bus.ts` 的 `MAX_RESPONSE_BODIES = 256`,很快被冲掉)。
 * 本步交付「能存、能查、能清、能看占用」这一半,真落盘要接线才补上。
 *
 * ── ⭐⭐ 本层最要紧的一条原则(§13.1)──
 *
 * > **缓存层无条件、无分支地收下一切。**
 *
 * 用户原话:「缓存就是大海,我们要从里面获取需要的东西可能是少量,
 * **但是不要把业务逻辑搞复杂影响可靠性。**」
 *
 * 所以 `put()` 里**没有一处** `if (mechanism === ...)` 的分支。
 * 初稿曾想「M4 不存」以省空间,被否决:那要每个调用点判断自己属于哪类,
 * **判断错就丢数据**。存储端加判断 = 拿可靠性换空间,而空间恰是最不稀缺的。
 * 有一条守卫扫死这件事。
 */

import { type Failed, type Ok, type Result, degraded, failed, ok } from '../result';
import type {
  CaptureMechanism,
  RawHydrateInput,
  RawHydrateReport,
  RawIndexEntry,
  RawPurgeFilter,
  RawPurgeReport,
  RawQuery,
  RawQuota,
  RawUsage,
  RawWriteInput,
} from './types';

/** 默认保留 1 个月(§13.1 用户已定) */
export const DEFAULT_RETENTION_DAYS = 30;
/**
 * ⭐ 默认体积上限 **8 GiB** —— 宽松。
 *
 * §13.1:「⭐ 用户可配,**不写死上限**」。这里的 8GiB 不是「上限」而是
 * **默认值**,用户可改(含改成 `Infinity`)。给一个默认是因为
 * 「不设上限」≠「不管」:磁盘将满时要**告警**,而告警需要一个参照。
 */
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024 * 1024;
/** 单条 body 默认上限 32 MiB。超限**截断并标注**,不静默丢整条 */
export const DEFAULT_MAX_BODY_BYTES = 32 * 1024 * 1024;
/** 占用超过 90% 告警 */
export const DEFAULT_WARN_RATIO = 0.9;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 落盘出口。⚠️ 本步**不实现任何真 fs 版本**,只留接口 —— 与 `TraceSink` 同款。
 *
 * ⭐ 写失败**必须抛**:仓库据此回三态 `Failed`。
 * 返回 void 并吞掉错误,就会出现「以为存了、其实没存」——
 * 而这一层的全部价值就是「一个月后还找得回来」,存不进去却说存了,
 * 比不存更坏(它让人放心地删掉了业务表)。
 */
export interface RawSink {
  /** 写一条 body。`ref` 是本层分配的句柄 */
  writeBody(ref: string, bytes: Uint8Array): void;
  /** 追加一条索引 */
  appendIndex(entry: RawIndexEntry): void;
  /** 删若干条(清理用)。返回实际删掉的 ref */
  removeMany?(refs: readonly string[]): void;
  /** 读回 body。取不到返回 undefined(**不抛** —— 「没有」不是「坏了」) */
  readBody?(ref: string): Uint8Array | undefined;
}

export type RawStoreOptions = {
  readonly quota?: RawQuota;
  readonly sink?: RawSink;
  readonly now?: () => number;
};

let refCounter = 0;

export class RawStore {
  private readonly quota: Required<RawQuota>;
  private readonly sink?: RawSink;
  private readonly now: () => number;

  /** 索引:ref → entry。插入序即时间序(单调时钟下) */
  private readonly index = new Map<string, RawIndexEntry>();
  /** 内存里的 body(没接 sink 时的唯一去处) */
  private readonly bodies = new Map<string, Uint8Array>();
  private totalBytes = 0;

  /**
   * ⭐ 因配额被淘汰的条数 —— **必须可见**。
   * 否则「记录丢了」这件事本身就是静默的(与 `TraceRecorder.dropped` 同理)。
   */
  private evicted = { entries: 0, bytes: 0 };

  constructor(options: RawStoreOptions = {}) {
    this.quota = {
      retentionDays: options.quota?.retentionDays ?? DEFAULT_RETENTION_DAYS,
      maxBytes: options.quota?.maxBytes ?? DEFAULT_MAX_BYTES,
      maxBodyBytes: options.quota?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
      warnRatio: options.quota?.warnRatio ?? DEFAULT_WARN_RATIO,
    };
    this.sink = options.sink;
    this.now = options.now ?? Date.now;
  }

  /**
   * ⭐⭐ 收下一条原始载荷。**无条件、无分支** —— M1..M8 一视同仁。
   *
   * ⚠️ 这个方法里**不许出现**任何 `if (mechanism === ...)`。
   * 有守卫扫死;真要区别对待,那是**调用方**的判断,不是存储端的。
   */
  put(input: RawWriteInput): Result<RawIndexEntry> {
    const host = parseHost(input.url);
    if (host.status !== 'ok') return host;

    const originalBytes = input.body.byteLength;

    // ⭐ 超限截断**要标注**(§8 验收:不许静默截断)
    let stored = input.body;
    let truncated = false;
    if (originalBytes > this.quota.maxBodyBytes) {
      stored = input.body.subarray(0, this.quota.maxBodyBytes);
      truncated = true;
    }

    const ref = mintRef();
    const entry: RawIndexEntry = {
      ref,
      ts: input.ts ?? this.now(),
      host: host.value,
      url: input.url,
      pageId: input.pageId,
      mechanism: input.mechanism,
      // ⚠️ 没有 HTTP 状态的机制(M4/M7/M8)**留空**,不伪造 200 ——
      //    伪造会让「这条没有状态」和「这条真的是 200」永远分不开
      ...(input.status !== undefined ? { status: input.status } : {}),
      // ⭐ bytes 记**原始**大小:回放时才知道「本来有多大、被截了多少」
      bytes: originalBytes,
      ...(input.method !== undefined ? { method: input.method } : {}),
      ...(input.mimeType !== undefined ? { mimeType: input.mimeType } : {}),
      ...(input.requestHeaders !== undefined ? { requestHeaders: input.requestHeaders } : {}),
      ...(input.responseHeaders !== undefined ? { responseHeaders: input.responseHeaders } : {}),
      ...(truncated ? { truncated: true, storedBytes: stored.byteLength } : {}),
    };

    // ── 落盘。⚠️ 写失败 fail loud,**绝不吞** ──
    if (this.sink) {
      try {
        this.sink.writeBody(ref, stored);
        this.sink.appendIndex(entry);
      } catch (err) {
        // 「以为存了、其实没存」比不存更坏 —— 它让人放心地删掉了业务表
        return failed(
          `L-raw 落盘失败(${input.url}): ${err instanceof Error ? err.message : String(err)}`,
          true,
        );
      }
    }

    this.index.set(ref, entry);
    this.bodies.set(ref, stored);
    this.totalBytes += stored.byteLength;

    // 体积配额:淘汰最旧的,直到回到上限内
    this.enforceMaxBytes();

    return ok(entry);
  }

  /**
   * ⭐⭐ 重启后把盘上的索引装回内存(§15.1 第 2 条)。
   *
   * ── 为什么非有不可 ──
   *
   * `FsRawSink.loadIndex()` 早就有,也有测试;缺的是**把 entries 交还给仓库的入口** ——
   * 本类的三个私有状态(`index`/`bodies`/`totalBytes`)此前**只能由 `put` 填充**。
   * 于是重启后 `query()` 恒空:**东西在盘上,但查不回来**,
   * 而这一层的全部价值就是「一个月后还找得回来」。
   *
   * ⚠️ 现有那条「关掉进程再起来仍查得回」的端到端测试**绕过了本类**
   * (它直接 `new FsRawSink().loadIndex()` 再 `sink.readBody()` 自己断言),
   * 所以它验证的是 sink 层、不是仓库层 —— 真实启动路径(业务调 `query()`)
   * 在重启后返回空,那条测试永远不会红。守卫必须走**公开面**,见 `raw-hydrate.test.ts`。
   *
   * ── 五条裁定(都要能被守卫打红)──
   *
   * ① **`badLines > 0` → `Degraded`,不吞也不炸**:为一行坏数据丢掉整月索引不划算
   *    (`loadIndex` 自己的注释),但丢了多少必须说得出来。这正是三态里
   *    `Degraded` 的定义场景 ——「当 Ok 是撒谎,当 Failed 是冤枉」。
   * ② ⚠️ **字节数按落盘口径算**:`entry.bytes` 是**原始**大小,截断时盘上只有
   *    `storedBytes`。而 `usage().bytes` 的语义是「实际落盘字节数(截断后的)」。
   *    直接累加 `bytes` 会让占用**虚高** → 触发不该触发的配额淘汰 →
   *    **把没过期的数据删掉**。这个 bug 只在「有截断条目 + 接近配额」时现形,极难复现。
   * ③ **只恢复索引,不预加载 body**:body 可能有几个 GB,全读进内存等于把磁盘搬进 RAM。
   *    `body(ref)` 本就有回落路径(内存未命中 → `sink.readBody`),代价只是首次取要走一次磁盘。
   * ④ **只许在空库时调**:重复 hydrate 会让 `totalBytes` 翻倍。「启动时调一次」是唯一
   *    合法用法,所以把非法用法变成**明确失败**,而不是靠注释约定。
   * ⑤ **ref 撞了 fail loud**:`mintRef()` 的进程内计数器重启后归零,理论上可能与盘上
   *    已有 ref 相撞。撞了就停,**绝不覆盖** —— 覆盖会让两条不同的记录共用一个句柄。
   *
   * ⚠️ `evicted` **有意不跨重启累计**:它的语义是「本次运行淘汰了多少」,
   * 跨重启累计既无意义也无处存。保持归零 —— 这是裁定,不是漏做。
   */
  hydrate(input: RawHydrateInput): Result<RawHydrateReport> {
    // ④ 非空库拒绝 —— 重复调会让 totalBytes 翻倍
    if (this.index.size > 0) {
      return failed(
        `L-raw 已有 ${this.index.size} 条索引,拒绝重复 hydrate` +
          `(重复装载会让占用统计翻倍 → 触发误淘汰)。hydrate 只该在启动时调一次。`,
        false,
      );
    }

    let bytes = 0;
    for (const entry of input.entries) {
      // ⑤ 撞 ref 就停,不覆盖
      if (this.index.has(entry.ref)) {
        return failed(
          `L-raw 索引里 ref 重复: ${entry.ref} —— 盘上的索引可能被污染,` +
            `绝不覆盖(两条记录共用一个句柄会让 body 取回错的那条)。`,
          false,
        );
      }
      this.index.set(entry.ref, entry);
      // ② 落盘口径:截断的按 storedBytes 算,不是原始 bytes
      bytes += entry.truncated ? (entry.storedBytes ?? 0) : entry.bytes;
    }
    this.totalBytes = bytes;

    const report: RawHydrateReport = {
      restored: this.index.size,
      bytes,
      badLines: input.badLines,
    };

    // ① 坏行要如实说 —— 不吞(说成 Ok 是撒谎),也不整体失败(说成 Failed 是冤枉)
    if (input.badLines > 0) {
      return degraded(report, [
        `索引分片有 ${input.badLines} 行损坏,已跳过` +
          `(多半是上次非正常退出时追加写被截断;这些记录的 body 仍在盘上但已查不到)`,
      ]);
    }

    return ok(report);
  }

  /**
   * 取回 body。
   *
   * ⚠️ 取不到返回 `Failed` 而不是空数组 —— 空数组会被解析器当成
   * 「响应是空的」,于是「数据已被清掉」表现为「站点返回了空」,
   * 排查方向完全指错。
   */
  body(ref: string): Result<Uint8Array> {
    const inMemory = this.bodies.get(ref);
    if (inMemory) return ok(inMemory);
    const fromSink = this.sink?.readBody?.(ref);
    if (fromSink) return ok(fromSink);
    return failed(`L-raw 里没有 ${ref}(已过期清理 / 从未写入?)`, false);
  }

  /**
   * ⭐ 按七个字段查。**如实返回全部命中,不排序择优**
   * —— 与 `web.page` 的 `find` 同源:底座不替调用方挑。
   */
  query(q: RawQuery = {}): RawIndexEntry[] {
    const out: RawIndexEntry[] = [];
    for (const e of this.index.values()) {
      if (q.since !== undefined && e.ts < q.since) continue;
      if (q.until !== undefined && e.ts > q.until) continue;
      if (q.host !== undefined && e.host !== q.host) continue;
      if (q.urlIncludes !== undefined && !e.url.includes(q.urlIncludes)) continue;
      if (q.pageId !== undefined && e.pageId !== q.pageId) continue;
      if (q.mechanism !== undefined && e.mechanism !== q.mechanism) continue;
      if (q.status !== undefined && e.status !== q.status) continue;
      if (q.minBytes !== undefined && e.bytes < q.minBytes) continue;
      if (q.maxBytes !== undefined && e.bytes > q.maxBytes) continue;
      out.push(e);
      // ⚠️ limit 只截断,不改变「先来先出」的顺序 —— 不做任何择优
      if (q.limit !== undefined && out.length >= q.limit) break;
    }
    return out;
  }

  /** 单条取索引。取不到 `Failed`,不返回 null */
  entry(ref: string): Result<RawIndexEntry> {
    const e = this.index.get(ref);
    if (!e) return failed(`L-raw 索引里没有 ${ref}`, false);
    return ok(e);
  }

  /**
   * ⭐ 当前占用(§13.1「不设上限」≠「不管」)。
   * 用户要据此决定配多少,所以这个必须报得出来。
   */
  usage(): RawUsage {
    let oldestTs: number | undefined;
    let newestTs: number | undefined;
    for (const e of this.index.values()) {
      if (oldestTs === undefined || e.ts < oldestTs) oldestTs = e.ts;
      if (newestTs === undefined || e.ts > newestTs) newestTs = e.ts;
    }
    return {
      entries: this.index.size,
      bytes: this.totalBytes,
      ...(oldestTs !== undefined ? { oldestTs } : {}),
      ...(newestTs !== undefined ? { newestTs } : {}),
      maxBytes: this.quota.maxBytes,
      retentionDays: this.quota.retentionDays,
      // ⚠️ 「将满时告警,不是静默写爆」
      overWarnThreshold:
        Number.isFinite(this.quota.maxBytes) &&
        this.totalBytes >= this.quota.maxBytes * this.quota.warnRatio,
    };
  }

  /** 被配额淘汰掉了多少 —— 可见,不静默 */
  evictedStats(): { entries: number; bytes: number } {
    return { ...this.evicted };
  }

  /**
   * ⭐ 按保留期清理过期数据。
   *
   * ⚠️ 判据是「**早于** cutoff 的清掉」。写反一个字(`>` 写成 `<`)
   * 就会把**刚存的清掉、把过期的留下** —— 有一条守卫专门注入这个。
   */
  purgeExpired(): RawPurgeReport {
    const cutoff = this.now() - this.quota.retentionDays * MS_PER_DAY;
    return this.purge({ olderThan: cutoff });
  }

  /**
   * 按条件清理。不给任何条件 = **全清**(一键清除)。
   *
   * ⚠️ 清理时请求头一并清掉 —— §13.1:「不外发、不上报、**清理时一并清**」。
   * 这是自然成立的(整条 entry 都删了),但值得写明:
   * 若将来改成「只删 body 留索引」,token 就会留在盘上。
   */
  purge(filter: RawPurgeFilter = {}): RawPurgeReport {
    const doomed: string[] = [];
    for (const e of this.index.values()) {
      // ⭐ 「早于 cutoff」才清。之内的一条都不许误伤
      if (filter.olderThan !== undefined && e.ts >= filter.olderThan) continue;
      if (filter.host !== undefined && e.host !== filter.host) continue;
      if (filter.pageId !== undefined && e.pageId !== filter.pageId) continue;
      doomed.push(e.ref);
    }
    return this.removeRefs(doomed);
  }

  /** 体积配额:超了就淘汰最旧的(Map 迭代序即插入序) */
  private enforceMaxBytes(): void {
    if (!Number.isFinite(this.quota.maxBytes)) return;
    while (this.totalBytes > this.quota.maxBytes && this.index.size > 0) {
      const oldest = this.index.keys().next().value;
      if (oldest === undefined) break;
      const report = this.removeRefs([oldest]);
      // ⭐ 淘汰要可见 —— 否则「数据怎么少了」无从查起
      this.evicted.entries += report.removedEntries;
      this.evicted.bytes += report.removedBytes;
    }
  }

  private removeRefs(refs: readonly string[]): RawPurgeReport {
    let removedBytes = 0;
    let removedEntries = 0;
    for (const ref of refs) {
      const body = this.bodies.get(ref);
      if (body) {
        removedBytes += body.byteLength;
        this.bodies.delete(ref);
      }
      if (this.index.delete(ref)) removedEntries += 1;
    }
    this.totalBytes -= removedBytes;
    if (this.totalBytes < 0) this.totalBytes = 0;
    if (refs.length > 0) {
      // sink 侧同步删。⚠️ 删失败**不吞**:留在盘上的孤儿会让占用统计说谎
      this.sink?.removeMany?.(refs);
    }
    return { removedEntries, removedBytes };
  }
}

/**
 * 从 URL 解析 host。
 *
 * ⚠️ **由本层解析,不让调用方传**:传错了索引就查不着,
 * 而这种错不会报任何异常 —— 只会在一个月后「怎么查不到」时才发现。
 *
 * 解析不出来**返回 Failed**,不退成空串:空 host 会让这条记录
 * 在按 host 查时永远查不到,等于存了个查不回的东西。
 */
function parseHost(url: string): Ok<string> | Failed {
  try {
    const h = new URL(url).host;
    if (!h) return failed(`URL 没有 host: ${url}`, false);
    return ok(h);
  } catch {
    return failed(`URL 解析不出 host: ${url}`, false);
  }
}

function mintRef(): string {
  refCounter += 1;
  return `raw_${Date.now().toString(36)}_${refCounter.toString(36)}`;
}

export type { CaptureMechanism };
