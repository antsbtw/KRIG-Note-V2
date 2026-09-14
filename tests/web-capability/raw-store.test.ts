/**
 * ⭐ L-raw 仓库 —— 存得住、查得回、清得掉、不撑爆(`01-contract.md` §13)
 *
 * ── 为什么要有这一层(真实代价)──
 *
 * | 现在的问题 | 证据 |
 * |---|---|
 * | 排查靠猜 | `project-x-translate-rate-limited` 那个 429 **猜了一整天,至今未解** |
 * | 业务表删了永久丢 | `tweet_feedback` 607 条采纳里 **449 条(74%)正文被 TTL 删掉** |
 * | 解析器改进只对新数据生效 | 改好了只能等新数据攒够才看得出效果 |
 *
 * ⭐ 最值钱的一条:拿一个月历史原始载荷**重跑解析器**,
 * 把「改进解析」从等数据攒够变成**立刻可验证**。
 */
import { describe, it, expect } from 'vitest';
import { RawStore, ALL_MECHANISMS, DEFAULT_RETENTION_DAYS } from '@platform/main/web-capability/raw';
import type { CaptureMechanism, RawSink } from '@platform/main/web-capability/raw';
import { isFailed, isOk } from '@platform/main/web-capability';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 9, 12, 0, 0); // 固定时钟 —— 过期判据必须可复现

function bytes(n: number, fill = 65): Uint8Array {
  return new Uint8Array(n).fill(fill);
}

/** 可控时钟的仓库 */
function storeAt(now: number, quota = {}) {
  const clock = { t: now };
  const s = new RawStore({ now: () => clock.t, quota });
  return { s, clock };
}

function putOk(s: RawStore, input: Parameters<RawStore['put']>[0]) {
  const r = s.put(input);
  if (!isOk(r)) throw new Error(`put 应成功,实际: ${JSON.stringify(r)}`);
  return r.value;
}

describe('⭐⭐ 无条件、无分支地收下一切(§13.1)', () => {
  it('⭐⭐ M1..M8 **八种机制全部**照收,一个不漏', () => {
    // 用户原话:「缓存就是大海……**但是不要把业务逻辑搞复杂影响可靠性**」。
    // 初稿曾想「M4 不存」以省空间,被否决:那要每个调用点判断自己属于哪类,
    // **判断错就丢数据**。
    const { s } = storeAt(T0);
    for (const m of ALL_MECHANISMS) {
      const e = putOk(s, { url: `https://a.test/${m}`, pageId: 'p1', mechanism: m, body: bytes(10) });
      expect(e.mechanism).toBe(m);
    }
    // ⭐ 八条全在 —— 少一条就说明有分支把它挡掉了
    expect(s.usage().entries).toBe(8);
    for (const m of ALL_MECHANISMS) {
      expect(s.query({ mechanism: m }).length, `${m} 被挡掉了`).toBe(1);
    }
    // 自检:清单确实是 8 个(不是空转)
    expect(ALL_MECHANISMS.length).toBe(8);
  });

  it('⭐⭐ M4(DOM 直读)一样收 —— 它是全仓最广、保真度最低的那个', () => {
    // §13.1 明确:「M4 ⭐ **也进 L-raw**」
    const { s } = storeAt(T0);
    putOk(s, { url: 'https://x.test/dom', pageId: 'p1', mechanism: 'M4', body: bytes(100) });
    expect(s.query({ mechanism: 'M4' }).length).toBe(1);
  });

  it('⭐⭐ put 的实现里零处按机制分支(源码层面钉死)', () => {
    // 存储端加判断 = 拿可靠性换空间,而空间恰是最不稀缺的。
    const fs = require('node:fs') as typeof import('node:fs');
    const code = fs
      .readFileSync('src/platform/main/web-capability/raw/raw-store.ts', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const putBody = code.slice(code.indexOf('put(input: RawWriteInput)'), code.indexOf('body(ref: string)'));
    expect(putBody.length).toBeGreaterThan(0);
    for (const banned of [/mechanism\s*===/, /mechanism\s*!==/, /'M[1-8]'/, /includes\(input\.mechanism\)/]) {
      expect(putBody, `put 里出现了按机制的分支(${banned})—— §13.1 明令禁止`).not.toMatch(banned);
    }
  });

  it('守卫自检:注释里确实讨论了「无分支」(否则上条是空转的)', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const raw = fs.readFileSync('src/platform/main/web-capability/raw/raw-store.ts', 'utf-8');
    expect(raw).toMatch(/无条件、无分支/);
  });
});

