/**
 * ⭐ 两条腿合并:只有之前那份**来自 CDP** 才标 both(2026-10-16 真机)
 *
 * 钩子把同一条收到两次时,第二次撞上第一次(hook)被错标成 both →
 * 出现「both 却 0 个请求头」,腿计数也虚高,把种子没头的排查指错了方向。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, webContents: { fromId: () => null }, session: {} }));

describe('mergedItems 的腿标记', async () => {
  const eng = await import('@platform/main/web-capability/wiring/web-collect-engine');
  const PID = 'page-merge' as never;
  const x = (from: string, headers?: Record<string, string>) => ({
    url: 'https://x.com/i/api/graphql/q/ViewerBadgeCounts?variables=1', method: 'GET', status: 200,
    text: '{"a":1}', byteLength: 7, at: '2026-10-16T00:00:00.000Z', requestHeaders: headers, from,
  });

  it('钩子重复两份 → 仍是 hook,不是 both', () => {
    eng.sessionsByPageId.set(PID, { list: () => [] } as never);
    eng.hooksByPageId.set(PID, { list: () => [x('hook'), x('hook')] } as never);
    const m = eng.mergedItems(PID, 10);
    expect(m.map((i) => i.from)).toEqual(['hook']);
  });

  it('CDP + 钩子 → both,且保留 CDP 的请求头', () => {
    eng.sessionsByPageId.set(PID, { list: () => [x('cdp', { authorization: 'B' })] } as never);
    eng.hooksByPageId.set(PID, { list: () => [x('hook')] } as never);
    const m = eng.mergedItems(PID, 10);
    expect(m.map((i) => i.from)).toEqual(['both']);
    expect(Object.keys(m[0].requestHeaders ?? {})).toEqual(['authorization']);
  });
});

describe('⭐⭐⭐ 去重看整段内容,不看前 256 字(2026-10-16 真机:浏览器收到 49 页,合并后剩 2 页)', async () => {
  const eng = await import('@platform/main/web-capability/wiring/web-collect-engine');
  const PID = 'page-dedup' as never;
  /** 同一个接口、开头 300 字一模一样(JSON 外壳),后面的推文不同 —— 翻页的真实形状 */
  const shell = `{"data":{"search_by_raw_query":{"search_timeline":{"timeline":{"instructions":[${' '.repeat(260)}`;
  const page = (n: number, from: string) => ({
    url: `https://x.com/i/api/graphql/q/SearchTimeline?variables=${n}`, method: 'GET', status: 200,
    text: `${shell}{"entryId":"tweet-${n}"}]}}}}}`, byteLength: 1, at: `2026-10-16T00:00:${String(n).padStart(2, '0')}.000Z`, from,
  });

  it('49 页开头相同、内容不同 → 49 页都在', () => {
    const pages = Array.from({ length: 49 }, (_, i) => page(i, 'cdp'));
    eng.sessionsByPageId.set(PID, { list: () => pages } as never);
    eng.hooksByPageId.set(PID, { list: () => [] } as never);
    expect(eng.mergedItems(PID, 1000)).toHaveLength(49);
  });

  it('同一条响应两条腿各一份 → 仍合成一条(both)', () => {
    eng.sessionsByPageId.set(PID, { list: () => [page(1, 'cdp')] } as never);
    eng.hooksByPageId.set(PID, { list: () => [page(1, 'hook')] } as never);
    const m = eng.mergedItems(PID, 10);
    expect(m.map((i) => i.from)).toEqual(['both']);
  });

  it('dedupKey:前缀相同、后面不同 → 键不同', () => {
    const a = page(1, 'cdp'); const b = page(2, 'cdp');
    expect(eng.dedupKey(a.url, 200, a.text)).not.toBe(eng.dedupKey(b.url, 200, b.text));
  });
});
