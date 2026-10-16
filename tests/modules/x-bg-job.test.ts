/**
 * ⭐⭐ 后台采集任务纯逻辑 —— 状态流转 / 挑任务 / 进度合并(离线,不碰库)
 *
 * 这些是后台策略的命脉:什么时候跑、什么时候停、三页怎么汇成「完成」。
 * 全是纯函数,所以这里能把流转一条条钉死,不用起库、不用真机。
 */
import { describe, it, expect } from 'vitest';
import {
  isDue, mergeSegment, nextTab, allTabsDone, isBgRange, describeProgress,
  type BgJob, type SegmentOutcome,
} from '@modules/x/x-bg-job';

const T0 = '2026-10-13T00:00:00.000Z';
function job(over: Partial<BgJob> = {}): BgJob {
  return {
    id: 'j1', restId: '123', handle: 'alice', wsId: 'ws-1', range: 'all', status: 'queued',
    profile: { done: false }, replies: { done: false }, reposts: { done: false },
    totalPages: 0, totalSaved: 0, createdAt: T0, updatedAt: T0,
    ...over,
  };
}

describe('⭐ isBgRange —— month 不进后台', () => {
  it('month 不是后台范围', () => { expect(isBgRange('month')).toBe(false); });
  it('halfYear / year / all 是', () => {
    expect(isBgRange('halfYear')).toBe(true);
    expect(isBgRange('year')).toBe(true);
    expect(isBgRange('all')).toBe(true);
  });
});

describe('⭐⭐⭐ isDue —— 什么时候该跑下一段', () => {
  const base = { now: new Date('2026-10-13T12:00:00.000Z'), wsBusy: false, segmentGapSec: 120 };

  it('queued + 不忙 + 没跑过 → 跑', () => {
    expect(isDue(job({ status: 'queued' }), base).due).toBe(true);
  });

  it('⭐ 这个号正忙(你在手动操作)→ 让路,不跑', () => {
    const d = isDue(job({ status: 'running' }), { ...base, wsBusy: true });
    expect(d.due).toBe(false);
    expect(d.why).toMatch(/让路|手动/);
  });

  it('⭐ 距上段没够间隔 → 等', () => {
    const d = isDue(
      job({ status: 'running', lastSegmentAt: '2026-10-13T11:59:00.000Z' }), // 60 秒前
      base, // 间隔 120 秒
    );
    expect(d.due, '才过 60 秒却说可跑').toBe(false);
    expect(d.why).toMatch(/间隔|秒/);
  });

  it('距上段够了间隔 → 跑', () => {
    const d = isDue(
      job({ status: 'running', lastSegmentAt: '2026-10-13T11:57:00.000Z' }), // 180 秒前
      base, // 间隔 120 秒
    );
    expect(d.due).toBe(true);
  });

  it('⭐ paused 不跑(等人恢复)', () => {
    expect(isDue(job({ status: 'paused' }), base).due).toBe(false);
  });

  it('⭐ failed 不跑(等人看过),why 带上原因', () => {
    const d = isDue(job({ status: 'failed', lastError: 'HTTP 403' }), base);
    expect(d.due).toBe(false);
    expect(d.why).toMatch(/403/);
  });

  it('done 不跑', () => {
    expect(isDue(job({ status: 'done' }), base).due).toBe(false);
  });
});

describe('⭐⭐ nextTab —— 接着采哪个标签页', () => {
  it('从 profile 开始', () => { expect(nextTab(job())).toBe('profile'); });
  it('profile 到底 → 采 replies', () => {
    expect(nextTab(job({ profile: { done: true } }))).toBe('replies');
  });
  it('profile+replies 到底 → 采 reposts', () => {
    expect(nextTab(job({ profile: { done: true }, replies: { done: true } }))).toBe('reposts');
  });
  it('⭐ 三页全到底 → undefined(该标 done)', () => {
    const j = job({ profile: { done: true }, replies: { done: true }, reposts: { done: true } });
    expect(nextTab(j)).toBeUndefined();
    expect(allTabsDone(j)).toBe(true);
  });
});

describe('⭐⭐⭐ mergeSegment —— 一段跑完怎么并进任务', () => {
  const now = new Date('2026-10-13T12:00:00.000Z');

  it('⭐ 这一段没到底 → 存断点、累计、转 running、不完成', () => {
    const out: SegmentOutcome = { tab: 'profile', pages: 3, saved: 50, nextCursor: 'c3', tabDone: false, oldestAt: '2026-05-01T00:00:00Z' };
    const next = mergeSegment(job({ status: 'queued' }), out, now);
    expect(next.status).toBe('running');
    expect(next.profile.cursor, '断点没存').toBe('c3');
    expect(next.profile.done).toBe(false);
    expect(next.totalPages).toBe(3);
    expect(next.totalSaved).toBe(50);
    expect(next.lastSegmentAt, '没记这段跑的时间 → 间隔判断会失灵').toBe(now.toISOString());
  });

  it('⭐⭐ profile 到底但还有别的页 → 不完成整任务', () => {
    const out: SegmentOutcome = { tab: 'profile', pages: 2, saved: 10, tabDone: true };
    const next = mergeSegment(job(), out, now);
    expect(next.profile.done).toBe(true);
    expect(next.status, '一个页到底就把整任务标完成了 —— 另两页还没采').not.toBe('done');
  });

  it('⭐⭐⭐ 最后一页也到底 → 整任务 done', () => {
    const j = job({ status: 'running', profile: { done: true }, replies: { done: true }, reposts: { done: false } });
    const out: SegmentOutcome = { tab: 'reposts', pages: 1, saved: 5, tabDone: true };
    const next = mergeSegment(j, out, now);
    expect(next.status).toBe('done');
  });

  it('⭐⭐⭐ 这一段失败(403)→ 标 failed + 留原因,不自动继续', () => {
    const out: SegmentOutcome = { tab: 'profile', pages: 0, saved: 0, tabDone: false, failed: 'HTTP 403(连重试都没扛住)' };
    const next = mergeSegment(job({ status: 'running' }), out, now);
    expect(next.status).toBe('failed');
    expect(next.lastError).toMatch(/403/);
    // ⚠️ 失败不该把这一段的页数算进去当「进度」(它没真采到)
    expect(next.totalPages).toBe(0);
  });

  it('⭐ oldestAt 没给时沿用旧的(别把已知的最旧时间抹成空)', () => {
    const j = job({ profile: { done: false, oldestAt: '2026-06-01T00:00:00Z' } });
    const out: SegmentOutcome = { tab: 'profile', pages: 1, saved: 0, nextCursor: 'c2', tabDone: false };
    const next = mergeSegment(j, out, now);
    expect(next.profile.oldestAt).toBe('2026-06-01T00:00:00Z');
  });
});

describe('describeProgress —— 一句话进度', () => {
  it('采集中显示三页各自进度', () => {
    const j = job({ status: 'running', profile: { done: true }, replies: { done: false, oldestAt: '2026-05-01T00:00:00Z' }, totalPages: 12, totalSaved: 300 });
    const s = describeProgress(j);
    expect(s).toMatch(/帖子 已到底/);
    expect(s).toMatch(/回复 采到 2026-05-01/);
    expect(s).toMatch(/12 页 新增 300 条/);
  });
  it('失败显示原因', () => {
    expect(describeProgress(job({ status: 'failed', lastError: 'HTTP 403' }))).toMatch(/403/);
  });
});
