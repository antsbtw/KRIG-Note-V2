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

  it('⭐⭐ 业务参数原样透传(编排层不解释、不改写)', async () => {
    /**
     * ⚠️⚠️ 2026-09-24 这条**从精确匹配改成包含匹配**,而且是有原因的:
     *
     * 编排器现在会注入**运行时元数据**(`__runId`,与 handler 注入 `wcId` 同一类),
     * 精确匹配会把它当成「擅自改写」而红。
     * ⭐ 但**放宽不等于取消** —— 区分两类:
     *  · **业务参数**(page/q/pageBudget…):编排层**一个字都不许改**
     *  · **运行时元数据**(`__runId`/`wcId`):由执行层注入,用 `__` 前缀标明
     * ⚠️ 所以这里改成:业务参数必须原样在(objectContaining),
     *   同时**钉死编排层没动过它们的值**。
     */
    const c = caps();
    await runFlow(recipe([{ id: 's', kind: 'collect', params: { page: 'x.search', q: 'VPN' } }]), c, { wsId: 'ws-1' });
    expect(c.collect, '业务参数没透传 —— 编排层擅自改写会与能力层漂')
      .toHaveBeenCalledWith(
        expect.objectContaining({ page: 'x.search', q: 'VPN' }),
        'ws-1',
      );
    /** ⚠️ 注入的只许是带 `__` 前缀的元数据,别的一律不许加 */
    const passed = (c.collect as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<string, unknown>;
    const extras = Object.keys(passed).filter((k) => !['page', 'q'].includes(k));
    expect(extras.every((k) => k.startsWith('__')),
      `编排层往参数里塞了业务字段:${extras.filter((k) => !k.startsWith('__')).join(', ')}`)
      .toBe(true);
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

describe('⚠️⚠️ wcId 必须一路传到每一步(2026-09-24 实测:漏了就四步全废)', () => {
  const strip = (x: string) =>
    x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const read = (f: string) => strip(readFileSync(join(process.cwd(), f), 'utf-8'));
  const handler = read('src/platform/main/ipc/web-console-handler.ts');
  const view = read('src/views/web-console/WebConsoleView.tsx');

  it('⭐⭐ 面板调 runFlow 时要带 wcId', () => {
    /**
     * ── 实测 ──
     * 第一次跑编排:第一步 goto 就报「X 实例未就绪(未登记 wc id)」,
     * 后三步连带 skipped —— 四步全废,而用户看到的是「没有任何反应」。
     * ⚠️ 采集按钮一直传 `wcId: wcId()`,编排这条新路径漏了。
     */
    const i = view.indexOf('api()!.runFlow(');
    expect(i, '找不到 runFlow 调用').toBeGreaterThan(0);
    const blk = view.slice(i, i + 160);
    expect(blk, 'runFlow 没带 wcId —— 第一步就会报「X 实例未就绪」')
      .toMatch(/wcId:\s*wcId\(\)/);
  });

  it('⭐⭐ handler 把 wcId 注入每一步的 params(而不是写进编排档)', () => {
    const i = handler.indexOf('WEBC_RUN_FLOW');
    expect(i, '找不到 runFlow handler').toBeGreaterThan(0);
    const blk = handler.slice(i, i + 1800);
    expect(blk, 'wcId 没注入步骤参数 —— 适配器拿不到实例')
      .toMatch(/params:\s*\{\s*wcId/);
    /**
     * ⚠️ 档里已写的优先:`{ wcId, ...st.params }` 而不是 `{ ...st.params, wcId }` ——
     * 后者会把调用方显式指定的值覆盖掉。
     */
    expect(blk, '注入顺序反了 —— 会覆盖编排档里显式指定的 wcId')
      .toMatch(/wcId,\s*\.\.\.\(st\.params/);
  });

  it('⭐ 编排结果要在面板上逐步显示(否则跑了像没跑)', () => {
    expect(view, '编排结果没渲染 —— 用户会以为「没有任何反应」')
      .toMatch(/rep\.steps\.map/);
    expect(view, '没显示断在哪一步').toMatch(/failedAt/);
  });
});

describe('⚠️⚠️ 收 run 必须真的收掉(2026-09-24 实测:两次运行都卡在 running)', () => {
  const strip = (x: string) =>
    x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const repo = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/flow/flow-run-repo.ts'), 'utf-8'));
  const caps = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/x/x-flow-capabilities.ts'), 'utf-8'));

  it('⭐⭐ duration 必须用 duration::millis(),不能自己除', () => {
    /**
     * ── 实测真因 ──
     * `math::floor((time::now() - started_at) / 1ms)` 算出来是 **NaN**,
     * 被 schema 拒收(Expected none | int but found NaN)→ **整条 UPDATE 失败**
     * → run 永远停在 running。
     * ⚠️ 而 catch 把它吞成 warn,于是**两次运行都卡住也没人发现** ——
     * 「跑到一半崩了」与「跑完了」在记录里长得一模一样。
     */
    expect(repo, 'duration 又改回自己除了 —— 会算出 NaN,整条 UPDATE 被拒')
      .not.toMatch(/\/ 1ms\)/);
    expect(repo, '没用 duration::millis()').toMatch(/duration::millis\(/);
  });

  it('⚠️⚠️ 收 run 失败要响,不能静默 warn', () => {
    const i = repo.indexOf('export async function endRun');
    expect(i, '找不到 endRun').toBeGreaterThan(0);
    const blk = repo.slice(i, i + 1600);
    expect(blk, '收 run 失败还是静默 warn —— 这次执行「没有结局」却没人知道')
      .toMatch(/console\.error/);
    /** ⭐ 写了但 0 行也要响:runId 对不上时 UPDATE 不报错,只是影响 0 行 */
    expect(blk, '没检查「更新了几行」—— runId 对不上时照样停在 running')
      .toMatch(/rows === 0/);
  });

  it('⭐⭐ planReply 要报**为什么**跳过,不能只报总数', () => {
    /**
     * ⚠️ 实测编排报「扫了 10 条,拟出 0 条,跳过 10 条」而**为什么跳一个字没有** ——
     * 「模型都说不值得回」和「这 10 条早就回过了」长得一模一样,
     * 还得再去查库才知道。那正是编排该消灭的东西。
     */
    const i = caps.indexOf('async planReply(');
    expect(i, '找不到 planReply 适配器').toBeGreaterThan(0);
    const blk = caps.slice(i, i + 1800);
    expect(blk, '跳过原因没有分类聚合 —— 人看不出是哪种跳过')
      .toMatch(/skipReason/);
  });
});

describe('⭐⭐ 档级共享参数:只写一遍,步骤可覆盖', () => {
  it('⚠️⚠️ shared 的参数要传给每一步(搜索词原来写了两遍)', async () => {
    /**
     * ── 2026-09-24 修掉的坑 ──
     * 搜索词在档里 goto 一遍、collect 一遍。改一个忘另一个就会
     * 「导航到 A 页、采集却采 B 页」—— 而且**不报错**,结果看着正常。
     */
    const c = caps();
    await runFlow({
      recipeId: 'r', name: 'n',
      shared: { page: 'x.search', params: { q: 'VPN' } },
      steps: [{ id: 's1', kind: 'goto' }, { id: 's2', kind: 'collect' }],
    }, c);
    /** ⚠️ 包含匹配 —— 编排器会注入 `__runId` 这类运行时元数据(见上面那条的说明) */
    expect(c.goto, 'shared 没传给 goto').toHaveBeenCalledWith(
      expect.objectContaining({ page: 'x.search', params: { q: 'VPN' } }), undefined);
    expect(c.collect, 'shared 没传给 collect —— 两步会跑不同的词').toHaveBeenCalledWith(
      expect.objectContaining({ page: 'x.search', params: { q: 'VPN' } }), undefined);
  });

  it('⭐ 步骤自己写的**优先**于 shared', async () => {
    const c = caps();
    await runFlow({
      recipeId: 'r', name: 'n',
      shared: { page: 'x.search', pageBudget: 40 },
      steps: [{ id: 's', kind: 'collect', params: { pageBudget: 3 } }],
    }, c);
    expect(c.collect, '步骤参数被 shared 覆盖了 —— 改不动单步设置')
      .toHaveBeenCalledWith(expect.objectContaining({ page: 'x.search', pageBudget: 3 }), undefined);
  });

  it('⭐ 没有 shared 时照常工作(不许因此报错)', async () => {
    const c = caps();
    const r = await runFlow({
      recipeId: 'r', name: 'n', steps: [{ id: 's', kind: 'judge', params: { batchSize: 5 } }],
    }, c);
    expect(r.ok).toBe(true);
    expect(c.judge).toHaveBeenCalledWith(expect.objectContaining({ batchSize: 5 }), undefined);
  });

  it('⚠️ 默认档里搜索词只出现一次(不许再写两遍)', () => {
    const strip2 = (x: string) =>
      x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const src = strip2(readFileSync(
      join(process.cwd(), 'src/platform/main/x/x-flow-recipes.ts'), 'utf-8'));
    const hits = (src.match(/科学上网/g) ?? []).length;
    expect(hits, `搜索词在档里出现 ${hits} 次 —— 写多遍就会「改一个忘另一个」`)
      .toBeLessThanOrEqual(1);
  });
});

describe('⭐⭐ 进度广播:长任务不能是黑箱', () => {
  it('⚠️⚠️ 每步**开始**就要发一次(判断那步 5.5 分钟的唯一反馈)', async () => {
    /**
     * ── 实测 ──
     * 四步耗时 0.1s / 30.8s / **330.8s** / 0.5s —— 差 3000 倍。
     * 而 runFlow 是一个 invoke 等到底,判断那 5.5 分钟里 renderer 什么都收不到,
     * 用户看到的就是「没有任何反应」。
     * ⭐ 所以**开始时**就得发,不能只在结束时发。
     */
    const seen: Array<{ seq: number; status: string }> = [];
    await runFlow(recipe([
      { id: 's1', kind: 'collect' }, { id: 's2', kind: 'judge' },
    ]), caps(), { onProgress: (p) => seen.push({ seq: p.seq, status: p.status }) });

    const running = seen.filter((x) => x.status === 'running');
    expect(running.length, '没有 running 事件 —— 长步骤跑起来仍是黑箱').toBe(2);
    /** ⭐ 顺序必须是 开始→结束,不能只有结束 */
    expect(seen[0]).toEqual({ seq: 1, status: 'running' });
    expect(seen[1]).toEqual({ seq: 1, status: 'ok' });
  });

  it('⚠️⚠️ 进度里必须带 wsId(多窗口下不带就会串台)', async () => {
    /** ⚠️ 广播发给所有 renderer,不带 wsId 接收方无从核对 */
    const seen: Array<{ wsId?: string }> = [];
    await runFlow(recipe([{ id: 's', kind: 'collect' }]), caps(),
      { wsId: 'ws-2', onProgress: (p) => seen.push({ wsId: p.wsId }) });
    expect(seen.every((x) => x.wsId === 'ws-2'), '进度没带 wsId —— A 窗口的进度会显示在 B 窗口')
      .toBe(true);
  });

  it('⭐ 要带总步数(面板要显示「3/4」)', async () => {
    const seen: number[] = [];
    await runFlow(recipe(FOUR), caps(), { onProgress: (p) => seen.push(p.total) });
    expect(seen.every((t) => t === 4), '总步数不对 —— 面板显示不出进度').toBe(true);
  });

  it('⚠️⚠️ 进度回调抛错**不许拦执行**(降级要局部)', async () => {
    /**
     * ⚠️ 面板没收到进度 ≠ 采集失败。
     * 让广播失败拖垮执行,等于「因为记不下来而把成功翻案」。
     */
    const r = await runFlow(recipe(FOUR), caps(), {
      onProgress: () => { throw new Error('renderer 没了'); },
    });
    expect(r.ok, '进度回调抛错把整条 run 弄失败了').toBe(true);
    expect(r.steps.every((x) => x.status === 'ok')).toBe(true);
  });

  it('⭐ 跳过的步骤也要发进度(否则面板上那几行永远停在「未开始」)', async () => {
    const seen: Array<{ stepId: string; status: string }> = [];
    await runFlow(recipe(FOUR), caps({ collect: vi.fn(async () => fail('x')) }),
      { onProgress: (p) => seen.push({ stepId: p.stepId, status: p.status }) });
    const skipped = seen.filter((x) => x.status === 'skipped');
    expect(skipped.length, '跳过的步骤没发进度 —— 面板上会一直显示「未开始」').toBe(2);
  });

  it('⚠️ handler 广播时要核对 —— 带 wsId 发出去', () => {
    const strip2 = (x: string) =>
      x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const h = strip2(readFileSync(
      join(process.cwd(), 'src/platform/main/ipc/web-console-handler.ts'), 'utf-8'));
    expect(h, 'handler 没把进度广播出去 —— 面板订阅了也收不到')
      .toMatch(/WEBC_FLOW_PROGRESS/);
    expect(h, '没接 onProgress').toMatch(/onProgress:/);
  });
});

describe('⭐⭐ 草稿落库:拟出几条与存进几条必须分开报', () => {
  /**
   * ⚠️⚠️ **这组守卫的使命变了,不是放宽** —— 2026-09-24 当天两次改动:
   *
   * 上午:查实草稿**没有落库**(planReplies 只返回、x_tweet 无 reply_draft 字段、
   *      UI 放 useState),于是要求适配器**如实标注「没落库」**。
   * 下午:用户拍板「落库,这是未来AI学习和优化的环节吧?」→ 建了 x_reply_draft
   *      (migration 1.2.8),草稿真的存下来了。
   *
   * ⭐ 此时再要求代码说「没落库」就成了**要求代码说谎** ——
   *   保留**意图**(不许「报 N 条而查无实据」),换掉**手段**。
   * ⭐ 写上一版时就留了后手:另一条守卫钉住「x_tweet 上没有 reply_draft」这个依据,
   *   正是它提醒了这次该一起改。
   */
  const strip2 = (x: string) =>
    x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const caps2 = strip2(readFileSync(
    join(process.cwd(), 'src/platform/main/x/x-flow-capabilities.ts'), 'utf-8'));

  it('⭐⭐ 拟出草稿时要报**落库结果**,不能只报拟了几条', () => {
    /**
     * ⚠️ 「拟出 6 条」而库里一条都没有 —— 那是本仓最忌的「看着成功实际没有」。
     * ⭐ 两个数都报,相等才算真成。
     */
    const i2 = caps2.indexOf('async planReply(');
    expect(i2, '找不到 planReply 适配器').toBeGreaterThan(0);
    const blk = caps2.slice(i2, i2 + 2600);
    expect(blk, '没报落库结果 —— 人无法判断草稿是否真的存下来了')
      .toMatch(/persisted|已落库/);
    expect(blk, '落库失败时没把失败条数报出来').toMatch(/failed/);
  });
});

describe('⚠️⚠️ runId 要传到每一步(2026-09-24 实测:草稿落库了但 run_id 是 None)', () => {
  it('⭐⭐ 步骤参数里必须带 __runId', async () => {
    /**
     * ── 实测 ──
     * 草稿真的落库了,但 `run_id` 是 **None**。
     * 真因:`planReplyBatch` 能收 runId,而**适配器拿不到**(签名里没有)——
     * 典型的「类型有、字段有、消费端零传递」死字段。
     * ⭐ 后果:库里的草稿说不清「这批是哪一跑的产物」,
     *   回头对账「哪次编排质量好」就无从查起。
     */
    const c = caps();
    const r = await runFlow(recipe([{ id: 's', kind: 'planReply' }]), c);
    expect(c.planReply, 'runId 没注入步骤参数 —— 草稿存进库也说不清是哪一跑的')
      .toHaveBeenCalledWith(
        expect.objectContaining({ __runId: r.runId }),
        undefined,
      );
  });

  it('⭐ 编排档里显式写的参数优先于注入(与 wcId 同一套顺序)', async () => {
    const c = caps();
    await runFlow(recipe([
      { id: 's', kind: 'collect', params: { __runId: 'explicit' } },
    ]), c);
    expect(c.collect, '注入把档里显式写的值覆盖了')
      .toHaveBeenCalledWith(expect.objectContaining({ __runId: 'explicit' }), undefined);
  });

  it('⚠️ 适配器要把 __runId 真的传给 planReplyBatch(不能只收不用)', () => {
    const strip3 = (x: string) =>
      x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const caps3 = strip3(readFileSync(
      join(process.cwd(), 'src/platform/main/x/x-flow-capabilities.ts'), 'utf-8'));
    const i = caps3.indexOf('planReplyBatch(wsId');
    expect(i, '找不到 planReplyBatch 调用').toBeGreaterThan(0);
    const blk = caps3.slice(i, i + 400);
    expect(blk, '适配器收了 __runId 却没往下传 —— 库里 run_id 还是空')
      .toMatch(/runId: str\(params\.__runId\)/);
  });
});
/**
 * ⭐⭐ **没有候选就别往下跑** —— 用户 2026-09-26 点破的:
 *
 * > 「既然值得回复是零条,为什么第四步还需要跑呢?」
 *
 * 真因不是第 4 步的 bug,是**契约缺了一格**:
 * 判断步的 `produced: 10` 是「判了 10 条」,而真正该当闸门的
 * 「值得回复 0 条」**只写在给人看的 note 里,编排读不到** → 第 4 步空转 125 秒。
 */
describe('⭐⭐ hasCandidates:没有候选就跳过后续', () => {
  const judged10worth0 = (): FlowStepOutcome => ({
    ok: true, produced: 10, hasCandidates: false,
    note: '判了 10/10 条,其中值得回复 0 条', elapsedMs: 1,
  });

  it('⭐⭐ 判断说没候选 → 第 4 步**真的没被调用**', async () => {
    const c = caps({ judge: vi.fn(async () => judged10worth0()) });
    const r = await runFlow(recipe(FOUR), c);
    /** ⚠️ 行为断言:光看状态不够,要确认那个函数**压根没被调** */
    expect(c.planReply, '第 4 步还是被调用了 —— 闸门没生效,又会空转 125 秒')
      .not.toHaveBeenCalled();
    expect(r.steps[3].status).toBe('skipped');
  });

  it('⭐ 跳过的理由要与「失败/人停/档里关掉」分得开', async () => {
    const r = await runFlow(
      recipe(FOUR), caps({ judge: vi.fn(async () => judged10worth0()) }));
    const note = r.steps[3].note ?? '';
    expect(note, '没说是哪一步没产出候选').toContain('s3');
    expect(note, '没说清是「没东西可做」').toMatch(/没有产出候选/);
    /** ⚠️ 这不是故障:整条 run 仍是 ok,且没有 failedAt */
    expect(r.ok, '没候选被当成了失败 —— 那是两回事').toBe(true);
    expect(r.failedAt, '没候选不该记成「断在这一步」').toBeUndefined();
  });

  it('⚠️ produced=0 但没表态(undefined)→ 照跑,不误刹', async () => {
    /**
     * ⚠️ 判据必须是 `=== false` 不是 falsy:
     * 老能力不写这个字段,不能因为加了字段就被误刹。
     */
    const c = caps({ judge: vi.fn(async () => ({ ok: true, produced: 0, elapsedMs: 1 })) });
    await runFlow(recipe(FOUR), c);
    expect(c.planReply, '没表态却被刹住了 —— 老能力会全部失灵')
      .toHaveBeenCalled();
  });

  it('⭐ hasCandidates=true 时照常往下跑', async () => {
    const c = caps({
      judge: vi.fn(async () => ({ ok: true, produced: 10, hasCandidates: true, elapsedMs: 1 })),
    });
    await runFlow(recipe(FOUR), c);
    expect(c.planReply, '有候选反而不跑了').toHaveBeenCalled();
  });
});

/**
 * ⭐⭐ **观察点** —— 用户 2026-09-26:
 * > 「每一个环节都应该有观察点,这样才可以真正追溯效果。」
 *
 * ⚠️ 要害不是「有没有记」(flow_step_run 底座早就有),是**记了什么**:
 * 原来 `output` 只有 `{produced, note}`,要追溯「Gemma 为什么判错」
 * 得去 `x_tweet` 反查 —— **而那张表有 TTL**。
 */
describe('⭐⭐ evidence 观察点进留痕', () => {
  it('⭐⭐ evidence 真的进了 recordStep 的 output(不是只在类型里)', async () => {
    const { recordStep } = await import('../../src/platform/main/flow/flow-run-repo');
    vi.mocked(recordStep).mockClear();
    const ev = { items: [{ fetched: 10, judged: 10, worth: 0 }] };
    await runFlow(recipe([{ id: 's3', kind: 'judge' }]), caps({
      judge: vi.fn(async () => ({ ok: true, produced: 10, evidence: ev, elapsedMs: 1 })),
    }));
    const calls = vi.mocked(recordStep).mock.calls;
    expect(calls.length, 'recordStep 压根没被调').toBeGreaterThan(0);
    const out = calls[calls.length - 1][1].output as Record<string, unknown>;
    expect(out.evidence, 'evidence 没落库 —— 观察点白设了').toEqual(ev);
  });

  it('⭐ 成功路径也要记 evidence(不只失败)', async () => {
    /**
     * ⚠️ 用户已立的铁律:「这次采集完全成功,依据照样蒸发」。
     * 判断对了也要知道**凭什么对**,否则没法回归分析。
     */
    const { recordStep } = await import('../../src/platform/main/flow/flow-run-repo');
    vi.mocked(recordStep).mockClear();
    await runFlow(recipe([{ id: 's3', kind: 'judge' }]), caps({
      judge: vi.fn(async () => ({
        ok: true, produced: 5, evidence: { items: [{ worth: 5 }] }, elapsedMs: 1,
      })),
    }));
    const c = vi.mocked(recordStep).mock.calls;
    const rec = c[c.length - 1][1];
    expect(rec.status, '这是成功路径').toBe('ok');
    expect((rec.output as Record<string, unknown>).evidence, '成功时 evidence 被丢了')
      .toBeDefined();
  });

  it('⭐ hasCandidates 也要进留痕 —— 「为什么后面没跑」要查得到', async () => {
    const { recordStep } = await import('../../src/platform/main/flow/flow-run-repo');
    vi.mocked(recordStep).mockClear();
    await runFlow(recipe([{ id: 's3', kind: 'judge' }]), caps({
      judge: vi.fn(async () => ({ ok: true, produced: 10, hasCandidates: false, elapsedMs: 1 })),
    }));
    const c = vi.mocked(recordStep).mock.calls;
    const out = c[c.length - 1][1].output as Record<string, unknown>;
    expect(out.hasCandidates, 'hasCandidates 没落库').toBe(false);
  });
});

/**
 * ⭐⭐ **step_type 不许兜底** —— 2026-09-26。
 *
 * 原来 `kindToStepType` 末尾是 `return 'fetch'`,新增的步骤会**默认变成 fetch**,
 * 按 step_type 统计时看不出来。
 * ⚠️ 现存一例:`planReply` 的 step_type 是 `judge`,与真判断步归成一类
 * (16+2=18 ＝ 9 judge + 9 planReply)—— 我据此误判过「planReply 一条记录都没有」。
 * → 与 feedback-guard-hardcoded-list-never-grows 同形:**兜底 = 新增项天然在视野外**。
 */
describe('⭐⭐ step_type 登记表不许兜底', () => {
  it('⭐⭐ 没登记的 kind → step_type 是 unknown,不是静默的 fetch', async () => {
    const { recordStep } = await import('../../src/platform/main/flow/flow-run-repo');
    vi.mocked(recordStep).mockClear();
    /** 一个不存在的 kind:下面那道「没有对应能力」的闸会接住它 */
    await runFlow(
      recipe([{ id: 'sX', kind: 'brandNew' as never }]), caps());
    const c = vi.mocked(recordStep).mock.calls;
    expect(c.length, 'recordStep 没被调').toBeGreaterThan(0);
    expect(
      c[0][0].stepType,
      '新 kind 被静默归成了 fetch —— 统计里混进取数那一类就再也看不出来',
    ).toBe('unknown');
  });

  it('⚠️ 已登记的四个 kind 各归各类,planReply 仍是 judge(如实记录现状)', async () => {
    const { recordStep } = await import('../../src/platform/main/flow/flow-run-repo');
    vi.mocked(recordStep).mockClear();
    await runFlow(recipe(FOUR), caps());
    const types = vi.mocked(recordStep).mock.calls.map((c) => c[0].stepType);
    expect(types).toEqual(['act', 'fetch', 'judge', 'judge']);
  });
});
