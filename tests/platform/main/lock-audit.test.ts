/**
 * ⭐⭐ 锁的留痕 + 对账脚本(2026-10-23)—— 用**真锁打出的日志行**喂对账函数,格式漂了这里会红。
 * 用户:「你从后台看得到这些操作吗?」→ 占住 / 放掉 / 拒绝各一行,scripts/lock-report.mjs 按行对账。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as lock from '@platform/main/flow/resource-lock';
// @ts-expect-error —— 纯 JS 脚本库,没有类型
import { auditLocks, LONG_HOLD_SEC } from '../../../scripts/lib/lock-audit.mjs';

type Rec = { ts: number; msg: string; run: string };
let recs: Rec[] = [];
let t = 1_000_000;
const capture = (...a: unknown[]): void => { recs.push({ ts: t, msg: String(a[0]), run: 'R1' }); };

beforeEach(() => {
  lock._resetLocks();
  recs = [];
  t = 1_000_000;
  for (const m of ['log', 'warn', 'error'] as const) vi.spyOn(console, m).mockImplementation(capture);
});
afterEach(() => vi.restoreAllMocks());

describe('真锁的日志 → 对账', () => {
  it('占住 → 别人被拒 → 放掉:没问题,记下一次使用、一次让路', () => {
    const a = lock.acquireLock('page:3', '任务:查回关', 'timer');
    if (!a.ok) throw new Error('应拿到');
    t += 5000;
    expect(lock.acquireLock('page:3', '操作台正在采集', 'ui').ok).toBe(false);
    t += 5000;
    lock.releaseLock(a.token);
    expect(recs.map((r) => r.msg.slice(0, 9))).toEqual(['[lock] 占住', '[lock] 拒绝', '[lock] 放掉']);
    const r = auditLocks(recs, t);
    expect(r.problems).toEqual([]);
    expect(r.spans).toHaveLength(1);
    expect(r.spans[0]).toMatchObject({ res: 'page:3', purpose: '任务:查回关', caller: 'timer', from: 1_000_000 });
    expect(r.refusals).toEqual([expect.objectContaining({ purpose: '操作台正在采集', byPurpose: '任务:查回关' })]);
    expect(r.open).toEqual([]);
  });

  it('⭐ 对账能报错(证明它不是恒绿):两个人同时占 / 超时收回 / 拿错 token 放 / 占着太久', () => {
    /** 同时占:真锁不会这样,手工拼两行「占住」 */
    const both = auditLocks([
      { ts: 1, msg: '[lock] 占住 page:3「任务:查回关」(timer) #A', run: 'R' },
      { ts: 2, msg: '[lock] 占住 page:3「操作台正在采集」(ui) #B', run: 'R' },
    ], 3);
    expect(both.problems.join()).toContain('两个人同时占着 page:3');

    lock.acquireLock('page:4', '求关卡:准备 @he', 'ui', { ttlMs: 1000, now: 0 });
    lock.lockHolder('page:4', 5000);
    expect(lock.releaseLock('page:9#1:x')).toBe(false);
    const bad = auditLocks(recs, 6000);
    expect(bad.problems.some((p: string) => p.includes('超时收回'))).toBe(true);
    expect(bad.problems.some((p: string) => p.includes('不是自己的'))).toBe(true);

    recs = [];
    lock.acquireLock('page:5', '后台正在采 @x', 'timer');
    const long = auditLocks(recs, t + (LONG_HOLD_SEC + 60) * 1000);
    expect(long.problems.join()).toContain('还没放');
    expect(auditLocks(recs, t + 10_000).problems).toEqual([]);
  });

  it('窗口关掉 / 网页销毁收回 → 备注,不算问题;app 重启前没放的 → 备注', () => {
    lock.acquireLock('page:3', '运营正在核对这个人', 'ui');
    lock.revokeLocks(() => true, '申请它的窗口关掉了');
    const r = auditLocks(recs, t);
    expect(r.problems).toEqual([]);
    expect(r.notes.join()).toContain('收回 page:3');

    const restart = auditLocks([
      { ts: 1, msg: '[lock] 占住 page:3「任务:查回关」(timer) #A', run: 'R1' },
      { ts: 2, msg: '[lock] 占住 page:3「操作台正在采集」(ui) #B', run: 'R2' },
    ], 3);
    expect(restart.problems).toEqual([]);
    expect(restart.notes.join()).toContain('app 重启前');
  });
});
