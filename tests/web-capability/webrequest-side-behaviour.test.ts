/**
 * ⭐⭐ webRequest 侧 —— **真调函数**,假的只有 Electron session
 *
 * ── 为什么光有源码守卫不够 ──
 *
 * `net-webrequest-side-wired.test.ts` 扫的是「生产代码里有人调 recordRequestStart」。
 * 它答不了两件要紧的事:
 *  ① 拿不到 webContentsId 时会不会**乱猜**一个 pageId
 *  ② 同一个 session 挂两次会不会**覆盖**(Electron 每 session 只许一个监听器)
 *
 * ⭐ 「会不会执行」「执行成什么样」只能真跑 ——
 * 今天刚为此栽过一次(记忆 feedback-source-scan-cant-see-execution)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** 假 session:把注册进来的监听器抓在手里,便于手工触发 */
const listeners: Record<string, ((d: unknown, cb?: unknown) => void) | undefined> = {};
let fromPartitionCalls: string[] = [];

vi.mock('electron', () => ({
  session: {
    fromPartition: (p: string) => {
      fromPartitionCalls.push(p);
      return {
        webRequest: {
          onBeforeRequest: (fn: (d: unknown, cb: unknown) => void) => { listeners.before = fn; },
          onCompleted: (fn: (d: unknown) => void) => { listeners.completed = fn; },
        },
      };
    },
  },
}));

import {
  wireWebRequestSide, registerPageIdLookup, resetWebRequestWiring,
} from '@platform/main/web-capability/wiring/webrequest-side';
import type { PageId } from '@platform/main/web-capability/page/types';

const starts: unknown[] = [];
const completes: unknown[] = [];
const fakeBus = {
  recordRequestStart: (r: unknown) => { starts.push(r); },
  recordResponseComplete: (r: unknown) => { completes.push(r); },
} as never;

const details = (over: Record<string, unknown> = {}) => ({
  id: 42, url: 'https://x.com/i/api/graphql/UserByScreenName?x=1',
  method: 'GET', resourceType: 'xhr', timestamp: 1_700_000_000_000,
  webContentsId: 7, ...over,
});

beforeEach(() => {
  starts.length = 0; completes.length = 0;
  fromPartitionCalls = [];
  delete listeners.before; delete listeners.completed;
  resetWebRequestWiring();
});

describe('⭐⭐ 请求真的进了 bus', () => {
  it('⭐⭐ 映射得到已登记页面 → 记一条,且 callback 照常放行', () => {
    registerPageIdLookup(() => 'page-1' as PageId);
    wireWebRequestSide(fakeBus, 'persist:webview-ws-1');

    const cb = vi.fn();
    listeners.before!(details(), cb);

    expect(starts, '请求没进 bus —— candidatesFor 恒空,关联必然失败').toHaveLength(1);
    const rec = starts[0] as { pageId: string; url: string; requestId: string };
    expect(rec.pageId).toBe('page-1');
    expect(rec.requestId, 'requestId 没带上 —— 配不上 CDP 那侧').toBe('42');
    expect(cb, '⚠️ 没放行请求 —— 留痕挡住了真实流量,页面会卡死').toHaveBeenCalledWith({});
  });

  it('⭐ 完成时记响应(带状态码)', () => {
    registerPageIdLookup(() => 'page-1' as PageId);
    wireWebRequestSide(fakeBus, 'persist:webview-ws-1');

    listeners.completed!(details({ statusCode: 200 }));

    expect(completes).toHaveLength(1);
    expect((completes[0] as { status: number }).status).toBe(200);
  });
});

describe('⭐⭐ 拿不到身份时**丢掉,绝不猜**', () => {
  it('⭐⭐ 没有 webContentsId → 不记(service worker 等请求本就没有)', () => {
    /**
     * 猜一个 pageId 会把别的页面的流量关联到这个页面上 ——
     * 而那种错误在数据里**看不出来**。
     */
    registerPageIdLookup(() => 'page-1' as PageId);
    wireWebRequestSide(fakeBus, 'persist:webview-ws-1');

    listeners.before!(details({ webContentsId: undefined }), vi.fn());

    expect(starts, '没有身份却记了一条 —— 关联会张冠李戴').toHaveLength(0);
  });

  it('⭐⭐ 页面没登记(反查返回 null)→ 不记', () => {
    registerPageIdLookup(() => null);
    wireWebRequestSide(fakeBus, 'persist:webview-ws-1');

    listeners.before!(details(), vi.fn());

    expect(starts).toHaveLength(0);
  });

  it('⭐⭐ 没注册反查 → 不记,但要 warn(静默会指错排查方向)', () => {
    /**
     * 静默不记会让「关联失败」看起来像 CDP 侧的问题,
     * 而真因在这一侧 —— 排查方向完全相反。
     */
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    wireWebRequestSide(fakeBus, 'persist:webview-ws-1');   // 没 registerPageIdLookup

    listeners.before!(details(), vi.fn());

    expect(starts).toHaveLength(0);
    expect(warn, '没注册反查却静默了').toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('⭐⭐ 幂等:同一 session 只挂一次', () => {
  it('⭐⭐ 重复接线不重复挂(Electron 每 session 只许一个监听器,后挂的会覆盖)', () => {
    registerPageIdLookup(() => 'page-1' as PageId);
    wireWebRequestSide(fakeBus, 'persist:webview-ws-1');
    wireWebRequestSide(fakeBus, 'persist:webview-ws-1');
    wireWebRequestSide(fakeBus, 'persist:webview-ws-1');

    expect(
      fromPartitionCalls.filter((p) => p === 'persist:webview-ws-1'),
      '同一 partition 挂了多次 —— 后挂的会覆盖先挂的,这一侧会悄悄失效',
    ).toHaveLength(1);
  });

  it('⭐ 不同 ws 各挂各的(per-ws session 是独立的)', () => {
    registerPageIdLookup(() => 'page-1' as PageId);
    wireWebRequestSide(fakeBus, 'persist:webview-ws-1');
    wireWebRequestSide(fakeBus, 'persist:webview-ws-2');

    expect(fromPartitionCalls).toEqual(['persist:webview-ws-1', 'persist:webview-ws-2']);
  });
});

describe('⭐ 留痕出错不许挡住真实流量', () => {
  it('⭐⭐ bus 抛异常时,请求照样放行', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerPageIdLookup(() => 'page-1' as PageId);
    const throwingBus = {
      recordRequestStart: () => { throw new Error('bus 炸了'); },
      recordResponseComplete: () => {},
    } as never;
    wireWebRequestSide(throwingBus, 'persist:webview-ws-9');

    const cb = vi.fn();
    expect(() => listeners.before!(details(), cb)).not.toThrow();
    expect(cb, '⚠️ 留痕失败把请求掐了 —— 页面会白屏').toHaveBeenCalledWith({});
    warn.mockRestore();
  });
});
