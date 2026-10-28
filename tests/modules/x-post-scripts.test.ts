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
    expect(await run(build(X_SCRIPTS.composeBoxState))).toEqual({ found: true, count: 1, text: '早上好🙏!', media: 0 });
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

describe('点发布(第③期)', () => {
  const withButton = (disabled: boolean): HTMLElement => {
    page('要发的字');
    const d = document.querySelector('[role="dialog"]')!;
    const b = document.createElement('button');
    b.setAttribute('data-testid', 'tweetButton');
    if (disabled) b.setAttribute('aria-disabled', 'true');
    d.append(b);
    /** 首页内嵌框的按钮 —— 不该被点 */
    const inline = document.createElement('button');
    inline.setAttribute('data-testid', 'tweetButtonInline');
    inline.addEventListener('click', () => { throw new Error('点了首页内嵌框的发布'); });
    document.body.prepend(inline);
    return b;
  };
  it('⭐ 点弹窗里的发布 → 弹窗关了 + 提示条里有链接 → closed 带 toastId', async () => {
    const b = withButton(false);
    b.addEventListener('click', () => {
      document.querySelector('[role="dialog"]')!.remove();
      document.body.insertAdjacentHTML('beforeend', '<div data-testid="toast"><a href="/me/status/1900000000000000009">View</a></div>');
    });
    expect(await run(build(X_SCRIPTS.composeSend))).toEqual({ state: 'closed', toastId: '1900000000000000009' });
  });
  it('按钮是灰的 → disabled,不点', async () => {
    const b = withButton(true);
    let clicked = false;
    b.addEventListener('click', () => { clicked = true; });
    expect(await run(build(X_SCRIPTS.composeSend))).toEqual({ state: 'disabled' });
    expect(clicked).toBe(false);
  }, 10_000);
  it('弹窗不在 → no-dialog', async () => {
    page(null);
    expect(await run(build(X_SCRIPTS.composeSend))).toEqual({ state: 'no-dialog' });
  });
});

describe('在我主页上找刚发的那条(第③期)', () => {
  const art = (handle: string, id: string, text: string, at: number, photos = 0): string =>
    `<article data-testid="tweet"><a href="/${handle}/status/${id}"><time datetime="${new Date(at).toISOString()}"></time></a>`
    + (text === '' ? '' : `<div data-testid="tweetText">${text}</div>`)
    + '<div data-testid="tweetPhoto"><img></div>'.repeat(photos) + '</article>';
  const find = (needle: string, since: number, photos = 0) =>
    run(X_DOM_SCRIPTS.find((s) => s.id === X_SCRIPTS.findMyPost)!.build({ needle, me: 'Me', since, photos }));
  it('⭐ 作者是我 + 正文对得上 + 时间不早于点发布 → 那条的 id;别人同样的字 / 我以前同样的字都不算', async () => {
    const now = Date.now();
    document.body.innerHTML = art('other', '111', '今天读了一篇论文', now)
      + art('me', '222', '今天读了一篇论文', now - 3_600_000)
      + art('me', '333', '今天读了一篇<img alt="📚">论文', now);
    expect(await find('今天读了一篇📚论文', now)).toEqual({ tweetId: '333', photos: 0 });
  });
  it('⭐ 我以前发过一模一样的字(排在前面)→ 不算,认时间不早于点发布的那条', async () => {
    const now = Date.now();
    document.body.innerHTML = art('me', '222', '今天读了一篇论文', now - 3_600_000) + art('me', '444', '今天读了一篇论文', now + 1000);
    expect(await find('今天读了一篇论文', now)).toEqual({ tweetId: '444', photos: 0 });
  });
  it('没有 → 等满 10 秒报 not-found,带上页面上我的推文数', async () => {
    const now = Date.now();
    document.body.innerHTML = art('me', '222', '别的字', now);
    expect(await find('今天读了一篇论文', now)).toEqual({ why: 'not-found', seen: 1 });
  }, 15_000);
  it('⭐ 带图(第④期):字对上、图够数 → 那条;图数不够的同字推文不算', async () => {
    const now = Date.now();
    document.body.innerHTML = art('me', '555', '配图', now, 1) + art('me', '666', '配图', now, 2);
    expect(await find('配图', now, 2)).toEqual({ tweetId: '666', photos: 2 });
  });
  it('⭐ 纯图推(没有字):认作者 + 时间 + 图数;有字的不算', async () => {
    const now = Date.now();
    document.body.innerHTML = art('me', '777', '有字的', now, 1) + art('me', '888', '', now, 1);
    expect(await find('', now, 1)).toEqual({ tweetId: '888', photos: 1 });
  });
  it('字对上但图不够 → 等满 10 秒报 no-photos,带那条的 id 和看到几张', async () => {
    const now = Date.now();
    document.body.innerHTML = art('me', '999', '配图', now, 1);
    expect(await find('配图', now, 2)).toEqual({ why: 'no-photos', tweetId: '999', photos: 1 });
  }, 15_000);
});

