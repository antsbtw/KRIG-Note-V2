/**
 * `acquireContent` —— ⭐⭐ **「什么算取全了」** 的判断全在这里
 *
 * ── 用户 2026-10-02 ──
 * 「不是选择用哪条腿 —— 你要构建**获取完整信息的函数/或者类**。
 * 　底层能够可以做最小化的抽象函数,但**上层只关注某个具体的目标**呀。」
 *
 * ⭐ 所以本文件钉的是**目标与判据**,不是机制:
 * 机制(CDP / 钩子 / 滚动)由 `AcquireDeps` 注入,这里全是假的。
 */

import { describe, it, expect, vi } from 'vitest';
import { acquireContent, STUCK_ROUNDS } from '@platform/main/web-capability/acquire/acquire';
import type { AcquireDeps, AcquiredItem } from '@platform/main/web-capability/acquire/types';
import type { PageId } from '@platform/main/web-capability/page/types';

const PAGE = 'p1' as unknown as PageId;

const item = (url: string, from: AcquiredItem['from'] = 'cdp'): AcquiredItem => ({
  url, method: 'POST', status: 200, text: '{}', byteLength: 2,
  at: new Date().toISOString(), from,
});

/**
 * 造一套假 deps。
 * @param plan 每一轮滚动后**新增**哪些条目(模拟懒加载补货)
 */
function deps(plan: {
  perRound?: AcquiredItem[][];
  initial?: AcquiredItem[];
  cdpAttached?: boolean;
  hookInstalled?: boolean;
  hookInjected?: boolean;
  scrollPx?: number[];
}) {
  const pool: AcquiredItem[] = [...(plan.initial ?? [])];
  let round = 0;
  const calls = { start: 0, stop: 0, reload: 0, scroll: 0 };
  let t = 0;
  const d: AcquireDeps = {
    async startAll() {
      calls.start += 1;
      return {
        cdpAttached: plan.cdpAttached ?? true,
        hookInstalled: plan.hookInstalled ?? true,
      };
    },
    stopAll() { calls.stop += 1; },
    reload() { calls.reload += 1; },
    snapshot() { return [...pool]; },
    legStats() { return { hookInjected: plan.hookInjected ?? true }; },
    async scrollOnce() {
      const got = plan.perRound?.[round] ?? [];
      pool.push(...got);
      const px = plan.scrollPx?.[round] ?? 500;
      round += 1;
      calls.scroll += 1;
      return px;
    },
    async wait(ms) { t += ms; },
    now: () => { t += 1; return t; },
  };
  return { d, calls };
}

