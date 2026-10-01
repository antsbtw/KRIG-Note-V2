/**
 * ⭐ `web.input` 的动作:tap / settle / feed / press / hover(`01-contract.md` §10.3)
 *
 * 两条核心:
 *  1. 🚦 **`tap` 是中立原语** —— 不分等级、不设危险词表、**不拒绝任何目标**。
 *     发布闸门(§7.1)是**业务层**的事(`tests/x/reply-planner-guards.test.ts` 守的就是那层)。
 *  2. ⭐ **`settle`** 把「点完等什么」放进模型 ——
 *     某 step 中途失败(模态没关)→ 下一 step 在**脏态**上启动 → 连环失败。
 */
import { describe, it, expect } from 'vitest';
import { InputEngine } from '@platform/main/web-capability/input';
import { isDegraded, isFailed, isOk } from '@platform/main/web-capability';
import { makeDom, el, type FakeEl } from './helpers/fake-dom';
import { FakeInputHost, MapAnchorResolver, PAGE } from './helpers/fake-input-host';

const ANCHORS = {
  composeBox: '#compose',
  fileInput: '#file',
  thumb: '.thumb',
  modalMarker: '.modal-close',
  updateButton: '#update',
  /** 🚦 故意登记一个「发布按钮」—— 底座对它必须一视同仁 */
  publishButton: '#publish',
};

describe('🚦 tap 对任何锚点都不拒绝 —— 底座中立(§10.3)', () => {
  it('⭐⭐ 故意传「发布按钮」锚点,tap 应正常执行(不拒绝、不降级、不警告)', () => {
    // 证据(§10.3):同一个「发送按钮」,AI **必须**自动点(问答语义),
    // X **绝不能**点(发布不可撤回)。差别在**业务语义**,不在按钮本身 ——
    // 底座无从判断,故一律执行。闸门在业务层。
    const publish = el('button', { id: 'publish' }, { textContent: 'Publish' });
    const dom = makeDom([publish]);
    const engine = new InputEngine(new FakeInputHost(dom), new MapAnchorResolver(ANCHORS));
    return engine.tap(PAGE, { anchor: 'publishButton' }).then((r) => {
      expect(isOk(r)).toBe(true);
      // 真的点了 —— 不是「返回 Ok 但其实没点」
      expect(publish.clicked).toBe(1);
    });
  });

  it('🚦 中文「发布」、Post、Tweet 等词一律不拦', async () => {
    const words = ['发布', 'Publish', 'Post', 'Tweet', '发推'];
    for (const w of words) {
      const btn = el('button', { id: 'publish', 'aria-label': w }, { textContent: w });
      const dom = makeDom([btn]);
      const engine = new InputEngine(new FakeInputHost(dom), new MapAnchorResolver(ANCHORS));
      const r = await engine.tap(PAGE, { anchor: 'publishButton' });
      expect(isOk(r), `底座不许对「${w}」区别对待`).toBe(true);
      expect(btn.clicked, `「${w}」应真的被点到`).toBe(1);
    }
  });

  it('⭐ 源码里零处危险词表 —— 闸门不许悄悄搬进底座', () => {
    // 现有 `x-article-driver.clickByText` 里有一份 FORBIDDEN=['publish','发布',...]。
    // 那是 **X 业务层**的红线。若哪天有人把它搬进底座,这条会红。
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const dir = 'src/platform/main/web-capability/input';
    const offenders: string[] = [];
    for (const f of fs.readdirSync(dir).filter((n: string) => n.endsWith('.ts'))) {
      const code = fs
        .readFileSync(path.join(dir, f), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      // 找「按词表拒绝」的特征:FORBIDDEN / DANGEROUS 之类的常量数组
      if (/\b(FORBIDDEN|DANGEROUS|BLOCKED|DENY_?LIST)\b/.test(code)) offenders.push(f);
    }
    expect(offenders, '底座不做危险性判断(§2:不判断哪个动作「危险」)').toEqual([]);
  });

  it('守卫自检:注释里确实有「发布/publish」字样(否则上面那条是空转的)', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const raw = fs.readFileSync('src/platform/main/web-capability/input/web-input.ts', 'utf-8');
    // 剥注释后不该有词表,但**剥之前**必须能找到讨论它的文字 ——
    // 找不到说明这份设计意图没被记下来,守卫也就失去了锚
    expect(raw).toMatch(/发布闸门/);
  });
});

