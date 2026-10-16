/**
 * ⭐⭐⭐ 载荷完整性 —— **本层既不截断也不丢弃**
 *
 * ── 用户 2026-10-02(两句话,第二句推翻了第一次修法)──
 *
 * ① 「被我们自己设的上限挡了…这个**最不应该,自废武功**。」
 *    → 我把「超限丢弃」改成了「截断并标注」。
 * ② 「什么叫截断并标注?我们要保持获取到的信息的**完整性**,而不是片段哦。」
 *    → ⭐ 对的,我停在了半道上。
 *
 * **截断只是比丢弃好,它仍然交出残缺数据。**
 * 对 X 的 GraphQL 来说半条 JSON 等于没有(下游 `JSON.parse` 必炸),
 * 那条推文/那个人照样丢 —— 标注只是让丢失**有记录**,不是让信息完整。
 * (`project-x-article-body-lost`:16081 字长文正文整片丢失,正是这种形态。)
 *
 * ⚠️ 本文件钉的是**最容易被将来某次「优化内存」改回去**的那条:
 * 容量是总量问题,该由条数/总字节配额管,**不该靠毁掉单条数据**。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NetworkEventBus } from '@platform/main/web-capability/net/bus';
import { CdpBodyProvider } from '@platform/main/web-capability/net/body-provider';
import type { PageId } from '@platform/main/web-capability/page/types';

const PAGE = 'page-1' as unknown as PageId;

/** 假 CDP 宿主 —— 只实现 provider 真正用到的那几个口 */
function fakeHost(bodyText: string) {
  const listeners: Array<(...a: unknown[]) => void> = [];
  const host = {
    hostId: 1,
    debugger: {
      isAttached: () => false,
      attach: () => undefined,
      sendCommand: async (method: string) => {
        if (method === 'Network.getResponseBody') {
          return { body: bodyText, base64Encoded: false };
        }
        return {};
      },
      on: (ev: string, l: (...a: unknown[]) => void) => {
        if (ev === 'message') listeners.push(l);
      },
    },
    onDestroyed: () => undefined,
  };
  /** 走一遍 CDP 的三段事件:发起 → 响应 → 完成 */
  const emit = (url: string) => {
    for (const l of listeners) {
      l({}, 'Network.requestWillBeSent', {
        requestId: 'cdp-1', request: { url, method: 'POST' }, type: 'Fetch',
      });
      l({}, 'Network.responseReceived', {
        requestId: 'cdp-1', response: { status: 200, mimeType: 'application/json', headers: {} },
      });
      l({}, 'Network.loadingFinished', { requestId: 'cdp-1' });
    }
  };
  return { host, emit };
}

/** 等微任务跑完(provider 取 body 是异步的) */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

