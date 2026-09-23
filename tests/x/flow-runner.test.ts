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
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('⚠️ 接线:适配器只做转换,不写业务逻辑', () => {
  const strip = (x: string) =>
    x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const read = (f: string) => strip(readFileSync(join(process.cwd(), f), 'utf-8'));
  const caps = read('src/platform/main/x/x-flow-capabilities.ts');
  const handlers = read('src/platform/main/x/x-timeline-handlers.ts');

  it('⭐⭐ 拟回复必须调共用函数,不许抄一份候选逻辑', () => {
    /**
     * ⚠️ 候选池/已回记录/指纹计数/账号 —— 缺一个,拟出来的回复就会重复打扰人,
     * 而且**在结果里看不出来**。抄一份必漂。
     */
    expect(caps, '适配器没调 planReplyBatch').toMatch(/planReplyBatch\(/);
    expect(caps, '适配器自己查候选池了 —— 那是第二份实现')
      .not.toMatch(/queryInbox\(/);
    expect(caps, '适配器自己算指纹了 —— 那是第二份实现')
      .not.toMatch(/textFingerprint/);
  });

  it('⭐ handler 与编排器共用同一个 planReplyBatch', () => {
    expect(handlers, 'planReplyBatch 没导出 —— 编排器就只能抄一份')
      .toMatch(/export async function planReplyBatch/);
    expect(handlers, 'handler 没改成调它 —— 两份实现会漂')
      .toMatch(/await planReplyBatch\(/);
  });

  it('⚠️⚠️ judge:「取到了却一条没判成」必须报失败,不能混进「队列空」', () => {
    const i = caps.indexOf('async judge(');
    expect(i, '找不到 judge 适配器').toBeGreaterThan(0);
    const blk = caps.slice(i, i + 900);
    /** ⚠️ 两种 judged===0 含义相反:队列空是正常,取到没判成是模型故障 */
    expect(blk, '没区分两种 judged===0 —— 模型坏了会被当成「队列空」')
      .toMatch(/fetched > 0 && r\.judged === 0/);
  });

  it('⚠️ 采到 0 条不算失败,但要带上「为什么停」', () => {
    const i = caps.indexOf('async collect(');
    const blk = caps.slice(i, i + 1400);
    expect(blk, 'collect 把 0 条当成失败了').toMatch(/ok: true, produced: r\.saved/);
    expect(blk, '没带停止原因 —— 人看到 0 只能猜').toMatch(/stopReason/);
  });

  it('⭐ 拟回复红线:适配器绝不碰发布', () => {
    for (const forbidden of ['replyTweet', 'postReply', 'markReplied']) {
      expect(caps, `适配器调了 ${forbidden} —— 拟回复只填不发是红线`)
        .not.toMatch(new RegExp(forbidden));
    }
  });
});