describe('⭐ 七个字段各自都查得回(§13.2)', () => {
  function seeded() {
    const { s } = storeAt(T0);
    putOk(s, {
      ts: T0 - 5000, url: 'https://x.com/i/api/graphql/abc', pageId: 'page-1',
      mechanism: 'M1', status: 200, method: 'GET', body: bytes(1000),
    });
    putOk(s, {
      ts: T0 - 3000, url: 'https://claude.ai/api/organizations/x', pageId: 'page-2',
      mechanism: 'M2', status: 429, body: bytes(50),
    });
    putOk(s, {
      ts: T0 - 1000, url: 'https://x.com/home', pageId: 'page-1',
      mechanism: 'M4', body: bytes(300),
    });
    return s;
  }

  it('⭐ ① 时间', () => {
    const s = seeded();
    expect(s.query({ since: T0 - 3500 }).length).toBe(2);
    expect(s.query({ until: T0 - 4000 }).length).toBe(1);
    expect(s.query({ since: T0 - 3500, until: T0 - 2000 }).length).toBe(1);
  });

  it('⭐ ② host(由本层从 URL 解析,不让调用方传)', () => {
    const s = seeded();
    expect(s.query({ host: 'x.com' }).length).toBe(2);
    expect(s.query({ host: 'claude.ai' }).length).toBe(1);
    // ⚠️ host 是解析出来的,不是传进来的 —— 传错了索引就查不着,而且不报错
    expect(s.query({ host: 'x.com' })[0].host).toBe('x.com');
  });

  it('⭐ ③ URL(包含匹配,Chrome DevTools 同款语义)', () => {
    const s = seeded();
    expect(s.query({ urlIncludes: '/graphql/' }).length).toBe(1);
    expect(s.query({ urlIncludes: '/api/' }).length).toBe(2);
    expect(s.query({ urlIncludes: '不存在' }).length).toBe(0);
  });

  it('⭐ ④ pageId', () => {
    const s = seeded();
    expect(s.query({ pageId: 'page-1' }).length).toBe(2);
    expect(s.query({ pageId: 'page-2' }).length).toBe(1);
  });

  it('⭐ ⑤ 机制', () => {
    const s = seeded();
    expect(s.query({ mechanism: 'M1' }).length).toBe(1);
    expect(s.query({ mechanism: 'M4' }).length).toBe(1);
    expect(s.query({ mechanism: 'M6' }).length).toBe(0);
  });

  it('⭐ ⑥ HTTP 状态 —— 429 那次「猜了一整天」正是要靠它', () => {
    const s = seeded();
    expect(s.query({ status: 429 }).length).toBe(1);
    expect(s.query({ status: 200 }).length).toBe(1);
    expect(s.query({ status: 429 })[0].url).toContain('claude.ai');
  });

  it('⭐ ⑦ 大小', () => {
    const s = seeded();
    expect(s.query({ minBytes: 500 }).length).toBe(1);
    expect(s.query({ maxBytes: 100 }).length).toBe(1);
    expect(s.query({ minBytes: 100, maxBytes: 500 }).length).toBe(1);
  });

  it('⭐ 组合查(排查的真实姿势:先圈时间,再按 host/状态找)', () => {
    const s = seeded();
    expect(s.query({ host: 'x.com', pageId: 'page-1', since: T0 - 2000 }).length).toBe(1);
  });

  it('⭐ 没有条件 = 全返;不排序、不择优(与 web.page 的 find 同源)', () => {
    const s = seeded();
    const all = s.query();
    expect(all.length).toBe(3);
    // 顺序即插入序 —— 底座不替调用方挑「最相关的一条」
    expect(all.map((e) => e.pageId)).toEqual(['page-1', 'page-2', 'page-1']);
  });

  it('⭐ 没有 HTTP 状态的机制**留空**,不伪造 200', () => {
    // 伪造会让「这条没有状态」和「这条真的是 200」永远分不开
    const s = seeded();
    const m4 = s.query({ mechanism: 'M4' })[0];
    expect(m4.status).toBeUndefined();
    // 反向锁:有状态的那条确实记下来了
    expect(s.query({ mechanism: 'M1' })[0].status).toBe(200);
  });
});

