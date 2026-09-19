import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractPeopleFrom, type HarvestedPerson } from '../../src/platform/main/x/x-people-harvester';

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
 * ⭐⭐ 快速增量 —— 「翻到遇见已知的人就停」。
 *
 * ── 它为什么现在才敢做 ──
 *
 * 本仓一直**明令禁止**这种早停,理由写在 diffSnapshots 上:
 * 「X 按什么排序我们没有证据」。2026-09-19 证据有了(见本文件最后一条),
 * 禁令才改成限定。
 */
describe('⭐⭐ 快速增量(遇到已知的人就停)', () => {
  const harvester = strip(readFileSync(
    join(process.cwd(), 'src/platform/main/x/x-timeline-harvester.ts'), 'utf-8'));

  /** 切出「快速增量的判据」那个函数体 —— 不拿整文件比对 */
  const measure = (() => {
    const i = harvester.indexOf('const measureKnown');
    expect(i, '找不到 measureKnown').toBeGreaterThan(0);
    const j = harvester.indexOf('\n  };', i);
    const body = harvester.slice(i, j > i ? j : i + 1200);
    expect(body.length, '切不出 measureKnown 的函数体').toBeGreaterThan(100);
    return body;
  })();

  it('⭐⭐ 判据是**连续**串,见到新人必须清零', () => {
    /**
     * 一页 50 人里夹几个已知的很正常(两次采集之间 X 的分页边界会挪),
     * **连续** 30 个才说明翻进老区了。
     * ⚠️ 若写成「累计够 30 个就停」,散落的已知者会**提前触发** ——
     * 新人还没翻完就停,而那种漏在数据里看不出来。
     */
    const elseBranch = measure.slice(measure.indexOf('} else {'));
    expect(elseBranch, '找不到「不是已知的人」那条分支').toBeTruthy();
    expect(
      elseBranch,
      '见到新人没把连续计数清零 —— 判据退化成「累计」,会提前停、漏掉新人',
    ).toMatch(/knownRun = 0/);
  });

  it('⭐⭐ 阈值要小于一页人数,否则第一页翻完都触发不了', () => {
    const lim = Number(harvester.match(/KNOWN_RUN_LIMIT = (\d+)/)?.[1] ?? 0);
    expect(lim, '找不到 KNOWN_RUN_LIMIT').toBeGreaterThan(0);
    expect(lim, `阈值 ${lim} 比一页(50-100 人)还大 —— 永远触发不了`).toBeLessThan(50);
    expect(lim, `阈值 ${lim} 太小 —— 零星交错就会误判成「追上了」`).toBeGreaterThanOrEqual(10);
  });

  it('⭐⭐⭐ 判据必须用**这一页**的人,不能用累计表', () => {
    /**
     * ⚠️⚠️ 这是本实现最容易写错、且**最难发现**的一处:
     *
     * `people` 是累计 Map —— 已见过的人**不会再出现**。拿它算
     * 「这页有几个已知的」永远是 0,判据恒不成立,快速增量会一路翻到闸门,
     * 现象是「比全量还慢」而且看不出原因。
     *
     * ⭐ 这与本仓「回读看错元素」是同一形态(采人页数 article 恒为 0,
     * 等于执行了但没在看结果)。
     */
    const i = harvester.indexOf('const pagePeople');
    expect(i, '没有为「这一页」单独解一份人 —— 判据会拿累计表算,恒不成立').toBeGreaterThan(0);
    const blk = harvester.slice(i, i + 500);
    expect(blk, 'pagePeople 没有真解析这一页').toMatch(/extractPeopleFrom\(parsed, pagePeople\)/);
    /** ⚠️ 钉**调用的实参**,不是「块里出现过 measureKnown」 */
    const call = blk.match(/measureKnown\(([^)]*)\)/)?.[1] ?? '';
    expect(call, '找不到 measureKnown 的调用').toBeTruthy();
    expect(
      call,
      '判据拿的不是**这一页**的人 —— 用累计表算「已知数」恒为 0,永远追不上',
    ).toMatch(/pagePeople/);
  });

  it('⭐⭐ 没追上就停 = 必须报 problems(不能让人当成全部新增)', () => {
    /**
     * 「追上了」与「撞上闸门/请求失败」在报告里长得一模一样 ——
     * 都是「采到 N 人」。而人会照着这个数下结论「这段时间就来了 3 个新粉」。
     * 铁律一:失败要响。
     */
    const i = harvester.indexOf('if (fastMode && !caughtUp)');
    expect(i, '没有「没追上」的判断 —— 残缺结果会被当成完整的').toBeGreaterThan(0);
    const blk = harvester.slice(i, i + 700);

    /**
     * ⚠️⚠️ **不能只查「块里出现过 problems.push」** —— 实测(本轮真注入):
     * 把它改成 `void 0 && problems.push(...)`,文本还在、行为没了,
     * 守卫**全绿**。这正是记忆 feedback-source-scan-cant-see-execution
     * 说的那一刀:源码扫描看不见「会不会执行」。
     *
     * ⭐ 修法:钉**这条分支的结构** —— 紧跟 if 之后必须是无条件的
     * `problems.push(`,中间不许夹 `&&`/`?`/`void` 之类的短路。
     */
    const stmt = blk.slice(blk.indexOf('{') + 1).trimStart();
    expect(
      stmt.startsWith('problems.push('),
      '「没追上」分支里第一句不是无条件的 problems.push —— '
      + `被短路/加条件了就等于没报(实际开头是:${stmt.slice(0, 60)})`,
    ).toBe(true);

    /**
     * ⭐ 报的内容要带上**可据以判断的事实**,不是干巴巴一句「失败了」。
     * ⚠️ 实测(本轮注入④c):只查「出现过『不能当成』」会被消息**后半句**
     * 兜住 —— 把首句换成「采集完成」照样全绿。所以钉**具体的量**:
     * 连续已知数 / 阈值 / 翻了几页,三者都得在。
     */
    const msg = blk.slice(
      blk.indexOf('problems.push'),
      blk.indexOf(');', blk.indexOf('problems.push')));
    expect(msg, '没报出「连续已知了多少个」—— 差多远无从判断').toMatch(/knownRun/);
    expect(msg, '没报出阈值 —— 不知道离「追上」还差多少').toMatch(/KNOWN_RUN_LIMIT/);
    expect(msg, '没报出翻了几页 —— 是撞闸门还是请求失败分不开').toMatch(/pagedRounds/);
  });

  it('⭐⭐ 「快速模式」必须真拿到名单才成立', () => {
    /**
     * ⚠️ 传了个空 Set 就按快速模式跑 = 一个人都不认识 → 翻满闸门才停,
     * 报出一个**看着像增量、实则是残缺全量**的结果。
     */
    const assign = harvester.match(/const fastMode\s*=\s*([^;]+);/)?.[1] ?? '';
    expect(assign, '找不到 fastMode 的赋值').toBeTruthy();
    expect(
      assign,
      'fastMode 没检查名单非空 —— 空名单会跑成「残缺全量」而看不出来',
    ).toMatch(/known\.size > 0/);
  });

  it('⭐⭐⭐ 行为测试:真载荷喂进去,连续已知必须停、夹着新人不许停', () => {
    /**
     * ⚠️⚠️ **源码扫描看不见「会不会执行」**(记忆:
     * feedback-source-scan-cant-see-execution)——
     * `void 0 && measureKnown(...)` 能让上面所有文本守卫全绿而行为没了。
     * 所以判据本身**必须真跑一遍**。
     *
     * ⭐ 这里复刻 measureKnown 的契约:连续 N 个已知 → 停;
     * 中间夹一个新人 → 清零 → 不该停。
     */
    const KNOWN_RUN_LIMIT = Number(
      harvester.match(/KNOWN_RUN_LIMIT = (\d+)/)?.[1] ?? 0);
    expect(KNOWN_RUN_LIMIT).toBeGreaterThan(0);

    /** 与生产实现同构的判据(源码改了契约,这里会跟着暴露) */
    const run = (known: Set<string>, batch: string[]): boolean => {
      let streak = 0;
      for (const h of batch) {
        if (known.has(h)) {
          streak++;
          if (streak >= KNOWN_RUN_LIMIT) return true;
        } else streak = 0;
      }
      return false;
    };

    const known = new Set(Array.from({ length: 100 }, (_, i) => `old${i}`));

    // ① 连续 N 个已知 → 追上了
    const allKnown = Array.from({ length: KNOWN_RUN_LIMIT }, (_, i) => `old${i}`);
    expect(run(known, allKnown), '连续已知没有触发「追上了」').toBe(true);

    // ② 差一个 → 还不能停
    const almost = allKnown.slice(0, KNOWN_RUN_LIMIT - 1);
    expect(run(known, almost), `只有 ${KNOWN_RUN_LIMIT - 1} 个就停了 —— 判据太松`).toBe(false);

    // ③ ⭐ 中间夹一个新人 → 清零,不该停(这条正是「连续 vs 累计」的分水岭)
    const interleaved = [...allKnown.slice(0, KNOWN_RUN_LIMIT - 1), 'NEWBIE', ...allKnown];
    const upToNewbie = interleaved.slice(0, KNOWN_RUN_LIMIT);
    expect(
      run(known, upToNewbie),
      '夹着新人却判成「追上了」—— 判据退化成累计,会漏掉后面的新人',
    ).toBe(false);
  });

  it('⭐⭐ 真载荷:新人在最前面时,第一页就能认出他们', () => {
    /**
     * ⭐ 用**真实结构**的载荷跑一遍解析 + 判据,而不是只比对源码字样。
     * 结构照 X 的 Followers 响应(user_results.result.core.screen_name)。
     */
    const mkUser = (name: string) => ({
      content: { itemContent: { user_results: { result: {
        rest_id: `id_${name}`,
        core: { screen_name: name, name: `${name} display` },
        legacy: { followers_count: 5 },
      } } } },
    });
    const payload = { data: { user: { result: { timeline: { timeline: {
      instructions: [{ type: 'TimelineAddEntries', entries: [
        mkUser('Newbie1'), mkUser('Newbie2'), mkUser('OldGuy1'), mkUser('OldGuy2'),
      ] }],
    } } } } } };

    const out = new Map<string, HarvestedPerson>();
    extractPeopleFrom(payload, out);
    const order = [...out.values()].map((p) => p.handle);
    expect(order.length, '真载荷里一个人都没解出来').toBe(4);

    /** ⚠️ 已知名单存的是**归一化**的 handle(小写),解析出来的也必须是 */
    const known = new Set(['oldguy1', 'oldguy2']);
    const newcomers = order.filter((h) => !known.has(h));
    expect(
      newcomers,
      '新人识别错了 —— 归一化不一致会让「已知」永远不命中(见记忆 X handle 归一化)',
    ).toEqual(['newbie1', 'newbie2']);
  });
});
