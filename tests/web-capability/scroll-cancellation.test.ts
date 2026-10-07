/**
 * ⭐⭐ 「停」= **停止取数据 + 停止翻页**(用户 2026-10-02 定)
 *
 * ── 用户原话 ──
 * 「还在翻页?停应该包含两个动作 —— **停止翻页/停止取数据**吧?」
 *
 * ⚠️ 真机实测:`capture-stop` 在 06:58:50,而 `scroll-degraded` 在 06:59:08
 * —— **人点停之后滚动又跑了 18 秒**。因为「停」只退了采集订阅,
 * 而滚动循环压根没有可打断的口子:一旦开始滚 30 轮就必须跑完。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ControlEngine } from '@platform/main/web-capability/page/control';
import type { PageId } from '@platform/main/web-capability/page/types';

const PAGE = 'p1' as unknown as PageId;

/**
 * 假宿主 —— 每次 evaluate 都让页面「又往下走了一截」,
 * 这样不取消的话会一直滚到 maxRounds。
 */
function host() {
  let y = 0;
  return {
    evaluate: async (_p: PageId, script: string) => {
      if (script.includes('scrollBy') || script.includes('scrollTo')) y += 500;
      return { y, docHeight: 1_000_000, usedContainer: false };
    },
    navigate: async () => ({ landedUrl: 'about:blank' }),
  };
}

describe('⭐⭐ scrollUntil 可中途取消', () => {
  it('⭐⭐ shouldStop 一返回 true 就停,不跑完 maxRounds', async () => {
    let asked = 0;
    const engine = new ControlEngine(host() as never, { resolve: () => null } as never);
    const r = await engine.scrollUntil(PAGE, { kind: 'atBottom' }, {
      maxRounds: 50,
      settleMs: 0,
      // ⭐ 第 4 次被问时喊停
      shouldStop: () => { asked += 1; return asked > 3; },
    });
    const v = (r as { value: { rounds: number; stopReason: string } }).value;
    expect(v.rounds, `没在取消处停下 —— 跑了 ${v.rounds} 轮`).toBeLessThan(10);
    expect(v.stopReason, '停止原因没说清是人取消的').toContain('人工取消');
  });

  it('⭐⭐ 人工取消**不算 problem**,不降级成 degraded', async () => {
    /**
     * ⚠️ 不排除的话会撞上「要求滚到底但没到底 —— 结果不完整」,
     * 于是**人主动停的**被报成缺陷,整个结果降级。
     * ⭐ 那是错的归类,而且会让真正的「滚不动」被淹在人工取消里。
     */
    const engine = new ControlEngine(host() as never, { resolve: () => null } as never);
    const r = await engine.scrollUntil(PAGE, { kind: 'atBottom' }, {
      maxRounds: 50, settleMs: 0, shouldStop: () => true,
    });
    // ⚠️ 一轮没滚就停 → 「一动没动」那条仍该报(它与取消无关)
    const v = (r as { value: { problems: readonly string[] } }).value;
    const notDone = v.problems.filter((x) => x.includes('结果不完整'));
    expect(notDone, '人工取消被当成了「结果不完整」').toEqual([]);
  });

  it('⭐ 不给 shouldStop 时行为不变(照常跑满)', async () => {
    const engine = new ControlEngine(host() as never, { resolve: () => null } as never);
    const r = await engine.scrollUntil(PAGE, { kind: 'atBottom' }, { maxRounds: 6, settleMs: 0 });
    const v = (r as { value: { rounds: number; stopReason: string } }).value;
    expect(v.rounds, '没给取消口却提前停了').toBe(6);
    expect(v.stopReason).toContain('轮次上限');
  });

  it('⭐ 取消时**已滚的进度照常回报** —— 不丢', async () => {
    let asked = 0;
    const engine = new ControlEngine(host() as never, { resolve: () => null } as never);
    const r = await engine.scrollUntil(PAGE, { kind: 'atBottom' }, {
      maxRounds: 50, settleMs: 0,
      shouldStop: () => { asked += 1; return asked > 4; },
    });
    const v = (r as { value: { scrolledPx: number; trace: readonly unknown[] } }).value;
    expect(v.scrolledPx, '取消后把已滚的进度丢了').toBeGreaterThan(0);
    expect(v.trace.length, '每轮痕迹没留').toBeGreaterThan(0);
  });
});