describe('⭐⭐ 上层只说目标', () => {
  it('⭐⭐ 一次调用把所有腿装上 + 重载 —— 调用方不必过问', async () => {
    /**
     * ⚠️ 重载是**解竞态**的必要步骤,不是选项:
     * 2026-10-02 实测 capture-start 与 page-created 同一秒,
     * 而 HomeTimeline 早已发完 → 捕到 0 条有用数据。
     */
    const { d, calls } = deps({ perRound: [[item('https://x.com/a')]] });
    await acquireContent(d, PAGE, { maxRounds: 2 });
    expect(calls.start, '没装腿').toBe(1);
    expect(calls.reload, '没重载 —— 会错过首屏那批请求').toBe(1);
    expect(calls.stop, '跑完没停 —— 会一直收').toBe(1);
  });

  it('⭐⭐ 采够了就停 —— **不是**滚满轮数', async () => {
    /**
     * `feedback-pdca-close-the-loop`:「停止由**数据判据**决定,
     * 不由预先猜的次数」—— 轮数当目标填 30 实采 250、填 600 有 43% 空转。
     */
    const { d, calls } = deps({
      perRound: [
        [item('https://x.com/api/1'), item('https://x.com/api/2')],
        [item('https://x.com/api/3')],
        [item('https://x.com/api/4')],
      ],
    });
    const r = await acquireContent(d, PAGE, {
      wantUrlIncludes: ['/api/'], wantAtLeast: 3, maxRounds: 30,
    });
    expect(r.wanted).toBeGreaterThanOrEqual(3);
    expect(calls.scroll, `采够了还在滚(滚了 ${calls.scroll} 轮)`).toBeLessThan(5);
    expect(r.stopReason, '停止原因没说清是采够了').toContain('采够');
    expect(r.ok, '采够了却报不完整').toBe(true);
  });

  it('⭐⭐ 真到底才停 —— 连续无新内容且滚不动', async () => {
    /**
     * ⚠️ 一轮不变就停是血泪:深处的懒加载经常要等几秒,
     * **急着停是漏数据元凶**。
     */
    const { d, calls } = deps({
      perRound: [[item('https://x.com/1')], [], [], []],
      scrollPx: [500, 0, 0, 0],
    });
    const r = await acquireContent(d, PAGE, { maxRounds: 30 });
    expect(r.stopReason, '没说清是到底了').toContain('到底');
    // ⭐ 第 1 轮有内容,之后连续 STUCK_ROUNDS 轮才停
    expect(calls.scroll).toBe(1 + STUCK_ROUNDS);
  });

  it('⚠️⚠️ 中途又有新内容时 **stuck 要清零** —— 别急着停', async () => {
    /**
     * ⚠️⚠️ 注入验证逼出来的改写:我第一版样本是
     * `[[], [], [late], [], [], []]` —— 删掉 `stuck = 0` 后**照样全绿**,
     * 因为 `late` 恰好在「第 3 轮」那一次 `scrollOnce` 里被 push 进去,
     * 而停止判断在它之后。**样本里根本没有「清零救回来」这个现象**
     * (`feedback-check-sample-contains-phenomenon`)。
     *
     * ⭐ 真正能区分的样本:让新内容**早于**阈值出现,
     * 之后再连续空 STUCK_ROUNDS 轮 ——
     * · 清零了 → 跑满「2 空 + 1 有 + 3 空」= 6 轮
     * · 没清零 → 第 3 轮(2 空 + 这一轮)就停,只滚 3 轮
     */
    /**
     * ⚠️ 实测校准过的样本(我前两版都没造出该现象):
     * 空 2 轮 → 第 3 轮来内容 → 再空若干。
     * · 清零了 → stuck 从第 4 轮重新累,**第 6 轮**才停
     * · 没清零 → 前 2 轮已累到 2,第 3 轮虽有内容也不清,
     *   　　　　　第 4 轮累到 3 → **第 4 轮**就停
     * ⭐ 差 2 轮,且那条「迟到的」在没清零时**也采得到**(它在第 3 轮) ——
     * 所以判据只能是**轮数**,不能是「采没采到 late」。
     */
    const plan = {
      perRound: [[], [], [item('https://x.com/late')], [], [], [], [], []],
      scrollPx: [0, 0, 0, 0, 0, 0, 0, 0],
    };
    const { d, calls } = deps(plan);
    const r = await acquireContent(d, PAGE, { maxRounds: 30 });

    expect(r.items.some((x) => x.url.includes('late')), '漏了迟到的内容').toBe(true);
    /**
     * ⭐ 决定性判据:**滚的轮数**必须是「内容那轮 + STUCK_ROUNDS」。
     * ⚠️ 用等号不用 `>`:实测两种实现只差 2 轮,
     * 宽松的 `> STUCK_ROUNDS` 对两者都成立 —— 那正是我上一版假绿的原因。
     */
    expect(calls.scroll, `stuck 没清零 —— 第 ${calls.scroll} 轮就停了`)
      .toBe(3 + STUCK_ROUNDS);
  });

  it('⭐ 轮次是**安全网**不是目标 —— 到底了提前停', async () => {
    const { d, calls } = deps({ perRound: [[]], scrollPx: [0, 0, 0, 0, 0] });
    await acquireContent(d, PAGE, { maxRounds: 50 });
    expect(calls.scroll, '把安全网当成了目标,滚满 50 轮').toBeLessThan(10);
  });

  it('⚠️ 时间安全网也要生效', async () => {
    const { d } = deps({ perRound: Array.from({ length: 99 }, () => [item('https://x.com/x')]) });
    const r = await acquireContent(d, PAGE, { maxRounds: 999, maxMs: 2000 });
    expect(r.stopReason, '时间安全网没生效').toContain('时间');
  });
});

