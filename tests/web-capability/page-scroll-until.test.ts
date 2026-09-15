/**
 * ⭐⭐ `scrollUntil` —— 控制层最大的新增(`01-contract.md` §9.5)
 *
 * ── 实测代价(不是假设)──
 * `x-timeline-harvester.ts` 文件头:「滚动逻辑此前散在三个文件里,同样的 bug 要修三遍,
 * 而且**每次都以为修好了**。实测代价:用户拿官网点击数据一核对 ——
 * **10 天 433 条回复,库里只有 81 条(19%)**」。
 * (总指挥重数:现在是 **7 个**文件有滚动逻辑。)
 *
 * ⭐ 本文件的组织方式:**四条血泪各一组**,每组都必须能被对应的注入打红。
 * 每条断言先问一句:**「如果被测逻辑是错的,这条断言还会成立吗?」**
 */
import { describe, it, expect } from 'vitest';
import { ControlEngine, DEFAULT_STUCK_ROUNDS } from '@platform/main/web-capability/page/control';
import { isDegraded, isFailed, isOk } from '@platform/main/web-capability';
import { FakeScrollPage, MapAnchors, MapScripts, PAGE } from './helpers/fake-scroll-page';
import type { ScrollReport } from '@platform/main/web-capability/page/control-types';

const ANCHORS = { endMarker: '#end', ghost: '#nope' };
const SCRIPTS = { seenEnough: 'x.seen-enough' };

function engineFor(page: FakeScrollPage, scripts: Record<string, string> = {}) {
  return new ControlEngine(page, new MapAnchors(ANCHORS), new MapScripts(scripts));
}

/** 取报告 —— Ok 与 Degraded 都带 value(校验没过是 Degraded,不是 Failed) */
function reportOf(r: unknown): ScrollReport {
  const res = r as { status: string; value?: ScrollReport };
  if (res.status === 'failed') throw new Error(`期望有报告,实际 Failed: ${JSON.stringify(r)}`);
  return res.value!;
}

describe('⭐⭐ 血泪① —— 必须同步 scrollBy,滚动之后才回读', () => {
  it('⭐⭐ 一轮滚动后回读到的是**滚动后**的位置,不是滚动前', () => {
    // `behavior:'smooth'` 是异步的:调用立刻返回、滚动尚未发生,
    // 之后读 scrollY 读到的是**滚动前**的值 —— 等于没测量。
    // 假页面把 smooth 模拟成「下一轮才生效」,所以用了 smooth 的实现在这里必然露馅。
    const page = new FakeScrollPage({ docHeight: 100_000 });
    const engine = engineFor(page);
    return engine.scrollUntil(PAGE, { kind: 'rounds', n: 1 }).then((r) => {
      const rep = reportOf(r);
      // 第一轮的 trace 里记的位置必须 > 0 —— 用 smooth 的话这里是 0(滚动还没发生)
      expect(rep.trace[0].scrollY).toBeGreaterThan(0);
      // 且与页面**真实**位置一致(不是引擎自己算的估计值)
      expect(rep.trace[0].scrollY).toBe(page.scrollY);
      expect(rep.scrolledPx).toBeGreaterThan(0);
    });
  });

  it('⭐ 脚本里零处 behavior:smooth(源码层面钉死)', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const code = fs
      .readFileSync('src/platform/main/web-capability/page/scroll-scripts.ts', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code, 'smooth 是异步的,会让紧接着的回读全是旧值').not.toMatch(/behavior/);
  });

  it('守卫自检:注释里确实讨论了 smooth(否则上面那条是空转的)', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const raw = fs.readFileSync('src/platform/main/web-capability/page/scroll-scripts.ts', 'utf-8');
    expect(raw).toMatch(/smooth/);
  });

  it('多轮滚动位置单调增长(每轮都真的动了)', async () => {
    const page = new FakeScrollPage({ docHeight: 100_000 });
    const r = await engineFor(page).scrollUntil(PAGE, { kind: 'rounds', n: 5 });
    const rep = reportOf(r);
    const ys = rep.trace.map((t) => t.scrollY);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i], `第 ${i + 1} 轮没有前进(${ys[i - 1]} → ${ys[i]})`).toBeGreaterThan(ys[i - 1]);
    }
  });
});

