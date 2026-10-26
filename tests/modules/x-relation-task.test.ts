/**
 * ⭐⭐ 关系采集任务 + 节奏自调(2026-10-20)
 * 用户:「在任务中添加一个"关系采集"这样的完整任务吧…先读取用户的bio,了解现状…比对库中的差距;制定采集策略,然后自动采集,并显示进度。」
 * 「这些是配置项,没有必要用户做配置,而是AI执行这些任务时自我优化就可以了。根据限流出现的不同来调整这些参数。」
 */
import { describe, it, expect } from 'vitest';
import { adjustPace, defaultPace, isRateLimited, PACE_BOUNDS } from '@modules/x/x-pace';
import { canReconcile, planRelation, planTab } from '@modules/x/x-relation-plan';
import { mergeSegment, type BgJob } from '@modules/x/x-bg-job';
import { tabDoneFrom } from '@modules/x/x-bg-segment';

describe('节奏自调', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  it('撞限流 → 间隔翻倍、页数减半;不低于下限', () => {
    const d = adjustPace(defaultPace('list:followers'), 'limited', now);
    expect(d.next).toMatchObject({ gapSec: 600, pages: 5, okStreak: 0, limitedAt: now.toISOString() });
    expect(d.event?.kind).toBe('slower');
    expect(adjustPace({ gapSec: 3000, pages: 3, okStreak: 0 }, 'limited', now).next).toMatchObject({ gapSec: PACE_BOUNDS.maxGap, pages: PACE_BOUNDS.minPages });
  });
  it('已经最慢还撞 → 举手', () => {
    const d = adjustPace({ gapSec: PACE_BOUNDS.maxGap, pages: PACE_BOUNDS.minPages, okStreak: 0 }, 'limited', now);
    expect(d.giveUp).toMatch(/最慢/);
  });
  it('连续 3 段顺利才加快;一小时内撞过不加快', () => {
    let s = defaultPace('list:followers');
    s = adjustPace(s, 'ok', now).next; s = adjustPace(s, 'ok', now).next;
    expect(s.okStreak).toBe(2);
    const d = adjustPace(s, 'ok', now);
    expect(d.event?.kind).toBe('faster');
    expect(d.next).toMatchObject({ gapSec: 240, pages: 12, okStreak: 0 });
    const hot = adjustPace({ gapSec: 600, pages: 5, okStreak: 2, limitedAt: '2026-10-20T11:30:00Z' }, 'ok', now);
    expect(hot.event).toBeUndefined();
  });
  it('什么算限流', () => {
    expect(isRateLimited('HTTP 429')).toBe(true);
    expect(isRateLimited('被限流,退避')).toBe(true);
    expect(isRateLimited('没带鉴权头 403')).toBe(false);
  });
});

describe('定策略', () => {
  it('库里没有 → 全量;差一些 → 增量;库里多出一截 → 全量对一遍;X 0 人 → 跳过', () => {
    expect(planTab(6400, 0, true)).toMatchObject({ mode: 'full', estPages: 128 });
    expect(planTab(6400, 6000, true)).toMatchObject({ mode: 'incremental', estPages: 9 });
    expect(planTab(6400, 6410, true).mode).toBe('incremental');
    expect(planTab(6400, 7000, true)).toMatchObject({ mode: 'full' });
    expect(planTab(6400, 7000, true).why).toMatch(/有人取关了/);
    expect(planTab(0, 10, true).mode).toBe('skip');
  });
  it('蓝V关注者 X 不给总数:库里没有采全,有就增量', () => {
    const p = planRelation({ target: { restId: '1', handle: 'a' }, self: true, xCounts: { followers: 10, following: 10 }, db: { followers: 10, following: 10, verifiedFollowers: 5 }, now: new Date() });
    expect(p.tabs.verifiedFollowers).toMatchObject({ mode: 'incremental', xCount: undefined });
    expect(planRelation({ target: { restId: '1', handle: 'a' }, self: false, xCounts: {}, db: { followers: 0, following: 0, verifiedFollowers: 0 }, now: new Date() }).tabs.verifiedFollowers.mode).toBe('full');
  });
  it('⭐ 对账条件:全量 + 到底 + 够 98% 才标走了的', () => {
    const full = planTab(1000, 1200, true);
    expect(canReconcile(full, 990, true).ok).toBe(true);
    expect(canReconcile(full, 970, true).ok).toBe(false);
    expect(canReconcile(full, 1000, false).ok).toBe(false);
    expect(canReconcile(planTab(1000, 990, true), 1000, true).ok).toBe(false);
  });
});

