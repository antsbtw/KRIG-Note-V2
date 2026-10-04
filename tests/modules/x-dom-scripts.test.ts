/**
 * X 的 DOM 补全脚本 —— ⭐ **真 eval 一遍**,不只检查字符串
 *
 * ⚠️⚠️ `project-x-inject-template-escape`:模板字面量里写 `\/` 被求值吃掉 →
 * 浏览器收到非法正则 → 整段解析失败 → **采集恒 0,而 tsc 与单测全绿**。
 * 那一天就那么过去了 —— 所以这里必须真的跑。
 */

import { describe, it, expect, vi } from 'vitest';
import { X_DOM_SCRIPTS, X_SCRIPTS } from '@modules/x/x-dom-scripts';

const script = (): string => {
  const s = X_DOM_SCRIPTS.find((x) => x.id === X_SCRIPTS.expandAll);
  if (!s) throw new Error('expandAll 脚本没注册');
  return s.build({});
};

/** 造一个最小的 DOM —— ⚠️ 只实现脚本真正用到的那几个口 */
function makeDoc(articles: Array<{
  id?: string;
  text?: string;
  showMoreTestId?: boolean;
  showMoreLabel?: string;
  /** ⚠️ 外链伪装成按钮 —— 点了会导航走,必须被排除 */
  linkLabel?: string;
}>) {
  const clicks: string[] = [];
  const mk = (a: typeof articles[number]) => {
    const btns: Array<Record<string, unknown>> = [];
    if (a.showMoreTestId) {
      btns.push({
        tagName: 'BUTTON', textContent: 'Show more',
        closest: () => null,
        click: () => clicks.push('testid'),
        __testid: true,
      });
    }
    if (a.showMoreLabel) {
      btns.push({
        tagName: 'BUTTON', textContent: a.showMoreLabel,
        closest: () => null,
        click: () => clicks.push(`label:${a.showMoreLabel}`),
      });
    }
    if (a.linkLabel) {
      btns.push({
        tagName: 'A', textContent: a.linkLabel,
        closest: () => ({}),          // ⚠️ 它在 <a> 里
        click: () => clicks.push('LINK!'),
      });
    }
    return {
      querySelectorAll: (sel: string) => {
        if (sel.includes('tweet-text-show-more-link')) {
          return btns.filter((b) => b.__testid);
        }
        if (sel.includes('/status/')) {
          return a.id ? [{ getAttribute: () => `/someone/status/${a.id}` }] : [];
        }
        if (sel.includes('button')) return btns;
        return [];
      },
      querySelector: (sel: string) => (sel.includes('tweetText') && a.text
        ? { innerText: a.text, textContent: a.text } : null),
    };
  };
  const doc = {
    querySelectorAll: (sel: string) => (sel.includes('article') ? articles.map(mk) : []),
  };
  return { doc, clicks };
}

function run(src: string, doc: unknown): { expanded: number; tweets: Array<{ id: string; text: string }> } {
  // eslint-disable-next-line no-new-func
  const fn = new Function('document', `return ${src}`);
  return fn(doc) as { expanded: number; tweets: Array<{ id: string; text: string }> };
}

/**
 * ⭐⭐⭐ 这几条**遍历注册表**,不点名某个脚本 —— 2026-10-03 改
 *
 * ⚠️⚠️ 原先三条全写死 `expandAll`。加第二个脚本(navProbe)时
 * 它天然在守卫视野之外:**新脚本可以带着反引号/可拼串进来而全绿**。
 * ⭐ `feedback-guard-hardcoded-list-never-grows`(同族第五刀):
 * 修法是**换信息来源**(从 X_DOM_SCRIPTS 真表推清单),不是补清单。
 */
