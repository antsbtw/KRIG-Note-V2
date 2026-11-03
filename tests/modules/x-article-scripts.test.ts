// @vitest-environment jsdom
/**
 * X 文章编辑器脚本(第⑥期,2026-10-30)—— 在 jsdom 里真跑(记忆 project-x-inject-template-escape:拼出来的脚本可能根本不合法,tsc 看不见)
 * ⚠️ X 真页面(DraftJS 认不认合成 paste、弹窗长什么样)jsdom 验不了 —— 那些 10-30 在真机上用 probe 量过;这里只钉脚本自己的逻辑。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { X_ARTICLE_SCRIPT, X_ARTICLE_SCRIPTS } from '@modules/x/x-article-scripts';

const build = (params: Record<string, unknown>): string => X_ARTICLE_SCRIPTS.find((s) => s.id === X_ARTICLE_SCRIPT)!.build(params as never);
// eslint-disable-next-line no-eval
const run = (params: Record<string, unknown>): Promise<Record<string, unknown>> => Promise.resolve((0, eval)(build(params)));

/** 合成 paste 用的 DataTransfer / ClipboardEvent(jsdom 没有):记下最后一次粘了什么 */
let pasted: { html: string; text: string } | null = null;
class FakeDT { private d: Record<string, string> = {}; setData(k: string, v: string): void { this.d[k] = v; } getData(k: string): string { return this.d[k] ?? ''; } }
class FakeClip extends Event { clipboardData: FakeDT; constructor(t: string, i: { clipboardData: FakeDT; bubbles?: boolean }) { super(t, i); this.clipboardData = i.clipboardData; } }
Object.assign(globalThis, { DataTransfer: FakeDT, ClipboardEvent: FakeClip });

/** 编辑器:每个块一个 data-block;收到 paste 就把 text 追加成新的一块(像 DraftJS 粘进来) */
const editor = (lines: string[]): HTMLElement => {
  document.body.innerHTML = `<textarea placeholder="Add a title"></textarea><div data-testid="composer">${lines.map((l) => `<div data-block="true">${l}</div>`).join('')}</div>`;
  const b = document.querySelector('[data-testid="composer"]') as HTMLElement;
  /** jsdom 没有 innerText */
  Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { return (this as HTMLElement).textContent; } });
  b.addEventListener('paste', (e) => {
    const dt = (e as unknown as FakeClip).clipboardData;
    pasted = { html: dt.getData('text/html'), text: dt.getData('text/plain') };
    const d = document.createElement('div');
    d.setAttribute('data-block', 'true');
    d.textContent = pasted.text;
    b.append(d);
  });
  return b;
};

beforeEach(() => { pasted = null; Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 }); });

