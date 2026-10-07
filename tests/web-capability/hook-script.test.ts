/**
 * 注入脚本的**可执行**验证(M4)
 *
 * ⚠️⚠️ 本文件存在的唯一理由:`project-x-inject-template-escape` ——
 * 模板字面量里写 `\/` 被求值吃掉 → 浏览器收到非法正则 → 整段解析失败 →
 * **采集恒 0,而 tsc 与单测全绿**,那一天就那么过去了。
 *
 * ⭐ 所以这里**真的 eval 一遍**,再验行为 —— 只检查字符串里有没有某个 token
 * 是证明不了脚本能跑的。
 */

import { describe, it, expect, vi } from 'vitest';
import { buildHookScript, HOOK_FLAG, HOOK_PROBE } from '@platform/main/web-capability/hook/hook-script';

/** 造一个最小的「页面」环境 —— ⚠️ 用真 eval,不是解析 */
function makePage() {
  const sent: string[] = [];
  const listeners: Record<string, Array<() => void>> = {};

  class FakeXHR {
    responseType = '';
    responseText = '';
    responseURL = '';
    status = 0;
    open(_m: string, _u: string): void { /* 由脚本覆写 */ }
    send(): void { /* 由脚本覆写 */ }
    addEventListener(ev: string, fn: () => void): void {
      (listeners[ev] ??= []).push(fn);
    }
    /** 测试用:模拟响应到达 */
    __fire(): void { for (const f of listeners.load ?? []) f(); }
  }

  const win: Record<string, unknown> = {
    XMLHttpRequest: FakeXHR,
    fetch: undefined,
    __krigTestBinding: (s: string) => { sent.push(s); },
  };
  return { win, sent, FakeXHR };
}

/** 在假 window 上下文里真的求值 */
function run(src: string, win: Record<string, unknown>): void {
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', 'Date', `${src}`);
  fn(win, Date);
}

describe('⭐⭐ 脚本必须是合法 JS 且真能跑', () => {
  it('⭐⭐⭐ eval 不抛 —— 这是 `inject-template-escape` 那次唯一能挡住的测试', () => {
    const src = buildHookScript('__krigTestBinding');
    const { win } = makePage();
    expect(() => run(src, win), '脚本求值抛异常 —— 浏览器里同样会整段失效').not.toThrow();
  });

  it('⭐ 装上后挂起标记(自检靠它)', () => {
    const src = buildHookScript('__krigTestBinding');
    const { win } = makePage();
    run(src, win);
    expect(win[HOOK_FLAG], '标记没挂上 —— 自检会永远报「没装上」').toBe(true);
    expect(HOOK_PROBE, '自检表达式与标记名不一致').toContain(HOOK_FLAG);
  });

  it('⭐⭐ **自防重**:注入两次只钩一次', () => {
    /**
     * ⚠️ 同一文档会被注入两次(新文档一次 + 已加载页面补注入一次)。
     * 钩两次 → 每条响应送回**两份** → 看着像「采到了双倍」。
     */
    const src = buildHookScript('__krigTestBinding');
    const { win, sent, FakeXHR } = makePage();
    run(src, win);
    const afterFirst = win.XMLHttpRequest;
    run(src, win);
    expect(win.XMLHttpRequest, '第二次注入又包了一层 —— 响应会送回两份')
      .toBe(afterFirst);

    const x = new (win.XMLHttpRequest as typeof FakeXHR)();
    x.open('POST', 'https://x.com/i/api/graphql/abc/HomeTimeline');
    x.send();
    x.status = 200; x.responseText = '{"ok":1}';
    x.__fire();
    expect(sent, '同一条响应被送回了多份').toHaveLength(1);
  });
});

