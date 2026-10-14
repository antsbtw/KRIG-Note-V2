/**
 * ⭐⭐ 跑一段后台采集的编排(离线,副作用注入)
 *
 * 命脉:选哪个页、怎么判「这个页到底了」、失败怎么处理、断点怎么续。
 * runOne(真采集)注入,所以这里不用真机就能钉死这些判断。
 */
import { describe, it, expect } from 'vitest';
import { runSegment, tabDoneFrom, type SegmentDeps, type RunOneResult } from '@modules/x/x-bg-segment';
import type { BgJob } from '@modules/x/x-bg-job';

const T0 = '2026-10-13T00:00:00.000Z';
function job(over: Partial<BgJob> = {}): BgJob {
  return {
    id: 'j1', restId: '123', handle: 'alice', wsId: 'ws-1', range: 'all', status: 'queued',
    profile: { done: false }, replies: { done: false }, reposts: { done: false },
    totalPages: 0, totalSaved: 0, createdAt: T0, updatedAt: T0, ...over,
  };
}
function runOneResult(over: Partial<RunOneResult> = {}): RunOneResult {
  return { pages: 1, saved: 0, exhausted: false, stopReason: '', ...over };
}
/** 造一个 deps,记录 runOne 收到的入参 */
function deps(result: RunOneResult): { d: SegmentDeps; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    d: {
      async runOne(input) { calls.push({ ...input }); return result; },
    },
  };
}

describe('⭐⭐⭐ tabDoneFrom —— 这个页到底了没', () => {
  it('X 说到头(exhausted)→ 到底', () => {
    expect(tabDoneFrom(runOneResult({ exhausted: true }))).toBe(true);
  });
  it('⭐ 只是翻够本段页数(上限)→ 没到底,要续', () => {
    expect(tabDoneFrom(runOneResult({ stopReason: '当场采到上限 10 页还没到范围起点', nextCursor: 'c9' }))).toBe(false);
  });
  it('⭐⭐ 翻到范围起点 → 到底', () => {
    expect(tabDoneFrom(runOneResult({ stopReason: '已采到 2026-05-01 之前(这一页他最新的一条是 2026-04-20)' }))).toBe(true);
  });
  it('没游标了(X 不给了)→ 到底', () => {
    expect(tabDoneFrom(runOneResult({ stopReason: '没有新游标', nextCursor: undefined }))).toBe(true);
  });
  it('⚠️ 上限停 + 有游标:绝不能误判成到底(否则漏采后面几个月)', () => {
    expect(tabDoneFrom(runOneResult({ stopReason: '当场采到上限 10 页', nextCursor: 'c10' }))).toBe(false);
  });
});

describe('⭐⭐ runSegment —— 编排', () => {
  const now = new Date('2026-10-13T12:00:00.000Z');

  it('⭐ 从 profile 开始,传 pageCap,没断点时 resumeCursor 为空', async () => {
    const { d, calls } = deps(runOneResult({ pages: 3, saved: 40, nextCursor: 'c3', stopReason: '当场采到上限 3 页' }));
    const rep = await runSegment(job(), d, 3, now);
    expect(calls[0].page).toBe('x.profile');
    expect(calls[0].pageCap).toBe(3);
    expect(calls[0].resumeCursor).toBeUndefined();
    expect(rep.tab).toBe('profile');
    // 上限停、没到底 → 存断点、running
    expect(rep.job.profile.cursor).toBe('c3');
    expect(rep.job.profile.done).toBe(false);
    expect(rep.job.status).toBe('running');
    expect(rep.job.totalPages).toBe(3);
  });

  it('⭐⭐ 有断点 → 把断点当 resumeCursor 传进去', async () => {
    const j = job({ status: 'running', profile: { done: false, cursor: 'saved-cur' } });
    const { d, calls } = deps(runOneResult({ pages: 2, nextCursor: 'saved-cur2', stopReason: '上限' }));
    await runSegment(j, d, 5, now);
    expect(calls[0].resumeCursor).toBe('saved-cur');
  });

  it('⭐⭐ profile 到底(到起点)→ 标 profile.done,下段会采 replies', async () => {
    const { d } = deps(runOneResult({ pages: 2, saved: 10, stopReason: '已采到 2026-05-01 之前', nextCursor: undefined }));
    const rep = await runSegment(job(), d, 10, now);
    expect(rep.job.profile.done).toBe(true);
    expect(rep.job.status).not.toBe('done'); // 另两页还没采

    // 下一段:profile 已 done → 采 replies
    const { d: d2, calls: c2 } = deps(runOneResult({ stopReason: '上限', nextCursor: 'rc1' }));
    const rep2 = await runSegment(rep.job, d2, 10, now);
    expect(c2[0].page).toBe('x.withReplies');
    expect(rep2.tab).toBe('replies');
  });

  it('⭐⭐⭐ 这一段失败(限流)→ 标 failed、保住原断点、不推进', async () => {
    const j = job({ status: 'running', profile: { done: false, cursor: 'keep-me' } });
    const { d } = deps(runOneResult({ pages: 0, saved: 0, stopReason: '', failure: 'HTTP 403(重试没扛住)' }));
    const rep = await runSegment(j, d, 10, now);
    expect(rep.job.status).toBe('failed');
    expect(rep.job.lastError).toMatch(/403/);
    expect(rep.job.profile.cursor, '失败了还把断点改了 → 恢复后会从错的地方续').toBe('keep-me');
    expect(rep.job.profile.done, '失败不该把页标成到底').toBe(false);
  });

  it('⭐⭐⭐ all 范围:没有时间起点(start=undefined),只能靠 exhausted 停', async () => {
    const { d, calls } = deps(runOneResult({ exhausted: true, stopReason: 'X 说到头了' }));
    const rep = await runSegment(job({ range: 'all' }), d, 10, now);
    expect(calls[0].start, 'all 不该有时间起点').toBeUndefined();
    expect(rep.job.profile.done).toBe(true);
  });

  it('⭐ halfYear 范围:有时间起点传进 runOne', async () => {
    const { d, calls } = deps(runOneResult({ stopReason: '上限', nextCursor: 'c1' }));
    await runSegment(job({ range: 'halfYear' }), d, 10, now);
    expect(calls[0].start, 'halfYear 该有时间起点').toBeInstanceOf(Date);
  });

  it('三页全到底的 job 进来 → 不跑,收成 done', async () => {
    const j = job({ profile: { done: true }, replies: { done: true }, reposts: { done: true } });
    const { d, calls } = deps(runOneResult());
    const rep = await runSegment(j, d, 10, now);
    expect(calls.length, '全到底了还去采').toBe(0);
    expect(rep.job.status).toBe('done');
  });
});