describe('⭐ tap.settle 生效(§10.3 —— 脏态在类型层面可被表达)', () => {
  /** 模态场景:点 Update 后模态该关闭(modalMarker 消失) */
  function modalScene(opts: { closesOnClick: boolean }) {
    const marker = el('button', { class: 'modal-close' }, { textContent: 'x' });
    const update = el('button', { id: 'update' }, { textContent: 'Update' });
    const modal = el('div', { class: 'modal' }, {}, [marker, update]);
    const dom = makeDom([modal]);
    const host = new FakeInputHost(dom);
    if (opts.closesOnClick) {
      // 点 update → 模态真的关(把 marker 从 DOM 里摘掉)
      // ⚠️ 必须挂在**真节点**的 click 监听上:脚本调的是 node.click(),
      // 覆盖句柄的 click 方法根本不会被调到;改句柄数组也不改真 DOM。
      update.node.addEventListener('click', () => marker.node.remove());
    }
    const engine = new InputEngine(host, new MapAnchorResolver(ANCHORS));
    return { engine, update, marker, modal };
  }

  it('⭐ anchorGone 满足 → settled:true', async () => {
    const { engine, update } = modalScene({ closesOnClick: true });
    const r = await engine.tap(PAGE, {
      anchor: 'updateButton',
      settle: { anchorGone: 'modalMarker' },
    });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) throw new Error('unreachable');
    expect(r.value.settled).toBe(true);
    expect(r.value.waited).toBe(true);
    expect(update.clicked).toBe(1);
  });

  it('⭐⭐ anchorGone 未满足 → 报未 settled(Degraded,不是 Ok)', async () => {
    // 这就是那个连环失败的起点:模态没关,而调用方以为关了,下一 step 在脏态上启动
    const { engine, marker } = modalScene({ closesOnClick: false });
    const r = await engine.tap(PAGE, {
      anchor: 'updateButton',
      settle: { anchorGone: 'modalMarker', timeoutMs: 10 },
    });
    expect(isDegraded(r)).toBe(true);
    if (!isDegraded(r)) throw new Error('unreachable');
    expect(r.value.settled).toBe(false);
    expect(r.value.waited).toBe(true);
    expect(r.missing.join()).toContain('modalMarker');
    // ⚠️ 不是 Ok —— 当 Ok 就是「点了就当成了」,正是要治的病
    expect((r as { status: string }).status).not.toBe('ok');
    // 自检:模态**真的**还开着(断言的是事实,不是引擎的自述)
    expect(marker.parentElement).not.toBeNull();
  });

  it('⭐ 没给 settle → settled:false 且 waited:false(「没等」不谎称「等到了」)', async () => {
    const { engine } = modalScene({ closesOnClick: false });
    const r = await engine.tap(PAGE, { anchor: 'updateButton' });
    if (!isOk(r)) throw new Error('应 Ok');
    expect(r.value.settled).toBe(false);
    expect(r.value.waited).toBe(false); // ⭐ 靠这个区分「没等」和「等了没等到」
  });

  it('anchorAppears 判据同样生效', async () => {
    const modal = el('div', { class: 'modal' }, {}, [
      el('button', { class: 'modal-close' }, { textContent: 'x' }),
      el('button', { id: 'update' }, { textContent: 'U' }),
    ]);
    const dom = makeDom([modal]);
    const engine = new InputEngine(new FakeInputHost(dom), new MapAnchorResolver(ANCHORS));
    const r = await engine.tap(PAGE, {
      anchor: 'updateButton',
      settle: { anchorAppears: 'modalMarker' },
    });
    if (!isOk(r)) throw new Error('marker 在场,应 settled');
    expect(r.value.settled).toBe(true);
  });

  it('空 settle 对象直接 Failed(给了却什么也没说 = 恒 false,让人困惑)', async () => {
    const { engine } = modalScene({ closesOnClick: true });
    const r = await engine.tap(PAGE, { anchor: 'updateButton', settle: {} });
    expect(isFailed(r)).toBe(true);
  });

  it('settle 锚点解释不出来 → Failed(不静默当成满足)', async () => {
    const { engine } = modalScene({ closesOnClick: true });
    const r = await engine.tap(PAGE, {
      anchor: 'updateButton',
      settle: { anchorGone: 'noSuchMarker' },
    });
    expect(isFailed(r)).toBe(true);
  });
});