describe('⭐⭐ problems:空才算采全', () => {
  it('⭐⭐ 两条腿都没起来 → 报问题', async () => {
    const { d } = deps({ cdpAttached: false, hookInstalled: false, perRound: [[]] });
    const r = await acquireContent(d, PAGE, { maxRounds: 1 });
    expect(r.ok).toBe(false);
    expect(r.problems.join(''), '没说清是两条腿都没起来').toContain('两条获取腿都没起来');
  });

  it('⭐ 只有一条腿起来 → **不算问题**(降级不是失败)', async () => {
    /** ⚠️ 少一条腿照样能采 —— 这正是多条腿的意义 */
    const { d } = deps({
      hookInstalled: false,
      perRound: [[item('https://x.com/api/1')]],
      scrollPx: [500, 0, 0, 0],
    });
    const r = await acquireContent(d, PAGE, { maxRounds: 10 });
    expect(r.ok, '少一条腿被当成了失败').toBe(true);
  });

  it('⭐⭐ 一条都没采到 → 报问题', async () => {
    const { d } = deps({ perRound: [[], [], [], []], scrollPx: [0, 0, 0, 0] });
    const r = await acquireContent(d, PAGE, { maxRounds: 10 });
    expect(r.ok).toBe(false);
    expect(r.problems.join('')).toContain('一条响应都没有');
  });

  it('⭐⭐ 采到了但**没一条命中目标** → 报问题(这是最误导的一种)', async () => {
    /**
     * ⚠️ 2026-10-02 实测踩到:captured=72 而**一条推文数据都没有**
     * (全是视频分片、心跳、头像)。数字对了不等于采到了要的东西。
     */
    const { d } = deps({
      perRound: [[item('https://video.twimg.com/a.m4s')], [], [], []],
      scrollPx: [500, 0, 0, 0],
    });
    const r = await acquireContent(d, PAGE, {
      wantUrlIncludes: ['/i/api/graphql/'], maxRounds: 10,
    });
    expect(r.ok, '采了一堆无关的却报采全了').toBe(false);
    expect(r.problems.join(''), '没说清是「没命中目标」').toContain('没有一条');
    // ⭐ 但数据照样给 —— 采到的是真的
    expect(r.items.length, '不完整就把数据丢了').toBe(1);
  });

  it('⭐ 不足目标条数 → 报问题,但数据照给', async () => {
    const { d } = deps({
      perRound: [[item('https://x.com/api/1')], [], [], []],
      scrollPx: [500, 0, 0, 0],
    });
    const r = await acquireContent(d, PAGE, {
      wantUrlIncludes: ['/api/'], wantAtLeast: 10, maxRounds: 10,
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join('')).toContain('不足目标');
    expect(r.items.length, '不完整就把数据丢了').toBe(1);
  });

  it('⭐⭐ `ok` 必须由 `problems` 算出,不是独立字段', async () => {
    /** ⚠️ 两者各说各话就是撒谎的入口 */
    const { d } = deps({ perRound: [[item('https://x.com/a')]], scrollPx: [500, 0, 0, 0] });
    const r = await acquireContent(d, PAGE, { maxRounds: 10 });
    expect(r.ok).toBe(r.problems.length === 0);
  });
});

describe('⭐ 报告里的证据', () => {
  it('⭐ 各腿计数如实 —— 它回答「为什么只采到这么点」', async () => {
    const { d } = deps({
      initial: [item('https://x.com/1', 'cdp'), item('https://x.com/2', 'hook'),
        item('https://x.com/3', 'both')],
      perRound: [[]], scrollPx: [0, 0, 0, 0],
      hookInjected: false,
    });
    const r = await acquireContent(d, PAGE, { maxRounds: 10 });
    expect(r.legs.cdp).toBe(1);
    expect(r.legs.hook).toBe(1);
    expect(r.legs.both, 'both 是互证成功的直接证据').toBe(1);
    expect(r.legs.hookInjected, '注入状态没如实回报').toBe(false);
  });

  it('⭐ 滚动像素累计 —— 「看着没动」时的判据', async () => {
    const { d } = deps({ perRound: [[], [], [], []], scrollPx: [300, 400, 0, 0, 0] });
    const r = await acquireContent(d, PAGE, { maxRounds: 10 });
    expect(r.scrolledPx, '没累计滚动量 —— 「没怎么滚」就无从判断').toBeGreaterThan(600);
  });

  it('⚠️ 不给 wantUrlIncludes 时「全都要」', async () => {
    const { d } = deps({
      perRound: [[item('https://any.site/x')], [], [], []],
      scrollPx: [500, 0, 0, 0],
    });
    const r = await acquireContent(d, PAGE, { maxRounds: 10 });
    expect(r.wanted, '没给判据时该全算命中').toBe(1);
    expect(r.ok).toBe(true);
  });
});