describe('⭐⭐ 血泪② —— 不许用 DOM 条数判进度 / 判停(虚拟列表)', () => {
  it('⭐⭐ DOM 条数**不涨反降**时,滚动照常继续(不误判到底)', async () => {
    // X 用虚拟列表:滚过去的元素被从 DOM 删除,实测出现过 +0 / −1。
    // 若谁拿「当前 DOM 条数」当进度,这里会立刻判「没有新数据 → 到底了」。
    const page = new FakeScrollPage({ docHeight: 100_000 });
    page.onScroll = (p) => { p.domItemCount = Math.max(0, p.domItemCount - 1); };
    // 手动驱动:每轮后削减条数
    const engine = engineFor(page);
    const origEval = page.evaluate.bind(page);
    page.evaluate = async (id, s) => {
      const out = await origEval(id, s);
      if (s.includes('scrollBy')) page.domItemCount = Math.max(0, page.domItemCount - 1);
      return out;
    };
    const r = await engine.scrollUntil(PAGE, { kind: 'rounds', n: 8 });
    const rep = reportOf(r);
    // ⭐ 条数一路降到 12,但滚动跑满了 8 轮 —— 没被「没有新数据」骗停
    expect(page.domItemCount).toBe(12);
    expect(rep.rounds).toBe(8);
    expect(rep.scrolledPx).toBeGreaterThan(0);
  });

  it('⭐ 引擎与脚本零处元素计数(源码层面钉死)', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const offenders: string[] = [];
    for (const f of ['control.ts', 'scroll-scripts.ts', 'control-types.ts']) {
      const code = fs
        .readFileSync(`src/platform/main/web-capability/page/${f}`, 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      // 「数元素」的特征:querySelectorAll(...).length / 一个叫 count/items/articles 的字段
      if (/querySelectorAll\([^)]*\)\s*\.\s*length/.test(code)) offenders.push(`${f}: 数了元素`);
      if (/\b(domArticles|itemCount|domItems|articles)\b/.test(code)) offenders.push(`${f}: 有条数字段`);
    }
    expect(offenders, 'DOM 条数不是进度(虚拟列表会让它不涨反降)').toEqual([]);
  });

  it('⭐ RoundTrace 里根本没有条数字段(类型层面就表达不了)', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const code = fs.readFileSync('src/platform/main/web-capability/page/control-types.ts', 'utf-8');
    const block = code.slice(code.indexOf('export type RoundTrace'), code.indexOf('export type ScrollReport'));
    expect(block.length).toBeGreaterThan(0);
    expect(block, 'trace 只记位置与耗时,不记条数').not.toMatch(/count|articles|items/i);
  });
});

