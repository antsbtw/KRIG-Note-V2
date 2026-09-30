/**
 * ⭐⭐ 邮件提取脚本 —— 真 eval 再 parse(L2 收口第 3 批)
 *
 * ── 为什么补这条 ──
 *
 * `mail-extract.ts` 的注入脚本此前**零测试**,而它把坐标 `${x}`/`${y}`
 * 直接插进脚本文本 —— 与 `project-x-inject-template-escape` 同族:
 * 求值后的样子与源码所见不同,而 **tsc 与单测都发现不了**。
 *
 * ⚠️ 用 `new Function(...)` **真的解析**生成出来的脚本文本,
 * 不用 `toContain('elementFromPoint')` 那类字面量断言 ——
 * 后者在转义被吃掉时照样全绿(feedback-source-scan-cant-see-execution 同族)。
 *
 * ⚠️ 本批**只改绑定不改逻辑**:① 段的回退语义(只在 ±24 带内找、
 * 取「中心距最近」)与 `web.dom` 的 `ordinal-by-point`(带外也找、
 * 取「边缘距最近」+ maxDy 240)**不一样**。所以下面钉的是
 * 「mail 自己的语义没被改掉」,而不是「它跟别人一样」。
 */
import { describe, it, expect } from 'vitest';
import { buildExtractScript } from '@platform/main/mail/mail-extract';
import { el, makeDom, evalInDom } from '../../../web-capability/helpers/fake-dom';

const build = (x = 100, y = 200, sel = '.zA', body = '.a3s', subj = '.hP'): string =>
  buildExtractScript(x, y, sel, body, subj);

describe('⭐ mail 提取脚本', () => {
  it('⭐⭐ 生成的脚本能被真正解析 —— 转义没被吃掉', () => {
    expect(
      () => new Function(`return ${build()}`),
      '脚本解析不了 —— 正是那次转义事故的形态:源码看着对,求值之后是坏的。\n'
      + '浏览器会每次都抛,而现象是「右键提取没反应」。',
    ).not.toThrow();
  });

  it('⭐⭐ 坐标是**绑定**进去的,不是拼进脚本文本', () => {
    const s = build(100, 200);
    expect(s, '坐标没走绑定变量').toContain('var X = 100;');
    expect(s, '坐标没走绑定变量').toContain('var Y = 200;');
    // ⭐ 关键:elementFromPoint 必须吃变量,不是吃字面量
    expect(s, 'elementFromPoint 还在吃拼进去的字面量')
      .toContain('document.elementFromPoint(X, Y)');
    expect(s, '脚本里出现了拼死的坐标').not.toContain('elementFromPoint(100, 200)');
  });

  it('⭐ selector 含引号/反斜杠不会破坏脚本(注入面)', () => {
    const nasty = String.raw`div[data-x="a\"b"], .c'd`;
    expect(
      () => new Function(`return ${build(1, 2, nasty, nasty, nasty)}`),
      'selector 含引号就把脚本拼坏了 —— 说明没走 JSON.stringify',
    ).not.toThrow();
  });

  it('⭐ nbsp 转义求值后仍是转义序列,不是真的 nbsp 字符', () => {
    /**
     * 源码里写的是模板字面量内的 `\\u00a0`,求值后脚本文本里应当是
     * 六个字符的转义序列 `\u00a0`,由浏览器再解析成 nbsp。
     *
     * ⚠️ 本条测试我自己先踩了一次:用 `String.raw` 写期望值时,
     * `\u00a0` 仍被 TS 解析成**真的 nbsp 字符**,断言于是恒假。
     * 改成用 charCode 拼期望值 —— 绝不让期望值本身经过转义处理。
     */
    const backslash = String.fromCharCode(92);
    const expected = `replace(/${backslash}u00a0/g, ' ')`;
    const s = build();
    expect(s, '转义被吃掉了 —— 脚本会去替换真的 nbsp 而不是转义序列').toContain(expected);
    // 反向:脚本里不该出现真的 nbsp(0xA0)
    expect(s.includes(String.fromCharCode(0xa0)), '脚本里出现了真的 nbsp 字符').toBe(false);
  });

  it('⭐ 保留 mail 自己的回退语义(不是跟 ordinal-by-point 对齐)', () => {
    /**
     * ⚠️ 这条是防「下一个人顺手统一」:
     * mail 只在 ±24 带内找、取**中心距**最近;
     * `web.dom` 的 ordinal-by-point 带外也找、取**边缘距**最近 + maxDy 240。
     * 两者行为不同,合并会改行为 —— 要合并得先单独立项并真机验。
     */
    const s = build();
    expect(s, 'mail 的 ±24 带内判据不见了').toContain('Y >= r.top - 24 && Y <= r.bottom + 24');
    expect(s, 'mail 的「中心距最近」判据不见了')
      .toContain('Math.abs((r.top + r.bottom) / 2 - Y)');
    expect(s, 'mail 不该出现 ordinal-by-point 的 maxDy 上限').not.toContain('MAXDY');
  });

  it('⭐ 找不到容器要如实返回 __noMail,不许静默给空对象', () => {
    /** 主进程靠这个标记区分「没点在邮件上」与「脚本坏了」,两者处置相反 */
    expect(build(), '__noMail 标记不见了 —— 两种失败会混成一种').toContain('{ __noMail: true }');
  });

  it('⭐ 脚本自身异常要带回原因(不是静默返 null)', () => {
    expect(build(), '异常没带回原因').toContain('__error');
  });
});