describe('⭐⭐⭐ 载荷一律原样整条交出', () => {
  it('⭐⭐ 远超阈值的载荷**一个字节都不少**', async () => {
    /**
     * ⚠️ 这是本文件的头号判据。
     * 判「长度相等」还不够 —— 还要判**内容相同**:
     * 截断后前半段也可能碰巧等长(比如换成占位符)。
     */
    const bus = new NetworkEventBus();
    const url = 'https://x.com/i/api/graphql/abc/UserTweets';
    // 造一条「长文正文」级别的载荷
    const big = JSON.stringify({ text: 'x'.repeat(200_000) });
    const provider = new CdpBodyProvider(bus);

    const got: Uint8Array[] = [];
    bus.subscribe(PAGE, {}, (e) => {
      if (e.kind === 'response-complete' && e.bodyRef) {
        const b = bus.body(e.bodyRef);
        if (b.status === 'ok') got.push(b.value);
      }
    });
    // ⚠️ webRequest 侧必须有记录,否则关联失败(这正是真机那次卡住的地方)
    bus.recordRequestStart({
      requestId: 'wr-1', pageId: PAGE, url, method: 'POST',
      resourceType: 'xhr', startedAt: new Date().toISOString(),
    });

    const { host, emit } = fakeHost(big);
    // ⭐ 故意把阈值设得极小 —— 旧行为会在这里丢掉/截断整条
    provider.attach(host as never, PAGE, { resourceTypes: ['fetch'], maxBodyBytes: 1024 });
    emit(url);
    await settle();

    expect(got, '载荷没到手 —— 超过阈值被丢了?').toHaveLength(1);
    const text = new TextDecoder().decode(got[0]);
    expect(text.length, `载荷被截断了:拿到 ${text.length},原始 ${big.length}`).toBe(big.length);
    expect(text, '载荷内容与原始不一致').toBe(big);
    // ⭐ 真正证明完整:能解析回来
    expect(() => JSON.parse(text), '拿到的不是完整 JSON —— 半条等于没有').not.toThrow();
    expect(JSON.parse(text).text.length).toBe(200_000);
  });

  it('⭐ 超大仍然**报一声**,但报的是「已完整交出」不是失败', async () => {
    /**
     * ⚠️ 留痕是为了「内存涨了」时能回头看是哪些页面带来的,
     * **不表示任何数据被动过** —— 措辞错了会让人以为数据残了。
     */
    const bus = new NetworkEventBus();
    const url = 'https://x.com/i/api/graphql/abc/UserTweets';
    const misses: Array<{ reason: string; detail?: string }> = [];
    const provider = new CdpBodyProvider(bus, (m) => misses.push(m));

    bus.recordRequestStart({
      requestId: 'wr-1', pageId: PAGE, url, method: 'POST',
      resourceType: 'xhr', startedAt: new Date().toISOString(),
    });
    const { host, emit } = fakeHost('y'.repeat(5000));
    provider.attach(host as never, PAGE, { resourceTypes: ['fetch'], maxBodyBytes: 100 });
    emit(url);
    await settle();

    const hit = misses.find((m) => m.reason === 'oversize-kept');
    expect(hit, '超大没报一声 —— 内存涨了无从查起').toBeDefined();
    expect(hit!.detail, '措辞没说清数据是完整的').toMatch(/完整|未截断/);
  });

  it('⭐ 不设阈值时同样完整(默认行为不截断)', async () => {
    const bus = new NetworkEventBus();
    const url = 'https://x.com/i/api/graphql/abc/UserTweets';
    const big = 'z'.repeat(80_000);
    const provider = new CdpBodyProvider(bus);
    const got: string[] = [];
    bus.subscribe(PAGE, {}, (e) => {
      if (e.kind === 'response-complete' && e.bodyRef) {
        const b = bus.body(e.bodyRef);
        if (b.status === 'ok') got.push(new TextDecoder().decode(b.value));
      }
    });
    bus.recordRequestStart({
      requestId: 'wr-1', pageId: PAGE, url, method: 'POST',
      resourceType: 'xhr', startedAt: new Date().toISOString(),
    });
    const { host, emit } = fakeHost(big);
    provider.attach(host as never, PAGE, { resourceTypes: ['fetch'] });
    emit(url);
    await settle();

    expect(got[0]?.length, '不设阈值也被动了手脚').toBe(big.length);
  });
});