describe('⭐⭐ XHR 钩子', () => {
  it('⭐ 钩到响应并送回 —— url / method / status / 正文都对', () => {
    const src = buildHookScript('__krigTestBinding');
    const { win, sent, FakeXHR } = makePage();
    run(src, win);

    const x = new (win.XMLHttpRequest as typeof FakeXHR)();
    x.open('POST', 'https://x.com/i/api/graphql/q1/HomeTimeline');
    x.send();
    x.status = 200;
    x.responseText = '{"data":{"home":{"entries":[1,2,3]}}}';
    x.__fire();

    expect(sent, '没送回来').toHaveLength(1);
    const r = JSON.parse(sent[0]);
    expect(r.via).toBe('xhr');
    expect(r.url).toContain('HomeTimeline');
    expect(r.method).toBe('POST');
    expect(r.status).toBe(200);
    expect(r.text, '正文不完整').toBe('{"data":{"home":{"entries":[1,2,3]}}}');
    expect(r.byteLength).toBe(37);
  });

  it('⭐⭐ **原函数照常被调** —— 钩子绝不能改变页面行为', () => {
    /**
     * ⚠️⚠️ 这是最危险的一条:钩子若吞掉 `send`,站点**当场坏掉**,
     * 而且症状是「页面白屏」,人不会联想到采集。
     */
    const src = buildHookScript('__krigTestBinding');
    const { win } = makePage();
    const origSend = vi.fn();
    (win.XMLHttpRequest as { prototype: Record<string, unknown> }).prototype.send = origSend;
    run(src, win);

    const x = new (win.XMLHttpRequest as new () => { open(m: string, u: string): void; send(): void })();
    x.open('GET', 'https://x.com/a');
    x.send();
    expect(origSend, '原 send 没被调用 —— 页面的请求根本发不出去').toHaveBeenCalled();
  });

  it('⚠️ 二进制响应不读 —— 读 responseText 会抛', () => {
    const src = buildHookScript('__krigTestBinding');
    const { win, sent, FakeXHR } = makePage();
    run(src, win);
    const x = new (win.XMLHttpRequest as typeof FakeXHR)();
    x.open('GET', 'https://video.twimg.com/a.m4s');
    x.send();
    (x as unknown as { responseType: string }).responseType = 'arraybuffer';
    x.status = 200;
    x.__fire();
    expect(sent, '二进制响应被当文本读了').toHaveLength(0);
  });

  it('⚠️ 超大响应**不送半条** —— 只送元信息并标记', () => {
    /**
     * ⭐ binding 的 payload 过大会被 CDP **静默截断** —— 那才是真数据损坏。
     * ⚠️ 所以超限时送元信息 + `oversize: true`,**绝不送半条正文**
     * (用户 2026-10-02:「要保持信息的完整性,而不是片段」)。
     */
    const src = buildHookScript('__krigTestBinding', 100);
    const { win, sent, FakeXHR } = makePage();
    run(src, win);
    const x = new (win.XMLHttpRequest as typeof FakeXHR)();
    x.open('GET', 'https://x.com/big');
    x.send();
    x.status = 200;
    x.responseText = 'z'.repeat(5000);
    x.__fire();

    expect(sent).toHaveLength(1);
    const r = JSON.parse(sent[0]);
    expect(r.oversize, '超大没被标记 —— 会被当成正常的空响应').toBe(true);
    expect(r.text, '送了半条正文 —— 下游解析必炸').toBe('');
    expect(r.byteLength, '原始大小没留下 —— 不知道丢了多大的东西').toBe(5000);
  });
});