describe('X 文章脚本', () => {
  it('拼出来是合法脚本;读状态', async () => {
    editor(['']);
    const r = await run({ op: 'state' });
    expect(r).toMatchObject({ state: 'ok', title: '', text: '', create: false });
  });

  it('⭐ 网页宽度 0(没显示)→ 直接说,不往下做(10-30 真机:Insert 弹窗是空的)', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 0 });
    expect(await run({ op: 'state' })).toMatchObject({ state: 'hidden' });
  });

  it('⭐ 粘贴:光标那行空、第一块是段落 → 不垫零宽段落(不多空行)', async () => {
    editor(['']);
    expect(await run({ op: 'paste', html: '<p>第一段</p>', text: '第一段' })).toMatchObject({ state: 'ok', prefixed: false });
    expect(pasted?.html).toBe('<p>第一段</p>');
  });

  it('⭐ 粘贴:光标那行有字 / 第一块是标题 → 垫零宽段落(否则并进那行、标题丢了)', async () => {
    editor(['已有的字']);
    expect(await run({ op: 'paste', html: '<p>下一段</p>', text: '下一段' })).toMatchObject({ prefixed: true });
    expect(pasted?.html).toBe('<p>​</p><p>下一段</p>');
    editor(['']);
    expect(await run({ op: 'paste', html: '<h1>小标题</h1>', text: '小标题' })).toMatchObject({ prefixed: true });
  });

  it('粘了没出现 → not-landed(不说成功)', async () => {
    editor(['']);
    document.querySelector('[data-testid="composer"]')!.replaceWith(Object.assign(document.createElement('div'), { innerHTML: '' }));
    const b = document.createElement('div');
    b.setAttribute('data-testid', 'composer');
    document.body.append(b);
    expect(await run({ op: 'paste', html: '<p>x</p>', text: '不会出现' })).toMatchObject({ state: 'not-landed' });
  }, 8000);

  it('点了 Media 没出选文件的弹窗 → no-input,带回屏幕上的提示和菜单(11-02 真机:日志里看不出 X 说了什么)', async () => {
    editor(['字']);
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 }) });
    const trig = document.createElement('button');
    trig.setAttribute('aria-label', 'Add Media');
    trig.addEventListener('click', () => {
      const it = Object.assign(document.createElement('div'), { textContent: 'Media' });
      it.setAttribute('role', 'menuitem');
      document.body.append(it);
    });
    const toast = Object.assign(document.createElement('div'), { textContent: '上传太多了' });
    toast.setAttribute('role', 'alert');
    document.body.append(trig, toast);
    const r = await run({ op: 'mediaOpen' });
    expect(r).toMatchObject({ state: 'no-input', scene: { alerts: ['上传太多了'], menu: ['Media'] } });
    expect(Array.isArray(r.ups)).toBe(true);
    delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  }, 15_000);

  it('⭐ 封面 Apply 第一下 X 没认 → 框还在就再点,第二下成了算成(11-02 真机:点一下就干等 30 秒)', async () => {
    editor(['']);
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    const ap = Object.assign(document.createElement('button'), { textContent: 'Apply' });
    ap.setAttribute('data-testid', 'applyButton');
    let n = 0;
    ap.addEventListener('click', () => {
      n += 1;
      if (n < 2) return;
      dlg.remove();
      const rm = document.createElement('button');
      rm.setAttribute('aria-label', 'Remove photo');
      document.body.append(rm);
    });
    dlg.append(ap);
    document.body.append(dlg);
    /** jsdom 的 MouseEvent 不认 eval 里的 view: window(真 Chrome 认;表格那步 10-30 真机用的就是它)*/
    const Real = globalThis.MouseEvent;
    globalThis.MouseEvent = class extends Real { constructor(t: string, i: MouseEventInit = {}) { const { view: _v, ...rest } = i; super(t, rest); } } as typeof MouseEvent;
    expect(await run({ op: 'coverApply' })).toMatchObject({ state: 'ok', clicks: ['可点', '可点'] });
    globalThis.MouseEvent = Real;
  }, 20_000);

  describe('⭐ 盯着(用户 11-02:点 X 网页自己的 Publish 也要有导语)', () => {
    const dialog = (title: string, value = ''): HTMLTextAreaElement => {
      const d = document.createElement('div');
      d.setAttribute('role', 'dialog');
      /** 11-02 真机:导语框 textarea[data-testid=articleTweetTextInput];别的弹窗(LaTeX)的框没这个 testid */
      d.innerHTML = `<h2>${title}</h2><textarea${title === 'Publish Article' ? ' data-testid="articleTweetTextInput"' : ''}></textarea>`;
      document.body.append(d);
      const ta = d.querySelector('textarea')!;
      ta.value = value;
      return ta;
    };
    beforeEach(() => {
      editor(['字']);
      history.replaceState(null, '', '/compose/articles/edit/777');
      Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 }) });
    });
    const done = (): void => {
      history.replaceState(null, '', '/');
      delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    };

    it('发布弹窗开着、导语框空 → 填一次;人删了不再填', async () => {
      const ta = dialog('Publish Article');
      expect(await run({ op: 'watch', editId: '777', caption: '导语' })).toMatchObject({ state: 'editing', dialog: true, filled: true });
      expect(ta.value).toBe('导语');
      ta.value = '';
      expect(await run({ op: 'watch', editId: '777', caption: '导语' })).toMatchObject({ filled: false });
      expect(ta.value).toBe('');
      done();
    });

    it('⭐ 外层 [role=dialog] 高度 0(11-02 真机就是这样)→ 照样找得到导语框', async () => {
      Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value(this: HTMLElement) { return this.getAttribute('role') === 'dialog' ? { width: 838, height: 0, top: 0, left: 0, right: 838, bottom: 0 } : { width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 }; },
      });
      const ta = dialog('Publish Article');
      expect(await run({ op: 'watch', editId: '777', caption: '导语' })).toMatchObject({ filled: true });
      expect(ta.value).toBe('导语');
      done();
    });

    it('LaTeX 之类别的弹窗里的框 → 不碰', async () => {
      const ta = dialog('LaTeX');
      expect(await run({ op: 'watch', editId: '777', caption: '导语' })).toMatchObject({ state: 'editing', dialog: false });
      expect(ta.value).toBe('');
      done();
    });

    it('人在框里先写了字 → 不覆盖', async () => {
      const ta = dialog('Publish Article', '我自己写的');
      expect(await run({ op: 'watch', editId: '777', caption: '导语' })).toMatchObject({ filled: false, kept: true });
      expect(ta.value).toBe('我自己写的');
      done();
    });

    it('离开了这份文章的编辑页 → left 带地址', async () => {
      history.replaceState(null, '', '/antsBTW/status/123');
      expect(await run({ op: 'watch', editId: '777', caption: '导语' })).toMatchObject({ state: 'left' });
      done();
    });
  });

  it('⭐ 图插完等 X 顶上变「Last saved just now」再往下(11-03 真机:只稳 1.5 秒,下一步粘贴 X 没接住)', async () => {
    editor(['字']);
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 }) });
    document.querySelector('[data-testid="composer"]')!.insertAdjacentHTML('beforeend', '<section data-block="true"><img src="blob:x"></section>');
    const st = document.createElement('div');
    st.innerHTML = '<span>Saving</span>';
    document.body.append(st);
    setTimeout(() => { st.innerHTML = '<span>Last saved just now</span>'; }, 1200);
    const r = await run({ op: 'mediaWait', want: 1, saveMs: 5000 });
    expect(r).toMatchObject({ state: 'ok', savedOk: true });
    expect(Number(r.waited)).toBeGreaterThanOrEqual(1000);
    delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  }, 15_000);

  it('不认的 op → bad-op', async () => {
    editor(['']);
    expect(await run({ op: 'nope' })).toMatchObject({ state: 'bad-op' });
  });

  it('⭐ 发布:导语框找不到 → 不点弹窗里的 Publish(宁可停下,不发没导语的);正文图是 blob: 不拦(11-02:X 从不换 blob:,那条检查恒拦)', async () => {
    editor(['字']);
    document.querySelector('[data-testid="composer"]')!.insertAdjacentHTML('beforeend', '<section data-block="true"><img src="blob:https://x.com/1"></section>');
    history.replaceState(null, '', '/compose/articles/edit/777');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', { configurable: true, value: () => ({ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10 }) });
    const top = Object.assign(document.createElement('button'), { textContent: 'Publish' });
    top.addEventListener('click', () => {
      const d = document.createElement('div');
      d.setAttribute('role', 'dialog');
      d.innerHTML = '<button>Publish</button>';
      d.querySelector('button')!.addEventListener('click', () => { (window as unknown as { sent: boolean }).sent = true; });
      document.body.append(d);
    });
    document.body.append(top);
    expect(await run({ op: 'publish', editId: '777', caption: '导语' })).toMatchObject({ state: 'caption-failed' });
    expect((window as unknown as { sent?: boolean }).sent).toBeUndefined();
    history.replaceState(null, '', '/');
    delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  }, 15_000);

  it('⭐ 发布:编辑器不在这份文章上 → 不点(不发错一篇)', async () => {
    editor(['字']);
    const pub = Object.assign(document.createElement('button'), { textContent: 'Publish' });
    let clicked = false;
    pub.addEventListener('click', () => { clicked = true; });
    document.body.append(pub);
    expect(await run({ op: 'publish', editId: '123' })).toMatchObject({ state: 'not-editing' });
    expect(clicked).toBe(false);
  });
});