describe('⭐⭐⭐ 脚本必须是合法 JS 且真能跑(**每一个**都查)', () => {
  /** ⚠️ 先钉住「表里真有东西」—— 空数组会让下面每条 for 都空转恒绿 */
  it('⚠️ 注册表非空,且条数与 X_SCRIPTS 的 id 数一致', () => {
    expect(X_DOM_SCRIPTS.length, '注册表空了 —— 下面的遍历全部空转').toBeGreaterThan(0);
    expect(
      X_DOM_SCRIPTS.length,
      '有 id 没注册(或注册了没 id)—— 两张清单对照不上',
    ).toBe(Object.keys(X_SCRIPTS).length);
  });

  it('⭐⭐⭐ 每个脚本 eval 都不抛 —— `inject-template-escape` 唯一能挡住的测试', () => {
    const { doc } = makeDoc([{ id: '1', text: 'hi' }]);
    for (const sc of X_DOM_SCRIPTS) {
      const src = sc.build({} as never) as string;
      /**
       * ⭐ 真 eval,不只 parse:短路/早返回在源码扫描下看不出来
       * (`feedback-source-scan-cant-see-execution`)。
       * ⚠️ 探针用到 window/location/history,得把它们也喂进去。
       */
      expect(() => {
        // eslint-disable-next-line no-new-func
        const fn = new Function('document', 'window', 'location', 'history', `return ${src}`);
        fn(doc, { scrollY: 0 }, { href: 'https://x.com/home' }, { length: 1 });
      }, `脚本 ${sc.id} 求值抛异常 —— 浏览器里同样整段失效`).not.toThrow();
    }
  });

  it('⚠️ 每个脚本里都没有模板字面量(反引号会与页面代码打架)', () => {
    for (const sc of X_DOM_SCRIPTS) {
      expect(sc.build({} as never) as string, `脚本 ${sc.id} 体里有反引号`).not.toContain('`');
    }
  });

  /**
   * ⭐⭐⭐ 参数**可以有**,但必须 JSON 绑定 —— 2026-10-04 改。
   *
   * ⚠️⚠️ 原判据是「给任何参数都返回同一份脚本」。加翻页脚本(要收 URL 与
   * 游标,是真正的运行时值)时它**没变红** —— 因为我喂的 `{evil}` 里
   * 没有 `url`/`cursor`,两次产出碰巧相同。**假绿**。
   *
   * ⭐ 真正要防的是 `project-x-inject-template-escape`:
   * 运行时值被**拼进脚本文本**,于是能从值里逃出来改脚本结构。
   * 判据改成:**把恶意值喂进脚本真正会用的参数名**,
   * 看它① 仍是合法 JS ② 值被当成字符串而不是代码。
   */
  it('⭐⭐⭐ 参数走 JSON 绑定 —— 恶意值逃不出字符串', () => {
    /**
     * ⚠️ 用 `globalThis` 不用 `window` —— 测试里 `window` 是**喂进去的形参**,
     * 逃出来的代码写它只会 ReferenceError,于是**真逃逸也判不出来**
     * (写这条时注入验证当场发现:参数原样拼进去了,测试照样全绿)。
     */
    const evil = '"; globalThis.__pwned = 1; var _ = "';
    for (const sc of X_DOM_SCRIPTS) {
      /** ⭐ 把恶意值喂进**所有**可能的参数名,不猜哪个有用 */
      const src = sc.build({ url: evil, cursor: evil, q: evil, evil } as never);
      /** ① 仍是合法 JS —— 逃出来的话这里就 throw 了 */
      expect(() => new Function(`return ${src}`), `脚本 ${sc.id} 被参数弄坏了`).not.toThrow();
      /**
       * ② **真跑一遍看值逃没逃出来** —— ⚠️ 不能用 `toContain` 判:
       * JSON.stringify 之后那串字符**仍在文本里**(只是带了 `\"` 转义),
       * 子串判据会把**正确的实现也判红**(写这条时当场栽了一次)。
       * ⭐ 判据是行为:注入的代码**没有被执行**。
       */
      const g = globalThis as unknown as Record<string, unknown>;
      delete g.__pwned;
      try {
        // eslint-disable-next-line no-new-func
        const fn = new Function('URL', 'fetch', 'document', 'window', 'location', 'history', `return ${src}`);
        fn(
          class { constructor() { throw new Error('stop'); } },
          () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') }),
          { querySelectorAll: () => [] },
          { scrollY: 0 },
          { href: '' },
          { length: 1 },
        );
      } catch { /* ⚠️ 脚本自己抛不要紧,本条只看注入的代码有没有跑 */ }
      expect(
        g.__pwned,
        `脚本 ${sc.id} 的参数**逃出了字符串** —— 值被当成代码执行了`,
      ).toBeUndefined();
    }
  });

  /** ⭐ 无参数的那些仍该无参数 —— 不给参数的机会就没有拼串的机会 */
  it('⭐ 不需要参数的脚本**不许**随参数变', () => {
    for (const sc of X_DOM_SCRIPTS) {
      if (sc.id === X_SCRIPTS.fetchNextPage) continue; // ⚠️ 它**确实**要参数
      expect(
        sc.build({ evil: '"; window.x=1; "' } as never),
        `脚本 ${sc.id} 的产出随参数变了 —— 它本不需要参数`,
      ).toBe(sc.build({}));
    }
  });
});

