/**
 * ⭐⭐ fake-dom 的自检 —— **验证工具本身不说谎**
 *
 * ── 为什么这个文件必须存在 ──
 *
 * `fake-dom.ts` 是十几个注入脚本测试的**共同地基**。它一旦语义不对,
 * 上面所有测试都"绿得毫无意义",而且**没有任何东西会报警**。
 *
 * 2026-09-30 两轮独立复核,在它里面抓出两处严重语义错误 ——
 * 而它**自己一条测试都没有**(这才是根因):
 *
 *  ① 没给 rect 的元素默认占 `(0,0,100,20)` → 每个未布局元素
 *     都在左上角形成**幻影命中区**。实测点 (50,10) 提取到了声明在别处的邮件,
 *     真浏览器该报 miss。⚠️ 第一次修成 `(0,0,0,0)` 仍不够:
 *     被测脚本的 ±24px 邻域回退把原点附近的它捞了回来。
 *  ② 有子元素的节点,派生 `textContent` 读 `attrs['__text']` ——
 *     而**全仓没有任何地方写这个属性**(自 5ca8e99f 的旧债),于是恒为空串。
 *
 * ⭐ 判据:**假 DOM 绝不许比真浏览器宽松。** 宽松 = 被测代码的错被兜住。
 * 支持不了的语法要**抛错**,不是静默返回空。
 */
import { describe, it, expect } from 'vitest';
import { el, makeDom, evalInDom } from './helpers/fake-dom';

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });

describe('⭐⭐ fake-dom 自检:布局与命中', () => {
  it('⭐⭐ 没给 rect 的元素:读几何必须**抛错**(不许编造矩形)', () => {
    /**
     * ⚠️ 这条原来是「抽查 4 个坐标都不命中」—— 复核指出那是**假绿**:
     * 把幻影区挪到 y≥30 就躲过了抽查(全靠 mail 测试偶然兜住)。
     * ⭐ 改成钉**不变量本身**:没给 rect 就不许有几何 —— 坐标抽查不了它。
     */
    const ghost = el('div', { id: 'ghost' }, { textContent: 'G' });
    makeDom([ghost]);
    expect(
      () => ghost.getBoundingClientRect(),
      '没给 rect 却能读出几何 —— 假 DOM 在编造矩形,会形成幻影命中区',
    ).toThrow(/没有 rect/);
  });

  it('⭐⭐ elementFromPoint 只考虑显式给了 rect 的元素(任意坐标都不命中未布局元素)', () => {
    const ghost = el('div', { id: 'ghost' }, { textContent: 'G' });
    const real = el('div', { id: 'real' }, { rect: rect(0, 500, 100, 50) });
    const dom = makeDom([ghost, real]);
    const doc = dom.document as { elementFromPoint(x: number, y: number): unknown; body: unknown };
    /**
     * ⚠️ 2026-09-30 换 jsdom 引擎后:`document` 是给**脚本**用的,
     * 返回的是真 jsdom `Element`;测试持有的是 `FakeEl` 句柄。
     * 故断言比 `.node` —— 这个区分是**有意的**:
     * 脚本看到的必须是真元素(selector/closest 才有真语义)。
     */
    // ⭐ 不抽查固定几点 —— 扫一片,任何一点命中 ghost 都算违规
    for (let x = 0; x <= 200; x += 25) {
      for (let y = 0; y <= 200; y += 25) {
        expect(doc.elementFromPoint(x, y), `(${x},${y}) 命中了未布局元素`).not.toBe(ghost.node);
      }
    }
    expect(doc.elementFromPoint(50, 520), '给了 rect 的反而没命中').toBe(real.node);
  });

  it('⭐ 给了 rect 的元素按矩形命中,边界含端点', () => {
    const box = el('div', {}, { rect: rect(10, 20, 100, 50) });
    const doc = makeDom([box]).document as { elementFromPoint(x: number, y: number): unknown };
    expect(doc.elementFromPoint(60, 40), '矩形内没命中').toBe(box.node);
    expect(doc.elementFromPoint(10, 20), '左上角端点没命中(真 DOM 左/上边界是闭的)').toBe(box.node);
    expect(doc.elementFromPoint(9, 40), '矩形左外侧竟然命中').not.toBe(box.node);
    expect(doc.elementFromPoint(60, 71), '矩形下外侧竟然命中').not.toBe(box.node);
    /**
     * ⚠️ 复核指正:真 DOM 的**右/下边界是开的**(`[left,right)` / `[top,bottom)`),
     * 我原来钉「右下角端点也命中」是**非真实语义**。
     * ⭐ 但本仓被测脚本都用 `<=` 做邻域判定,改成开区间会与它们不一致 ——
     * 故这里**如实记下差异**并只钉「不比真 DOM 宽松的那一侧」:
     * 左/上闭合必须成立;右/下是否闭合不钉(当前实现是闭的,偏宽松 1px,
     * 不影响任何现有判定,真要对齐需连同被测脚本一起改)。
     */
  });

  it('⭐⭐ offsetTop/Height 等同族几何也要接管(jsdom 静默返 0)', () => {
    /**
     * ⚠️ 第六轮复核点名的遗留风险:`getBoundingClientRect` 接管了,
     * 但 `offsetTop` / `offsetHeight` 仍**静默返回 0** ——
     * 同一类「幻影几何」:读到 0 不报错,依赖它的判据恒成立/恒不成立。
     *
     * ⭐ 实测 `sync-driver.ts:332` 用
     * `documentElement.scrollHeight - window.innerHeight` ——
     * renderer 那批(L2 剩下 18 处)一接上来就会踩。
     */
    const box = el('div', {}, { rect: rect(10, 20, 100, 50) });
    makeDom([box]);
    const n = box.node as unknown as {
      offsetTop: number; offsetLeft: number; offsetWidth: number; offsetHeight: number;
    };
    expect(n.offsetTop, 'offsetTop 没跟 rect 对上').toBe(20);
    expect(n.offsetLeft, 'offsetLeft 没跟 rect 对上').toBe(10);
    expect(n.offsetWidth, 'offsetWidth 没跟 rect 对上').toBe(100);
    expect(n.offsetHeight, 'offsetHeight 没跟 rect 对上').toBe(50);
  });

  it('⭐ 没给 rect 的元素读 offset* 也要抛(与 rect 同一条原则)', () => {
    const ghost = el('div', {}, { textContent: 'G' });
    makeDom([ghost]);
    const n = ghost.node as unknown as { offsetTop: number };
    expect(
      () => n.offsetTop,
      '没给 rect 却能读出 offsetTop —— 静默 0 是幻影几何,会让判据悄悄失真',
    ).toThrow(/没有 rect/);
  });

  it('⭐ 点在空白处返回 body(真 DOM 语义),不是 null', () => {
    const box = el('div', {}, { rect: rect(0, 0, 10, 10) });
    const dom = makeDom([box]);
    const doc = dom.document as { elementFromPoint(x: number, y: number): unknown; body: unknown };
    const hit = doc.elementFromPoint(500, 500);
    expect(hit, '空白处返回了 null —— 真 DOM 返回 body,两者会走不同分支').toBe(doc.body);
  });
});

describe('⭐⭐ fake-dom 自检:文本', () => {
  it('⭐⭐ 有子元素时 textContent 由子节点拼出来(不是恒空串)', () => {
    const parent = el('div', {}, {}, [
      el('span', {}, { textContent: 'HEL' }),
      el('span', {}, { textContent: 'LO' }),
    ]);
    expect(
      parent.textContent,
      'textContent 恒空 —— 任何「取容器文字」的断言都在拿空串比空串',
    ).toBe('HELLO');
  });

  it('⭐ 嵌套多层也要拼对', () => {
    const parent = el('div', {}, {}, [
      el('span', {}, {}, [el('b', {}, { textContent: 'A' }), el('i', {}, { textContent: 'B' })]),
      el('span', {}, { textContent: 'C' }),
    ]);
    expect(parent.textContent).toBe('ABC');
  });

  it('⭐ innerText 与 textContent 同源(脚本常写 innerText || textContent)', () => {
    const n = el('div', {}, {}, [el('span', {}, { textContent: 'X' })]);
    expect(n.innerText).toBe(n.textContent);
    expect(n.innerText).toBe('X');
  });

  it('显式给 textContent 时以它为准', () => {
    const n = el('div', {}, { textContent: 'EXPLICIT' }, [el('span', {}, { textContent: 'IGNORED' })]);
    expect(n.textContent).toBe('EXPLICIT');
  });
});