describe('⭐⭐ 源码层面:本层不许出现「切数据」的动作', () => {
  const src = readFileSync(
    resolve(__dirname, '../../src/platform/main/web-capability/net/body-provider.ts'),
    'utf-8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('⭐⭐ 取 body 之后不许 subarray / slice —— 那就是截断', () => {
    /**
     * ⚠️ 行为测试能抓住「现在被截了」,但抓不住「将来有人为了省内存
     * 加一刀」的各种写法。这条从**源码**上钉死:本层拿到 body 后不切。
     * ⭐ 切到 `fetchAndAttachBody` 函数体内,不整文件扫
     * (别处若有无关的 slice 不该误伤)。
     */
    const i = src.indexOf('private async fetchAndAttachBody');
    expect(i, 'fetchAndAttachBody 改名了?守卫要跟上').toBeGreaterThan(-1);
    const body = src.slice(i, src.indexOf('\n  }', src.indexOf('attachProviderBody', i)));
    expect(body.length, '切出来的函数体是空的 —— 断言会恒真').toBeGreaterThan(200);

    expect(body, '取到 body 后做了 subarray —— 那是截断,交出去的是片段')
      .not.toMatch(/\bbody\.subarray\s*\(/);
    expect(body, '取到 body 后做了 slice —— 同上')
      .not.toMatch(/\bbody\.slice\s*\(/);
  });

  it('⭐⭐ 超过 maxBodyBytes 不许 return —— 那是丢弃整条', () => {
    /**
     * ⚠️ 旧行为就是这个:`if (… > policy.maxBodyBytes) return;`
     * 整条载荷消失,而调用方看到的是「没捕到」。
     * ⭐ 判据:maxBodyBytes 那个 if 的**块体里不许有 return**。
     */
    const i = src.indexOf('policy.maxBodyBytes !== undefined');
    expect(i, 'maxBodyBytes 的判断不见了').toBeGreaterThan(-1);
    const block = src.slice(i, src.indexOf('\n    }', i));
    expect(block.length, '切出来的块是空的').toBeGreaterThan(30);
    expect(block, '超限时 return 了 —— 整条载荷会消失,调用方看到的是「没捕到」')
      .not.toMatch(/\breturn\b/);
  });

  it('⭐ 交给总线的必须是原始 body 变量', () => {
    /** ⚠️ 防「换了个变量名偷偷传截断版」 */
    const i = src.indexOf('attachProviderBody');
    const call = src.slice(i, src.indexOf('});', i));
    expect(call, '传给总线的不是原始 body').toMatch(/\bbody,/);
  });
});

describe('⭐⭐ 在途取回计数(2026-10-16,收尾要等它归零)', () => {
  /** 可控的 getResponseBody:手动放行 / 让它失败 */
  function slowHost() {
    const listeners: Array<(...a: unknown[]) => void> = [];
    let release: (() => void) | null = null;
    let fail: ((e: Error) => void) | null = null;
    const host = {
      hostId: 7,
      debugger: {
        isAttached: () => false,
        attach: () => undefined,
        sendCommand: (method: string) => (method === 'Network.getResponseBody'
          ? new Promise((res, rej) => { release = () => res({ body: '{}', base64Encoded: false }); fail = rej; })
          : Promise.resolve({})),
        on: (ev: string, l: (...a: unknown[]) => void) => { if (ev === 'message') listeners.push(l); },
      },
      onDestroyed: () => undefined,
    };
    const emit = (id: string): void => {
      for (const l of listeners) {
        l({}, 'Network.requestWillBeSent', { requestId: id, request: { url: 'https://x.com/i/api/graphql/q/UserTweets?variables=1', method: 'GET' }, type: 'Fetch' });
        l({}, 'Network.responseReceived', { requestId: id, response: { status: 200, mimeType: 'application/json', headers: {} } });
        l({}, 'Network.loadingFinished', { requestId: id });
      }
    };
    return { host, emit, release: () => release?.(), fail: () => fail?.(new Error('No resource with given identifier')) };
  }

  it('取回期间算在途;取完归零', async () => {
    const provider = new CdpBodyProvider(new NetworkEventBus());
    const h = slowHost();
    provider.attach(h.host as never, PAGE);
    h.emit('r1');
    await settle();
    expect(provider.inFlight(PAGE), '加载完了还在取 body —— 必须算在途').toBe(1);
    h.release();
    await settle();
    expect(provider.inFlight(PAGE)).toBe(0);
  });

  it('⚠️ 取回失败也要归零(漏减 = 收尾每次白等满上限)', async () => {
    const provider = new CdpBodyProvider(new NetworkEventBus());
    const h = slowHost();
    provider.attach(h.host as never, PAGE);
    h.emit('r2');
    await settle();
    expect(provider.inFlight(PAGE)).toBe(1);
    h.fail();
    await settle();
    expect(provider.inFlight(PAGE)).toBe(0);
  });
});