describe('⭐ 存了就取得回 body', () => {
  it('put 后能按 ref 取回原始 bytes', () => {
    const { s } = storeAt(T0);
    const payload = new TextEncoder().encode('{"data":{"tweet":"hello"}}');
    const e = putOk(s, { url: 'https://x.com/a', pageId: 'p', mechanism: 'M1', body: payload });
    const got = s.body(e.ref);
    expect(isOk(got)).toBe(true);
    if (!isOk(got)) throw new Error('unreachable');
    expect(new TextDecoder().decode(got.value)).toBe('{"data":{"tweet":"hello"}}');
  });

  it('⭐⭐ 取不到 → Failed,**不返回空数组**', () => {
    // 空数组会被解析器当成「响应是空的」,于是「数据已被清掉」
    // 表现为「站点返回了空」—— 排查方向完全指错
    const { s } = storeAt(T0);
    const got = s.body('raw_nonexistent');
    expect(isFailed(got)).toBe(true);
    if (!isFailed(got)) throw new Error('unreachable');
    expect(got.reason).toContain('raw_nonexistent');
  });

  it('⭐ 索引取不到也是 Failed,不返回 null', () => {
    const { s } = storeAt(T0);
    expect(isFailed(s.entry('raw_nope'))).toBe(true);
  });
});

describe('⭐ 大 body:截断要标注,不许静默', () => {
  it('⭐⭐ 超限截断 → truncated:true 且 bytes 记**原始**大小', () => {
    // 静默截断最坏:回放时解析器在半截 JSON 上炸,而没人知道数据本来是全的 ——
    // 于是去改解析器,改的是个不存在的 bug
    const { s } = storeAt(T0, { maxBodyBytes: 100 });
    const e = putOk(s, { url: 'https://a.test/big', pageId: 'p', mechanism: 'M1', body: bytes(1000) });
    expect(e.truncated).toBe(true);
    expect(e.bytes, '要记原始大小,回放时才知道被截了多少').toBe(1000);
    expect(e.storedBytes).toBe(100);
    // 实际存的确实只有 100
    const got = s.body(e.ref);
    if (!isOk(got)) throw new Error('unreachable');
    expect(got.value.byteLength).toBe(100);
  });

  it('⭐ 没超限的**不许**标 truncated(反向锁)', () => {
    // 若恒标 truncated,上面那条也会绿 —— 那是另一种假保证
    const { s } = storeAt(T0, { maxBodyBytes: 100 });
    const e = putOk(s, { url: 'https://a.test/s', pageId: 'p', mechanism: 'M1', body: bytes(50) });
    expect(e.truncated).toBeUndefined();
    expect(e.storedBytes).toBeUndefined();
    expect(e.bytes).toBe(50);
  });
});

