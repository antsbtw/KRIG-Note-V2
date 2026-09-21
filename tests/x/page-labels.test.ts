import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PAGE_PARAMS, PAGE_LABELS } from '../../src/platform/main/x/x-pages';

function strip(src: string): string {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/(^|[^:])\/\/.*$/gm, '$1');
  if (noLine.includes('/*') || /(^|[^:])\/\//m.test(noLine)) {
    throw new Error('strip 自检失败:还有注释残留');
  }
  return noLine;
}

/**
 * ⭐⭐ 下拉要给人看懂 —— 用户 2026-09-20:「哪个是 status?」
 */
describe('⭐⭐ 页面下拉的可读性与双向导航', () => {
  it('⭐⭐⭐ 每个页面都要有人话名 —— 新增页面不能漏(清单不会自己长)', () => {
    /**
     * ⚠️⚠️ 这正是本仓「守卫写死的清单不会自己长」那一刀
     * (feedback-guard-hardcoded-list-never-grows):
     * 两张表分开维护,加了新页面只改一张 → 下拉里那项显示成代码名,
     * **而且不报错**,只表现为「这个选项看不懂」。
     *
     * ⭐ 所以判据不是「PAGE_LABELS 里有几条」,而是
     * **它的键必须与 PAGE_PARAMS 完全一致** —— 信息来源是真表,不是抄的清单。
     */
    const params = Object.keys(PAGE_PARAMS).sort();
    const labels = Object.keys(PAGE_LABELS).sort();
    const missing = params.filter((k) => !labels.includes(k));
    const extra = labels.filter((k) => !params.includes(k));
    expect(
      missing,
      `这些页面没有人话名,下拉里会显示成代码名看不懂:${missing.join(', ')}`,
    ).toEqual([]);
    expect(
      extra,
      `人话名表里有多余的键(页面已删?):${extra.join(', ')}`,
    ).toEqual([]);
  });

  it('⭐⭐ 人话名不能就是代码名本身(那等于没写)', () => {
    const bad = Object.entries(PAGE_LABELS)
      .filter(([k, v]) => !v.trim() || v === k || /^x\./.test(v));
    expect(
      bad.map(([k]) => k),
      '这些页面的「人话名」还是代码名或空的 —— 等于没写',
    ).toEqual([]);
  });

  it('⭐⭐ status 的人话名要说清它是「单条推文」', () => {
    /** 用户就是被这一项卡住的,单独钉一条 */
    expect(
      PAGE_LABELS['x.status'],
      'x.status 的说明没有点出「单条推文」—— 用户正是问「哪个是 status」',
    ).toMatch(/单条|推文详情/);
  });

  it('⭐⭐ 面板必须从**真表**读人话名,不许自己抄一份', () => {
    const ui = strip(readFileSync(
      join(process.cwd(), 'src/views/web-console/WebConsoleView.tsx'), 'utf-8'));
    expect(ui, '面板没有读 labelsOf —— 多半是自己写了一份清单').toMatch(/labelsOf/);
    /**
     * ⚠️ 钉**渲染处真的用了它**,不是「文件里出现过」——
     * 声明和 setState 都有这个名字,整文件 toMatch 会假绿。
     */
    /**
     * ⚠️⚠️ 实测踩到**两刀**:
     * ① 全文件有三处 `<option key={n}`(还有个通用小组件),按第一处切会切错;
     * ② 改成「数 pageLabels[n] 出现几次」仍然假绿 —— 因为**注释里也有这个字样**
     *    (JSX 注释 `{/* … *\/}` 的内容 strip 不掉),把数撑到 2。
     *
     * ⭐ 判据改成:**数「渲染 option 且用了人话名」的完整形状**,
     * 只有真正的渲染代码长这样,注释和声明都不会。
     */
    const rendered = (ui.match(/<option key=\{n\} value=\{n\}>\s*\{pageLabels\[n\]/g) ?? []).length;
    expect(
      rendered,
      `只有 ${rendered} 处下拉**真的渲染**了人话名 —— 采集和 goto 两个下拉都要用`,
    ).toBeGreaterThanOrEqual(2);
  });

  it('⭐⭐⭐ 自动同步只在**左边真的换页**时写右边(双向对称的地基)', () => {
    /**
     * ⭐⭐ 用户 2026-09-20:「我的要求是左边操作,右边能够获取需要采集的参数…
     *    这样搞对称的,怎么只有一个单向的功能呢?」
     *
     * ── 两个方向必须同时成立 ──
     * · 左边导航到某页 → 右边自动填参数(Followers 时就有的)
     * · 右边选好参数   → 点「跳过去」左边跟过来
     *
     * ── 我曾把对称砍成单向(别再犯)──
     * 原来同步是**一刀切**:跟随开着就每 1.5 秒无条件覆盖右边,
     * 于是「手选了又被跳回 x.home」。我的修法是在下拉/参数框上
     * `setAcFollow(false)` —— **把「左→右」那半边关掉了**,
     * 修好一个方向、砍掉另一个方向。
     *
     * ⭐ 真正的不变量:**左边没动时,右边手选的值不许被碰**。
     * 判据是「URL 变没变」,不是「开关开没开」。
     */
    const ui = strip(readFileSync(
      join(process.cwd(), 'src/views/web-console/WebConsoleView.tsx'), 'utf-8'));
    const i = ui.indexOf('whereAmI(wcId())');
    expect(i, '找不到「左边在哪一页」的轮询').toBeGreaterThan(0);
    const blk = ui.slice(i, i + 900);

    expect(
      blk,
      '同步没有比对上次的 URL —— 只能一刀切地无条件覆盖,'
      + '于是右边手选的值会被抹掉(那正是「选了又跳回 x.home」的成因)',
    ).toMatch(/lastSeenUrl/);

    const guard = blk.match(/if \(url === lastSeenUrl\.current\)[^\n]*/)?.[0] ?? '';
    expect(guard, '找不到「URL 没变就跳过」的判断').toBeTruthy();
    expect(
      guard,
      'URL 没变时没有 return —— 仍会往下写右边的下拉和参数',
    ).toMatch(/return/);

    expect(
      blk.indexOf('lastSeenUrl.current') < blk.indexOf('setAcPage('),
      '写右边发生在「变没变」判断之前 —— 判断等于没做',
    ).toBe(true);
  });

  it('⭐⭐ 手选不再需要关掉跟随(否则又砍成单向)', () => {
    /**
     * ⚠️ 反向锁:同步已改成「换页才写」,手选就**不该**再关跟随 ——
     * 关了就等于把「左→右」那半边又砍掉,回到单向。
     */
    const ui = strip(readFileSync(
      join(process.cwd(), 'src/views/web-console/WebConsoleView.tsx'), 'utf-8'));
    const selIdx = ui.indexOf('value={acPage}');
    const sel = ui.slice(selIdx, selIdx + 200);
    expect(
      sel,
      '下拉又去关跟随了 —— 那会把「左边点、右边跟」这半边砍掉,回到单向',
    ).not.toMatch(/setAcFollow\(false\)/);
  });

  it('⭐⭐ 左右不一致时要**明确提示**采的是哪一页', () => {
    /**
     * ⚠️ 右边选的和左边不一样时,人不知道「点采集到底采哪一页」——
     * 而那会导致采错页面还以为采对了。
     */
    const ui = strip(readFileSync(
      join(process.cwd(), 'src/views/web-console/WebConsoleView.tsx'), 'utf-8'));
    const i = ui.indexOf('const sameSide');
    expect(i, '没有「左右一致吗」的判断 —— 采错页面看不出来').toBeGreaterThan(0);

    /**
     * ⚠️ 实测假绿:把 `sameSide` 改成写死 `true`,不一致那个分支的文本
     * **还在**(只是永远走不到),守卫照样全绿 ——
     * 同族:feedback-source-scan-cant-see-execution。
     * ⭐ 钉**赋值本身**:必须真的比对左右两边。
     */
    const assign = ui.match(/const sameSide\s*=\s*([^;]+);/)?.[1] ?? '';
    expect(assign, '找不到 sameSide 的赋值').toBeTruthy();
    expect(
      assign,
      'sameSide 不是真比出来的 —— 左右不一致会被当成一致,采错页面看不出来',
    ).toMatch(/here === acPage|acPage === here/);

    const blk = ui.slice(i, i + 700);
    expect(blk, '不一致时没告诉人怎么办').toMatch(/跳过去/);
  });
});
