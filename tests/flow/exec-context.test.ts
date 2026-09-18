/**
 * ⭐⭐ 执行上下文与执行记录 —— **真调函数**,假的只有数据库那一层
 *
 * ── 为什么这些必须钉住 ──
 *
 * 用户 2026-09-18 定的设计要求:
 * > 「对于函数的调用,确实应该记录调用者是谁,
 * >   系统必须有维护能力和追溯的能力才行。」
 *
 * 追溯坏掉的方式很隐蔽:**记录看着都在,但查不出来**。
 * 所以这里钉的是「查得出来」所依赖的那几条,不是「写进去了」。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('@storage/surreal/client', () => ({
  getFlowDB: () => ({ query: (...a: unknown[]) => mockQuery(...a) }),
}));

import {
  newRunId, deriveStep, describeStep,
  type ExecContext,
} from '@platform/main/flow/exec-context';
import { startRun, recordStep, endRun } from '@platform/main/flow/flow-run-repo';

const ctx = (over: Partial<ExecContext> = {}): ExecContext => ({
  runId: 'run_20260918_abc123',
  flowName: '采某个人',
  trigger: 'human',
  ...over,
});

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue([[]]);
});

describe('⭐ runId:看一眼就知道什么时候跑的', () => {
  it('⭐ 带时间戳前缀(纯随机 id 说不出「什么时候」)', () => {
    const id = newRunId(new Date('2026-09-18T10:30:00Z'));
    expect(id).toMatch(/^run_20260918103000_[a-z0-9]{6}$/);
  });

  it('⭐ 同一毫秒不撞车', () => {
    const now = new Date();
    const ids = new Set(Array.from({ length: 200 }, () => newRunId(now)));
    expect(ids.size, '同毫秒生成的 id 撞了 —— step 会挂到别人的 run 上').toBeGreaterThan(190);
  });
});

describe('⭐⭐ deriveStep:seq 是排序的唯一依据', () => {
  it('⭐ 派生出的 step 继承 run 的来历', () => {
    const s = deriveStep(ctx({ triggerRef: '面板按钮', wsId: 'ws-1' }), {
      seq: 1, stepId: '导航', stepType: 'act', capability: 'goto',
    });
    expect(s.runId).toBe('run_20260918_abc123');
    expect(s.trigger).toBe('human');
    expect(s.triggerRef, '发起者细节丢了 —— 查不出「人点的哪个按钮」').toBe('面板按钮');
    expect(s.wsId).toBe('ws-1');
  });

  it('⭐⭐ seq 非法当场抛 —— 失序的记录看着正常,最难查', () => {
    /**
     * seq 错了会让「第几步」整条链失序,而现象是记录都在、顺序不对。
     * 排序靠 seq 不靠时间戳:同毫秒完成的两步用时间戳会乱。
     */
    for (const bad of [0, -1, 1.5, NaN]) {
      expect(
        () => deriveStep(ctx(), { seq: bad, stepId: 'x', stepType: 'fetch' }),
        `seq=${bad} 被放过了`,
      ).toThrow(/seq 必须是/);
    }
  });

  it('⭐ 步骤可以有自己的主体(一条 run 逐个处理多个对象)', () => {
    const s = deriveStep(
      ctx({ subject: { kind: 'handle', ref: 'somebody' } }),
      { seq: 2, stepId: '判决', stepType: 'judge', subject: { kind: 'tweet', ref: '123' } },
    );
    expect(s.subject?.ref, 'run 的主体被步骤覆盖了').toBe('somebody');
    expect(s.stepSubject?.ref).toBe('123');
  });

  it('⭐ 日志摘要带 runId 与 seq(grep 一个 runId 串起整条链)', () => {
    const s = deriveStep(ctx({ subject: { kind: 'handle', ref: 'somebody' } }),
      { seq: 3, stepId: '入库', stepType: 'write' });
    const line = describeStep(s);
    expect(line).toContain('run_20260918_abc123');
    expect(line).toContain('#3');
    expect(line).toContain('handle:somebody');
  });
});