describe('⭐⭐ 血泪③ —— 只有 scrollY 连续多轮不变才算真到底', () => {
  it('⭐⭐ 一轮不变**不算**到底(默认要连续 3 轮)', async () => {
    // 「没有新数据」≠「到底了」:时间线夹着别人的内容很正常,急着停是漏数据元凶。
    // 这里造一个「中间卡一轮又能继续滚」的页面 —— 一轮就停的实现会在此提前截断。
    const page = new FakeScrollPage({ docHeight: 100_000 });
    let round = 0;
    const origEval = page.evaluate.bind(page);
    page.evaluate = async (id, s) => {
      if (s.includes('scrollBy')) {
        round += 1;
        // 第 2 轮「卡住」(懒加载还没补货),第 3 轮恢复
        if (round === 2) {
          return { y: page.scrollY, docHeight: page.docHeight, usedContainer: false };
        }
      }
      return origEval(id, s);
    };
    const r = await engineFor(page).scrollUntil(PAGE, { kind: 'atBottom' }, { maxRounds: 6 });
    const rep = reportOf(r);
    // ⭐ 卡了一轮但**没有**就此收工 —— 跑满了 6 轮
    expect(rep.rounds).toBe(6);
    expect(rep.reachedBottom, '只卡一轮不该判到底').toBe(false);
    // 自检:第 2 轮的 stuck 确实是 1(场景真的造出来了,不是空转)
    expect(rep.trace[1].stuck).toBe(1);
    expect(rep.trace[2].stuck, '第 3 轮恢复滚动,stuck 应清零').toBe(0);
  });

  it('⭐⭐ 连续 3 轮不变才判到底,stopReason 如实', async () => {
    // 到底的页面:docHeight 很小,滚两下就到头
    const page = new FakeScrollPage({ docHeight: 1200, innerHeight: 800 });
    const r = await engineFor(page).scrollUntil(PAGE, { kind: 'atBottom' }, { maxRounds: 20 });
    const rep = reportOf(r);
    expect(rep.reachedBottom).toBe(true);
    expect(rep.stopReason).toContain('滚到底');
    expect(rep.stopReason).toContain('连续');
    // ⭐ 最后一轮的 stuck 必须真的达到阈值(不是「差不多就停了」)
    expect(rep.trace[rep.trace.length - 1].stuck).toBeGreaterThanOrEqual(DEFAULT_STUCK_ROUNDS);
  });

  it('⭐ 默认 stuckRounds 是 3(不是 1)', () => {
    expect(DEFAULT_STUCK_ROUNDS).toBeGreaterThanOrEqual(3);
  });

  it('stuckRounds 可配,调大后要等更久才判到底', async () => {
    const mk = () => new FakeScrollPage({ docHeight: 1200, innerHeight: 800 });
    const a = mk(); const b = mk();
    const ra = reportOf(await engineFor(a).scrollUntil(PAGE, { kind: 'atBottom' }, { maxRounds: 30, stuckRounds: 3 }));
    const rb = reportOf(await engineFor(b).scrollUntil(PAGE, { kind: 'atBottom' }, { maxRounds: 30, stuckRounds: 8 }));
    expect(rb.rounds).toBeGreaterThan(ra.rounds);
    expect(rb.reachedBottom).toBe(true);
  });

  it('stuckRounds < 1 直接 Failed(0 会让第一轮就判到底)', async () => {
    const page = new FakeScrollPage();
    const r = await engineFor(page).scrollUntil(PAGE, { kind: 'atBottom' }, { stuckRounds: 0 });
    expect(isFailed(r)).toBe(true);
  });
});