describe('⭐⭐ 接线:「停」必须停两件事', () => {
  const ipc = readFileSync(
    resolve(__dirname, '../../src/platform/main/web-capability/wiring/ipc-dom.ts'), 'utf-8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('⭐⭐ captureStop 同时请求停翻页', () => {
    const i = ipc.indexOf("case 'captureStop'");
    expect(i, 'captureStop 分支不见了').toBeGreaterThan(-1);
    const branch = ipc.slice(i, ipc.indexOf("case 'scrollStop'", i));
    expect(branch.length, '切片是空的 —— 断言会恒真').toBeGreaterThan(60);
    expect(branch, '「停」只停了取数,没停翻页 —— 实测人点停后滚动又跑了 18 秒')
      .toMatch(/scrollCancelled\.add/);
    expect(branch, '「停」没停采集').toMatch(/\.stop\s*\(\s*\)/);
  });

  it('⭐⭐ scrollUntil 必须把取消口传下去', () => {
    const i = ipc.indexOf("case 'scrollUntil'");
    const branch = ipc.slice(i, ipc.indexOf('return toIpc(r);', i));
    expect(branch.length, '切片是空的').toBeGreaterThan(60);
    expect(branch, 'scrollUntil 没传 shouldStop —— 停不下来').toMatch(/shouldStop:/);

    /**
     * ⚠️⚠️ **必须切到 `controlEngine.scrollUntil(` 调用之前** ——
     * 注入验证抓到:整个 branch 里有**两处** `scrollCancelled.delete`
     * (开跑前清一次、跑完清一次),删掉开跑前那处时,
     * 跑完那处把断言兜住了 → **全绿**。
     * 正是 `feedback-guard-scope-to-the-branch`:同一 token 在切片里出现多次。
     * ⭐ 开跑前那次才是防「上次点过停,这次一轮不滚就结束」的那一道。
     */
    const callAt = branch.indexOf('controlEngine.scrollUntil');
    expect(callAt, 'scrollUntil 调用不见了').toBeGreaterThan(-1);
    const before = branch.slice(0, callAt);
    expect(before.length, '切出来的前置段是空的 —— 断言会恒真').toBeGreaterThan(20);
    expect(before, '开跑前没清旧标记 —— 上次点过停,这次会一轮不滚就结束')
      .toMatch(/scrollCancelled\.delete/);
  });

  it('⭐⭐ 另有独立的 scrollStop —— 人「只滚不捕」时也要能停', () => {
    /**
     * ⚠️ 输出 tab 的「停」要求 running;人只滚不捕时那个按钮是灰的,
     * 翻页就停不下来 —— 两个动作各有入口才完整(用户原话的落点)。
     */
    expect(ipc, '没有独立的 scrollStop op').toMatch(/case 'scrollStop'/);
  });

  it('⭐ 取消标记必须按 pageId 分', () => {
    /** ⚠️ 不分的话在 A 窗口点停会把 B 窗口的滚动也停掉 */
    expect(ipc, '取消标记不是按 pageId 分的')
      .toMatch(/scrollCancelled\s*=\s*new Set<\s*PageId\s*>/);
  });
});

describe('⭐⭐ 面板:「停翻页」要点得到', () => {
  const panel = readFileSync(
    resolve(__dirname, '../../src/modules/x/XConsole.tsx'), 'utf-8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('⭐⭐ 「停」类按钮不许被 busy 挡住', () => {
    /**
     * ⚠️⚠️ 用户 2026-10-02:「点击停它不停的呀?看到 button 没有反应?」
     * 真因:`disabled` 含 `busy`,而 scrollUntil 跑 30 轮要 20 多秒,
     * **期间所有按钮都是灰的** —— 包括「停」。
     * ⭐ 「停」是取消动作,恰恰该在忙的时候可用。
     */
    /**
     * ⚠️ 2026-10-02 更新:`captureStop` 已被 `acquire` 收编
     * (用户:「不是选择用哪条腿…上层只关注某个具体的目标」),
     * 面板上现在只剩 `scrollStop` 这一个显式的「停」。
     * ⭐ 钉的仍是同一条行为:**取消动作不许被 busy 挡住**。
     */
    for (const op of ['scrollStop']) {
      const i = panel.indexOf(op);
      expect(i, `${op} 的按钮不见了`).toBeGreaterThan(-1);
      // 往回找这个按钮的 disabled
      const head = panel.lastIndexOf('<button', i);
      expect(head, `${op} 找不到所属按钮`).toBeGreaterThan(-1);
      const btn = panel.slice(head, i);
      expect(btn, `${op} 的按钮被 busy 挡住了 —— 忙的时候就点不动`)
        .not.toMatch(/disabled=\{[^}]*\bdisabled\b/);
    }
  });

  it('⭐ 控制 tab 有独立的「停翻页」', () => {
    expect(panel, '只滚不捕时翻页停不下来').toMatch(/op: 'scrollStop'/);
  });
});

