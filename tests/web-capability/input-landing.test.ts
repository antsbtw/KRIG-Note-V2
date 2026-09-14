/**
 * ⭐ `web.input` 落地确认与三态契约(`01-contract.md` §10.2 / `02-testing.md` §2.4)
 *
 * ── 本层的失败形态是「看着成功实际没做」──
 * `02-testing.md` §3.5.3 写得很直白:**面板说成功 + 屏幕上框是空的**
 * ——「这正是历史上那个 bug 的形态:日志说注入成功,右栏框是空的」。
 * 所以这里的每条断言都要能回答一句:
 * **「如果被测逻辑是错的,这条断言还会成立吗?」**
 */
import { describe, it, expect } from 'vitest';
import { InputEngine, type LandingReport } from '@platform/main/web-capability/input';
import { isFailed, isOk } from '@platform/main/web-capability';
import { makeDom, el, type FakeEl } from './helpers/fake-dom';
import { FakeInputHost, MapAnchorResolver, PAGE } from './helpers/fake-input-host';

const ANCHORS = {
  composeBox: '#compose',
  titleInput: '#title',
  fileInput: '#file',
  thumb: '.thumb',
  modalMarker: '.modal-close',
  publishButton: '#publish',
};

/** 造一个「有个 contenteditable 输入框」的页面 */
function scene(opts: { editable?: boolean } = {}) {
  const box: FakeEl = opts.editable === false
    ? el('textarea', { id: 'compose' }, { value: '' })
    : el('div', { id: 'compose' }, { textContent: '', contentEditable: 'true' });
  const dom = makeDom([box]);
  const host = new FakeInputHost(dom, box);
  const engine = new InputEngine(host, new MapAnchorResolver(ANCHORS));
  return { dom, box, host, engine };
}

function report(r: unknown): LandingReport {
  if (!isOk(r as never)) throw new Error(`期望 Ok,实际 ${JSON.stringify(r)}`);
  return (r as { value: LandingReport }).value;
}

describe('⭐ 落地失败要报失败 —— 不返回 Ok(`02-testing.md` §2.4 #1)', () => {
  it('⭐ 喂不存在的锚点 → Failed,**不返回 Ok**', async () => {
    const { engine } = scene();
    const r = await engine.type(PAGE, {
      anchor: 'noSuchAnchor',
      text: '你好',
      check: { kind: 'contains', fragment: '你好' },
    });
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toContain('noSuchAnchor');
    // ⚠️ 关键:不是 Ok(landed:false)。当 Ok 会让调用方接着往下走(点发布 / 标已回复)
    expect(r.status).not.toBe('ok');
    // ⭐⭐ 且必须失败在**「锚点没登记」**这一步,不是「查了个空 selector 没找到元素」。
    //    两者都表现为 Failed,但只有前者说得清「adapter 漏登记了」。
    //    ⚠️ 这条是注入实验补的:注入「锚点解释不出来就拿锚点名当 selector」时,
    //    上面几条**一条没红** —— 断言成立的原因不是被测逻辑,而是「元素恰好也不存在」。
    expect(r.reason, '必须指出是锚点没登记,不能混成「元素没找到」').toContain('无法解释成 selector');
  });

  it('⭐⭐ 锚点没登记 ≠ 元素不在页面上 —— 两种失败必须可区分', async () => {
    // 这两条路径都返回 Failed,但成因完全不同、处置也不同:
    //   - 锚点没登记 → adapter 的活,改锚点表(不可重试)
    //   - 元素不在页面 → 页面状态问题,等一等再来(可重试)
    // 混成一个原因,排查时就得靠猜。
    const { engine } = scene();
    const unregistered = await engine.tap(PAGE, { anchor: 'noSuchAnchor' });
    const notOnPage = await engine.tap(PAGE, { anchor: 'titleInput' }); // 表里有,页面上没有
    if (!isFailed(unregistered) || !isFailed(notOnPage)) throw new Error('两者都应失败');
    expect(unregistered.reason).toContain('无法解释成 selector');
    expect(notOnPage.reason).not.toContain('无法解释成 selector');
    // 可重试性也不同 —— 这是调用方唯一能自动分流的信号
    expect(unregistered.retryable).toBe(false);
    expect(notOnPage.retryable).toBe(true);
  });

  it('⭐ 锚点在表里但页面上没有 → Failed(不是「成功地什么也没填」)', async () => {
    const { engine } = scene();
    const r = await engine.type(PAGE, {
      anchor: 'titleInput', // 表里有,但这个页面没渲染出来
      text: '标题',
      check: { kind: 'contains', fragment: '标题' },
    });
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toMatch(/未找到|无法 focus/);
  });

  it('⭐⭐ 三级路径都没落地 → Failed(内容确实没进框)', async () => {
    const { engine, host, box } = scene();
    // 站点改版形态:paste handler 没了、OS 粘贴打不进 webview、直写也被框拒收
    host.syntheticPasteWorks = false;
    host.osPasteWorks = false;
    // contenteditable 走 execCommand,fake DOM 的 execCommand 不写内容 → 校验必失败
    const r = await engine.type(PAGE, {
      anchor: 'composeBox',
      text: '这条推文',
      check: { kind: 'contains', fragment: '这条推文' },
    });
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toContain('未落进');
    // 自检:框**真的**是空的 —— 断言的不是「引擎说失败」,是「事实上没填进去」
    expect(box.textContent).toBe('');
  });

  it('⭐ 三级都试过了才报失败(attempts 反映在原因里,不是第一级就放弃)', async () => {
    const { engine, host } = scene();
    host.syntheticPasteWorks = false;
    host.osPasteWorks = false;
    const r = await engine.type(PAGE, {
      anchor: 'composeBox',
      text: 'abc',
      check: { kind: 'contains', fragment: 'abc' },
    });
    if (!isFailed(r)) throw new Error('应失败');
    expect(r.reason).toContain('3');
    expect(host.osPasteCalls).toBe(1); // OS 兜底真的试过了
  });
});

