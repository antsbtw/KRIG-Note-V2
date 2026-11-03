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

  it('不认的 op → bad-op', async () => {
    editor(['']);
    expect(await run({ op: 'nope' })).toMatchObject({ state: 'bad-op' });
  });

  it('⭐ 发布:导语框找不到 → 不点弹窗里的 Publish(宁可停下,不发没导语的)', async () => {
    editor(['字']);
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