describe('⭐ 写盘失败 → Failed,不静默吞', () => {
  it('⭐⭐ sink 写 body 抛错 → Failed,且**不进索引**', () => {
    // 「以为存了、其实没存」比不存更坏 —— 它让人放心地删掉了业务表
    const sink: RawSink = {
      writeBody() { throw new Error('磁盘已满'); },
      appendIndex() { /* 不会走到 */ },
    };
    const s = new RawStore({ sink, now: () => T0 });
    const r = s.put({ url: 'https://a.test/x', pageId: 'p', mechanism: 'M1', body: bytes(10) });
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toContain('磁盘已满');
    expect(r.retryable).toBe(true);
    // ⭐ 关键:索引里**不能**有这条 —— 否则查得到却取不回,比查不到更误导
    expect(s.usage().entries).toBe(0);
    expect(s.query().length).toBe(0);
  });

  it('⭐ sink 写索引抛错 → 同样 Failed 且不进内存索引', () => {
    const sink: RawSink = {
      writeBody() { /* ok */ },
      appendIndex() { throw new Error('索引分片写失败'); },
    };
    const s = new RawStore({ sink, now: () => T0 });
    const r = s.put({ url: 'https://a.test/x', pageId: 'p', mechanism: 'M1', body: bytes(10) });
    expect(isFailed(r)).toBe(true);
    expect(s.usage().entries).toBe(0);
  });

  it('sink 正常时照常成功(反向锁:不是「有 sink 就失败」)', () => {
    const written: string[] = [];
    const sink: RawSink = {
      writeBody(ref) { written.push(ref); },
      appendIndex() { /* ok */ },
    };
    const s = new RawStore({ sink, now: () => T0 });
    const r = s.put({ url: 'https://a.test/x', pageId: 'p', mechanism: 'M1', body: bytes(10) });
    expect(isOk(r)).toBe(true);
    expect(written.length).toBe(1);
  });

  it('⭐ URL 解析不出 host → Failed(不退成空 host)', () => {
    // 空 host 会让这条在按 host 查时永远查不到 —— 等于存了个查不回的东西
    const { s } = storeAt(T0);
    const r = s.put({ url: 'not-a-url', pageId: 'p', mechanism: 'M1', body: bytes(10) });
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toContain('host');
    expect(s.usage().entries).toBe(0);
  });
});

describe('⭐ 过期清理:清该清的,一条都不误伤', () => {
  it('⭐⭐ 1 个月前的被清,之内的**不被误清**', () => {
    const { s, clock } = storeAt(T0);
    // 三条:40 天前(该清)、29 天前(该留)、刚才(该留)
    putOk(s, { ts: T0 - 40 * MS_PER_DAY, url: 'https://a.test/old', pageId: 'p', mechanism: 'M1', body: bytes(10) });
    putOk(s, { ts: T0 - 29 * MS_PER_DAY, url: 'https://a.test/mid', pageId: 'p', mechanism: 'M1', body: bytes(10) });
    putOk(s, { ts: T0, url: 'https://a.test/new', pageId: 'p', mechanism: 'M1', body: bytes(10) });
    expect(s.usage().entries).toBe(3);

    clock.t = T0;
    const rep = s.purgeExpired();

    expect(rep.removedEntries, '只该清掉 40 天前那一条').toBe(1);
    // ⭐⭐ 反向断言:该留的**真的还在**(这才是「不误伤」)
    expect(s.query({ urlIncludes: '/mid' }).length).toBe(1);
    expect(s.query({ urlIncludes: '/new' }).length).toBe(1);
    expect(s.query({ urlIncludes: '/old' }).length).toBe(0);
    expect(s.usage().entries).toBe(2);
  });

  it('⭐ 边界:正好 30 天的**留下**,30 天零 1 毫秒的清掉', () => {
    const { s } = storeAt(T0);
    putOk(s, { ts: T0 - 30 * MS_PER_DAY, url: 'https://a.test/edge', pageId: 'p', mechanism: 'M1', body: bytes(10) });
    putOk(s, { ts: T0 - 30 * MS_PER_DAY - 1, url: 'https://a.test/past', pageId: 'p', mechanism: 'M1', body: bytes(10) });
    s.purgeExpired();
    expect(s.query({ urlIncludes: '/edge' }).length, '正好在保留期内').toBe(1);
    expect(s.query({ urlIncludes: '/past' }).length, '差 1ms 就出界').toBe(0);
  });

  it('⭐ 清理会把请求头一并清掉(§13.1:不外发、不上报、清理时一并清)', () => {
    const { s } = storeAt(T0);
    const e = putOk(s, {
      ts: T0 - 40 * MS_PER_DAY, url: 'https://a.test/tok', pageId: 'p', mechanism: 'M1',
      requestHeaders: { authorization: 'Bearer SECRET' }, body: bytes(10),
    });
    expect(s.entry(e.ref).status).toBe('ok');
    s.purgeExpired();
    // 整条 entry 都没了 —— token 自然也没了
    expect(isFailed(s.entry(e.ref))).toBe(true);
    expect(JSON.stringify(s.query())).not.toContain('SECRET');
  });

  it('按 host / pageId 选择性清除', () => {
    const { s } = storeAt(T0);
    putOk(s, { url: 'https://x.com/a', pageId: 'p1', mechanism: 'M1', body: bytes(10) });
    putOk(s, { url: 'https://claude.ai/b', pageId: 'p2', mechanism: 'M1', body: bytes(10) });
    s.purge({ host: 'x.com' });
    expect(s.query({ host: 'x.com' }).length).toBe(0);
    expect(s.query({ host: 'claude.ai' }).length, '别的站不许受牵连').toBe(1);
  });

  it('一键全清', () => {
    const { s } = storeAt(T0);
    for (let i = 0; i < 5; i++) {
      putOk(s, { url: `https://a.test/${i}`, pageId: 'p', mechanism: 'M1', body: bytes(10) });
    }
    const rep = s.purge();
    expect(rep.removedEntries).toBe(5);
    expect(s.usage().entries).toBe(0);
    expect(s.usage().bytes).toBe(0);
  });

  it('⭐ 清理后 sink 也被通知删(不留孤儿 —— 孤儿会让占用统计说谎)', () => {
    const removed: string[] = [];
    const sink: RawSink = {
      writeBody() {}, appendIndex() {},
      removeMany(refs) { removed.push(...refs); },
    };
    const s = new RawStore({ sink, now: () => T0 });
    const r = s.put({ url: 'https://a.test/x', pageId: 'p', mechanism: 'M1', body: bytes(10) });
    if (!isOk(r)) throw new Error('unreachable');
    s.purge();
    expect(removed).toEqual([r.value.ref]);
  });

  it('默认保留期是 30 天(1 个月)', () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(30);
  });
});