describe('⭐ via 如实反映走的路径(§10.2 —— 出问题时的第一条线索)', () => {
  it('⭐ 主路径成功 → via = synthetic-paste,attempts = 1', async () => {
    const { engine, box } = scene();
    const r = await engine.type(PAGE, {
      anchor: 'composeBox',
      text: '主路径文本',
      check: { kind: 'contains', fragment: '主路径文本' },
    });
    const rep = report(r);
    expect(rep.via).toBe('synthetic-paste');
    expect(rep.attempts).toBe(1);
    expect(rep.landed).toBe(true);
    expect(rep.checked).toBe(true);
    // 自检:内容真进框了(不是引擎自说自话)
    expect(box.textContent).toBe('主路径文本');
  });

  it('⭐⭐ 主路径失效 → via 变成兜底路径名,attempts 增加', async () => {
    // 这是「填错格式」和「主路径失效降级了」的区分点 ——
    // 两者都表现为「内容进去了」,但一个要改 adapter,一个说明站点改版了
    const { engine, host } = scene();
    host.syntheticPasteWorks = false; // 站点的 paste handler 没了
    const r = await engine.type(PAGE, {
      anchor: 'composeBox',
      text: '降级文本',
      check: { kind: 'contains', fragment: '降级文本' },
    });
    const rep = report(r);
    expect(rep.via).toBe('os-paste');
    expect(rep.attempts).toBe(2);
    expect(rep.landed).toBe(true);
    // ⚠️ 若 via 恒为 synthetic-paste,这条会红 —— 那正是没有 via 时的现状
    expect(rep.via).not.toBe('synthetic-paste');
  });

  it('⭐ 走到第三级 JS 直写 → via 区分 native-setter / exec-command', async () => {
    // textarea 走 native value setter
    const { engine, host } = scene({ editable: false });
    host.syntheticPasteWorks = false;
    host.osPasteWorks = false;
    const r = await engine.type(PAGE, {
      anchor: 'composeBox',
      text: 'textarea 文本',
      check: { kind: 'contains', fragment: 'textarea 文本' },
    });
    const rep = report(r);
    expect(rep.via).toBe('native-setter');
    expect(rep.attempts).toBe(3);
  });

  it('via 只有契约里那几个值(不许冒出个自造的)', async () => {
    const allowed = ['synthetic-paste', 'exec-command', 'native-setter', 'os-paste', 'unchecked'];
    const { engine } = scene();
    const r = await engine.type(PAGE, {
      anchor: 'composeBox',
      text: 'x',
      check: { kind: 'contains', fragment: 'x' },
    });
    expect(allowed).toContain(report(r).via);
  });
});