describe('⭐⭐ fetch 钩子', () => {
  function withFetch(body: string, contentType = 'application/json') {
    const { win, sent } = makePage();
    const res = {
      status: 200,
      url: 'https://x.com/i/api/graphql/q1/HomeTimeline',
      headers: { get: (k: string) => (k === 'content-type' ? contentType : null) },
      clone(): typeof res { return { ...res, clone: res.clone, text: res.text }; },
      text: async (): Promise<string> => body,
    };
    win.fetch = vi.fn(async () => res);
    return { win, sent, res, orig: win.fetch as ReturnType<typeof vi.fn> };
  }

  it('⭐⭐⭐ **必须 clone 再读** —— 直接读会把站点自己那份吃掉', async () => {
    /**
     * ⚠️⚠️ 这是整个脚本最危险的一行:响应体**只能读一次**。
     * 不 clone 就读 → 站点拿到的是已消费的流 → **页面当场坏掉**,
     * 而症状是「白屏」,人不会联想到采集。
     *
     * ⭐⭐ 判据必须是「**原 response 仍可读**」—— 只断言
     * 「钩到了」或「返回了对象」都证明不了这一点:
     * 不 clone 时照样钩得到,坏的是站点那一侧。
     * 所以这里用一个**真的只能读一次**的 response 来测。
     */
    const src = buildHookScript('__krigTestBinding');
    const { win, sent } = makePage();

    /**
     * ⭐ 真·一次性 body:**每个副本有自己的 consumed**(与浏览器一致)——
     * ⚠️ 我第一版让副本与原件共用一个标志,于是读副本也把原件标成已消费,
     * 测试红了而**脚本是对的** —— 差一点就去「修」一个不存在的 bug。
     */
    const makeRes = (): Record<string, unknown> => {
      let consumed = false;
      const self: Record<string, unknown> = {
        status: 200,
        url: 'https://x.com/i/api/graphql/q1/HomeTimeline',
        headers: { get: () => 'application/json' },
        clone(): Record<string, unknown> {
          // ⚠️ 真 Response.clone 在 body 已消费后会抛 —— 照搬这条行为
          if (consumed) throw new TypeError('body already consumed');
          return makeRes();
        },
        text: async (): Promise<string> => {
          if (consumed) throw new TypeError('body already consumed');
          consumed = true;
          return '{"ok":1}';
        },
      };
      return self;
    };
    const res = makeRes();
    win.fetch = async () => res;
    run(src, win);

    const out = await (win.fetch as (u: string) => Promise<Record<string, unknown>>)('https://x.com/a');
    await new Promise((r) => setTimeout(r, 0));

    expect(sent.length, '没钩到 fetch 响应').toBe(1);
    expect(JSON.parse(sent[0]).text).toBe('{"ok":1}');

    /**
     * ⭐⭐ **决定性断言**:站点现在去读自己那份,必须照样读得到。
     * 不 clone 的实现会在这里抛 `body already consumed`。
     */
    await expect(
      (out.text as () => Promise<string>)(),
      '站点自己那份被钩子吃掉了 —— 页面会当场白屏',
    ).resolves.toBe('{"ok":1}');
  });

  it('⭐ 原 fetch 照常被调,返回值原样透传', async () => {
    const src = buildHookScript('__krigTestBinding');
    const { win, orig } = withFetch('{"a":1}');
    run(src, win);
    const out = await (win.fetch as (u: string) => Promise<{ status: number }>)('https://x.com/a');
    expect(orig, '原 fetch 没被调用 —— 页面请求发不出去').toHaveBeenCalled();
    expect(out.status, '返回值被改了').toBe(200);
  });

  it('⚠️ 非文本型响应不读(视频/图片)', async () => {
    const src = buildHookScript('__krigTestBinding');
    const { win, sent } = withFetch('binary-ish', 'video/mp4');
    run(src, win);
    await (win.fetch as (u: string) => Promise<unknown>)('https://video.twimg.com/a.m4s');
    await new Promise((r) => setTimeout(r, 0));
    expect(sent, '二进制响应被当文本读了 —— 会把几 MB 变成垃圾字符串').toHaveLength(0);
  });

  it('⭐ 钩子抛异常也不能影响页面', async () => {
    /** ⚠️ 采集坏了是小事,**把人家页面弄坏**是大事 */
    const src = buildHookScript('__krigTestBinding');
    const { win } = withFetch('{"a":1}');
    win.__krigTestBinding = () => { throw new Error('binding 炸了'); };
    run(src, win);
    await expect(
      (win.fetch as (u: string) => Promise<unknown>)('https://x.com/a'),
    ).resolves.toBeDefined();
  });
});

describe('⚠️ 脚本文本本身的卫生', () => {
  const src = buildHookScript('__krigTestBinding');

  it('⭐⭐ 参数是**绑定**进去的,不是拼进脚本体', () => {
    /**
     * ⚠️ `project-x-inject-template-escape` 的根因就是拼串。
     * ⭐ 判据:binding 名出现在 `var __KRIG_BINDING = "..."` 这一行,
     * 而脚本体里只用 `__KRIG_BINDING` 这个变量。
     */
    expect(src, '参数没走 JSON.stringify 绑定')
      .toContain('var __KRIG_BINDING = "__krigTestBinding"');
    const body = src.slice(src.indexOf('(function ()'));
    expect(body, '脚本体里直接拼了 binding 名 —— 特殊字符会炸')
      .not.toContain('__krigTestBinding');
  });

  it('⚠️ 恶意 binding 名也不能逃出字符串', () => {
    /** ⭐ 反向攻击面:名字里带引号/换行时,JSON.stringify 必须兜住 */
    const evil = 'a"; window.__pwned = 1; var b="';
    const s = buildHookScript(evil);
    const { win } = makePage();
    expect(() => run(s, win), '恶意名字让脚本炸了').not.toThrow();
    expect((win as Record<string, unknown>).__pwned, '逃出字符串了 —— 注入点').toBeUndefined();
  });

  it('⚠️ 脚本体不含模板字面量(反引号会与页面代码打架)', () => {
    const body = src.slice(src.indexOf('(function ()'));
    expect(body, '脚本体里有反引号').not.toContain('`');
  });
});