describe('⭐ 占用可观测(§13.1「不设上限」≠「不管」)', () => {
  it('⭐⭐ 能报出当前条数 / 字节数 —— 用户要据此决定配多少', () => {
    const { s } = storeAt(T0);
    putOk(s, { ts: T0 - 1000, url: 'https://a.test/1', pageId: 'p', mechanism: 'M1', body: bytes(100) });
    putOk(s, { ts: T0, url: 'https://a.test/2', pageId: 'p', mechanism: 'M1', body: bytes(250) });
    const u = s.usage();
    expect(u.entries).toBe(2);
    expect(u.bytes).toBe(350);
    expect(u.oldestTs).toBe(T0 - 1000);
    expect(u.newestTs).toBe(T0);
    // 配额也报出来,调用方能直接算百分比
    expect(u.retentionDays).toBe(30);
    expect(u.maxBytes).toBeGreaterThan(0);
  });

  it('空库时占用为 0 且 oldest/newest 是 undefined(不伪造时间)', () => {
    const { s } = storeAt(T0);
    const u = s.usage();
    expect(u.entries).toBe(0);
    expect(u.bytes).toBe(0);
    expect(u.oldestTs).toBeUndefined();
  });

  it('⭐⭐ 将满时告警,不是静默写爆', () => {
    const { s } = storeAt(T0, { maxBytes: 1000, warnRatio: 0.9 });
    putOk(s, { url: 'https://a.test/1', pageId: 'p', mechanism: 'M1', body: bytes(500) });
    expect(s.usage().overWarnThreshold, '50% 不该告警').toBe(false);
    putOk(s, { url: 'https://a.test/2', pageId: 'p', mechanism: 'M1', body: bytes(450) });
    expect(s.usage().overWarnThreshold, '95% 该告警了').toBe(true);
  });

  it('清理后占用**真的**降下来(不是只删索引不减字节)', () => {
    const { s } = storeAt(T0);
    putOk(s, { url: 'https://a.test/1', pageId: 'p', mechanism: 'M1', body: bytes(400) });
    putOk(s, { url: 'https://a.test/2', pageId: 'p', mechanism: 'M1', body: bytes(600) });
    expect(s.usage().bytes).toBe(1000);
    s.purge({ host: 'a.test' });
    expect(s.usage().bytes).toBe(0);
  });
});

