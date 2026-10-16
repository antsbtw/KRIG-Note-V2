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
