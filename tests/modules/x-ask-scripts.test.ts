// @vitest-environment jsdom
/**
 * ⭐⭐ 求关的三段页面脚本(2026-10-17)—— 在 jsdom 里**真跑**,不只看源码
 * (记忆 feedback-source-scan-cant-see-execution:源码扫描看不见会不会执行)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { X_DOM_SCRIPTS, X_SCRIPTS, replyNeedle } from '@modules/x/x-dom-scripts';

const build = (id: string, p: Record<string, unknown> = {}): string => X_DOM_SCRIPTS.find((s) => s.id === id)!.build(p);
// eslint-disable-next-line no-eval
const run = (src: string): Promise<Record<string, unknown>> => Promise.resolve((0, eval)(src));

const article = (handle: string, id: string, text: string, liked = false): HTMLElement => {
  const a = document.createElement('article');
  a.setAttribute('data-testid', 'tweet');
  a.innerHTML = `<div data-testid="tweetText">${text}</div><a href="/${handle}/status/${id}"><time>t</time></a>`
    + `<button data-testid="${liked ? 'unlike' : 'like'}"></button>`;
  const b = a.querySelector('button')!;
  b.addEventListener('click', () => b.setAttribute('data-testid', 'unlike'));
  return a;
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('点赞脚本', () => {
  it('⭐ 按推文 id 找到它自己那张卡点赞(不点上面父推的)', async () => {
    const parent = article('p', '100', '父推');
    const focal = article('he', '123', '#蓝V互关');
    document.body.append(parent, focal);
    expect(await run(build(X_SCRIPTS.likeTweet, { tweetId: '123' }))).toEqual({ state: 'liked' });
    expect(focal.querySelector('[data-testid="unlike"]')).not.toBeNull();
    expect(parent.querySelector('[data-testid="like"]')).not.toBeNull();
  });

  it('已赞过 → 不点;id 不合法 → bad-id;前缀相同的 id 不认(1234 ≠ 123)', async () => {
    document.body.append(article('he', '123', 'x', true));
    expect(await run(build(X_SCRIPTS.likeTweet, { tweetId: '123' }))).toEqual({ state: 'already-liked' });
    expect(await run(build(X_SCRIPTS.likeTweet, { tweetId: '1"; alert(1); "' }))).toEqual({ state: 'bad-id' });
    document.body.innerHTML = '';
    document.body.append(article('he', '1234', 'x'));
    expect(await run(build(X_SCRIPTS.likeTweet, { tweetId: '123' }))).toEqual({ state: 'no-tweet' });
  }, 15000);
});

describe('回复框脚本', () => {
  it('读出框的个数和残留', async () => {
    document.body.innerHTML = '<div data-testid="tweetTextarea_0"> 上次的 </div>';
    expect(await run(build(X_SCRIPTS.replyBoxState))).toEqual({ found: true, count: 1, text: '上次的' });
  });
});

describe('发送回复脚本', () => {
  const setup = (sendWorks: boolean): void => {
    document.body.innerHTML = '<div data-testid="tweetTextarea_0">早上好，互关一起冲！🙏</div><button data-testid="tweetButtonInline"></button>';
    document.body.prepend(article('he', '123', '#蓝V互关'));
    document.querySelector('[data-testid="tweetButtonInline"]')!.addEventListener('click', () => {
      document.querySelector('[data-testid="tweetTextarea_0"]')!.textContent = '';
      /** X 把表情渲染成图片:textContent 里没有 🙏 */
      if (sendWorks) document.body.append(article('antsBTW', '999', '早上好，互关一起冲！<img alt="🙏">'));
    });
  };

  it('⭐⭐ 点发送 → 等到**我的号**发的、正文对得上的那条出现 → 读回 id(handle 不分大小写)', async () => {
    setup(true);
    const reply = '早上好，互关一起冲！🙏';
    expect(await run(build(X_SCRIPTS.sendReply, { needle: replyNeedle(reply), me: 'antsbtw' }))).toEqual({ state: 'sent', replyId: '999' });
  });

  it('⭐ 框清空了但页面上没有我的回复 → unseen(不谎称发出去了)', async () => {
    setup(false);
    expect(await run(build(X_SCRIPTS.sendReply, { needle: replyNeedle('早上好，互关一起冲！'), me: 'antsbtw' }))).toEqual({ state: 'unseen' });
  }, 20000);

  it('别人发的同样的话不算是我的', async () => {
    setup(false);
    document.body.append(article('someone', '555', '早上好，互关一起冲！'));
    const r = await run(build(X_SCRIPTS.sendReply, { needle: replyNeedle('早上好，互关一起冲！'), me: 'antsbtw' }));
    expect(r.state).toBe('unseen');
  }, 20000);

  it('⚠️ 留言里带 $& $\' 引号也原样进脚本(replace 用函数,不吃特殊模式)', () => {
    const src = build(X_SCRIPTS.sendReply, { needle: `a$&b$'c"d`, me: 'x' });
    expect(src).toContain(JSON.stringify(`a$&b$'c"d`));
    expect(() => new Function(src)).not.toThrow();
  });
});