describe('⭐ feed —— 喂文件与落地判据(§10.3)', () => {
  function feedScene() {
    const fileInput = el('input', { id: 'file', type: 'file' }, {});
    const container = el('div', { class: 'composer' }, {}, [fileInput]);
    const dom = makeDom([container]);
    const host = new FakeInputHost(dom);
    const engine = new InputEngine(host, new MapAnchorResolver(ANCHORS));
    return { engine, host, container, fileInput };
  }

  it('⭐ 缩略图出现 → Ok(landed:true)', async () => {
    const { engine, host, container } = feedScene();
    // 模拟站点接住文件后渲染出缩略图
    host.onFeed = () => { container.node.appendChild(el('img', { class: 'thumb' }, {}).node); };
    const r = await engine.feed(PAGE, {
      anchor: 'fileInput',
      files: ['/tmp/a.png'],
      check: { kind: 'anchorAppears', anchor: 'thumb' },
    });
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) throw new Error('unreachable');
    expect(r.value.landed).toBe(true);
    expect(host.fedFiles).toEqual([['/tmp/a.png']]);
  });

  it('⭐⭐ 缩略图不出现 → Failed(对方没接住,不许当成功)', async () => {
    const { engine, host } = feedScene();
    host.onFeed = undefined; // 站点没接住
    const r = await engine.feed(PAGE, {
      anchor: 'fileInput',
      files: ['/tmp/a.png'],
      check: { kind: 'anchorAppears', anchor: 'thumb' },
      timeoutMs: 5,
    });
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toMatch(/落地判据.*未满足/);
  });

  it('⭐ 上传控件不在场 → Failed,且**根本不喂**(不对着空气喂文件)', async () => {
    const dom = makeDom([el('div', { class: 'composer' }, {})]);
    const host = new FakeInputHost(dom);
    const engine = new InputEngine(host, new MapAnchorResolver(ANCHORS));
    const r = await engine.feed(PAGE, {
      anchor: 'fileInput',
      files: ['/tmp/a.png'],
      check: { kind: 'none' },
    });
    expect(isFailed(r)).toBe(true);
    expect(host.fedFiles).toEqual([]); // 没喂 —— 前置检查真的挡住了
  });

  it('⭐ 图与视频的差别由调用方给,不由底座内置', async () => {
    // 同一个 check 表达,只是锚点和 timeout 不同 —— 底座不认识「图」和「视频」
    const fs = require('node:fs') as typeof import('node:fs');
    const code = fs
      .readFileSync('src/platform/main/web-capability/input/web-input.ts', 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code, '底座不许内置视频/转码这类站点语义').not.toMatch(/video|转码|thumbnail|缩略图/i);
  });

  it('喂文件本身抛错 → Failed,不静默', async () => {
    const { engine, host } = feedScene();
    host.setFileInputFilesThrows = 'CDP attach 失败';
    const r = await engine.feed(PAGE, {
      anchor: 'fileInput',
      files: ['/tmp/a.png'],
      check: { kind: 'none' },
    });
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toContain('CDP attach 失败');
  });

  it('check:none 时 checked:false —— 喂文件路径也不谎称落地', async () => {
    const { engine } = feedScene();
    const r = await engine.feed(PAGE, {
      anchor: 'fileInput',
      files: ['/tmp/a.png'],
      check: { kind: 'none' },
    });
    if (!isOk(r)) throw new Error('应 Ok');
    expect(r.value.checked).toBe(false);
    expect(r.value.landed).toBe(false);
  });
});