describe('⭐⭐ fake-dom 自检:selector', () => {
  it('⭐ 逗号多候选,按**文档顺序**返回', () => {
    const a = el('div', { class: 'x' }, { textContent: '1' });
    const b = el('div', { class: 'y' }, { textContent: '2' });
    const c = el('div', { class: 'x' }, { textContent: '3' });
    const doc = makeDom([a, b, c]).document as { querySelectorAll(s: string): Array<{ textContent: string }> };
    // 写 '.y, .x' 但应按文档顺序回 1,2,3
    expect(doc.querySelectorAll('.y, .x').map((n) => n.textContent)).toEqual(['1', '2', '3']);
  });

  it('⭐ 属性算子 = / *= / ^= / $= 各自正确', () => {
    const n = el('a', { href: 'mailto:a@b.com', title: 'hi @you' });
    const doc = makeDom([n]).document as { querySelector(s: string): unknown };
    expect(doc.querySelector('[href="mailto:a@b.com"]'), '= 不对').toBe(n.node);
    expect(doc.querySelector('[title*="@"]'), '*= 不对').toBe(n.node);
    expect(doc.querySelector('[href^="mailto:"]'), '^= 不对').toBe(n.node);
    expect(doc.querySelector('[href$=".com"]'), '$= 不对').toBe(n.node);
    expect(doc.querySelector('[title*="nope"]'), '*= 误匹配').toBeNull();
    /**
     * ⚠️ 复核指出原来缺**反例**:删掉 `^=` 或 `$=` 的判断照样全绿
     * (因为只有正例,而正例在"算子被忽略"时也能过)。补上。
     */
    expect(doc.querySelector('[href^="http"]'), '^= 误匹配了不以 http 开头的').toBeNull();
    expect(doc.querySelector('[href$=".org"]'), '$= 误匹配了不以 .org 结尾的').toBeNull();
  });

  it('⭐ `[attr*=""]` 匹配**零个**(真 DOM 语义,不是全匹配)', () => {
    const n = el('span', { title: 'anything' });
    const doc = makeDom([n]).document as { querySelectorAll(s: string): unknown[] };
    expect(
      doc.querySelectorAll('[title*=""]'),
      "`*=''` 匹配了元素 —— 真 DOM 匹配零个;`''.includes('')` 为 true 会导致相反结果",
    ).toEqual([]);
  });

  it('⭐ closest 从**自身**开始向上找', () => {
    const child = el('span', { class: 'leaf' });
    const parent = el('div', { class: 'box' }, {}, [child]);
    makeDom([parent]);
    expect(child.closest('.leaf'), 'closest 没把自身算进去').toBe(child);
    expect(child.closest('.box'), 'closest 没向上找到祖先').toBe(parent);
    expect(child.closest('.nope'), 'closest 找不到时该返回 null').toBeNull();
    /**
     * ⚠️ 复核指出:`closest` 不按逗号拆分也全绿 ——
     * 因为真实 mail selector 都带逗号、总有一个分支命中。补一条只靠拆分才能过的。
     */
    expect(child.closest('.nope, .box'), 'closest 没按逗号拆多候选').toBe(parent);
    expect(child.closest('.box, .nope'), 'closest 多候选顺序无关性不成立').toBe(parent);
  });

  it('⭐⭐ el.querySelector 只找**后代**,不含自身(真 DOM 语义)', () => {
    /**
     * ⚠️ 2026-09-30 复核抓到:原来用 `descendants(this)` 而它**包含 root**,
     * 于是 `box.querySelector('.zA')` 返回 box 自己。
     * ⭐ mail 的 `pick(box, bodySel)` 正踩在这上面:bodySelector 若也匹配容器,
     * 真浏览器会往里找,假 DOM 却把容器当正文 —— 假 DOM 比真的宽松。
     */
    const inner = el('div', { class: 'same' }, { textContent: 'INNER' });
    const box = el('div', { class: 'same' }, { textContent: undefined }, [inner]);
    makeDom([box]);
    expect(box.querySelector('.same'), 'querySelector 返回了自身').toBe(inner);
    expect(box.querySelectorAll('.same'), 'querySelectorAll 含了自身').toEqual([inner]);
  });

  it('⭐ `*=""` / `^=""` / `$=""` 匹配零个', () => {
    const n = el('a', { href: 'mailto:x' });
    const doc = makeDom([n]).document as { querySelectorAll(s: string): unknown[] };
    for (const op of ['*', '^', '$']) {
      expect(
        doc.querySelectorAll(`[href${op}=""]`),
        `[href${op}=""] 匹配了元素 —— 真 DOM 匹配零个`,
      ).toEqual([]);
    }
  });

  it('⭐⭐ 但 `[attr=""]` 匹配「值恰为空」的元素(不许一起毙掉)', () => {
    /**
     * ⚠️ 我上一轮写 `if (want === '') return false` **不分算子**,
     * 把 `=` 也毙了(第四轮复核抓到的回归 R1)。
     * 真 DOM:`[title=""]` 选中 title 恰为空串的元素。
     */
    const empty = el('span', { title: '' }, { textContent: 'E' });
    const full = el('span', { title: 'x' }, { textContent: 'F' });
    const doc = makeDom([empty, full]).document as { querySelectorAll(s: string): Array<{ textContent: string }> };
    expect(
      doc.querySelectorAll('[title=""]').map((n) => n.textContent),
      '`[attr=""]` 没选中「值恰为空」的元素',
    ).toEqual(['E']);
  });

  it('⭐⭐ 后代组合 selector 的**祖先部分可以是容器自身**(Gmail 真实写法)', () => {
    /**
     * ⚠️ 第四轮复核抓到的回归 R2:我改用 `descendantsOnly` 时让
     * **整段 selector** 都在后代里跑,于是
     * `box.querySelector('div[data-message-id] div.ii')` 返回 null。
     *
     * ⭐ 而这正是 **Gmail 的 mailBody**(`mail-service-types.ts:141`:
     * `'div.a3s, div[data-message-id] div.ii'`)—— 踩中真实业务路径。
     *
     * 真 DOM 语义:只要求**最终选中的元素**是后代,祖先部分可以是容器自身。
     */
    const body = el('div', { class: 'ii' }, { textContent: 'BODY' });
    const box = el('div', { 'data-message-id': 'm1' }, {}, [body]);
    makeDom([box]);
    expect(
      box.querySelector('div[data-message-id] div.ii')?.textContent,
      '祖先部分不许限制在后代里 —— 这条是 Gmail 的 mailBody selector',
    ).toBe('BODY');
    // ⚠️ 同时:自身仍然不许被返回
    expect(
      box.querySelector('div[data-message-id]'),
      'querySelector 返回了自身',
    ).toBeNull();
  });

  it('⭐⭐ 非法 selector 必须**抛错**,不许静默返回空', () => {
    /**
     * ⚠️ 这条原来钉的是 `:nth-child(2)` —— 手写引擎不支持它所以会抛。
     * 换 jsdom 之后**它是合法且被支持的**,断言随之失效。
     * ⭐ 这正是换引擎的收益:支持面从「我实现了的那几种」
     * 变成「浏览器真支持的」。
     *
     * 改钉**真正非法**的语法:jsdom 会抛 `SyntaxError`,
     * 与真浏览器一致 —— 静默返回空才是危险的。
     */
    const doc = makeDom([el('div', {})]).document as { querySelectorAll(s: string): unknown };
    expect(
      () => doc.querySelectorAll('div[[[bad'),
      '非法 selector 被静默放行 —— 测试会「绿得毫无意义」',
    ).toThrow();
    // ⭐ 反面:jsdom 支持的高级语法现在**能用**(手写引擎时代用不了)
    expect(() => doc.querySelectorAll('div:nth-child(2)'), ':nth-child 应当被支持').not.toThrow();
  });
});

