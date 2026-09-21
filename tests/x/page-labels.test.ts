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

  it('⭐⭐⭐ 「跳过去」必须先关掉「跟着左边走」(否则选择被覆盖)', () => {
    /**
     * ⚠️ acFollow 每 1.5 秒把左边的当前页写回右边。
     * 跳转后若不关掉它,右边的选择会在 1.5 秒内**被覆盖回去** ——
     * 现象是「点了跳过去,参数自己变了」,而人会以为是自己点错了。
     */
    const ui = strip(readFileSync(
      join(process.cwd(), 'src/views/web-console/WebConsoleView.tsx'), 'utf-8'));
    const i = ui.indexOf('const jump =');
    expect(i, '找不到「跳过去」的实现').toBeGreaterThan(0);
    /**
     * ⚠️ 实测:函数体里有嵌套的 `}` ,按第一个 `};` 切会**切太短**
     * (切在 for 循环那里),守卫假红。切到 goto 调用之后再收尾。
     */
    const gi = ui.indexOf('goto(', i);
    expect(gi, '「跳过去」里没有 goto 调用').toBeGreaterThan(i);
    const body = ui.slice(i, gi + 120);
    expect(
      body,
      '跳转前没关掉「跟着左边走」—— 1.5 秒后右边的选择会被左边覆盖回去',
    ).toMatch(/setAcFollow\(false\)/);
    expect(body, '跳转没复用现成的 goto 能力').toMatch(/goto\(/);
    /** ⚠️ 关闭必须在 goto **之前**,否则仍有一个同步周期的竞态 */
    expect(
      body.indexOf('setAcFollow(false)') < body.indexOf('goto('),
      '关闭「跟着左边走」在 goto 之后 —— 中间那一下仍可能被覆盖',
    ).toBe(true);
  });
});
