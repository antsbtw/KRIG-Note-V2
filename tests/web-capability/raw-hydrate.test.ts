/**
 * ⭐⭐ `RawStore.hydrate` —— 重启后索引查得回(`01-contract.md` §15.1 第 2 条)
 *
 * ── 为什么这个文件必须走「公开面」──
 *
 * `raw-fs-sink.test.ts` 里那条「关掉进程再起来仍查得回」是**绿的**,但它
 * **绕过了 `RawStore`**:直接 `new FsRawSink().loadIndex()` 再 `sink.readBody()`
 * 自己断言。于是它验证的是 sink 层,不是仓库层 ——
 * 真实启动路径(业务调 `store.query()`)重启后返回空,**那条测试永远不会红**。
 *
 * 本文件一律经 `store.query()` / `store.usage()` 断言,所以它红的唯一方式
 * 就是「重建这条路真的断了」。
 *
 * ── 四条守卫,逐条注入验证过(`feedback-verify-guard-can-fail`)──
 * | 守卫 | 注入 → 应红 |
 * |---|---|
 * | 重启后 query 查得回 | 删掉 hydrate 调用 |
 * | 截断条目按 storedBytes 算 | 改成累加 bytes |
 * | badLines>0 → Degraded | 改成返回 ok |
 * | 重复 hydrate → Failed | 去掉空库检查 |
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FsRawSink } from '@platform/main/web-capability/wiring/fs-raw-sink';
import { RawStore } from '@platform/main/web-capability/raw';
import { isDegraded, isFailed, isOk } from '@platform/main/web-capability';

const T0 = Date.UTC(2026, 8, 14, 12, 0, 0);

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'lraw-hydrate-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** 模拟一次「进程重启」:全新 sink + 全新 store,只有磁盘上的东西 */
function restart(): { store: RawStore; sink: FsRawSink } {
  const sink = new FsRawSink(root);
  const store = new RawStore({ sink, now: () => T0 });
  return { store, sink };
}

describe('⭐⭐ 守卫一:重启后 query() 查得回(仓库层,不是 sink 层)', () => {
  it('⭐⭐ 存进去 → 重启 → `store.query()` 仍能查到(这一层的全部价值)', () => {
    const { store: s1 } = restart();
    const payload = new TextEncoder().encode('{"data":{"full_text":"原始正文"}}');
    const put = s1.put({
      ts: T0, url: 'https://x.com/i/api/graphql/TweetDetail',
      pageId: 'page-1', mechanism: 'M1', status: 200, body: payload,
    });
    if (!isOk(put)) throw new Error(`put 失败: ${JSON.stringify(put)}`);

    // ── 重启 ──
    const { store: s2, sink: sink2 } = restart();

    // ⚠️ 先证明「不 hydrate 就是查不到」—— 否则下面的断言可能本来就成立(空转)
    expect(s2.query().length, '没 hydrate 时本就该是空的').toBe(0);

    const r = s2.hydrate(sink2.loadIndex());
    if (!isOk(r)) throw new Error(`hydrate 应 Ok,实得: ${JSON.stringify(r)}`);

    // ⭐ 经**公开面**查 —— 绕到 sink 去断言就测不到真正的缺口
    const found = s2.query({ host: 'x.com' });
    expect(found.length, '重启后按 host 查得回').toBe(1);
    expect(found[0].url).toContain('TweetDetail');
    expect(found[0].status).toBe(200);

    // ⭐ body 也拿得回(裁定③:索引恢复了,body 走 sink 回落)
    const body = s2.body(found[0].ref);
    if (!isOk(body)) throw new Error(`body 应取得回: ${JSON.stringify(body)}`);
    expect(new TextDecoder().decode(body.value)).toContain('原始正文');

    expect(r.value.restored).toBe(1);
    expect(r.value.badLines).toBe(0);
  });

  it('⭐ 七个字段全都活着(排查靠的就是它们)', () => {
    const { store: s1 } = restart();
    const put = s1.put({
      ts: T0 - 5000, url: 'https://x.com/api/x', pageId: 'p9',
      mechanism: 'M2', status: 429, body: new Uint8Array(123),
      requestHeaders: { authorization: 'Bearer TOKEN' },
    });
    if (!isOk(put)) throw new Error('put 应成功');

    const { store: s2, sink } = restart();
    s2.hydrate(sink.loadIndex());

    // 七个字段各查一次 —— 任何一个没恢复,对应这条就红
    expect(s2.query({ since: T0 - 6000, until: T0 }).length).toBe(1);
    expect(s2.query({ host: 'x.com' }).length).toBe(1);
    expect(s2.query({ urlIncludes: '/api/' }).length).toBe(1);
    expect(s2.query({ pageId: 'p9' }).length).toBe(1);
    expect(s2.query({ mechanism: 'M2' }).length).toBe(1);
    expect(s2.query({ status: 429 }).length, '429 那次「猜了一整天」正是要靠它').toBe(1);
    expect(s2.query({ minBytes: 100 }).length).toBe(1);
    // 请求头这类现场信息也要在
    expect(s2.query()[0].requestHeaders?.authorization).toBe('Bearer TOKEN');
  });

  it('⭐ 空盘 hydrate 是 Ok 的空结果,不是失败(首次启动的正常形态)', () => {
    const { store, sink } = restart();
    const r = store.hydrate(sink.loadIndex());
    if (!isOk(r)) throw new Error(`首次启动应 Ok: ${JSON.stringify(r)}`);
    expect(r.value.restored).toBe(0);
    expect(store.usage().entries).toBe(0);
  });
});

