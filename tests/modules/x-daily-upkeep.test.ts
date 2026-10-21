/**
 * ⭐ 每天自动:先查回关,再给我自己的号跑关系采集(2026-10-21,用户「按照顺序做吧」第 1 件)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { relationDailyDue } from '@modules/x/x-relation-plan';

const now = Date.parse('2026-10-22T12:00:00Z');
describe('关系采集该不该每天自动跑', () => {
  it('没跑过 → 跑;最近一个 24 小时内建的 → 不跑;满 24 小时 → 跑', () => {
    expect(relationDailyDue([], now)).toBe(true);
    expect(relationDailyDue([{ status: 'done', createdAt: '2026-10-22T01:00:00Z' }], now)).toBe(false);
    expect(relationDailyDue([{ status: 'done', createdAt: '2026-10-21T11:00:00Z' }, { status: 'failed', createdAt: '2026-10-20T11:00:00Z' }], now)).toBe(true);
  });
  it('有在跑 / 排队的不跑;人暂停的不自动重开', () => {
    expect(relationDailyDue([{ status: 'running', createdAt: '2026-10-01T00:00:00Z' }], now)).toBe(false);
    expect(relationDailyDue([{ status: 'paused', createdAt: '2026-10-01T00:00:00Z' }], now)).toBe(false);
  });
});

const calls: string[] = [];
let lastCheck: { at: string; ok: boolean } | null = null;
let jobs: Array<{ self: boolean; status: string; createdAt: string }> = [];
vi.mock('@modules/x/x-host-registry', () => ({ listXHostStates: () => new Map([['ws-1', { wcId: 7, url: '' }]]) }));
vi.mock('@modules/x/x-account-repo', () => ({ readWsAccount: async () => ({ restId: 'ME', handle: 'me' }) }));
vi.mock('@modules/x/x-follow-check', () => ({
  followCheckRunning: () => null,
  checkFollowBack: async () => { calls.push('follow-check'); return { ran: true }; },
}));
vi.mock('@modules/x/x-follow-check-repo', () => ({ readLastFollowCheck: async () => lastCheck }));
vi.mock('@modules/x/x-relation-task', () => ({
  listRelationJobs: async () => jobs,
  startRelationTask: async (_ws: string, _t: unknown, trigger: string) => { calls.push(`relation:${trigger}`); return { ok: true, jobId: 'J' }; },
}));

import { dailyUpkeepTick } from '@modules/x/x-daily-upkeep';

describe('一轮只做一件:先查回关,再关系采集', () => {
  beforeEach(() => { calls.length = 0; });
  it('查回关到点 → 只查回关', async () => {
    lastCheck = null; jobs = [];
    expect(await dailyUpkeepTick(now)).toBe('follow-check:ws-1');
    expect(calls).toEqual(['follow-check']);
  });
  it('查回关今天做过 → 关系采集(标 auto)', async () => {
    lastCheck = { at: '2026-10-22T08:00:00Z', ok: true }; jobs = [];
    expect(await dailyUpkeepTick(now)).toBe('relation:ws-1');
    expect(calls).toEqual(['relation:auto']);
  });
  it('两件都做过 → 什么都不做', async () => {
    lastCheck = { at: '2026-10-22T08:00:00Z', ok: true }; jobs = [{ self: true, status: 'done', createdAt: '2026-10-22T09:00:00Z' }];
    expect(await dailyUpkeepTick(now)).toBeNull();
    expect(calls).toEqual([]);
  });
  it('别人的名单任务不算(只看我自己的)', async () => {
    lastCheck = { at: '2026-10-22T08:00:00Z', ok: true }; jobs = [{ self: false, status: 'done', createdAt: '2026-10-22T09:00:00Z' }];
    expect(await dailyUpkeepTick(now)).toBe('relation:ws-1');
  });
});
