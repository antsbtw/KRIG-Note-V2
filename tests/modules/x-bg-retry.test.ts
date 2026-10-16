/**
 * ⭐⭐ 后台遇到「第一轮翻页没带鉴权头」→ 像人卡一样重载这一页再试一次(用户 2026-10-15 选 A)
 *
 * 钉四件事(行为测试,mock collectOnWebview 按顺序返回):
 *  ① 第一次没带头、第二次成功 → 不算失败,断点照常交出
 *  ② 两次都没带头 → 标失败停任务(异常即停,不无限重试)
 *  ③ 翻到一半才 403 → 不是模板问题,不重试,直接停
 *  ④ 判据与人卡同一份(worthReloadRetry)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type R = { reached: true; records: unknown[]; paging: { rounds: number; stopReason: string }; exhausted: boolean; nextCursor?: string };
const queue: R[] = [];
let calls = 0;

vi.mock('@modules/x/x-collect-on-webview', () => ({
  collectOnWebview: vi.fn(async () => { calls += 1; const r = queue.shift(); if (!r) throw new Error('没准备返回值'); return r; }),
}));
vi.mock('@modules/x/x-collect-ports', () => ({ webviewPorts: vi.fn(() => ({})) }));
vi.mock('@platform/main/web-capability/wiring/runtime', () => ({ traceRecorder: { lifecycle: vi.fn() } }));
vi.mock('@modules/x/x-tweet-repo', () => ({ saveTweets: vi.fn(async () => ({ inserted: 0, updated: 0, failed: [] })) }));

import { makeSegmentDeps } from '@modules/x/x-bg-runner';
import { worthReloadRetry } from '@modules/x/x-person-timeline';
import type { BgJob } from '@modules/x/x-bg-job';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const NO_AUTH = '有 1 条翻页请求但都没带鉴权头 —— 不拿必 403 的种子去撞';
const job = {
  id: 'j', restId: '1', handle: 'a', wsId: 'ws-1', range: 'halfYear', status: 'running',
  profile: { cursor: 'C', done: false }, replies: { done: false }, reposts: { done: false },
  totalPages: 0, totalSaved: 0, createdAt: '', updatedAt: '',
} as BgJob;
const run = () => makeSegmentDeps(7, job, new Date('2026-10-15T00:00:00Z'))
  .runOne({ page: 'x.profile', handle: 'a', resumeCursor: 'C', pageCap: 10 });

describe('⭐⭐ 后台重载重试一次', () => {
  beforeEach(() => { queue.length = 0; calls = 0; });

  it('① 第一次没带头 → 重载再试;第二次成功 → 不算失败', async () => {
    queue.push(
      { reached: true, records: [], paging: { rounds: 0, stopReason: NO_AUTH }, exhausted: false },
      { reached: true, records: [], paging: { rounds: 10, stopReason: '当场采到上限 10 页' }, exhausted: false, nextCursor: 'C2' },
    );
    const r = await run();
    expect(calls).toBe(2);
    expect(r.failure).toBeUndefined();
    expect(r.nextCursor).toBe('C2');
    expect(r.pages).toBe(10);
  });

  it('② 两次都没带头 → 标失败(说清是重载后仍失败),不再试第三次', async () => {
    queue.push(
      { reached: true, records: [], paging: { rounds: 0, stopReason: NO_AUTH }, exhausted: false },
      { reached: true, records: [], paging: { rounds: 0, stopReason: NO_AUTH }, exhausted: false },
    );
    const r = await run();
    expect(calls).toBe(2);
    expect(r.failure).toMatch(/重载后第 2 次仍失败/);
  });

  it('③ 翻到第 5 页才 403 → 不是模板问题,不重试,直接停', async () => {
    queue.push({ reached: true, records: [], paging: { rounds: 5, stopReason: 'HTTP 403' }, exhausted: false });
    const r = await run();
    expect(calls).toBe(1);
    expect(r.failure).toMatch(/403/);
  });

  it('④ 限流不重试;判据与人卡同一份', () => {
    expect(worthReloadRetry('429 限流', 0)).toBe(false);
    expect(worthReloadRetry(NO_AUTH, 1)).toBe(true);
    expect(worthReloadRetry('HTTP 403', 2)).toBe(false);
    const page = readFileSync(join(process.cwd(), 'src/modules/x/XOpsPeople.tsx'), 'utf8');
    expect(page).toMatch(/const authFail = worthReloadRetry\(why, run\.paging\?\.rounds \?\? 0\);/);
  });
});