describe('⭐⭐ 守卫二:截断条目按 storedBytes 算(裁定②)', () => {
  it('⭐⭐ 截断后重启,usage().bytes 是**落盘**大小,不是原始大小', () => {
    // maxBodyBytes=100 → 5000 字节的 body 落盘只有 100
    const sink1 = new FsRawSink(root);
    const s1 = new RawStore({ sink: sink1, now: () => T0, quota: { maxBodyBytes: 100 } });
    const r1 = s1.put({
      ts: T0, url: 'https://a.test/big', pageId: 'p', mechanism: 'M1',
      body: new Uint8Array(5000),
    });
    if (!isOk(r1)) throw new Error('unreachable');
    expect(r1.value.truncated, '前提:这条确实被截断了').toBe(true);
    expect(r1.value.bytes, 'bytes 记原始大小').toBe(5000);
    expect(r1.value.storedBytes, 'storedBytes 记落盘大小').toBe(100);
    const before = s1.usage().bytes;
    expect(before, '截断后内存统计就是 100').toBe(100);

    // ── 重启后必须还是 100,不是 5000 ──
    const { store: s2, sink: sink2 } = restart();
    const r = s2.hydrate(sink2.loadIndex());
    if (!isOk(r)) throw new Error(`hydrate 应 Ok: ${JSON.stringify(r)}`);

    expect(
      s2.usage().bytes,
      '⚠️ 累加 bytes(5000)会让占用虚高 → 触发误淘汰,把没过期的删掉',
    ).toBe(100);
    expect(r.value.bytes).toBe(100);
    // 与重启前同口径 —— 对不上就说明重建算错了
    expect(s2.usage().bytes).toBe(before);
  });

  it('⭐ 没截断的照常按 bytes 算(反向锁:不是「一律当 0」)', () => {
    const { store: s1 } = restart();
    s1.put({ ts: T0, url: 'https://a.test/1', pageId: 'p', mechanism: 'M1', body: new Uint8Array(400) });
    s1.put({ ts: T0, url: 'https://a.test/2', pageId: 'p', mechanism: 'M1', body: new Uint8Array(600) });
    expect(s1.usage().bytes).toBe(1000);

    const { store: s2, sink } = restart();
    s2.hydrate(sink.loadIndex());
    expect(s2.usage().bytes).toBe(1000);
  });
});

