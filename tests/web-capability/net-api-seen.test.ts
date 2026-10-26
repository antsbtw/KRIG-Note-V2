/**
 * ⭐ 诊断:浏览器实际发出的接口请求计数(2026-10-16)
 * 起因:X 搜索页滚了 9.4 万像素、页面显示 100+ 人,却只收到 1 条时间线载荷 ——
 * 要能对照「浏览器发了什么」与「我们收到什么」,才知道漏采在哪一层。
 */
import { describe, it, expect } from 'vitest';
import { NetworkEventBus } from '@platform/main/web-capability/net/bus';
import { CdpBodyProvider } from '@platform/main/web-capability/net/body-provider';
import { harvestPage } from '@platform/main/web-capability/harvest/harvest';
import type { HarvestDeps } from '@platform/main/web-capability/harvest/types';
import type { PageId } from '@platform/main/web-capability/page/types';

const PAGE = 'page-1' as unknown as PageId;

function fakeHost() {
  const listeners: Array<(...a: unknown[]) => void> = [];
  const host = {
    hostId: 1,
    debugger: {
      isAttached: () => false, attach: () => undefined,
      sendCommand: async () => ({ body: '{}', base64Encoded: false }),
      on: (ev: string, l: (...a: unknown[]) => void) => { if (ev === 'message') listeners.push(l); },
    },
    onDestroyed: () => undefined,
  };
  let n = 0;
  const emit = (url: string, method: string, type: string, outcome: { status: number } | { fail: string }) => {
    n += 1; const id = `r${n}`;
    for (const l of listeners) {
      l({}, 'Network.requestWillBeSent', { requestId: id, request: { url, method }, type });
      if ('status' in outcome) {
        l({}, 'Network.responseReceived', { requestId: id, response: { status: outcome.status, mimeType: 'application/json', headers: {} } });
        l({}, 'Network.loadingFinished', { requestId: id });
      } else {
        l({}, 'Network.loadingFailed', { requestId: id, errorText: outcome.fail, canceled: true });
      }
    }
  };
  return { host, emit };
}

describe('CdpBodyProvider.apiSeen', () => {
  it('⭐ 按「方法 完整路径 状态」计数(对账要拿页面判据匹配路径);策略不取 / 失败也记;非 /api/ 不记', () => {
    const provider = new CdpBodyProvider(new NetworkEventBus());
    const { host, emit } = fakeHost();
    provider.attach(host as never, PAGE, { resourceTypes: ['fetch'] });
    emit('https://x.com/i/api/graphql/AAA/SearchTimeline?variables=1', 'POST', 'Fetch', { status: 200 });
    emit('https://x.com/i/api/graphql/BBB/SearchTimeline', 'POST', 'Fetch', { status: 429 });
    emit('https://x.com/i/api/1.1/flow/timeline.json', 'POST', 'Ping', { status: 200 });
    emit('https://x.com/i/api/graphql/CCC/UserTweets', 'GET', 'Fetch', { fail: 'net::ERR_ABORTED' });
    emit('https://abs.twimg.com/x.js', 'GET', 'Script', { status: 200 });
    expect(provider.apiSeen(PAGE)).toEqual({
      'POST /i/api/graphql/AAA/SearchTimeline 200': 1,
      'POST /i/api/graphql/BBB/SearchTimeline 429': 1,
      'POST /i/api/1.1/flow/timeline.json 200 [策略不取]': 1,
      'GET /i/api/graphql/CCC/UserTweets ? [失败:net::ERR_ABORTED 取消]': 1,
    });
  });
});

describe('harvestPage 报告带 apiSeen —— 只算这一跑新增的', () => {
  it('收尾减起点;没给计数器就不报', async () => {
    let seen: Record<string, number> = { 'POST /i/api/graphql/q/SearchTimeline 200': 5 };
    const base: HarvestDeps = {
      startAcquire: async () => ({ ok: true, cdpAttached: true, hookInstalled: true }),
      peekAcquire: () => [],
      cdpInFlight: () => 0,
      finishAcquire: () => ({ ok: true, problems: [], items: [], elapsedMs: 1, legs: { cdp: 0, hook: 0, both: 0, hookInjected: true, cdpAttached: true } }),
      reload: () => { seen = { 'POST /i/api/graphql/q/SearchTimeline 200': 8, 'POST /i/api/1.1/flow/timeline.json 200': 3 }; },
      goto: async () => true,
      scroll: async () => ({ rounds: 1, scrolledPx: 1, reachedBottom: true, stopReason: 'x' }),
      runScript: async () => undefined,
      wait: async () => undefined,
      now: () => 0,
    } as unknown as HarvestDeps;
    const rep = await harvestPage({ ...base, apiSeen: () => seen }, PAGE, { maxRounds: 1 });
    expect(rep.apiSeen).toEqual({ 'POST /i/api/graphql/q/SearchTimeline 200': 3, 'POST /i/api/1.1/flow/timeline.json 200': 3 });
    const none = await harvestPage(base, PAGE, { maxRounds: 1 });
    expect(none.apiSeen).toBeUndefined();
  });
});