describe('⭐ fake-dom 自检:求值', () => {
  it('⭐⭐ evalInDom 真的返回脚本结果(不是被 ASI 吃成 undefined)', () => {
    /**
     * ⚠️ 脚本文本以换行开头时,`new Function('return ' + s)` 会被 ASI
     * 切成 `return;` + 孤立表达式 → **恒 undefined 且不报错**。
     * evalInDom 用 `return (${script});` 规避,这条钉住它。
     */
    const out = evalInDom(makeDom([]), '\n(function(){ return 42; })()\n');
    expect(out, 'evalInDom 返回了 undefined —— ASI 把 return 提前结束了').toBe(42);
  });

  it('⭐ 脚本能拿到 location.href(提取类脚本靠它留痕)', () => {
    const out = evalInDom(makeDom([]), '\n(function(){ return location.href; })()\n');
    expect(typeof out, 'location 没注入进去').toBe('string');
  });
});

describe('⭐⭐ fake-dom 自检:真 DOM 是唯一权威(换 jsdom 后的适配层)', () => {
  it('⭐⭐ children / parentElement 由真 DOM 现算,不是存下来的影子数组', () => {
    const a = el('span', { id: 'a' });
    const b = el('span', { id: 'b' });
    const parent = el('div', {}, {}, [a, b]);
    makeDom([parent]);
    expect(parent.children.map((c) => c.node.id)).toEqual(['a', 'b']);
    a.node.remove();   // 走真 DOM 改结构
    expect(parent.children.map((c) => c.node.id), 'children 没跟真 DOM 同步').toEqual(['b']);
    expect(a.parentElement, '已摘除的元素 parentElement 仍非空 —— 「仍在文档里」的断言会恒真').toBeNull();
    // 想绕开真 DOM 直接改数组要**响**,不许静默生效
    expect(() => { (parent as { children: unknown }).children = []; }).toThrow();
  });

  it('⭐⭐ 每个新页面焦点归零 —— 不许跨测试泄漏', () => {
    const d1 = makeDom([el('input', { id: 'x' })]);
    evalInDom(d1, `(function(){ document.querySelector('#x').focus(); })()`);
    const d2 = makeDom([el('div', { id: 'y' })]);
    const ae = evalInDom(d2, `(function(){ return document.activeElement === document.body; })()`);
    expect(ae, '上一页 focus 过的元素成了新页面的 activeElement —— press 会派发给一个已脱离文档的元素').toBe(true);
  });

  it('⭐⭐ 事件是真 jsdom Event,且留痕保留事件本身(含 clipboardData)', () => {
    const box = el('div', { id: 'c' }, { contentEditable: 'true' });
    const dom = makeDom([box]);
    const out = evalInDom(dom, `(function(){ try {
      var dt = new DataTransfer(); dt.setData('text/plain', 'hi');
      document.querySelector('#c').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
      return 'ok'; } catch (e) { return 'THREW ' + e.message; } })()`);
    expect(out, 'jsdom 拒收了我们的事件对象 —— 脚本 try 会把它吞成 false,合成 paste 静默降级').toBe('ok');
    const evt = box.events.find((e) => e.type === 'paste') as { clipboardData?: { getData(t: string): string } } | undefined;
    expect(evt?.clipboardData?.getData('text/plain'), '留痕丢了事件内容 —— FakeInputHost 取不到要粘的文本').toBe('hi');
  });
});