describe('⭐⭐ 守卫三:badLines > 0 → Degraded(不吞也不炸)', () => {
  it('⭐⭐ 坏行 → Degraded,好的那些照常装进来,missing 说清楚坏了几行', () => {
    const { store: s1 } = restart();
    const ok1 = s1.put({ ts: T0, url: 'https://a.test/good', pageId: 'p', mechanism: 'M1', body: new Uint8Array(10) });
    if (!isOk(ok1)) throw new Error('unreachable');

    // 手写一行坏 JSON 进当天分片 —— 模拟断电时追加写被截断
    const dir = join(root, 'index');
    mkdirSync(dir, { recursive: true });
    const shard = `${new Date(T0).toISOString().slice(0, 10)}.jsonl`;
    appendFileSync(join(dir, shard), '{"ref":"raw_broken","ts":\n');

    const { store: s2, sink } = restart();
    const loaded = sink.loadIndex();
    expect(loaded.badLines, '前提:确实有一行坏的').toBe(1);

    const r = s2.hydrate(loaded);
    expect(isDegraded(r), '⚠️ 说成 Ok 是撒谎,说成 Failed 是冤枉 —— 这正是 Degraded 的定义场景').toBe(true);
    if (!isDegraded(r)) throw new Error('unreachable');

    expect(r.missing.length, 'Degraded 必须说明缺了什么').toBeGreaterThan(0);
    expect(r.missing.join(' ')).toContain('1');
    expect(r.value.badLines).toBe(1);

    // ⭐ 好的那条照常可用 —— 不因一行坏数据丢掉整月索引
    expect(r.value.restored).toBe(1);
    expect(s2.query().length).toBe(1);
    expect(s2.query()[0].url).toContain('/good');
  });

  it('⭐ 没坏行时**不许**是 Degraded(反向锁)', () => {
    const { store: s1 } = restart();
    s1.put({ ts: T0, url: 'https://a.test/x', pageId: 'p', mechanism: 'M1', body: new Uint8Array(10) });

    const { store: s2, sink } = restart();
    const r = s2.hydrate(sink.loadIndex());
    expect(isDegraded(r), '没缺东西就该是 Ok —— Degraded 会让调用方误判成部分失败').toBe(false);
    expect(isOk(r)).toBe(true);
  });
});

describe('⭐⭐ 守卫四:重复 hydrate → Failed(裁定④)', () => {
  /**
   * ⚠️⚠️ **这条的写法是被注入验证纠正过的,别改回去**(2026-09-14)。
   *
   * 初稿用「同一批 entries 装两次」+ 只断言 `isFailed` —— **那是假保证**:
   * 注入验证时删掉空库检查,它**照样绿**。探针查出真因:第二批 ref 与第一批全同,
   * 于是走了**裁定⑤的 ref 重复分支**,错误信息是「ref 重复: raw_xxx」而不是「拒绝重复 hydrate」。
   * 裁定⑤替裁定④兜了底,守卫四对它声称保护的东西**零区分力**。
   *
   * ⭐ 而真正危险的场景恰恰是 ref **不**撞的那种(两个索引目录 / 分片被合并过):
   * 那时 `totalBytes` 真的翻倍 → 触发误淘汰 → 把没过期的数据删掉。
   *
   * 所以这里第二批用**全新 ref**,让 ref 检查帮不上忙 —— 只有空库检查能挡住它。
   */
  it('⭐⭐ 第二次 hydrate(**不同 ref**)明确失败,而不是让占用翻倍', () => {
    const { store: s1 } = restart();
    const put = s1.put({ ts: T0, url: 'https://a.test/x', pageId: 'p', mechanism: 'M1', body: new Uint8Array(500) });
    if (!isOk(put)) throw new Error('put 应成功');

    const { store: s2, sink } = restart();
    const firstBatch = sink.loadIndex();
    const first = s2.hydrate(firstBatch);
    if (!isOk(first)) throw new Error('第一次应成功');
    expect(s2.usage().bytes).toBe(500);

    // ⭐ 第二批:ref 全新,与第一批不重叠 —— 裁定⑤兜不住,只有裁定④能挡
    const secondBatch = {
      entries: firstBatch.entries.map((e) => ({ ...e, ref: `${e.ref}_other` })),
      badLines: 0,
    };
    expect(
      secondBatch.entries.some((e) => firstBatch.entries.some((f) => f.ref === e.ref)),
      '前提:第二批的 ref 必须与第一批完全不重叠,否则又被 ref 检查兜住',
    ).toBe(false);

    const second = s2.hydrate(secondBatch);
    expect(isFailed(second), '重复装载会让 totalBytes 翻倍 → 误淘汰,必须明确失败').toBe(true);
    // ⭐ 失败了就不许有副作用 —— 占用还是 500,不是 1000
    expect(s2.usage().bytes, '失败的 hydrate 不许改动状态').toBe(500);
    expect(s2.usage().entries).toBe(1);
  });

  it('⭐ put 过之后也不许再 hydrate(非空就是非空)', () => {
    const { store, sink } = restart();
    store.put({ ts: T0, url: 'https://a.test/x', pageId: 'p', mechanism: 'M1', body: new Uint8Array(10) });
    const r = store.hydrate(sink.loadIndex());
    expect(isFailed(r)).toBe(true);
  });

  it('同一批装两次也失败 —— ⚠️ 但这条**可能被裁定⑤兜住**,不算守卫四的证据', () => {
    // 保留它是因为「同批重放」是真实会发生的误用形态;
    // 但它红不红说明不了空库检查在不在 —— 上面那条才是守卫四的本体。
    const { store: s1 } = restart();
    s1.put({ ts: T0, url: 'https://a.test/x', pageId: 'p', mechanism: 'M1', body: new Uint8Array(500) });
    const { store: s2, sink } = restart();
    s2.hydrate(sink.loadIndex());
    expect(isFailed(s2.hydrate(sink.loadIndex()))).toBe(true);
  });
});

