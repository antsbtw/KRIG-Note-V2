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
 * ⭐⭐ 行为测试 —— 造一个假 DOM,**真的跑**生成的脚本
 *
 * ── 为什么必须有这一段 ──
 *
 * 2026-09-30 独立复核实测:上面那些「源码文本断言」漏掉了三类破坏,
 * 改完**全绿**:
 *   ① 坐标从绑定退回裸拼(数字两种写法产出文本一模一样,文本断言分不出)
 *   ② 加一行「带外找不到就拿第一封」(`box = best || list[0]`)
 *   ③ `if (false && !box)` 让「没点中」那句永远不执行
 *
 * ⭐ ②③ 的共同点:**脚本文本仍然长得对,行为已经变了** ——
 * 正是 `feedback-source-scan-cant-see-execution` 那一刀。
 * 结构用源码扫描,**「会不会那样做」必须真的跑一遍**。
 */
describe('⭐⭐ 真跑脚本:行为不许漂', () => {
  /** 一个够用的假 DOM:三个矩形容器纵向排列 */
  function runScript(
    script: string,
    boxes: Array<{ top: number; bottom: number; left?: number; text?: string }>,
    pointAt: { el: number | null },
  ): Record<string, unknown> {
    const nodes = boxes.map((b, i) => {
      const node: Record<string, unknown> = {
        getBoundingClientRect: () => ({
          top: b.top, bottom: b.bottom, left: b.left ?? 0, right: 100,
        }),
        innerText: b.text ?? `mail-${i}`,
        textContent: b.text ?? `mail-${i}`,
        getAttribute: () => null,
        querySelector: () => null,
      };
      node.closest = () => node;         // 命中自己
      return node;
    });
    const doc = {
      elementFromPoint: (): unknown => (pointAt.el === null ? null : nodes[pointAt.el]),
      querySelectorAll: (): unknown[] => nodes,
      querySelector: (): unknown => null,
    };
    /**
     * ⚠️⚠️ **脚本必须用括号包住** —— 它以换行开头,
     * 写成 `return ${script}` 会被 ASI 切成 `return;` + 一条孤立表达式,
     * 于是**恒返回 undefined**,而且不报错。
     *
     * ⭐ 我第一版就是这么写的,四条行为测试全挂在这上面 ——
     * 而上面那条「能被真正解析」的断言用的也是同一个写法:
     * 它只验证了**文本能 parse**,并没有验证**求值出东西** ——
     * 「能解析」与「跑得出结果」是两件事。
     */
    const fn = new Function('document', 'location', `return (${script});`);
    return fn(doc, { href: 'https://mail.test/x' }) as Record<string, unknown>;
  }

  const SEL = '.zA';

  it('⭐ 命中容器时,取的是被点的那一个', () => {
    const script = buildExtractScript(50, 150, SEL, '', '');
    // elementFromPoint 命中第 1 个(index 1)
    const r = runScript(script, [
      { top: 0, bottom: 100, text: 'A' },
      { top: 100, bottom: 200, text: 'B' },
      { top: 200, bottom: 300, text: 'C' },
    ], { el: 1 });
    expect(r.__noMail, '命中了却报没点中').toBeUndefined();
    expect(r.bodyText, '取错了容器').toBe('B');
  });

  it('⭐⭐ 带外点击必须报 __noMail —— 不许兜底拿第一封', () => {
    /**
     * ⚠️ 这条就是假绿②要防的:`box = best || list[0]` 会让
     * 「点在空白处」变成「悄悄提取第一封」,而文本断言看不出来。
     */
    const script = buildExtractScript(50, 9999, SEL, '', '');
    const r = runScript(script, [
      { top: 0, bottom: 100, text: 'A' },
      { top: 100, bottom: 200, text: 'B' },
    ], { el: null });   // 没命中任何容器,且 9999 远在 ±24 带外
    expect(
      r.__noMail,
      '带外点击没报 __noMail —— 多半加了「找不到就拿第一封」的兜底,\n'
      + '那会把「点在空白处」变成「悄悄提取了第一封」',
    ).toBe(true);
    expect(r.bodyText, '带外点击竟然取到了内容').toBeUndefined();
  });

  it('⭐⭐ `if (false)` 掐掉 __noMail 这条路要被抓到', () => {
    /**
     * 假绿③:把那句改成 `if (false && !box)` 后文本仍在、行为没了。
     * 上一条已经覆盖它 —— 这里显式再钉一次「返回值里真的有这个标记」,
     * 而不是「源码里有这行字」。
     */
    const script = buildExtractScript(50, 9999, SEL, '', '');
    const r = runScript(script, [{ top: 0, bottom: 100 }], { el: null });
    expect(Object.keys(r), '返回的不是 __noMail 信封').toContain('__noMail');
  });

  it('⭐ 间隙点击(±24 带内)回退到最近的那个', () => {
    // y=112 落在两个容器之间的 12px 间隙里,带内 → 应回退到中心距更近的
    const script = buildExtractScript(50, 112, SEL, '', '');
    const r = runScript(script, [
      { top: 0, bottom: 100, text: 'A' },     // 中心 50,距 62
      { top: 124, bottom: 224, text: 'B' },   // 中心 174,距 62 —— 打平,取先命中的
    ], { el: null });
    expect(r.__noMail, '带内间隙点击被判成没点中').toBeUndefined();
    expect(['A', 'B'], '回退取到了预期外的容器').toContain(r.bodyText);
  });

  it('⭐⭐ NaN / Infinity 坐标必须**抛**,不许静默取第一封', () => {
    /**
     * ⚠️⚠️ 2026-09-30 复核抓到的**真回归**:
     * 我把坐标改成 `JSON.stringify(x)` 绑定,而
     * `JSON.stringify(NaN)` === `'null'`,浏览器把 `elementFromPoint(null, null)`
     * 当成 `(0,0)` → **悄悄提取最左边那封,不报任何错**。
     * 改之前 NaN 原样进脚本,浏览器当场报错,用户看得见失败。
     *
     * ⭐ 教训:**`JSON.stringify` 对数字不是安全网**,挡坏数字只能靠校验。
     */
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(
        () => buildExtractScript(bad, 100, SEL, '', ''),
        `x=${String(bad)} 没被拒绝 —— 会静默提取错的那封`,
      ).toThrow(/有限数字/);
      expect(
        () => buildExtractScript(100, bad, SEL, '', ''),
        `y=${String(bad)} 没被拒绝`,
      ).toThrow(/有限数字/);
    }
  });
});
