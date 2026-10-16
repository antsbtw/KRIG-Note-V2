/**
 * ⭐⭐⭐ 后台断点真的一路传到采集引擎(2026-10-14 真机抓到)
 *
 * 现象:重启后 3 段共 30 页,游标从 10-10 05:00 走到 10-10 06:00(反而新了),
 * 10-09 那天库里 60 条只碰到 2 条 —— 每段都从第一页重翻 10 页。
 * 根因:runSegment 给了 resumeCursor,但 runner 的 runOne 没传给 collectPersonTab,
 * collectPersonTab 也不收不转。3b 只在 collectOnWebview 一层测了续采(那层是对的),
 * 中间两跳丢了它,tsc 不报(可选字段少传合法)。
 * ⭐ 这里用**行为测试**(mock 下一层、看参数真到了),不用源码扫描。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const seen: { collectPersonTab: unknown[]; collectOnWebview: unknown[] } = { collectPersonTab: [], collectOnWebview: [] };

vi.mock('@modules/x/x-collect-on-webview', () => ({
  collectOnWebview: vi.fn(async (_ports: unknown, input: unknown) => {
    seen.collectOnWebview.push(input);
    return { reached: true, records: [], paging: { rounds: 1, stopReason: '' }, exhausted: false };
  }),
}));
vi.mock('@modules/x/x-collect-ports', () => ({ webviewPorts: vi.fn(() => ({})) }));
vi.mock('@platform/main/web-capability/wiring/runtime', () => ({ traceRecorder: { lifecycle: vi.fn() } }));
vi.mock('@modules/x/x-tweet-repo', () => ({ saveTweets: vi.fn(async () => ({ inserted: 0, updated: 0, failed: [] })) }));

import { collectPersonTab } from '@modules/x/x-person-collect';
import type { BgJob } from '@modules/x/x-bg-job';

describe('⭐⭐⭐ 断点一路传到 collectOnWebview', () => {
  beforeEach(() => { seen.collectPersonTab.length = 0; seen.collectOnWebview.length = 0; });

  it('collectPersonTab 把 resumeCursor 转给 collectOnWebview', async () => {
    await collectPersonTab({ wcId: 7, page: 'x.profile', handle: 'a', restId: '1', pageCap: 10, attempt: 1, resumeCursor: 'CUR-10-10' });
    expect(seen.collectOnWebview).toHaveLength(1);
    expect((seen.collectOnWebview[0] as { resumeCursor?: string }).resumeCursor).toBe('CUR-10-10');
  });

  it('runner 的 runOne 把 runSegment 给的断点传给 collectPersonTab(端到端到引擎)', async () => {
    const { makeSegmentDeps } = await import('@modules/x/x-bg-runner');
    const job = {
      id: 'j', restId: '1', handle: 'a', wsId: 'ws-1', range: 'halfYear', status: 'running',
      profile: { cursor: 'CUR-10-10', done: false }, replies: { done: false }, reposts: { done: false },
      totalPages: 10, totalSaved: 0, createdAt: '', updatedAt: '',
    } as BgJob;
    const deps = makeSegmentDeps(7, job, new Date());
    await deps.runOne({ page: 'x.profile', handle: 'a', resumeCursor: 'CUR-10-10', pageCap: 10 });
    expect((seen.collectOnWebview[0] as { resumeCursor?: string }).resumeCursor).toBe('CUR-10-10');
  });
});
