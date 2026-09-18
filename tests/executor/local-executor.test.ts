/**
 * ⭐⭐ `LocalExecutor` —— **真调函数**,假的只有 Ollama 那一层
 *
 * ── 为什么每条都必须在 ──
 *
 * 执行者契约里最要命的一条是:**「模型说不」是 `Ok`,不是 `Failed`。**
 * 模型正常工作并给出否定结论 = 执行成功;只有**没执行成**才是 Failed。
 * 混在一起的话,指挥层分不清「判了说不行」(该接受结论)和
 * 「根本没跑起来」(该重试)—— 处置完全相反。
 *
 * ⚠️ 只断言「源码里有 ok(」对这些行为**零区分力** —— 必须真跑。
 * 假的只有 `callOllama`(不想真连 Ollama),其余全是真逻辑。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** 假 Ollama:每个用例自己决定这次是返回什么、还是抛什么 */
const mockCall = vi.fn();
vi.mock('@platform/main/local-llm/ollama-client', () => ({
  callOllama: (...args: unknown[]) => mockCall(...args),
}));

import { LocalExecutor } from '@platform/main/executor/local-executor';
import type { ExecuteTask, ExecuteMaterial } from '@platform/main/executor/executor-types';
import { isOk, isFailed } from '@platform/main/web-capability/result';

const task = (over: Partial<ExecuteTask> = {}): ExecuteTask => ({
  kind: 'judge',
  instruction: '判断这条推文该不该回复,给出 worth 与理由',
  ...over,
});

const material = (over: Partial<ExecuteMaterial> = {}): ExecuteMaterial => ({
  content: '求推荐一个好用的机场,最近老是连不上',
  ...over,
});

const exec = (model = 'gemma3:27b') => new LocalExecutor({ model });

beforeEach(() => {
  mockCall.mockReset();
});

describe('⭐⭐ 「模型说不」是 Ok —— 契约里最要命的一条', () => {
  it('⭐⭐ 模型给出**否定**结论 → Ok(执行成功,结论是否定)', async () => {
    // 模型正常工作,判「不值得回」
    mockCall.mockResolvedValue({ content: '{"worth":false,"reason":"这是同行广告"}' });

    const r = await exec().execute(task({ structured: true }), material());

    expect(
      isOk(r),
      '模型说不被当成了 Failed —— 指挥层会去重试一个**已经成功**的判断',
    ).toBe(true);
    if (!isOk(r)) return;
    expect((r.value.parsed as { worth: boolean }).worth).toBe(false);
  });

  it('⭐ 模型给出肯定结论 → 同样是 Ok(两种结论走同一条路)', async () => {
    mockCall.mockResolvedValue({ content: '{"worth":true,"reason":"真实求助"}' });

    const r = await exec().execute(task({ structured: true }), material());

    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect((r.value.parsed as { worth: boolean }).worth).toBe(true);
  });
});

describe('⭐⭐ 没执行成才是 Failed,且 retryable 要分得清', () => {
  it('⭐⭐ 超时 → Failed 且**可重试**(Ollama 可能正忙)', async () => {
    mockCall.mockRejectedValue(new Error('The operation was aborted'));

    const r = await exec().execute(task(), material());

    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) return;
    expect(r.retryable, '超时判成不可重试 —— 编排层会直接放弃一个本可成功的任务').toBe(true);
  });

  it('⭐⭐ HTTP 4xx(模型名写错)→ Failed 且**不可重试**', async () => {
    // 重试一百次还是一样,只会让编排层空转
    mockCall.mockRejectedValue(new Error('Ollama HTTP 404: model "gemma9:99b" not found'));

    const r = await exec().execute(task(), material());

    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) return;
    expect(r.retryable, '模型名写错却判成可重试 —— 编排层会空转').toBe(false);
    expect(r.reason, '没把原始错误带出去,排查时只剩一句废话').toContain('404');
  });

  it('⭐ 连不上 → Failed 且可重试', async () => {
    mockCall.mockRejectedValue(new Error('fetch failed: ECONNREFUSED 127.0.0.1:11434'));

    const r = await exec().execute(task(), material());

    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) return;
    expect(r.retryable).toBe(true);
  });

  it('⭐ HTTP 5xx → Failed 且可重试(服务端临时故障)', async () => {
    mockCall.mockRejectedValue(new Error('Ollama HTTP 503: service unavailable'));

    const r = await exec().execute(task(), material());

    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) return;
    expect(r.retryable).toBe(true);
  });
});