describe('⭐⭐⭐ 对账:浏览器收到 vs 我们采到(用户 10-16:「这是基本函数/功能,必须保证的哦」)', () => {
  const TL = 're:/i/api/graphql/[^/]+/\\w*Timeline(\\?|$)';
  const item = (url: string) => ({ url, method: 'GET', status: 200, text: url, byteLength: 1, at: new Date().toISOString(), from: 'cdp' as const });
  function run(seenAfter: Record<string, number>, captured: string[]) {
    let seen: Record<string, number> = {};
    const d = {
      startAcquire: async () => ({ ok: true, cdpAttached: true, hookInstalled: true }),
      peekAcquire: () => captured.map(item),
      cdpInFlight: () => 0,
      apiSeen: () => seen,
      finishAcquire: () => ({ ok: true, problems: [], items: captured.map(item), elapsedMs: 1, legs: { cdp: 0, hook: 0, both: 0, hookInjected: true, cdpAttached: true } }),
      reload: () => { seen = seenAfter; },
      goto: async () => true,
      scroll: async () => ({ rounds: 1, scrolledPx: 1, reachedBottom: true, stopReason: 'x' }),
      runScript: async () => undefined,
      wait: async () => undefined,
      now: () => 0,
    } as unknown as HarvestDeps;
    return harvestPage(d, PAGE, { maxRounds: 1, pageUrlIncludes: [TL] });
  }

  it('⭐⭐ 真机那一跑:浏览器收到 19 次,采到 2 页 → 漏采 17 页,第一条问题,ok=false', async () => {
    const rep = await run({
      'GET /i/api/graphql/q/SearchTimeline 200': 19,
      'GET /i/api/graphql/q/SearchTimeline 429': 1,
      'GET /i/api/fleets/v1/avatar_content 200': 44,
    }, ['https://x.com/i/api/graphql/q/SearchTimeline?c=1', 'https://x.com/i/api/graphql/q/SearchTimeline?c=2']);
    expect(rep.completeness).toEqual({ seen: 19, captured: 2 });
    expect(rep.ok).toBe(false);
    expect(rep.problems[0]).toContain('漏采:浏览器收到目标数据 19 次,只采到 2 页');
  });

  it('一页不少 → 不报;429 / 失败 / 策略不取 不算「收到」', async () => {
    const rep = await run({
      'GET /i/api/graphql/q/SearchTimeline 200': 2,
      'GET /i/api/graphql/q/SearchTimeline 429': 3,
      'GET /i/api/graphql/q/SearchTimeline ? [失败:net::ERR_ABORTED 取消]': 2,
      'POST /i/api/graphql/q/HomeTimeline 200 [策略不取]': 1,
    }, ['https://x.com/i/api/graphql/q/SearchTimeline?c=1', 'https://x.com/i/api/graphql/q/SearchTimeline?c=2']);
    expect(rep.completeness).toEqual({ seen: 2, captured: 2 });
    expect(rep.problems.some((p) => p.includes('漏采'))).toBe(false);
  });

  it('⭐⭐ 采到的比浏览器这一跑收到的还多 → 报「混进了不属于这一跑的数据」(10-16:钩子池残留上一跑)', async () => {
    const rep = await run({ 'GET /i/api/graphql/q/SearchTimeline 200': 1 }, [
      'https://x.com/i/api/graphql/q/SearchTimeline?c=old1', 'https://x.com/i/api/graphql/q/SearchTimeline?c=old2',
      'https://x.com/i/api/graphql/q/SearchTimeline?c=new',
    ]);
    expect(rep.completeness).toEqual({ seen: 1, captured: 3 });
    expect(rep.ok).toBe(false);
    expect(rep.problems[0]).toContain('混进了不属于这一跑的数据');
  });
});