describe('⭐ 裁定⑤:ref 撞了 fail loud,绝不覆盖', () => {
  it('⭐ 盘上有两条同 ref → Failed(两条记录共用句柄会让 body 取回错的那条)', () => {
    const dir = join(root, 'index');
    mkdirSync(dir, { recursive: true });
    const shard = `${new Date(T0).toISOString().slice(0, 10)}.jsonl`;
    const line = (url: string) => JSON.stringify({
      ref: 'raw_dup', ts: T0, host: 'a.test', url, pageId: 'p', mechanism: 'M1', bytes: 10,
    });
    appendFileSync(join(dir, shard), `${line('https://a.test/1')}\n${line('https://a.test/2')}\n`);

    const { store, sink } = restart();
    const r = store.hydrate(sink.loadIndex());
    expect(isFailed(r), 'ref 重复必须停,不能覆盖').toBe(true);
  });
});

describe('⚠️ 有意不做的两件事(是裁定,不是漏做)', () => {
  it('⭐ body **不预加载**(裁定③:几个 GB 全读进内存 = 把磁盘搬进 RAM)', () => {
    const { store: s1 } = restart();
    const put = s1.put({ ts: T0, url: 'https://a.test/x', pageId: 'p', mechanism: 'M1', body: new Uint8Array(64) });
    if (!isOk(put)) throw new Error('unreachable');

    // 换一个**没有 sink** 的仓库来 hydrate:body 就没有回落路径了。
    // 若 hydrate 预加载过 body,这里就能取到 —— 取不到才证明「只恢复索引」。
    const sinkForIndex = new FsRawSink(root);
    const noSink = new RawStore({ now: () => T0 });
    const r = noSink.hydrate(sinkForIndex.loadIndex());
    if (!isOk(r)) throw new Error('hydrate 应成功');

    expect(noSink.query().length, '索引恢复了').toBe(1);
    expect(
      isFailed(noSink.body(put.value.ref)),
      'body 不该被预加载进内存 —— 它应该走 sink 回落,没 sink 就是取不到',
    ).toBe(true);
  });

  it('⭐ evicted 有意不跨重启累计(语义是「本次运行淘汰了多少」)', () => {
    const { store: s1 } = restart();
    s1.put({ ts: T0, url: 'https://a.test/x', pageId: 'p', mechanism: 'M1', body: new Uint8Array(10) });

    const { store: s2, sink } = restart();
    s2.hydrate(sink.loadIndex());
    expect(s2.evictedStats()).toEqual({ entries: 0, bytes: 0 });
  });
});
