/**
 * L-raw 的真 fs 落盘 —— 唯一碰磁盘的地方(`01-contract.md` §13.1)
 *
 * ⭐ 能力层(`raw/raw-store.ts`)是纯逻辑:它只知道有个 `RawSink`。
 * 真正的 `fs` 调用收口在这一个文件里,与 `TraceSink` / `web.dom` 同一手法。
 *
 * ⚠️ **本步不接任何消费者** —— 这个类建好但没人 new 它,
 * app 行为与开工前完全一致(`09-history.md` §1.1「只加不改」)。
 *
 * ── ⭐ 索引为什么是「按天分片的 JSONL 追加写」 ──
 *
 * 拿现有真实数字估:X 一次 GraphQL 响应含数十条推,一天几百到几千个响应,
 * 一个月约 **6000 ~ 60000 条**索引,每条 ~200 字节 JSON ≈ **12MB**。
 *
 * | 方案 | 问题 |
 * |---|---|
 * | 单文件全量重写 | 每次写盘 12MB,一天上千次 —— **不可接受** |
 * | 单文件追加 | 写是 O(1),但**清理要重写整个文件**(12MB),且重写中途崩 = 索引全毁 |
 * | ⭐ **按天分片 + 追加** | 写 O(1);**清理 = 删掉整个分片文件**,不重写、崩了也只影响那天 |
 *
 * 过期清理正好按天走(保留 30 天 = 留最近 30 个分片),**天然对齐**。
 *
 * ⚠️ 没上 SQLite:§13.1 明确「存硬盘,**不进 SurrealDB**」,
 * 而为一个「大海」再引一个数据库依赖,与「不要把逻辑搞复杂影响可靠性」相悖。
 * 代价说明白:**按非时间字段查要扫分片**。可接受 ——
 * 排查场景本就是「先圈时间范围,再按 host/URL 找」,与 Chrome DevTools 同款。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RawIndexEntry } from '../raw/types';
import type { RawSink } from '../raw';

/** 一天一个索引分片:`index/YYYY-MM-DD.jsonl` */
function shardName(ts: number): string {
  return `${new Date(ts).toISOString().slice(0, 10)}.jsonl`;
}

/**
 * body 分两级目录存(`bodies/ab/raw_xxx.bin`)。
 *
 * ⚠️ 平铺几万个文件会让某些文件系统的目录遍历变得极慢 ——
 * 而「列出所有 body」正是清理时要做的事。
 */
function bodyPathOf(root: string, ref: string): { dir: string; file: string } {
  const bucket = ref.slice(-2);
  const dir = join(root, 'bodies', bucket);
  return { dir, file: join(dir, `${ref}.bin`) };
}

export class FsRawSink implements RawSink {
  constructor(private readonly root: string) {}

  private ensure(dir: string): void {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  /**
   * ⚠️ 写失败**直接抛** —— `RawStore` 据此回三态 `Failed`。
   * 这里 catch 掉就会出现「以为存了、其实没存」,
   * 而这一层的全部价值就是「一个月后还找得回来」。
   */
  writeBody(ref: string, bytes: Uint8Array): void {
    const { dir, file } = bodyPathOf(this.root, ref);
    this.ensure(dir);
    writeFileSync(file, bytes);
  }

  appendIndex(entry: RawIndexEntry): void {
    const dir = join(this.root, 'index');
    this.ensure(dir);
    // ⭐ 追加一行 JSON。⚠️ 必须自带换行,否则两条会黏成一行 —— 那一行谁也解析不出来
    appendFileSync(join(dir, shardName(entry.ts)), `${JSON.stringify(entry)}\n`);
  }

  removeMany(refs: readonly string[]): void {
    for (const ref of refs) {
      const { file } = bodyPathOf(this.root, ref);
      // ⚠️ 已经不在了不算错(force),但**别的错要抛** —— 删不掉的孤儿会让占用统计说谎
      rmSync(file, { force: true });
    }
  }

  readBody(ref: string): Uint8Array | undefined {
    const { file } = bodyPathOf(this.root, ref);
    // ⚠️ 「没有」返回 undefined 而不是抛 —— 过期清理掉是正常的,不是故障
    if (!existsSync(file)) return undefined;
    return new Uint8Array(readFileSync(file));
  }

  /**
   * 读回全部索引(重启后重建内存索引用)。
   *
   * ⚠️ **坏行跳过并计数,不静默丢也不整体失败**:
   * 追加写的最后一行可能因断电而截断,为一行坏数据丢掉整个月的索引不划算;
   * 但丢了多少必须说得出来 —— 否则「索引怎么少了」无从查起。
   */
  loadIndex(): { entries: RawIndexEntry[]; badLines: number } {
    const dir = join(this.root, 'index');
    if (!existsSync(dir)) return { entries: [], badLines: 0 };
    const entries: RawIndexEntry[] = [];
    let badLines = 0;
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsonl')).sort()) {
      const text = readFileSync(join(dir, f), 'utf-8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line) as RawIndexEntry);
        } catch {
          badLines += 1;
        }
      }
    }
    return { entries, badLines };
  }

  /**
   * ⭐ 删掉早于某天的整个分片 —— 过期清理的快路径。
   *
   * 这是「按天分片」的全部意义:清理是**删文件**,不是重写 12MB 的索引。
   */
  dropShardsBefore(cutoffTs: number): number {
    const dir = join(this.root, 'index');
    if (!existsSync(dir)) return 0;
    const cutoffName = shardName(cutoffTs);
    let dropped = 0;
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.jsonl'))) {
      // ⚠️ 用**字符串比较**:`YYYY-MM-DD` 的字典序就是时间序,不用解析日期
      if (f < cutoffName) {
        rmSync(join(dir, f), { force: true });
        dropped += 1;
      }
    }
    return dropped;
  }

  /** 磁盘上真实占用(用于对账内存统计有没有说谎) */
  diskBytes(): number {
    const bodiesDir = join(this.root, 'bodies');
    if (!existsSync(bodiesDir)) return 0;
    let total = 0;
    for (const bucket of readdirSync(bodiesDir)) {
      const bd = join(bodiesDir, bucket);
      if (!statSync(bd).isDirectory()) continue;
      for (const f of readdirSync(bd)) total += statSync(join(bd, f)).size;
    }
    return total;
  }
}
