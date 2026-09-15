/**
 * `web.trace` 的落盘出口 —— **记录活过重启**
 *
 * 用户 2026-09-15:
 * > 「我建议这些数据应该记录到 log,这样你直接读取,
 * >   未来可能需要遥测的这些能力来发现并迭代 app 的。」
 *
 * ── 为什么非落盘不可 ──
 *
 * `TraceRecorder` 本身只记在内存里(四个数组 + 配额淘汰),
 * 而 `runtime.ts` 里 `new TraceRecorder()` **没传 sink** ——
 * 于是 `this.sink?.writeDegradation?.()` 是个空操作,**进程一关全没了**。
 * 「你直接读取」在重启后必然落空,遥测更无从谈起。
 *
 * ⚠️ 这是本会话第五次遇到同一形态:**建好了、测过了、没接线**
 * (`ready`/`scrollUntil` 没导出、`recordRequestStart` 零调用、
 *  两个引擎零 new、`TraceSink` 零实现)。
 *
 * ── 照搬 `FsRawSink` 已验证的做法,不另发明 ──
 *
 * ① **按天分片** `YYYY-MM-DD.jsonl` —— 清理是**删文件**,不是重写整个文件
 * ② 追加行**自带换行** —— 否则两条黏成一行,谁也解析不出来
 * ③ 读回时**坏行跳过并计数** —— 断电会截断最后一行,
 *    为一行坏数据丢掉整月记录不划算;但丢了多少必须说得出来
 * ④ `YYYY-MM-DD` 的**字典序就是时间序**,清理用字符串比较,不解析日期
 *
 * ── ⚠️ 敏感数据的分工(`03-observability.md` §4.4)──
 *
 * 底座**如实记录传进来的东西,不内置过滤规则**;
 * 「记什么、记多少」由调用方决定。控制台那边只传能力名/参数摘要/失败原因,
 * 不传页面正文 —— 那是**调用方**的选择,不是这里的规则。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { TraceSink } from '../trace/recorder';
import type {
  DegradationRecord, LifecycleRecord, NetworkTraceRecord, RecoveryRecord,
} from '../trace/types';

type StreamName = 'lifecycle' | 'network' | 'degradation' | 'recovery';

/** 一天一个分片。⚠️ 与 FsRawSink 同一口径 */
function shardName(ts: number): string {
  return `${new Date(ts).toISOString().slice(0, 10)}.jsonl`;
}

export class FsTraceSink implements TraceSink {
  constructor(private readonly root: string) {}

  private ensure(dir: string): void {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  /**
   * ⚠️ 写失败**不抛**。
   *
   * 与 `FsRawSink.writeBody` 相反,理由是两层的价值不同:
   * L-raw 少存一条就废了(它**就是**原始数据);
   * 而诊断留痕的第一原则是**自己绝不能成为故障源**
   * (`03-observability.md` §2「诊断只观察,不干预」)。
   * 磁盘满了就不该让一次导航跟着失败。
   *
   * ⭐ 但**不静默**:写失败本身 console.warn 一次,
   * 否则「记录怎么没了」又变成无从查起的事。
   */
  private append(stream: StreamName, record: { ts: number }): void {
    try {
      const dir = join(this.root, stream);
      this.ensure(dir);
      appendFileSync(join(dir, shardName(record.ts)), `${JSON.stringify(record)}\n`);
    } catch (err) {
      console.warn(`[web.trace] 落盘失败(${stream}):`,
        err instanceof Error ? err.message : String(err));
    }
  }

  writeLifecycle(record: LifecycleRecord): void { this.append('lifecycle', record); }
  writeNetwork(record: NetworkTraceRecord): void { this.append('network', record); }
  writeDegradation(record: DegradationRecord): void { this.append('degradation', record); }
  writeRecovery(record: RecoveryRecord): void { this.append('recovery', record); }

  /**
   * 读回某条流。**坏行跳过并计数**。
   *
   * @param sinceTs 只读这个时刻之后的分片(按天粒度,宁可多读一天)
   */
  read<T>(stream: StreamName, sinceTs?: number): { records: T[]; badLines: number } {
    const dir = join(this.root, stream);
    if (!existsSync(dir)) return { records: [], badLines: 0 };
    const cutoff = sinceTs !== undefined ? shardName(sinceTs) : '';
    const records: T[] = [];
    let badLines = 0;
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort()) {
      if (cutoff && f < cutoff) continue;
      const text = readFileSync(join(dir, f), 'utf-8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          records.push(JSON.parse(line) as T);
        } catch {
          badLines += 1;
        }
      }
    }
    return { records, badLines };
  }

  /**
   * ⭐ 删掉早于某天的整个分片 —— 配额与老化(`03-observability.md` §4.3:
   * 「V2 跑在用户机器上,**必须有配额**。否则诊断模块自己变成故障源」)。
   *
   * ⚠️ **各条流保留期不同**(§3.2):
   * lifecycle / network 是**高频流水**,留几天就够;
   * degradation 是**低频高价值**,要留得久 —— 它回答的是
   * 「这类 bug 发生过多少次」,一周就清等于把趋势删了。
   *
   * 所以这里按流分别给 cutoff,**不做一刀切** ——
   * 一刀切要么把故障史误删,要么让流水把磁盘吃满。
   */
  dropShardsBefore(cutoffs: Partial<Record<StreamName, number>>): number {
    let dropped = 0;
    for (const [stream, cutoffTs] of Object.entries(cutoffs) as Array<[StreamName, number]>) {
      const dir = join(this.root, stream);
      if (!existsSync(dir)) continue;
      const cutoffName = shardName(cutoffTs);
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsonl'))) {
        // ⚠️ 字典序即时间序,不解析日期
        if (f < cutoffName) {
          rmSync(join(dir, f), { force: true });
          dropped += 1;
        }
      }
    }
    return dropped;
  }

  /** 各条流当前有几个分片 —— 给健康看板对账 */
  shardCounts(): Record<StreamName, number> {
    const out = { lifecycle: 0, network: 0, degradation: 0, recovery: 0 };
    for (const stream of Object.keys(out) as StreamName[]) {
      const dir = join(this.root, stream);
      if (!existsSync(dir)) continue;
      out[stream] = readdirSync(dir).filter((n) => n.endsWith('.jsonl')).length;
    }
    return out;
  }
}
