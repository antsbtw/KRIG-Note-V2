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