describe('press / hover / focus', () => {
  it('press 往当前焦点派发按键(收编 Escape 兜底)', async () => {
    const box = el('div', { id: 'compose' }, { textContent: '', contentEditable: 'true' });
    const dom = makeDom([box]);
    const engine = new InputEngine(new FakeInputHost(dom), new MapAnchorResolver(ANCHORS));
    await engine.focus(PAGE, { anchor: 'composeBox' });
    const r = await engine.press(PAGE, { key: 'Escape' });
    expect(isOk(r)).toBe(true);
    expect(box.events.map((e) => e.type)).toEqual(['keydown', 'keyup']);
  });

  it('hover 派发完整鼠标进入序列(X 表格网格按钮需要它)', async () => {
    /**
     * ⚠️ 必须给 rect:hover 要算元素中心再派发鼠标序列。
     * 2026-09-30 起 fake-dom 对「没给 rect 却读几何」**直接抛错** ——
     * 原来它会编造一个 (0,0,100,20),那正是「幻影命中区」的由来。
     */
    const btn = el('button', { id: 'update' }, { rect: { left: 10, top: 20, width: 80, height: 30 } });
    const dom = makeDom([btn]);
    const engine = new InputEngine(new FakeInputHost(dom), new MapAnchorResolver(ANCHORS));
    const r = await engine.hover(PAGE, { anchor: 'updateButton' });
    expect(isOk(r)).toBe(true);
    // 光 mouseover 不够 —— 现有代码血泪:要完整序列才提交
    expect(btn.events.map((e) => e.type)).toEqual([
      'pointerover', 'mouseover', 'mouseenter', 'mousemove',
    ]);
  });

  it('focus 对 contenteditable 会把光标移到末尾(表格插入后光标卡 cell 内的坑)', async () => {
    const box = el('div', { id: 'compose' }, { textContent: 'abc', contentEditable: 'true' });
    const dom = makeDom([box]);
    const engine = new InputEngine(new FakeInputHost(dom), new MapAnchorResolver(ANCHORS));
    const r = await engine.focus(PAGE, { anchor: 'composeBox' });
    expect(isOk(r)).toBe(true);
    expect(box.focused).toBe(true);
    expect(box.scrolled).toBe(true);
  });

  it('hover / press 找不到目标 → Failed', async () => {
    const dom = makeDom([]);
    const engine = new InputEngine(new FakeInputHost(dom), new MapAnchorResolver(ANCHORS));
    expect(isFailed(await engine.hover(PAGE, { anchor: 'updateButton' }))).toBe(true);
  });
});

describe('⭐ frame 作用域本轮不实现 —— 明确 Failed,不静默当 main(§10.5)', () => {
  it('传 frame 作用域 → Failed,且原因指向 §10.5', async () => {
    const box = el('div', { id: 'compose' }, { textContent: '', contentEditable: 'true' });
    const dom = makeDom([box]);
    const engine = new InputEngine(new FakeInputHost(dom), new MapAnchorResolver(ANCHORS));
    const r = await engine.type(PAGE, {
      anchor: 'composeBox',
      text: 'x',
      scope: { kind: 'frame', frameId: 'f1' },
      check: { kind: 'contains', fragment: 'x' },
    });
    expect(isFailed(r)).toBe(true);
    if (!isFailed(r)) throw new Error('unreachable');
    expect(r.reason).toContain('frame');
    // ⚠️ 关键:**没有**退化成往主文档填 —— 那会让「往 iframe 里填」悄悄填错地方
    expect(box.textContent).toBe('');
  });
});
