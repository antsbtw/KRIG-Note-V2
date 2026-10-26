/**
 * ⭐ 名单任务也要「第一轮翻页没带鉴权头 → 重载再试一次」(2026-10-20 真机:关注者全量第 94 页撞上,一次就判失败)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const NO_AUTH = '有 1 条翻页请求但都没带鉴权头 —— 不拿必 403 的种子去撞';
const queue: Array<Record<string, unknown>> = [];
let calls = 0;
vi.mock('@modules/x/x-person-list-collect', () => ({
  collectPersonListSegment: vi.fn(async () => { calls += 1; const r = queue.shift(); if (!r) throw new Error('没准备返回值'); return r; }),
}));
vi.mock('@modules/x/x-collect-ports', () => ({ webviewPorts: vi.fn(() => ({})) }));
vi.mock('@platform/main/web-capability/wiring/runtime', () => ({ traceRecorder: { lifecycle: vi.fn() } }));
vi.mock('@modules/x/x-tweet-repo', () => ({ saveTweets: vi.fn() }));

import { makeSegmentDeps } from '@modules/x/x-bg-runner';
import type { BgJob } from '@modules/x/x-bg-job';

const job = {
  id: 'L', restId: 'ME', handle: 'me', wsId: 'ws-1', range: 'all', status: 'running', kind: 'lists', self: true,
  profile: { done: false }, replies: { done: false }, reposts: { done: false },
  followers: { done: false, cursor: 'C' }, following: { done: false }, verifiedFollowers: { done: false },
  totalPages: 0, totalSaved: 0, createdAt: '', updatedAt: '',
} as BgJob;
const run = () => makeSegmentDeps(7, job, new Date()).runOne({ tab: 'followers', page: 'x.followers', handle: 'me', resumeCursor: 'C', pageCap: 7 });

describe('名单任务重载重试', () => {
  beforeEach(() => { queue.length = 0; calls = 0; });
  it('第一次没带头 → 重载再试;第二次成功不算失败', async () => {
    queue.push({ pages: 0, saved: 0, exhausted: false, stopReason: NO_AUTH, failure: NO_AUTH }, { pages: 7, saved: 350, exhausted: false, stopReason: '本段翻够 7 页上限', nextCursor: 'C2' });
    const r = await run();
    expect(calls).toBe(2);
    expect(r.failure).toBeUndefined();
    expect(r.nextCursor).toBe('C2');
  });
  it('两次都没带头 → 失败停下(不无限重试)', async () => {
    queue.push({ pages: 0, saved: 0, exhausted: false, stopReason: NO_AUTH, failure: NO_AUTH }, { pages: 0, saved: 0, exhausted: false, stopReason: NO_AUTH, failure: NO_AUTH });
    const r = await run();
    expect(calls).toBe(2);
    expect(r.failure).toMatch(/重载后第 2 次仍失败/);
  });
  it('翻到一半才失败(不是模板问题)→ 不重试', async () => {
    queue.push({ pages: 5, saved: 250, exhausted: false, stopReason: `第 6 轮 ${NO_AUTH}`, failure: 'x' });
    await run();
    expect(calls).toBe(1);
  });
});