/**
 * ⭐⭐ 探针专项 —— 它要回答的是「后退后现场还在不在」,
 * 所以**读出来的字段必须真的能区分现场**。
 */
describe('⭐⭐ 导航探针读的是现场', () => {
  const probe = (doc: unknown, win: unknown, loc: unknown, hist: unknown): Record<string, unknown> => {
    const src = X_DOM_SCRIPTS.find((x) => x.id === X_SCRIPTS.navProbe)!.build({} as never) as string;
    // eslint-disable-next-line no-new-func
    const fn = new Function('document', 'window', 'location', 'history', `return ${src}`);
    return fn(doc, win, loc, hist) as Record<string, unknown>;
  };

  it('⭐⭐ 四项现场都读到:URL / 滚动位置 / history 深度 / 卡片数', () => {
    const r = probe(
      { querySelectorAll: () => [] },
      { scrollY: 1234 },
      { href: 'https://x.com/KA594594' },
      { length: 5 },
    );
    expect(r.url).toBe('https://x.com/KA594594');
    expect(r.scrollY, '滚动位置读不到 —— 「后退后位置回没回来」就答不了').toBe(1234);
    expect(r.historyLength, 'history 深度读不到 —— 判不了后退有没有发生').toBe(5);
    expect(r.tweetCards).toBe(0);
  });

  /**
   * ⭐⭐ 为什么还要首张卡 id:光看 scrollY **不够**。
   * 页面可能整个重新加载成了另一批推文而 scrollY 碰巧相同 ——
   * 那种情况「位置看着对了」其实现场已经没了。
   */
  it('⭐⭐ 首张卡 id 从 /status/ 链接取 —— scrollY 相同也能辨出换了内容', () => {
    const card = {
      querySelector: () => ({ getAttribute: () => '/Sanshi2799/status/2106231911194755232' }),
    };
    const r = probe(
      { querySelectorAll: () => [card] },
      { scrollY: 0 },
      { href: 'https://x.com/home' },
      { length: 1 },
    );
    expect(r.firstCardId, '正则没提出 id —— 转义被吃掉的典型症状').toBe('2106231911194755232');
    expect(r.tweetCards).toBe(1);
  });

  it('⚠️ 卡片上没 /status/ 链接 → firstCardId 空串,不抛', () => {
    const card = { querySelector: () => null };
    const r = probe(
      { querySelectorAll: () => [card] },
      { scrollY: 0 },
      { href: 'https://x.com/home' },
      { length: 1 },
    );
    expect(r.firstCardId).toBe('');
    expect(r.tweetCards, '卡片数该照常报 —— 「有卡但取不到 id」与「没卡」是两件事').toBe(1);
  });
});

