/**
 * `web.net` 事件总线行为 —— 分发隔离 / 过滤 / 三态 / 内存上限
 *
 * 命脉三条在 `net-channel-faults.test.ts`;本文件测其余验收项(`07` §2.2):
 *  - 载荷按 pageId 正确分发(两个页面各订阅,**不串**)
 *  - 三态结果:失败返回 Failed,**不返回空数组/空 bytes 假装成功**
 *  - 内存上限生效:超过 MAX_* 后老化,不无限增长
 */
import { describe, it, expect, vi } from 'vitest';
import { NetworkEventBus } from '@platform/main/web-capability/net';
import type { NetworkEvent, NetworkRecord } from '@platform/main/web-capability/net';
import type { PageId } from '@platform/main/web-capability/page';

const A = 'page_a' as PageId;
const B = 'page_b' as PageId;

function rec(over: Partial<NetworkRecord> & { requestId: string; pageId: PageId }): NetworkRecord {
  return {
    url: 'https://x.com/api/graphql/Timeline',
    method: 'GET',
    startedAt: '2026-09-08T10:00:00.000Z',
    ...over,
  };
}

describe('⭐ 载荷按 pageId 分发 —— 不串台', () => {
  it('⭐ 两个页面各自订阅,只收到自己那份', () => {
    // 这正是记忆 project-ws-instance-isolation-invariant 记的那类事故的底座侧防线
    const bus = new NetworkEventBus();
    const aEvents: NetworkEvent[] = [];
    const bEvents: NetworkEvent[] = [];
    bus.subscribe(A, {}, (e) => { aEvents.push(e); });
    bus.subscribe(B, {}, (e) => { bEvents.push(e); });

    bus.recordRequestStart(rec({ requestId: 'r1', pageId: A }));
    bus.recordRequestStart(rec({ requestId: 'r2', pageId: B }));
    bus.recordRequestStart(rec({ requestId: 'r3', pageId: B }));

    expect(aEvents).toHaveLength(1);
    expect(bEvents).toHaveLength(2);
    expect(aEvents.every((e) => e.pageId === A)).toBe(true);
    expect(bEvents.every((e) => e.pageId === B)).toBe(true);
  });

  it('⭐ list 也按 pageId 隔离', () => {
    const bus = new NetworkEventBus();
    bus.recordRequestStart(rec({ requestId: 'r1', pageId: A }));
    bus.recordRequestStart(rec({ requestId: 'r2', pageId: B }));
    expect(bus.list(A).map((r) => r.requestId)).toEqual(['r1']);
    expect(bus.list(B).map((r) => r.requestId)).toEqual(['r2']);
  });

  it('从没有记录的页面 list 返回空数组(如实说没有,不借别的页面的)', () => {
    const bus = new NetworkEventBus();
    bus.recordRequestStart(rec({ requestId: 'r1', pageId: A }));
    expect(bus.list(B)).toEqual([]);
  });

  it('unsubscribe 后不再收到', () => {
    const bus = new NetworkEventBus();
    const events: NetworkEvent[] = [];
    const un = bus.subscribe(A, {}, (e) => { events.push(e); });
    bus.recordRequestStart(rec({ requestId: 'r1', pageId: A }));
    un();
    bus.recordRequestStart(rec({ requestId: 'r2', pageId: A }));
    expect(events).toHaveLength(1);
    expect(bus.subscriberCount(A)).toBe(0);
  });
});