/**
 * ⭐⭐⭐ `afterRound` —— **采集自己该做的事,不该是人点的按钮**
 *
 * ── 用户 2026-10-02 ──
 * 「应该是**内部的控制机制**,而不是通过一个 button 来点击去做的呀。」
 *
 * ⭐ 起因:X 的折叠推文要点「Show more」才有全文,
 * 我原来做成了面板按钮 —— 要人记得点、还要记得顺序,
 * 而且**结果压根没接进采集**(只进了一个显示用的计数)。
 */
describe('⭐⭐ 每轮滚完给业务一个时机', () => {
  it('⭐⭐ 每一轮都调一次,轮次号对得上', async () => {
    const engine = new ControlEngine(host() as never, { resolve: () => null } as never);
    const rounds: number[] = [];
    await engine.scrollUntil(PAGE, { kind: 'rounds', n: 3 }, {
      maxRounds: 3, settleMs: 0,
      afterRound: (n) => { rounds.push(n); },
    });
    expect(rounds, '不是每轮都调').toEqual([1, 2, 3]);
  });

  it('⭐⭐⭐ 业务的脚本抛异常**不中断滚动**', async () => {
    /**
     * ⚠️ 业务的事做砸了不该让整轮采集作废 ——
     * 而且症状会变成「滚了两轮就停」,**离真因很远**。
     */
    const engine = new ControlEngine(host() as never, { resolve: () => null } as never);
    const r = await engine.scrollUntil(PAGE, { kind: 'rounds', n: 4 }, {
      maxRounds: 4, settleMs: 0,
      afterRound: () => { throw new Error('业务脚本炸了'); },
    });
    const v = (r as { value: { rounds: number } }).value;
    expect(v.rounds, `业务抛异常把滚动中断了(只滚了 ${v.rounds} 轮)`).toBe(4);
  });

  it('⭐ 不给 afterRound 时行为不变', async () => {
    const engine = new ControlEngine(host() as never, { resolve: () => null } as never);
    const r = await engine.scrollUntil(PAGE, { kind: 'rounds', n: 2 }, { maxRounds: 2, settleMs: 0 });
    expect((r as { value: { rounds: number } }).value.rounds).toBe(2);
  });

  it('⭐⭐ 接线:IPC 只收**预注册的脚本 id**,收不了脚本文本', () => {
    /**
     * ⚠️ 那道闸是 `project-x-inject-template-escape` 换来的:
     * 拼串时 `\/` 被模板字面量吃掉 → 浏览器收到非法正则 →
     * **采集恒 0 而 tsc/单测全绿**。
     */
    const types = readFileSync(
      resolve(__dirname, '../../src/shared/ipc/web-dom-types.ts'), 'utf-8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(types, 'afterRound 的参数不是脚本 id').toMatch(/afterRoundScriptId\?:\s*string/);
    expect(types, '开了「收脚本文本」的口子 —— 那道闸不能破')
      .not.toMatch(/afterRoundScript\?:\s*string/);
  });

  it('⭐⭐ 面板上**不该有**「展开全部」按钮', () => {
    /**
     * ⭐ 用户点破的就是这个:它要人记得点、还要记得顺序。
     * ⚠️ 判据钉「按钮没了」+「滚动时自动带上脚本」两条 ——
     * 只钉前者会被一个「两边都没有」的实现满足(那就彻底不展开了)。
     */
    const panel = readFileSync(
      resolve(__dirname, '../../src/modules/x/XConsole.tsx'), 'utf-8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    expect(panel, '「展开全部」按钮还在 —— 它该是内部机制').not.toContain('展开全部');
    expect(panel, '滚动时没自动展开 —— 那就彻底不展开了')
      .toMatch(/afterRoundScriptId:\s*X_SCRIPTS\.expandAll/);
  });
});
