/**
 * ⭐ L-raw 的真 fs 落盘 —— 按天分片的 JSONL 追加写
 *
 * ⚠️ 这个文件用**真磁盘**(临时目录),不 mock fs:
 * 「追加写会不会把两条黏成一行」「清理会不会删错分片」这类问题,
 * mock 掉 fs 就测不出来了 —— 而它们恰恰是这一层唯一会出的错。
 *
 * ── 索引为什么按天分片(见 `wiring/fs-raw-sink.ts` 文件头)──
 * 一个月约 6000~60000 条索引 ≈ 12MB。
 * 单文件全量重写 = 一天上千次写 12MB,不可接受;
 * 单文件追加 = 写快,但**清理要重写整个文件**,重写中途崩 = 索引全毁。
 * 按天分片 + 追加:写 O(1),**清理 = 删掉整个分片文件**。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FsRawSink } from '@platform/main/web-capability/wiring/fs-raw-sink';
import { RawStore } from '@platform/main/web-capability/raw';
import type { RawIndexEntry } from '@platform/main/web-capability/raw';
import { isFailed, isOk } from '@platform/main/web-capability';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 9, 12, 0, 0);

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'lraw-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function entry(over: Partial<RawIndexEntry> = {}): RawIndexEntry {
  return {
    ref: 'raw_a1', ts: T0, host: 'x.com', url: 'https://x.com/a',
    pageId: 'p1', mechanism: 'M1', status: 200, bytes: 10, ...over,
  };
}

describe('⭐ body 落盘与读回', () => {
  it('写进去能原样读回来', () => {
    const sink = new FsRawSink(root);
    const payload = new TextEncoder().encode('{"data":"hello 中文"}');
    sink.writeBody('raw_x1', payload);
    const got = sink.readBody('raw_x1');
    expect(got).toBeDefined();
    expect(new TextDecoder().decode(got!)).toBe('{"data":"hello 中文"}');
  });

  it('⭐ 读不存在的返回 undefined 而**不抛**(过期清理掉是正常的,不是故障)', () => {
    const sink = new FsRawSink(root);
    expect(() => sink.readBody('raw_nope')).not.toThrow();
    expect(sink.readBody('raw_nope')).toBeUndefined();
  });

  it('⭐ body 分两级目录(平铺几万个文件会让清理时的目录遍历极慢)', () => {
    const sink = new FsRawSink(root);
    sink.writeBody('raw_aaaa_zz', new Uint8Array([1]));
    // bodies/<末两位>/<ref>.bin
    expect(existsSync(join(root, 'bodies', 'zz', 'raw_aaaa_zz.bin'))).toBe(true);
  });

  it('⭐ 写盘失败会**抛**(RawStore 据此回 Failed,不静默)', () => {
    // 用一个不可能创建的路径:根目录下的不可写位置
    const sink = new FsRawSink('/proc/nonexistent-lraw-root');
    expect(() => sink.writeBody('raw_x', new Uint8Array([1]))).toThrow();
  });
});

describe('⭐⭐ 索引:按天分片 + 追加写', () => {
  it('⭐ 同一天的多条追加进**同一个**分片,一行一条', () => {
    const sink = new FsRawSink(root);
    sink.appendIndex(entry({ ref: 'raw_1', ts: T0 }));
    sink.appendIndex(entry({ ref: 'raw_2', ts: T0 + 1000 }));
    sink.appendIndex(entry({ ref: 'raw_3', ts: T0 + 2000 }));

    const shards = readdirSync(join(root, 'index'));
    expect(shards).toEqual(['2026-09-09.jsonl']);

    const text = readFileSync(join(root, 'index', '2026-09-09.jsonl'), 'utf-8');
    const lines = text.split('\n').filter(Boolean);
    // ⭐⭐ 三行,不是黏成一行 —— 少了换行的话这里会是 1
    expect(lines.length).toBe(3);
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
    expect(lines.map((l) => JSON.parse(l).ref)).toEqual(['raw_1', 'raw_2', 'raw_3']);
  });

  it('⭐ 不同天进不同分片', () => {
    const sink = new FsRawSink(root);
    sink.appendIndex(entry({ ref: 'raw_1', ts: T0 }));
    sink.appendIndex(entry({ ref: 'raw_2', ts: T0 - MS_PER_DAY }));
    sink.appendIndex(entry({ ref: 'raw_3', ts: T0 - 2 * MS_PER_DAY }));
    expect(readdirSync(join(root, 'index')).sort()).toEqual([
      '2026-09-07.jsonl', '2026-09-08.jsonl', '2026-09-09.jsonl',
    ]);
  });

  it('⭐ 全部读回来(重启后重建内存索引)—— 跨分片 + 同分片都要覆盖', () => {
    // ⚠️ 这条是注入实验补的:第一版只写了**两个不同天**的记录,
    //    于是每个分片各只有一行 —— 注入「少写换行」时它照样绿,
    //    因为「两条黏成一行」在一行一片的场景里根本不会发生。
    //    必须让**同一分片里有多条**,才测得到追加写的正确性。
    const sink = new FsRawSink(root);
    sink.appendIndex(entry({ ref: 'raw_1', ts: T0 - MS_PER_DAY, host: 'a.test' }));
    sink.appendIndex(entry({ ref: 'raw_2', ts: T0, host: 'b.test' }));
    sink.appendIndex(entry({ ref: 'raw_3', ts: T0 + 1000, host: 'c.test' }));  // 与 raw_2 同一天
    const { entries, badLines } = sink.loadIndex();
    expect(entries.length).toBe(3);
    expect(badLines).toBe(0);
    // 分片按名排序 = 时间序;同分片内按追加序
    expect(entries.map((e) => e.ref)).toEqual(['raw_1', 'raw_2', 'raw_3']);
    // 七个字段都完整落盘了
    expect(entries[1]).toMatchObject({ host: 'b.test', url: 'https://x.com/a', pageId: 'p1', mechanism: 'M1', status: 200, bytes: 10 });
    expect(entries[2].host, '同分片的第二条也要完整读回').toBe('c.test');
  });

  it('⭐⭐ 坏行跳过并**计数**,不静默丢也不整体失败', () => {
    // 追加写的最后一行可能因断电而截断。为一行坏数据丢掉整月索引不划算,
    // 但丢了多少必须说得出来 —— 否则「索引怎么少了」无从查起。
    const sink = new FsRawSink(root);
    sink.appendIndex(entry({ ref: 'raw_1' }));
    // 手动追加一行断电截断的残行
    const shard = join(root, 'index', '2026-09-09.jsonl');
    writeFileSync(shard, readFileSync(shard, 'utf-8') + '{"ref":"raw_2","ts":17\n');
    sink.appendIndex(entry({ ref: 'raw_3' }));

    const { entries, badLines } = sink.loadIndex();
    expect(entries.map((e) => e.ref), '好行照常读回').toEqual(['raw_1', 'raw_3']);
    expect(badLines, '坏了几行必须说得出来').toBe(1);
  });

  it('索引目录不存在时返回空,不抛(首次启动)', () => {
    const sink = new FsRawSink(root);
    expect(sink.loadIndex()).toEqual({ entries: [], badLines: 0 });
  });
});

describe('⭐⭐ 过期清理:删整片,且不误伤', () => {
  it('⭐⭐ 删掉早于 cutoff 的分片,cutoff 当天及之后的**留下**', () => {
    const sink = new FsRawSink(root);
    for (const d of [40, 31, 30, 29, 0]) {
      sink.appendIndex(entry({ ref: `raw_${d}`, ts: T0 - d * MS_PER_DAY }));
    }
    expect(readdirSync(join(root, 'index')).length).toBe(5);

    const dropped = sink.dropShardsBefore(T0 - 30 * MS_PER_DAY);

    expect(dropped, '只有 40 天前和 31 天前那两片该删').toBe(2);
    const left = readdirSync(join(root, 'index')).sort();
    // ⭐⭐ 反向断言:该留的**真的还在**
    expect(left.length).toBe(3);
    const { entries } = sink.loadIndex();
    expect(entries.map((e) => e.ref).sort()).toEqual(['raw_0', 'raw_29', 'raw_30']);
  });

  it('⭐ 用字典序比日期(YYYY-MM-DD 的字典序就是时间序)—— 跨月也对', () => {
    const sink = new FsRawSink(root);
    const oct1 = Date.UTC(2026, 9, 1, 12);
    const sep30 = Date.UTC(2026, 8, 30, 12);
    const sep9 = Date.UTC(2026, 8, 9, 12);
    sink.appendIndex(entry({ ref: 'oct', ts: oct1 }));
    sink.appendIndex(entry({ ref: 'sep30', ts: sep30 }));
    sink.appendIndex(entry({ ref: 'sep9', ts: sep9 }));
    sink.dropShardsBefore(sep30);
    const { entries } = sink.loadIndex();
    expect(entries.map((e) => e.ref).sort()).toEqual(['oct', 'sep30']);
  });

  it('removeMany 删 body 文件;已经不在了不算错', () => {
    const sink = new FsRawSink(root);
    sink.writeBody('raw_a', new Uint8Array([1]));
    sink.writeBody('raw_b', new Uint8Array([2]));
    sink.removeMany(['raw_a', 'raw_never_existed']);
    expect(sink.readBody('raw_a')).toBeUndefined();
    expect(sink.readBody('raw_b'), '别的不许受牵连').toBeDefined();
  });

  it('⭐ diskBytes 报真实占用(用于对账内存统计有没有说谎)', () => {
    const sink = new FsRawSink(root);
    sink.writeBody('raw_a', new Uint8Array(100));
    sink.writeBody('raw_b', new Uint8Array(250));
    expect(sink.diskBytes()).toBe(350);
    sink.removeMany(['raw_a']);
    expect(sink.diskBytes()).toBe(250);
  });
});

describe('⭐⭐ 端到端:RawStore + 真 fs,存进去→重启→查得回', () => {
  it('⭐⭐ 关掉进程再起来,一个月前的数据仍查得回(这一层的全部价值)', () => {
    const sink = new FsRawSink(root);
    const s1 = new RawStore({ sink, now: () => T0 });
    const payload = new TextEncoder().encode('{"data":{"tweetResult":{"legacy":{"full_text":"原始正文"}}}}');
    const put = s1.put({
      ts: T0 - 20 * MS_PER_DAY,
      url: 'https://x.com/i/api/graphql/TweetDetail',
      pageId: 'page-1', mechanism: 'M1', status: 200,
      requestHeaders: { authorization: 'Bearer TOKEN' },
      body: payload,
    });
    if (!isOk(put)) throw new Error(`put 失败: ${JSON.stringify(put)}`);

    // ── 「重启」:全新的 store,只有磁盘上的东西 ──
    const sink2 = new FsRawSink(root);
    const { entries, badLines } = sink2.loadIndex();
    expect(badLines).toBe(0);
    expect(entries.length).toBe(1);

    // ⭐ 七个字段都还在 —— 排查靠的就是它们
    expect(entries[0]).toMatchObject({
      host: 'x.com', pageId: 'page-1', mechanism: 'M1', status: 200,
      bytes: payload.byteLength,
    });
    // ⭐ 请求头照存(§13.1:排查需要完整现场)
    expect(entries[0].requestHeaders?.authorization).toBe('Bearer TOKEN');

    // ⭐⭐ 原始 body 拿得回来 —— 这就是「拿一个月历史重跑解析器」的前提
    const body = sink2.readBody(entries[0].ref);
    expect(body).toBeDefined();
    expect(new TextDecoder().decode(body!)).toContain('原始正文');
  });

  it('⭐ 清理后重启,被清的**取不回**、没清的还在', () => {
    const sink = new FsRawSink(root);
    const s = new RawStore({ sink, now: () => T0 });
    const old = s.put({ ts: T0 - 40 * MS_PER_DAY, url: 'https://a.test/old', pageId: 'p', mechanism: 'M1', body: new Uint8Array(10) });
    const fresh = s.put({ ts: T0, url: 'https://a.test/new', pageId: 'p', mechanism: 'M1', body: new Uint8Array(10) });
    if (!isOk(old) || !isOk(fresh)) throw new Error('put 应成功');

    s.purgeExpired();
    sink.dropShardsBefore(T0 - 30 * MS_PER_DAY);

    const sink2 = new FsRawSink(root);
    const { entries } = sink2.loadIndex();
    expect(entries.map((e) => e.ref)).toEqual([fresh.value.ref]);
    expect(sink2.readBody(old.value.ref), 'body 也该删掉').toBeUndefined();
    expect(sink2.readBody(fresh.value.ref), '没过期的不许误删').toBeDefined();
  });

  it('⭐⭐ 同一天写多条,重启后**一条不少**地读回', () => {
    // 真实形态就是这个:一天里几百上千个响应,全进同一个分片。
    // 追加写只要少一个换行,这一整天的索引就全毁了。
    const sink = new FsRawSink(root);
    const s = new RawStore({ sink, now: () => T0 });
    for (let i = 0; i < 25; i++) {
      const r = s.put({
        ts: T0 + i * 1000, url: `https://x.com/api/${i}`, pageId: 'p1',
        mechanism: 'M1', status: 200, body: new Uint8Array(10),
      });
      if (!isOk(r)) throw new Error('put 应成功');
    }
    const { entries, badLines } = new FsRawSink(root).loadIndex();
    expect(entries.length, '25 条一条不少').toBe(25);
    expect(badLines).toBe(0);
    expect(entries[24].url).toBe('https://x.com/api/24');
    // 自检:它们确实在**同一个**分片里(否则这条又是空转的)
    expect(readdirSync(join(root, 'index')).length).toBe(1);
  });

  it('⭐ 内存统计与磁盘真实占用对得上(统计不说谎)', () => {
    const sink = new FsRawSink(root);
    const s = new RawStore({ sink, now: () => T0 });
    s.put({ url: 'https://a.test/1', pageId: 'p', mechanism: 'M1', body: new Uint8Array(400) });
    s.put({ url: 'https://a.test/2', pageId: 'p', mechanism: 'M1', body: new Uint8Array(600) });
    expect(s.usage().bytes).toBe(1000);
    expect(sink.diskBytes(), '内存说 1000,磁盘也得是 1000').toBe(1000);
  });

  it('⭐ 截断的 body:磁盘上确实只有截断后那么多', () => {
    const sink = new FsRawSink(root);
    const s = new RawStore({ sink, now: () => T0, quota: { maxBodyBytes: 100 } });
    const r = s.put({ url: 'https://a.test/big', pageId: 'p', mechanism: 'M1', body: new Uint8Array(5000) });
    if (!isOk(r)) throw new Error('unreachable');
    expect(r.value.truncated).toBe(true);
    expect(sink.diskBytes()).toBe(100);
    // 但索引里记的是**原始**大小 —— 回放时才知道被截了多少
    const { entries } = new FsRawSink(root).loadIndex();
    expect(entries[0].bytes).toBe(5000);
    expect(entries[0].storedBytes).toBe(100);
  });
});
