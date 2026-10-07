/**
 * ⭐⭐ 「按坐标定位第几条」脚本 —— 真 eval 再 parse(L2 收口第 2 批)
 *
 * ── 为什么这条测试必须存在 ──
 *
 * `project-x-inject-template-escape`(采集停摆一整天):
 * 模板字面量里写 `\/`,求值时被吃掉,浏览器收到非法正则 → 整段脚本解析失败。
 * ⚠️ 特征是 **tsc 通过、单测通过、看源码也没问题** ——
 * 因为源码里那个正则是对的,错的是**求值之后**的样子。
 *
 * ⭐ 所以这里用 `new Function(...)` **真的去解析**生成出来的脚本文本,
 * 而不是 `toContain('replace')` 这种字面量断言 ——
 * 后者在转义被吃掉时照样全绿(feedback-source-scan-cant-see-execution 同族)。
 */
import { describe, it, expect } from 'vitest';
import { LOCATE_SCRIPTS, LOCATE_SCRIPT_DEFINITIONS }
  from '@platform/main/web-capability/dom/locate-scripts';

const def = LOCATE_SCRIPT_DEFINITIONS.find((d) => d.id === LOCATE_SCRIPTS.ordinalByPoint)!;

describe('⭐ dom.ordinal-by-point', () => {
  it('前提自检:脚本登记在表里', () => {
    expect(def, '脚本没登记 —— 后面每条断言都会空转').toBeDefined();
    expect(def.purpose.length, 'purpose 不许空:出问题时它是第一条线索').toBeGreaterThan(10);
  });

  it('⭐⭐ 生成的脚本能被真正解析 —— 转义没被吃掉', () => {
    const s = def.build({ x: 100, y: 200, selector: 'article, .foo' });
    expect(
      () => new Function(`return ${s}`),
      '生成的脚本解析不了 —— 正是 project-x-inject-template-escape 那一类:\n'
      + '源码看着对,求值之后是坏的。浏览器会每次都抛,而采集恒 0。',
    ).not.toThrow();
  });

  it('⭐ `\\s+` 求值后仍是 `\\s+`(那次事故的原型)', () => {
    const s = def.build({ x: 1, y: 2, selector: 'div' });
    expect(s, '反斜杠被吃掉了 —— 正则会变成完全不同的东西')
      .toContain(String.raw`replace(/\s+/g, ' ')`);
  });

  it('⭐⭐ 外部值是**绑定**进去的,不是拼进脚本文本', () => {
    /**
     * ⚠️ 这条最初写成 `toContain('var X = 100;')`,**注入验证当场证否**:
     * 把 `JSON.stringify(x)` 改回裸 `${x}` 之后**照样全绿** ——
     * 因为数字的两种写法产出的文本一模一样,字面量断言根本分不出来。
     *
     * ⭐ 改成钉**真正的性质**:喂一个"数字长得像脚本"的值进去,
     * 裸拼会把它拼进脚本文本(于是解析出别的东西),绑定则不会。
     * 数字类型本身拼不出坏脚本,所以这里的防线其实是
     * `requireNumber` —— 下面「缺参数要抛」那条才是它的守卫。
     */
    const s = def.build({ x: 100, y: 200, selector: 'article' });
    expect(s, '坐标没进脚本').toContain('var X = 100;');
    expect(s, '坐标没进脚本').toContain('var Y = 200;');
    // selector 必须是 JSON 字面量(带引号),不是裸拼
    expect(s, 'selector 没走 JSON.stringify').toContain('var sel = "article";');
  });

  it('⭐ selector 里的引号/反斜杠不会破坏脚本(注入面)', () => {
    // 一个恶意/畸形 selector:若是裸拼,这里会拼出语法错误
    const nasty = String.raw`div[data-x="a\"b"], .c'd`;
    const s = def.build({ x: 0, y: 0, selector: nasty });
    expect(
      () => new Function(`return ${s}`),
      'selector 含引号就把脚本拼坏了 —— 说明没走绑定值',
    ).not.toThrow();
  });

  it('⭐ 缺参数 / 类型不对要**抛**,不许静默用默认值', () => {
    expect(() => def.build({ y: 1, selector: 'div' }), '缺 x 却没抛').toThrow(/x/);
    expect(() => def.build({ x: 1, selector: 'div' }), '缺 y 却没抛').toThrow(/y/);
    expect(() => def.build({ x: 1, y: 2 }), '缺 selector 却没抛').toThrow(/selector/);
    expect(() => def.build({ x: NaN, y: 2, selector: 'div' }), 'NaN 被当成合法坐标').toThrow(/x/);
    expect(() => def.build({ x: '1', y: 2, selector: 'div' }), '字符串坐标被放行').toThrow(/x/);
    expect(() => def.build({ x: 1, y: 2, selector: '' }), '空 selector 被放行').toThrow(/selector/);
  });

  it('⭐ 保留原实现的两个阈值(本批是收口,不是调参)', () => {
    /**
     * ⚠️ 三家原实现写死的是同一组值(band=24 / maxDy=240)。
     * 收口时如实保留 —— 一旦顺手"优化",出了问题就分不清
     * 是收口带来的还是调参带来的。
     */
    const s = def.build({ x: 1, y: 2, selector: 'div' });
    expect(s).toContain('var BAND = 24;');
    expect(s).toContain('var MAXDY = 240;');
  });
});