describe('带图(第④期):数图 / 等传完 / 清图', () => {
  /** 弹窗里挂 n 张图:每张一个 blob: 的 img + 同一 URL 的背景图(只算一张)+ 移除按钮(点了就拿掉这张) */
  const attach = (n: number, removable = true): Element => {
    page('配图');
    const d = document.querySelector('[role="dialog"]')!;
    for (let i = 0; i < n; i += 1) {
      const it = document.createElement('div');
      it.innerHTML = `<div style="background-image: url(&quot;blob:https://x.com/u${i}&quot;)"></div><img src="blob:https://x.com/u${i}">`
        + (removable ? '<button aria-label="Remove media"></button>' : '');
      it.querySelector('button')?.addEventListener('click', () => it.remove());
      d.append(it);
    }
    return d;
  };
  const ready = (want: number) => run(X_DOM_SCRIPTS.find((s) => s.id === X_SCRIPTS.composeMediaReady)!.build({ want }));
  const button = (d: Element, disabled: boolean): void => {
    d.insertAdjacentHTML('beforeend', `<button data-testid="tweetButton" ${disabled ? 'aria-disabled="true"' : ''}></button>`);
  };

  it('⭐ 框状态里数图:同一 blob 的 img 和背景图只算一张;首页内嵌框外的图不算', async () => {
    attach(2);
    document.body.insertAdjacentHTML('afterbegin', '<img src="blob:https://x.com/outside">');
    expect(await run(build(X_SCRIPTS.composeBoxState))).toMatchObject({ found: true, media: 2 });
  });
  it('⭐ 挂够了 + 发布按钮亮了 → ready', async () => {
    button(attach(2), false);
    expect(await ready(2)).toEqual({ state: 'ready', attached: 2 });
  });
  it('比要的多 → too-many(框里本来就有图)', async () => {
    button(attach(3), false);
    expect(await ready(2)).toEqual({ state: 'too-many', attached: 3 });
  });
  it('⭐ 按钮一直灰(还在传)→ 等满 60 秒 timeout,带各信号和弹窗里的 testid', async () => {
    const d = attach(1);
    button(d, true);
    const r = await ready(1);
    expect(r).toMatchObject({ state: 'timeout', attached: 1, blobs: 1, buttonEnabled: false });
    expect(r.testids).toContain('tweetButton');
  }, 70_000);
  it('⭐ 清框:先点掉图再删字 → cleared;点不掉图 → not-cleared 说还挂着几张', async () => {
    attach(2);
    const box = document.querySelector('[role="dialog"] [data-testid="tweetTextarea_0"]') as HTMLElement;
    box.addEventListener('keydown', () => { box.textContent = (box.textContent ?? '').slice(0, -1); });
    expect(await run(build(X_SCRIPTS.composeClear))).toMatchObject({ state: 'cleared' });
    expect(document.querySelectorAll('[role="dialog"] img').length).toBe(0);
    attach(1, false);
    expect(await run(build(X_SCRIPTS.composeClear))).toEqual({ state: 'not-cleared', left: '还挂着 1 张图(没找到移除按钮)' });
  });
  it('只有图没有字 → 点掉图就算清了', async () => {
    attach(1);
    (document.querySelector('[role="dialog"] [data-testid="tweetTextarea_0"]') as HTMLElement).textContent = '';
    expect(await run(build(X_SCRIPTS.composeClear))).toMatchObject({ state: 'cleared', via: 'media' });
  });
});