describe('进度累计 / 到底判据', () => {
  const job = {
    id: 'L', restId: 'O', handle: 'o', wsId: 'ws-1', range: 'all', status: 'running', kind: 'lists',
    profile: { done: false }, replies: { done: false }, reposts: { done: false },
    followers: { done: false }, following: { done: false }, verifiedFollowers: { done: false },
    totalPages: 0, totalSaved: 0, createdAt: '', updatedAt: '',
  } as BgJob;
  it('名单统计逐段累加;限流说明留在任务上', () => {
    const a = mergeSegment(job, { tab: 'followers', pages: 10, saved: 500, tabDone: false, nextCursor: 'C', listStats: { seen: 500, fresh: 20 } }, new Date());
    const b = mergeSegment(a, { tab: 'followers', pages: 3, saved: 150, tabDone: false, nextCursor: 'C2', listStats: { seen: 150, fresh: 0 }, note: '被限流 —— 放慢' }, new Date());
    expect(b.stats?.followers).toMatchObject({ seen: 650, fresh: 20, pages: 13 });
    expect(b.lastError).toMatch(/限流/);
    expect(b.status).toBe('running');
  });
  it('追上了 = 这个名单做完;被限流 ≠ 到底', () => {
    expect(tabDoneFrom({ pages: 2, saved: 100, exhausted: false, caughtUp: true, stopReason: '追上了' })).toBe(true);
    expect(tabDoneFrom({ pages: 1, saved: 50, exhausted: false, stopReason: '429', note: '被限流 —— 放慢' })).toBe(false);
  });
});

describe('⭐⭐ 增量追上后复核(2026-10-20 真机:追上了,库里还比 X 少 ~150)', () => {
  it('还差一截 → 改全量;差在容差内 → 不改;全量 / 不知道总数 → 不改', async () => {
    const { escalateAfterCatchUp } = await import('@modules/x/x-relation-plan');
    const inc = planTab(6905, 6709, true);
    expect(escalateAfterCatchUp(inc, 6751)).toMatch(/少 154.*改成全量/);
    expect(escalateAfterCatchUp(inc, 6800)).toBeUndefined();
    expect(escalateAfterCatchUp(planTab(6905, 0, true), 10)).toBeUndefined();
    expect(escalateAfterCatchUp(planTab(undefined, 5176, true), 10)).toBeUndefined();
  });
  it('升级后:这个名单没到底、断点清空(从头翻)、任务里的策略改成全量并写明原因', async () => {
    const { runSegment } = await import('@modules/x/x-bg-segment');
    const plan = planRelation({ target: { restId: 'ME', handle: 'me' }, self: true, xCounts: { followers: 6905, following: 6191 }, db: { followers: 6709, following: 6223, verifiedFollowers: 5176 }, now: new Date() });
    const job = {
      id: 'L', restId: 'ME', handle: 'me', wsId: 'ws-1', range: 'all', status: 'running', kind: 'lists', self: true, plan,
      profile: { done: false }, replies: { done: false }, reposts: { done: false },
      followers: { done: false }, following: { done: false }, verifiedFollowers: { done: false },
      totalPages: 0, totalSaved: 0, createdAt: '', updatedAt: '',
    } as BgJob;
    const r = await runSegment(job, { async runOne() {
      return { pages: 1, saved: 148, exhausted: false, caughtUp: true, nextCursor: 'C1', stopReason: '追上了', escalate: '增量追上了,可库里还少 154 —— 改成全量' };
    } } as never, 10, new Date());
    expect(r.job.followers).toMatchObject({ done: false, cursor: undefined });
    expect(r.job.plan?.tabs.followers).toMatchObject({ mode: 'full', estPages: 139 });
    expect(r.job.plan?.tabs.followers.why).toMatch(/改成全量/);
    expect(r.job.lastError).toMatch(/改成全量/);
  });
});
