import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 去注释 —— 注释里的字样会把守卫兜住(本仓「假绿」栽过五次) */
function strip(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, '$1');
  if (noLine.includes('/*') || /(^|[^:])\/\//m.test(noLine)) {
    throw new Error('strip 自检失败:还有注释残留');
  }
  return noLine;
}

/**
 * ⭐⭐ 采推也要对账 —— 「该采的都采到了吗」。
 *
 * ── 这个缺口是怎么来的 ──
 *
 * 对账段的门槛写的是 `r.people.length > 0`,而**采推那跑 people 恒为 0**,
 * 于是采推**永远进不去对账**。报告里只有 coverage(每条完整吗),
 * 没有任何「该采的采到了几成」。
 *
 * 实测 2026-09-20:自己主页采到 476 条,X 报 4938 条 = 9.6%,报告一个字没提。
 * ⚠️ 与 followers 那次同一形态:「采到 250 人且条条字段齐全」看着很好,
 * 实际漏了 2500 人 —— **完整 ≠ 齐全**。
 */
describe('⭐⭐ 采推的完整性对账', () => {
  const src = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/x/x-auto-collect.ts'), 'utf-8'));

  it('⭐⭐⭐ 对账门槛必须放采推进来 —— people 恒为 0 会把它整个挡在外面', () => {
    /**
     * ⚠️ 钉 **if 的条件本身**,不是「文件里出现过 tweetPageWithBaseline」——
     * 声明处和后面的使用处都有这个名字,整文件 toMatch 会假绿。
     */
    const i = src.indexOf('let reconcile: AutoCollectReport');
    expect(i, '找不到 reconcile 声明').toBeGreaterThan(0);
    const gate = src.slice(src.indexOf('if (', i), src.indexOf('{', src.indexOf('if (', i)));
    expect(gate, '找不到对账的入口条件').toBeTruthy();
    expect(
      gate,
      '对账门槛只认 people —— 采推那跑 people 恒为 0,永远进不去对账',
    ).toMatch(/tweetPageWithBaseline|r\.tweets\.length/);
  });

  it('⭐⭐⭐ 分子要数推,不能写死数人(否则恒为 0%)', () => {
    /**
     * ⚠️ 这是最隐蔽的一刀:门槛放进来了,但分子仍是 `r.people.length` →
     * 采推那跑分子恒为 0 → 对账恒报「0%」。
     * **那比不对账更糟**,因为 0% 看起来像个结论,会让人去修没坏的采集。
     */
    const assign = src.match(/const got\s*=\s*([^;]+);/)?.[1] ?? '';
    expect(assign, '找不到 got 的赋值').toBeTruthy();
    expect(
      assign,
      'got 写死成人数 —— 采推那跑分子恒为 0,对账恒报 0%(比不对账更糟)',
    ).toMatch(/tweets/);
    expect(assign, 'got 没有按页面类型分流').toMatch(/tweetPageWithBaseline|\?/);
  });

  it('⭐⭐ 分母优先用**这一跑同时刻**采到的,不是库里的旧值', () => {
    /**
     * 实测教训:following 那次分母是两天前的 2553、采集是两天后的 2884,
     * 差出来的 91 人**分不清是时间差还是真漏** —— 对账留下说不清的尾巴。
     * 主页载荷里就带着本人的 tweet_count,那是同一时刻的数。
     */
    const i = src.indexOf('if (tweetPageWithBaseline)');
    expect(i, '找不到采推分母的分支').toBeGreaterThan(0);
    const blk = src.slice(i, i + 1400);

    /**
     * ⚠️ 实测假绿(本轮注入③):把 `selfInPayload` 改成 `undefined as any`、
     * `if` 改成 `if (false)` —— **名字还在**,守卫全绿,而行为没了。
     * 同族第 N 刀,见 feedback-source-scan-cant-see-execution。
     *
     * ⭐ 修法:钉**它从哪来**(必须真的从 r.people 里找)+ 钉**分支条件**
     * (必须真的判 tweetCount 有没有),不是钉名字存在。
     */
    const from = blk.match(/const selfInPayload\s*=\s*([^;]+);/)?.[1] ?? '';
    expect(from, '找不到 selfInPayload 的赋值').toBeTruthy();
    expect(
      from,
      'selfInPayload 不是从本跑采到的人里找的 —— 用不上同时刻的分母',
    ).toMatch(/r\.people\.find/);

    const cond = blk.slice(blk.indexOf('if (', blk.indexOf('selfInPayload')));
    expect(
      cond.slice(0, cond.indexOf(')') + 1),
      '分支条件没有真的判「载荷里有没有 tweetCount」',
    ).toMatch(/selfInPayload\?\.tweetCount/);

    const assign = blk.match(/baseline = (selfInPayload[^;]+);/)?.[1] ?? '';
    expect(assign, '找不到从载荷取分母的赋值').toBeTruthy();
    expect(assign, '取的不是 tweetCount').toMatch(/tweetCount/);
  });

  it('⭐⭐ 退回旧分母时必须**说出来**(铁律四:成功要对账)', () => {
    const i = src.indexOf('if (tweetPageWithBaseline)');
    const blk = src.slice(i, i + 1400);
    const j = blk.indexOf('getAuthorCounts');
    expect(j, '没有退回库里取分母的路径').toBeGreaterThan(0);
    const after = blk.slice(j, j + 700);

    /**
     * ⚠️ 实测假绿(本轮注入④):把声明整句换成 `why = '';` ——
     * `why =` 这个形状在块里**别处也有**(拿不到分母那条分支),被兜住了。
     * ⭐ 修法:钉 **else 分支里那句声明的内容**,而不是「出现过 why =」。
     */
    const elseIdx = after.indexOf('} else {');
    expect(elseIdx, '找不到「拿到了旧分母」那条分支').toBeGreaterThan(0);
    const elseBlk = after.slice(elseIdx, elseIdx + 400);
    expect(
      elseBlk,
      '拿到库里的旧分母却不声明时刻 —— 时间差会让人把「新发的推」误读成「采漏了」',
    ).toMatch(/countsAt/);
    expect(
      elseBlk,
      '没说清这个分母不是同时刻的',
    ).toMatch(/不是这一跑|同时刻|快照/);
  });

  it('⭐⭐⭐ 低比例**不能**判成「没采完」—— 主页本就不给全部历史', () => {
    /**
     * ⚠️⚠️ 采人和采推的分母**语义不同**:
     * · followers_count = 这个列表该有的人数,可以直接比
     * · tweet_count     = 这个人发过的**全部**推,而主页时间线**本就不给全部**
     *   (X 越往前越稀疏;转推/回复是否计入各页口径还不一样)
     *
     * 把 9.6% 判成「没采完」会指向**完全错误的修法** ——
     * 去加轮数、改滚动,而真相是「X 就是不给」。
     * 真判据仍然是游标(X 说没说还有下一页)。
     */
    const i = src.indexOf('const unit =');
    expect(i, '找不到采推的判词分支').toBeGreaterThan(0);
    const blk = src.slice(i, i + 1800);
    expect(
      blk,
      '采推的判词没有警示「低比例≠采漏」—— 会把「X 就是不给」说成「我们采漏了」',
    ).toMatch(/不等于采漏|不代表采漏|≠/);
    expect(
      blk,
      '采推的结论没有回到游标这个真判据',
    ).toMatch(/paging\.hasMore/);
  });

  it('⭐ 采人那条老路不能被改坏(回归)', () => {
    const i = src.indexOf('const unit =');
    const blk = src.slice(i, i + 1800);
    expect(blk, '采人的 0.9 判据没了').toMatch(/rate >= 0\.9/);
    expect(blk, '采人的判词没了').toMatch(/明显少于基准/);
  });
});