describe('⭐⭐ 空串与解析失败:静默坍缩的两种形态', () => {
  it('⭐⭐ 模型返回**空串** → Failed,不是「结论为空」的 Ok', async () => {
    /**
     * 记忆 project-x-reply-latency:num_predict 调档会让模型直接返空串,
     * 而当时那被当成了正常返回 —— 典型的静默坍缩。
     */
    mockCall.mockResolvedValue({ content: '   ' });

    const r = await exec().execute(task(), material());

    expect(isFailed(r), '空串被当成了成功 —— 下游会拿着空结论继续走').toBe(true);
    if (!isFailed(r)) return;
    expect(r.reason).toContain('空串');
  });

  it('⭐⭐ 要求结构化却返回非 JSON → Failed(**不是** Degraded)', async () => {
    // 给 Degraded 会让调用方以为「凑合能用」,而它根本没法用
    mockCall.mockResolvedValue({ content: '我觉得这条可以回复,因为看起来是真实求助' });

    const r = await exec().execute(task({ structured: true }), material());

    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) return;
    expect(r.status, 'Degraded 会被当成「部分可用」').not.toBe('degraded');
    expect(r.reason).toContain('JSON');
  });

  it('⭐ 非结构化任务返回纯文本 → Ok(本来就不要求 JSON)', async () => {
    mockCall.mockResolvedValue({ content: '这条值得回复。' });

    const r = await exec().execute(task({ structured: false }), material());

    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.parsed, '没要求结构化就不该有 parsed').toBeUndefined();
  });
});

describe('⭐ 入参不合法:当场 Failed 且不可重试,不去打扰模型', () => {
  it('⭐ 没有 instruction → Failed,且**没调过模型**', async () => {
    const r = await exec().execute(task({ instruction: '  ' }), material());

    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) return;
    expect(r.retryable).toBe(false);
    expect(mockCall, '没告诉它判什么却已经把请求发出去了').not.toHaveBeenCalled();
  });

  it('⭐ 素材为空 → Failed,且没调过模型', async () => {
    const r = await exec().execute(task(), material({ content: '' }));

    expect(isFailed(r)).toBe(true);
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('⭐⭐ 构造时不给 model → 当场抛(不给默认值)', () => {
    // 默认值会让留痕里「哪个模型判的」永远说不清
    expect(() => new LocalExecutor({ model: '  ' })).toThrow(/model 必填/);
  });
});

describe('⭐ 产物要带得出事实 —— 择优/核验/留痕都靠它', () => {
  it('⭐⭐ 带得出「谁判的」「哪个模型」「多久」', async () => {
    mockCall.mockResolvedValue({ content: 'ok' });

    const r = await exec('gemma3:27b').execute(task(), material());

    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.by, '不知道是谁给的结果,择优时无从比较').toBe('local:gemma3:27b');
    expect(r.value.model).toBe('gemma3:27b');
    expect(typeof r.value.elapsedMs).toBe('number');
  });

  it('⭐ 自定义执行者名字(将来三个 AI 并行时要分得开)', async () => {
    mockCall.mockResolvedValue({ content: 'ok' });

    const e = new LocalExecutor({ model: 'gemma3:27b', name: 'gemma-主判' });
    const r = await e.execute(task(), material());

    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.by).toBe('gemma-主判');
  });
});