describe('⭐⭐ 被跳过 / 被拒绝的也要记', () => {
  it('⭐⭐ skipped 与 rejected 都真的写库(不只记成功的)', async () => {
    /**
     * 设计 Module5-01 §6.3 明确要求。只记成功的话,
     * 「为什么没发生」永远查不出来 —— 而那恰恰是最常问的问题。
     */
    for (const st of ['skipped', 'rejected'] as const) {
      mockQuery.mockClear();
      await recordStep(
        deriveStep(ctx(), { seq: 1, stepId: '发布', stepType: 'act' }),
        { status: st, reasoning: `REJECTED: 闸门关着`, durationMs: 3 },
      );
      expect(mockQuery, `${st} 没写库`).toHaveBeenCalledTimes(1);
      const params = mockQuery.mock.calls[0][1] as Record<string, unknown>;
      expect(params.status).toBe(st);
      expect(params.reasoning, '没记原因 —— 等于没记').toContain('闸门');
    }
  });

  it('⭐⭐ degraded 的 missing 要存下来(判断依据不足是核心事实)', async () => {
    await recordStep(
      deriveStep(ctx(), { seq: 1, stepId: '判决', stepType: 'judge' }),
      { status: 'degraded', missing: ['bio', '上下文'], durationMs: 100 },
    );
    const params = mockQuery.mock.calls[0][1] as Record<string, unknown>;
    expect(params.missing).toEqual(['bio', '上下文']);
  });

  it('⭐ missing 为空时传 undefined,不传空数组/null', async () => {
    // option<T> 只认 NONE;传 null 会写成 NULL,查询 IS NONE 就漏了
    await recordStep(
      deriveStep(ctx(), { seq: 1, stepId: 'x', stepType: 'fetch' }),
      { status: 'ok', missing: [], durationMs: 1 },
    );
    const params = mockQuery.mock.calls[0][1] as Record<string, unknown>;
    expect(params.missing).toBeUndefined();
  });
});

describe('⭐⭐ 留痕挂了不许拦住业务', () => {
  it('⭐⭐ 写库报错时不抛出去(否则「为了能追溯」把功能弄坏了)', async () => {
    mockQuery.mockRejectedValue(new Error('库没起来'));

    await expect(startRun(ctx())).resolves.toBeUndefined();
    await expect(recordStep(
      deriveStep(ctx(), { seq: 1, stepId: 'x', stepType: 'fetch' }),
      { status: 'ok', durationMs: 1 },
    )).resolves.toBeUndefined();
    await expect(endRun('run_x', 'ok')).resolves.toBeUndefined();
  });

  it('⭐⭐ 但要 warn 出来 —— 静默会让「记录是空的」被误读成「没跑过」', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockQuery.mockRejectedValue(new Error('库没起来'));

    await recordStep(
      deriveStep(ctx(), { seq: 1, stepId: 'x', stepType: 'fetch' }),
      { status: 'ok', durationMs: 1 },
    );

    expect(warn, '写库失败被静默了').toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('⭐ option 字段一律传 undefined', () => {
  it('⭐⭐ 没有的字段传 undefined,绝不传 null(NONE ≠ NULL)', async () => {
    /**
     * SurrealDB 的 option<T> 只认 NONE。SDK 绑定 undefined→NONE、null→NULL。
     * 写成 NULL 后,查询里写 IS NONE 就**查不到**,而且不报错。
     * 记忆 project-surreal-none-vs-null:见 `?? null` 就是 bug。
     */
    await startRun(ctx());   // 不带 triggerRef / subject / wsId
    const params = mockQuery.mock.calls[0][1] as Record<string, unknown>;
    for (const k of ['triggerRef', 'subjectKind', 'subjectRef', 'wsId']) {
      expect(params[k], `${k} 传了 null —— 会写成 NULL,IS NONE 查不到`).toBeUndefined();
    }
  });
});