describe('⭐ 体积配额:淘汰最旧,且淘汰要可见', () => {
  it('⭐ 超上限时淘汰最旧的,新的留下', () => {
    const { s } = storeAt(T0, { maxBytes: 1000 });
    const a = putOk(s, { ts: T0 - 3000, url: 'https://a.test/a', pageId: 'p', mechanism: 'M1', body: bytes(600) });
    const b = putOk(s, { ts: T0 - 2000, url: 'https://a.test/b', pageId: 'p', mechanism: 'M1', body: bytes(600) });
    // a + b = 1200 > 1000 → 淘汰 a
    expect(isFailed(s.body(a.ref)), '最旧的被淘汰').toBe(true);
    expect(isOk(s.body(b.ref)), '新的留下').toBe(true);
    expect(s.usage().bytes).toBe(600);
  });

  it('⭐⭐ 被淘汰了多少**必须可见**(否则「数据怎么少了」无从查起)', () => {
    const { s } = storeAt(T0, { maxBytes: 1000 });
    putOk(s, { url: 'https://a.test/a', pageId: 'p', mechanism: 'M1', body: bytes(600) });
    putOk(s, { url: 'https://a.test/b', pageId: 'p', mechanism: 'M1', body: bytes(600) });
    const ev = s.evictedStats();
    expect(ev.entries).toBe(1);
    expect(ev.bytes).toBe(600);
  });

  it('⭐ maxBytes 可配成 Infinity(§13.1「不写死上限」)', () => {
    const { s } = storeAt(T0, { maxBytes: Infinity });
    for (let i = 0; i < 20; i++) {
      putOk(s, { url: `https://a.test/${i}`, pageId: 'p', mechanism: 'M1', body: bytes(1_000_000) });
    }
    expect(s.usage().entries, '不限体积时一条都不该被淘汰').toBe(20);
    expect(s.evictedStats().entries).toBe(0);
    expect(s.usage().overWarnThreshold, 'Infinity 上限不该恒告警').toBe(false);
  });

  it('⭐ 默认配额宽松(不是保守到刚够用)', () => {
    const { s } = storeAt(T0);
    // 默认下存 20MB 一条都不该被淘汰
    for (let i = 0; i < 20; i++) {
      putOk(s, { url: `https://a.test/${i}`, pageId: 'p', mechanism: 'M1', body: bytes(1_000_000) });
    }
    expect(s.evictedStats().entries).toBe(0);
  });
});

describe('⭐ 底座边界:零站点知识 / 零 fs / 零 electron / 无常驻 timer', () => {
  const read = (f: string) => {
    const fs = require('node:fs') as typeof import('node:fs');
    return fs
      .readFileSync(`src/platform/main/web-capability/raw/${f}`, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
  };
  const files = ['raw-store.ts', 'types.ts', 'index.ts'];

  it('⭐ 纯逻辑层零 fs / 零 electron(真 IO 归 wiring/)', () => {
    for (const f of files) {
      const code = read(f);
      expect(code, `${f} 碰了 fs`).not.toMatch(/from\s+['"]node:fs['"]|require\(['"]fs['"]\)/);
      expect(code, `${f} 碰了 electron`).not.toMatch(/from\s+['"]electron['"]/);
      expect(code, `${f} 碰了 path`).not.toMatch(/from\s+['"]node:path['"]/);
    }
  });

  it('⭐ wiring/fs-raw-sink.ts 确实存在且确实碰 fs(否则上条空转)', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const code = fs
      .readFileSync('src/platform/main/web-capability/wiring/fs-raw-sink.ts', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).toMatch(/from\s+['"]node:fs['"]/);
  });

  it('⭐⭐ 零常驻 timer(记忆 project-graceful-shutdown:Ctrl+C 后 app 不退)', () => {
    // 常驻 timer 没人停会吊住事件循环。本层的清理是**被调用时才跑**,
    // 不自己起循环 —— 于是根本没有「谁来停」这个问题。
    for (const f of files) {
      const code = read(f);
      expect(code, `${f} 起了 timer,却没有配套停止调用`).not.toMatch(/setInterval|setTimeout/);
    }
  });

  it('⭐ 零站点知识(七字段全部与站点无关)', () => {
    for (const f of files) {
      const code = read(f);
      expect(code, `${f} 混进了站点知识`).not.toMatch(/x\.com|twitter|chatgpt|claude\.ai|gemini|tweet/i);
    }
  });
});
