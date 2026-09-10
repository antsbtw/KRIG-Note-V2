/**
 * ⭐ `web.input` 作用域 —— 本层的核心新增(`01-contract.md` §10.1)
 *
 * ── 要治的病 ──
 * 没有作用域,`type` 只能「往页面上第一个匹配的框填」。
 * X 长文是「点 Insert → 弹菜单 → 点项 → **弹模态** → 往模态里填 → 点 Update → 等模态关闭」,
 * **模态叠模态时会填错地方**。
 *
 * ⚠️ 本文件用**真 DOM 求值**跑注入脚本(不是 mock 一个假 querySelector):
 * `01-contract.md` 那次转义事故的教训是「源码对、求值后错」——
 * 只有真求值才覆盖得到。做法:用 `new Function` 在一个手搓的最小 DOM 上求值,
 * 这样脚本里的 `querySelectorAll` / `indexOf` 等逻辑都真的跑了一遍。
 */
import { describe, it, expect } from 'vitest';
import {
  SCOPE_AMBIGUOUS,
  SCOPE_NOT_FOUND,
  buildAnchorExistsScript,
  buildContainsScript,
  buildFocusScript,
} from '@platform/main/web-capability/input';
import { InputEngine } from '@platform/main/web-capability/input';
import { isFailed, isOk } from '@platform/main/web-capability';
import { makeDom, evalInDom, el } from './helpers/fake-dom';
import { FakeInputHost, MapAnchorResolver, PAGE } from './helpers/fake-input-host';

describe('⭐ 作用域生效 —— 两个同名锚点分别在两个容器内,within 精确命中', () => {
  /**
   * 场景就是 X 长文那个:页面上有**两个** `.modal`,各含一个 `.box` 输入框。
   * 没有作用域时 `document.querySelector('.box')` 恒命中第一个。
   */
  function twoModals() {
    const boxA = el('div', { class: 'box' }, { textContent: 'AAA' });
    const boxB = el('div', { class: 'box' }, { textContent: 'BBB' });
    const modalA = el('div', { class: 'modal', id: 'a' }, {}, [boxA]);
    const modalB = el('div', { class: 'modal', id: 'b' }, {}, [boxB]);
    return { dom: makeDom([modalA, modalB]), boxA, boxB };
  }

  it('⭐ within 命中目标容器内的框,**不串到另一个容器**', () => {
    const { dom, boxA, boxB } = twoModals();
    // 往 #b 里的 box 查内容 'BBB' —— 若作用域没生效会查到 #a 的 'AAA'
    const script = buildContainsScript('.box', 'BBB', '#b .modal, #b');
    expect(evalInDom(dom, script)).toBe(true);

    // 反向:在 #a 作用域内查 'BBB' 必须查不到 —— 这条才证明它真的**限制**了范围
    const scriptA = buildContainsScript('.box', 'BBB', '#a');
    expect(evalInDom(dom, scriptA)).toBe(false);

    // 自检:两个框的内容确实不同(否则上面两条对「串不串」零区分力)
    expect(boxA.textContent).not.toBe(boxB.textContent);
  });

  it('⭐ main 作用域下确实会命中第一个 —— 这正是不用作用域的危险', () => {
    // 这条不是「期望的好行为」,是**把危险钉在测试里**:
    // 它证明「不给作用域 = 填进第一个框」,从而证明 within 不是多余的。
    const { dom } = twoModals();
    expect(evalInDom(dom, buildContainsScript('.box', 'AAA', ''))).toBe(true);
    expect(evalInDom(dom, buildContainsScript('.box', 'BBB', ''))).toBe(false);
  });

  it('容器内没有该锚点时返回 false(不是往外找)', () => {
    const boxA = el('div', { class: 'box' }, { textContent: 'AAA' });
    const modalA = el('div', { class: 'modal', id: 'a' }, {}, [boxA]);
    const other = el('div', { class: 'other', id: 'b' }, {}, []);
    const dom = makeDom([modalA, other]);
    // #b 里没有 .box —— 绝不许爬出容器去找 #a 里的那个
    expect(evalInDom(dom, buildAnchorExistsScript('.box', '#b'))).toBe(false);
    expect(evalInDom(dom, buildAnchorExistsScript('.box', '#a'))).toBe(true);
  });
});

describe('⭐ ambiguous 必须报错,不许挑第一个(与 web.page 的 find 同源)', () => {
  it('⭐ 容器锚点命中多个 → 返回 AMBIGUOUS 标记,**不返回某个元素的结果**', () => {
    const boxA = el('div', { class: 'box' }, { textContent: 'AAA' });
    const boxB = el('div', { class: 'box' }, { textContent: 'BBB' });
    const dom = makeDom([
      el('div', { class: 'modal' }, {}, [boxA]),
      el('div', { class: 'modal' }, {}, [boxB]),
    ]);
    // 容器 selector `.modal` 命中两个 —— 底座不替调用方挑
    const r = evalInDom(dom, buildContainsScript('.box', 'AAA', '.modal'));
    expect(r).toBe(SCOPE_AMBIGUOUS);
    // ⚠️ 关键:**不是** true。若挑了第一个,这里会是 true 而调用方毫不知情
    expect(r).not.toBe(true);
  });

  it('多候选 selector 各命中一个也算 ambiguous(去重后 > 1)', () => {
    const dom = makeDom([
      el('div', { class: 'left' }, {}, [el('div', { class: 'box' }, { textContent: 'A' })]),
      el('div', { class: 'right' }, {}, [el('div', { class: 'box' }, { textContent: 'B' })]),
    ]);
    expect(evalInDom(dom, buildAnchorExistsScript('.box', '.left, .right'))).toBe(SCOPE_AMBIGUOUS);
  });

  it('同一元素被多个候选 selector 命中**不算** ambiguous(去重生效)', () => {
    // 否则 adapter 写多候选 selector 做容错,反而会被误判成歧义 —— 那会让 within 不可用
    const box = el('div', { class: 'box' }, { textContent: 'A' });
    const modal = el('div', { class: 'modal dialog', id: 'm' }, {}, [box]);
    const dom = makeDom([modal]);
    expect(evalInDom(dom, buildAnchorExistsScript('.box', '.modal, .dialog, #m'))).toBe(true);
  });

  it('容器不存在 → NOT_FOUND 标记(与 ambiguous 区分开)', () => {
    const dom = makeDom([el('div', { class: 'box' }, { textContent: 'A' })]);
    const r = evalInDom(dom, buildAnchorExistsScript('.box', '.no-such-modal'));
    expect(r).toBe(SCOPE_NOT_FOUND);
    // 两种失败必须可区分:「容器没了」可重试,「歧义」要改锚点 —— 混成一个就无从下手
    expect(r).not.toBe(SCOPE_AMBIGUOUS);
  });
});

