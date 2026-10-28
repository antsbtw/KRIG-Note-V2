// @vitest-environment jsdom
/**
 * ⭐ 发推第②期的两段页面脚本(2026-10-27)—— 在 jsdom 里真跑(记忆 feedback-source-scan-cant-see-execution)
 * ⚠️ X 真页面的结构(弹窗是不是 role=dialog、编辑器认不认合成的 Backspace)jsdom 验不了,要真机 —— 这里只钉脚本自己的逻辑。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { X_DOM_SCRIPTS, X_SCRIPTS } from '@modules/x/x-dom-scripts';

const build = (id: string): string => X_DOM_SCRIPTS.find((s) => s.id === id)!.build({});
// eslint-disable-next-line no-eval
const run = (src: string): Promise<Record<string, unknown>> => Promise.resolve((0, eval)(src));

/** 首页时间线顶上的内嵌框 + (可选)弹窗里的框 */
const page = (dialogText: string | null, inline = '首页内嵌框里的字'): HTMLElement | null => {
  document.body.innerHTML = `<div data-testid="tweetTextarea_0" contenteditable="true">${inline}</div>`;
  if (dialogText === null) return null;
  const d = document.createElement('div');
  d.setAttribute('role', 'dialog');
  d.innerHTML = `<div data-testid="tweetTextarea_0" contenteditable="true">${dialogText}</div>`;
  document.body.append(d);
  return d.querySelector('[data-testid="tweetTextarea_0"]');
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('发推框状态', () => {
  it('⭐ 只认弹窗里的框,不认首页内嵌框;表情图片按 alt 拼回', async () => {
    page('<span>早上好</span><img alt="🙏"><span>!</span>');
    expect(await run(build(X_SCRIPTS.composeBoxState))).toEqual({ found: true, count: 1, text: '早上好🙏!' });
  });
  it('弹窗不在 → 等满 8 秒报 found:false(不拿首页内嵌框充数)', async () => {
    page(null);
    expect(await run(build(X_SCRIPTS.composeBoxState))).toEqual({ found: false, dialogs: 0, boxesAnywhere: 1, loggedOut: false, ready: 'complete', width: window.innerWidth });
  }, 12_000);
});

describe('清空发推框', () => {
  /** 像 Draft.js:不认页面设的全选,光标在 caret 处;Backspace 删光标前一个字,Delete 删光标后一个字 */
  const draftLike = (box: HTMLElement, caret: number): void => {
    let pos = caret;
    box.addEventListener('keydown', (e) => {
      const t = box.textContent ?? '';
      const k = (e as KeyboardEvent).key;
      if (k === 'Backspace' && pos > 0) { box.textContent = t.slice(0, pos - 1) + t.slice(pos); pos -= 1; }
      if (k === 'Delete' && pos < t.length) box.textContent = t.slice(0, pos) + t.slice(pos + 1);
    });
  };
  it('⭐ 编辑器一次 Backspace 只删一个字(10-27 真机)→ 一个个删到空;首页内嵌框不动', async () => {
    const box = page('要撤回的字')!;
    draftLike(box, 5);
    expect(await run(build(X_SCRIPTS.composeClear))).toMatchObject({ state: 'cleared', via: 'keys' });
    expect(box.textContent).toBe('');
    expect(document.body.textContent).toContain('首页内嵌框里的字');
  });
  it('光标在中间 → 前面删光后换 Delete 往后删', async () => {
    const box = page('前面后面')!;
    draftLike(box, 2);
    expect(await run(build(X_SCRIPTS.composeClear))).toMatchObject({ state: 'cleared' });
    expect(box.textContent).toBe('');
  });
  it('删不掉 → not-cleared,带上剩下的开头(不谎称清了)', async () => {
    page('删不掉的字');
    expect(await run(build(X_SCRIPTS.composeClear))).toEqual({ state: 'not-cleared', left: '删不掉的字' });
  });
  it('本来就空 → empty;只剩一个表情图片不算空', async () => {
    page('');
    expect(await run(build(X_SCRIPTS.composeClear))).toEqual({ state: 'empty' });
    page('<img alt="👍">');
    expect((await run(build(X_SCRIPTS.composeClear))).state).toBe('not-cleared');
  });
  it('弹窗已经不在 → no-box', async () => {
    page(null);
    expect(await run(build(X_SCRIPTS.composeClear))).toEqual({ state: 'no-box' });
  });
});