/**
 * ⭐⭐ 行为测试 —— 用仓里的 `fake-dom` **真的跑**生成的脚本
 *
 * ── 为什么必须有这一段,且必须用 fake-dom ──
 *
 * 2026-09-30 两轮独立复核,抓出的都是「文本断言零区分力」:
 *
 * 第一轮:只断言脚本文本,三种破坏全绿 ——
 *   `box = best || list[0]`(带外兜底拿第一封)/ `if (false && !box)`(掐掉 __noMail)
 *   / 掐掉 NaN 校验
 *
 * 第二轮:我改用**手写假 DOM**,仍然全绿 ——
 *   ⚠️ 因为我那个假 DOM 让 `elementFromPoint` 返回**预先指定的下标**,
 *   于是它既不看 selector 也不看坐标。三种破坏测不出来:
 *   closest 传错 selector / 带内回退永远取第一封 / 把页面空白元素当邮件。
 *
 * ⭐ 结论:**别手写假 DOM。** `tests/web-capability/helpers/fake-dom.ts`
 * 真按 selector 匹配、`elementFromPoint` 真按矩形命中、
 * 遇到不支持的选择器写法会**抛错**而不是静默返回空。
 * 本轮给它补了 `elementFromPoint` / `closest` / `innerText` / per-element rect。
 */