describe('⭐⭐ 血泪④ —— 日期绝不做停止判据', () => {
  it('⭐⭐ ScrollStop 里根本没有日期判据(类型层面表达不了)', () => {
    // 「见过的最旧一条」≠ 覆盖深度:站点把置顶/热门旧内容排前面,
    // 一条 3 月的推就让判据误以为覆盖 166 天。
    const fs = require('node:fs') as typeof import('node:fs');
    const code = fs.readFileSync('src/platform/main/web-capability/page/control-types.ts', 'utf-8');
    const block = code.slice(code.indexOf('export type ScrollStop'), code.indexOf('export type ScrollOptions'));
    expect(block.length).toBeGreaterThan(0);
    for (const banned of [/oldest/i, /\bdate\b/i, /createdAt/i, /sinceDays/i, /\bage\b/i]) {
      expect(block, `停止判据里出现了日期(${banned})—— 血泪④`).not.toMatch(banned);
    }
    // 自检:这个 block 里确实有别的判据(不是切了个空串)
    expect(block).toContain('atBottom');
    expect(block).toContain('anchorAppears');
  });

  it('⭐ 引擎实现里零处日期比较', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const code = fs
      .readFileSync('src/platform/main/web-capability/page/control.ts', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    for (const banned of [/new Date\(/, /getTime\(\)/, /createdAt/, /oldest/i]) {
      expect(code, `引擎里出现日期逻辑(${banned})—— 日期只做显示`).not.toMatch(banned);
    }
  });
});

describe('⭐ 主文档滚不动 → 找内部滚动容器', () => {
  it('⭐ 主文档不可滚时,内部容器被滚动且位置如实回读', async () => {
    const page = new FakeScrollPage({
      mainUnscrollable: true,
      containerScrollHeight: 50_000,
      containerClientHeight: 800,
    });
    const r = await engineFor(page).scrollUntil(PAGE, { kind: 'rounds', n: 3 });
    const rep = reportOf(r);
    expect(page.scrollY, '主文档确实没动').toBe(0);
    expect(page.containerTop, '内部容器真的被滚了').toBeGreaterThan(0);
    // ⭐ 报告要如实说走的是容器 —— 排查「怎么滚不动」的第一条线索
    expect(rep.trace[0].usedContainer).toBe(true);
    expect(rep.scrolledPx).toBeGreaterThan(0);
  });

  it('⭐ 只挑「真的能滚」的容器(scrollHeight > clientHeight + 400)', async () => {
    // 假页面的 querySelectorAll('div') 先返回一个「不够格」的容器(900 vs 800),
    // 再返回够格的。若判据被放宽成 `>`,就会挑中那个不够格的、滚不动。
    const page = new FakeScrollPage({
      mainUnscrollable: true,
      containerScrollHeight: 50_000,
      containerClientHeight: 800,
    });
    const r = await engineFor(page).scrollUntil(PAGE, { kind: 'rounds', n: 2 });
    reportOf(r);
    expect(page.containerTop, '挑错容器就滚不动了').toBeGreaterThan(0);
  });

  it('主文档能滚时不去碰容器', async () => {
    const page = new FakeScrollPage({ docHeight: 100_000 });
    const r = await engineFor(page).scrollUntil(PAGE, { kind: 'rounds', n: 2 });
    expect(reportOf(r).trace[0].usedContainer).toBe(false);
    expect(page.containerTop).toBe(0);
  });
});

describe('⭐ A 层自校验 —— 滚动没发生要如实标红,不许静默', () => {
  it('⭐⭐ 完全滚不动 → problems 非空且 ok:false', async () => {
    // 既滚不了主文档也没有可滚容器 —— 真实形态是「页面还没加载完 / 选错了页面」
    const page = new FakeScrollPage({
      mainUnscrollable: true,
      containerScrollHeight: 800,
      containerClientHeight: 800,
    });
    const r = await engineFor(page).scrollUntil(PAGE, { kind: 'atBottom' }, { maxRounds: 5 });
    const rep = reportOf(r);
    expect(rep.ok).toBe(false);
    expect(rep.problems.length).toBeGreaterThan(0);
    expect(rep.problems.join()).toContain('滚动没生效');
    // ⭐ 且返回的是 Degraded 不是 Ok —— 当 Ok 就是「滚了个寂寞却报成功」
    expect(isDegraded(r)).toBe(true);
    expect(isOk(r)).toBe(false);
  });

  it('⭐ 起点不为 0 但一动没动,同样标红(不是只查 scrollY>0)', async () => {
    // 现有实现只查 `maxY <= 0`,漏掉这种:页面已在半途,之后一动没动 ——
    // maxY 很大,校验却该红
    const page = new FakeScrollPage({
      mainUnscrollable: true,
      containerScrollHeight: 800,
      containerClientHeight: 800,
    });
    page.scrollY = 5000; // 起点就在半途(但滚不动)
    const r = await engineFor(page).scrollUntil(PAGE, { kind: 'atBottom' }, { maxRounds: 5 });
    const rep = reportOf(r);
    expect(rep.scrolledPx).toBe(0);
    expect(rep.ok, 'maxY 很大,但一动没动 —— 仍该标红').toBe(false);
    expect(rep.problems.join()).toContain('从未向下移动');
  });

  it('⭐ ok 恒等于 problems 为空(两者不许各说各话)', async () => {
    for (const docHeight of [1200, 100_000]) {
      const page = new FakeScrollPage({ docHeight });
      const r = await engineFor(page).scrollUntil(PAGE, { kind: 'atBottom' }, { maxRounds: 20 });
      const rep = reportOf(r);
      expect(rep.ok).toBe(rep.problems.length === 0);
    }
  });

  it('⭐ 要求滚到底却没到底 → 标红(结果不完整)', async () => {
    const page = new FakeScrollPage({ docHeight: 1_000_000 });
    const r = await engineFor(page).scrollUntil(PAGE, { kind: 'atBottom' }, { maxRounds: 3 });
    const rep = reportOf(r);
    expect(rep.reachedBottom).toBe(false);
    expect(rep.ok).toBe(false);
    expect(rep.problems.join()).toContain('仍未到底');
  });

  it('正常滚到底 → problems 为空、ok:true、返回 Ok', async () => {
    // ⚠️ 反向锁:若校验退化成「永远标红」,上面几条也会绿 —— 那是另一种假保证
    const page = new FakeScrollPage({ docHeight: 1200, innerHeight: 800 });
    const r = await engineFor(page).scrollUntil(PAGE, { kind: 'atBottom' }, { maxRounds: 20 });
    const rep = reportOf(r);
    expect(rep.problems).toEqual([]);
    expect(rep.ok).toBe(true);
    expect(isOk(r)).toBe(true);
  });
});

describe('⭐ stopReason 如实反映停在哪', () => {
  it('到底 / 轮次上限 / 指定轮次 / 锚点出现 / 自定义 —— 五种各不相同', async () => {
    const seen = new Set<string>();

    // 到底
    const bottom = reportOf(await engineFor(new FakeScrollPage({ docHeight: 1200 }))
      .scrollUntil(PAGE, { kind: 'atBottom' }, { maxRounds: 20 }));
    expect(bottom.stopReason).toContain('滚到底');
    seen.add(bottom.stopReason);

    // 轮次上限(要求到底但没到)
    const capped = reportOf(await engineFor(new FakeScrollPage({ docHeight: 1_000_000 }))
      .scrollUntil(PAGE, { kind: 'atBottom' }, { maxRounds: 2 }));
    expect(capped.stopReason).toContain('轮次上限');
    seen.add(capped.stopReason);

    // 指定轮次
    const rounds = reportOf(await engineFor(new FakeScrollPage({ docHeight: 1_000_000 }))
      .scrollUntil(PAGE, { kind: 'rounds', n: 3 }));
    expect(rounds.stopReason).toContain('指定轮次');
    seen.add(rounds.stopReason);

    // 锚点出现(第 2 轮后锚点才出现)
    const page = new FakeScrollPage({ docHeight: 1_000_000 });
    let n = 0;
    const orig = page.evaluate.bind(page);
    page.evaluate = async (id, s) => {
      if (s.includes('scrollBy')) { n += 1; if (n >= 2) page.present.add('#end'); }
      return orig(id, s);
    };
    const anchored = reportOf(await engineFor(page)
      .scrollUntil(PAGE, { kind: 'anchorAppears', anchor: 'endMarker' }, { maxRounds: 10 }));
    expect(anchored.stopReason).toContain('停止判据满足');
    expect(anchored.rounds).toBe(2);
    expect(anchored.ok, '锚点如期出现 → 无 problems').toBe(true);
    seen.add(anchored.stopReason);

    // 五种理由互不相同 —— 「一律返回同一句话」就没有诊断价值
    expect(seen.size).toBe(4);
  });

  it('⭐ custom 停止判据走预注册脚本(不收脚本字符串)', async () => {
    const page = new FakeScrollPage({ docHeight: 1_000_000 });
    let n = 0;
    const orig = page.evaluate.bind(page);
    page.evaluate = async (id, s) => {
      if (s.includes('scrollBy')) n += 1;
      if (s.includes('SEEN_ENOUGH')) return n >= 3;
      return orig(id, s);
    };
    const engine = engineFor(page, { [SCRIPTS.seenEnough]: '(function(){ return SEEN_ENOUGH; })()' });
    const rep = reportOf(await engine.scrollUntil(
      PAGE, { kind: 'custom', script: SCRIPTS.seenEnough as never }, { maxRounds: 10 },
    ));
    expect(rep.rounds).toBe(3);
    expect(rep.stopReason).toContain('停止判据满足');
  });

  it('custom 脚本没注册 → Failed(不静默当成不满足)', async () => {
    const page = new FakeScrollPage({ docHeight: 1_000_000 });
    const r = await engineFor(page).scrollUntil(
      PAGE, { kind: 'custom', script: 'x.not-registered' as never }, { maxRounds: 3 },
    );
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toContain('未注册');
  });
});

describe('⭐ 三态契约与 fail loud', () => {
  it('滚动脚本抛错 → Failed,**不当成「滚不动」**', async () => {
    // 页面没了 / 注入被拒 ≠ 到底了。当成到底会把失败伪装成成功
    const page = new FakeScrollPage({ docHeight: 100_000 });
    page.evaluateThrows = '页面已销毁';
    page.throwTimes = Infinity;
    const r = await engineFor(page).scrollUntil(PAGE, { kind: 'atBottom' });
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toContain('页面已销毁');
    expect(r.retryable).toBe(true);
  });

  it('⭐ 回读结果不合法 → Failed(不填默认值 0)', async () => {
    // y 取不到时填 0 会让「回读失败」表现为「滚回顶部了」,stuck 计数全乱
    const page = new FakeScrollPage({ docHeight: 100_000 });
    const orig = page.evaluate.bind(page);
    page.evaluate = async (id, s) => (s.includes('scrollBy') ? { docHeight: 1 } : orig(id, s));
    const r = await engineFor(page).scrollUntil(PAGE, { kind: 'atBottom' });
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toContain('不合法');
  });

  it('⭐ 锚点没登记 → Failed,且与「元素不在页面」可区分', async () => {
    const page = new FakeScrollPage({ docHeight: 1200 });
    const r = await engineFor(page).scrollUntil(PAGE, { kind: 'anchorAppears', anchor: 'noSuchAnchor' });
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toContain('无法解释成 selector');
    expect(r.retryable, '锚点没登记要改锚点表,重试没意义').toBe(false);
  });

  it('⭐ rounds 判据超过 maxRounds → Failed(不静默截断)', async () => {
    // 静默截断 = 「我要 100 轮,它给了我 50 轮还说成功了」
    const page = new FakeScrollPage({ docHeight: 1_000_000 });
    const r = await engineFor(page).scrollUntil(PAGE, { kind: 'rounds', n: 100 }, { maxRounds: 50 });
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toContain('静默截断');
  });

  it('⭐⭐ 停止判据探针抛错 → Failed(不当成「判据不满足」)', async () => {
    // 探针一直炸却被吞掉 = 白滚满 maxRounds 还报「未滚到底」,原因指错方向。
    //
    // ⚠️ 这条是注入实验补的:第一版写成「脚本里含 querySelector 就抛」,
    //    但**滚动脚本本身也含 querySelectorAll**(找内部容器要用),
    //    于是它在滚动那一步就炸了,**根本没走到探针**。
    //    注入「吞掉探针异常」时零红 —— 断言成立的原因不是被测逻辑。
    //    改成只对**探针脚本**抛(滚动脚本放行),场景才真的造出来。
    const page = new FakeScrollPage({ docHeight: 1_000_000 });
    const orig = page.evaluate.bind(page);
    let scrolled = 0;
    page.evaluate = async (id, s) => {
      if (s.includes('scrollBy')) { scrolled += 1; return orig(id, s); }
      // ⚠️ 只对**锚点探针**抛。滚动脚本和初始位置回读脚本里也有 querySelectorAll
      //    (要找内部滚动容器),按 'querySelector' 一刀切会在它们身上先炸掉,
      //    于是根本走不到探针 —— 那正是第一版零红的原因。
      if (s.includes('#end')) throw new Error('探针炸了');
      return orig(id, s);
    };
    const r = await engineFor(page).scrollUntil(
      PAGE, { kind: 'anchorAppears', anchor: 'endMarker' }, { maxRounds: 5 },
    );
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toContain('探针炸了');
    // ⭐ 自检:滚动确实成功跑过(证明失败发生在**探针**而不是滚动那一步),
    //    且**第一轮就失败**,不是白滚满 5 轮
    expect(scrolled).toBe(1);
    expect(r.reason).toContain('第 1 轮');
  });
});

describe('⭐ 只管滚,不管抓(与捕获解耦)', () => {
  it('⭐ scrollUntil **本身**零处「捕获 / 导航」的痕迹', () => {
    /**
     * 现有 `harvestTimeline` 把 `loadURL + 滚动 + 捕获 + 判停` 缝死在一个函数,
     * 结果「只滚不抓」「抓但不导航」「换判停规则」全做不到。
     *
     * ⚠️ **收窄到 `scrollUntil` 的函数体**(2026-09-15,`goto` 落地时改)。
     * 初版扫整个 `control.ts` —— 而 `goto` 按契约 §9.3 就该在这一层
     * (用户 2026-09-15 拍板放进 `ControlEngine`),它的**错误信息里**
     * 出现 `loadURL` 这个词就会把守卫打红。
     *
     * ⭐ 守卫真正保护的是「**滚动**这一步不缝死导航/捕获」,
     * 不是「这个文件里不许出现这几个词」。契约要的是
     * `goto → scrollUntil → capture` **各自独立**,而它们同在一个类里
     * 且互不调用,正是「独立」。故按函数体守。
     */
    const fs = require('node:fs') as typeof import('node:fs');
    const code = fs
      .readFileSync('src/platform/main/web-capability/page/control.ts', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    const start = code.indexOf('async scrollUntil(');
    expect(start, '锚点过时:找不到 scrollUntil').toBeGreaterThan(0);
    // 取到下一个方法定义之前(scrollUntil 之后是 private 助手)
    const after = code.slice(start + 10);
    const end = after.search(/\n  (?:private|async|public)\s/);
    const body = end > 0 ? after.slice(0, end) : after;
    expect(body.length, 'scrollUntil 函数体切空了').toBeGreaterThan(300);

    /**
     * ⚠️ `navigate` 的禁词写成 `/navigate\(/` **拦不住 `navigate?.(`** ——
     * 可选链的 `?.` 卡在名字与括号之间。注入验证当场抓到(2026-09-15):
     * 往 `scrollUntil` 里塞 `this.host.navigate?.(...)`,33 条守卫**全绿**。
     * ⭐ 第五次同款:**禁词要匹配违规真实的书写形态**,不是我以为的那种。
     */
    for (const banned of [
      /loadURL/, /navigate\s*\??\.?\s*\(/, /debugger/, /Network\.enable/, /tweet/i, /payload/i,
    ]) {
      expect(body, `滚动那一步混进了捕获/导航(${banned})`).not.toMatch(banned);
    }
  });

  it('⭐⭐ goto 与 scrollUntil **互不调用**(同一个类,但各自独立)', () => {
    // 契约 §9.5:「拆开后 goto → scrollUntil → capture 各自独立,业务自由编排」
    const fs = require('node:fs') as typeof import('node:fs');
    const code = fs
      .readFileSync('src/platform/main/web-capability/page/control.ts', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    const gotoStart = code.indexOf('async goto(');
    const gotoEnd = code.indexOf('private async currentUrl(');
    expect(gotoStart, '锚点过时:找不到 goto').toBeGreaterThan(0);
    expect(gotoEnd).toBeGreaterThan(gotoStart);
    const gotoBody = code.slice(gotoStart, gotoEnd);

    expect(gotoBody, 'goto 里调了 scrollUntil —— 又缝死了').not.toMatch(/scrollUntil\(/);
    // ⭐ goto 只允许调 ready(导航后等到位),那是编排里明确的一步
    expect(gotoBody, 'goto 没调 ready —— 导航后不等到位就往下走').toMatch(/this\.ready\(/);
  });

  it('ScrollReport 里没有任何「抓到什么」的字段', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const code = fs.readFileSync('src/platform/main/web-capability/page/control-types.ts', 'utf-8');
    const block = code.slice(code.indexOf('export type ScrollReport'));
    expect(block).toContain('scrolledPx');
    expect(block, '本层只滚不抓').not.toMatch(/captured|tweets|payloads|records/i);
  });
});