describe('⭐ check:none 必须显式,且不谎称 landed(§10.2)', () => {
  it('⭐⭐ check:{kind:none} → checked:false 且 landed:false', async () => {
    const { engine } = scene();
    const r = await engine.type(PAGE, {
      anchor: 'composeBox',
      text: '不校验的文本',
      check: { kind: 'none' },
    });
    const rep = report(r);
    expect(rep.checked).toBe(false);
    // ⚠️⭐ 这是本条的命脉:「没看」不能说成「成了」。
    //    landed:true 会让调用方以为已确认,而实际上一次校验都没跑
    expect(rep.landed).toBe(false);
    expect(rep.via).toBe('unchecked');
  });

  it('⭐ check:none 时即使内容真进去了也仍报 landed:false', async () => {
    // 这条把「顺带遮出来」的可能性堵死:内容确实落地了,但因为没校验,
    // 契约要求仍如实说「没确认」。若实现偷看一眼框就改成 landed:true,这条会红。
    const { engine, box } = scene();
    const r = await engine.type(PAGE, {
      anchor: 'composeBox',
      text: '确实进去了',
      check: { kind: 'none' },
    });
    expect(box.textContent).toBe('确实进去了'); // 事实:进去了
    expect(report(r).landed).toBe(false); // 契约:没校验就不许说成了
  });

  it('check 是必填字段 —— 省略在类型层面就过不去', () => {
    // 「不校验」必须是明确的选择,不能是省略参数的默认(省略的人可能只是忘了)。
    // 这条靠 tsc 保证;这里用源码断言钉住,防止将来有人给 check 加 `?`。
    const fs = require('node:fs') as typeof import('node:fs');
    const src = fs.readFileSync('src/platform/main/web-capability/input/types.ts', 'utf-8');
    expect(src).toMatch(/readonly check: LandingCheck;/);
    expect(src, 'check 不许变成可选 —— 省略参数的人可能只是忘了').not.toMatch(/readonly check\?: /);
  });
});

describe('⭐ 三态契约:失败返回 Failed,不返回空值假装成功', () => {
  it('脚本执行抛错 → Failed(retryable),不是安静返回', async () => {
    const { engine, host } = scene();
    host.evaluateThrows = '页面已销毁';
    const r = await engine.type(PAGE, {
      anchor: 'composeBox',
      text: 'x',
      check: { kind: 'contains', fragment: 'x' },
    });
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toContain('页面已销毁');
    expect(r.retryable).toBe(true);
  });

  it('六个动作全都返回三态之一(没有 null / undefined / 裸 boolean)', async () => {
    const { engine } = scene();
    const results = [
      await engine.focus(PAGE, { anchor: 'composeBox' }),
      await engine.type(PAGE, { anchor: 'composeBox', text: 'a', check: { kind: 'none' } }),
      await engine.tap(PAGE, { anchor: 'composeBox' }),
      await engine.press(PAGE, { key: 'Escape' }),
      await engine.hover(PAGE, { anchor: 'composeBox' }),
      await engine.feed(PAGE, { anchor: 'fileInput', files: [], check: { kind: 'none' } }),
    ];
    for (const r of results) {
      expect(['ok', 'failed', 'degraded']).toContain((r as { status: string }).status);
    }
  });

  it('Failed 的 reason 永不为空(空原因等于没说失败)', async () => {
    const { engine } = scene();
    const r = await engine.feed(PAGE, { anchor: 'fileInput', files: [], check: { kind: 'none' } });
    if (!isFailed(r)) throw new Error('空文件列表应失败');
    expect(r.reason.trim().length).toBeGreaterThan(0);
  });
});