describe('作用域对每个动作脚本都生效(不是只在某一个上做了)', () => {
  it('focus / exists / contains 三个脚本都带作用域解析', () => {
    const dom = makeDom([
      el('div', { id: 'a' }, {}, [el('input', { class: 'box' }, { value: 'AAA' })]),
      el('div', { id: 'b' }, {}, [el('input', { class: 'box' }, { value: 'BBB' })]),
    ]);
    // 每个脚本在 #b 作用域内都只看得见 BBB
    expect(evalInDom(dom, buildFocusScript('.box', '#b'))).toBe(true);
    expect(evalInDom(dom, buildContainsScript('.box', 'BBB', '#b'))).toBe(true);
    expect(evalInDom(dom, buildContainsScript('.box', 'AAA', '#b'))).toBe(false);
  });
});


/**
 * ⭐⭐ 引擎层的作用域契约 —— 光测脚本不够
 *
 * ⚠️ 这一组是**注入实验补的**:上面那些用例只在**脚本层**验证
 * 「返回 AMBIGUOUS 标记」。注入「引擎不再翻译这个标记」时,**一条都没红** ——
 * 标记串是个 truthy 值,会被当成「成功」一路放行。
 *
 * 教训与 `02-testing.md` §0.1 同源:**抽象层被掏空仍全绿 = 假保证**。
 * 脚本产出正确的信号,不等于有人在听。
 */
describe('⭐⭐ 引擎必须把作用域失败翻成三态 Failed(不是让标记串蒙混过关)', () => {
  const ANCHORS = { box: '.box', modal: '.modal', ghost: '.no-such-thing' };

  function twoModalEngine() {
    const dom = makeDom([
      el('div', { class: 'modal' }, {}, [el('div', { class: 'box' }, { textContent: 'A', contentEditable: 'true' })]),
      el('div', { class: 'modal' }, {}, [el('div', { class: 'box' }, { textContent: 'B', contentEditable: 'true' })]),
    ]);
    return new InputEngine(new FakeInputHost(dom), new MapAnchorResolver(ANCHORS));
  }

  it('⭐⭐ within 容器命中多个 → Failed,且原因说明「不替调用方挑」', async () => {
    const engine = twoModalEngine();
    const r = await engine.tap(PAGE, { anchor: 'box', scope: { kind: 'within', container: 'modal' } });
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toContain('命中多个');
    expect(r.reason).toContain('不替调用方挑');
    expect(r.retryable, '歧义要改锚点,重试没有意义').toBe(false);
  });

  it('⭐⭐ 容器不存在 → Failed(retryable),与歧义可区分', async () => {
    const engine = twoModalEngine();
    const r = await engine.tap(PAGE, { anchor: 'box', scope: { kind: 'within', container: 'ghost' } });
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toContain('不存在');
    expect(r.reason, '两种失败必须可区分').not.toContain('命中多个');
    expect(r.retryable, '容器还没渲染出来 —— 等一等可能就有了').toBe(true);
  });

  it('⭐ 六个动作全都会翻译作用域失败(不是只在某一个上做了)', async () => {
    const engine = twoModalEngine();
    const ambiguous = { kind: 'within', container: 'modal' } as const;
    const results = [
      await engine.focus(PAGE, { anchor: 'box', scope: ambiguous }),
      await engine.type(PAGE, { anchor: 'box', text: 'x', scope: ambiguous, check: { kind: 'contains', fragment: 'x' } }),
      await engine.tap(PAGE, { anchor: 'box', scope: ambiguous }),
      await engine.press(PAGE, { key: 'Escape', scope: ambiguous }),
      await engine.hover(PAGE, { anchor: 'box', scope: ambiguous }),
    ];
    for (const [i, r] of results.entries()) {
      expect(isFailed(r), `第 ${i} 个动作放过了 ambiguous`).toBe(true);
    }
  });

  it('⭐ 唯一命中的容器则正常工作(证明上面的失败不是「within 一律失败」)', async () => {
    // ⚠️ 反向锁:若 within 干脆恒失败,上面三条也会绿 —— 那是另一种假保证
    const box = el('div', { class: 'box' }, { textContent: 'A' });
    const dom = makeDom([el('div', { class: 'modal' }, {}, [box])]);
    const engine = new InputEngine(new FakeInputHost(dom), new MapAnchorResolver(ANCHORS));
    const r = await engine.tap(PAGE, { anchor: 'box', scope: { kind: 'within', container: 'modal' } });
    expect(isOk(r)).toBe(true);
    expect(box.clicked).toBe(1);
  });
});