describe('⭐⭐ 执行者不碰业务:同一个执行者跑不同判据', () => {
  it('⭐⭐ 「蓝V该不该点赞」与「该不该回复」走同一个执行者,只换 instruction', async () => {
    /**
     * 用户定的方向:判断种类会不断增加(VPN 求助回复 → 蓝V点赞/转发 → …),
     * **执行者不该因此改代码**。这条钉住这一点。
     */
    mockCall.mockResolvedValue({ content: '{"like":true}' });

    const e = exec();
    await e.execute(task({ instruction: '判断这条推该不该点赞', structured: true }), material());

    const sent = mockCall.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    expect(sent.messages[0].role).toBe('system');
    expect(sent.messages[0].content, 'instruction 没原样进 system —— 判据被改写了').toBe(
      '判断这条推该不该点赞',
    );
  });

  it('⭐ 附件带**名字**进 prompt(模型要能引用「推主概况里说…」)', async () => {
    mockCall.mockResolvedValue({ content: 'ok' });

    await exec().execute(task(), material({
      attachments: { 推主概况: { followers: 1200, verified: true } },
    }));

    const sent = mockCall.mock.calls[0][0] as { messages: Array<{ content: string }> };
    const user = sent.messages[1].content;
    expect(user, '附件没带名字 —— 会被当成主体的一部分读').toContain('[推主概况]');
    expect(user).toContain('1200');
  });
});

describe('⭐⭐ 卷宗:主体 + 附件 + 缺了什么', () => {
  it('⭐⭐ 缺附件 → Degraded(判了,但没看全),不是 Ok', async () => {
    /**
     * 当成 Ok 的话,调用方会以为这是有依据的判断,
     * 而它可能只看了单条推 —— 「瞎判」与「有依据」必须分得开。
     */
    mockCall.mockResolvedValue({ content: '{"worth":true}' });

    const r = await exec().execute(task({ structured: true }), material({
      missing: ['推主概况', '上下文'],
    }));

    expect(r.status, '缺附件却报 Ok —— 判断依据不足这件事被吞了').toBe('degraded');
    if (r.status !== 'degraded') return;
    expect(r.missing).toEqual(['推主概况', '上下文']);
    // ⭐ 但产物照样在:Degraded 是「做了但不完整」,不是失败
    expect((r.value.parsed as { worth: boolean }).worth).toBe(true);
  });

  it('⭐⭐ 缺了什么要**明说进 prompt** —— 否则模型把「没查到」当「没有」', async () => {
    /**
     * 不说的话,模型默认「没提到=没有」,于是
     * 「查过了,这人没被回过」与「压根没查」变成同一句话 ——
     * 而这两者的结论方向相反。
     */
    mockCall.mockResolvedValue({ content: 'ok' });

    await exec().execute(task(), material({ missing: ['上下文'] }));

    const sent = mockCall.mock.calls[0][0] as { messages: Array<{ content: string }> };
    const user = sent.messages[1].content;
    expect(user, '没告诉模型缺了什么').toContain('没能取到');
    expect(user).toContain('上下文');
    expect(user, '没说清要当「不知道」而不是「没有」').toContain('不知道');
  });

  it('⭐ 附件齐全(missing 为空)→ 仍是 Ok', async () => {
    mockCall.mockResolvedValue({ content: 'ok' });

    const r = await exec().execute(task(), material({
      attachments: { 推主概况: '一个真实用户' },
      missing: [],
    }));

    expect(r.status, '空 missing 被当成了「有缺失」').toBe('ok');
  });

  it('⭐⭐ 主体为空仍是 Failed —— 那不是「缺附件」,是没东西可判', async () => {
    const r = await exec().execute(task(), material({
      content: '',
      attachments: { 推主概况: '有料' },
    }));

    expect(isFailed(r)).toBe(true);
    expect(mockCall, '没有主体却已经把请求发出去了').not.toHaveBeenCalled();
  });
});