describe('订阅过滤', () => {
  it('kinds 过滤:只订 response-complete 就收不到 request-start', () => {
    const bus = new NetworkEventBus();
    const events: NetworkEvent[] = [];
    bus.subscribe(A, { kinds: ['response-complete'] }, (e) => { events.push(e); });
    bus.recordRequestStart(rec({ requestId: 'r1', pageId: A }));
    bus.recordResponseComplete(rec({ requestId: 'r1', pageId: A, status: 200 }));
    expect(events.map((e) => e.kind)).toEqual(['response-complete']);
  });

  it('urlIncludes 过滤 request-start', () => {
    const bus = new NetworkEventBus();
    const events: NetworkEvent[] = [];
    bus.subscribe(A, { urlIncludes: '/graphql/' }, (e) => { events.push(e); });
    bus.recordRequestStart(rec({ requestId: 'r1', pageId: A, url: 'https://x.com/api/graphql/T' }));
    bus.recordRequestStart(rec({ requestId: 'r2', pageId: A, url: 'https://x.com/static/a.js' }));
    expect(events).toHaveLength(1);
  });

  it('urlIncludes 对 response-complete 生效(靠 requestId 回查 url)', () => {
    const bus = new NetworkEventBus();
    const events: NetworkEvent[] = [];
    bus.recordRequestStart(rec({ requestId: 'r1', pageId: A, url: 'https://x.com/api/graphql/T' }));
    bus.recordRequestStart(rec({ requestId: 'r2', pageId: A, url: 'https://x.com/static/a.js' }));
    bus.subscribe(A, { kinds: ['response-complete'], urlIncludes: '/graphql/' }, (e) => { events.push(e); });
    bus.recordResponseComplete(rec({ requestId: 'r1', pageId: A, url: 'https://x.com/api/graphql/T', status: 200 }));
    bus.recordResponseComplete(rec({ requestId: 'r2', pageId: A, url: 'https://x.com/static/a.js', status: 200 }));
    expect(events).toHaveLength(1);
  });

  it('⭐ 一个坏订阅者不拖垮其它订阅者,且留痕(不静默吞)', () => {
    const bus = new NetworkEventBus();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good: NetworkEvent[] = [];
    bus.subscribe(A, {}, () => { throw new Error('坏订阅者'); });
    bus.subscribe(A, {}, (e) => { good.push(e); });

    expect(() => bus.recordRequestStart(rec({ requestId: 'r1', pageId: A }))).not.toThrow();
    expect(good).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('⭐ 三态结果 —— 失败不返回空值假装成功', () => {
  it('⭐ body 取不到返回 Failed,**不是空 Uint8Array**', () => {
    // 空 body 和「body 已被淘汰」是两件完全不同的事,混起来就是静默坍缩
    const bus = new NetworkEventBus();
    const result = bus.body('body_nonexistent');
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('unreachable');
    expect(result.reason).toContain('body not available');
  });

  it('body 存在时返回 Ok 且内容一致', () => {
    const bus = new NetworkEventBus();
    const payload = new TextEncoder().encode('{"data":1}');
    bus.recordResponseComplete(rec({ requestId: 'r1', pageId: A, status: 200 }), payload);
    const stored = bus.list(A)[0];
    expect(stored.bodyRef).toBeDefined();
    expect(stored.bodyBytes).toBe(payload.byteLength);

    const got = bus.body(stored.bodyRef!);
    expect(got.status).toBe('ok');
    if (got.status !== 'ok') throw new Error('unreachable');
    expect(new TextDecoder().decode(got.value)).toBe('{"data":1}');
  });

  it('⭐ waitFor 超时返回 Failed(retryable),**不返回 null**', async () => {
    const bus = new NetworkEventBus();
    const result = await bus.waitFor(A, { urlIncludes: '/never' }, 20);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('unreachable');
    expect(result.reason).toContain('超时');
    expect(result.retryable).toBe(true);
  });

  it('waitFor 命中已有记录时立刻 Ok', async () => {
    const bus = new NetworkEventBus();
    bus.recordRequestStart(rec({ requestId: 'r1', pageId: A, url: 'https://x.com/api/graphql/T' }));
    const result = await bus.waitFor(A, { urlIncludes: '/graphql/' }, 1_000);
    expect(result.status).toBe('ok');
  });

  it('waitFor 等到后续到达的请求', async () => {
    const bus = new NetworkEventBus();
    const pending = bus.waitFor(A, { urlIncludes: '/graphql/' }, 1_000);
    bus.recordRequestStart(rec({ requestId: 'r1', pageId: A, url: 'https://x.com/api/graphql/T' }));
    const result = await pending;
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('unreachable');
    expect(result.value.requestId).toBe('r1');
  });
});

describe('⭐ 内存上限 —— 不无限增长', () => {
  it(`⭐ 单页请求数封顶在 ${NetworkEventBus.MAX_REQUESTS_PER_PAGE},老的被淘汰`, () => {
    const bus = new NetworkEventBus();
    const total = NetworkEventBus.MAX_REQUESTS_PER_PAGE + 50;
    for (let i = 0; i < total; i++) {
      bus.recordRequestStart(rec({ requestId: `r${i}`, pageId: A }));
    }
    const list = bus.list(A);
    expect(list).toHaveLength(NetworkEventBus.MAX_REQUESTS_PER_PAGE);
    // 保留的是**最近的**,最老的被淘汰
    expect(list[list.length - 1].requestId).toBe(`r${total - 1}`);
    expect(list.some((r) => r.requestId === 'r0')).toBe(false);
  });

  it(`⭐ body 数封顶在 ${NetworkEventBus.MAX_RESPONSE_BODIES},淘汰后 body() 返回 Failed 而不是空`, () => {
    const bus = new NetworkEventBus();
    const refs: string[] = [];
    for (let i = 0; i < NetworkEventBus.MAX_RESPONSE_BODIES + 10; i++) {
      bus.recordResponseComplete(
        rec({ requestId: `r${i}`, pageId: A, status: 200 }),
        new TextEncoder().encode(`body-${i}`),
      );
      const r = bus.list(A).find((x) => x.requestId === `r${i}`);
      refs.push(r!.bodyRef!);
    }
    // 最早的那些已被淘汰 —— 关键是它**明确失败**,不是静默给空
    const oldest = bus.body(refs[0]);
    expect(oldest.status).toBe('failed');
    // 最新的还在
    const newest = bus.body(refs[refs.length - 1]);
    expect(newest.status).toBe('ok');
  });

  it('同一 requestId 重复记录不会撑大列表(去重覆盖)', () => {
    const bus = new NetworkEventBus();
    for (let i = 0; i < 100; i++) {
      bus.recordRequestStart(rec({ requestId: 'same', pageId: A }));
    }
    expect(bus.list(A)).toHaveLength(1);
  });
});

describe('list 过滤与 downloads', () => {
  it('按 urlIncludes / resourceType / limit 过滤', () => {
    const bus = new NetworkEventBus();
    bus.recordRequestStart(rec({ requestId: 'r1', pageId: A, url: 'https://x.com/api/a', resourceType: 'xhr' }));
    bus.recordRequestStart(rec({ requestId: 'r2', pageId: A, url: 'https://x.com/api/b', resourceType: 'fetch' }));
    bus.recordRequestStart(rec({ requestId: 'r3', pageId: A, url: 'https://x.com/img/c', resourceType: 'image' }));

    expect(bus.list(A, { urlIncludes: '/api/' })).toHaveLength(2);
    // xhr 与 fetch 归一后同类 —— 两条都命中
    expect(bus.list(A, { resourceType: 'fetch' })).toHaveLength(2);
    expect(bus.list(A, { limit: 1 })).toHaveLength(1);
  });

  it('downloads 按页面隔离,completed 才发事件', () => {
    const bus = new NetworkEventBus();
    const events: NetworkEvent[] = [];
    bus.subscribe(A, {}, (e) => { events.push(e); });

    bus.recordDownload({
      downloadId: 'd1', pageId: A, url: 'https://x.com/f.zip', filename: 'f.zip',
      status: 'started', startedAt: new Date().toISOString(),
    });
    expect(events.some((e) => e.kind === 'download-complete')).toBe(false);

    bus.recordDownload({
      downloadId: 'd1', pageId: A, url: 'https://x.com/f.zip', filename: 'f.zip',
      status: 'completed', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    });
    expect(events.some((e) => e.kind === 'download-complete')).toBe(true);
    expect(bus.downloads(A)).toHaveLength(1);
    expect(bus.downloads(B)).toEqual([]);
  });
});
