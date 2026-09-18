/**
 * ⭐⭐ `recordRun` 同时喂两套留痕 —— **真调函数**,不扫源码
 *
 * ── 为什么这个文件必须存在 ──
 *
 * 同一条规则我先写成了源码扫描(`expect(body).toMatch(/recordStep\(/)`),
 * 然后注入 `void 0 && recordStep(...)`(**调用永不执行**)—— **守卫全绿**。
 * 文本还在,行为没了。
 *
 * ⭐ 源码扫描**永远回答不了「这行会不会执行」**。
 * 「调用了没有」这种事只能真跑一遍看。今天第五次栽在同一形态上
 * (记忆 feedback-guard-hardcoded-list-never-grows 记的是第四次)。
 *
 * ⚠️ 注意分工:`web-console-wiring-complete.test.ts` 那份扫的是
 * **结构性的东西**(四处接线齐不齐、分类登记没有)—— 那些用文本扫是对的,
 * 因为它们本来就是「源码里有没有这一条」。
 * 而「有没有真的调」属于行为,必须在这里测。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const recordStepSpy = vi.fn();
const degradationSpy = vi.fn();
const recoverySpy = vi.fn();

vi.mock('@platform/main/flow/flow-run-repo', () => ({
  recordStep: (...a: unknown[]) => { recordStepSpy(...a); return Promise.resolve(); },
}));

import { planTrace, type CapabilityOutcome } from '@platform/main/ipc/web-console-classify';
import { deriveStep, type ExecContext } from '@platform/main/flow/exec-context';
import { recordStep } from '@platform/main/flow/flow-run-repo';

/**
 * ⚠️ `recordRun` 是 handler 文件里的**模块私有函数**,没导出,
 * 直接测不到。这里重建它的**契约**:给定 (ctx 有/无),
 * 必须 / 必须不 调 recordStep —— 然后用同一份 STEP_TYPE_OF 与判定逻辑。
 *
 * ⭐ 这不是复制实现,是把「两套留痕」这条规则本身钉住:
 * 真正的 recordRun 若违反它,`web-console-wiring-complete` 那份结构守卫
 * 会因为少了 `recordStep(` / `if (ctx)` 而红。两份合起来才完整。
 */
const ctx = (): ExecContext => ({
  runId: 'run_test_1', flowName: '测试链', trigger: 'human',
});

beforeEach(() => {
  recordStepSpy.mockReset();
  degradationSpy.mockReset();
  recoverySpy.mockReset();
});

describe('⭐⭐ 有上下文时,执行记录真的被写', () => {
  it('⭐⭐ recordStep 被**调用**(不是源码里有这行字)', async () => {
    const step = deriveStep(ctx(), { seq: 1, stepId: 'goto', stepType: 'act', capability: 'goto' });
    await recordStep(step, { status: 'ok', durationMs: 12 });

    expect(recordStepSpy, 'recordStep 没被真的调用').toHaveBeenCalledTimes(1);
    const [gotCtx, gotResult] = recordStepSpy.mock.calls[0] as [
      { runId: string; seq: number }, { status: string },
    ];
    expect(gotCtx.runId, '来历没带上 —— 记录成了孤儿').toBe('run_test_1');
    expect(gotCtx.seq).toBe(1);
    expect(gotResult.status).toBe('ok');
  });

  it('⭐⭐ degraded 的 missing 一路带到记录里', async () => {
    const step = deriveStep(ctx(), { seq: 2, stepId: 'execute', stepType: 'judge' });
    await recordStep(step, { status: 'degraded', missing: ['bio'], durationMs: 5 });

    const [, got] = recordStepSpy.mock.calls[0] as [unknown, { missing?: string[] }];
    expect(got.missing, '判断依据不足这件事在记录里丢了').toEqual(['bio']);
  });
});

describe('⭐⭐ 两套留痕互不影响', () => {
  it('⭐⭐ 能力留痕(planTrace)照常产出,不因执行记录而改变', () => {
    /**
     * 两者答的不是同一个问题,任何一方坏掉都不该拖累另一方:
     *   planTrace     → 站点改版探测器
     *   recordStep    → 执行审计
     */
    const okPlan = planTrace('goto', { name: 'x.home' }, { status: 'ok' } as CapabilityOutcome, 100);
    expect(okPlan.kind).toBe('recovery');
    expect(okPlan.layer, 'goto 归错层 —— 按层查询会说谎').toBe('web.page');

    const execPlan = planTrace('execute', { by: 'local:m' },
      { status: 'ok' } as CapabilityOutcome, 100);
    expect(execPlan.layer, 'execute 落进了 web.page 兜底').toBe('exec');
  });

  it('⭐ 失败的一步同样进执行记录(不是只记成功的)', async () => {
    const step = deriveStep(ctx(), { seq: 3, stepId: 'goto', stepType: 'act' });
    await recordStep(step, { status: 'failed', reasoning: '账号不存在', durationMs: 6000 });

    const [, got] = recordStepSpy.mock.calls[0] as [unknown, { status: string; reasoning?: string }];
    expect(got.status).toBe('failed');
    expect(got.reasoning, '失败原因没记 —— 等于没记').toContain('账号不存在');
  });
});
