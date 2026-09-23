/**
 * ⭐⭐⭐ 编排执行器 —— 用户 2026-09-23:
 *
 * > 「下一步做一个任务编排试试,这样逐步的拆解抽象。
 * >   否则还是找不到该抽象到哪个颗粒度比较好。」
 *
 * ── 颗粒度的判据(写在这里,免得下次又凭空争论)──
 * **一步 = 一个已经单独验证过的能力**,失败时人能一眼看出该查什么。
 * 四步各有独立的失败形态:页面没到位 / 采不到数据 / 模型不答 / 没有候选。
 *
 * ⚠️ 不拆更细:采集内部那几件事(滚动/展开/解析/入库/补正文)**必须一起发生**
 * 才有意义,拆开后每步都"成功"而合起来什么也没采到 —— 本仓反复踩的形态。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runFlow, type FlowCapabilities } from '../../src/platform/main/flow/flow-runner';
import type { FlowRecipe, FlowStepOutcome } from '../../src/shared/types/flow-recipe-types';

/** ⚠️ 不碰真库:留痕写失败本来就只 warn 不上抛,这里直接让它失败 */
vi.mock('../../src/platform/main/flow/flow-run-repo', () => ({
  startRun: vi.fn(async () => {}),
  recordStep: vi.fn(async () => {}),
  endRun: vi.fn(async () => {}),
}));

const ok = (produced = 1): FlowStepOutcome => ({ ok: true, produced, elapsedMs: 1 });
const fail = (error: string): FlowStepOutcome => ({ ok: false, produced: 0, error, elapsedMs: 1 });

function caps(over: Partial<FlowCapabilities> = {}): FlowCapabilities {
  return {
    goto: vi.fn(async () => ok()),
    collect: vi.fn(async () => ok(10)),
    judge: vi.fn(async () => ok(5)),
    planReply: vi.fn(async () => ok(2)),
    ...over,
  };
}

const recipe = (steps: FlowRecipe['steps']): FlowRecipe => ({
  recipeId: 'r1', name: 'X 搜索→判断→拟回复', steps,
});

const FOUR: FlowRecipe['steps'] = [
  { id: 's1', kind: 'goto', label: '导航到搜索页' },
  { id: 's2', kind: 'collect', label: '采集' },
  { id: 's3', kind: 'judge', label: 'AI 判断' },
  { id: 's4', kind: 'planReply', label: '拟回复' },
];

describe('⭐⭐ 四步串起来,每步都有结果', () => {
  it('⭐ 全成功:四步都跑、都记产出', async () => {
    const r = await runFlow(recipe(FOUR), caps());
    expect(r.ok, '全成功却报失败').toBe(true);
    expect(r.steps.map((s) => s.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(r.steps.map((s) => s.produced), '产出数没带回来 —— 「跑了多少」查不到')
      .toEqual([1, 10, 5, 2]);
    expect(r.runId, '没有 runId —— 记录串不起来').toMatch(/^run_/);
  });

  it('⭐⭐ 参数原样透传给能力(编排层不解释它)', async () => {
    const c = caps();
    await runFlow(recipe([{ id: 's', kind: 'collect', params: { page: 'x.search', q: 'VPN' } }]), c, { wsId: 'ws-1' });
    expect(c.collect, '参数没透传 —— 编排层擅自改写会与能力层漂')
      .toHaveBeenCalledWith({ page: 'x.search', q: 'VPN' }, 'ws-1');
  });
});

describe('⚠️⚠️ 失败语义:一步断了,后面的必须 skipped 而不是继续跑', () => {
  it('⭐⭐ 采集失败 → 判断/拟回复都不跑', async () => {
    /**
     * ⚠️ 四步是**有依赖**的:没采到数据,判断就没有输入。
     * 硬往下跑会得到一串「成功但产出 0」,而真因埋在第一步 ——
     * 那正是「看着成功实际没有」。
     */
    const c = caps({ collect: vi.fn(async () => fail('页面没到位')) });
    const r = await runFlow(recipe(FOUR), c);
    expect(r.ok).toBe(false);
    expect(r.failedAt, '没指出是哪一步断的').toBe('s2');
    expect(r.steps.map((s) => s.status)).toEqual(['ok', 'failed', 'skipped', 'skipped']);
    expect(c.judge, '前一步断了还去跑判断 —— 会得到「成功但产出 0」的假象')
      .not.toHaveBeenCalled();
  });

  it('⚠️ 跳过的步骤要写明**为什么**跳(不能都叫 skipped 了事)', async () => {
    const r = await runFlow(recipe(FOUR), caps({ collect: vi.fn(async () => fail('x')) }));
    expect(r.steps[2].note, '没说清为什么跳过 —— 回看时要靠猜').toContain('s2');
  });

  it('⚠️⚠️ 能力抛异常也要落成 failed,不能让整条 run 炸掉', async () => {
    const c = caps({ judge: vi.fn(async () => { throw new Error('Ollama 没起来'); }) });
    const r = await runFlow(recipe(FOUR), c);
    expect(r.steps[2].status, '抛异常的那步没落记录 —— 它在记录里根本不存在').toBe('failed');
    expect(r.steps[2].error, '异常信息丢了').toContain('Ollama');
  });

  it('⚠️ 编排档写了不存在的步骤类型 → fail loud,不静默跳过', async () => {
    const r = await runFlow(recipe([{ id: 'x', kind: 'nonexistent' as never }]), caps());
    expect(r.ok).toBe(false);
    expect(r.steps[0].error, '未知步骤类型被静默跳过了').toContain('没有对应能力');
  });
});

describe('⭐ 「产出 0」不等于失败', () => {
  it('⚠️⚠️ 判断队列本来就空 —— ok=true 且 produced=0,不许报失败', async () => {
    /**
     * ⚠️ 这两件事合在一起报,会让人去查一个不存在的故障。
     */
    const c = caps({ judge: vi.fn(async () => ({ ok: true, produced: 0, note: '队列是空的', elapsedMs: 1 })) });
    const r = await runFlow(recipe(FOUR), c);
    expect(r.ok, '「产出 0」被当成失败了').toBe(true);
    expect(r.steps[2].produced).toBe(0);
    expect(c.planReply, '产出 0 就不往下跑了 —— 那是失败的语义,不是这里的')
      .toHaveBeenCalled();
  });
});

describe('⭐ 人按了停 / 档里关掉,与失败分得开', () => {
  it('⭐⭐ 停止后的步骤标 skipped,理由写「人工停止」', async () => {
    let n = 0;
    const r = await runFlow(recipe(FOUR), caps(), { isAborted: () => ++n > 2 });
    expect(r.steps[0].status).toBe('ok');
    const stopped = r.steps.filter((s) => s.note?.includes('人工停止'));
    expect(stopped.length, '停止的理由没写进记录 —— 与失败分不开').toBeGreaterThan(0);
    expect(r.ok, '人停的不该算失败').toBe(true);
  });

  it('⭐ enabled:false 的步骤跳过,理由写「档里关掉了」', async () => {
    const c = caps();
    const r = await runFlow(recipe([
      { id: 's1', kind: 'collect' },
      { id: 's2', kind: 'judge', enabled: false },
    ]), c);
    expect(r.steps[1].status).toBe('skipped');
    expect(r.steps[1].note, '没说清是配置关掉的还是故障').toContain('关掉');
    expect(c.judge, '关掉的步骤还是跑了').not.toHaveBeenCalled();
  });
});