describe('⭐⭐ 点开折叠的推文', () => {
  it('⭐ 有 testid 按钮 → 点它(最稳的那条路)', () => {
    const { doc, clicks } = makeDoc([{ id: '1', text: '全文', showMoreTestId: true }]);
    const r = run(script(), doc);
    expect(r.expanded, '没点开').toBe(1);
    expect(clicks).toEqual(['testid']);
  });

  it('⭐ 没 testid → 按文案兜底', () => {
    const { doc, clicks } = makeDoc([{ id: '1', text: 'x', showMoreLabel: '显示更多' }]);
    const r = run(script(), doc);
    expect(r.expanded).toBe(1);
    expect(clicks).toEqual(['label:显示更多']);
  });

  it('⭐ 多语言文案都认', () => {
    for (const label of ['Show more', '显示更多', 'さらに表示', '더 보기', 'Показать ещё']) {
      const { doc, clicks } = makeDoc([{ id: '1', text: 'x', showMoreLabel: label }]);
      run(script(), doc);
      expect(clicks, `「${label}」没认出来`).toHaveLength(1);
    }
  });

  it('⭐⭐⭐ **绝不点 <a>** —— 那是外链,点了会离开页面', () => {
    /**
     * ⚠️⚠️ 旧实现专门记着这条。点错了的后果不是「少采一条」,
     * 而是**整个页面导航走**,这一轮采集全废。
     */
    const { doc, clicks } = makeDoc([{ id: '1', text: 'x', linkLabel: 'Show more' }]);
    run(script(), doc);
    expect(clicks, '点了 <a> —— 页面会导航走,整轮采集作废').not.toContain('LINK!');
    expect(clicks).toHaveLength(0);
  });

  it('⭐ 本来就是全的 → expanded 0,不乱点', () => {
    const { doc, clicks } = makeDoc([{ id: '1', text: '短推' }]);
    expect(run(script(), doc).expanded).toBe(0);
    expect(clicks).toHaveLength(0);
  });

  it('⭐ 有 testid 时**不再走兜底** —— 否则同一条点两次', () => {
    const { doc, clicks } = makeDoc([
      { id: '1', text: 'x', showMoreTestId: true, showMoreLabel: 'Show more' },
    ]);
    run(script(), doc);
    expect(clicks, '点了两次 —— 兜底没被跳过').toEqual(['testid']);
  });
});

describe('⭐⭐ 回读正文', () => {
  it('⭐⭐ 回读**全部**推文,不只展开的那些', () => {
    /**
     * ⚠️ 点击是异步的,点完立刻读未必拿到新文本。
     * ⭐ 回读全部 + 调用方按「只许变长」合并,就不依赖时序了。
     */
    const { doc } = makeDoc([
      { id: '1', text: '甲', showMoreTestId: true },
      { id: '2', text: '乙' },
      { id: '3', text: '丙' },
    ]);
    const r = run(script(), doc);
    expect(r.tweets, '只回读了展开的那条 —— 合并时会依赖点击时序').toHaveLength(3);
    expect(r.tweets.map((t) => t.id)).toEqual(['1', '2', '3']);
  });

  it('⭐ id 从 /status/ 链接取', () => {
    const { doc } = makeDoc([{ id: '2106207038376181933', text: '正文' }]);
    expect(run(script(), doc).tweets[0].id).toBe('2106207038376181933');
  });

  it('⚠️ 没 id 或没正文的条目**不进结果** —— 空壳没有用', () => {
    const { doc } = makeDoc([
      { text: '有正文没 id' },
      { id: '9' },
      { id: '10', text: '两样都有' },
    ]);
    const r = run(script(), doc);
    expect(r.tweets, '空壳进了结果').toHaveLength(1);
    expect(r.tweets[0].id).toBe('10');
  });

  it('⚠️ 单条出错不影响其余 —— 一条坏不许整页作废', () => {
    const { doc } = makeDoc([{ id: '1', text: 'a' }, { id: '2', text: 'b' }]);
    // 让第一条的 querySelector 抛
    const arts = (doc.querySelectorAll('article') as Array<Record<string, unknown>>);
    void arts;
    const broken = {
      querySelectorAll: (sel: string) => {
        if (!sel.includes('article')) return [];
        return [
          { querySelectorAll: () => { throw new Error('boom'); }, querySelector: () => null },
          ...(doc.querySelectorAll('article') as unknown[]),
        ];
      },
    };
    const r = run(script(), broken);
    expect(r.tweets.length, '一条坏就整页作废了').toBeGreaterThanOrEqual(2);
  });
});