describe('⭐⭐ 真跑脚本:行为不许漂(用 fake-dom)', () => {
  const SEL = '.zA';

  /** 造一封邮件容器:class=zA,带矩形,内含正文节点 */
  const mail = (top: number, height: number, text: string) =>
    el('div', { class: 'zA' }, { textContent: text, rect: { left: 0, top, width: 200, height } });

  /** 页面上的非邮件元素(空白区) —— 用来验「点中了东西但不是邮件」 */
  const filler = (top: number, height: number) =>
    el('div', { class: 'spacer' }, { textContent: 'not-a-mail', rect: { left: 0, top, width: 200, height } });

  function run(x: number, y: number, nodes: ReturnType<typeof el>[]): Record<string, unknown> {
    const dom = makeDom(nodes);
    return evalInDom(dom, buildExtractScript(x, y, SEL, '', '')) as Record<string, unknown>;
  }

  it('⭐ 命中容器时,取的是被点的那一个', () => {
    const r = run(50, 150, [mail(0, 100, 'A'), mail(100, 100, 'B'), mail(200, 100, 'C')]);
    expect(r.__noMail, '命中了却报没点中').toBeUndefined();
    expect(r.bodyText, '取错了容器').toBe('B');
  });

  it('⭐⭐ 点中非邮件元素时必须报 __noMail —— 不许把空白当邮件', () => {
    /**
     * ⚠️ 复核抓到的第三种破坏:`el.closest(sel) || el` 会把命中的
     * 任意元素当成邮件容器。手写假 DOM 测不出来,因为它不区分元素类型。
     */
    const r = run(50, 250, [mail(0, 100, 'A'), filler(200, 100)]);
    expect(
      r.__noMail,
      '点在非邮件元素上却没报 __noMail —— 多半写了 `closest(sel) || el` 之类的兜底',
    ).toBe(true);
  });

  it('⭐⭐ 带外点击必须报 __noMail —— 不许兜底拿第一封', () => {
    const r = run(50, 9999, [mail(0, 100, 'A'), mail(100, 100, 'B')]);
    expect(
      r.__noMail,
      '带外点击没报 __noMail —— 多半加了「找不到就拿第一封」的兜底,\n'
      + '那会把「点在空白处」变成「悄悄提取了第一封」',
    ).toBe(true);
    expect(r.bodyText, '带外点击竟然取到了内容').toBeUndefined();
  });

  it('⭐⭐ 间隙回退取「中心距最近」,不是「边缘距最近」', () => {
    /**
     * ⭐ 复核给的用例(我原来那个两候选距离打平,区分不了规则):
     *   A=[0,100] B=[120,130] y=108
     *   · 按**边缘距**:A 距 8、B 距 12 → 选 A
     *   · 按**中心距**:A 中心 50 距 58、B 中心 125 距 17 → 选 B
     * mail 的语义是中心距,所以断言必须是 **B**。
     */
    const r = run(50, 108, [mail(0, 100, 'A'), mail(120, 10, 'B')]);
    expect(r.__noMail, '带内间隙点击被判成没点中').toBeUndefined();
    expect(
      r.bodyText,
      '回退规则漂了:取到 A 说明用的是「边缘距最近」,而 mail 的语义是「中心距最近」',
    ).toBe('B');
  });

  it('⭐⭐ closest 必须用对 selector —— 用「回退会取到另一封」的布局区分', () => {
    /**
     * ⚠️ 我第一版这条是**假绿**:用例里被点那封总在 ±24 带内,
     * 于是 closest 传错 selector 时,带内回退照样命中同一封 → 测不出来。
     * (复核预言了这一点,实测 `closest('.WRONG')` 仍全绿)
     *
     * ⭐ 修法:造一个「closest 对」与「回退」结论**不同**的布局:
     *   A=[0,200] 含 y=190 → closest 应命中 A
     *   B=[210,230] 中心 220,距 190 = 30;A 中心 100,距 190 = 90
     * → closest 正确取 A;closest 坏掉则回退取中心距更近的 **B**。
     * 断言 A,于是 closest 一坏就红。
     */
    const r = run(50, 190, [mail(0, 200, 'A'), mail(210, 20, 'B')]);
    expect(
      r.bodyText,
      'closest 没按 selector 命中被点的那封 —— 取到 B 说明落到了带内回退,\n'
      + '也就是 closest 那一步实际上没起作用(selector 传错了?)',
    ).toBe('A');
  });

  it('⭐⭐ NaN / Infinity 坐标必须**抛**,不许静默取第一封', () => {
    /**
     * ⚠️⚠️ 这是我引入的真回归(复核抓到):
     * `JSON.stringify(NaN)` === `'null'`,浏览器把
     * `elementFromPoint(null, null)` 当 `(0,0)` → 悄悄提取最左那封,不报错。
     * ⭐ `JSON.stringify` 对数字**不是安全网**,挡坏数字只能靠校验。
     */
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => buildExtractScript(bad, 100, SEL, '', ''),
        `x=${String(bad)} 没被拒绝 —— 会静默提取错的那封`).toThrow(/有限数字/);
      expect(() => buildExtractScript(100, bad, SEL, '', ''),
        `y=${String(bad)} 没被拒绝`).toThrow(/有限数字/);
    }
  });
});
